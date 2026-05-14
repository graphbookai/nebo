"""Install nebo skills into agent-platform-specific locations.

Two platforms are supported:

- ``claude-code``: copies ``SKILL.md`` to ``~/.claude/skills/<name>/SKILL.md``
  (user-level, the default) or ``.claude/skills/<name>/SKILL.md`` under the
  current directory (project-level, ``--project``).

- ``agents-md``: upserts the skill content into ``AGENTS.md`` in the current
  directory. A pair of HTML markers (``<!-- nebo-skill:<name> start -->`` …
  ``<!-- nebo-skill:<name> end -->``) brackets the section so subsequent
  installs replace it instead of duplicating.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Iterable

from . import available_skills, read_skill


PLATFORMS = ("claude-code", "agents-md")


# Allow tests / power users to override the default Claude home.
_CLAUDE_HOME_ENV = "NEBO_CLAUDE_HOME"
_AGENTS_MD_ENV = "NEBO_AGENTS_MD_DIR"


def _resolve_skills(skill: str | None) -> list[str]:
    all_skills = available_skills()
    if skill is None or skill == "all":
        return all_skills
    if skill not in all_skills:
        raise ValueError(
            f"unknown skill {skill!r}; available: {', '.join(all_skills) or 'none'}"
        )
    return [skill]


def _claude_skills_dir(project: bool) -> Path:
    """Resolve the Claude Code skills directory.

    ``NEBO_CLAUDE_HOME`` overrides ``~/.claude`` for tests.
    """
    if project:
        return Path.cwd() / ".claude" / "skills"
    home = os.environ.get(_CLAUDE_HOME_ENV)
    if home:
        return Path(home) / "skills"
    return Path.home() / ".claude" / "skills"


def _agents_md_path() -> Path:
    """Resolve the AGENTS.md path. ``NEBO_AGENTS_MD_DIR`` overrides cwd."""
    base = os.environ.get(_AGENTS_MD_ENV)
    if base:
        return Path(base) / "AGENTS.md"
    return Path.cwd() / "AGENTS.md"


def install_claude_code(skill: str | None = None, project: bool = False) -> list[Path]:
    """Install one or more skills into the Claude Code skills directory.

    Returns the list of written file paths.
    """
    base = _claude_skills_dir(project)
    base.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for name in _resolve_skills(skill):
        target_dir = base / name
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / "SKILL.md"
        target.write_text(read_skill(name), encoding="utf-8")
        written.append(target)
    return written


def install_agents_md(skill: str | None = None) -> Path:
    """Upsert one or more skills into ``AGENTS.md`` in the current dir.

    Idempotent: re-running replaces the bracketed section instead of duplicating.
    """
    path = _agents_md_path()
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    body = existing
    for name in _resolve_skills(skill):
        body = _upsert_section(body, name, read_skill(name))
    if not body.endswith("\n"):
        body += "\n"
    path.write_text(body, encoding="utf-8")
    return path


def _upsert_section(doc: str, name: str, content: str) -> str:
    """Replace or append the ``nebo-skill:<name>`` section in ``doc``."""
    start = f"<!-- nebo-skill:{name} start -->"
    end = f"<!-- nebo-skill:{name} end -->"
    block = f"{start}\n{content.rstrip()}\n{end}"
    pattern = re.compile(
        re.escape(start) + r".*?" + re.escape(end),
        flags=re.DOTALL,
    )
    if pattern.search(doc):
        return pattern.sub(block, doc)
    sep = "" if not doc or doc.endswith("\n\n") else ("\n" if doc.endswith("\n") else "\n\n")
    return doc + sep + block + "\n"


def install(
    platforms: Iterable[str],
    skill: str | None = None,
    project: bool = False,
) -> dict[str, list[Path] | Path]:
    """Install ``skill`` (or all) on each of ``platforms``.

    Returns a dict mapping platform -> path(s) written.
    """
    results: dict[str, list[Path] | Path] = {}
    for platform in platforms:
        if platform == "claude-code":
            results[platform] = install_claude_code(skill=skill, project=project)
        elif platform == "agents-md":
            results[platform] = install_agents_md(skill=skill)
        else:
            raise ValueError(
                f"unknown platform {platform!r}; supported: {', '.join(PLATFORMS)}"
            )
    return results
