"""Transport protocol — abstracts the SDK's event sink.

Two implementations live in the codebase:
  * NetworkTransport (nebo/core/client.py) — HTTP POST /events.
  * FileTransport (this module) — append-only .nebo file.

Both share the same in-memory event-dict shape, so SessionState
doesn't care which one is wired up.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class Transport(Protocol):
    def send_event(self, event: dict) -> None: ...
    def flush(self, timeout: float = 5.0) -> bool: ...
    def close(self) -> None: ...
