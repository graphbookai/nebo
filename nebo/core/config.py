"""Configuration logging for nebo."""

from __future__ import annotations

from typing import Any

from nebo.core.state import _current_node, get_state


def configure(cfg: dict[str, Any]) -> None:
    """Set run-level configuration.

    Unlike :func:`log_cfg`, which records config on the currently
    executing node, ``configure`` stores configuration at the run
    level and can be called from module scope before any ``@nb.fn``
    has executed.  Multiple calls merge into the existing run
    config (later keys win).

    Args:
        cfg: A dict of configuration values.  Only JSON-serializable
             values (str, int, float, bool, list, dict) are retained.
    """
    state = get_state()

    filtered = {
        k: v for k, v in cfg.items()
        if isinstance(v, (str, int, float, bool, list, dict))
    }

    state.config = {**state.config, **filtered}

    # Send a run-level config event (no node_id) to the daemon so the
    # UI can surface it in the run-info panel.
    state._send_to_client({
        "type": "config",
        "node": None,
        "data": filtered,
    })


def log_cfg(cfg: dict[str, Any]) -> None:
    """Log configuration for the current node.

    Merges *cfg* into the current node's ``params`` dict so the
    info tab displays all configuration in one place.  Calling
    ``log_cfg`` multiple times within the same node merges
    the dictionaries together (later calls win on key conflicts).

    Args:
        cfg: A flat or nested dictionary of configuration values.
             Only JSON-serializable values (str, int, float, bool,
             list, dict) are retained.

    Example::

        @nb.fn()
        def train(data):
            nb.log_cfg({"model": "resnet50", "batch_size": 32})
            nb.log_cfg({"lr": 0.001})
            # info tab shows: model=resnet50, batch_size=32, lr=0.001
    """
    state = get_state()
    node_id = _current_node.get()

    filtered = {
        k: v for k, v in cfg.items()
        if isinstance(v, (str, int, float, bool, list, dict))
    }

    if node_id and node_id in state.nodes:
        node_info = state.nodes[node_id]
        node_info.params = {**node_info.params, **filtered}

    state._send_to_client({
        "type": "config",
        "node": node_id,
        "data": filtered,
    })
