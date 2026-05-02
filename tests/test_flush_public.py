"""Tests for the public nb.flush() helper in nebo/__init__.py."""

from __future__ import annotations

import nebo as nb
from nebo.core.state import get_state


def test_returns_true_when_no_client(monkeypatch) -> None:
    """In local mode (no daemon client), flush is a no-op returning True."""
    state = get_state()
    monkeypatch.setattr(state, "_client", None)
    assert nb.flush() is True
    assert nb.flush(timeout=10.0) is True


def test_delegates_to_client_flush_with_timeout(monkeypatch) -> None:
    state = get_state()

    class FakeClient:
        def __init__(self) -> None:
            self.calls: list[float] = []

        def flush(self, timeout: float = 5.0) -> bool:
            self.calls.append(timeout)
            return True

    fake = FakeClient()
    monkeypatch.setattr(state, "_client", fake)

    assert nb.flush(timeout=3.0) is True
    assert fake.calls == [3.0]


def test_propagates_false_return(monkeypatch) -> None:
    state = get_state()

    class FailingClient:
        def flush(self, timeout: float = 5.0) -> bool:
            return False

    monkeypatch.setattr(state, "_client", FailingClient())

    assert nb.flush() is False


def test_default_timeout_matches_public_default(monkeypatch) -> None:
    """nb.flush() with no args should pass the public default (5.0) to
    the client, not rely on the client's own default."""
    state = get_state()

    class FakeClient:
        def __init__(self) -> None:
            self.last_timeout: float | None = None

        def flush(self, timeout: float = 999.0) -> bool:
            self.last_timeout = timeout
            return True

    fake = FakeClient()
    monkeypatch.setattr(state, "_client", fake)

    nb.flush()
    assert fake.last_timeout == 5.0
