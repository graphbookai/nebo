"""Tests for .nebo file format."""

import io
import struct
import tempfile
import pytest
import msgpack


def test_write_header():
    """Writer should produce a valid header with magic, version, metadata."""
    from nebo.core.fileformat import NeboFileWriter

    buf = io.BytesIO()
    writer = NeboFileWriter(buf, run_id="test-run", script_path="test.py")
    writer.write_header()
    writer.close()

    buf.seek(0)
    magic = buf.read(4)
    assert magic == b"nebo"

    version = struct.unpack(">H", buf.read(2))[0]
    assert version == 2

    meta_size = struct.unpack(">I", buf.read(4))[0]
    meta = msgpack.unpackb(buf.read(meta_size), raw=False)
    assert meta["run_id"] == "test-run"
    assert meta["script_path"] == "test.py"


def test_write_and_read_entries():
    """Round-trip: write entries then read them back."""
    from nebo.core.fileformat import NeboFileWriter, NeboFileReader

    buf = io.BytesIO()
    writer = NeboFileWriter(buf, run_id="test-run", script_path="test.py")
    writer.write_header()

    writer.write_entry("log", {"node": "my_func", "message": "hello", "timestamp": 1000.0})
    writer.write_entry("metric", {"node": "my_func", "name": "loss", "value": 0.5, "step": 0, "timestamp": 1000.1})
    writer.close()

    buf.seek(0)
    reader = NeboFileReader(buf)
    meta = reader.read_header()
    assert meta["run_id"] == "test-run"

    entries = list(reader.read_entries())
    assert len(entries) == 2
    assert entries[0]["type"] == "log"
    assert entries[0]["payload"]["message"] == "hello"
    assert entries[1]["type"] == "metric"
    assert entries[1]["payload"]["value"] == 0.5


def test_write_binary_media():
    """Images and audio should be stored as raw bytes, not base64."""
    from nebo.core.fileformat import NeboFileWriter, NeboFileReader

    image_bytes = b"\x89PNG\r\n" + b"\x00" * 100

    buf = io.BytesIO()
    writer = NeboFileWriter(buf, run_id="test-run", script_path="test.py")
    writer.write_header()
    writer.write_entry("image", {"node": "my_func", "name": "out", "data": image_bytes, "timestamp": 1000.0})
    writer.close()

    buf.seek(0)
    reader = NeboFileReader(buf)
    reader.read_header()
    entries = list(reader.read_entries())
    assert len(entries) == 1
    assert entries[0]["payload"]["data"] == image_bytes


def test_skip_entry_by_size():
    """Reader should be able to skip entries using the size field."""
    from nebo.core.fileformat import NeboFileWriter, NeboFileReader

    buf = io.BytesIO()
    writer = NeboFileWriter(buf, run_id="test-run", script_path="test.py")
    writer.write_header()
    writer.write_entry("log", {"message": "first"})
    writer.write_entry("log", {"message": "second"})
    writer.write_entry("log", {"message": "third"})
    writer.close()

    buf.seek(0)
    reader = NeboFileReader(buf)
    reader.read_header()

    # Read first entry
    entry = reader.read_next_entry()
    assert entry["payload"]["message"] == "first"

    # Skip second entry
    reader.skip_next_entry()

    # Read third entry
    entry = reader.read_next_entry()
    assert entry["payload"]["message"] == "third"


def test_file_on_disk():
    """Write to a real file and read it back."""
    from nebo.core.fileformat import NeboFileWriter, NeboFileReader

    with tempfile.NamedTemporaryFile(suffix=".nebo", delete=False) as f:
        path = f.name
        writer = NeboFileWriter(f, run_id="disk-test", script_path="script.py")
        writer.write_header()
        writer.write_entry("log", {"message": "from disk"})
        writer.close()

    with open(path, "rb") as f:
        reader = NeboFileReader(f)
        meta = reader.read_header()
        assert meta["run_id"] == "disk-test"
        entries = list(reader.read_entries())
        assert len(entries) == 1
        assert entries[0]["payload"]["message"] == "from disk"

    import os
    os.unlink(path)


def _write_v1_nebo_file(buf, *, run_id: str, script_path: str, entries):
    """Hand-craft a v1-format .nebo file into ``buf``.

    The repo no longer has a v1 writer (v2 is passthrough), so we synthesize
    the v1 header + entries directly to exercise the reader's v1 translation
    path. ``entries`` is a list of ``(entry_type_byte, payload_dict)`` tuples.
    """
    from nebo.core.fileformat import MAGIC

    # Header: magic + version=1 + meta_size + meta
    buf.write(MAGIC)
    buf.write(struct.pack(">H", 1))
    meta_bytes = msgpack.packb(
        {
            "run_id": run_id,
            "script_path": script_path,
            "started_at": 0.0,
            "nebo_version": "0.1.0",
            "args": [],
        },
        use_bin_type=True,
    )
    buf.write(struct.pack(">I", len(meta_bytes)))
    buf.write(meta_bytes)

    # Entries: type_byte (u8) + size (u32 BE) + msgpack payload
    for type_byte, payload in entries:
        payload_bytes = msgpack.packb(payload, use_bin_type=True)
        buf.write(struct.pack(">B", type_byte))
        buf.write(struct.pack(">I", len(payload_bytes)))
        buf.write(payload_bytes)


def test_fileformat_v1_reader_translates_node_to_loggable_id():
    """v1 reader path: on-disk node / node_register -> in-memory loggable_*.

    v2 writes the in-memory shape natively, so the v1 translation only runs
    when the reader encounters an older (v1) file. We craft a v1 file by hand
    to exercise that path.
    """
    from nebo.core.fileformat import NeboFileReader

    # type_byte 0 = "log", type_byte 4 = "node_register" (v1 name)
    buf = io.BytesIO()
    _write_v1_nebo_file(
        buf,
        run_id="translate-test",
        script_path="t.py",
        entries=[
            (0, {"type": "log", "node": "x", "message": "hi", "timestamp": 1.0}),
            (
                4,
                {
                    "type": "node_register",
                    "node": "x",
                    "data": {"node_id": "x", "kind": "fn", "func_name": "x"},
                },
            ),
        ],
    )

    # Raw read preserves the on-disk v1 shape (no translation).
    buf.seek(0)
    raw_reader = NeboFileReader(buf)
    raw_reader.read_header()
    raw_entries = list(raw_reader.read_entries_raw())
    assert raw_entries[0]["type"] == "log"
    assert raw_entries[0]["payload"].get("node") == "x"
    assert "loggable_id" not in raw_entries[0]["payload"]
    assert raw_entries[1]["type"] == "node_register"
    assert raw_entries[1]["payload"].get("node") == "x"
    assert raw_entries[1]["payload"]["type"] == "node_register"
    assert raw_entries[1]["payload"]["data"].get("node_id") == "x"
    assert "loggable_id" not in raw_entries[1]["payload"]["data"]

    # High-level read translates back to loggable_id / loggable_register.
    buf.seek(0)
    reader = NeboFileReader(buf)
    reader.read_header()
    entries = list(reader.read_entries())
    assert entries[0]["type"] == "log"
    assert entries[0]["payload"]["loggable_id"] == "x"
    assert "node" not in entries[0]["payload"]
    assert entries[1]["type"] == "loggable_register"
    assert entries[1]["payload"]["loggable_id"] == "x"
    assert entries[1]["payload"]["type"] == "loggable_register"
    assert entries[1]["payload"]["data"]["loggable_id"] == "x"
    assert "node_id" not in entries[1]["payload"]["data"]
    assert "node" not in entries[1]["payload"]


def test_fileformat_v2_writes_loggable_id_natively():
    """v2 writer stores `loggable_id` on disk (no node translation)."""
    from nebo.core.fileformat import NeboFileWriter, NeboFileReader

    buf = io.BytesIO()
    writer = NeboFileWriter(buf, run_id="r1", script_path="s.py")
    writer.write_header()
    writer.write_entry("log", {"loggable_id": "x", "message": "hi", "timestamp": 1.0})
    writer.close()

    buf.seek(0)
    reader = NeboFileReader(buf)
    reader.read_header()
    raw = list(reader.read_entries_raw())
    assert raw[0]["type"] == "log"
    assert raw[0]["payload"].get("loggable_id") == "x"
    assert "node" not in raw[0]["payload"]


def test_fileformat_v2_preserves_image_labels():
    """Labels round-trip through v2 unchanged."""
    from nebo.core.fileformat import NeboFileWriter, NeboFileReader

    buf = io.BytesIO()
    writer = NeboFileWriter(buf, run_id="r1", script_path="s.py")
    writer.write_header()
    writer.write_entry(
        "image",
        {
            "loggable_id": "x",
            "name": "im",
            "data": "AA==",
            "labels": {"boxes": [[1, 2, 3, 4]], "points": [[5, 6]]},
        },
    )
    writer.close()

    buf.seek(0)
    reader = NeboFileReader(buf)
    reader.read_header()
    events = list(reader.read_entries())
    assert events[0]["payload"]["labels"] == {
        "boxes": [[1, 2, 3, 4]],
        "points": [[5, 6]],
    }
    assert events[0]["payload"]["loggable_id"] == "x"
    assert "node" not in events[0]["payload"]


def test_fileformat_v2_writes_loggable_register_entry_type():
    """v2 writer emits `loggable_register` entry type; raw read sees it."""
    from nebo.core.fileformat import NeboFileWriter, NeboFileReader

    buf = io.BytesIO()
    writer = NeboFileWriter(buf, run_id="r1", script_path="s.py")
    writer.write_header()
    writer.write_entry(
        "loggable_register",
        {
            "loggable_id": "x",
            "data": {"loggable_id": "x", "kind": "node", "func_name": "f"},
        },
    )
    writer.close()

    buf.seek(0)
    reader = NeboFileReader(buf)
    reader.read_header()
    raw = list(reader.read_entries_raw())
    assert raw[0]["type"] == "loggable_register"
    assert raw[0]["payload"].get("loggable_id") == "x"
    assert "node" not in raw[0]["payload"]
