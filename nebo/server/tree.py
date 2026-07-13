"""The run tree: groups + per-run placements, persisted to meta/tree.json.

A **virtual** hierarchy over run_ids — ``.nebo`` files never move; the physical
layout stays flat. ``tree.json`` is the single durable placement store (there
is no birth-placement fallback and no override layer): the ``group`` recorded
at run start only *seeds* the map on first sight, after which the map is
authoritative and every move is explicit.

The daemon holds the tree in RAM and rewrites the whole (tiny) JSON atomically
on each mutation — human/agent-frequency, so a synchronous write is fine. A
``threading.Lock`` guards it because mutations come from both the async HTTP
endpoints and the synchronous ingest seed hook. Group docs are real markdown
files under ``meta/docs/<group-path>/``.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
from pathlib import Path

from nebo.core.groups import ancestors, validate_doc_name, validate_group_path

TREE_VERSION = 1


class TreeConflict(Exception):
    """A mutation refused because it would violate structure (HTTP 409),
    e.g. deleting a non-empty group."""


class TreeStore:
    """Load / mutate / persist ``meta/tree.json`` and ``meta/docs/``."""

    def __init__(self, meta_dir: Path | str) -> None:
        self._meta_dir = Path(meta_dir)
        self._docs_dir = self._meta_dir / "docs"
        self._path = self._meta_dir / "tree.json"
        self._lock = threading.Lock()
        self._groups: dict[str, dict] = {}  # path -> {} (reserved for later)
        self._runs: dict[str, str] = {}     # run_id -> group path ("" = root)
        self._load()

    # -- persistence ---------------------------------------------------

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            doc = json.loads(self._path.read_text())
        except Exception as e:  # noqa: BLE001 — refuse to discard curation
            raise RuntimeError(
                f"nebo: {self._path} is unparseable ({e}). Refusing to start "
                "rather than silently discard run organization — fix or remove "
                "the file."
            )
        self._groups = {k: dict(v or {}) for k, v in (doc.get("groups") or {}).items()}
        self._runs = dict(doc.get("runs") or {})

    def _save(self) -> None:
        self._meta_dir.mkdir(parents=True, exist_ok=True)
        data = {
            "version": TREE_VERSION,
            "groups": self._groups,
            "runs": self._runs,
        }
        tmp = self._path.with_name(self._path.name + ".tmp")
        with tmp.open("w") as f:
            json.dump(data, f, indent=2, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self._path)  # atomic on POSIX and Windows

    # -- helpers -------------------------------------------------------

    def _ensure_group_locked(self, path: str) -> bool:
        """Create ``path`` and all ancestors. Returns True if anything was
        added. Caller holds the lock."""
        added = False
        for gp in ancestors(path):
            if gp not in self._groups:
                self._groups[gp] = {}
                added = True
        return added

    def _group_doc_dir(self, path: str) -> Path:
        return self._docs_dir / path if path else self._docs_dir

    def _list_docs_locked(self, path: str) -> list[str]:
        d = self._group_doc_dir(path)
        if not d.is_dir():
            return []
        names = sorted(p.name for p in d.iterdir() if p.is_file() and p.suffix == ".md")
        # README first, then the rest alphabetically.
        readme = [n for n in names if n.lower() == "readme.md"]
        return readme + [n for n in names if n.lower() != "readme.md"]

    # -- mutations -----------------------------------------------------

    def seed_run(self, run_id: str, group: object) -> bool:
        """Seed-once: record a run's birth group **only if it has no placement
        yet**. A moved run therefore stays moved when its file is re-scanned —
        the header never re-wins. Returns True if the tree changed."""
        gp = validate_group_path(group)
        with self._lock:
            if run_id in self._runs:
                return False
            if not gp:
                return False  # root needs no entry (absent = root)
            self._runs[run_id] = gp
            self._ensure_group_locked(gp)
            self._save()
            return True

    def create_group(self, path: object) -> bool:
        """Create a group (and ancestors). Returns True if newly created,
        False if it already existed. Raises ValueError on a bad/root path."""
        gp = validate_group_path(path)
        if not gp:
            raise ValueError("cannot create the root group")
        with self._lock:
            if gp in self._groups:
                return False
            self._ensure_group_locked(gp)
            self._save()
            return True

    def move_group(self, old: object, new: object) -> None:
        """Rename/move a group subtree: rewrites the group key, all descendant
        group keys, all placements under the subtree (incl. dangling ones), and
        moves the docs directory."""
        old_gp = validate_group_path(old)
        new_gp = validate_group_path(new)
        if not old_gp:
            raise ValueError("cannot move the root group")
        if not new_gp:
            raise ValueError("cannot move a group to root")
        with self._lock:
            if old_gp not in self._groups:
                raise ValueError(f"group not found: {old_gp!r}")
            if new_gp == old_gp:
                return
            if new_gp in self._groups or new_gp.startswith(old_gp + "/"):
                raise TreeConflict(
                    f"cannot move {old_gp!r} onto {new_gp!r} (exists or is a "
                    "descendant)"
                )

            def _remap(gp: str) -> str:
                if gp == old_gp:
                    return new_gp
                if gp.startswith(old_gp + "/"):
                    return new_gp + gp[len(old_gp):]
                return gp

            self._groups = {_remap(gp): v for gp, v in self._groups.items()}
            self._ensure_group_locked(new_gp)
            self._runs = {rid: _remap(gp) for rid, gp in self._runs.items()}

            src = self._group_doc_dir(old_gp)
            if src.is_dir():
                dst = self._group_doc_dir(new_gp)
                dst.parent.mkdir(parents=True, exist_ok=True)
                if dst.exists():
                    shutil.rmtree(dst)
                shutil.move(str(src), str(dst))
            self._save()

    def delete_group(self, path: object, known_run_ids: set[str]) -> None:
        """Delete an empty group. Raises TreeConflict if it has subgroups or
        known member runs. Drops dangling placements pointing at it and its
        docs."""
        gp = validate_group_path(path)
        if not gp:
            raise ValueError("cannot delete the root group")
        with self._lock:
            if gp not in self._groups:
                raise ValueError(f"group not found: {gp!r}")
            if any(g.startswith(gp + "/") for g in self._groups):
                raise TreeConflict(f"group {gp!r} has subgroups")
            members = [
                rid for rid, g in self._runs.items()
                if g == gp and rid in known_run_ids
            ]
            if members:
                raise TreeConflict(
                    f"group {gp!r} still has {len(members)} run(s) — move them "
                    "out first (nebo has no run deletion)"
                )
            del self._groups[gp]
            # Drop dangling placements (unknown runs) that pointed here.
            self._runs = {rid: g for rid, g in self._runs.items() if g != gp}
            doc_dir = self._group_doc_dir(gp)
            if doc_dir.is_dir():
                shutil.rmtree(doc_dir)
            self._save()

    def set_run_group(self, run_id: str, group: object) -> str:
        """Explicitly place a run (override). ``""`` moves it to root (kept as
        an explicit entry so a later re-scan won't re-seed it). Auto-creates
        the target group. Returns the normalized group path."""
        gp = validate_group_path(group)
        with self._lock:
            if gp:
                self._ensure_group_locked(gp)
            self._runs[run_id] = gp
            self._save()
            return gp

    # -- docs ----------------------------------------------------------

    def get_doc(self, path: object, name: object) -> str | None:
        gp = validate_group_path(path)
        doc = validate_doc_name(name)
        fp = self._group_doc_dir(gp) / doc
        if not fp.is_file():
            return None
        return fp.read_text()

    def set_doc(self, path: object, name: object, content: str) -> bool:
        """Write a doc (auto-creating the group). Returns True if the file was
        newly created, False if it overwrote an existing one."""
        gp = validate_group_path(path)
        doc = validate_doc_name(name)
        with self._lock:
            if gp:
                self._ensure_group_locked(gp)
            d = self._group_doc_dir(gp)
            d.mkdir(parents=True, exist_ok=True)
            fp = d / doc
            existed = fp.is_file()
            fp.write_text(content)
            self._save()
            return not existed

    def delete_doc(self, path: object, name: object) -> bool:
        gp = validate_group_path(path)
        doc = validate_doc_name(name)
        fp = self._group_doc_dir(gp) / doc
        if not fp.is_file():
            return False
        fp.unlink()
        return True

    # -- read ----------------------------------------------------------

    def to_payload(self, known_run_ids: set[str]) -> dict:
        """The GET /tree / tree_updated body. Placements are filtered to
        currently-known runs; a placement to a since-deleted group reads as
        root (omitted)."""
        with self._lock:
            groups = {
                gp: {"docs": self._list_docs_locked(gp)}
                for gp in sorted(self._groups)
            }
            runs = {
                rid: gp
                for rid, gp in self._runs.items()
                if rid in known_run_ids and gp and gp in self._groups
            }
        return {"groups": groups, "runs": runs}
