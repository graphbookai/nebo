"""Tests verifying daemon-side storage behavior."""

import pytest


def test_load_endpoint_exists():
    """POST /load route must exist in the FastAPI app."""
    from nebo.server.daemon import create_daemon_app
    app = create_daemon_app()
    routes = [r.path for r in app.routes]
    assert "/load" in routes, f"/load not found in routes: {routes}"


def test_no_remote_dir_creates_no_writer():
    """A default DaemonState (remote-ephemeral, _remote_dir None) must not open
    any file writer on create_run."""
    from nebo.server.daemon import DaemonState
    state = DaemonState()
    run = state.create_run("test.py", [], "test-run")
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
