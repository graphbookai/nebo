"""Nebo binary file format -- append-only, MessagePack-based log files.

File structure:
    [Header]
      magic: b"nebo" (4 bytes)
      version: u16 big-endian (currently 1)
      metadata_size: u32 big-endian
      metadata: msgpack map {run_id, script_path, started_at, nebo_version, args}

    [Entry]*
      type_byte: u8 (entry type index)
      size: u32 big-endian (payload size in bytes)
      payload: msgpack map (entry-specific data)
"""

from __future__ import annotations

import struct
import time
from typing import Any, BinaryIO, Iterator, Optional

import msgpack

FORMAT_VERSION = 1
MAGIC = b"nebo"

ENTRY_TYPES = {
    "log": 0,
    "metric": 1,
    "image": 2,
    "audio": 3,
    "node_register": 4,
    "edge": 5,
    "error": 6,
    "ask": 7,
    "ui_config": 8,
    "text": 9,
    "progress": 10,
    "config": 11,
    "description": 12,
    "node_executed": 13,
    "ask_response": 14,
    "run_start": 15,
    "run_completed": 16,
    "pause_state": 17,
    "run_config": 18,
}

ENTRY_TYPES_REVERSE = {v: k for k, v in ENTRY_TYPES.items()}


# --- Translation between in-memory and on-disk shapes -----------------------
#
# The on-disk .nebo format retains legacy field names for backwards
# compatibility:
#   * top-level field   : ``node``              (in-memory: ``loggable_id``)
#   * entry / type name : ``node_register``     (in-memory: ``loggable_register``)
#   * nested in ``data``: ``node_id``           (in-memory: ``loggable_id``)
#
# The integer entry-type code table (``ENTRY_TYPES``) is part of the on-disk
# format and therefore keeps the legacy ``"node_register"`` spelling. These
# helpers translate the event dict (and the entry-type string) at the
# write/read boundary so callers always see the in-memory shape.


def _to_disk_entry_type(entry_type: str) -> str:
    """In-memory entry type -> on-disk entry type."""
    if entry_type == "loggable_register":
        return "node_register"
    return entry_type


def _from_disk_entry_type(entry_type: str) -> str:
    """On-disk entry type -> in-memory entry type."""
    if entry_type == "node_register":
        return "loggable_register"
    return entry_type


def _to_disk_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """In-memory payload -> on-disk payload (loggable_id -> node)."""
    if not isinstance(payload, dict):
        return payload
    out = dict(payload)
    if "loggable_id" in out:
        out["node"] = out.pop("loggable_id")
    # Translate the redundant ``type`` field that callers include in the payload.
    if out.get("type") == "loggable_register":
        out["type"] = "node_register"
    # Translate nested data.loggable_id -> data.node_id.
    data = out.get("data")
    if isinstance(data, dict) and "loggable_id" in data:
        new_data = dict(data)
        new_data["node_id"] = new_data.pop("loggable_id")
        out["data"] = new_data
    return out


def _from_disk_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """On-disk payload -> in-memory payload (node -> loggable_id)."""
    if not isinstance(payload, dict):
        return payload
    out = dict(payload)
    if "node" in out:
        out["loggable_id"] = out.pop("node")
    if out.get("type") == "node_register":
        out["type"] = "loggable_register"
    data = out.get("data")
    if isinstance(data, dict) and "node_id" in data:
        new_data = dict(data)
        new_data["loggable_id"] = new_data.pop("node_id")
        out["data"] = new_data
    return out


class NeboFileWriter:
    """Append-only writer for .nebo files."""

    def __init__(
        self,
        stream: BinaryIO,
        run_id: str,
        script_path: str,
        args: Optional[list[str]] = None,
    ) -> None:
        self._stream = stream
        self._run_id = run_id
        self._script_path = script_path
        self._args = args or []
        self._started_at = time.time()

    def write_header(self) -> None:
        """Write the file header (magic, version, metadata)."""
        self._stream.write(MAGIC)
        self._stream.write(struct.pack(">H", FORMAT_VERSION))

        metadata = {
            "run_id": self._run_id,
            "script_path": self._script_path,
            "started_at": self._started_at,
            "nebo_version": "0.1.0",
            "args": self._args,
        }
        meta_bytes = msgpack.packb(metadata, use_bin_type=True)
        self._stream.write(struct.pack(">I", len(meta_bytes)))
        self._stream.write(meta_bytes)
        self._stream.flush()

    def write_entry(self, entry_type: str, payload: dict[str, Any]) -> None:
        """Write a single log entry.

        Translates the in-memory ``loggable_id`` / ``loggable_register`` naming
        to the on-disk ``node`` / ``node_register`` naming before writing.
        """
        entry_type = _to_disk_entry_type(entry_type)
        payload = _to_disk_payload(payload)
        type_byte = ENTRY_TYPES.get(entry_type, 255)
        payload_bytes = msgpack.packb(payload, use_bin_type=True)

        self._stream.write(struct.pack(">B", type_byte))
        self._stream.write(struct.pack(">I", len(payload_bytes)))
        self._stream.write(payload_bytes)
        self._stream.flush()

    def close(self) -> None:
        """Flush the stream."""
        self._stream.flush()


class NeboFileReader:
    """Reader for .nebo files."""

    def __init__(self, stream: BinaryIO) -> None:
        self._stream = stream

    def read_header(self) -> dict[str, Any]:
        """Read and validate the file header. Returns metadata dict."""
        magic = self._stream.read(4)
        if magic != MAGIC:
            raise ValueError(f"Not a .nebo file: invalid magic {magic!r}")

        version = struct.unpack(">H", self._stream.read(2))[0]
        if version > FORMAT_VERSION:
            raise ValueError(f"Unsupported .nebo format version {version}")

        meta_size = struct.unpack(">I", self._stream.read(4))[0]
        meta_bytes = self._stream.read(meta_size)
        return msgpack.unpackb(meta_bytes, raw=False)

    def read_next_entry_raw(self) -> Optional[dict[str, Any]]:
        """Read the next entry in its raw on-disk shape (no translation).

        The returned dict carries the legacy field names (``node``,
        ``node_register``, ``data.node_id``). Used by tests that verify the
        on-disk format and by any consumer that needs the unmodified payload.
        Returns None at EOF.
        """
        type_data = self._stream.read(1)
        if not type_data:
            return None

        type_byte = struct.unpack(">B", type_data)[0]
        size = struct.unpack(">I", self._stream.read(4))[0]
        payload_bytes = self._stream.read(size)
        payload = msgpack.unpackb(payload_bytes, raw=False)

        entry_type = ENTRY_TYPES_REVERSE.get(type_byte, f"unknown_{type_byte}")
        return {"type": entry_type, "payload": payload}

    def read_next_entry(self) -> Optional[dict[str, Any]]:
        """Read the next entry and translate it to the in-memory shape.

        On-disk ``node`` / ``node_register`` / ``data.node_id`` are rewritten
        to ``loggable_id`` / ``loggable_register`` / ``data.loggable_id``.
        Returns None at EOF.
        """
        entry = self.read_next_entry_raw()
        if entry is None:
            return None
        return {
            "type": _from_disk_entry_type(entry["type"]),
            "payload": _from_disk_payload(entry["payload"]),
        }

    def skip_next_entry(self) -> bool:
        """Skip the next entry without parsing payload. Returns False at EOF."""
        type_data = self._stream.read(1)
        if not type_data:
            return False

        size = struct.unpack(">I", self._stream.read(4))[0]
        self._stream.seek(size, 1)  # seek relative to current position
        return True

    def read_entries_raw(self) -> Iterator[dict[str, Any]]:
        """Iterate over all entries in their raw on-disk shape (no translation)."""
        while True:
            entry = self.read_next_entry_raw()
            if entry is None:
                break
            yield entry

    def read_entries(self) -> Iterator[dict[str, Any]]:
        """Iterate over all entries, translated to the in-memory shape."""
        while True:
            entry = self.read_next_entry()
            if entry is None:
                break
            yield entry
