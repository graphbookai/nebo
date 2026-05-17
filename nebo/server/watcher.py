"""Daemon-side directory watcher.

Polls a directory for *.nebo files and replays their entries through
DaemonState.ingest_events. Non-recursive — subdirectories are ignored
on purpose so --save-files can sit inside --logdir without feedback.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING

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

    async def _read_new_file(self, path: Path, size: int) -> None:
        try:
            with path.open("rb") as f:
                reader = NeboFileReader(f)
                meta = reader.read_header()
                run_id = meta["run_id"]
                entries = [
                    {"type": e["type"], **e["payload"]}
                    for e in reader.read_entries()
                ]
                offset = f.tell()
        except Exception:
            logger.warning("watcher: skipping malformed file %s", path)
            self._tracked[path] = _Tracked(offset=size)
            return
        await self._state.ingest_events(entries, run_id=run_id)
        self._tracked[path] = _Tracked(offset=offset, run_id=run_id)

    async def _read_appended(
        self, path: Path, tracked: "_Tracked", size: int,
    ) -> None:
        try:
            with path.open("rb") as f:
                f.seek(tracked.offset)
                # Note: we seek past the header here, so reader._version stays None.
                # This is safe because the watcher only tails growing files, which
                # are always v3 (current format). Historical v1/v2 files don't grow
                # and are loaded via `nebo load`, not the watcher.
                reader = NeboFileReader(f)
                entries = [
                    {"type": e["type"], **e["payload"]}
                    for e in reader.read_entries()
                ]
                new_offset = f.tell()
        except Exception:
            logger.warning("watcher: failed to tail %s", path)
            return
        if entries:
            await self._state.ingest_events(entries, run_id=tracked.run_id)
        tracked.offset = new_offset


class _Tracked:
    __slots__ = ("offset", "run_id")

    def __init__(self, offset: int, run_id: str | None = None) -> None:
        self.offset = offset
        self.run_id = run_id
