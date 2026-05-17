"""Nebo — A modern logging SDK for multi-modal data.

Usage:
    import nebo as nb

    @nb.fn()
    def my_function():
        nb.log("hello")
        nb.log_line("loss", 0.5)
"""

from __future__ import annotations

import os
import sys
import uuid
import logging as _stdlib_logging
from typing import Any, Literal, Optional, TypeVar

from nebo.core.decorators import fn
from nebo.core.tracker import track
from nebo.core.config import log_cfg
from nebo.core.state import get_state
from nebo.alerts import AlertLevel, alert
from nebo.notebook import show
from nebo import labels
from nebo.logging.logger import (
    log,
    log_line,
    log_bar,
    log_pie,
    log_scatter,
    log_histogram,
    log_image,
    log_audio,
    md,
)

T = TypeVar("T")

_auto_init_done = False
logger = _stdlib_logging.getLogger(__name__)


def _ensure_init() -> None:
    """Lazily auto-initialize on first nb.* call."""
    global _auto_init_done
    if _auto_init_done:
        return
    state = get_state()
    if state._transport is not None:
        _auto_init_done = True
        return
    init(_internal=True)


def init(
    uri: Optional[str] = None,
    *,
    dag_strategy: Literal["object", "stack", "both", "linear", "none"] = "object",
    flush_interval: float = 0.1,
    api_token: Optional[str] = None,
    webhook_url: Optional[str] = None,
    webhook_min_level: Optional[int] = None,
    _internal: bool = False,
) -> None:
    """Initialize nebo.

    The ``uri`` argument selects the transport:

      * Omitted or a path-like string -> **file mode**. Events are written
        to ``<uri>/<timestamp>_<run_id>.nebo`` via the local SDK.
        Default is ``.nebo/``.
      * ``http://``/``https://`` URL or a bare ``host:port`` -> **network mode**.
        Events are POSTed to the daemon at that address.

    Env overrides: ``NEBO_URI`` overrides ``uri``; ``NEBO_RUN_ID``,
    ``NEBO_FLUSH_INTERVAL``, ``NEBO_API_TOKEN`` work as before.
    ``NEBO_QUIET=1`` suppresses the one-line startup banner.
    ``NEBO_NO_STORE=1`` makes file mode a no-op (no file is opened) —
    used by the test suite.

    Args:
        uri: Destination. See above. Defaults to ``.nebo/``.
        dag_strategy: How DAG edges are inferred between steps.
            'object' (default) uses sibling data-flow edges with parent
            fallback. 'stack' uses caller-to-callee edges only. 'both'
            is the union of object and stack edges. 'linear' chains nodes
            in first-execution order. 'none' disables automatic inference.
        flush_interval: Seconds between event flushes (default 0.1).
        api_token: Token for daemons that require auth. Sent as
            ``X-Nebo-Token``. Defaults to env var NEBO_API_TOKEN.
            Network mode only; ignored in file mode.
        webhook_url: Slack-compatible webhook URL for ``nb.alert()``.
        webhook_min_level: Minimum ``AlertLevel`` that fires the webhook.
    """
    global _auto_init_done

    if _auto_init_done and not _internal:
        import warnings
        warnings.warn(
            "nebo was already implicitly initialized by a prior nb.* call. "
            "Call nb.init() before any @nb.fn() execution, nb.log(), nb.md(), etc. "
            "This nb.init() call will be ignored.",
            stacklevel=2,
        )
        return

    _auto_init_done = True

    from nebo.core.uri import Mode, resolve_uri
    from nebo.core.transport import FileTransport
    from nebo.core.client import NetworkTransport

    state = get_state()
    state.dag_strategy = dag_strategy
    if webhook_url is not None:
        state.webhook_url = webhook_url
    if webhook_min_level is not None:
        state.webhook_min_level = int(webhook_min_level)

    env_uri = os.environ.get("NEBO_URI")
    env_run_id = os.environ.get("NEBO_RUN_ID")
    env_flush = os.environ.get("NEBO_FLUSH_INTERVAL")
    quiet = bool(os.environ.get("NEBO_QUIET"))
    no_store = bool(os.environ.get("NEBO_NO_STORE"))

    if env_uri:
        uri = env_uri
    if env_flush:
        flush_interval = float(env_flush)
    api_token = api_token or os.environ.get("NEBO_API_TOKEN")

    mode, dest = resolve_uri(uri)
    run_id = env_run_id or uuid.uuid4().hex[:12]
    script_name = os.path.abspath(sys.argv[0]) if sys.argv else "script"

    _install_text_logger()

    transport: Any = None
    banner_endpoint: str = ""

    if mode is Mode.FILE:
        if not no_store:
            transport = FileTransport(
                logdir=dest,
                run_id=run_id,
                script_path=script_name,
                flush_interval=flush_interval,
            )
            banner_endpoint = str(transport.filepath)
        else:
            banner_endpoint = f"{dest} (NEBO_NO_STORE=1; events dropped)"
        state._mode = "file"
    else:
        transport = NetworkTransport(
            base_url=dest,
            api_token=api_token,
            run_id=run_id,
            flush_interval=flush_interval,
        )
        banner_endpoint = dest
        if not transport.connect():
            print(
                f"warning: could not reach nebo daemon at {dest}. "
                "events will be buffered locally and dropped on exit.",
                file=sys.stderr,
            )
        else:
            if api_token:
                transport.warmup(timeout=180.0)
        state._mode = "network"

    state._transport = transport

    if transport is not None:
        state._send_to_client({
            "type": "loggable_register",
            "loggable_id": "__global__",
            "data": {"loggable_id": "__global__", "kind": "global"},
        })
        state._send_to_client({
            "type": "run_start",
            "data": {"script_path": script_name},
        })

    if not quiet:
        if mode is Mode.FILE:
            print(f"nebo: writing to {banner_endpoint}")
        else:
            print(f"nebo: connected to {banner_endpoint}")
        print(f"run_id={run_id}")


def _install_text_logger() -> None:
    """Route nb.log()'s text messages to stdout via the 'nebo' stdlib logger.

    Idempotent — repeated calls don't stack handlers.
    """
    nebo_logger = _stdlib_logging.getLogger("nebo")
    nebo_logger.handlers = [
        h for h in nebo_logger.handlers
        if not getattr(h, "_nebo_managed", False)
    ]
    handler = _stdlib_logging.StreamHandler(sys.stdout)
    handler.setFormatter(_stdlib_logging.Formatter("%(message)s"))
    handler._nebo_managed = True  # type: ignore[attr-defined]
    nebo_logger.addHandler(handler)
    if nebo_logger.level == _stdlib_logging.NOTSET:
        nebo_logger.setLevel(_stdlib_logging.INFO)


def flush(timeout: float = 5.0) -> bool:
    """Block until queued events are sent to the daemon.

    Useful for fencing a logging-heavy section before something
    irreversible (saving artifacts, sending an email, etc.) so the
    UI shows everything that was logged before that point.

    Args:
        timeout: Max seconds to wait. Default 5.0.

    Returns:
        True if all queued events were flushed (or there was no
        client to flush). False if the timeout elapsed with events
        still unsent — those events remain in the client's internal
        buffer and may be retried by the next periodic flush, but
        will be lost if the process exits before they go out.

    No-op (returns True) in local mode, before init, or after the
    daemon has been disconnected.
    """
    state = get_state()
    client = state._transport
    if client is None:
        return True
    return client.flush(timeout=timeout)


def ui(
    layout: Optional[Literal["horizontal", "vertical"]] = None,
    view: Optional[Literal["dag", "grid"]] = None,
    minimap: Optional[bool] = None,
    theme: Optional[Literal["dark", "light"]] = None,
    tracker: Optional[Literal["time", "step"]] = None,
) -> None:
    """Set run-level UI defaults.

    These are sent to the daemon and UI as defaults.
    The user can still override them in the UI.

    Args:
        layout: DAG layout direction ("horizontal" or "vertical").
        view: Default view mode ("dag" or "grid").
        minimap: Show minimap.
        theme: Color theme ("dark" or "light").
        tracker: Default timeline scrubber mode ("time" or "step").
    """
    _ensure_init()
    state = get_state()
    config: dict[str, Any] = {}
    if layout is not None:
        config["layout"] = layout
    if view is not None:
        config["view"] = view
    if minimap is not None:
        config["minimap"] = minimap
    if theme is not None:
        config["theme"] = theme
    if tracker is not None:
        config["tracker"] = tracker

    state.ui_config = config
    state._send_to_client({
        "type": "ui_config",
        "data": config,
    })


def _resolve_config(config: Any) -> dict:
    """Convert config to a plain dict, handling OmegaConf DictConfig."""
    if config is None:
        return {}
    try:
        from omegaconf import DictConfig, OmegaConf
        if isinstance(config, DictConfig):
            return OmegaConf.to_container(config, resolve=True)  # type: ignore
    except ImportError:
        pass
    if isinstance(config, dict):
        return config
    return dict(config)


class _RunContext:
    """Context manager returned by start_run()."""

    def __init__(self, run_id: str, name: Optional[str], config: Optional[dict]) -> None:
        self.run_id = run_id
        self.name = name
        self.config = config

    def __enter__(self) -> _RunContext:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        state = get_state()
        client = state._transport
        # Save state snapshot before completing
        state.save_run_state(self.run_id)
        if client is not None:
            exit_code = 1 if exc_type is not None else 0
            client.send_event({
                "type": "run_completed",
                "data": {"exit_code": exit_code},
            })
            client.flush()
            client._run_completed = True
        state._active_run_id = None


def start_run(
    name: Optional[str] = None,
    config: Optional[dict] = None,
    run_id: Optional[str] = None,
) -> _RunContext:
    """Start a new run or resume an existing one.

    Can be used as a context manager or plain function call.

    Args:
        name: Optional display name for the run.
        config: Optional config dict (or OmegaConf DictConfig).
        run_id: Optional run_id to resume a previous run.

    Returns:
        A _RunContext with a .run_id attribute.
    """
    _ensure_init()
    state = get_state()
    client = state._transport

    resolved_config = _resolve_config(config) if config is not None else None
    resuming = run_id is not None and run_id in state._run_snapshots

    # Save current run's state if there is one active
    if state._active_run_id is not None:
        state.save_run_state(state._active_run_id)
        # Complete the previous run
        if client is not None:
            client.send_event({
                "type": "run_completed",
                "data": {"exit_code": 0},
            })
            client.flush()

    if resuming:
        # Restore snapshot for resumed run
        state.restore_run_state(run_id)  # type: ignore[arg-type]
    else:
        # New run
        run_id = run_id or uuid.uuid4().hex[:12]
        state.clear_run_state()

    # Update client run_id and reset completion guard
    if client is not None:
        client._run_id = run_id
        client._run_completed = False
    state._active_run_id = run_id

    if not os.environ.get("NEBO_QUIET"):
        from nebo.core.transport import FileTransport as _FT
        if state._mode == "file" and isinstance(state._transport, _FT):
            print(f"nebo: writing to {state._transport.filepath}")
        elif state._mode == "network":
            print(f"nebo: connected (run continuing)")
        print(f"run_id={run_id}")

    # Send run_start event
    script_path = os.path.abspath(sys.argv[0]) if sys.argv else "script"
    if client is not None:
        run_start_data: dict[str, Any] = {
            "script_path": script_path,
        }
        if name is not None:
            run_start_data["run_name"] = name
        client.send_event({
            "type": "run_start",
            "data": run_start_data,
        })

    # Send run_config event if config provided
    if resolved_config is not None and client is not None:
        client.send_event({
            "type": "run_config",
            "data": resolved_config,
        })

    return _RunContext(run_id, name, resolved_config)  # type: ignore[arg-type]


__all__ = [
    "fn",
    "track",
    "init",
    "flush",
    "log",
    "log_cfg",
    "log_line",
    "log_bar",
    "log_pie",
    "log_scatter",
    "log_histogram",
    "log_image",
    "log_audio",
    "md",
    "labels",
    "ui",
    "start_run",
    "get_state",
]
