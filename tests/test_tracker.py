"""Tests for the progress tracker."""

from __future__ import annotations

import pytest

from nebo.core.state import SessionState, get_state
from nebo.core.tracker import track
from nebo.core.decorators import fn


class TestTracker:
    """Tests for nb.track() iterable wrapper."""

    def setup_method(self) -> None:
        SessionState.reset_singleton()

    def test_track_iterates_all_items(self) -> None:
        """track() should yield all items from the iterable."""
        items = list(track([1, 2, 3, 4, 5], name="test"))
        assert items == [1, 2, 3, 4, 5]

    def test_track_infers_total_from_list(self) -> None:
        """track() should auto-detect total from a list."""
        data = [10, 20, 30]
        tracker = track(data, name="sized")
        assert tracker._total == 3

    def test_track_handles_generator(self) -> None:
        """track() should work with generators (no total)."""
        def gen():
            yield 1
            yield 2
            yield 3

        items = list(track(gen(), name="gen"))
        assert items == [1, 2, 3]

    def test_track_updates_progress(self) -> None:
        """track() should update progress on the bound node."""
        @fn()
        def process_data():
            results = []
            for item in track([1, 2, 3], name="data"):
                results.append(item)
            return results

        result = process_data()
        assert result == [1, 2, 3]

    def test_track_with_explicit_total(self) -> None:
        """track() should accept an explicit total."""
        def gen():
            yield "a"
            yield "b"

        tracker = track(gen(), name="explicit", total=2)
        assert tracker._total == 2
        items = list(tracker)
        assert items == ["a", "b"]

    def test_track_creates_implicit_node(self) -> None:
        """track() at top level should create an implicit node."""
        items = list(track([1, 2], name="toplevel"))
        state = get_state()
        assert any("toplevel" in nid for nid in state.nodes)


class _EventCapturingClient:
    """Minimal fake for SessionState._client used to capture forwarded events."""

    def __init__(self) -> None:
        self.events: list[dict] = []
        self._connected = True
        self._run_id = "test_run"

    def send_event(self, event: dict) -> None:
        self.events.append(event)

    def is_connected(self) -> bool:
        return self._connected


class TestTrackerProgressForwarding:
    """nb.track() progress updates must also reach the daemon client.

    Regression for the dead `state._queue.put_event(...)` path: the
    tracker previously only published progress to `state._queue` which
    is always None, so the UI never got progress events in server mode.
    """

    def setup_method(self) -> None:
        SessionState.reset_singleton()

    def test_progress_forwarded_to_client_inside_fn(self) -> None:
        """Each iteration of a tracked iterable inside @nb.fn emits a progress event."""
        state = get_state()
        client = _EventCapturingClient()
        state._client = client

        @fn()
        def do_work():
            for _ in track([1, 2, 3], name="work"):
                pass

        do_work()

        progress_events = [e for e in client.events if e.get("type") == "progress"]
        assert len(progress_events) >= 3, (
            f"expected >= 3 progress events, got {len(progress_events)}: "
            f"{[e.get('type') for e in client.events]}"
        )
        last = progress_events[-1]["data"]
        assert last["current"] == 3
        assert last["total"] == 3
        assert last["name"] == "work"
