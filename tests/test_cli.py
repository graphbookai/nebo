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
        """nb mcp should output valid JSON config."""
        args = argparse.Namespace(port=2048)
        cmd_mcp(args)
        config = self._parse_mcp_config(capsys.readouterr().out)
        assert "mcpServers" in config
        assert "nebo" in config["mcpServers"]
        assert config["mcpServers"]["nebo"]["command"] == "nb"
        assert "mcp-stdio" in config["mcpServers"]["nebo"]["args"]

    def test_mcp_default_port_omits_port_flag(self, capsys: pytest.CaptureFixture) -> None:
        """At the default port, --port should NOT appear in args (keeps output minimal)."""
        args = argparse.Namespace(port=2048)
        cmd_mcp(args)
        config = self._parse_mcp_config(capsys.readouterr().out)
        nebo_args = config["mcpServers"]["nebo"]["args"]
        assert "--port" not in nebo_args

    def test_mcp_custom_port_forwarded_to_args(self, capsys: pytest.CaptureFixture) -> None:
        """`nb mcp --port 9000` must embed --port 9000 in the printed MCP config.

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
