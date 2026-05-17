"""Tests for the daemon's directory watcher."""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from nebo.core.fileformat import NeboFileWriter
from nebo.server.daemon import DaemonState
from nebo.server.watcher import DirectoryWatcher


def _write_run_file(path: Path, run_id: str, events: list[dict]) -> Path:
    filepath = path / f"2026-05-16_120000_{run_id}.nebo"
    f = filepath.open("wb")
    writer = NeboFileWriter(f, run_id=run_id, script_path="/x/s.py")
    writer.write_header()
    for e in events:
        writer.write_entry(e["type"], dict(e))
    writer.close()
    f.close()
    return filepath


@pytest.mark.asyncio
async def test_watcher_picks_up_new_file(tmp_path):
    state = DaemonState()
    watcher = DirectoryWatcher(state, logdir=tmp_path, poll_interval=0.05)
    task = asyncio.create_task(watcher.run())

    _write_run_file(
        tmp_path, "newrun123456",
        [{"type": "log", "loggable_id": "__global__", "message": "hello"}],
    )

    await asyncio.sleep(0.3)
    watcher.stop()
    await task

    assert "newrun123456" in state.runs
    run = state.runs["newrun123456"]
    assert any(l.message == "hello" for l in run.logs)


@pytest.mark.asyncio
async def test_watcher_tails_appended_entries(tmp_path):
    state = DaemonState()
    watcher = DirectoryWatcher(state, logdir=tmp_path, poll_interval=0.05)
    task = asyncio.create_task(watcher.run())

    filepath = _write_run_file(
        tmp_path, "tailrun654321",
        [{"type": "log", "loggable_id": "__global__", "message": "first"}],
    )
    await asyncio.sleep(0.2)

    f = filepath.open("ab")
    writer = NeboFileWriter(f, run_id="tailrun654321", script_path="/x/s.py")
    writer.write_entry(
        "log", {"type": "log", "loggable_id": "__global__", "message": "second"},
    )
    writer.close()
    f.close()

    await asyncio.sleep(0.2)
    watcher.stop()
    await task

    msgs = [l.message for l in state.runs["tailrun654321"].logs]
    assert msgs == ["first", "second"]


@pytest.mark.asyncio
async def test_watcher_ignores_non_nebo_files(tmp_path):
    state = DaemonState()
    (tmp_path / "junk.txt").write_text("not a nebo file")
    watcher = DirectoryWatcher(state, logdir=tmp_path, poll_interval=0.05)
    task = asyncio.create_task(watcher.run())
    await asyncio.sleep(0.2)
    watcher.stop()
    await task
    assert state.runs == {}
