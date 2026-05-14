"""MCP server for nebo.

Exposes both observation tools (query state) and action tools (control pipelines)
via the Model Context Protocol.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

from nebo.mcp import tools


MCP_TOOLS = [
    # ── Observation Tools ──
    {
        "name": "nebo_get_graph",
        "description": "Get the full DAG structure of the running pipeline. Returns nodes (with docstrings, source/non-source status, execution counts), edges, and workflow description.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string", "description": "Optional run ID. Uses latest run if omitted."},
            },
        },
    },
    {
        "name": "nebo_get_loggable_status",
        "description": "Get detailed status for a specific loggable (node or global). Includes execution count, params, docstring, recent logs, errors.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "loggable_id": {"type": "string", "description": "The loggable ID."},
                "run_id": {"type": "string", "description": "Optional run ID."},
            },
            "required": ["loggable_id"],
        },
    },
    {
        "name": "nebo_get_logs",
        "description": "Get recent log entries, optionally filtered by loggable and run.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "loggable_id": {"type": "string", "description": "Optional loggable ID filter."},
                "run_id": {"type": "string", "description": "Optional run ID."},
                "limit": {"type": "integer", "description": "Max entries (default 100)."},
            },
        },
    },
    {
        "name": "nebo_get_metrics",
        "description": "Get metric time series for a loggable.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "loggable_id": {"type": "string", "description": "The loggable ID."},
                "name": {"type": "string", "description": "Optional specific metric name."},
            },
            "required": ["loggable_id"],
        },
    },
    {
        "name": "nebo_get_errors",
        "description": "Get all errors with full tracebacks, node context, and param values.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string", "description": "Optional run ID."},
            },
        },
    },
    {
        "name": "nebo_get_description",
        "description": "Get workflow-level description and all node docstrings.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    # ── Action Tools ──
    {
        "name": "nebo_get_run_status",
        "description": "Get the status of a run: running, completed, crashed, stopped. Includes exit code, duration, error summary.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string", "description": "The run ID."},
            },
            "required": ["run_id"],
        },
    },
    {
        "name": "nebo_get_run_history",
        "description": "List all runs with outcomes, timestamps, and error counts.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "nebo_wait_for_alert",
        "description": "Block until an alert at or above `min_level` fires (via `nb.alert(...)`), or timeout elapses.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string", "description": "Run ID to monitor for alerts."},
                "timeout": {"type": "number", "description": "Max seconds to wait (default 300)."},
                "min_level": {"type": "integer", "description": "Minimum alert level to trigger on (default 20)."},
            },
            "required": ["run_id"],
        },
    },
    {
        "name": "nebo_load_file",
        "description": "Load a .nebo log file into the daemon for viewing and Q&A. The file will appear as a historical run.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "filepath": {
                    "type": "string",
                    "description": "Absolute path to the .nebo file",
                },
            },
            "required": ["filepath"],
        },
    },
    # ── Write Tools ──
    # These mirror the SDK's nb.log_* helpers so an external agent can push
    # data into a run without owning the SDK process. Each tool accepts a
    # single entry or a list — `entries` is the canonical input shape.
    {
        "name": "nebo_log_metric",
        "description": (
            "Log one or more metric points to a run. Mirrors nb.log_line / "
            "log_bar / log_pie / log_scatter / log_histogram from the SDK. "
            "Default chart type is 'line' (accumulating); other types are "
            "snapshots — re-emitting the same name overwrites. "
            "loggable_id defaults to '__agent__' (sandbox for agent-authored "
            "entries) when omitted."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "entries": {
                    "description": "Single entry or list of entries. Each: {run_id?, loggable_id?, name, value, type?, step?, tags?}. loggable_id defaults to '__agent__'.",
                    "oneOf": [
                        {"type": "object"},
                        {"type": "array", "items": {"type": "object"}},
                    ],
                },
                "run_id": {"type": "string", "description": "Default run_id if entries don't specify one."},
            },
            "required": ["entries"],
        },
    },
    {
        "name": "nebo_log_image",
        "description": (
            "Log one or more images to a run. Mirrors nb.log_image. Each "
            "entry supplies either `url` (fetched server-side, persisted) "
            "or `data` (already-base64 bytes). Bytes are stored on the "
            "daemon so the run survives the source URL going stale. "
            "loggable_id defaults to '__agent__' when omitted."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "entries": {
                    "description": "Single entry or list. Each: {run_id?, loggable_id?, name, url? | data?, step?, labels?}. loggable_id defaults to '__agent__'.",
                    "oneOf": [
                        {"type": "object"},
                        {"type": "array", "items": {"type": "object"}},
                    ],
                },
                "run_id": {"type": "string"},
            },
            "required": ["entries"],
        },
    },
    {
        "name": "nebo_log_audio",
        "description": (
            "Log one or more audio recordings to a run. Mirrors "
            "nb.log_audio. Same input shape as nebo_log_image plus an "
            "optional `sr` (sample rate) per entry; default 16000. "
            "loggable_id defaults to '__agent__' when omitted."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "entries": {
                    "description": "Single entry or list. Each: {run_id?, loggable_id?, name, url? | data?, sr?, step?}. loggable_id defaults to '__agent__'.",
                    "oneOf": [
                        {"type": "object"},
                        {"type": "array", "items": {"type": "object"}},
                    ],
                },
                "run_id": {"type": "string"},
            },
            "required": ["entries"],
        },
    },
    {
        "name": "nebo_log_text",
        "description": (
            "Log one or more text entries to a run. Mirrors nb.log. "
            "loggable_id defaults to '__agent__' (sandbox for agent-authored "
            "entries) when omitted."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "entries": {
                    "description": "Single entry or list. Each: {run_id?, loggable_id?, message, level?, step?}.",
                    "oneOf": [
                        {"type": "object"},
                        {"type": "array", "items": {"type": "object"}},
                    ],
                },
                "run_id": {"type": "string"},
            },
            "required": ["entries"],
        },
    },
]


async def handle_tool_call(name: str, arguments: dict[str, Any], server_url: str = "http://localhost:7861") -> Any:
    """Dispatch an MCP tool call to the appropriate handler."""
    handlers = {
        # Observation
        "nebo_get_graph": lambda a: tools.get_graph(a.get("run_id"), server_url),
        "nebo_get_loggable_status": lambda a: tools.get_loggable_status(a["loggable_id"], a.get("run_id"), server_url),
        "nebo_get_logs": lambda a: tools.get_logs(a.get("loggable_id"), a.get("run_id"), a.get("limit", 100), server_url),
        "nebo_get_metrics": lambda a: tools.get_metrics(a["loggable_id"], a.get("name"), server_url),
        "nebo_get_errors": lambda a: tools.get_errors(a.get("run_id"), server_url),
        "nebo_get_description": lambda a: tools.get_description(server_url),
        # Action
        "nebo_get_run_status": lambda a: tools.get_run_status(a["run_id"], server_url),
        "nebo_get_run_history": lambda a: tools.get_run_history(server_url),
        "nebo_wait_for_alert": lambda a: tools.wait_for_alert(a["run_id"], a.get("timeout", 300), a.get("min_level", 20), server_url),
        "nebo_load_file": lambda a: tools.load_file(a["filepath"], server_url),
        # Write
        "nebo_log_metric": lambda a: tools.log_metric(a["entries"], a.get("run_id"), server_url),
        "nebo_log_image": lambda a: tools.log_image(a["entries"], a.get("run_id"), server_url),
        "nebo_log_audio": lambda a: tools.log_audio(a["entries"], a.get("run_id"), server_url),
        "nebo_log_text": lambda a: tools.log_text(a["entries"], a.get("run_id"), server_url),
    }
    handler = handlers.get(name)
    if handler is None:
        return {"error": f"Unknown tool: {name}"}
    return await handler(arguments)


def run_mcp_server(port: int = 7861) -> None:
    """Run the MCP server in stdio mode (JSON-RPC over stdin/stdout)."""
    from nebo.mcp.stdio import run_stdio_bridge
    run_stdio_bridge(port=port)
