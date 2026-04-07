"""Q&A backend -- delegates to Claude Code CLI subprocess."""

from __future__ import annotations

import asyncio
import json
import shutil
from typing import AsyncIterator


def build_mcp_config(server_url: str) -> dict:
    """Build MCP config that points Claude Code back to the nebo daemon."""
    return {
        "mcpServers": {
            "nebo": {
                "command": shutil.which("python3") or "python3",
                "args": ["-m", "nebo.mcp.stdio", "--port", server_url.split(":")[-1]],
            }
        }
    }


def build_claude_command(
    question: str,
    run_id: str,
    server_url: str,
) -> list[str]:
    """Build the claude CLI command for Q&A."""
    claude_path = shutil.which("claude")
    if not claude_path:
        raise FileNotFoundError("Claude Code CLI not found. Install it to use Q&A.")

    system_prompt = (
        f"You are analyzing a nebo run (run_id: {run_id}). "
        "Use the nebo MCP tools to inspect the run's graph, logs, metrics, and errors. "
        "Answer the user's question based on what you find."
    )

    return [
        claude_path,
        "--print",
        "--system-prompt", system_prompt,
        "--mcp-config", json.dumps(build_mcp_config(server_url)),
        question,
    ]


async def stream_chat_response(
    question: str,
    run_id: str,
    server_url: str,
) -> AsyncIterator[str]:
    """Spawn claude CLI and stream its response."""
    cmd = build_claude_command(question, run_id, server_url)

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    if process.stdout:
        async for line in process.stdout:
            yield line.decode("utf-8", errors="replace")

    await process.wait()

    if process.returncode != 0 and process.stderr:
        stderr = await process.stderr.read()
        yield f"\n[Error: Claude CLI exited with code {process.returncode}]\n"
