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
    assert version == 1

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
