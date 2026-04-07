"""Tests for Q&A chat backend."""

import pytest
from unittest.mock import patch, MagicMock


def test_build_claude_command():
    """Should build correct claude CLI command with MCP config."""
    from nebo.server.chat import build_claude_command

    with patch("shutil.which", return_value="/usr/bin/claude"):
        cmd = build_claude_command(
            question="How did my training go?",
            run_id="run-123",
            server_url="http://localhost:2048",
        )

    assert "claude" in cmd[0]
    assert any("How did my training go?" in arg for arg in cmd)


def test_chat_formats_mcp_config():
    """MCP config should point back to the daemon."""
    from nebo.server.chat import build_mcp_config

    config = build_mcp_config("http://localhost:2048")
    assert "nebo" in str(config).lower()
