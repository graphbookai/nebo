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

import json
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Optional


_DEFAULT_URL = "http://localhost:7861"


def _get(url: str, timeout: float = 5.0) -> Any:
    """HTTP GET returning parsed JSON. Raises on failure."""
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _daemon_unreachable(server_url: str, exc: Exception) -> dict[str, Any]:
    """Uniform error envelope for observation tools when the daemon
    can't be reached. The SDK lives in a different process than the
    MCP bridge, so there is no in-process fallback to read."""
    return {
        "error": f"daemon unreachable at {server_url}: {exc}",
        "hint": "Start the daemon with `nebo serve` (default port 7861).",
    }


def _post(url: str, body: Any, timeout: float = 10.0) -> Any:
    """HTTP POST with JSON body, returning parsed JSON. Raises on failure."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {detail}") from e


# ─── Observation Tools ───────────────────────────────────────────────────────

async def get_graph(run_id: Optional[str] = None, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Get the full DAG structure with nodes, edges, and execution status."""
    try:
        if run_id:
            return _get(f"{server_url}/runs/{run_id}/graph")
        return _get(f"{server_url}/graph")
    except Exception as e:
        return _daemon_unreachable(server_url, e)


async def get_loggable_status(loggable_id: str, run_id: Optional[str] = None, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Get detailed status for a specific loggable (node or global)."""
    try:
        if run_id:
            return _get(f"{server_url}/runs/{run_id}/loggables/{loggable_id}")
        return _get(f"{server_url}/loggables/{loggable_id}")
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
        params_parts = [f"limit={limit}"]
        if loggable_id:
            params_parts.append(f"loggable_id={urllib.request.quote(loggable_id)}")
        qs = "&".join(params_parts)
        if run_id:
            url = f"{server_url}/runs/{run_id}/logs?{qs}"
        else:
            url = f"{server_url}/logs?{qs}"
        return _get(url)
    except Exception as e:
        return _daemon_unreachable(server_url, e)


async def get_metrics(
    loggable_id: str,
    name: Optional[str] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Get metric time series data for a loggable."""
    try:
        result = _get(f"{server_url}/loggables/{loggable_id}")
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


async def get_errors(run_id: Optional[str] = None, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Get all exceptions/errors, with full tracebacks and node context."""
    try:
        if run_id:
            return _get(f"{server_url}/runs/{run_id}/errors")
        return _get(f"{server_url}/errors")
    except Exception as e:
        return _daemon_unreachable(server_url, e)


async def get_description(server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Get workflow description and all node docstrings."""
    try:
        graph = _get(f"{server_url}/graph")
    except Exception as e:
        return _daemon_unreachable(server_url, e)
    return {
        "workflow_description": graph.get("workflow_description"),
        "node_descriptions": {
            nid: n.get("docstring") for nid, n in graph.get("nodes", {}).items()
            if n.get("docstring")
        },
    }



# ─── Action Tools ────────────────────────────────────────────────────────────

async def run_pipeline(
    script_path: str,
    args: Optional[list[str]] = None,
    name: Optional[str] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Start a pipeline script via the daemon.

    Args:
        script_path: Path to the Python script.
        args: Command-line arguments for the script.
        name: Optional run name/ID.
    """
    run_id = name or f"run_{int(time.time())}"

    try:
        result = _post(
            f"{server_url}/run",
            {"script_path": script_path, "args": args or [], "run_id": run_id},
        )
        result["source"] = "daemon"
        return result
    except Exception as e:
        # Fallback: start subprocess directly
        import subprocess
        import sys
        import os

        env = os.environ.copy()
        env["NEBO_SERVER_PORT"] = str(server_url.split(":")[-1])
        env["NEBO_RUN_ID"] = run_id
        env["NEBO_MODE"] = "server"

        proc = subprocess.Popen(
            [sys.executable, script_path] + (args or []),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return {"run_id": run_id, "pid": proc.pid, "status": "started", "source": "fallback", "error": str(e)}


async def stop_pipeline(run_id: str, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Stop a running pipeline by run ID."""
    try:
        return _post(f"{server_url}/runs/{run_id}/stop", {})
    except Exception as e:
        return {"error": f"Failed to stop pipeline: {e}"}


async def restart_pipeline(run_id: str, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Stop and re-run a pipeline with the same script and args."""
    try:
        # Get run info first
        run_info = _get(f"{server_url}/runs/{run_id}")

        # Stop if running
        await stop_pipeline(run_id, server_url)

        # Re-run with same params
        return await run_pipeline(
            script_path=run_info["script_path"],
            args=run_info.get("args", []),
            name=f"{run_id}_restart_{int(time.time())}",
            server_url=server_url,
        )
    except Exception as e:
        return {"error": f"Failed to restart pipeline: {e}"}


async def get_run_status(run_id: str, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Get the status of a specific run."""
    try:
        return _get(f"{server_url}/runs/{run_id}")
    except Exception as e:
        return {"error": f"Run '{run_id}' not found: {e}"}


async def get_run_history(server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Get a list of all runs with outcomes, timestamps, and error counts."""
    try:
        return _get(f"{server_url}/runs")
    except Exception as e:
        return {"error": f"Could not get run history: {e}"}


async def get_source_code(file_path: str, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Read a pipeline source file.

    Args:
        file_path: Path to the source file.
    """
    path = Path(file_path)
    if not path.exists():
        return {"error": f"File not found: {file_path}"}
    try:
        content = path.read_text(encoding="utf-8")
        return {"file_path": str(path.resolve()), "content": content, "size": len(content)}
    except Exception as e:
        return {"error": f"Could not read file: {e}"}


async def write_source_code(
    file_path: str,
    content: Optional[str] = None,
    patches: Optional[list[dict[str, str]]] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Write or patch a pipeline source file.

    Args:
        file_path: Path to the source file.
        content: Full file content (replaces entire file).
        patches: List of {old: str, new: str} patches to apply.
    """
    path = Path(file_path)

    if content is not None:
        try:
            path.write_text(content, encoding="utf-8")
            return {"status": "written", "file_path": str(path.resolve()), "size": len(content)}
        except Exception as e:
            return {"error": f"Could not write file: {e}"}

    if patches:
        try:
            current = path.read_text(encoding="utf-8")
            for patch in patches:
                old = patch.get("old", "")
                new = patch.get("new", "")
                if old not in current:
                    return {"error": f"Patch target not found in file: {old[:80]}..."}
                current = current.replace(old, new, 1)
            path.write_text(current, encoding="utf-8")
            return {"status": "patched", "file_path": str(path.resolve()), "patches_applied": len(patches)}
        except Exception as e:
            return {"error": f"Could not patch file: {e}"}

    return {"error": "Either 'content' or 'patches' must be provided"}


async def wait_for_event(
    timeout: float = 300,
    events: Optional[list[str]] = None,
    run_id: Optional[str] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Block until a pipeline event occurs or timeout elapses.

    Args:
        timeout: Max seconds to wait (default 300).
        events: Event types to wait for (default: error, completed, ask_prompt).
        run_id: Run ID. Uses latest run if omitted.
    """
    if events is None:
        events = ["error", "completed", "ask_prompt"]

    # Resolve run_id to latest if not provided
    if not run_id:
        try:
            runs = _get(f"{server_url}/runs")
            active = runs.get("active_run")
            if active:
                run_id = active
            else:
                run_list = runs.get("runs", [])
                if run_list:
                    run_id = run_list[-1]["id"]
                else:
                    return {"error": "No runs found"}
        except Exception as e:
            return {"error": f"Could not resolve run_id: {e}"}

    types_str = ",".join(events)
    since = time.time()
    url = f"{server_url}/runs/{run_id}/events/wait?types={types_str}&timeout={timeout}&since={since}"

    try:
        return _get(url, timeout=timeout + 5)
    except Exception as e:
        return {"error": f"wait_for_event failed: {e}"}


async def load_file(filepath: str, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Load a .nebo file into the daemon."""
    try:
        return _post(f"{server_url}/load", {"filepath": filepath})
    except Exception as e:
        return {"error": f"Failed to load file: {e}"}


async def chat(question: str, run_id: Optional[str] = None, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Ask a question about a run via the daemon's Q&A endpoint."""
    try:
        payload: dict[str, Any] = {"question": question}
        if run_id:
            payload["run_id"] = run_id
        # For MCP, we need the full response (not streaming)
        # Use the /chat endpoint and collect the SSE stream
        url = f"{server_url}/chat"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=120) as resp:
            full_text = ""
            for line_bytes in resp:
                line = line_bytes.decode("utf-8", errors="replace").strip()
                if line.startswith("data: ") and line != "data: [DONE]":
                    try:
                        chunk = json.loads(line[6:])
                        full_text += chunk.get("text", "")
                    except json.JSONDecodeError:
                        pass
            return {"answer": full_text}
    except Exception as e:
        return {"error": f"Chat failed: {e}"}


async def ask_user(question: str, options: Optional[list[str]] = None, server_url: str = _DEFAULT_URL) -> dict[str, Any]:
    """Send a question to the terminal UI for human input."""
    try:
        import uuid
        event = {
            "type": "ask_prompt",
            "ask_id": str(uuid.uuid4()),
            "question": question,
            "options": options,
            "timestamp": time.time(),
        }
        return _post(f"{server_url}/events", [event])
    except Exception as e:
        return {"error": str(e)}


# ─── Write Tools ─────────────────────────────────────────────────────────────
#
# These mirror the SDK's `nb.log_*` helpers as MCP tools so an external
# agent can push data into a run without owning the SDK process. Each
# tool accepts either a single entry or a list of entries; entries
# missing a `run_id` fall back to the tool-level `run_id` argument or
# the daemon's active run.

_DEFAULT_FETCH_TIMEOUT = 30.0
_DEFAULT_FETCH_LIMIT = 10 * 1024 * 1024  # 10 MB


def _normalize_entries(entries: Any) -> list[dict[str, Any]]:
    """Accept either a single entry dict or a list of entry dicts."""
    if entries is None:
        return []
    if isinstance(entries, dict):
        return [entries]
    if isinstance(entries, list):
        return [e for e in entries if isinstance(e, dict)]
    return []


def _post_events(
    server_url: str,
    events: list[dict[str, Any]],
    run_id: Optional[str],
) -> dict[str, Any]:
    """POST a batch of events to the daemon, scoped to `run_id` if given."""
    url = f"{server_url}/events"
    if run_id:
        url = f"{url}?run_id={urllib.request.quote(run_id)}"
    return _post(url, events)


def _ensure_loggable_event(loggable_id: str) -> dict[str, Any]:
    """Idempotent register event so unknown loggables aren't silently dropped."""
    return {
        "type": "loggable_register",
        "loggable_id": loggable_id,
        "data": {"loggable_id": loggable_id, "kind": "global"},
    }


def _fetch_url_as_b64(url: str, timeout: float = _DEFAULT_FETCH_TIMEOUT, limit: int = _DEFAULT_FETCH_LIMIT) -> str:
    """Fetch an HTTP(S) URL and return base64-encoded bytes.

    Bounded by `limit` bytes so a malicious URL can't pin the bridge.
    """
    import base64
    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError(f"only http(s):// URLs supported (got {url[:32]!r})")
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"media at {url} exceeds {limit} byte cap")
    return base64.b64encode(data).decode("ascii")


def _read_inline_data(entry: dict[str, Any]) -> Optional[str]:
    """Pull a base64 payload from `data` (already encoded) or fetch `url`."""
    if "data" in entry and entry["data"]:
        return str(entry["data"])
    if "url" in entry and entry["url"]:
        return _fetch_url_as_b64(str(entry["url"]))
    return None


async def log_metric(
    entries: Any,
    run_id: Optional[str] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Push one or more metric points into a run.

    Each entry: ``{run_id?, loggable_id, name, value, type?, step?, tags?}``.
    `type` is one of ``line`` (default), ``bar``, ``pie``, ``scatter``, ``histogram``.
    """
    items = _normalize_entries(entries)
    if not items:
        return {"error": "no entries provided"}

    # Group events by run_id so we issue one POST per target run.
    by_run: dict[Optional[str], list[dict[str, Any]]] = {}
    for entry in items:
        lid = entry.get("loggable_id")
        if not lid:
            return {"error": "every entry needs a loggable_id"}
        target = entry.get("run_id") or run_id
        bucket = by_run.setdefault(target, [])
        bucket.append(_ensure_loggable_event(lid))
        bucket.append({
            "type": "metric",
            "loggable_id": lid,
            "name": entry.get("name", ""),
            "metric_type": entry.get("type", "line"),
            "value": entry.get("value"),
            "step": entry.get("step"),
            "tags": entry.get("tags") or [],
            "timestamp": time.time(),
        })

    sent = 0
    for target_run, evts in by_run.items():
        try:
            _post_events(server_url, evts, target_run)
            sent += sum(1 for e in evts if e["type"] == "metric")
        except Exception as e:
            return {"error": f"daemon write failed for run={target_run}: {e}", "sent": sent}
    return {"status": "ok", "sent": sent}


def _log_media(
    entries: Any,
    media_type: str,
    run_id: Optional[str],
    server_url: str,
) -> dict[str, Any]:
    """Shared body for log_image / log_audio. `media_type` is `image` or `audio`."""
    items = _normalize_entries(entries)
    if not items:
        return {"error": "no entries provided"}

    by_run: dict[Optional[str], list[dict[str, Any]]] = {}
    for entry in items:
        lid = entry.get("loggable_id")
        if not lid:
            return {"error": "every entry needs a loggable_id"}
        try:
            data_b64 = _read_inline_data(entry)
        except Exception as e:
            return {"error": f"could not load media for {entry.get('name')!r}: {e}"}
        if not data_b64:
            return {"error": f"entry {entry.get('name')!r} needs `url` or `data`"}
        target = entry.get("run_id") or run_id
        bucket = by_run.setdefault(target, [])
        bucket.append(_ensure_loggable_event(lid))
        evt: dict[str, Any] = {
            "type": media_type,
            "loggable_id": lid,
            "name": entry.get("name", ""),
            "data": data_b64,
            "step": entry.get("step"),
            "timestamp": time.time(),
        }
        if media_type == "audio":
            evt["sr"] = entry.get("sr", 16000)
        else:
            if "labels" in entry:
                evt["labels"] = entry["labels"]
        bucket.append(evt)

    sent = 0
    for target_run, evts in by_run.items():
        try:
            _post_events(server_url, evts, target_run)
            sent += sum(1 for e in evts if e["type"] == media_type)
        except Exception as e:
            return {"error": f"daemon write failed for run={target_run}: {e}", "sent": sent}
    return {"status": "ok", "sent": sent}


async def log_image(
    entries: Any,
    run_id: Optional[str] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Push one or more images into a run.

    Each entry: ``{run_id?, loggable_id, name, url? | data?, step?, labels?}``.
    Supply either ``url`` (fetched server-side) or ``data`` (already-base64
    bytes). The daemon stores the bytes via the existing media path so the
    image survives the source URL going stale.
    """
    return _log_media(entries, "image", run_id, server_url)


async def log_audio(
    entries: Any,
    run_id: Optional[str] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Push one or more audio recordings into a run.

    Each entry: ``{run_id?, loggable_id, name, url? | data?, sr?, step?}``.
    """
    return _log_media(entries, "audio", run_id, server_url)


async def log_text(
    entries: Any,
    run_id: Optional[str] = None,
    server_url: str = _DEFAULT_URL,
) -> dict[str, Any]:
    """Push one or more text log entries into a run.

    Each entry: ``{run_id?, loggable_id, message, level?, step?}``. ``level``
    is one of ``info`` (default), ``warning``, ``error``.
    """
    items = _normalize_entries(entries)
    if not items:
        return {"error": "no entries provided"}

    by_run: dict[Optional[str], list[dict[str, Any]]] = {}
    for entry in items:
        lid = entry.get("loggable_id", "__global__")
        target = entry.get("run_id") or run_id
        bucket = by_run.setdefault(target, [])
        bucket.append(_ensure_loggable_event(lid))
        bucket.append({
            "type": "log",
            "loggable_id": lid,
            "message": entry.get("message", ""),
            "level": entry.get("level", "info"),
            "step": entry.get("step"),
            "timestamp": time.time(),
        })

    sent = 0
    for target_run, evts in by_run.items():
        try:
            _post_events(server_url, evts, target_run)
            sent += sum(1 for e in evts if e["type"] == "log")
        except Exception as e:
            return {"error": f"daemon write failed for run={target_run}: {e}", "sent": sent}
    return {"status": "ok", "sent": sent}
