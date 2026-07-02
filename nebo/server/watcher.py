"""Daemon-side directory watcher.

Polls a directory for *.nebo files and replays their entries through
DaemonState.ingest_events. Non-recursive — subdirectories are ignored
on purpose so --save-files can sit inside --logdir without feedback.

With a cache-backed DaemonState, per-file offsets are persisted to the
`watch_files` table, so a daemon restart resumes tailing each file from
where it left off instead of replaying everything. Reads go through
`NeboFileReader.read_entries_incremental`, which parks cleanly at a torn
tail frame (a writer caught mid-append) — the offset only ever advances
past *complete* entries, so no prefix is skipped and nothing is ingested
twice.

Image/audio events are annotated with ``_media_src = (path, offset,
length)`` before ingest so the daemon can store media by reference into
the .nebo file rather than copying bytes into the cache.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING, BinaryIO

from nebo.core.fileformat import NeboFileReader

if TYPE_CHECKING:
    from nebo.server.daemon import DaemonState

logger = logging.getLogger(__name__)


class DirectoryWatcher:
    """Polls a directory for .nebo files and replays entries into DaemonState."""

    def __init__(
        self,
        state: "DaemonState",
        logdir: os.PathLike | str,
        poll_interval: float = 0.5,
    ) -> None:
        self._state = state
        self._logdir = Path(logdir)
        self._logdir.mkdir(parents=True, exist_ok=True)
        self._poll_interval = poll_interval
        self._tracked: dict[Path, _Tracked] = {}
        self._stopping = asyncio.Event()
        self._cache = getattr(state, "cache", None)
        if self._cache is not None:
            for path_str, info in self._cache.get_watch_files().items():
                self._tracked[Path(path_str)] = _Tracked(
                    offset=info["offset"], run_id=info["run_id"],
                )

    def stop(self) -> None:
        self._stopping.set()

    async def run(self) -> None:
        while not self._stopping.is_set():
            try:
                await self._tick()
            except Exception:
                logger.exception("watcher tick failed")
            try:
                await asyncio.wait_for(
                    self._stopping.wait(), timeout=self._poll_interval,
                )
            except asyncio.TimeoutError:
                pass

    async def _tick(self) -> None:
        try:
            entries = [
                Path(e.path) for e in os.scandir(self._logdir)
                if e.is_file() and e.name.endswith(".nebo")
            ]
        except FileNotFoundError:
            return
        for path in entries:
            await self._sync_file(path)

    async def _sync_file(self, path: Path) -> None:
        tracked = self._tracked.get(path)
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return
        if tracked is None:
            await self._read_new_file(path, size)
            return
        if size < tracked.offset:
            # File shrank or was replaced — re-ingest from scratch.
            del self._tracked[path]
            await self._read_new_file(path, size)
            return
        if size == tracked.offset:
            return
        await self._read_appended(path, tracked, size)

    def _collect(
        self, reader: NeboFileReader, stream: BinaryIO, path: Path,
    ) -> list[dict]:
        """Drain complete entries; annotate media with their frame source.

        `read_entries_incremental` stops at (and seeks back to) any torn
        tail frame, so after this returns `stream.tell()` is exactly the
        offset to resume from next tick.
        """
        events: list[dict] = []
        for entry, start, end in reader.read_entries_incremental():
            event = {"type": entry["type"], **entry["payload"]}
            if event.get("type") in ("image", "audio") and "data" in event:
                event["_media_src"] = (str(path), start, end - start)
            events.append(event)
        return events

    def _persist_offset(self, path: Path, run_id: str | None, offset: int) -> None:
        if self._cache is None:
            return
        try:
            st = path.stat()
        except FileNotFoundError:
            return
        self._cache.enqueue(
            ("watch_file", str(path), run_id, offset, st.st_size, st.st_mtime)
        )

    async def _read_new_file(self, path: Path, size: int) -> None:
        try:
            with path.open("rb") as f:
                reader = NeboFileReader(f)
                meta = reader.read_header()
                run_id = meta["run_id"]
                events = self._collect(reader, f, path)
                offset = f.tell()
        except Exception:
            # A bad header. Distinguish "will never parse" (wrong magic on a
            # complete prefix — skip forever) from "header still being
            # written" (retry next tick).
            if size >= 6:
                logger.warning("watcher: skipping malformed file %s", path)
                self._tracked[path] = _Tracked(offset=size)
            return
        if events:
            await self._state.ingest_events(events, run_id=run_id, source="watcher")
        self._tracked[path] = _Tracked(offset=offset, run_id=run_id)
        self._persist_offset(path, run_id, offset)

    async def _read_appended(
        self, path: Path, tracked: "_Tracked", size: int,
    ) -> None:
        try:
            with path.open("rb") as f:
                f.seek(tracked.offset)
                # Note: we seek past the header here, so reader._version stays
                # None (passthrough). Safe: only growing files are tailed, and
                # those are always the current format. Historical v1/v2 files
                # don't grow and are loaded via `nebo load`, not the watcher.
                reader = NeboFileReader(f)
                events = self._collect(reader, f, path)
                new_offset = f.tell()
        except OSError:
            logger.warning("watcher: failed to tail %s", path)
            return
        if events:
            await self._state.ingest_events(
                events, run_id=tracked.run_id, source="watcher",
            )
        tracked.offset = new_offset
        self._persist_offset(path, tracked.run_id, new_offset)


class _Tracked:
    __slots__ = ("offset", "run_id")

    def __init__(self, offset: int, run_id: str | None = None) -> None:
        self.offset = offset
        self.run_id = run_id
