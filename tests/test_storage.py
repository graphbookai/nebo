"""Tests for .nebo file storage integration."""

import os
import tempfile
import pytest
from unittest.mock import patch


def test_daemon_creates_nebo_directory(tmp_path):
    """Daemon should create .nebo/ directory in its cwd on startup."""
    from nebo.server.daemon import DaemonState

    with patch("nebo.server.daemon.NEBO_STORAGE_DIR", str(tmp_path / ".nebo")):
        state = DaemonState()
        state.init_storage()
        assert os.path.isdir(tmp_path / ".nebo")


def test_store_true_creates_file(tmp_path):
    """When store=True, daemon writes a .nebo file for the run."""
    from nebo.server.daemon import DaemonState

    storage_dir = str(tmp_path / ".nebo")
    with patch("nebo.server.daemon.NEBO_STORAGE_DIR", storage_dir):
        state = DaemonState()
        state.init_storage()
        run = state.create_run("test.py", [], "run-1", store=True)

        # Ingest a log event
        import asyncio
        asyncio.run(state.ingest_events([{
            "type": "log",
            "node": "func",
            "message": "hello",
            "timestamp": 1000.0,
        }], run_id="run-1"))

        state.finalize_run("run-1")

        # Check file was created
        files = os.listdir(storage_dir)
        assert len(files) == 1
        assert files[0].endswith(".nebo")


def test_store_false_no_file(tmp_path):
    """When store=False, no .nebo file is created."""
    from nebo.server.daemon import DaemonState

    storage_dir = str(tmp_path / ".nebo")
    with patch("nebo.server.daemon.NEBO_STORAGE_DIR", storage_dir):
        state = DaemonState()
        state.init_storage()
        run = state.create_run("test.py", [], "run-2", store=False)

        import asyncio
        asyncio.run(state.ingest_events([{
            "type": "log",
            "node": "func",
            "message": "hello",
            "timestamp": 1000.0,
        }], run_id="run-2"))

        state.finalize_run("run-2")

        files = os.listdir(storage_dir)
        assert len(files) == 0


def test_load_nebo_file(tmp_path):
    """Loading a .nebo file should reconstruct a Run in the daemon."""
    from nebo.core.fileformat import NeboFileWriter
    from nebo.server.daemon import DaemonState

    # Write a .nebo file
    filepath = str(tmp_path / "test.nebo")
    with open(filepath, "wb") as f:
        writer = NeboFileWriter(f, run_id="loaded-run", script_path="test.py")
        writer.write_header()
        writer.write_entry("node_register", {
            "node_id": "my_func",
            "func_name": "my_func",
            "docstring": "A function",
        })
        writer.write_entry("log", {
            "node": "my_func",
            "message": "loaded message",
            "timestamp": 1000.0,
        })
        writer.close()

    state = DaemonState()
    import asyncio
    asyncio.run(state.load_nebo_file(filepath))

    assert "loaded-run" in state.runs
    run = state.runs["loaded-run"]
    assert len(run.logs) == 1
    assert run.logs[0].message == "loaded message"
