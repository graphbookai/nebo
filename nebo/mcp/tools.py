"""MCP tool implementations for nebo.

Observation tools query pipeline state. Action tools control pipeline
lifecycle. All tools talk to the daemon over HTTP using only stdlib
(no httpx needed).

These functions run inside the ``nebo mcp-stdio`` bridge process,
which is launched by the LLM client. That process never executes any
``@nb.fn``-decorated code, so its in-process ``SessionState``
singleton is empty — the daemon's HTTP API is the only real source of
data. If the daemon is unreachable, observation tools surface that
explicitly rather than silently returning empty SDK state.
"""

from __future__ import annotations

from typing import Any, Optional

from nebo import client as _client


_DEFAULT_URL = "http://localhost:7861"


def _daemon_unreachable(server_url: str, exc: Exception) -> dict[str, Any]:
    """Uniform error envelope for observation tools when the daemon
    can't be reached. The SDK lives in a different process than the
    MCP bridge, so there is no in-process fallback to read."""
    return {
        "error": f"daemon unreachable at {server_url}: {exc}",
        "hint": "Start the daemon with `nebo serve` (default port 7861).",
    }


# ─── Observation Tools ───────────────────────────────────────────────────────

async def get_graph(run_id: Optional[str] = None, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Get the full DAG structure with nodes, edges, and execution status."""
    try:
        return _client.get_graph(run_id=run_id, url=server_url)
    except Exception as e:
        return _daemon_unreachable(server_url, e)


async def get_loggable_status(loggable_id: str, run_id: Optional[str] = None, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Get detailed status for a specific loggable (node or global)."""
    try:
        return _client.get_loggable_status(loggable_id, run_id=run_id, url=server_url)
    except Exception as e:
        return _daemon_unreachable(server_url, e)


async def get_logs(
    loggable_id: Optional[str] = None,
    run_id: Optional[str] = None,
    limit: int = 100,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Get recent logs, optionally filtered by loggable and run."""
    try:
        return _client.get_logs(loggable_id=loggable_id, run_id=run_id, limit=limit, url=server_url)
    except Exception as e:
        return _daemon_unreachable(server_url, e)


async def get_metrics(
    loggable_id: str,
    name: Optional[str] = None,
    tag: Optional[str] = None,
    step: Optional[int] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Get metric time series data for a loggable."""
    try:
        result = _client.get_metrics(loggable_id, name=name, tag=tag, step=step, url=server_url)
    except Exception as e:
        return _daemon_unreachable(server_url, e)
    if "error" in result:
        return result
    metrics = result.get("metrics", {})
    if name:
        if name in metrics:
            return {"loggable_id": loggable_id, "metrics": {name: metrics[name]}}
        return {"error": f"Metric '{name}' not found for loggable '{loggable_id}'"}
    return {"loggable_id": loggable_id, "metrics": metrics}


async def get_description(server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Get workflow description and all node docstrings."""
    try:
        return _client.get_description(url=server_url)
    except Exception as e:
        return _daemon_unreachable(server_url, e)



# ─── Action Tools ────────────────────────────────────────────────────────────

async def get_run_status(run_id: str, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Get the status of a specific run."""
    try:
        return _client.get_run_status(run_id, url=server_url)
    except Exception as e:
        return {"error": f"Run '{run_id}' not found: {e}"}


async def get_run_history(server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Get a list of all runs with outcomes, timestamps, and error counts."""
    try:
        return _client.get_run_history(url=server_url)
    except Exception as e:
        return {"error": f"Could not get run history: {e}"}


async def wait_for_alert(
    run_id: str,
    timeout: float = 300.0,
    min_level: int = 20,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Block until an alert at or above min_level fires, or timeout."""
    try:
        return _client.wait_for_alert(
            run_id, timeout=timeout, min_level=min_level, url=server_url,
        )
    except Exception as e:
        return _daemon_unreachable(server_url, e)


async def load_file(filepath: str, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Load a .nebo file into the daemon."""
    try:
        return _client.load_file(filepath, url=server_url)
    except Exception as e:
        return {"error": f"Failed to load file: {e}"}


# ─── Alert Rules ─────────────────────────────────────────────────────────────


async def list_alerts(run_id: Optional[str] = None, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """List alert rules (triggered_by=cli) and code-fired alerts (triggered_by=code)."""
    try:
        return _client.list_alerts(run_id=run_id, url=server_url)
    except Exception as e:
        return _daemon_unreachable(server_url, e)


async def set_alert(
    title: str,
    condition: str,
    text: str = "",
    level: int = 20,
    loggable_id: Optional[str] = None,
    run_id: Optional[str] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Create an alert rule that fires when a metric satisfies a condition.

    `condition` is a string like ``"train/loss > 5"`` (ops: > >= < <= == !=).
    The rule fires at most once per run; fired alerts wake `wait_for_alert`.
    """
    try:
        parsed = _client.parse_condition(condition)
    except ValueError as e:
        return {"error": str(e)}
    try:
        return _client.set_alert(
            title, parsed, text=text, level=level,
            loggable_id=loggable_id, run_id=run_id, url=server_url,
        )
    except Exception as e:
        return _daemon_unreachable(server_url, e)


async def delete_alert(rule_id: str, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Delete an alert rule by id."""
    try:
        return _client.delete_alert(rule_id, url=server_url)
    except Exception as e:
        return _daemon_unreachable(server_url, e)


# ─── Write Tools ─────────────────────────────────────────────────────────────
#
# These mirror the SDK's `nb.log_*` helpers as MCP tools so an external
# agent can push data into a run without owning the SDK process. Each
# tool accepts either a single entry or a list of entries; entries
# missing a `run_id` fall back to the tool-level `run_id` argument or
# the daemon's active run.


def _normalize_entries(entries: Any) -> list[dict[str, Any]]:
    """Accept either a single entry dict or a list of entry dicts."""
    if entries is None:
        return []
    if isinstance(entries, dict):
        return [entries]
    if isinstance(entries, list):
        return [e for e in entries if isinstance(e, dict)]
    return []


async def log_metric(
    entries: Any,
    run_id: Optional[str] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Push one or more metric points into a run.

    Each entry: ``{loggable_id?, name, value, type?, step?, tags?}``.
    `type` is one of ``line`` (default), ``bar``, ``pie``, ``scatter``, ``histogram``.
    ``loggable_id`` defaults to ``__agent__`` — the sandbox loggable reserved
    for entries authored by an external agent. Pass an explicit ``loggable_id``
    to target a specific node.
    """
    items = _normalize_entries(entries)
    if not items:
        return {"error": "no entries provided"}
    try:
        return _client.log_metric(items, run_id=run_id, url=server_url)
    except Exception as e:
        return {"error": f"daemon write failed: {e}"}


async def log_text(
    entries: Any,
    run_id: Optional[str] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Push one or more text log entries into a run.

    Each entry: ``{loggable_id?, message, name?, level?, step?}``. ``level``
    is one of ``info`` (default), ``warning``, ``error``. ``loggable_id``
    defaults to ``__agent__`` — the sandbox loggable for entries authored by
    an external agent.
    """
    items = _normalize_entries(entries)
    if not items:
        return {"error": "no entries provided"}
    try:
        return _client.log_text(items, run_id=run_id, url=server_url)
    except Exception as e:
        return {"error": f"daemon write failed: {e}"}


async def log_image(
    entries: Any,
    run_id: Optional[str] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Push one or more images into a run.

    Each entry: ``{loggable_id?, name, path? | url? | data?, step?, labels?}``.
    Supply one of ``path`` (local file), ``url`` (fetched server-side), or
    ``data`` (already-base64 bytes). ``loggable_id`` defaults to ``__agent__``.
    """
    items = _normalize_entries(entries)
    if not items:
        return {"error": "no entries provided"}
    try:
        return _client.log_image(items, run_id=run_id, url=server_url)
    except Exception as e:
        return {"error": f"daemon write failed: {e}"}


async def log_audio(
    entries: Any,
    run_id: Optional[str] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Push one or more audio recordings into a run.

    Each entry: ``{loggable_id?, name, path? | url? | data?, sr?, step?}``.
    ``loggable_id`` defaults to ``__agent__``.
    """
    items = _normalize_entries(entries)
    if not items:
        return {"error": "no entries provided"}
    try:
        return _client.log_audio(items, run_id=run_id, url=server_url)
    except Exception as e:
        return {"error": f"daemon write failed: {e}"}
