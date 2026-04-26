"""Webhook-based alerts.

Pipelines call ``nb.alert(title, text, level=...)`` to fire a notification at a
webhook URL configured in ``nb.init(webhook_url=..., webhook_min_level=...)``.

The payload is Slack-compatible (``{"text": "..."}``), which works directly with
Slack incoming webhooks and most generic receivers (Discord with
``?slack=true``, ntfy, etc).

Alerts are best-effort: HTTP failures are logged and swallowed so a flaky
webhook never breaks the pipeline.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from enum import IntEnum
from typing import Optional

from nebo.core.state import get_state

logger = logging.getLogger(__name__)


class AlertLevel(IntEnum):
    """Severity levels for alerts. Numeric values match stdlib ``logging``."""
    DEBUG = 10
    INFO = 20
    WARN = 30
    ERROR = 40


def alert(title: str, text: str = "", level: AlertLevel = AlertLevel.INFO) -> None:
    """Fire an alert at the configured webhook.

    No-op if no webhook URL is configured or ``level`` is below
    ``webhook_min_level``.

    Args:
        title: Short headline shown first in the message.
        text: Optional body / details.
        level: ``AlertLevel.DEBUG/INFO/WARN/ERROR``.
    """
    state = get_state()
    url: Optional[str] = getattr(state, "webhook_url", None)
    if not url:
        return
    min_level = getattr(state, "webhook_min_level", AlertLevel.INFO)
    if int(level) < int(min_level):
        return

    level_name = AlertLevel(int(level)).name if int(level) in AlertLevel._value2member_map_ else str(level)
    body = title if not text else f"{title}\n{text}"
    payload = {"text": f"[{level_name}] {body}"}

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            resp.read()
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        logger.warning("nebo alert webhook failed: %s", exc)
