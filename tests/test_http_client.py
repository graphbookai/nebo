# tests/test_http_client.py
import json
from unittest.mock import patch

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


from nebo.client import (
    get_run_history,
    get_run_status,
    get_description,
    get_graph,
    get_loggable_status,
    get_logs,
    get_metrics,
    get_errors,
    load_file,
    _post,
)


def _stub_urlopen(monkeypatch, expected_body: bytes) -> dict:
    captured: dict = {"calls": []}

    class FakeResp:
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def read(self):
            return expected_body

    def fake_urlopen(req, timeout=5.0):
        captured["calls"].append({
            "url": req.full_url,
            "method": req.get_method(),
            "data": req.data,
            "headers": dict(req.header_items()),
        })
        return FakeResp()

    monkeypatch.setattr("nebo.client.urllib.request.urlopen", fake_urlopen)
    return captured


def test_get_run_history_hits_runs_endpoint(monkeypatch):
    cap = _stub_urlopen(monkeypatch, b'{"runs": []}')
    result = get_run_history(url="http://h")
    assert result == {"runs": []}
    assert cap["calls"][0]["url"] == "http://h/runs"


def test_get_metrics_passes_filter_query_params(monkeypatch):
    cap = _stub_urlopen(monkeypatch, b'{"metrics": {}}')
    get_metrics(
        "node_a",
        name="loss",
        tag="train",
        step=5,
        run_id="abc123",
        url="http://h",
    )
    qs = cap["calls"][0]["url"].split("?", 1)[1]
    parts = dict(p.split("=", 1) for p in qs.split("&"))
    assert parts["name"] == "loss"
    assert parts["tag"] == "train"
    assert parts["step"] == "5"


def test_get_logs_run_scoped(monkeypatch):
    cap = _stub_urlopen(monkeypatch, b'{"logs": []}')
    get_logs(run_id="abc", url="http://h")
    assert cap["calls"][0]["url"] == "http://h/runs/abc/logs"


def test_post_sends_json_body(monkeypatch):
    cap = _stub_urlopen(monkeypatch, b'{"status": "ok"}')
    result = _post("/events", [{"type": "metric"}], url="http://h", api_token="t")
    assert result == {"status": "ok"}
    assert cap["calls"][0]["method"] == "POST"
    assert json.loads(cap["calls"][0]["data"]) == [{"type": "metric"}]
    assert cap["calls"][0]["headers"]["Content-type"] == "application/json"
    assert cap["calls"][0]["headers"]["X-nebo-token"] == "t"


def test_load_file_posts_filepath(monkeypatch):
    cap = _stub_urlopen(monkeypatch, b'{"status": "loaded"}')
    load_file("/tmp/x.nebo", url="http://h")
    assert cap["calls"][0]["url"] == "http://h/load"
    assert json.loads(cap["calls"][0]["data"]) == {"filepath": "/tmp/x.nebo"}
