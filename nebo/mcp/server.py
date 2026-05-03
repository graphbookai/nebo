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
        "name": "nebo_run_pipeline",
        "description": "Start a pipeline script. Returns a run_id for tracking.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "script_path": {"type": "string", "description": "Path to the Python script."},
                "args": {"type": "array", "items": {"type": "string"}, "description": "Script arguments."},
                "name": {"type": "string", "description": "Optional run name/ID."},
            },
            "required": ["script_path"],
        },
    },
    {
        "name": "nebo_stop_pipeline",
        "description": "Stop a running pipeline by run ID.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string", "description": "The run ID to stop."},
            },
            "required": ["run_id"],
        },
    },
    {
        "name": "nebo_restart_pipeline",
        "description": "Stop and re-run a pipeline with the same script and args.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string", "description": "The run ID to restart."},
            },
            "required": ["run_id"],
        },
    },
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
        "name": "nebo_get_source_code",
        "description": "Read the pipeline source file.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string", "description": "Path to the source file."},
            },
            "required": ["file_path"],
        },
    },
    {
        "name": "nebo_write_source_code",
        "description": "Write or patch a pipeline source file. Provide either full content or patches.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string", "description": "Path to the source file."},
                "content": {"type": "string", "description": "Full file content (replaces file)."},
                "patches": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "old": {"type": "string"},
                            "new": {"type": "string"},
                        },
                    },
                    "description": "List of {old, new} patches to apply.",
                },
            },
            "required": ["file_path"],
        },
    },
    {
        "name": "nebo_wait_for_event",
        "description": "Block until a pipeline event occurs or timeout. Returns event details on match, or timeout status.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "timeout": {"type": "number", "description": "Max seconds to wait (default 300)."},
                "events": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Event types to wait for: error, completed, ask_prompt (default all three).",
                },
                "run_id": {"type": "string", "description": "Run ID. Uses latest run if omitted."},
            },
        },
    },
    {
        "name": "nebo_ask_user",
        "description": "Send a question to the user via the terminal dashboard.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "The question to ask."},
                "options": {"type": "array", "items": {"type": "string"}, "description": "Valid response options."},
            },
            "required": ["question"],
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
    {
        "name": "nebo_chat",
        "description": "Ask a question about a run. Uses the run's logs, metrics, graph, and errors to generate an answer.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The question to ask about the run",
                },
                "run_id": {
                    "type": "string",
                    "description": "The run ID to query. If omitted, uses the active run.",
                },
            },
            "required": ["question"],
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
            "snapshots — re-emitting the same name overwrites."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "entries": {
                    "description": "Single entry or list of entries. Each: {run_id?, loggable_id, name, value, type?, step?, tags?}.",
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
            "daemon so the run survives the source URL going stale."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "entries": {
                    "description": "Single entry or list. Each: {run_id?, loggable_id, name, url? | data?, step?, labels?}.",
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
            "optional `sr` (sample rate) per entry; default 16000."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "entries": {
                    "description": "Single entry or list. Each: {run_id?, loggable_id, name, url? | data?, sr?, step?}.",
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
            "loggable_id defaults to '__global__' when omitted."
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
        "nebo_run_pipeline": lambda a: tools.run_pipeline(a["script_path"], a.get("args"), a.get("name"), server_url),
        "nebo_stop_pipeline": lambda a: tools.stop_pipeline(a["run_id"], server_url),
        "nebo_restart_pipeline": lambda a: tools.restart_pipeline(a["run_id"], server_url),
        "nebo_get_run_status": lambda a: tools.get_run_status(a["run_id"], server_url),
        "nebo_get_run_history": lambda a: tools.get_run_history(server_url),
        "nebo_get_source_code": lambda a: tools.get_source_code(a["file_path"], server_url),
        "nebo_write_source_code": lambda a: tools.write_source_code(a["file_path"], a.get("content"), a.get("patches"), server_url),
        "nebo_wait_for_event": lambda a: tools.wait_for_event(a.get("timeout", 300), a.get("events"), a.get("run_id"), server_url),
        "nebo_ask_user": lambda a: tools.ask_user(a["question"], a.get("options"), server_url),
        "nebo_load_file": lambda a: tools.load_file(a["filepath"], server_url),
        "nebo_chat": lambda a: tools.chat(a["question"], a.get("run_id"), server_url),
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
