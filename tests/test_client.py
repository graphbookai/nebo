"""Tests for the DaemonClient."""

from __future__ import annotations

import time

import pytest

from nebo.core.client import DaemonClient


class TestDaemonClient:
    """Tests for the SDK daemon client."""

    def test_init_defaults(self) -> None:
        """Should initialize with default host/port."""
        client = DaemonClient()
        assert client._host == "localhost"
        assert client._port == 2048
        assert client._connected is False

    def test_connect_fails_when_no_server(self) -> None:
        """Should return False when daemon is not running."""
        client = DaemonClient(port=19999)  # unlikely to be running
        assert client.connect() is False
        assert client.is_connected() is False

    def test_send_event_buffers_when_disconnected(self) -> None:
        """Should buffer events in fallback buffer when not connected."""
        client = DaemonClient(port=19999)
        client.send_event({"type": "log", "message": "buffered"})
        assert len(client._fallback_buffer) == 1
        assert client._fallback_buffer[0]["message"] == "buffered"

    def test_send_events_multiple(self) -> None:
        """Should buffer multiple events."""
        client = DaemonClient(port=19999)
        client.send_events([
            {"type": "log", "message": "a"},
            {"type": "log", "message": "b"},
        ])
        assert len(client._fallback_buffer) == 2

    def test_disconnect_safe_when_not_connected(self) -> None:
        """Should not crash when disconnecting without connection."""
        client = DaemonClient(port=19999)
        client.disconnect()  # should not raise


class TestModeDetection:
    """Tests for mode detection in nb.init()."""

    def setup_method(self) -> None:
        import nebo as nb
        from nebo.core.state import SessionState
        SessionState.reset_singleton()
        nb._auto_init_done = False

    def test_local_mode_when_no_daemon(self) -> None:
        """Should fall back to local mode when daemon is not running."""
        import os
        # Clear any environment overrides
        for key in ["NEBO_MODE", "NEBO_SERVER_PORT", "NEBO_RUN_ID"]:
            os.environ.pop(key, None)

        import nebo as nb
        nb.init(port=19999, mode="auto", terminal=False)

        from nebo.core.state import get_state
        state = get_state()
        assert state._mode == "local"

    def test_explicit_local_mode(self) -> None:
        """Should use local mode when explicitly set."""
        import nebo as nb
        nb.init(mode="local", terminal=False)

        from nebo.core.state import get_state
        state = get_state()
        assert state._mode == "local"


class _FakeClient:
    """In-memory stand-in for DaemonClient used to capture events."""

    def __init__(self, host=None, port=None, run_id=None, flush_interval=None):  # noqa: ARG002
        self._run_id = run_id
        self._connected = False
        self.events: list[dict] = []

    def connect(self) -> bool:
        self._connected = True
        return True

    def is_connected(self) -> bool:
        return self._connected

    def send_event(self, event: dict) -> None:
        self.events.append(event)

    def send_events(self, events) -> None:
        self.events.extend(events)

    def flush(self) -> None:
        pass

    def disconnect(self) -> None:
        self._connected = False

    def get(self, path):  # pragma: no cover
        return None

    def get_pause_state(self) -> bool:  # pragma: no cover
        return False


class TestRunStartEmission:
    """Regression tests for `run_start` event emission in nb.init().

    Without these, the daemon never opens its `.nebo` file writer because
    `nb run` sets NEBO_RUN_ID, which previously suppressed the `run_start`
    event from the SDK side.
    """

    def setup_method(self) -> None:
        import os
        import nebo as nb
        from nebo.core.state import SessionState

        SessionState.reset_singleton()
        nb._auto_init_done = False
        self._saved_env = {
            k: os.environ.pop(k, None)
            for k in ["NEBO_MODE", "NEBO_SERVER_PORT", "NEBO_RUN_ID", "NEBO_FLUSH_INTERVAL"]
        }
        self._captured: list[_FakeClient] = []

    def teardown_method(self) -> None:
        import os
        for k, v in self._saved_env.items():
            if v is not None:
                os.environ[k] = v

    def _install_fake_client(self, monkeypatch) -> None:
        import nebo.core.client as client_mod

        captured = self._captured

        class TrackingFake(_FakeClient):
            def __init__(self, *a, **kw):
                super().__init__(*a, **kw)
                captured.append(self)

        monkeypatch.setattr(client_mod, "DaemonClient", TrackingFake)

    def test_run_start_emitted_when_run_id_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """When `nb run` sets NEBO_RUN_ID, SDK init must still emit run_start.

        Previously, script_name was only computed if run_id was falsy, so the
        whole `run_start` emission was suppressed under `nb run` and the daemon
        never opened its file writer — no .nebo file got written.
        """
        import os
        os.environ["NEBO_RUN_ID"] = "nbrun_test"
        os.environ["NEBO_MODE"] = "server"
        self._install_fake_client(monkeypatch)

        import nebo as nb
        nb.init(terminal=False)

        assert len(self._captured) == 1
        client = self._captured[0]
        run_starts = [e for e in client.events if e.get("type") == "run_start"]
        assert len(run_starts) == 1, (
            f"expected exactly one run_start, got events: {client.events}"
        )
        data = run_starts[0]["data"]
        assert data.get("script_path"), "script_path must be non-empty"
        assert data.get("store") is True

    def test_run_start_emitted_without_env_run_id(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Direct script execution path must also emit run_start (existing behavior)."""
        self._install_fake_client(monkeypatch)

        import nebo as nb
        nb.init(mode="server", terminal=False)

        assert len(self._captured) == 1
        client = self._captured[0]
        run_starts = [e for e in client.events if e.get("type") == "run_start"]
        assert len(run_starts) == 1

    def test_run_start_carries_store_false(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """`nb.init(store=False)` must propagate into the run_start event."""
        import os
        os.environ["NEBO_RUN_ID"] = "nbrun_no_store"
        os.environ["NEBO_MODE"] = "server"
        self._install_fake_client(monkeypatch)

        import nebo as nb
        nb.init(store=False, terminal=False)

        client = self._captured[0]
        run_starts = [e for e in client.events if e.get("type") == "run_start"]
        assert len(run_starts) == 1
        assert run_starts[0]["data"]["store"] is False
