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

    def test_run_start_script_path_is_absolute(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """run_start.data.script_path must be an absolute path.

        Regression: it was previously set to `os.path.basename(sys.argv[0])`,
        which broke `nebo_restart_pipeline` — the MCP tool reads `script_path`
        from the stored run and feeds it to `run_pipeline`, which fails with
        HTTP 404 "Script not found" whenever the user invoked nebo from a
        directory other than the daemon's CWD.
        """
        import os
        import sys

        os.environ["NEBO_RUN_ID"] = "nbrun_abs"
        os.environ["NEBO_MODE"] = "server"
        self._install_fake_client(monkeypatch)

        # Simulate a script invoked with only a basename in argv[0]
        fake_argv = ["train.py"]
        monkeypatch.setattr(sys, "argv", fake_argv)

        import nebo as nb
        nb.init(terminal=False)

        client = self._captured[0]
        run_starts = [e for e in client.events if e.get("type") == "run_start"]
        assert len(run_starts) == 1
        script_path = run_starts[0]["data"]["script_path"]
        assert os.path.isabs(script_path), (
            f"script_path must be absolute, got: {script_path!r}"
        )
        assert script_path.endswith("train.py")


class TestUiConfigEmission:
    """Regression tests for `nb.ui()` UI-config forwarding.

    `nb.ui(layout="horizontal", ...)` must both update SessionState.ui_config
    AND send a `ui_config` event to the daemon client. Without the event, the
    daemon never learns about the run-level UI defaults so the web UI can't
    apply them.
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

    def test_ui_sends_ui_config_event(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """`nb.ui(...)` must emit a ui_config event to the client."""
        self._install_fake_client(monkeypatch)

        import nebo as nb
        nb.init(mode="server", terminal=False)
        nb.ui(layout="horizontal", view="dag", collapsed=True, minimap=True, theme="dark")

        assert len(self._captured) == 1
        client = self._captured[0]
        ui_events = [e for e in client.events if e.get("type") == "ui_config"]
        assert len(ui_events) == 1, (
            f"expected exactly one ui_config event, got events: {client.events}"
        )
        data = ui_events[0]["data"]
        assert data["layout"] == "horizontal"
        assert data["view"] == "dag"
        assert data["collapsed"] is True
        assert data["minimap"] is True
        assert data["theme"] == "dark"

    def test_ui_updates_session_state(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """`nb.ui(...)` must also write into SessionState.ui_config."""
        self._install_fake_client(monkeypatch)

        import nebo as nb
        from nebo.core.state import get_state

        nb.init(mode="server", terminal=False)
        nb.ui(layout="vertical", theme="light")

        state = get_state()
        assert state.ui_config == {"layout": "vertical", "theme": "light"}

    def test_ui_omits_unspecified_fields(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Fields left as None must not appear in the emitted ui_config event."""
        self._install_fake_client(monkeypatch)

        import nebo as nb
        nb.init(mode="server", terminal=False)
        nb.ui(minimap=False)

        client = self._captured[0]
        ui_events = [e for e in client.events if e.get("type") == "ui_config"]
        assert len(ui_events) == 1
        data = ui_events[0]["data"]
        assert data == {"minimap": False}


class _PauseControllableFakeClient(_FakeClient):
    """Fake client whose pause state is controlled by the test."""

    _pause_state: bool = False

    def get_pause_state(self) -> bool:
        return type(self)._pause_state


class TestPausePollStartsLazily:
    """Regression tests for Bug 9: pausable functions never pause under `nb run`.

    Root cause: `_start_pause_poll()` is called exactly once at the end of
    `init()` and bails out early when `state._has_pausable` is False. But
    `_has_pausable` is only set to True inside `register_node()` — which
    fires lazily on the first @fn call, i.e. **after** `init()` has already
    returned. So the poll thread is never started and the subprocess never
    learns about web-UI pause/unpause commands.
    """

    def setup_method(self) -> None:
        import os
        import nebo as nb
        from nebo.core.state import SessionState

        SessionState.reset_singleton()
        nb._auto_init_done = False
        # Clear any stale poll thread reference from a previous test
        nb._pause_poll_thread = None
        self._saved_env = {
            k: os.environ.pop(k, None)
            for k in ["NEBO_MODE", "NEBO_SERVER_PORT", "NEBO_RUN_ID", "NEBO_FLUSH_INTERVAL"]
        }
        _PauseControllableFakeClient._pause_state = False

    def teardown_method(self) -> None:
        import os
        for k, v in self._saved_env.items():
            if v is not None:
                os.environ[k] = v
        _PauseControllableFakeClient._pause_state = False

    def _install_fake_client(self, monkeypatch) -> None:
        import nebo.core.client as client_mod
        monkeypatch.setattr(client_mod, "DaemonClient", _PauseControllableFakeClient)

    def test_pause_poll_thread_starts_after_pausable_registration(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Registering a @fn(pausable=True) AFTER init() must start the poll thread.

        This is the production ordering under `nb run`: init() runs first
        (module import), then the first decorated function call lazily
        triggers `register_node()` and sets `_has_pausable=True`. The fix
        must start the poll thread at that moment.
        """
        import time as _time
        self._install_fake_client(monkeypatch)

        import nebo as nb
        nb.init(mode="server", terminal=False)

        # At this point the poll thread must NOT have started yet because
        # no pausable node has been registered.
        assert nb._pause_poll_thread is None or not nb._pause_poll_thread.is_alive()

        # Now define and invoke a pausable function — this mirrors what a
        # user script does at runtime.
        @nb.fn(pausable=True)
        def step():
            return 42

        step()

        # The poll thread must now be alive so pause commands from the
        # daemon can reach the SDK.
        assert nb._pause_poll_thread is not None, (
            "Pause-poll thread was never started after a pausable node ran. "
            "Bug 9: pausable=True functions are inoperative under nb run."
        )
        assert nb._pause_poll_thread.is_alive(), (
            "Pause-poll thread exists but is not alive."
        )

        # Give the poll loop one cycle, then flip remote pause state and
        # verify the SDK clears its pause_event within a reasonable window.
        from nebo.core.state import get_state
        state = get_state()
        assert state._pause_event.is_set()  # unpaused initially

        _PauseControllableFakeClient._pause_state = True
        # Poll interval is 0.5s; allow up to 2s for propagation.
        for _ in range(40):
            if not state._pause_event.is_set():
                break
            _time.sleep(0.05)
        assert not state._pause_event.is_set(), (
            "SDK did not observe the remote pause flip within 2s. "
            "Pause-poll thread is not forwarding daemon state into the SDK."
        )

        # Flip back and verify unpause propagates too.
        _PauseControllableFakeClient._pause_state = False
        for _ in range(40):
            if state._pause_event.is_set():
                break
            _time.sleep(0.05)
        assert state._pause_event.is_set(), (
            "SDK did not observe the remote unpause flip within 2s."
        )
