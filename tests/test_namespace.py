"""Tests for the nebo namespace rename.

Verifies that all imports use 'nebo' instead of 'graphbook.beta'.
"""

from __future__ import annotations


class TestNamespaceImports:
    """Verify that the nebo namespace is properly set up."""

    def test_import_nebo(self) -> None:
        """import nebo should work."""
        import nebo
        assert hasattr(nebo, "fn")
        assert hasattr(nebo, "log")
        assert hasattr(nebo, "log_metric")
        assert hasattr(nebo, "init")

    def test_import_nebo_as_nb(self) -> None:
        """import nebo as nb should work."""
        import nebo as nb
        assert hasattr(nb, "fn")
        assert hasattr(nb, "log")

    def test_import_core_state(self) -> None:
        """nebo.core.state should be importable."""
        from nebo.core.state import get_state, SessionState, _current_node
        assert get_state is not None

    def test_import_core_decorators(self) -> None:
        """nebo.core.decorators should be importable."""
        from nebo.core.decorators import fn
        assert fn is not None

    def test_import_core_config(self) -> None:
        """nebo.core.config should be importable."""
        from nebo.core.config import log_cfg
        assert log_cfg is not None

    def test_import_core_tracker(self) -> None:
        """nebo.core.tracker should be importable."""
        from nebo.core.tracker import track
        assert track is not None

    def test_import_core_dag(self) -> None:
        """nebo.core.dag should be importable."""
        from nebo.core.dag import get_sources, get_topology_order, get_dag_summary
        assert get_sources is not None

    def test_import_core_client(self) -> None:
        """nebo.core.client should be importable."""
        from nebo.core.client import DaemonClient
        assert DaemonClient is not None

    def test_import_logging_logger(self) -> None:
        """nebo.logging.logger should be importable."""
        from nebo.logging.logger import log, log_metric, log_image, log_audio, log_text, md
        assert log is not None

    def test_import_logging_queue(self) -> None:
        """nebo.logging.queue should be importable."""
        from nebo.logging.queue import LogQueue
        assert LogQueue is not None

    def test_import_logging_serializers(self) -> None:
        """nebo.logging.serializers should be importable."""
        from nebo.logging.serializers import serialize_image, serialize_audio
        assert serialize_image is not None

    def test_import_server_daemon(self) -> None:
        """nebo.server.daemon should be importable."""
        from nebo.server.daemon import DaemonState, create_daemon_app
        assert DaemonState is not None

    def test_import_server_protocol(self) -> None:
        """nebo.server.protocol should be importable."""
        from nebo.server.protocol import MessageType, Message
        assert MessageType is not None

    def test_import_server_runner(self) -> None:
        """nebo.server.runner should be importable."""
        from nebo.server.runner import PipelineRunner
        assert PipelineRunner is not None

    def test_import_mcp_server(self) -> None:
        """nebo.mcp.server should be importable."""
        from nebo.mcp.server import MCP_TOOLS, handle_tool_call
        assert MCP_TOOLS is not None

    def test_import_mcp_tools(self) -> None:
        """nebo.mcp.tools should be importable."""
        from nebo.mcp import tools
        assert hasattr(tools, "get_graph")

    def test_import_cli(self) -> None:
        """nebo.cli should be importable."""
        from nebo.cli import main
        assert main is not None

    def test_import_terminal_display(self) -> None:
        """nebo.terminal.display should be importable."""
        from nebo.terminal.display import TerminalDisplay
        assert TerminalDisplay is not None

    def test_import_extensions(self) -> None:
        """nebo.extensions should be importable."""
        import nebo.extensions
        assert nebo.extensions is not None

    def test_no_graphbook_references_in_init(self) -> None:
        """nebo.__init__ module docstring should not mention graphbook."""
        import nebo
        assert "graphbook" not in (nebo.__doc__ or "").lower()

    def test_env_vars_use_nebo_prefix(self) -> None:
        """Environment variable references should use NEBO_ prefix."""
        import nebo
        import inspect
        source = inspect.getsource(nebo.init)
        assert "NEBO_MODE" in source
        assert "NEBO_SERVER_PORT" in source
        assert "NEBO_RUN_ID" in source
        assert "GRAPHBOOK_" not in source

    def test_cli_env_vars_use_nebo_prefix(self) -> None:
        """CLI module should use NEBO_ env var prefix."""
        import inspect
        from nebo import cli
        source = inspect.getsource(cli)
        assert "NEBO_SERVER_PORT" in source
        assert "NEBO_MODE" in source
        assert "GRAPHBOOK_" not in source

    def test_pyproject_has_nebo_script(self) -> None:
        """pyproject.toml should have nebo = nebo.cli:main entry point."""
        from pathlib import Path
        toml_path = Path(__file__).parent.parent / "pyproject.toml"
        content = toml_path.read_text()
        assert 'nebo = "nebo.cli:main"' in content

    def test_pyproject_build_paths(self) -> None:
        """pyproject.toml build paths should reference nebo, not graphbook."""
        from pathlib import Path
        toml_path = Path(__file__).parent.parent / "pyproject.toml"
        content = toml_path.read_text()
        assert "graphbook" not in content
