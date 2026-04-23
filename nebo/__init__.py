"""Nebo — A modern logging SDK for multi-modal data.

Usage:
    import nebo as nb

    @nb.fn()
    def my_function():
        nb.log("hello")
        nb.log_metric("loss", 0.5)
"""

from __future__ import annotations

import os
import sys
import threading
import time
import uuid
import logging as _stdlib_logging
from typing import Any, Literal, Optional, TypeVar

from nebo.core.decorators import fn
from nebo.core.tracker import track
from nebo.core.config import log_cfg
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
    cloud_url: Optional[str] = None,
    api_token: Optional[str] = None,
    _internal: bool = False,
) -> None:
    """Initialize nebo.

    Mode detection (when mode='auto'):
    1. Check environment variables (set by 'nebo run')
    2. Check for daemon at host:port (or cloud_url if set)
    3. If found -> server mode (stream events to daemon)
    4. If not found -> local mode (in-process rich terminal only)

    Cloud mode: pass `cloud_url` (full URL e.g. `https://router.run.app`)
    and `api_token` (the `nb_live_...` token from the cloud UI). When
    set, these override `host`+`port` and add an `Authorization: Bearer`
    header to every request. Defaults read from `NEBO_CLOUD_URL` and
    `NEBO_API_TOKEN` environment variables — set those to use cloud
    mode without code changes.

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
        cloud_url: Full URL of a hosted nebo router. Overrides host+port.
            Defaults to env var NEBO_CLOUD_URL.
        api_token: Bearer token for the cloud router. Required with
            cloud_url. Defaults to env var NEBO_API_TOKEN.
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

    # Cloud mode: env vars override args; cloud_url/api_token take
    # precedence over host+port when provided.
    cloud_url = cloud_url or os.environ.get("NEBO_CLOUD_URL")
    api_token = api_token or os.environ.get("NEBO_API_TOKEN")

    def _make_client():
        from nebo.core.client import DaemonClient
        if cloud_url:
            return DaemonClient(
                base_url=cloud_url,
                api_token=api_token,
                run_id=run_id,
                flush_interval=flush_interval,
            )
        return DaemonClient(
            host=host, port=port, run_id=run_id, flush_interval=flush_interval
        )

    _endpoint_label = cloud_url or f"{host}:{port}"

    def _connect_and_warmup(client: Any) -> bool:
        """connect() then (if cloud) wait for the router to ready a daemon.

        Returns True if the SDK can start sending events.
        """
        if not client.connect():
            return False
        if cloud_url and api_token:
            print(
                f"nebo: connected to {cloud_url}. "
                "Waiting for cloud-hosted daemon to be ready (this can take 30-60s on first run)..."
            )
            if not client.warmup(timeout=180.0):
                print(
                    "nebo: WARNING — daemon warmup did not complete; "
                    "events may fail until the daemon comes up."
                )
                return True  # still proceed — the SDK will retry
            print("nebo: cloud daemon ready.")
        return True

    if resolved_mode == "auto":
        # Try to connect to daemon
        try:
            client = _make_client()
            if _connect_and_warmup(client):
                resolved_mode = "server"
                state._client = client
            else:
                resolved_mode = "local"
        except Exception:
            resolved_mode = "local"
    elif resolved_mode == "server":
        client = _make_client()
        if not _connect_and_warmup(client):
            print(f"Warning: Could not connect to nebo daemon at {_endpoint_label}. Falling back to local mode.")
            resolved_mode = "local"
        else:
            state._client = client

    # Seed the "__global__" loggable on the daemon side so logs emitted
    # outside any @fn context have a home in the run's loggables dict.
    # The daemon (Task 5) will also seed it on run_start; emitting here
    # covers the one-time per-client-connection case before a run starts.
    if state._client is not None:
        state._send_to_client({
            "type": "loggable_register",
            "loggable_id": "__global__",
            "data": {"loggable_id": "__global__", "kind": "global"},
        })

    # Send run_start event so the daemon knows the script name
    if state._client is not None and script_name:
        state._send_to_client({
            "type": "run_start",
            "data": {"script_path": script_name, "store": store},
        })

    state._mode = resolved_mode

    # NEBO_NO_TERMINAL is the environment escape hatch used by the test
    # suite and headless embedders to suppress the Rich live dashboard
    # without having to thread `terminal=False` through every entry point.
    if terminal and not os.environ.get("NEBO_NO_TERMINAL"):
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
            "loggable_id": node_name,
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
    tracker: Optional[Literal["time", "step"]] = None,
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
        tracker: Default timeline scrubber mode ("time" or "step").
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
        client = state._client
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
    client = state._client

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

    # Send run_start event
    script_path = os.path.abspath(sys.argv[0]) if sys.argv else "script"
    if client is not None:
        run_start_data: dict[str, Any] = {
            "script_path": script_path,
            "store": True,
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
    "log",
    "log_cfg",
    "log_metric",
    "log_image",
    "log_audio",
    "log_text",
    "md",
    "ask",
    "ui",
    "start_run",
    "get_state",
]
