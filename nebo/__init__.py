"""Nebo — Lightweight observability for Python programs.

Usage:
    import nebo as nb

    @nb.fn()
    def my_function():
        nb.log("hello")
        nb.log_metric("loss", 0.5)
"""

from __future__ import annotations

import os
import threading
import time
import uuid
import logging as _stdlib_logging
from typing import Any, Literal, Optional, TypeVar

from nebo.core.decorators import fn
from nebo.core.tracker import track
from nebo.core.config import configure, log_cfg
from nebo.core.state import _current_node, get_state
from nebo.logging.logger import (
    log,
    log_metric,
    log_image,
    log_audio,
    log_text,
    md,
)

T = TypeVar("T")

_auto_init_done = False
_pause_poll_thread: Optional[threading.Thread] = None
logger = _stdlib_logging.getLogger(__name__)

def _start_pause_poll() -> None:
    """Start a background thread that polls the daemon for pause state changes."""
    global _pause_poll_thread
    state = get_state()
    if not state._has_pausable or state._client is None:
        return
    if _pause_poll_thread is not None and _pause_poll_thread.is_alive():
        return

    def _poll_loop() -> None:
        client = state._client
        while client is not None and client.is_connected():
            try:
                paused = client.get_pause_state()
                state.set_paused(paused)
            except Exception:
                pass
            time.sleep(0.5)

    _pause_poll_thread = threading.Thread(target=_poll_loop, daemon=True)
    _pause_poll_thread.start()


def _ensure_init() -> None:
    """Lazily auto-initialize on first nb.* call.

    Called by the @fn decorator wrapper and logging functions on first
    execution. If the user already called nb.init(), this is a no-op.
    """
    global _auto_init_done
    if _auto_init_done:
        return

    state = get_state()
    # If user already called init() and connected, skip
    if state._mode != "local" or state._client is not None:
        _auto_init_done = True
        return

    # Auto-connect to daemon. Env vars from `nebo run`
    # take priority if present.
    init(mode="auto", _internal=True)


def init(
    port: int = 2048,
    host: str = "localhost",
    mode: Literal["auto", "server", "local"] = "auto",
    terminal: bool = True,
    dag_strategy: Literal["object", "stack", "both", "none"] = "object",
    flush_interval: float = 0.1,
    store: bool = True,
    _internal: bool = False,
) -> None:
    """Initialize nebo.

    Mode detection (when mode='auto'):
    1. Check environment variables (set by 'nebo run')
    2. Check for daemon at host:port
    3. If found -> server mode (stream events to daemon)
    4. If not found -> local mode (in-process rich terminal only)

    Args:
        port: Daemon server port (default 2048).
        host: Daemon server host (default localhost).
        mode: 'auto', 'server', or 'local'.
        terminal: Whether to show Rich terminal display in local mode.
        dag_strategy: How DAG edges are inferred between steps.
            'object' (default) uses sibling data-flow edges with parent
            fallback. 'stack' uses caller-to-callee edges only. 'both'
            is the union of object and stack edges.
        flush_interval: Seconds between event flushes (default 0.1).
        store: Whether to persist events to .nebo files (default True).
    """
    global _auto_init_done

    # If already initialized, warn and no-op (unless called internally by _ensure_init)
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
    state = get_state()
    state.port = port
    state.dag_strategy = dag_strategy

    # Check environment overrides (set by `nebo run`)
    env_mode = os.environ.get("NEBO_MODE")
    env_port = os.environ.get("NEBO_SERVER_PORT")
    env_run_id = os.environ.get("NEBO_RUN_ID")

    env_flush_interval = os.environ.get("NEBO_FLUSH_INTERVAL")

    if env_port:
        port = int(env_port)
        state.port = port
    if env_mode:
        mode = env_mode  # type: ignore
    if env_flush_interval:
        flush_interval = float(env_flush_interval)

    resolved_mode = mode

    # Generate a run_id if not provided by env (e.g. direct script execution).
    # Compute script_name whenever we may end up in a non-local mode, so the
    # `run_start` event fires regardless of whether run_id came from the
    # environment (nebo run) or was freshly generated (direct python execution).
    # Without this, `nebo run` would set NEBO_RUN_ID, skip script_name, skip
    # run_start, and the daemon would never open its .nebo file writer.
    run_id = env_run_id
    script_name: Optional[str] = None
    if resolved_mode != "local":
        import sys
        script_name = os.path.abspath(sys.argv[0]) if sys.argv else "script"
        if not run_id:
            run_id = f"{uuid.uuid4().hex[:12]}"

    if resolved_mode == "auto":
        # Try to connect to daemon
        try:
            from nebo.core.client import DaemonClient
            client = DaemonClient(host=host, port=port, run_id=run_id, flush_interval=flush_interval)
            if client.connect():
                resolved_mode = "server"
                state._client = client
            else:
                resolved_mode = "local"
        except Exception:
            resolved_mode = "local"
    elif resolved_mode == "server":
        from nebo.core.client import DaemonClient
        client = DaemonClient(host=host, port=port, run_id=run_id, flush_interval=flush_interval)
        if not client.connect():
            print(f"Warning: Could not connect to nebo daemon at {host}:{port}. Falling back to local mode.")
            resolved_mode = "local"
        else:
            state._client = client

    # Send run_start event so the daemon knows the script name
    if state._client is not None and script_name:
        state._send_to_client({
            "type": "run_start",
            "data": {"script_path": script_name, "store": store},
        })

    state._mode = resolved_mode

    if terminal:
        try:
            from nebo.terminal.display import TerminalDisplay
            import atexit
            if state._display is None:
                state._display = TerminalDisplay()
                atexit.register(state._display.stop)
        except ImportError:
            pass

    # Start pause polling if we have pausable nodes and are in server mode
    if state._client is not None:
        _start_pause_poll()


def ask(
    question: str,
    options: Optional[list[str]] = None,
    timeout: Optional[float] = None,
) -> str:
    """Ask a question via the web UI or terminal fallback.

    In server mode, sends an ask_prompt event to the daemon and polls
    for a response from the web UI.  In local mode, falls back to a
    Rich terminal prompt.

    Args:
        question: The question to ask.
        options: Optional list of valid responses.
        timeout: Optional timeout in seconds.

    Returns:
        The response string.

    Raises:
        TimeoutError: If timeout expires with no response (server mode only).
    """
    state = get_state()
    client = getattr(state, "_client", None)

    # Server mode: send event and poll for web UI response
    if client and client.is_connected():
        ask_id = str(uuid.uuid4())
        node_name = _current_node.get() or ""
        run_id = getattr(client, "_run_id", None) or ""

        client.send_event({
            "type": "ask_prompt",
            "ask_id": ask_id,
            "node": node_name,
            "node_name": node_name,
            "question": question,
            "options": options,
            "timeout_seconds": timeout,
        })
        client.flush()

        poll_path = f"/runs/{run_id}/ask/{ask_id}/respond"
        poll_interval = 0.5
        deadline = time.monotonic() + timeout if timeout else None

        while True:
            if deadline and time.monotonic() >= deadline:
                raise TimeoutError(
                    f"No response to ask '{question}' within {timeout}s"
                )
            time.sleep(poll_interval)
            resp = client.get(poll_path)
            if resp and resp.get("status") == "answered":
                return resp["response"]

    # Local mode: terminal fallback
    display = getattr(state, "_display", None)
    if display is not None:
        display.pause()

    try:
        from rich.prompt import Prompt
        if options:
            return Prompt.ask(question, choices=options)
        return Prompt.ask(question)
    except (ImportError, EOFError):
        if options:
            return options[0]
        return ""
    finally:
        if display is not None:
            display.resume()


def ui(
    layout: Optional[Literal["horizontal", "vertical"]] = None,
    view: Optional[Literal["dag", "grid"]] = None,
    collapsed: Optional[bool] = None,
    minimap: Optional[bool] = None,
    theme: Optional[Literal["dark", "light"]] = None,
) -> None:
    """Set run-level UI defaults.

    These are sent to the daemon and UI as defaults.
    The user can still override them in the UI.

    Args:
        layout: DAG layout direction ("horizontal" or "vertical").
        view: Default view mode ("dag" or "grid").
        collapsed: Default node collapse state.
        minimap: Show minimap.
        theme: Color theme ("dark" or "light").
    """
    _ensure_init()
    state = get_state()
    config: dict[str, Any] = {}
    if layout is not None:
        config["layout"] = layout
    if view is not None:
        config["view"] = view
    if collapsed is not None:
        config["collapsed"] = collapsed
    if minimap is not None:
        config["minimap"] = minimap
    if theme is not None:
        config["theme"] = theme

    state.ui_config = config
    state._send_to_client({
        "type": "ui_config",
        "data": config,
    })


__all__ = [
    "fn",
    "track",
    "configure",
    "log_cfg",
    "init",
    "log",
    "log_metric",
    "log_image",
    "log_audio",
    "log_text",
    "md",
    "ask",
    "ui",
    "get_state",
]
