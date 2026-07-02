"""Transport protocol — abstracts the SDK's event sink.

Two implementations live in the codebase:
  * NetworkTransport (nebo/core/client.py) — HTTP POST /events.
  * FileTransport (this module) — append-only .nebo file.

Both share the same in-memory event-dict shape, so SessionState
doesn't care which one is wired up.
"""

from __future__ import annotations

import atexit
import os
import queue
import threading
import time
from pathlib import Path
from typing import Optional, Protocol, runtime_checkable

from nebo.core.fileformat import NeboFileWriter


@runtime_checkable
class Transport(Protocol):
    def send_event(self, event: dict) -> None: ...
    def flush(self, timeout: float = 5.0) -> bool: ...
    def close(self) -> None: ...


class FileTransport:
    """Append-only `.nebo` writer running off a background thread.

    Mirrors the queue-and-flush shape of NetworkTransport so SessionState
    can treat both interchangeably.
    """

    def __init__(
        self,
        logdir: os.PathLike | str,
        run_id: str,
        script_path: str,
        flush_interval: float = 0.1,
    ) -> None:
        self._logdir = Path(logdir)
        self._logdir.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y-%m-%d_%H%M%S")
        self._filepath = self._logdir / f"{ts}_{run_id}.nebo"
        self._stream = self._filepath.open("wb")
        self._writer = NeboFileWriter(
            self._stream, run_id=run_id, script_path=script_path,
        )
        self._writer.write_header()
        # Seed implicit loggables exactly like the daemon does on run_start.
        for lid, kind in (("__global__", "global"), ("__agent__", "agent")):
            self._writer.write_entry(
                "loggable_register",
                {
                    "type": "loggable_register",
                    "loggable_id": lid,
                    "data": {"loggable_id": lid, "kind": kind},
                },
            )

        self._queue: queue.Queue[Optional[dict]] = queue.Queue()
        self._flush_interval = flush_interval
        self._running = True
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        self._run_completed_sent = False
        atexit.register(self._emit_run_completed_atexit)

    @property
    def filepath(self) -> Path:
        return self._filepath

    def _run(self) -> None:
        """Background thread: drain the queue per tick, coalesce, write.

        Each tick drains everything available, folds accumulating metric
        events into `metric_batch` frames (see nebo/core/coalesce.py) and
        writes with a single stream flush — instead of one write+flush
        syscall pair per event.
        """
        from nebo.core.coalesce import coalesce

        stop = False
        while not stop:
            try:
                first = self._queue.get(timeout=self._flush_interval)
            except queue.Empty:
                if not self._running:
                    break
                continue
            batch: list = [first]
            while True:
                try:
                    batch.append(self._queue.get_nowait())
                except queue.Empty:
                    break

            events: list[dict] = []
            barriers: list[threading.Event] = []
            for item in batch:
                if item is None:
                    stop = True
                elif isinstance(item, tuple) and item[0] == "__barrier__":
                    barriers.append(item[1])
                else:
                    events.append(item)

            with self._lock:
                for event in coalesce(events):
                    self._writer.write_entry(event.get("type", "log"), event)
                self._stream.flush()
            for barrier in barriers:
                barrier.set()

    def send_event(self, event: dict) -> None:
        if not self._running:
            return
        self._queue.put(event)

    def flush(self, timeout: float = 5.0) -> bool:
        """Barrier: block until everything queued before this call is on disk."""
        if not self._running:
            return True
        barrier = threading.Event()
        self._queue.put(("__barrier__", barrier))
        return barrier.wait(timeout)

    def close(self) -> None:
        if not self._running:
            return
        self._run_completed_sent = True
        self._running = False
        self._queue.put(None)  # poison pill
        self._thread.join(timeout=5.0)
        with self._lock:
            self._writer.close()
            self._stream.close()

    def _emit_run_completed_atexit(self) -> None:
        """Emit a run_completed event at process exit, then close cleanly.

        Guarded by _run_completed_sent so explicit start_run()
        context-manager exits don't get a duplicate event.
        """
        if self._run_completed_sent or not self._running:
            return
        self._run_completed_sent = True
        self.send_event({
            "type": "run_completed",
            "data": {"timestamp": time.time()},
        })
        self.flush(timeout=2.0)
        self.close()
