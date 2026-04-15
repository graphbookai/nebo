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
        """Write a single log entry."""
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

    def read_next_entry(self) -> Optional[dict[str, Any]]:
        """Read the next entry. Returns None at EOF."""
        type_data = self._stream.read(1)
        if not type_data:
            return None

        type_byte = struct.unpack(">B", type_data)[0]
        size = struct.unpack(">I", self._stream.read(4))[0]
        payload_bytes = self._stream.read(size)
        payload = msgpack.unpackb(payload_bytes, raw=False)

        entry_type = ENTRY_TYPES_REVERSE.get(type_byte, f"unknown_{type_byte}")
        return {"type": entry_type, "payload": payload}

    def skip_next_entry(self) -> bool:
        """Skip the next entry without parsing payload. Returns False at EOF."""
        type_data = self._stream.read(1)
        if not type_data:
            return False

        size = struct.unpack(">I", self._stream.read(4))[0]
        self._stream.seek(size, 1)  # seek relative to current position
        return True

    def read_entries(self) -> Iterator[dict[str, Any]]:
        """Iterate over all entries."""
        while True:
            entry = self.read_next_entry()
            if entry is None:
                break
            yield entry
