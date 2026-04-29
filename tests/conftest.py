"""Shared pytest configuration.

Two suite-wide invariants:

* ``NEBO_NO_STORE=1`` — the daemon's auto-create and run_start storage paths
  skip the on-disk ``.nebo`` writer. Tests that exercise the file-format
  writer import ``NeboFileWriter`` directly and write to ``tmp_path``.
* ``NEBO_NO_TERMINAL=1`` — ``nb.init()`` skips the Rich live dashboard.
  The dashboard is a background thread that repaints the `Daemon: not
  connected` panel into pytest's captured stdout on every state poll;
  suppressing it keeps test output readable. Tests that specifically
  exercise the display import ``TerminalDisplay`` directly.

Both env vars are set autouse-per-test so ``monkeypatch`` rolls them back
cleanly even after tests that call ``SessionState.reset_singleton()``.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _quiet_nebo(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEBO_NO_STORE", "1")
    monkeypatch.setenv("NEBO_NO_TERMINAL", "1")


class CapturingClient:
    """Stand-in for DaemonClient used by tests that assert on the
    SDK's wire output.

    The SDK no longer keeps metric/image/audio values in process —
    those go straight to ``state._send_to_client``. Tests that need
    to inspect what the SDK *would have sent* attach one of these to
    ``state._client`` and read ``self.events``.
    """

    def __init__(self) -> None:
        self.events: list[dict] = []

    def send_event(self, event: dict) -> None:
        self.events.append(event)

    def is_connected(self) -> bool:
        return True

    def by_type(self, event_type: str) -> list[dict]:
        return [e for e in self.events if e.get("type") == event_type]

    def metrics_named(self, name: str) -> list[dict]:
        return [
            e for e in self.events
            if e.get("type") == "metric" and e.get("name") == name
        ]


@pytest.fixture
def capturing_client():
    """Yield a fresh CapturingClient and wire it onto ``get_state()``.

    After the test, detach the client so other tests aren't affected.
    """
    from nebo.core.state import get_state, SessionState

    SessionState.reset_singleton()
    client = CapturingClient()
    get_state()._client = client
    try:
        yield client
    finally:
        get_state()._client = None
        SessionState.reset_singleton()
