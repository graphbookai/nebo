"""Tests for MCP tools."""

from __future__ import annotations

import pytest

from nebo.core.state import SessionState


class TestMCPToolNames:
    """Tests for MCP tool naming convention."""

    def test_all_tool_names_use_nebo_prefix(self) -> None:
        """All MCP tools should use nebo_ prefix, not graphbook_."""
        from nebo.mcp.server import MCP_TOOLS
        for tool in MCP_TOOLS:
            assert tool["name"].startswith("nebo_"), f"Tool {tool['name']} should start with nebo_"
            assert "graphbook" not in tool["name"], f"Tool {tool['name']} still contains graphbook"

    def test_dispatcher_handles_nebo_prefixed_tools(self) -> None:
        """handle_tool_call should recognize nebo_ prefixed tool names."""
        from nebo.mcp.server import handle_tool_call
        import asyncio
        # This should not return "Unknown tool" error
        result = asyncio.get_event_loop().run_until_complete(
            handle_tool_call("nebo_get_run_history", {}, "http://localhost:19999")
        )
        # It may fail to connect, but should not say "Unknown tool"
        assert "Unknown tool" not in str(result.get("error", ""))


class TestMCPObservationTools:
    """Tests for MCP observation tools against in-process state."""

    def setup_method(self) -> None:
        SessionState.reset_singleton()

    @pytest.mark.asyncio
    async def test_get_description_daemon_unreachable(self) -> None:
        """When the daemon is down, observation tools surface that
        explicitly. The MCP bridge runs in its own process and cannot
        reach the user's pipeline SDK state, so there's no fallback to
        substitute."""
        from nebo.mcp.tools import get_description

        result = await get_description(server_url="http://localhost:19999")
        assert "error" in result
        assert "daemon unreachable" in result["error"]
        assert "hint" in result

    @pytest.mark.asyncio
    async def test_get_metrics_not_found(self) -> None:
        """Should return error when loggable not found."""
        from nebo.mcp.tools import get_metrics
        result = await get_metrics("nonexistent_loggable")
        assert "error" in result

    @pytest.mark.asyncio
    async def test_get_loggable_status_not_found(self) -> None:
        """get_loggable_status should return error when loggable missing."""
        from nebo.mcp.tools import get_loggable_status
        result = await get_loggable_status("nonexistent", server_url="http://localhost:19999")
        assert "error" in result

    @pytest.mark.asyncio
    async def test_get_logs_accepts_loggable_id_kwarg(self) -> None:
        """get_logs should accept loggable_id= filter keyword."""
        from nebo.mcp.tools import get_logs
        result = await get_logs(loggable_id="some_id", server_url="http://localhost:19999")
        # Should not raise; structure returns {"logs": [...]}
        assert "logs" in result or "error" in result

    def test_mcp_server_registers_loggable_status_tool(self) -> None:
        """MCP_TOOLS should expose nebo_get_loggable_status (renamed from nebo_get_node_status)."""
        from nebo.mcp.server import MCP_TOOLS
        names = [t["name"] for t in MCP_TOOLS]
        assert "nebo_get_loggable_status" in names
        assert "nebo_get_node_status" not in names


class TestMCPActionTools:
    """Tests for MCP action tools."""

    @pytest.mark.asyncio
    async def test_get_source_code_not_found(self) -> None:
        """Should return error for nonexistent file."""
        from nebo.mcp.tools import get_source_code
        result = await get_source_code("/nonexistent/path.py")
        assert "error" in result

    @pytest.mark.asyncio
    async def test_get_source_code_reads_file(self, tmp_path) -> None:
        """Should read an existing file."""
        from nebo.mcp.tools import get_source_code
        f = tmp_path / "test.py"
        f.write_text("print('hello')")
        result = await get_source_code(str(f))
        assert result["content"] == "print('hello')"

    @pytest.mark.asyncio
    async def test_write_source_code_full(self, tmp_path) -> None:
        """Should write full content to a file."""
        from nebo.mcp.tools import write_source_code
        f = tmp_path / "test.py"
        f.write_text("old content")
        result = await write_source_code(str(f), content="new content")
        assert result["status"] == "written"
        assert f.read_text() == "new content"

    @pytest.mark.asyncio
    async def test_write_source_code_patches(self, tmp_path) -> None:
        """Should apply patches to a file."""
        from nebo.mcp.tools import write_source_code
        f = tmp_path / "test.py"
        f.write_text("batch_size = 64\nlr = 0.01")
        result = await write_source_code(
            str(f),
            patches=[{"old": "batch_size = 64", "new": "batch_size = 16"}],
        )
        assert result["status"] == "patched"
        assert "batch_size = 16" in f.read_text()
        assert "lr = 0.01" in f.read_text()

    @pytest.mark.asyncio
    async def test_write_source_code_patch_not_found(self, tmp_path) -> None:
        """Should error when patch target not found."""
        from nebo.mcp.tools import write_source_code
        f = tmp_path / "test.py"
        f.write_text("hello world")
        result = await write_source_code(
            str(f),
            patches=[{"old": "nonexistent text", "new": "replacement"}],
        )
        assert "error" in result

    @pytest.mark.asyncio
    async def test_write_source_code_no_args(self, tmp_path) -> None:
        """Should error when neither content nor patches provided."""
        from nebo.mcp.tools import write_source_code
        f = tmp_path / "test.py"
        f.write_text("hello")
        result = await write_source_code(str(f))
        assert "error" in result


class TestMCPNewTools:
    """Tests for new MCP tools: nebo_load_file and nebo_chat."""

    def test_load_file_tool_exists(self) -> None:
        """nebo_load_file should be in MCP_TOOLS."""
        from nebo.mcp.server import MCP_TOOLS
        names = [t["name"] for t in MCP_TOOLS]
        assert "nebo_load_file" in names

    def test_chat_tool_exists(self) -> None:
        """nebo_chat should be in MCP_TOOLS."""
        from nebo.mcp.server import MCP_TOOLS
        names = [t["name"] for t in MCP_TOOLS]
        assert "nebo_chat" in names

    @pytest.mark.asyncio
    async def test_handle_load_file_tool(self) -> None:
        """nebo_load_file should handle nonexistent files gracefully."""
        from nebo.mcp.server import handle_tool_call
        result = await handle_tool_call(
            "nebo_load_file",
            {"filepath": "/nonexistent/file.nebo"},
            "http://localhost:19999",
        )
        assert "error" in result or "status" in result

    @pytest.mark.asyncio
    async def test_handle_chat_tool(self) -> None:
        """nebo_chat should handle missing daemon gracefully."""
        from nebo.mcp.server import handle_tool_call
        result = await handle_tool_call(
            "nebo_chat",
            {"question": "What happened?"},
            "http://localhost:19999",
        )
        assert "error" in result or "answer" in result


class TestMCPDispatcher:
    """Tests for the MCP tool dispatcher."""

    def setup_method(self) -> None:
        SessionState.reset_singleton()

    @pytest.mark.asyncio
    async def test_unknown_tool(self) -> None:
        """Should return error for unknown tool names."""
        from nebo.mcp.server import handle_tool_call
        result = await handle_tool_call("nonexistent_tool", {})
        assert "error" in result

    @pytest.mark.asyncio
    async def test_get_run_history_no_daemon(self) -> None:
        """Should return error when daemon not available."""
        from nebo.mcp.tools import get_run_history
        result = await get_run_history("http://localhost:19999")
        assert "error" in result
