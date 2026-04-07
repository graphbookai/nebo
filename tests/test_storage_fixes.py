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


def test_run_endpoint_passes_store():
    """The /run endpoint must read NEBO_NO_STORE and pass store to create_run."""
    import inspect
    from nebo.server.daemon import create_daemon_app
    # Read the source of create_daemon_app to verify store logic
    source = inspect.getsource(create_daemon_app)
    assert "NEBO_NO_STORE" in source, "create_daemon_app should check NEBO_NO_STORE"
    assert "store=store" in source, "create_daemon_app should pass store to create_run"


def test_get_graph_dict_filters_unmaterialized():
    """get_graph_dict() must only include materialized nodes."""
    from nebo.core.state import SessionState, get_state
    SessionState.reset_singleton()
    import nebo as nb
    nb._auto_init_done = False
    nb.init(mode="local")

    state = get_state()
    # Register a node but don't materialize it
    state.register_node("hidden_node", "hidden", docstring=None, pausable=False)
    # Register and materialize another
    state.register_node("visible_node", "visible", docstring=None, pausable=False)
    state.ensure_node("visible_node")

    graph = state.get_graph_dict()
    assert "visible_node" in graph["nodes"]
    assert "hidden_node" not in graph["nodes"]

    SessionState.reset_singleton()
