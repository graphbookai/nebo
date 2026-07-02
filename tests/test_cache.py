"""Tests for the daemon's SQLite write-behind cache (nebo/server/cache.py)."""

from __future__ import annotations

import os
import time

from nebo.server.cache import (
    SCHEMA_VERSION,
    RunCache,
    resolve_cache_path,
    sweep_cache_dir,
)


def _mk(tmp_path) -> RunCache:
    c = RunCache(tmp_path / "cache.db", logdir=tmp_path / "logs")
    c.start()
    return c


class TestRunCacheCore:
    def test_schema_created_with_meta(self, tmp_path):
        c = _mk(tmp_path)
        try:
            row = c._read_conn().execute(
                "SELECT value FROM meta WHERE key='schema_version'"
            ).fetchone()
            assert row[0] == SCHEMA_VERSION
        finally:
            c.close()

    def test_logdir_recorded_in_meta(self, tmp_path):
        c = _mk(tmp_path)
        try:
            row = c._read_conn().execute(
                "SELECT value FROM meta WHERE key='logdir'"
            ).fetchone()
            assert row[0].endswith("logs")
        finally:
            c.close()

    def test_logdir_mismatch_recreates(self, tmp_path):
        c = _mk(tmp_path)
        c.enqueue(("log_row", "r1", "__global__", "text", 1.0, None, "info", "x"))
        assert c.flush()
        c.close()

        c2 = RunCache(tmp_path / "cache.db", logdir=tmp_path / "other")
        c2.start()
        try:
            row = c2._read_conn().execute(
                "SELECT value FROM meta WHERE key='logdir'"
            ).fetchone()
            assert row[0].endswith("other")
            # Recreated from scratch: the old row is gone.
            n = c2._read_conn().execute("SELECT COUNT(*) FROM logs").fetchone()[0]
            assert n == 0
        finally:
            c2.close()

    def test_reopen_same_logdir_preserves_data(self, tmp_path):
        c = _mk(tmp_path)
        c.enqueue(("log_row", "r1", "__global__", "text", 1.0, None, "info", "x"))
        assert c.flush()
        c.close()

        c2 = _mk(tmp_path)
        try:
            n = c2._read_conn().execute("SELECT COUNT(*) FROM logs").fetchone()[0]
            assert n == 1
        finally:
            c2.close()

    def test_write_behind_flush_barrier(self, tmp_path):
        c = _mk(tmp_path)
        try:
            c.enqueue(("log_row", "r1", "__global__", "text", 1.0, None, "info", "hello"))
            assert c.flush(timeout=5.0)
            n = c._read_conn().execute(
                "SELECT COUNT(*) FROM logs WHERE run_id='r1'"
            ).fetchone()[0]
            assert n == 1
        finally:
            c.close()

    def test_close_flushes_pending(self, tmp_path):
        c = _mk(tmp_path)
        c.enqueue(("log_row", "r1", "__global__", "text", 1.0, None, "info", "bye"))
        c.close()
        import sqlite3

        conn = sqlite3.connect(tmp_path / "cache.db")
        try:
            n = conn.execute("SELECT COUNT(*) FROM logs").fetchone()[0]
            assert n == 1
        finally:
            conn.close()


class TestCachePathAndSweep:
    def test_resolve_cache_path_stable(self, tmp_path):
        a = resolve_cache_path(tmp_path / "x")
        b = resolve_cache_path(tmp_path / "x")
        assert a == b
        assert a.suffix == ".db"

    def test_resolve_cache_path_distinct_per_logdir(self, tmp_path):
        a = resolve_cache_path(tmp_path / "x")
        b = resolve_cache_path(tmp_path / "y")
        assert a != b

    def test_sweep_cache_dir(self, tmp_path):
        old = tmp_path / "old.db"
        new = tmp_path / "new.db"
        old.write_bytes(b"")
        new.write_bytes(b"")
        stale = time.time() - 40 * 86400
        os.utime(old, (stale, stale))
        deleted = sweep_cache_dir(tmp_path, 30)
        assert old in deleted
        assert not old.exists()
        assert new.exists()

    def test_sweep_missing_dir_is_noop(self, tmp_path):
        assert sweep_cache_dir(tmp_path / "nope", 30) == []
