"""Shared pytest configuration.

Suite-wide invariants:
* NEBO_NO_STORE=1 — SDK file mode opens no file; daemon save-files path
  is gated by --save-files flags so tests don't litter the working dir.
* NEBO_QUIET=1 — suppress the startup banner so pytest's stdout capture
  stays focused on what each test prints.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _quiet_nebo(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEBO_NO_STORE", "1")
    monkeypatch.setenv("NEBO_QUIET", "1")


class CapturingClient:
    """Stand-in transport used by tests that assert on the SDK's wire output."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    def send_event(self, event: dict) -> None:
        self.events.append(event)

    def flush(self, timeout: float = 5.0) -> bool:
        return True

    def close(self) -> None:
        pass

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
    from nebo.core.state import get_state, SessionState

    SessionState.reset_singleton()
    client = CapturingClient()
    get_state()._transport = client
    try:
        yield client
    finally:
        get_state()._transport = None
        SessionState.reset_singleton()
