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


class TestRunnerModule:
    """Tests for the PipelineRunner."""

    def test_runner_import(self) -> None:
        """PipelineRunner should be importable."""
        from nebo.server.runner import PipelineRunner
        runner = PipelineRunner()
        assert runner is not None

    def test_runner_not_running(self) -> None:
        """is_running should return False for unknown run IDs."""
        from nebo.server.runner import PipelineRunner
        runner = PipelineRunner()
        assert runner.is_running("nonexistent") is False

    def test_runner_stop_unknown(self) -> None:
        """stop() should return None for unknown run IDs."""
        from nebo.server.runner import PipelineRunner
        runner = PipelineRunner()
        assert runner.stop("nonexistent") is None


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
        lambda **c: {"runs": [{"id": "abc", "status": "completed"}]},
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
