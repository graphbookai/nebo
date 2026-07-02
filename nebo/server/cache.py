"""Daemon-internal SQLite cache — disposable, rebuildable, write-behind.

`.nebo` files remain the sole source of truth; this cache is derived
state. Deleting the database never loses data that exists in a `.nebo`
file (network-mode runs logged without --save-files are the documented
exception — they are ephemeral by user choice).

Design:
  * Ingest keeps mutating RAM synchronously (the hot path is untouched)
    and additionally enqueues typed ops here. A single background writer
    thread drains the queue and applies ops in one transaction per batch
    (WAL journal, synchronous=NORMAL).
  * Reads open thread-local connections; WAL allows concurrent readers
    alongside the writer.
  * `flush()` is a barrier: it returns once every op enqueued before it
    has been committed.

The cache lives at ``~/.nebo/cache/<sha1(logdir)[:16]>.db`` (see
`resolve_cache_path`). `meta` rows record the schema version and the
logdir the db was built for; a mismatch on open drops and recreates the
database (it is a cache — rebuild is always safe).
"""

from __future__ import annotations

import hashlib
import logging
import queue
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "1"

DEFAULT_RAM_BUDGET_MB = 384
BYTES_PER_POINT = 372  # measured: dict-per-point daemon entry overhead
DEFAULT_MEDIA_LRU_MB = 256
DEFAULT_RETENTION_DAYS = 30

_SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY, script_path TEXT, run_name TEXT, args_json TEXT,
  started_at REAL, ended_at REAL, source TEXT,
  workflow_description TEXT, config_json TEXT, ui_config_json TEXT,
  run_config_json TEXT, edges_json TEXT
);
CREATE TABLE loggables (
  run_id TEXT, loggable_id TEXT, kind TEXT, func_name TEXT, docstring TEXT,
  grp TEXT, ui_hints_json TEXT, params_json TEXT,
  exec_count INTEGER DEFAULT 0, is_source INTEGER DEFAULT 1, progress_json TEXT,
  PRIMARY KEY (run_id, loggable_id)
);
CREATE TABLE metrics (
  run_id TEXT, loggable_id TEXT, name TEXT, metric_type TEXT,
  step INTEGER, ts REAL, value_json TEXT, tags_json TEXT, colors INTEGER
);
CREATE INDEX idx_metrics ON metrics(run_id, loggable_id, name, step);
CREATE TABLE logs (
  run_id TEXT, loggable_id TEXT, name TEXT, ts REAL, step INTEGER,
  level TEXT, message TEXT
);
CREATE INDEX idx_logs ON logs(run_id, ts);
CREATE TABLE errors (run_id TEXT, ts REAL, json TEXT);
CREATE TABLE alerts (run_id TEXT, ts REAL, json TEXT);
CREATE TABLE significant_events (run_id TEXT, ts REAL, type TEXT, json TEXT);
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT, loggable_id TEXT, media_id TEXT, kind TEXT,
  name TEXT, step INTEGER, ts REAL, sr INTEGER, labels_json TEXT,
  src_path TEXT, src_offset INTEGER, src_length INTEGER
);
CREATE INDEX idx_media_run ON media(run_id, loggable_id);
CREATE INDEX idx_media_mid ON media(media_id);
CREATE TABLE media_blobs (media_id TEXT PRIMARY KEY, blob BLOB);
CREATE TABLE watch_files (
  path TEXT PRIMARY KEY, run_id TEXT, offset INTEGER, size INTEGER, mtime REAL
);
"""


def resolve_cache_path(logdir: Optional[Path | str]) -> Path:
    """Cache db path for a logdir: ~/.nebo/cache/<sha1(abs path)[:16]>.db."""
    key = str(Path(logdir).resolve()) if logdir is not None else ""
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
    return Path.home() / ".nebo" / "cache" / f"{digest}.db"


def sweep_cache_dir(
    cache_dir: Path, retention_days: int, *, now: Optional[float] = None,
) -> list[Path]:
    """Delete cache dbs whose mtime is older than the retention window.

    A db's mtime advances whenever its daemon runs, so a stale mtime
    means no daemon has served that logdir within the window. Returns
    the deleted paths. Safe by the disposability invariant.
    """
    if now is None:
        now = time.time()
    cutoff = now - retention_days * 86400
    deleted: list[Path] = []
    try:
        entries = list(Path(cache_dir).glob("*.db"))
    except OSError:
        return deleted
    if not Path(cache_dir).is_dir():
        return deleted
    for path in entries:
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                for suffix in ("-wal", "-shm"):
                    side = path.with_name(path.name + suffix)
                    if side.exists():
                        side.unlink()
                deleted.append(path)
        except OSError:
            continue
    return deleted


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


class RunCache:
    """Write-behind SQLite store for daemon run state."""

    def __init__(
        self,
        path: Path | str,
        logdir: Optional[Path | str] = None,
        media_lru_mb: int = DEFAULT_MEDIA_LRU_MB,
    ) -> None:
        self._path = Path(path)
        self._logdir = str(Path(logdir).resolve()) if logdir is not None else ""
        self._media_lru_mb = media_lru_mb
        self._queue: queue.Queue[Any] = queue.Queue()
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._local = threading.local()

    # -- lifecycle -----------------------------------------------------

    def start(self) -> None:
        """Open (or recreate) the database and start the writer thread."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if self._path.exists() and not self._meta_matches():
            self._delete_db_files()
        if not self._path.exists():
            self._create_db()
        self._running = True
        self._thread = threading.Thread(
            target=self._writer_loop, daemon=True, name="nebo-cache-writer"
        )
        self._thread.start()

    def close(self) -> None:
        """Flush pending ops, stop the writer thread, close connections."""
        if not self._running:
            return
        self._running = False
        self._queue.put(None)  # poison pill; writer drains the rest first
        if self._thread is not None:
            self._thread.join(timeout=10.0)
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None

    def _meta_matches(self) -> bool:
        try:
            conn = sqlite3.connect(self._path)
            try:
                rows = dict(
                    conn.execute("SELECT key, value FROM meta").fetchall()
                )
            finally:
                conn.close()
        except sqlite3.Error:
            return False
        return (
            rows.get("schema_version") == SCHEMA_VERSION
            and rows.get("logdir") == self._logdir
        )

    def _delete_db_files(self) -> None:
        for path in (
            self._path,
            self._path.with_name(self._path.name + "-wal"),
            self._path.with_name(self._path.name + "-shm"),
        ):
            try:
                path.unlink()
            except FileNotFoundError:
                pass

    def _create_db(self) -> None:
        conn = sqlite3.connect(self._path)
        try:
            # auto_vacuum must be set before any table exists.
            conn.execute("PRAGMA auto_vacuum=INCREMENTAL")
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(_SCHEMA)
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('schema_version', ?)",
                (SCHEMA_VERSION,),
            )
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('logdir', ?)",
                (self._logdir,),
            )
            conn.commit()
        finally:
            conn.close()

    # -- write-behind --------------------------------------------------

    def enqueue(self, op: tuple) -> None:
        """Queue a typed op for the writer thread. Thread-safe, non-blocking."""
        if self._running:
            self._queue.put(op)

    def flush(self, timeout: float = 5.0) -> bool:
        """Barrier: block until every previously-enqueued op is committed."""
        if not self._running:
            return True
        event = threading.Event()
        self._queue.put(("__barrier__", event))
        return event.wait(timeout)

    def incremental_vacuum(self) -> None:
        """Reclaim freed pages opportunistically (janitor calls this)."""
        self.enqueue(("__vacuum__",))

    def _writer_loop(self) -> None:
        conn = _connect(self._path)
        try:
            while True:
                try:
                    first = self._queue.get(timeout=0.25)
                except queue.Empty:
                    if not self._running:
                        break
                    continue
                batch: list[Any] = [first]
                while True:
                    try:
                        batch.append(self._queue.get_nowait())
                    except queue.Empty:
                        break
                stop = self._apply_batch(conn, batch)
                if stop:
                    break
        finally:
            conn.commit()
            conn.close()

    def _apply_batch(self, conn: sqlite3.Connection, batch: list[Any]) -> bool:
        """Apply ops in order inside one transaction. Returns True on poison pill."""
        stop = False
        barriers: list[threading.Event] = []
        for op in batch:
            if op is None:
                stop = True
                continue  # keep draining ops that were queued before close()
            kind = op[0]
            if kind == "__barrier__":
                conn.commit()
                for ev in barriers:
                    ev.set()
                barriers = []
                op[1].set()
                continue
            if kind == "__vacuum__":
                conn.commit()
                try:
                    conn.execute("PRAGMA incremental_vacuum")
                except sqlite3.Error:
                    pass
                continue
            try:
                self._apply_op(conn, op)
            except Exception:
                logger.warning("cache: dropping bad op %r", op[:1], exc_info=True)
        conn.commit()
        for ev in barriers:
            ev.set()
        return stop

    def _apply_op(self, conn: sqlite3.Connection, op: tuple) -> None:
        kind = op[0]
        if kind == "log_row":
            _, run_id, lid, name, ts, step, level, message = op
            conn.execute(
                "INSERT INTO logs (run_id, loggable_id, name, ts, step, level, message)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (run_id, lid, name, ts, step, level, message),
            )
        else:
            raise ValueError(f"unknown cache op kind: {kind!r}")

    # -- reads ---------------------------------------------------------

    def _read_conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = _connect(self._path)
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
        return conn
