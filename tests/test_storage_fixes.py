"""Tests verifying Task 6 storage fixes are in place."""

import os
import pytest
from unittest.mock import patch


def test_load_endpoint_exists():
    """POST /load route must exist in the FastAPI app."""
    from nebo.server.daemon import create_daemon_app
    app = create_daemon_app()
    routes = [r.path for r in app.routes]
    assert "/load" in routes, f"/load not found in routes: {routes}"


def test_no_store_env_disables_storage():
    """When NEBO_NO_STORE is set, /run should create runs without file writers."""
    from nebo.server.daemon import DaemonState
    with patch.dict(os.environ, {"NEBO_NO_STORE": "1"}):
        state = DaemonState()
        run = state.create_run("test.py", [], "test-run", store=False)
        assert run._file_writer is None
        assert run._file_stream is None


def test_get_graph_dict_filters_unmaterialized():
    """get_graph_dict() must only include materialized nodes."""
    from nebo.core.state import SessionState, get_state
    SessionState.reset_singleton()
    import nebo as nb
    nb._auto_init_done = False
    nb.init()

    state = get_state()
    # Register a node but don't materialize it
    state.register_node("hidden_node", "hidden", docstring=None)
    # Register and materialize another
    state.register_node("visible_node", "visible", docstring=None)
    state.ensure_loggable("visible_node")

    graph = state.get_graph_dict()
    assert "visible_node" in graph["nodes"]
    assert "hidden_node" not in graph["nodes"]

    SessionState.reset_singleton()
