# tests/test_http_client.py
import json
from unittest.mock import patch, MagicMock

from nebo.client import _resolve_url, _get


def test_resolve_url_prefers_explicit_url():
    assert _resolve_url(url="http://example.test:1234") == "http://example.test:1234"


def test_resolve_url_uses_port_when_no_url():
    assert _resolve_url(port=9999) == "http://localhost:9999"


def test_resolve_url_reads_env(monkeypatch):
    monkeypatch.setenv("NEBO_URL", "http://daemon.local")
    assert _resolve_url() == "http://daemon.local"


def test_resolve_url_defaults(monkeypatch):
    # No args, no env (NEBO_URL/NEBO_PORT unset via monkeypatch).
    monkeypatch.delenv("NEBO_URL", raising=False)
    monkeypatch.delenv("NEBO_PORT", raising=False)
    assert _resolve_url() == "http://localhost:7861"


def test_get_sends_auth_header_when_token_set(monkeypatch):
    captured: dict = {}

    class FakeResp:
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def read(self):
            return b'{"ok": true}'

    def fake_urlopen(req, timeout=5.0):
        captured["url"] = req.full_url
        captured["headers"] = dict(req.header_items())
        return FakeResp()

    with patch("nebo.client.urllib.request.urlopen", fake_urlopen):
        result = _get("/health", url="http://h", api_token="secret")

    assert result == {"ok": True}
    assert captured["url"] == "http://h/health"
    assert captured["headers"].get("X-nebo-token") == "secret"
