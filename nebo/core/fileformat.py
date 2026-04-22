"""Nebo binary file format -- append-only, MessagePack-based log files.

File structure:
    [Header]
      magic: b"nebo" (4 bytes)
      version: u16 big-endian (currently 3)
      metadata_size: u32 big-endian
      metadata: msgpack map {run_id, script_path, started_at, nebo_version, args}

    [Entry]*
      type_byte: u8 (entry type index)
      size: u32 big-endian (payload size in bytes)
      payload: msgpack map (entry-specific data)

Format versions:
    v1: top-level / entry-type names used the legacy ``node`` /
        ``node_register`` / ``data.node_id`` spelling. In-memory events have
        since been renamed to ``loggable_id`` / ``loggable_register`` /
        ``data.loggable_id``, so the reader translates v1 files on the way
        out for backwards compatibility.
    v2: writes ``loggable_id`` / ``loggable_register`` / ``data.loggable_id``
        natively. Adds a new entry-type code ``loggable_register`` = 16.
        The legacy ``node_register`` code (4) stays in the table so v1 files
        decode. Labels on image events pass through unchanged.
    v3: metric entries carry ``metric_type`` and ``tags`` inline on the
        payload. On read, v2 metric entries are upgraded on the fly:
        ``metric_type`` defaults to ``"line"`` and ``tags`` defaults to ``[]``.
        The on-disk format is otherwise identical to v2.
"""

from __future__ import annotations

import struct
import time
from typing import Any, BinaryIO, Iterator, Optional

import msgpack

FORMAT_VERSION = 3
MAGIC = b"nebo"

# Entry-type string -> on-disk integer code.
#
# Codes are part of the on-disk format and must never be reassigned (doing so
# would break backwards compatibility with existing .nebo files). New entry
# types get the next free integer.
#
# ``node_register`` (code 4) is retained purely for reading v1 files; v2
# writers emit ``loggable_register`` (code 16) instead.
ENTRY_TYPES = {
    "log": 0,
    "metric": 1,
    "image": 2,
    "audio": 3,
    "node_register": 4,  # v1-only; kept for backward read compat
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
    "loggable_register": 19,  # v2: replaces node_register
}

ENTRY_TYPES_REVERSE = {v: k for k, v in ENTRY_TYPES.items()}


# --- v1 -> in-memory translation --------------------------------------------
#
# v1 .nebo files stored the legacy field names:
#   * top-level field   : ``node``              (in-memory: ``loggable_id``)
#   * entry / type name : ``node_register``     (in-memory: ``loggable_register``)
#   * nested in ``data``: ``node_id``           (in-memory: ``loggable_id``)
#
# v2 writes the in-memory shape directly, so these translators are only
# invoked when the reader detects a v1 file header.


def _v1_entry_type_to_in_memory(entry_type: str) -> str:
    """v1 on-disk entry type -> in-memory entry type."""
    if entry_type == "node_register":
        return "loggable_register"
    return entry_type


def _v1_payload_to_in_memory(payload: dict[str, Any]) -> dict[str, Any]:
    """v1 on-disk payload -> in-memory payload (node -> loggable_id)."""
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
    """Append-only writer for .nebo files (emits format v3)."""

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

        v2 is passthrough: the in-memory event dict is serialized as-is, so
        ``loggable_id`` / ``loggable_register`` / ``data.loggable_id`` land on
        disk verbatim. Labels (e.g. on image events) pass through unchanged.
        """
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
    """Reader for .nebo files (supports formats v1, v2, and v3)."""

    def __init__(self, stream: BinaryIO) -> None:
        self._stream = stream
        # Populated by read_header(); None until the header has been parsed.
        # Raw-read paths that skip read_header() default to treating data as
        # the current format (passthrough), which matches all freshly-written
        # files.
        self._version: Optional[int] = None

    def read_header(self) -> dict[str, Any]:
        """Read and validate the file header. Returns metadata dict."""
        magic = self._stream.read(4)
        if magic != MAGIC:
            raise ValueError(f"Not a .nebo file: invalid magic {magic!r}")

        version = struct.unpack(">H", self._stream.read(2))[0]
        if version > FORMAT_VERSION:
            raise ValueError(f"Unsupported .nebo format version {version}")
        self._version = version

        meta_size = struct.unpack(">I", self._stream.read(4))[0]
        meta_bytes = self._stream.read(meta_size)
        return msgpack.unpackb(meta_bytes, raw=False)

    def read_next_entry_raw(self) -> Optional[dict[str, Any]]:
        """Read the next entry in its raw on-disk shape (no translation).

        For v2 files this is the same as :meth:`read_next_entry`. For v1 files
        the returned dict carries the legacy field names (``node``,
        ``node_register``, ``data.node_id``). Returns None at EOF.
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

        For v3 files the entry passes through unchanged. For v1 files the
        legacy on-disk spellings (``node`` / ``node_register`` /
        ``data.node_id``) are rewritten to their in-memory equivalents
        (``loggable_id`` / ``loggable_register`` / ``data.loggable_id``).
        For v2 (and older) metric entries, ``metric_type`` and ``tags`` are
        synthesized onto the payload (``"line"`` / ``[]``) since they did
        not exist on-disk prior to v3. Returns None at EOF.
        """
        entry = self.read_next_entry_raw()
        if entry is None:
            return None
        if self._version == 1:
            entry = {
                "type": _v1_entry_type_to_in_memory(entry["type"]),
                "payload": _v1_payload_to_in_memory(entry["payload"]),
            }
        # v2 files predate metric_type / tags; synthesize defaults so callers
        # never have to care what format version produced the file.
        if self._version is not None and self._version <= 2:
            if entry["type"] == "metric" and isinstance(entry["payload"], dict):
                payload = dict(entry["payload"])
                payload.setdefault("metric_type", "line")
                payload.setdefault("tags", [])
                entry = {"type": entry["type"], "payload": payload}
        return entry

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
