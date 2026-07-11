"""tqdm-like iterable progress tracker."""

from __future__ import annotations

import time
from typing import Any, Iterable, Iterator, Optional, TypeVar

from nebo.core.state import NodeInfo, _current_node, get_state

T = TypeVar("T")


class TrackedIterable(Iterator[T]):
    """Wraps an iterable to track progress."""

    def __init__(
        self,
        iterable: Iterable[T],
        name: Optional[str] = None,
        total: Optional[int] = None,
        min_interval: float = 0.1,
    ) -> None:
        self._iterable = iter(iterable)
        self._name = name
        self._total = total
        self._current = 0
        self._start_time = time.monotonic()
        self._node_id = _current_node.get()
        # Wire-emission throttle (tqdm-style): local progress state updates
        # every iteration, but at most one progress *event* per
        # `min_interval` seconds goes to the transport — plus the first and
        # final updates, which always emit. A tight loop over a million
        # items otherwise writes a million frames to disk and the wire.
        self._min_interval = min_interval
        self._last_emit: Optional[float] = None

        # Try to infer total from iterable
        if self._total is None:
            try:
                self._total = len(iterable)  # type: ignore
            except (TypeError, AttributeError):
                pass

        # If not inside a @fn node, create an implicit node
        state = get_state()
        if self._node_id is None and self._name:
            self._node_id = f"_track_{self._name}"
            state.register_node(
                node_id=self._node_id,
                func_name=self._name,
                docstring=f"Tracking progress for {self._name}",
            )

        self._update_progress()

    def __iter__(self) -> Iterator[T]:
        return self

    def __next__(self) -> T:
        try:
            value = next(self._iterable)
            self._current += 1
            self._update_progress()
            return value
        except StopIteration:
            self._update_progress(force=True)
            raise

    def _update_progress(self, force: bool = False) -> None:
        """Update progress state on the current node."""
        if self._node_id is None:
            return
        state = get_state()
        node = state.loggables.get(self._node_id)
        if isinstance(node, NodeInfo):
            node.progress = {
                "current": self._current,
                "total": self._total,
                "name": self._name,
                "elapsed": time.monotonic() - self._start_time,
            }
            now = time.monotonic()
            if not force and self._last_emit is not None and (
                now - self._last_emit
            ) < self._min_interval:
                return
            self._last_emit = now
            # Forward to the daemon client so the web UI shows progress
            # bars in server mode.
            state._send_to_client({
                "type": "progress",
                "loggable_id": self._node_id,
                "data": node.progress,
            })


def track(
    iterable: Iterable[T],
    name: Optional[str] = None,
    total: Optional[int] = None,
    min_interval: float = 0.1,
) -> TrackedIterable[T]:
    """Wrap an iterable to track progress, like tqdm.

    Args:
        iterable: The iterable to wrap.
        name: Display name for the progress bar.
        total: Total number of items (auto-detected if possible).
        min_interval: Minimum seconds between progress events on the
            wire (the first and final updates always emit). Local
            progress state still updates on every iteration.

    Returns:
        A TrackedIterable that reports progress.
    """
    return TrackedIterable(
        iterable, name=name, total=total, min_interval=min_interval,
    )
