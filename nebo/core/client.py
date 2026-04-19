"""SDK client that connects to the nebo daemon server.

In server mode, all events (logs, metrics, node registrations, etc.) are
forwarded to the daemon via HTTP. If the daemon disconnects, the client
falls back to local mode and buffers events for replay on reconnect.

Uses only stdlib (urllib) — no httpx dependency required.
"""

from __future__ import annotations

import atexit
import json
import os
import queue
import threading
import time
import urllib.request
import urllib.error
from typing import Any, Optional


class DaemonClient:
    """Client that streams events from the SDK to the daemon server.

    Thread-safe. Uses a background thread for batched HTTP flushing.
    Supports graceful fallback and reconnection.
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 2048,
        run_id: Optional[str] = None,
        flush_interval: float = 0.1,
        base_url: Optional[str] = None,
        api_token: Optional[str] = None,
    ) -> None:
        """Connect to a nebo daemon.

        For a local daemon: pass `host` + `port` (defaults work).
        For a hosted/cloud daemon: pass `base_url` (e.g.
        `https://nebo-cloud-router-xxx.a.run.app`) and `api_token`.
        When `base_url` is set it takes precedence over `host`/`port`.
        When `api_token` is set, an `Authorization: Bearer <token>`
        header is added to every HTTP request.
        """
        self._host = host
        self._port = port
        self._run_id = run_id
        self._flush_interval = flush_interval
        self._api_token = api_token
        if base_url:
            self._base_url = base_url.rstrip("/")
        else:
            self._base_url = f"http://{host}:{port}"

        self._queue: queue.Queue[dict[str, Any]] = queue.Queue()
        self._buffer: list[dict[str, Any]] = []
        self._connected = False
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._fallback_buffer: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self._run_completed: bool = False

    def _auth_headers(self) -> dict[str, str]:
        if self._api_token:
            # Use X-Nebo-Api-Token instead of Authorization: Bearer.
            # Google Cloud Frontend's WAF blocks specific opaque
            # bearer-token shapes ("leaked credential" detection),
            # returning 403 before the request reaches our service.
            # A custom header bypasses that.
            return {"X-Nebo-Api-Token": self._api_token}
        return {}

    def warmup(self, timeout: float = 120.0) -> bool:
        """Block until the cloud router has a daemon ready for this user.

        Calls POST /api/daemon/warmup which triggers the router to
        lazy-create the per-user Cloud Run daemon and waits for it to
        be Ready (cold start can take 30-60s). Returns True on success,
        False on timeout or non-200 response.

        No-op (returns True immediately) when no api_token is set —
        warmup is only meaningful for cloud mode.
        """
        if not self._api_token:
            return True
        url = f"{self._base_url}/api/daemon/warmup"
        req = urllib.request.Request(url, data=b"", method="POST")
        req.add_header("Content-Type", "application/json")
        for k, v in self._auth_headers().items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status == 200
        except Exception:
            return False

    def connect(self) -> bool:
        """Attempt to connect to the daemon server.

        Returns:
            True if connection successful.
        """
        try:
            req = urllib.request.Request(f"{self._base_url}/health", method="GET")
            for k, v in self._auth_headers().items():
                req.add_header(k, v)
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                if resp.status == 200:
                    self._connected = True
                    self._start_flush_thread()
                    return True
        except Exception:
            pass
        self._connected = False
        return False

    def send_event(self, event: dict[str, Any]) -> None:
        """Queue an event to be sent to the daemon.

        If disconnected, events are buffered for replay on reconnect.

        Args:
            event: The event dictionary to send.
        """
        if self._connected:
            self._queue.put(event)
        else:
            with self._lock:
                self._fallback_buffer.append(event)

    def send_events(self, events: list[dict[str, Any]]) -> None:
        """Queue multiple events."""
        for event in events:
            self.send_event(event)

    def is_connected(self) -> bool:
        """Check if the client is connected to the daemon."""
        return self._connected

    def disconnect(self) -> None:
        """Disconnect from the daemon and flush remaining events."""
        # Send run_completed event before flushing (guard against double send)
        if self._connected and not self._run_completed:
            self._queue.put({
                "type": "run_completed",
                "data": {"exit_code": 0},
            })
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)
        self._flush_remaining()
        self._connected = False

    def _start_flush_thread(self) -> None:
        """Start the background flush thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._flush_loop, daemon=True)
        self._thread.start()
        atexit.register(self.disconnect)

    def _flush_loop(self) -> None:
        """Background loop: batch events and send to daemon."""
        last_flush = time.monotonic()

        while self._running:
            try:
                event = self._queue.get(timeout=self._flush_interval)
                self._buffer.append(event)
            except queue.Empty:
                pass

            now = time.monotonic()

            if (now - last_flush) >= self._flush_interval and self._buffer:
                success = self._do_flush()
                last_flush = now
                if not success:
                    self._handle_disconnect()

    def _do_flush(self) -> bool:
        """Send buffered events to the daemon. Returns True on success."""
        if not self._buffer:
            return True

        batch = self._buffer[:]
        self._buffer.clear()

        try:
            # Cloud mode (api_token set) targets the router's
            # /api/sdk/ingest alias; Google's GFE WAF blocks
            # POST /events with long header values. Local daemons
            # still expose /events directly.
            ingest_path = "/api/sdk/events" if self._api_token else "/events"
            url = f"{self._base_url}{ingest_path}"
            if self._run_id:
                url += f"?run_id={urllib.request.quote(self._run_id)}"
            data = json.dumps(batch).encode("utf-8")
            req = urllib.request.Request(url, data=data, method="POST")
            req.add_header("Content-Type", "application/json")
            for k, v in self._auth_headers().items():
                req.add_header(k, v)
            # Cloud-mode requests cross the public internet and may
            # spend a few seconds in TLS+routing tail latency. Local
            # daemons over loopback are fast — 5s is fine there.
            request_timeout = 30.0 if self._api_token else 5.0
            with urllib.request.urlopen(req, timeout=request_timeout) as resp:
                return resp.status == 200
        except Exception:
            # Put events back for retry
            self._buffer = batch + self._buffer
            return False

    def _flush_remaining(self) -> None:
        """Synchronously flush all remaining events."""
        while not self._queue.empty():
            try:
                event = self._queue.get_nowait()
                self._buffer.append(event)
            except queue.Empty:
                break
        self._do_flush()

    def _handle_disconnect(self) -> None:
        """Handle daemon disconnection: buffer events and try to reconnect."""
        self._connected = False

        # Move buffer to fallback
        with self._lock:
            self._fallback_buffer.extend(self._buffer)
            self._buffer.clear()

        # Try to reconnect periodically
        for _ in range(5):
            time.sleep(1.0)
            if self.connect():
                # Replay buffered events
                with self._lock:
                    replay = self._fallback_buffer[:]
                    self._fallback_buffer.clear()
                if replay:
                    for event in replay:
                        self._queue.put(event)
                return

    def flush(self) -> None:
        """Force-flush the current event buffer immediately.

        Blocks until all queued events have been sent. Useful for
        time-sensitive events like ask prompts that shouldn't wait
        for the next batch interval.
        """
        # Drain the queue into the buffer
        while not self._queue.empty():
            try:
                event = self._queue.get_nowait()
                self._buffer.append(event)
            except queue.Empty:
                break
        self._do_flush()

    def get(self, path: str) -> Optional[dict[str, Any]]:
        """Send a GET request to the daemon and return the JSON response.

        Args:
            path: URL path (e.g. "/runs/run_1/ask/abc/respond").

        Returns:
            Parsed JSON dict, or None on error.
        """
        try:
            url = f"{self._base_url}{path}"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode("utf-8"))
        except Exception:
            pass
        return None

    def get_pause_state(self) -> bool:
        """Poll the daemon for the current pause state.

        Returns:
            True if the run is paused, False otherwise.
        """
        path = f"/runs/{self._run_id}/pause"
        resp = self.get(path)
        if resp is not None:
            return resp.get("paused", False)
        return False

    def try_reconnect(self) -> bool:
        """Manually attempt reconnection."""
        if self._connected:
            return True
        connected = self.connect()
        if connected:
            with self._lock:
                replay = self._fallback_buffer[:]
                self._fallback_buffer.clear()
            for event in replay:
                self._queue.put(event)
        return connected
