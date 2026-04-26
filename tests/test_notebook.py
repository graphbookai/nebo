"""Tests for nb.show() — the notebook iframe renderable."""

from __future__ import annotations

import pytest

import nebo as nb
from nebo.core.state import SessionState, get_state


def _reset() -> None:
    SessionState.reset_singleton()


class TestShow:
    def setup_method(self) -> None:
        _reset()

    def test_no_active_run_returns_hint(self) -> None:
        handle = nb.show()
        assert handle.url is None
        html = handle._repr_html_()
        assert "No active run" in html
        # Doesn't render an iframe.
        assert "<iframe" not in html

    def test_default_url_for_active_run(self) -> None:
        state = get_state()
        state._active_run_id = "abc123"
        handle = nb.show()
        assert handle.url is not None
        assert "view=run" in handle.url
        assert "run=abc123" in handle.url
        assert "<iframe" in handle._repr_html_()

    def test_view_node_with_filters(self) -> None:
        state = get_state()
        state._active_run_id = "r1"
        handle = nb.show(view="node", node="train")
        assert handle.url is not None
        assert "view=node" in handle.url
        assert "node=train" in handle.url

    def test_view_metric_with_name(self) -> None:
        state = get_state()
        state._active_run_id = "r1"
        handle = nb.show(view="metrics", node="train", name="loss")
        assert "view=metrics" in handle.url
        assert "node=train" in handle.url
        assert "name=loss" in handle.url

    def test_invalid_view_raises(self) -> None:
        state = get_state()
        state._active_run_id = "r1"
        with pytest.raises(ValueError):
            nb.show(view="bogus")

    def test_explicit_run_overrides_active(self) -> None:
        state = get_state()
        state._active_run_id = "active"
        handle = nb.show(run="other")
        assert "run=other" in handle.url

    def test_iframe_dimensions(self) -> None:
        state = get_state()
        state._active_run_id = "r1"
        handle = nb.show(width=800, height=400)
        html = handle._repr_html_()
        assert 'width="800px"' in html
        assert 'height="400px"' in html

    def test_url_uses_state_port(self) -> None:
        state = get_state()
        state._active_run_id = "r1"
        state.port = 9999
        handle = nb.show()
        assert "http://localhost:9999/" in handle.url
