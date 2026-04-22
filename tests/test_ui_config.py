"""Tests for nb.ui() and @nb.fn(ui={...})."""

import pytest
from nebo.core.state import SessionState
import nebo as nb


@pytest.fixture
def reset_state():
    SessionState.reset_singleton()
    nb._auto_init_done = False
    nb.init(mode="local")
    yield
    SessionState.reset_singleton()


def test_ui_sends_config_event(reset_state):
    """nb.ui() should store config and send ui_config event."""
    from nebo.core.state import get_state

    nb.ui(layout="horizontal", view="dag", collapsed=False, minimap=True, theme="dark")

    state = get_state()
    assert state.ui_config is not None
    assert state.ui_config["layout"] == "horizontal"
    assert state.ui_config["view"] == "dag"
    assert state.ui_config["theme"] == "dark"


def test_ui_overwrites_previous(reset_state):
    """Calling nb.ui() again overwrites previous config."""
    from nebo.core.state import get_state

    nb.ui(layout="horizontal")
    nb.ui(layout="vertical")

    state = get_state()
    assert state.ui_config["layout"] == "vertical"


def test_fn_ui_parameter(reset_state):
    """@nb.fn(ui={...}) stores per-node UI hints."""
    from nebo.core.state import get_state

    @nb.fn(ui={"collapsed": True})
    def my_func():
        nb.log("hello")

    my_func()

    state = get_state()
    node_id = next(nid for nid in state.loggables if "my_func" in nid)
    assert state.loggables[node_id].ui_hints == {"collapsed": True}
