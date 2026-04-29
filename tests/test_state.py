"""Tests for the Loggable abstraction in state.py."""
from collections import deque

from nebo.core.state import (
    LoggableInfo,
    NodeInfo,
    GlobalInfo,
    SessionState,
    get_state,
)


def test_loggable_info_has_shared_fields():
    loggable = LoggableInfo(loggable_id="x", kind="node")
    # `logs` is a bounded ring buffer used by the terminal "Recent
    # logs" panel; it is the only payload-bearing field the SDK keeps
    # on disk-volume buckets after the v3 redesign.
    assert isinstance(loggable.logs, deque)
    assert len(loggable.logs) == 0
    assert loggable.errors == []
    assert loggable.progress is None
    # Metric values, image metadata, and audio metadata are no longer
    # mirrored on the SDK — they go straight to the daemon.
    assert not hasattr(loggable, "metrics")
    assert not hasattr(loggable, "images")
    assert not hasattr(loggable, "audio")


def test_node_info_inherits_loggable_info():
    node = NodeInfo(loggable_id="my_node", name="my_node", func_name="f")
    assert isinstance(node, LoggableInfo)
    assert node.kind == "node"
    assert node.exec_count == 0
    assert node.is_source is True
    assert isinstance(node.logs, deque)  # inherited
    assert len(node.logs) == 0


def test_global_info_has_fixed_kind():
    g = GlobalInfo(loggable_id="__global__")
    assert isinstance(g, LoggableInfo)
    assert g.kind == "global"
    assert g.loggable_id == "__global__"


def test_session_state_seeds_global_on_clear():
    SessionState.reset_singleton()
    state = get_state()
    state.clear_run_state()
    assert "__global__" in state.loggables
    assert state.loggables["__global__"].kind == "global"


def test_session_state_reset_seeds_global():
    SessionState.reset_singleton()
    state = get_state()
    assert "__global__" in state.loggables
