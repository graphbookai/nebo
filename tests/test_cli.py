"""Tests for the CLI module."""

from __future__ import annotations

import argparse
import json

import pytest

from nebo.cli import cmd_mcp


class TestCLI:
    """Tests for CLI commands."""

    def _parse_mcp_config(self, captured: str) -> dict:
        lines = captured.strip().split("\n")
        assert lines[0].startswith("#")
        return json.loads("\n".join(lines[1:]))

    def test_mcp_outputs_valid_json(self, capsys: pytest.CaptureFixture) -> None:
        """nebo mcp should output valid JSON config."""
        args = argparse.Namespace(port=7861)
        cmd_mcp(args)
        config = self._parse_mcp_config(capsys.readouterr().out)
        assert "mcpServers" in config
        assert "nebo" in config["mcpServers"]
        assert config["mcpServers"]["nebo"]["command"] == "nebo"
        assert "mcp-stdio" in config["mcpServers"]["nebo"]["args"]

    def test_mcp_default_port_omits_port_flag(self, capsys: pytest.CaptureFixture) -> None:
        """At the default port, --port should NOT appear in args (keeps output minimal)."""
        args = argparse.Namespace(port=7861)
        cmd_mcp(args)
        config = self._parse_mcp_config(capsys.readouterr().out)
        nebo_args = config["mcpServers"]["nebo"]["args"]
        assert "--port" not in nebo_args

    def test_mcp_custom_port_forwarded_to_args(self, capsys: pytest.CaptureFixture) -> None:
        """`nebo mcp --port 9000` must embed --port 9000 in the printed MCP config.

        Without this, a daemon on a non-default port is unreachable from
        the MCP server the printed config instantiates.
        """
        args = argparse.Namespace(port=9000)
        cmd_mcp(args)
        config = self._parse_mcp_config(capsys.readouterr().out)
        nebo_args = config["mcpServers"]["nebo"]["args"]
        assert nebo_args == ["mcp-stdio", "--port", "9000"]


class TestLoadRemote:
    """`nebo load --url ...` reads the file locally and replays its
    events through /events on the remote daemon — covers the case
    where the daemon (e.g. a Hugging Face Space) can't see the user's
    filesystem so the legacy POST /load with a server-side path won't
    work."""

    def test_replay_pushes_events_to_remote(self, tmp_path, monkeypatch) -> None:
        from fastapi.testclient import TestClient
        from nebo.server.daemon import DaemonState, create_daemon_app
        from nebo.core.fileformat import NeboFileWriter
        from nebo.cli import _replay_nebo_file_to_remote

        # Write a small .nebo file with one node + two metric points.
        run_id = "replay_test_run"
        nebo_path = tmp_path / "sample.nebo"
        with nebo_path.open("wb") as f:
            writer = NeboFileWriter(f, run_id=run_id, script_path="x.py", args=[])
            writer.write_header()
            writer.write_entry("loggable_register", {
                "loggable_id": "train", "kind": "node", "func_name": "train",
            })
            writer.write_entry("metric", {
                "loggable_id": "train", "name": "loss",
                "metric_type": "line", "value": 0.9, "step": 0, "tags": [],
            })
            writer.write_entry("metric", {
                "loggable_id": "train", "name": "loss",
                "metric_type": "line", "value": 0.4, "step": 1, "tags": [],
            })
            writer.close()

        # Stand up a TestClient daemon and proxy urllib through it so
        # the replay path doesn't actually hit the network.
        state = DaemonState()
        client = TestClient(create_daemon_app(state=state))

        import urllib.request

        class FakeResp:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): pass
            def read(self): return b""

        def fake_urlopen(req, timeout=None):
            # TestClient understands relative paths only; strip the
            # base URL we pass to the replay helper.
            assert req.full_url.startswith("http://daemon")
            path = req.full_url[len("http://daemon"):]
            resp = client.post(
                path, content=req.data,
                headers=dict(req.headers),
            )
            assert resp.status_code == 200, resp.text
            return FakeResp()

        monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

        _replay_nebo_file_to_remote(str(nebo_path), "http://daemon", api_token=None)

        # Confirm the run + metric landed in the daemon's state.
        assert run_id in state.runs
        run = state.runs[run_id]
        assert "train" in run.loggables
        loss = run.loggables["train"].metrics["loss"]
        assert [e["value"] for e in loss["entries"]] == [0.9, 0.4]


# ---------------------------------------------------------------------------
# nebo runs list|show|wait
# ---------------------------------------------------------------------------

import io
from contextlib import redirect_stdout
from unittest.mock import patch


def _run_cli(argv: list[str]) -> str:
    """Run nebo.cli.main with argv (excluding the program name) and return stdout."""
    buf = io.StringIO()
    from nebo.cli import main
    with redirect_stdout(buf), patch("sys.argv", ["nebo"] + argv):
        main()
    return buf.getvalue()


def test_runs_list_json(monkeypatch):
    monkeypatch.setattr(
        "nebo.client.get_run_history",
        lambda **c: {"runs": [{"id": "abc", "run_name": "exp1"}]},
    )
    out = _run_cli(["runs", "list", "--json"])
    assert json.loads(out)["runs"][0]["id"] == "abc"


def test_runs_show_json(monkeypatch):
    monkeypatch.setattr(
        "nebo.client.get_run_status",
        lambda rid, **c: {"id": rid, "node_count": 3},
    )
    out = _run_cli(["runs", "show", "abc", "--json"])
    assert json.loads(out) == {"id": "abc", "node_count": 3}


def test_runs_wait_passes_args(monkeypatch):
    received: dict = {}
    def fake_wait(run_id, **kwargs):
        received["run_id"] = run_id
        received.update(kwargs)
        return {"status": "alert", "alert": {"title": "x"}}
    monkeypatch.setattr("nebo.client.wait_for_alert", fake_wait)
    out = _run_cli(["runs", "wait", "abc", "--timeout", "10", "--min-level", "30", "--json"])
    assert json.loads(out)["status"] == "alert"
    assert received["run_id"] == "abc"
    assert received["timeout"] == 10.0
    assert received["min_level"] == 30


# ---------------------------------------------------------------------------
# nebo graph show | loggables show | describe
# ---------------------------------------------------------------------------


def test_graph_show_json(monkeypatch):
    monkeypatch.setattr(
        "nebo.client.get_graph",
        lambda **c: {"nodes": {"a": {}}, "edges": []},
    )
    out = _run_cli(["graph", "show", "--run", "abc", "--json"])
    parsed = json.loads(out)
    assert "nodes" in parsed
    assert "edges" in parsed


def test_loggables_show_json(monkeypatch):
    monkeypatch.setattr(
        "nebo.client.get_loggable_status",
        lambda lid, **c: {"loggable_id": lid, "kind": "node"},
    )
    out = _run_cli(["loggables", "show", "node_a", "--run", "abc", "--json"])
    assert json.loads(out)["loggable_id"] == "node_a"


def test_describe_json(monkeypatch):
    monkeypatch.setattr(
        "nebo.client.get_description",
        lambda **c: {"workflow_description": "hello"},
    )
    out = _run_cli(["describe", "--json"])
    assert json.loads(out)["workflow_description"] == "hello"


# ---------------------------------------------------------------------------
# nebo metrics list|get|log
# ---------------------------------------------------------------------------


def test_metrics_get_passes_filters(monkeypatch):
    received: dict = {}
    def fake(lid, **kw):
        received["loggable_id"] = lid
        received.update(kw)
        return {"loggable_id": lid, "metrics": {"loss": {"type": "line", "entries": []}}}
    monkeypatch.setattr("nebo.client.get_metrics", fake)
    _run_cli([
        "metrics", "get", "node_a",
        "--name", "loss",
        "--tag", "train",
        "--step", "5",
        "--run", "abc",
        "--json",
    ])
    assert received["loggable_id"] == "node_a"
    assert received["name"] == "loss"
    assert received["tag"] == "train"
    assert received["step"] == 5
    assert received["run_id"] == "abc"


def test_metrics_get_values_only_emits_entries(monkeypatch):
    entries = [
        {"step": 0, "value": 1.0, "tags": [], "timestamp": 1.0},
        {"step": 1, "value": 0.5, "tags": [], "timestamp": 2.0},
    ]
    monkeypatch.setattr(
        "nebo.client.get_metrics",
        lambda lid, **kw: {"metrics": {"loss": {"type": "line", "entries": entries}}},
    )
    out = _run_cli([
        "metrics", "get", "node_a", "--name", "loss", "--values-only", "--json",
    ])
    assert json.loads(out) == entries


def test_metrics_get_values_only_requires_name(monkeypatch):
    monkeypatch.setattr("nebo.client.get_metrics", lambda lid, **kw: {"metrics": {}})
    with pytest.raises(SystemExit):
        _run_cli(["metrics", "get", "node_a", "--values-only", "--json"])


def test_metrics_get_cross_run_fanout(monkeypatch):
    calls: list = []
    def fake(lid, **kw):
        calls.append(kw.get("run_id"))
        return {"metrics": {"loss": {"type": "line", "entries": [
            {"step": 0, "value": float(len(calls)), "tags": [], "timestamp": 0.0},
        ]}}}
    monkeypatch.setattr("nebo.client.get_metrics", fake)
    out = _run_cli([
        "metrics", "get", "node_a", "--name", "loss",
        "--runs", "r1,r2,r3", "--values-only", "--json",
    ])
    data = json.loads(out)
    assert calls == ["r1", "r2", "r3"]
    assert set(data["runs"]) == {"r1", "r2", "r3"}
    assert data["runs"]["r1"][0]["value"] == 1.0
    assert data["name"] == "loss"


# ---------------------------------------------------------------------------
# nebo alerts ls|get|set|rm
# ---------------------------------------------------------------------------


def test_alerts_set_parses_condition(monkeypatch):
    received: dict = {}
    def fake(title, condition, **kw):
        received["title"] = title
        received["condition"] = condition
        received.update(kw)
        return {"id": "abc12345", "title": title}
    monkeypatch.setattr("nebo.client.set_alert", fake)
    _run_cli([
        "alerts", "set",
        "--title", "loss diverged",
        "--condition", "train/loss > 5",
        "--level", "WARN",
        "--loggable", "__global__",
        "--run", "r1",
        "--json",
    ])
    assert received["title"] == "loss diverged"
    assert received["condition"] == {"metric": "train/loss", "op": ">", "value": 5.0}
    assert received["level"] == 30
    assert received["loggable_id"] == "__global__"
    assert received["run_id"] == "r1"


def test_alerts_set_rejects_bad_condition(monkeypatch):
    monkeypatch.setattr("nebo.client.set_alert", lambda *a, **k: {})
    with pytest.raises(SystemExit):
        _run_cli(["alerts", "set", "--title", "t", "--condition", "loss soars"])


def test_alerts_ls_json(monkeypatch):
    monkeypatch.setattr(
        "nebo.client.list_alerts",
        lambda **kw: {"alerts": [{"id": "a1", "triggered_by": "cli", "title": "t"}]},
    )
    out = _run_cli(["alerts", "ls", "--json"])
    assert json.loads(out)["alerts"][0]["id"] == "a1"


def test_alerts_rm(monkeypatch):
    received: dict = {}
    def fake(rule_id, **kw):
        received["rule_id"] = rule_id
        return {"status": "deleted", "id": rule_id}
    monkeypatch.setattr("nebo.client.delete_alert", fake)
    out = _run_cli(["alerts", "rm", "a1", "--json"])
    assert received["rule_id"] == "a1"
    assert json.loads(out)["status"] == "deleted"


def test_metrics_log_passes_entries(monkeypatch):
    received: dict = {}
    def fake(entries, **kw):
        received["entries"] = entries
        received.update(kw)
        return {"status": "ok"}
    monkeypatch.setattr("nebo.client.log_metric", fake)
    payload = '[{"name":"x","value":0.1,"type":"line"}]'
    _run_cli(["metrics", "log", "--entries-json", payload, "--run", "abc", "--json"])
    assert received["entries"] == [{"name": "x", "value": 0.1, "type": "line"}]
    assert received["run_id"] == "abc"


def test_metrics_list_derives_from_run_status(monkeypatch):
    monkeypatch.setattr(
        "nebo.client.get_run_status",
        lambda rid, **c: {"metrics_index": {"node_a": ["loss", "accuracy"]}},
    )
    out = _run_cli(["metrics", "list", "--run", "abc", "--json"])
    parsed = json.loads(out)
    assert parsed["node_a"] == ["loss", "accuracy"]


# ---------------------------------------------------------------------------
# nebo text log | images log | audio log
# ---------------------------------------------------------------------------


def test_text_log_passes_entries(monkeypatch):
    received: dict = {}

    def fake_log_text(entries, **kw):
        received["entries"] = entries
        received.update(kw)
        return {"status": "ok"}

    monkeypatch.setattr("nebo.client.log_text", fake_log_text)
    _run_cli([
        "text", "log",
        "--entries-json", '[{"message":"hello"}]',
        "--run", "abc",
        "--json",
    ])
    assert received["entries"] == [{"message": "hello"}]
    assert received["run_id"] == "abc"


def test_images_log_passes_entries(monkeypatch, tmp_path):
    f = tmp_path / "x.png"
    f.write_bytes(b"PNGfake")
    received: dict = {}
    monkeypatch.setattr(
        "nebo.client.log_image",
        lambda entries, **kw: received.setdefault("entries", entries) or {"status": "ok"},
    )
    _run_cli([
        "images", "log",
        "--entries-json", json.dumps([{"name": "x", "path": str(f)}]),
        "--run", "abc",
        "--json",
    ])
    assert received["entries"][0]["path"] == str(f)


def test_audio_log_passes_entries(monkeypatch, tmp_path):
    f = tmp_path / "x.wav"
    f.write_bytes(b"RIFFfake")
    received: dict = {}
    monkeypatch.setattr(
        "nebo.client.log_audio",
        lambda entries, **kw: received.setdefault("entries", entries) or {"status": "ok"},
    )
    _run_cli([
        "audio", "log",
        "--entries-json", json.dumps([{"name": "snd", "path": str(f)}]),
        "--run", "abc",
        "--json",
    ])
    assert received["entries"][0]["name"] == "snd"


# ---------------------------------------------------------------------------
# nebo logs | errors | load | status  (Task 20 — --json + nebo.client routing)
# ---------------------------------------------------------------------------


def test_logs_json(monkeypatch):
    monkeypatch.setattr(
        "nebo.client.get_logs",
        lambda **c: {"logs": [{"timestamp": 1, "loggable_id": "n", "message": "m"}]},
    )
    out = _run_cli(["logs", "--json"])
    assert json.loads(out)["logs"][0]["message"] == "m"


def test_logs_human(monkeypatch, capsys):
    monkeypatch.setattr(
        "nebo.client.get_logs",
        lambda **c: {"logs": [{"loggable_id": "node_a", "message": "hello"}]},
    )
    buf = io.StringIO()
    with redirect_stdout(buf), patch("sys.argv", ["nebo", "logs"]):
        from nebo.cli import main
        main()
    out = buf.getvalue()
    assert "hello" in out
    assert "[node_a]" in out


def test_logs_no_logs(monkeypatch):
    monkeypatch.setattr(
        "nebo.client.get_logs",
        lambda **c: {"logs": []},
    )
    out = _run_cli(["logs"])
    assert "No logs found" in out


def test_errors_json(monkeypatch):
    monkeypatch.setattr(
        "nebo.client.get_errors",
        lambda **c: {"errors": []},
    )
    out = _run_cli(["errors", "--json"])
    assert json.loads(out) == {"errors": []}


def test_errors_human(monkeypatch):
    monkeypatch.setattr(
        "nebo.client.get_errors",
        lambda **c: {
            "errors": [{"node_name": "train", "exception_type": "ValueError", "exception_message": "bad"}]
        },
    )
    out = _run_cli(["errors"])
    assert "train" in out
    assert "ValueError" in out


def test_load_json(monkeypatch, tmp_path):
    f = tmp_path / "x.nebo"
    f.write_bytes(b"fake")
    monkeypatch.setattr(
        "nebo.client.load_file",
        lambda fp, **c: {"status": "loaded", "filepath": fp},
    )
    out = _run_cli(["load", str(f), "--json"])
    parsed = json.loads(out)
    assert parsed["status"] == "loaded"


def test_load_human(monkeypatch, tmp_path):
    f = tmp_path / "y.nebo"
    f.write_bytes(b"fake")
    monkeypatch.setattr(
        "nebo.client.load_file",
        lambda fp, **c: {"run_id": "abc"},
    )
    out = _run_cli(["load", str(f)])
    assert "Loaded" in out


def test_status_json(monkeypatch):
    monkeypatch.setattr(
        "nebo.client.get_run_history",
        lambda **c: {"runs": [{"id": "r1", "status": "completed", "script_path": "x.py"}]},
    )
    out = _run_cli(["status", "--json"])
    parsed = json.loads(out)
    assert parsed["daemon"] == "running"
    assert parsed["runs"][0]["id"] == "r1"


def test_status_daemon_down(monkeypatch):
    def boom(**c):
        raise ConnectionError("refused")

    monkeypatch.setattr("nebo.client.get_run_history", boom)
    out = _run_cli(["status"])
    assert "not running" in out


def test_logs_passes_run_and_node(monkeypatch):
    received: dict = {}

    def fake_get_logs(**c):
        received.update(c)
        return {"logs": []}

    monkeypatch.setattr("nebo.client.get_logs", fake_get_logs)
    _run_cli(["logs", "--run", "r1", "--node", "train", "--limit", "5"])
    assert received["run_id"] == "r1"
    assert received["loggable_id"] == "train"
    assert received["limit"] == 5


def test_errors_passes_run(monkeypatch):
    received: dict = {}

    def fake_get_errors(**c):
        received.update(c)
        return {"errors": []}

    monkeypatch.setattr("nebo.client.get_errors", fake_get_errors)
    _run_cli(["errors", "--run", "r2"])
    assert received["run_id"] == "r2"


# ---------------------------------------------------------------------------
# nebo serve new flags
# ---------------------------------------------------------------------------

from contextlib import redirect_stderr


def _run_cli_with_stderr(argv: list[str]) -> tuple[int, str]:
    """Invoke nebo.cli.main with argv (no program name); return (exit_code, stderr)."""
    from nebo.cli import main
    err = io.StringIO()
    code = 0
    with redirect_stderr(err), patch("sys.argv", ["nebo"] + argv):
        try:
            main()
        except SystemExit as e:
            code = int(e.code or 0)
    return code, err.getvalue()


def test_serve_refuses_same_logdir_and_save_files(tmp_path, monkeypatch):
    # Stub out the "is a daemon already running" probe so this test isn't
    # affected by a developer who happens to have `nebo serve` running on
    # the default port — cmd_serve short-circuits with "already running"
    # before reaching the conflict check otherwise.
    monkeypatch.setattr("nebo.cli._is_alive", lambda port: False)
    code, err = _run_cli_with_stderr([
        "serve",
        "--logdir", str(tmp_path),
        "--save-files", str(tmp_path),
    ])
    assert code == 2
    assert "cannot be the same directory" in err


def test_serve_rejects_removed_no_store():
    code, err = _run_cli_with_stderr(["serve", "--no-store"])
    # argparse rejects unknown --no-store. Either exit 2 with argparse
    # error, or exit 2 with our explicit removal-error message.
    assert code == 2
