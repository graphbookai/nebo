"""Nebo-shipped agent skills.

Each subdirectory of `nebo/skills/` is one skill, containing a ``SKILL.md``
file with YAML frontmatter (``name``, ``description``) plus markdown body.
The ``install`` submodule renders these skills into agent-platform-specific
locations (Claude Code skills dir, AGENTS.md, etc.).
"""

from __future__ import annotations

from pathlib import Path

_SKILLS_ROOT = Path(__file__).parent


def skills_root() -> Path:
    """Return the directory containing packaged skills."""
    return _SKILLS_ROOT


def available_skills() -> list[str]:
    """Return the names of skills shipped with this nebo install.

    A directory is a skill iff it contains a ``SKILL.md``.
    """
    out: list[str] = []
    for child in sorted(_SKILLS_ROOT.iterdir()):
        if child.is_dir() and (child / "SKILL.md").exists():
            out.append(child.name)
    return out


def read_skill(name: str) -> str:
    """Return the raw ``SKILL.md`` body for ``name``."""
    path = _SKILLS_ROOT / name / "SKILL.md"
    if not path.exists():
        raise FileNotFoundError(
            f"skill {name!r} not found under {_SKILLS_ROOT} "
            f"(available: {', '.join(available_skills()) or 'none'})"
        )
    return path.read_text(encoding="utf-8")
