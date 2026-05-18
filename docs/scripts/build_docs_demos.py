"""Run every docs demo and push the resulting runs to the demos Space.

Pipeline:

  1. Walk ``docs/demos/**/*.py``.
  2. For each script, derive a stable ``run_id`` from its path
     (``docs/demos/<section>/<n>_<name>.py`` -> ``docs-<section>-<name>``).
  3. Execute the script with ``NEBO_URI=<build_dir>`` and
     ``NEBO_RUN_ID=<derived>`` so a ``.nebo`` file lands in the build dir
     with the pinned ID.
  4. Call ``nebo load <file> --url $NEBO_DEMOS_URL --api-token $NEBO_DEMOS_TOKEN``
     for each produced ``.nebo`` file.

The derived run IDs are referenced verbatim from the ``.rst`` files'
``<iframe src=...&run=docs-...&...>``. Renaming or moving a script
changes its run ID — fix the ``.rst`` to match.

Usage::

    NEBO_DEMOS_URL=https://graphbookai-nebo-demos.hf.space \\
    NEBO_DEMOS_TOKEN=nb_xxx \\
    uv run python scripts/build_docs_demos.py

    # Dry-run (build .nebo files but skip upload):
    uv run python scripts/build_docs_demos.py --no-upload

    # Only rebuild one section:
    uv run python scripts/build_docs_demos.py --section index
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEMOS_ROOT = REPO_ROOT / "docs" / "demos"


def derive_run_id(script: Path) -> str:
    """``docs/demos/index/1_hello_world.py`` -> ``docs-index-hello-world``.

    Drops a leading ``<digits>_`` from the filename so demos can be
    ordered on disk without that order leaking into the public run ID.
    """
    rel = script.relative_to(DEMOS_ROOT)
    parts = list(rel.with_suffix("").parts)
    parts[-1] = re.sub(r"^\d+_", "", parts[-1])
    return "docs-" + "-".join(parts).replace("_", "-")


def discover_demos(section: str | None) -> list[Path]:
    if not DEMOS_ROOT.exists():
        return []
    scripts = sorted(p for p in DEMOS_ROOT.rglob("*.py") if not p.name.startswith("_"))
    if section:
        scripts = [p for p in scripts if p.relative_to(DEMOS_ROOT).parts[:1] == (section,)]
    return scripts


def run_demo(script: Path, build_dir: Path) -> Path:
    """Execute one demo and return the .nebo file it produced."""
    run_id = derive_run_id(script)
    env = {
        **os.environ,
        "NEBO_URI": str(build_dir),
        "NEBO_RUN_ID": run_id,
        "NEBO_QUIET": "1",
    }
    env.pop("NEBO_NO_STORE", None)
    print(f"  -> running {script.relative_to(REPO_ROOT)} (run_id={run_id})")
    subprocess.run(
        [sys.executable, str(script)],
        cwd=REPO_ROOT,
        env=env,
        check=True,
    )
    matches = sorted(build_dir.glob(f"*_{run_id}.nebo"))
    if not matches:
        raise RuntimeError(
            f"{script.name} did not produce a .nebo file for run_id={run_id} "
            f"in {build_dir}. Did the script call any nb.* function?"
        )
    if len(matches) > 1:
        print(f"     note: multiple files for {run_id}, picking newest: {matches[-1].name}")
    return matches[-1]


def upload(nebo_file: Path, url: str, token: str) -> None:
    print(f"  -> uploading {nebo_file.name} to {url}")
    subprocess.run(
        ["nebo", "load", str(nebo_file), "--url", url, "--api-token", token],
        cwd=REPO_ROOT,
        check=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--build-dir",
        default=str(REPO_ROOT / "build" / "demos"),
        help="Where to write .nebo files (will be wiped first).",
    )
    parser.add_argument(
        "--section",
        help="Only run demos under docs/demos/<section>/ (e.g. 'index').",
    )
    parser.add_argument(
        "--no-upload",
        action="store_true",
        help="Skip the nebo-load step; just produce .nebo files locally.",
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("NEBO_DEMOS_URL"),
        help="Daemon URL. Default: $NEBO_DEMOS_URL.",
    )
    parser.add_argument(
        "--api-token",
        default=os.environ.get("NEBO_DEMOS_TOKEN"),
        help="Daemon API token. Default: $NEBO_DEMOS_TOKEN.",
    )
    args = parser.parse_args()

    build_dir = Path(args.build_dir).resolve()
    if build_dir.exists():
        shutil.rmtree(build_dir)
    build_dir.mkdir(parents=True)

    scripts = discover_demos(args.section)
    if not scripts:
        print(f"No demo scripts found under {DEMOS_ROOT}")
        return 0
    print(f"Found {len(scripts)} demo script(s) under {DEMOS_ROOT}")

    produced: list[Path] = []
    for script in scripts:
        produced.append(run_demo(script, build_dir))

    if args.no_upload:
        print(f"\nWrote {len(produced)} .nebo file(s) to {build_dir}. Skipping upload.")
        return 0

    if not args.url or not args.api_token:
        print(
            "ERROR: --url and --api-token are required for upload. "
            "Set NEBO_DEMOS_URL / NEBO_DEMOS_TOKEN, or pass --no-upload.",
            file=sys.stderr,
        )
        return 2

    for nebo_file in produced:
        upload(nebo_file, args.url, args.api_token)

    print(f"\nUploaded {len(produced)} run(s) to {args.url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
