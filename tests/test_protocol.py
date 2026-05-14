"""Tests for nebo protocol."""

from nebo.server.protocol import MessageType


def test_alert_is_a_known_message_type():
    assert MessageType.ALERT.value == "alert"
