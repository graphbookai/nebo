"""Tests for run-lifecycle event payloads and atexit emission."""
from __future__ import annotations

import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from nebo.core.fileformat import NeboFileReader


def _read_events(filepath: Path) -> list[dict]:
    with filepath.open("rb") as f:
        reader = NeboFileReader(f)
        reader.read_header()
        return list(reader.read_entries())


def test_run_start_payload_has_timestamp(tmp_path, monkeypatch):
    import nebo as nb
    from nebo.core.state import SessionState

    monkeypatch.setenv("NEBO_QUIET", "1")
    monkeypatch.delenv("NEBO_NO_STORE", raising=False)
    monkeypatch.chdir(tmp_path)

    SessionState.reset_singleton()
    nb._auto_init_done = False
    try:
        nb.init(uri=str(tmp_path / "runs"))
        state = nb.get_state()
        state._transport.flush(timeout=2.0)
    finally:
        if nb.get_state()._transport is not None:
            nb.get_state()._transport.close()
        SessionState.reset_singleton()
        nb._auto_init_done = False

    file = next((tmp_path / "runs").glob("*.nebo"))
    events = _read_events(file)
    run_start = next(e for e in events if e["type"] == "run_start")
    assert "timestamp" in run_start["payload"]["data"], run_start
    assert isinstance(run_start["payload"]["data"]["timestamp"], (int, float))


def test_explicit_start_run_completed_carries_timestamp(tmp_path, monkeypatch):
    import nebo as nb
    from nebo.core.state import SessionState

    monkeypatch.setenv("NEBO_QUIET", "1")
    monkeypatch.delenv("NEBO_NO_STORE", raising=False)
    monkeypatch.chdir(tmp_path)

    SessionState.reset_singleton()
    nb._auto_init_done = False
    try:
        nb.init(uri=str(tmp_path / "runs"))
        with nb.start_run():
            nb.log("hi")
        nb.get_state()._transport.flush(timeout=2.0)
    finally:
        if nb.get_state()._transport is not None:
            nb.get_state()._transport.close()
        SessionState.reset_singleton()
        nb._auto_init_done = False

    files = list((tmp_path / "runs").glob("*.nebo"))
    # Find the file that contains a run_completed event.
    found = False
    for f in files:
        events = _read_events(f)
        completed = [e for e in events if e["type"] == "run_completed"]
        if completed:
            data = completed[0]["payload"]["data"]
            assert "timestamp" in data, data
            assert "exit_code" in data, data
            found = True
            break
    assert found, f"no run_completed event found across files: {[f.name for f in files]}"
