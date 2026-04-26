"""Tests for nb.alert() and the webhook alerts subsystem."""

from __future__ import annotations

import json
from unittest.mock import patch

import nebo as nb
from nebo.alerts import AlertLevel, alert
from nebo.core.state import SessionState, get_state


def _reset_state() -> None:
    SessionState.reset_singleton()


class TestAlerts:
    def setup_method(self) -> None:
        _reset_state()

    def test_no_webhook_no_op(self) -> None:
        """alert() with no webhook URL configured is a silent no-op."""
        # Should not raise even without urlopen mocked.
        alert("title", "text", AlertLevel.INFO)

    def test_below_min_level_skips_post(self) -> None:
        """Alerts below webhook_min_level should not POST."""
        state = get_state()
        state.webhook_url = "https://example.com/hook"
        state.webhook_min_level = AlertLevel.WARN

        with patch("nebo.alerts.urllib.request.urlopen") as mock_open:
            alert("title", "text", AlertLevel.INFO)
            assert mock_open.call_count == 0

    def test_at_or_above_min_level_posts(self) -> None:
        """Alerts >= min_level POST a Slack-style payload to the webhook."""
        state = get_state()
        state.webhook_url = "https://example.com/hook"
        state.webhook_min_level = AlertLevel.WARN

        captured = {}

        class _FakeResp:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *args):
                return False

            def read(self_inner):
                return b""

        def _fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["data"] = req.data
            captured["method"] = req.get_method()
            captured["content_type"] = req.headers.get("Content-type")
            return _FakeResp()

        with patch("nebo.alerts.urllib.request.urlopen", side_effect=_fake_urlopen):
            alert("Loss spike", "loss jumped to 9.4", AlertLevel.WARN)

        assert captured["url"] == "https://example.com/hook"
        assert captured["method"] == "POST"
        assert captured["content_type"] == "application/json"
        body = json.loads(captured["data"].decode("utf-8"))
        assert body == {"text": "[WARN] Loss spike\nloss jumped to 9.4"}

    def test_post_failure_swallowed(self) -> None:
        """A failing webhook must not raise out of alert()."""
        state = get_state()
        state.webhook_url = "https://example.com/hook"

        def _boom(req, timeout=None):
            raise OSError("network down")

        with patch("nebo.alerts.urllib.request.urlopen", side_effect=_boom):
            alert("title", "text", AlertLevel.INFO)  # should not raise

    def test_init_threads_through_state(self) -> None:
        """nb.init(webhook_url=, webhook_min_level=) populates SessionState."""
        nb.init(
            mode="local",
            terminal=False,
            webhook_url="https://example.com/hook",
            webhook_min_level=AlertLevel.ERROR,
        )
        state = get_state()
        assert state.webhook_url == "https://example.com/hook"
        assert state.webhook_min_level == int(AlertLevel.ERROR)
