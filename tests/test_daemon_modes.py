"""Daemon persistence modes + local-only rejection + SDK fail-fast.

Modes:
  * local             — rejects network runs (watcher-only daemon)
  * remote            — accepts network runs, persists them as .nebo files
  * remote-ephemeral  — accepts network runs, persists nothing (RAM + cache)
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from nebo.core.fileformat import NeboFileReader
from nebo.server.daemon import DaemonState, create_daemon_app

RUN_START = {"type": "run_start", "data": {"script_path": "t.py"}}
A_LOG = {"type": "log", "loggable_id": "__global__", "message": "hi"}


def _app(mode, remote_dir=None):
    state = DaemonState()
    state.mode = mode
    if remote_dir is not None:
        state._remote_dir = remote_dir
    return state, TestClient(create_daemon_app(state))


class TestHealthMode:
    def test_each_mode_reported(self):
        for mode in ("local", "remote", "remote-ephemeral"):
            _, client = _app(mode)
            assert client.get("/health").json()["mode"] == mode


class TestLocalRejection:
    def test_run_start_rejected_naming_both_flags(self):
        _, client = _app("local")
        resp = client.post("/events?run_id=r1", json=[RUN_START])
        assert resp.status_code == 409
        body = resp.json()
        assert body["error"] == "daemon_local_only"
        # The error copy carries the fix — both flags named.
        assert "--remote " in body["detail"] or "--remote [" in body["detail"]
        assert "--remote-ephemeral" in body["detail"]

    def test_unknown_run_event_rejected(self):
        _, client = _app("local")
        resp = client.post("/events?run_id=ghost", json=[A_LOG])
        assert resp.status_code == 409

    def test_known_run_annotation_accepted(self):
        # A watcher-discovered run already exists → annotating it is fine even
        # on a local-only daemon (only run *creation* is refused).
        state, client = _app("local")
        state.create_run("t.py", run_id="known")
        resp = client.post("/events?run_id=known", json=[A_LOG])
        assert resp.status_code == 200
        logs = client.get("/runs/known/logs").json()["logs"]
        assert logs[-1]["message"] == "hi"


class TestRemoteEphemeral:
    def test_accepts_but_persists_nothing(self, tmp_path):
        _, client = _app("remote-ephemeral")
        resp = client.post("/events?run_id=r1", json=[RUN_START, A_LOG])
        assert resp.status_code == 200
        assert not list(tmp_path.glob("*.nebo"))
        logs = client.get("/runs/r1/logs").json()["logs"]
        assert logs[-1]["message"] == "hi"


class TestRemote:
    def test_writes_readable_file(self, tmp_path):
        _, client = _app("remote", remote_dir=tmp_path)
        client.post("/events?run_id=r1", json=[RUN_START, A_LOG])
        client.post(
            "/events?run_id=r1", json=[{"type": "run_completed", "data": {}}]
        )
        files = list(tmp_path.glob("*.nebo"))
        assert len(files) == 1
        with files[0].open("rb") as f:
            reader = NeboFileReader(f)
            assert reader.read_header()["run_id"] == "r1"
            msgs = [
                e["payload"].get("message")
                for e in reader.read_entries()
                if e["type"] == "log"
            ]
        assert msgs == ["hi"]


class TestModeResolution:
    def test_both_env_flags_error(self, monkeypatch):
        monkeypatch.setenv("NEBO_REMOTE", "/x")
        monkeypatch.setenv("NEBO_REMOTE_EPHEMERAL", "1")
        with pytest.raises(RuntimeError):
            create_daemon_app(None)

    def test_default_server_is_local(self, monkeypatch):
        for k in (
            "NEBO_REMOTE", "NEBO_REMOTE_EPHEMERAL", "NEBO_LOGDIR", "NEBO_NO_LOCAL",
        ):
            monkeypatch.delenv(k, raising=False)
        app = create_daemon_app(None)
        assert app.state.daemon.mode == "local"

    def test_remote_env_bare_uses_default_dir(self, monkeypatch, tmp_path):
        monkeypatch.delenv("NEBO_REMOTE_EPHEMERAL", raising=False)
        monkeypatch.delenv("NEBO_NO_LOCAL", raising=False)
        monkeypatch.setenv("NEBO_LOGDIR", str(tmp_path))
        monkeypatch.setenv("NEBO_REMOTE", "1")  # bare flag → default dir
        state = create_daemon_app(None).state.daemon
        assert state.mode == "remote"
        assert state._remote_dir == tmp_path / "remote"


def _fake_urlopen(mode):
    """A urllib.request.urlopen stand-in returning /health with `mode`."""

    class _Resp:
        status = 200

        def read(self):
            return json.dumps({"status": "ok", "mode": mode}).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def _open(req, timeout=None):
        return _Resp()

    return _open


class TestSdkFailFast:
    def test_connect_local_mode_is_fatal(self, monkeypatch):
        from nebo.core.client import NetworkTransport

        monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen("local"))
        t = NetworkTransport(base_url="http://localhost:7861")
        assert t.connect() is False
        assert t._fatal is True
        assert t._policy_error and "local-only" in t._policy_error

    def test_connect_ephemeral_mode_ok(self, monkeypatch):
        from nebo.core.client import NetworkTransport

        monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen("remote-ephemeral"))
        # Don't spin up the background flush thread for a unit check.
        monkeypatch.setattr(NetworkTransport, "_start_flush_thread", lambda self: None)
        t = NetworkTransport(base_url="http://localhost:7861")
        assert t.connect() is True
        assert t._fatal is False
        assert t._policy_error is None

    def test_transient_failure_is_retryable(self):
        from nebo.core.client import NetworkTransport

        # Nothing is listening → connect fails, but not fatally: the flush
        # loop must keep retrying (this is the not-a-policy-error path).
        t = NetworkTransport(base_url="http://localhost:19998")
        assert t.connect() is False
        assert t._fatal is False
        assert t._policy_error is None

    def test_init_raises_daemon_local_only(self, monkeypatch):
        import nebo as nb
        from nebo.core.state import SessionState

        monkeypatch.delenv("NEBO_URI", raising=False)
        monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen("local"))
        SessionState.reset_singleton()
        nb._auto_init_done = False
        try:
            with pytest.raises(nb.DaemonLocalOnlyError):
                nb.init(uri="localhost:7861")
        finally:
            SessionState.reset_singleton()
            nb._auto_init_done = False
