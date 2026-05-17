import time
from pathlib import Path

from nebo.core.fileformat import NeboFileReader
from nebo.core.transport import FileTransport, Transport


def test_transport_is_protocol():
    class DuckTransport:
        def send_event(self, event: dict) -> None: ...
        def flush(self, timeout: float = 5.0) -> bool: return True
        def close(self) -> None: ...

    assert isinstance(DuckTransport(), Transport)


def test_transport_missing_method_fails_isinstance():
    class IncompleteTransport:
        def send_event(self, event: dict) -> None: ...

    assert not isinstance(IncompleteTransport(), Transport)


def test_file_transport_satisfies_protocol(tmp_path):
    t = FileTransport(logdir=tmp_path, run_id="abc123def456", script_path="/x/s.py")
    try:
        assert isinstance(t, Transport)
    finally:
        t.close()


def test_file_transport_writes_header_and_events(tmp_path):
    t = FileTransport(logdir=tmp_path, run_id="abc123def456", script_path="/x/s.py")
    try:
        t.send_event({"type": "log", "loggable_id": "__global__", "message": "hi"})
        t.send_event({"type": "log", "loggable_id": "__global__", "message": "bye"})
        assert t.flush(timeout=2.0)
    finally:
        t.close()

    files = list(tmp_path.glob("*.nebo"))
    assert len(files) == 1
    assert "abc123def456" in files[0].name

    with files[0].open("rb") as f:
        reader = NeboFileReader(f)
        meta = reader.read_header()
        assert meta["run_id"] == "abc123def456"
        assert meta["script_path"] == "/x/s.py"
        entries = list(reader.read_entries())

    log_msgs = [
        e["payload"].get("message")
        for e in entries
        if e["type"] == "log"
    ]
    assert log_msgs == ["hi", "bye"]


def test_file_transport_seeds_global_and_agent_loggables(tmp_path):
    """FileTransport mirrors what the daemon does on run_start: emit
    loggable_register entries for __global__ and __agent__ so file readers
    see the same shape they'd see for a daemon-written file.
    """
    t = FileTransport(logdir=tmp_path, run_id="aaa111bbb222", script_path="/x/s.py")
    try:
        assert t.flush(timeout=2.0)
    finally:
        t.close()

    file = next(tmp_path.glob("*.nebo"))
    with file.open("rb") as f:
        reader = NeboFileReader(f)
        reader.read_header()
        entries = list(reader.read_entries())

    seeded = [
        e["payload"]["data"]["loggable_id"]
        for e in entries
        if e["type"] == "loggable_register"
    ]
    assert "__global__" in seeded
    assert "__agent__" in seeded


def test_file_transport_rolls_on_new_run(tmp_path, monkeypatch):
    """nb.start_run() in file mode must roll the underlying file so each
    run gets its own .nebo file (otherwise events from later runs leak
    into the first run's file)."""
    import nebo as nb
    from nebo.core.state import SessionState

    monkeypatch.setenv("NEBO_QUIET", "1")
    monkeypatch.delenv("NEBO_NO_STORE", raising=False)
    monkeypatch.chdir(tmp_path)

    SessionState.reset_singleton()
    nb._auto_init_done = False
    try:
        nb.init(uri=str(tmp_path / "runs"))
        with nb.start_run() as r1:
            nb.log("first run log")
        with nb.start_run() as r2:
            nb.log("second run log")
        nb.flush(timeout=2.0)
    finally:
        # Make sure the transport is closed so the file handles are released
        state = nb.get_state()
        if state._transport is not None:
            state._transport.close()
        SessionState.reset_singleton()
        nb._auto_init_done = False

    files = sorted((tmp_path / "runs").glob("*.nebo"))
    # init() creates a file for the auto-generated run; start_run() rolls
    # to a new file each time. So we expect at least 3 files: the implicit
    # init run + r1 + r2. (May be 2 if init's run is reused for r1, depends
    # on the rolling policy; document the actual behavior in this test.)
    run_ids_in_filenames = {f.stem.split("_")[-1] for f in files}
    assert r1.run_id in run_ids_in_filenames, f"r1 file missing; got {[f.name for f in files]}"
    assert r2.run_id in run_ids_in_filenames, f"r2 file missing; got {[f.name for f in files]}"
