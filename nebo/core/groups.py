"""Group-path (and doc-name) validation, shared by the SDK and the daemon.

A group path is a `/`-delimited, filesystem-like identifier for a run group
(e.g. ``"vision/detr/lr-sweep"``). Root is the empty string. Validation is
intentionally strict: paths become directory names under ``meta/docs/`` and
keys in ``tree.json``, so traversal (``..``), separators, control chars, and
the Windows-reserved set are all rejected.
"""

from __future__ import annotations

MAX_DEPTH = 16
MAX_TOTAL = 1024
MAX_COMPONENT = 128

# Path separators, the Windows-reserved punctuation, NUL + control chars.
_FORBIDDEN = set('\\/:*?"<>|') | {chr(c) for c in range(0x20)} | {"\x7f"}


def validate_group_path(path: object) -> str:
    """Return the normalized group path, or raise ``ValueError``.

    ``None`` / ``""`` / ``"/"`` normalize to root (``""``). A non-root path is
    ``/``-joined components with no leading or trailing slash.
    """
    if path is None:
        return ""
    if not isinstance(path, str):
        raise ValueError(f"group must be a string, got {type(path).__name__}")
    stripped = path.strip()
    if stripped in ("", "/"):
        return ""
    trimmed = stripped.strip("/")
    if not trimmed:
        return ""
    if len(trimmed) > MAX_TOTAL:
        raise ValueError(f"group path too long (>{MAX_TOTAL} chars): {path!r}")
    parts = trimmed.split("/")
    if len(parts) > MAX_DEPTH:
        raise ValueError(f"group path too deep (>{MAX_DEPTH} levels): {path!r}")
    for part in parts:
        if not part:
            raise ValueError(f"group path has an empty component: {path!r}")
        if part != part.strip():
            raise ValueError(
                f"group component has leading/trailing whitespace: {part!r}"
            )
        if part in (".", ".."):
            raise ValueError(f"group component may not be '.' or '..': {path!r}")
        if len(part) > MAX_COMPONENT:
            raise ValueError(
                f"group component too long (>{MAX_COMPONENT} chars): {part!r}"
            )
        bad = _FORBIDDEN & set(part)
        if bad:
            shown = "".join(sorted(bad)).encode("unicode_escape").decode()
            raise ValueError(
                f"group component {part!r} has forbidden characters: {shown!r}"
            )
    return "/".join(parts)


def ancestors(path: str) -> list[str]:
    """Every ancestor group of ``path`` including itself, root→leaf order.

    ``"a/b/c"`` → ``["a", "a/b", "a/b/c"]``; root (``""``) → ``[]``.
    """
    if not path:
        return []
    parts = path.split("/")
    return ["/".join(parts[: i + 1]) for i in range(len(parts))]


def validate_doc_name(name: object) -> str:
    """Return the doc filename, or raise ``ValueError``.

    A doc name is a single ``.md`` filename — no path separators, no traversal.
    """
    if not isinstance(name, str) or not name:
        raise ValueError("doc name must be a non-empty string")
    if not name.endswith(".md"):
        raise ValueError(f"doc name must end with .md: {name!r}")
    if name in (".md",):
        raise ValueError("doc name must have a stem before .md")
    if name != name.strip() or len(name) > MAX_COMPONENT:
        raise ValueError(f"invalid doc name: {name!r}")
    if _FORBIDDEN & set(name) or name in (".", ".."):
        raise ValueError(f"doc name has forbidden characters: {name!r}")
    return name
