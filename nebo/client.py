"""Shared HTTP client for the nebo daemon.

Both `nebo/mcp/tools.py` and `nebo/cli.py` call into this module. It is the
only code outside `nebo/server/` that imports `urllib.request`.

Connection settings resolve in this order:
  1. Explicit kwargs (`url=`, `port=`, `api_token=`).
  2. Environment (`NEBO_URL`, `NEBO_PORT`, `NEBO_API_TOKEN`).
  3. Defaults (`http://localhost:7861`, no token).
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from typing import Any, Optional


DEFAULT_PORT = 7861


def _resolve_url(url: Optional[str] = None, port: Optional[int] = None) -> str:
    if url:
        return url
    env_url = os.environ.get("NEBO_URL")
    if env_url:
        return env_url
    p = port if port is not None else int(os.environ.get("NEBO_PORT") or DEFAULT_PORT)
    return f"http://localhost:{p}"


def _resolve_token(api_token: Optional[str] = None) -> Optional[str]:
    if api_token:
        return api_token
    return os.environ.get("NEBO_API_TOKEN")


def _get(
    path: str,
    *,
    url: Optional[str] = None,
    port: Optional[int] = None,
    api_token: Optional[str] = None,
    timeout: float = 5.0,
) -> Any:
    base = _resolve_url(url=url, port=port)
    token = _resolve_token(api_token)
    full_url = f"{base}{path}"
    req = urllib.request.Request(full_url, method="GET")
    if token:
        req.add_header("X-Nebo-Token", token)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))
