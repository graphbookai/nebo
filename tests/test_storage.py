"""Tests for daemon-side --remote persistence."""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from nebo.core.fileformat import NeboFileReader
from nebo.server.daemon import DaemonState


@pytest.mark.asyncio
async def test_remote_mode_writes_nebo_file(tmp_path):
    state = DaemonState()
    state.mode = "remote"
    state._remote_dir = tmp_path
    run = state.create_run("test.py", [], "run-1")
    assert run._file_writer is not None
    await state.ingest_events(
        [{"type": "log", "loggable_id": "__global__", "message": "hi"}],
        run_id="run-1",
    )
    state.finalize_run("run-1")
    files = list(tmp_path.glob("*.nebo"))
    assert len(files) == 1
    with files[0].open("rb") as f:
        reader = NeboFileReader(f)
        meta = reader.read_header()
        assert meta["run_id"] == "run-1"
        msgs = [
            e["payload"].get("message")
            for e in reader.read_entries()
            if e["type"] == "log"
        ]
    assert msgs == ["hi"]


@pytest.mark.asyncio
async def test_ephemeral_writes_nothing(tmp_path):
    state = DaemonState()  # default mode is remote-ephemeral; _remote_dir None
    run = state.create_run("test.py", [], "run-2")
    assert run._file_writer is None
    assert not list(tmp_path.glob("*.nebo"))
