"""CLI entry points for nebo.

Commands:
    nebo serve   — Start the persistent daemon server
    nebo status  — Show daemon status and recent runs
    nebo stop    — Stop the daemon
    nebo logs    — View logs from runs
    nebo mcp     — Print MCP connection config for Claude Code
    nebo skill   — List or install nebo-shipped agent skills

Pipelines are launched directly from the shell (e.g. `uv run python
my_script.py`) — the SDK auto-detects a running daemon and connects.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

_PID_DIR = Path.home() / ".nebo"
_PID_FILE = _PID_DIR / "server.pid"


def _write_pid(pid: int) -> None:
    _PID_DIR.mkdir(parents=True, exist_ok=True)
    _PID_FILE.write_text(str(pid))


def _read_pid() -> int | None:
    try:
        if _PID_FILE.exists():
            return int(_PID_FILE.read_text().strip())
    except (ValueError, OSError):
        pass
    return None


def _remove_pid() -> None:
    try:
        _PID_FILE.unlink(missing_ok=True)
    except OSError:
        pass


def _is_alive(port: int) -> bool:
    try:
        import httpx
        resp = httpx.get(f"http://localhost:{port}/health", timeout=2.0)
        return resp.status_code == 200
    except Exception:
        return False


def _process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def cmd_serve(args: argparse.Namespace) -> None:
    """Start the persistent daemon server."""
    port = args.port
    host = args.host

    if _is_alive(port):
        print(f"Nebo daemon is already running on {host}:{port}")
        return

    # --no-store and --store-dir were removed; emit a clear error if someone
    # still passes them (they'd be caught by argparse as unknown args, but
    # if they're typed as known args downstream we'd silently accept). The
    # argparse change above already rejects unknown args; this is belt-and-suspenders.

    logdir_abs = None if args.no_local else Path(args.logdir).resolve()
    save_abs = Path(args.save_files).resolve() if args.save_files else None
    if logdir_abs and save_abs and logdir_abs == save_abs:
        print(
            "nebo serve: --logdir and --save-files cannot be the same directory.\n"
            f"  --logdir:     {logdir_abs}\n"
            f"  --save-files: {save_abs}\n"
            "  Watcher input and writer output would feed back into each other.\n"
            "  Either drop --save-files, set different paths, or pass --no-local.",
            file=sys.stderr,
        )
        sys.exit(2)

    if args.no_local:
        os.environ["NEBO_NO_LOCAL"] = "1"
    if logdir_abs is not None:
        os.environ["NEBO_LOGDIR"] = str(logdir_abs)
    if save_abs is not None:
        os.environ["NEBO_SAVE_FILES"] = str(save_abs)
    if getattr(args, "api_token", None):
        os.environ["NEBO_API_TOKEN"] = args.api_token
    if getattr(args, "read", None):
        os.environ["NEBO_READ_MODE"] = args.read
    if getattr(args, "write", None):
        os.environ["NEBO_WRITE_MODE"] = args.write

    # SQLite cache config (see nebo/server/cache.py). The daemon only
    # builds a cache when NEBO_CACHE_PATH is set, so the default path is
    # resolved here rather than server-side.
    if getattr(args, "no_cache", False):
        os.environ["NEBO_NO_CACHE"] = "1"
    else:
        if getattr(args, "cache_path", None):
            cache_path = Path(args.cache_path).resolve()
        else:
            from nebo.server.cache import resolve_cache_path
            cache_path = resolve_cache_path(logdir_abs)
        os.environ["NEBO_CACHE_PATH"] = str(cache_path)
    if getattr(args, "ram_budget", None):
        os.environ["NEBO_RAM_BUDGET_MB"] = str(args.ram_budget)
    if getattr(args, "media_lru", None):
        os.environ["NEBO_MEDIA_LRU_MB"] = str(args.media_lru)
    if getattr(args, "cache_retention_days", None):
        os.environ["NEBO_CACHE_RETENTION_DAYS"] = str(args.cache_retention_days)

    if args.daemon:
        # Background mode
        cmd = [
            sys.executable, "-m", "uvicorn",
            "nebo.server.daemon:create_daemon_app",
            "--factory",
            "--host", host,
            "--port", str(port),
            "--log-level", "warning",
        ]
        env = os.environ.copy()
        env["NEBO_DAEMON_PORT"] = str(port)
        if args.no_local:
            env["NEBO_NO_LOCAL"] = "1"
        if logdir_abs is not None:
            env["NEBO_LOGDIR"] = str(logdir_abs)
        if save_abs is not None:
            env["NEBO_SAVE_FILES"] = str(save_abs)
        if getattr(args, "api_token", None):
            env["NEBO_API_TOKEN"] = args.api_token
        if getattr(args, "read", None):
            env["NEBO_READ_MODE"] = args.read
        if getattr(args, "write", None):
            env["NEBO_WRITE_MODE"] = args.write
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            env=env,
        )
        _write_pid(proc.pid)

        # Wait for server to come up
        for _ in range(50):
            if _is_alive(port):
                print(f"Nebo daemon started on {host}:{port} (PID {proc.pid})")
                return
            time.sleep(0.1)

        print(f"Nebo daemon started (PID {proc.pid}), but health check pending...")
    else:
        # Foreground mode
        _write_pid(os.getpid())
        os.environ["NEBO_DAEMON_PORT"] = str(port)
        print(f"Starting Nebo daemon on {host}:{port}...")
        print("Press Ctrl+C to stop.\n")
        import uvicorn
        try:
            uvicorn.run(
                "nebo.server.daemon:create_daemon_app",
                factory=True,
                host=host,
                port=port,
                log_level="info",
            )
        except KeyboardInterrupt:
            pass
        finally:
            _remove_pid()
            print("\nNebo daemon stopped.")


def _cache_db_info(path: Path) -> dict:
    """Read a cache db's identity without importing the full cache module."""
    import sqlite3

    logdir = None
    try:
        conn = sqlite3.connect(path)
        try:
            row = conn.execute(
                "SELECT value FROM meta WHERE key='logdir'"
            ).fetchone()
            logdir = row[0] if row else None
        finally:
            conn.close()
    except sqlite3.Error:
        pass
    st = path.stat()
    return {
        "path": str(path),
        "logdir": logdir or None,
        "size_bytes": st.st_size,
        "mtime": st.st_mtime,
    }


def cmd_cache(args: argparse.Namespace) -> None:
    """Inspect or delete daemon cache databases. Pure file operations —
    no daemon required; the cache is disposable by design."""
    cache_dir = Path(
        getattr(args, "cache_dir", None) or Path.home() / ".nebo" / "cache"
    )
    dbs = sorted(cache_dir.glob("*.db")) if cache_dir.is_dir() else []

    if args.cache_command == "ls":
        infos = [_cache_db_info(p) for p in dbs]
        if getattr(args, "json", False):
            print(json.dumps({"caches": infos}))
            return
        if not infos:
            print("no cache databases")
            return
        for info in infos:
            mb = info["size_bytes"] / (1024 * 1024)
            print(f"{info['path']}  {mb:.1f} MB  logdir={info['logdir'] or '?'}")
        return

    if args.cache_command == "clear":
        if getattr(args, "all", False):
            targets = dbs
        elif getattr(args, "logdir", None):
            from nebo.server.cache import resolve_cache_path

            name = resolve_cache_path(args.logdir).name
            resolved = str(Path(args.logdir).resolve())
            targets = [
                p for p in dbs
                if p.name == name or _cache_db_info(p)["logdir"] == resolved
            ]
        else:
            print("nebo cache clear: pass a LOGDIR or --all", file=sys.stderr)
            sys.exit(2)
        if not targets:
            print("nothing matched")
            return
        for p in targets:
            for side in (
                p,
                p.with_name(p.name + "-wal"),
                p.with_name(p.name + "-shm"),
            ):
                try:
                    side.unlink()
                except FileNotFoundError:
                    pass
            print(f"deleted {p}")
        return

    print("usage: nebo cache {ls,clear}", file=sys.stderr)
    sys.exit(2)


def cmd_status(args: argparse.Namespace) -> None:
    """Show daemon status and recent runs."""
    from nebo import client

    try:
        runs = client.get_run_history(**_conn_kwargs(args))
    except Exception:
        print("Nebo daemon is not running.")
        pid = _read_pid()
        if pid:
            print(f"  Stale PID file found: {pid}")
        return

    if args.json:
        print(json.dumps({"daemon": "running", "runs": runs.get("runs", [])}))
        return

    port = getattr(args, "port", None) or int(os.environ.get("NEBO_PORT", 7861))
    print(f"Nebo daemon: running on port {port}")

    run_list = runs.get("runs", [])
    if run_list:
        print(f"\nRecent runs:")
        for r in run_list[-10:]:
            print(f"  {r['id']}: {r.get('script_path', '')} | "
                  f"nodes={r.get('node_count', 0)}, metrics={r.get('metric_series_count', 0)}, "
                  f"logs={r.get('log_count', 0)}")


def cmd_stop(args: argparse.Namespace) -> None:
    """Stop the daemon."""
    port = args.port
    pid = _read_pid()

    if pid and _process_alive(pid):
        os.kill(pid, signal.SIGTERM)
        print(f"Sent SIGTERM to daemon (PID {pid})")
        # Wait for it to die
        for _ in range(30):
            if not _process_alive(pid):
                break
            time.sleep(0.1)
        _remove_pid()
        print("Nebo daemon stopped.")
    elif _is_alive(port):
        print(f"Daemon is running on port {port} but PID unknown. Use kill manually.")
    else:
        print("Nebo daemon is not running.")
        _remove_pid()


def cmd_logs(args: argparse.Namespace) -> None:
    """View logs from runs."""
    from nebo import client

    try:
        result = client.get_logs(
            loggable_id=args.node,
            run_id=args.run,
            limit=args.limit,
            **_conn_kwargs(args),
        )
    except Exception as e:
        print(f"Error: {e}")
        return

    if args.json:
        print(json.dumps(result))
        return

    logs = result.get("logs", [])
    if not logs:
        print("No logs found.")
        return

    for entry in logs:
        node_tag = f"[{entry.get('loggable_id', '?')}]" if entry.get("loggable_id") else ""
        print(f"  {node_tag} {entry.get('message', '')}")


def cmd_mcp(args: argparse.Namespace) -> None:
    """Print MCP connection config for Claude Code."""
    port = getattr(args, "port", 7861)
    nebo_args = ["mcp-stdio"]
    if port != 7861:
        nebo_args += ["--port", str(port)]
    config = {
        "mcpServers": {
            "nebo": {
                "command": "nebo",
                "args": nebo_args,
                "env": {},
            }
        }
    }
    print("# Add this to your Claude Code MCP config (~/.claude/mcp.json):")
    print(json.dumps(config, indent=2))


def _replay_nebo_file_to_remote(filepath: str, base_url: str, api_token: str | None) -> None:
    """Read a .nebo file locally and POST its events to a remote daemon.

    The daemon's `POST /load` accepts a server-side filepath, which
    doesn't exist when the daemon is on a Hugging Face Space and the
    file is on the user's machine. This walks the file with the
    existing reader and pushes events through `/events` instead — same
    wire shape, same auth header, just a different ingress.
    """
    import json as _json
    import urllib.request
    from nebo.core.fileformat import NeboFileReader

    headers = {"Content-Type": "application/json"}
    if api_token:
        headers["X-Nebo-Token"] = api_token

    with open(filepath, "rb") as f:
        reader = NeboFileReader(f)
        meta = reader.read_header()
        run_id = meta["run_id"]

        # Open the run on the remote side. `store=False` so the remote
        # daemon doesn't write a fresh .nebo copy alongside its other
        # runs — the source-of-truth is the file we're uploading.
        events: list[dict] = [{
            "type": "run_start",
            "data": {
                "script_path": meta.get("script_path", os.path.basename(filepath)),
                "store": False,
            },
        }]
        while True:
            entry = reader.read_next_entry()
            if entry is None:
                break
            events.append({"type": entry["type"], **entry["payload"]})

    # Chunk by encoded byte size so a single POST never balloons past
    # what proxies / WAFs accept. 1 MB matches the SDK's own ceiling.
    chunk_limit = 1024 * 1024
    chunks: list[list[dict]] = [[]]
    chunk_size = 0
    for evt in events:
        encoded_size = len(_json.dumps(evt))
        if chunks[-1] and chunk_size + encoded_size > chunk_limit:
            chunks.append([])
            chunk_size = 0
        chunks[-1].append(evt)
        chunk_size += encoded_size

    target = f"{base_url.rstrip('/')}/events?run_id={urllib.parse.quote(run_id)}"
    sent = 0
    for chunk in chunks:
        if not chunk:
            continue
        data = _json.dumps(chunk).encode("utf-8")
        req = urllib.request.Request(target, data=data, method="POST", headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            if resp.status != 200:
                raise RuntimeError(f"HTTP {resp.status} from {target}")
        sent += len(chunk)

    print(f"Loaded: {filepath} → {base_url} (run_id={run_id}, {sent} events in {len(chunks)} batch(es))")


def cmd_load(args: argparse.Namespace) -> None:
    """Load a .nebo file into the daemon (local or remote)."""
    from nebo import client

    filepath = os.path.abspath(args.file)
    if not os.path.exists(filepath):
        print(f"Error: File not found: {filepath}")
        sys.exit(1)

    # --url triggers the event-replay path (daemon can't see our filesystem).
    url = getattr(args, "url", None) or os.environ.get("NEBO_URL")
    api_token = getattr(args, "api_token", None) or os.environ.get("NEBO_API_TOKEN")

    if url:
        try:
            _replay_nebo_file_to_remote(filepath, url, api_token)
        except Exception as e:
            print(f"Error: {e}")
            sys.exit(1)
        if args.json:
            print(json.dumps({"status": "loaded", "filepath": filepath}))
        return

    try:
        data = client.load_file(filepath, **_conn_kwargs(args))
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

    if "error" in data:
        print(f"Error: {data['error']}")
        sys.exit(1)

    if args.json:
        print(json.dumps({"status": "loaded", "filepath": filepath, **data}))
        return

    print(f"Loaded: {filepath}")


def cmd_skill(args: argparse.Namespace) -> None:
    """List or install nebo-shipped agent skills."""
    # Imported lazily so `nebo --help` doesn't pay the cost.
    from nebo import skills
    from nebo.skills import install as skill_install

    action = getattr(args, "skill_action", None)

    if action == "list" or action is None:
        for name in skills.available_skills():
            body = skills.read_skill(name)
            # Extract description from frontmatter for a friendlier listing.
            description = ""
            if body.startswith("---"):
                end = body.find("\n---", 3)
                if end != -1:
                    fm = body[3:end]
                    for line in fm.splitlines():
                        if line.strip().startswith("description:"):
                            description = line.split(":", 1)[1].strip()
                            break
            print(f"{name}")
            if description:
                print(f"  {description}")
        return

    if action == "install":
        platform = getattr(args, "platform", "claude-code") or "claude-code"
        skill = getattr(args, "skill", None) or "runs-qa"
        project = bool(getattr(args, "project", False))

        if platform == "all":
            platforms = list(skill_install.PLATFORMS)
        else:
            platforms = [platform]

        try:
            results = skill_install.install(
                platforms=platforms,
                skill=None if skill == "all" else skill,
                project=project,
            )
        except (ValueError, FileNotFoundError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            sys.exit(2)

        for platform_name, paths in results.items():
            if isinstance(paths, list):
                for p in paths:
                    print(f"{platform_name}: wrote {p}")
            else:
                print(f"{platform_name}: wrote {paths}")
        return

    print(f"unknown skill action: {action!r}", file=sys.stderr)
    sys.exit(2)


def cmd_runs(args: argparse.Namespace) -> None:
    """Inspect runs: list / show / wait."""
    from nebo import client
    sub = args.runs_action
    conn = _conn_kwargs(args)
    if sub == "list":
        result = client.get_run_history(**conn)
        if args.json:
            print(json.dumps(result))
        else:
            for r in result.get("runs", []):
                rid = r.get("id", "")
                name = r.get("run_name") or ""
                started = r.get("started_at") or ""
                summary = (
                    f"nodes={r.get('node_count', 0)} "
                    f"metrics={r.get('metric_series_count', 0)}"
                )
                latest_step = r.get("latest_step")
                if latest_step is not None:
                    summary += f" step={latest_step}"
                print(f"{rid:<20} {name:<24} {started:<22} {summary}")
        return
    if sub == "show":
        result = client.get_run_status(args.run_id, **conn)
        if args.json:
            print(json.dumps(result))
        else:
            for k, v in result.items():
                print(f"{k}: {v}")
        return
    if sub == "wait":
        result = client.wait_for_alert(
            args.run_id,
            timeout=args.timeout,
            min_level=args.min_level,
            **conn,
        )
        if args.json:
            print(json.dumps(result))
        else:
            if result.get("status") == "alert":
                a = result["alert"]
                print(f"ALERT [{a.get('level_name', '')}] {a.get('title', '')}: {a.get('text', '')}")
            else:
                print(f"status: {result.get('status')}")
        return


def cmd_graph(args: argparse.Namespace) -> None:
    """Inspect the DAG: graph show."""
    from nebo import client
    result = client.get_graph(run_id=args.run, **_conn_kwargs(args))
    if args.json:
        print(json.dumps(result))
        return
    nodes = result.get("nodes", {})
    edges = result.get("edges", [])
    print(f"{len(nodes)} nodes, {len(edges)} edges")
    for nid, info in nodes.items():
        print(f"  {nid}  ({info.get('func_name', '')})")


def cmd_loggables(args: argparse.Namespace) -> None:
    """Inspect a loggable: loggables show <id>."""
    from nebo import client
    result = client.get_loggable_status(
        args.loggable_id, run_id=args.run, **_conn_kwargs(args),
    )
    if args.json:
        print(json.dumps(result))
        return
    for k, v in result.items():
        print(f"{k}: {v!r}")


def cmd_describe(args: argparse.Namespace) -> None:
    """Print workflow description."""
    from nebo import client
    result = client.get_description(run_id=args.run, **_conn_kwargs(args))
    if args.json:
        print(json.dumps(result))
        return
    print(result.get("workflow_description") or "<no description>")


def cmd_metrics(args: argparse.Namespace) -> None:
    """Read or write metrics: list / get / log."""
    from nebo import client
    sub = args.metrics_action
    conn = _conn_kwargs(args)

    if sub == "list":
        # Derive from run_status; if no --run given, hit history and pick latest.
        if args.run:
            status = client.get_run_status(args.run, **conn)
        else:
            history = client.get_run_history(**conn)
            runs = history.get("runs", [])
            if not runs:
                if args.json:
                    print(json.dumps({}))
                else:
                    print("(no runs)")
                return
            status = client.get_run_status(runs[-1]["id"], **conn)
        index = status.get("metrics_index", {})
        if args.json:
            print(json.dumps(index))
        else:
            for lid, names in index.items():
                print(f"{lid}: {', '.join(names)}")
        return

    if sub == "get":
        if args.values_only and not args.name:
            print("error: --values-only requires --name", file=sys.stderr)
            sys.exit(2)
        if args.runs and args.run:
            print("error: pass either --run or --runs, not both", file=sys.stderr)
            sys.exit(2)

        def _fetch(run_id):
            result = client.get_metrics(
                args.loggable_id,
                name=args.name,
                tag=args.tag,
                step=args.step,
                run_id=run_id,
                **conn,
            )
            metrics = result.get("metrics", {})
            if args.values_only:
                return (metrics.get(args.name) or {}).get("entries", [])
            return metrics

        def _print_human(payload, indent=""):
            if args.values_only:
                for e in payload:
                    print(f"{indent}{e.get('step')}\t{e.get('value')}")
            else:
                for mname, series in payload.items():
                    count = len(series.get("entries", []))
                    print(f"{indent}{mname} ({series.get('type')}): {count} entries")

        run_ids = [r.strip() for r in (args.runs or "").split(",") if r.strip()]
        if run_ids:
            # Cross-run fan-out: one daemon call per run, merged client-side.
            per_run = {rid: _fetch(rid) for rid in run_ids}
            if args.json:
                print(json.dumps({
                    "loggable_id": args.loggable_id,
                    "name": args.name,
                    "runs": per_run,
                }))
            else:
                for rid, payload in per_run.items():
                    print(f"{rid}:")
                    _print_human(payload, indent="  ")
            return

        payload = _fetch(args.run)
        if args.json:
            if args.values_only:
                print(json.dumps(payload))
            else:
                print(json.dumps({"metrics": payload}))
        else:
            _print_human(payload)
        return

    if sub == "log":
        entries = json.loads(args.entries_json)
        result = client.log_metric(entries, run_id=args.run, **conn)
        if args.json:
            print(json.dumps(result))
        else:
            print(result.get("status", "ok"))
        return


_ALERT_LEVELS = {"DEBUG": 10, "INFO": 20, "WARN": 30, "ERROR": 40}


def _parse_alert_level(raw: str) -> int:
    """Accept a numeric level or a name (DEBUG/INFO/WARN/ERROR)."""
    if raw.upper() in _ALERT_LEVELS:
        return _ALERT_LEVELS[raw.upper()]
    try:
        return int(raw)
    except ValueError:
        names = "/".join(_ALERT_LEVELS)
        raise argparse.ArgumentTypeError(
            f"invalid level {raw!r}; use {names} or an integer"
        )


_ALERT_LEVEL_NAMES = {v: k for k, v in _ALERT_LEVELS.items()}


def _format_alert_line(a: dict) -> str:
    level_name = (
        a.get("level_name")
        or _ALERT_LEVEL_NAMES.get(a.get("level"))
        or str(a.get("level", ""))
    )
    if a.get("triggered_by") == "cli":
        cond = a.get("condition_str") or a.get("condition") or ""
        fired = len(a.get("fired") or [])
        scope = f" run={a['run_id']}" if a.get("run_id") else ""
        return (
            f"{a.get('id', ''):<10} [cli]  [{level_name}] {a.get('title', '')} "
            f"when {cond}{scope} (fired {fired}x)"
        )
    return (
        f"{'':<10} [code] [{level_name}] {a.get('title', '')}"
        f"{': ' + a['text'] if a.get('text') else ''} (run={a.get('run_id', '?')})"
    )


def cmd_alerts(args: argparse.Namespace) -> None:
    """Manage alert rules: ls / get / set / rm."""
    from nebo import client
    sub = args.alerts_action
    conn = _conn_kwargs(args)

    if sub == "ls":
        result = client.list_alerts(run_id=args.run, **conn)
        if args.json:
            print(json.dumps(result))
            return
        alerts = result.get("alerts", [])
        if not alerts:
            print("(no alerts)")
            return
        for a in alerts:
            print(_format_alert_line(a))
        return

    if sub == "get":
        result = client.get_alert(args.rule_id, **conn)
        if args.json:
            print(json.dumps(result))
            return
        for k, v in result.items():
            print(f"{k}: {v}")
        return

    if sub == "set":
        try:
            condition = client.parse_condition(args.condition)
        except ValueError as e:
            print(f"error: {e}", file=sys.stderr)
            sys.exit(2)
        result = client.set_alert(
            args.title,
            condition,
            text=args.text or "",
            level=args.level,
            loggable_id=args.loggable,
            run_id=args.run,
            **conn,
        )
        if args.json:
            print(json.dumps(result))
        else:
            print(f"created alert rule {result.get('id', '')}: "
                  f"{result.get('title', '')} when {args.condition.strip()}")
        return

    if sub == "rm":
        result = client.delete_alert(args.rule_id, **conn)
        if args.json:
            print(json.dumps(result))
        else:
            print(f"deleted alert rule {args.rule_id}")
        return


def cmd_mcp_stdio(args: argparse.Namespace) -> None:
    """Run the MCP stdio transport (bridges stdio <-> daemon HTTP)."""
    from nebo.mcp.stdio import run_stdio_bridge
    run_stdio_bridge(port=args.port)


def cmd_text_log(args: argparse.Namespace) -> None:
    """Write text log entries."""
    from nebo import client
    entries = json.loads(args.entries_json)
    result = client.log_text(entries, run_id=args.run, **_conn_kwargs(args))
    print(json.dumps(result) if args.json else result.get("status", "ok"))


def cmd_images_log(args: argparse.Namespace) -> None:
    """Write image entries."""
    from nebo import client
    entries = json.loads(args.entries_json)
    result = client.log_image(entries, run_id=args.run, **_conn_kwargs(args))
    print(json.dumps(result) if args.json else result.get("status", "ok"))


def cmd_audio_log(args: argparse.Namespace) -> None:
    """Write audio entries."""
    from nebo import client
    entries = json.loads(args.entries_json)
    result = client.log_audio(entries, run_id=args.run, **_conn_kwargs(args))
    print(json.dumps(result) if args.json else result.get("status", "ok"))


def _lazy_deploy(args: argparse.Namespace) -> None:
    """Defer the huggingface_hub import — it's an optional dependency."""
    from nebo.cli_deploy import cmd_deploy
    cmd_deploy(args)


def _common_conn_parser() -> argparse.ArgumentParser:
    """Parent parser carrying connection + output flags every read/write
    subcommand inherits via ``parents=[...]``. Uses ``add_help=False`` so
    help text isn't duplicated.
    """
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument(
        "--url",
        help="Daemon URL (overrides --port). Default: NEBO_URL env or http://localhost:7861.",
    )
    p.add_argument(
        "--port",
        type=int,
        help="Daemon port. Default: NEBO_PORT env or 7861.",
    )
    p.add_argument(
        "--api-token",
        help="X-Nebo-Token to send with requests. Default: NEBO_API_TOKEN env.",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON instead of human-formatted output.",
    )
    return p


def _conn_kwargs(args: argparse.Namespace) -> dict:
    """Translate parsed args into nebo.client connection kwargs."""
    return {
        "url": getattr(args, "url", None),
        "port": getattr(args, "port", None),
        "api_token": getattr(args, "api_token", None),
    }


def main() -> None:
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        prog="nebo",
        description="Nebo - Multi-modal logging for Python",
    )
    parser.add_argument("--port", type=int, default=7861, help="Daemon port (default: 7861)")
    subparsers = parser.add_subparsers(dest="command")

    # serve
    p_serve = subparsers.add_parser("serve", help="Start the persistent daemon server")
    p_serve.add_argument("--host", default="localhost", help="Host to bind (default: localhost)")
    p_serve.add_argument("--port", type=int, default=7861, help="Port (default: 7861)")
    p_serve.add_argument("--daemon", "-d", action="store_true", help="Run in background")
    p_serve.add_argument(
        "--logdir",
        default=".nebo",
        help="Directory the daemon watches for .nebo files written by SDK file mode (default: ./.nebo).",
    )
    p_serve.add_argument(
        "--no-local",
        action="store_true",
        help="Disable the directory watcher; daemon listens for network events only.",
    )
    p_serve.add_argument(
        "--save-files",
        help="Persist network-mode events to .nebo files at this path. Off by default.",
    )
    p_serve.add_argument("--api-token", help="Require this token on API requests via X-Nebo-Token / ?token=. Sets NEBO_API_TOKEN.")
    p_serve.add_argument("--read", choices=["public", "private"], help="Read access mode (default: public). Only matters when --api-token is set.")
    p_serve.add_argument("--write", choices=["public", "private"], help="Write access mode (default: private). Only matters when --api-token is set.")
    p_serve.add_argument(
        "--cache-path",
        help="SQLite cache db path (default: ~/.nebo/cache/<logdir-hash>.db).",
    )
    p_serve.add_argument(
        "--no-cache",
        action="store_true",
        help="Disable the SQLite cache: pure-RAM daemon, no eviction.",
    )
    p_serve.add_argument(
        "--ram-budget", type=int,
        help="RAM budget for resident run data, in MB (default: 384).",
    )
    p_serve.add_argument(
        "--media-lru", type=int,
        help="In-RAM media byte-cache budget, in MB (default: 256).",
    )
    p_serve.add_argument(
        "--cache-retention-days", type=int,
        help="At startup, delete cache dbs untouched for this many days (default: 30).",
    )

    # cache
    p_cache = subparsers.add_parser(
        "cache", help="Inspect or delete the daemon's SQLite cache databases",
    )
    cache_sub = p_cache.add_subparsers(dest="cache_command")
    p_cache_ls = cache_sub.add_parser("ls", help="List cache databases")
    p_cache_ls.add_argument("--json", action="store_true", help="JSON output")
    p_cache_ls.add_argument("--cache-dir", help=argparse.SUPPRESS)
    p_cache_clear = cache_sub.add_parser("clear", help="Delete cache databases")
    p_cache_clear.add_argument(
        "logdir", nargs="?",
        help="Logdir whose cache db to delete (matches by path hash or recorded logdir)",
    )
    p_cache_clear.add_argument("--all", action="store_true", help="Delete every cache db")
    p_cache_clear.add_argument("--cache-dir", help=argparse.SUPPRESS)

    # status
    p_status = subparsers.add_parser(
        "status", parents=[_common_conn_parser()], help="Show daemon status",
    )

    # stop
    p_stop = subparsers.add_parser("stop", help="Stop the daemon")
    p_stop.add_argument("--port", type=int, default=7861)

    # logs
    p_logs = subparsers.add_parser(
        "logs", parents=[_common_conn_parser()], help="View logs",
    )
    p_logs.add_argument("--run", help="Run ID")
    p_logs.add_argument("--node", help="Filter by node")
    p_logs.add_argument("--limit", type=int, default=100)

    # load
    p_load = subparsers.add_parser(
        "load", parents=[_common_conn_parser()], help="Load a .nebo file into the daemon",
    )
    p_load.add_argument("file", help="Path to .nebo file")

    # mcp
    p_mcp = subparsers.add_parser("mcp", help="Print MCP config for Claude Code")
    p_mcp.add_argument("--port", type=int, default=7861, help="Daemon port to embed in the MCP config")

    # mcp-stdio (internal)
    p_mcp_stdio = subparsers.add_parser("mcp-stdio", help="Run MCP stdio transport")
    p_mcp_stdio.add_argument("--port", type=int, default=7861)

    # skill
    p_skill = subparsers.add_parser(
        "skill", help="List or install nebo-shipped agent skills",
    )
    skill_subparsers = p_skill.add_subparsers(dest="skill_action")
    skill_subparsers.add_parser("list", help="List available skills")
    p_skill_install = skill_subparsers.add_parser(
        "install", help="Install a skill onto an agent platform",
    )
    p_skill_install.add_argument(
        "--platform",
        choices=["claude-code", "agents-md", "all"],
        default="claude-code",
        help="Target platform (default: claude-code)",
    )
    p_skill_install.add_argument(
        "--skill",
        default="runs-qa",
        help="Skill name (or 'all'). Default: runs-qa. Run `nebo skill list` to see options.",
    )
    p_skill_install.add_argument(
        "--project",
        action="store_true",
        help="For claude-code: install under ./.claude/skills instead of ~/.claude/skills",
    )

    # runs
    p_runs = subparsers.add_parser("runs", help="Inspect runs")
    runs_sub = p_runs.add_subparsers(dest="runs_action", required=True)
    runs_sub.add_parser(
        "list",
        parents=[_common_conn_parser()],
        help="List all runs known to the daemon",
    )
    p_runs_show = runs_sub.add_parser(
        "show",
        parents=[_common_conn_parser()],
        help="Show summary for one run",
    )
    p_runs_show.add_argument("run_id")
    p_runs_wait = runs_sub.add_parser(
        "wait",
        parents=[_common_conn_parser()],
        help="Block until an alert fires for the run",
    )
    p_runs_wait.add_argument("run_id")
    p_runs_wait.add_argument("--timeout", type=float, default=300.0)
    p_runs_wait.add_argument("--min-level", type=int, default=20)

    # graph
    p_graph = subparsers.add_parser("graph", help="Inspect the DAG")
    graph_sub = p_graph.add_subparsers(dest="graph_action", required=True)
    p_gs = graph_sub.add_parser("show", parents=[_common_conn_parser()], help="Show DAG nodes and edges")
    p_gs.add_argument("--run", help="Run id (latest if omitted)")

    # loggables
    p_logg = subparsers.add_parser("loggables", help="Inspect a loggable")
    logg_sub = p_logg.add_subparsers(dest="loggables_action", required=True)
    p_ls = logg_sub.add_parser("show", parents=[_common_conn_parser()], help="Show a loggable's status")
    p_ls.add_argument("loggable_id")
    p_ls.add_argument("--run", help="Run id (latest if omitted)")

    # describe
    p_desc = subparsers.add_parser("describe", parents=[_common_conn_parser()], help="Print the workflow description")
    p_desc.add_argument("--run", help="Run id (latest if omitted)")

    # alerts
    p_alerts = subparsers.add_parser("alerts", help="Manage alert rules")
    alerts_sub = p_alerts.add_subparsers(dest="alerts_action", required=True)

    p_als = alerts_sub.add_parser("ls", parents=[_common_conn_parser()], help="List alert rules and code-fired alerts")
    p_als.add_argument("--run", help="Scope to one run id")

    p_alg = alerts_sub.add_parser("get", parents=[_common_conn_parser()], help="Show one alert rule")
    p_alg.add_argument("rule_id")

    p_alset = alerts_sub.add_parser("set", parents=[_common_conn_parser()], help="Create an alert rule on a metric condition")
    p_alset.add_argument("--title", required=True, help="Alert headline")
    p_alset.add_argument("--text", help="Optional body / details")
    p_alset.add_argument(
        "--condition", required=True,
        help="Metric condition, e.g. 'train/loss > 5'. Ops: > >= < <= == !=",
    )
    p_alset.add_argument(
        "--level", type=_parse_alert_level, default=20,
        help="Severity: DEBUG/INFO/WARN/ERROR or an integer (default INFO)",
    )
    p_alset.add_argument("--loggable", help="Only match the metric on this loggable id")
    p_alset.add_argument("--run", help="Only apply to this run id (default: all runs)")

    p_alrm = alerts_sub.add_parser("rm", parents=[_common_conn_parser()], help="Delete an alert rule")
    p_alrm.add_argument("rule_id")

    # metrics
    p_metrics = subparsers.add_parser("metrics", help="Read or write metrics")
    metrics_sub = p_metrics.add_subparsers(dest="metrics_action", required=True)

    p_ml = metrics_sub.add_parser("list", parents=[_common_conn_parser()], help="List metric names per loggable")
    p_ml.add_argument("--run", help="Run id (latest if omitted)")

    p_mg = metrics_sub.add_parser("get", parents=[_common_conn_parser()], help="Fetch metric entries for a loggable")
    p_mg.add_argument("loggable_id")
    p_mg.add_argument("--name", help="Filter to a specific metric name")
    p_mg.add_argument("--tag", help="Filter line/scatter entries by tag")
    p_mg.add_argument("--step", type=int, help="Filter entries by exact step")
    p_mg.add_argument("--run", help="Run id (latest if omitted)")
    p_mg.add_argument(
        "--runs",
        help="Comma-separated run ids for a cross-run query; emits {run_id: series} keyed by run.",
    )
    p_mg.add_argument(
        "--values-only",
        action="store_true",
        help="With --name: emit just the entries array [{step, value, tags, timestamp}, ...].",
    )

    p_mlog = metrics_sub.add_parser("log", parents=[_common_conn_parser()], help="Write metric entries")
    p_mlog.add_argument("--entries-json", required=True, help="JSON list of metric entries")
    p_mlog.add_argument("--run", help="Run id")

    # text / images / audio  (each has a single "log" action for now)
    def _add_log_subparser(name: str) -> argparse.ArgumentParser:
        p = subparsers.add_parser(name, help=f"Write {name} entries")
        sub = p.add_subparsers(dest=f"{name}_action", required=True)
        plog = sub.add_parser("log", parents=[_common_conn_parser()], help=f"Write {name} entries")
        plog.add_argument("--entries-json", required=True, help="JSON list of entries")
        plog.add_argument("--run", help="Run id")
        return p

    _add_log_subparser("text")
    _add_log_subparser("images")
    _add_log_subparser("audio")

    # deploy
    p_deploy = subparsers.add_parser(
        "deploy",
        help="Deploy the nebo daemon to a Hugging Face Space",
    )
    p_deploy.add_argument("--space-id", required=True, help="Hugging Face Space ID, e.g. 'username/my-dashboard'")
    p_deploy.add_argument("--hf-token", help="Hugging Face write token (defaults to HF_TOKEN env / cached login)")
    p_deploy.add_argument("--api-token", help="Token clients must send via X-Nebo-Token. Random if omitted.")
    p_deploy.add_argument("--private", action="store_true", help="Create the Space as private")
    p_deploy.add_argument("--from-source", action="store_true", help="Build a wheel from this checkout and ship it instead of installing from PyPI")
    p_deploy.add_argument("--read", choices=["public", "private"], default="public", help="Read access mode (default: public — anyone can view).")
    p_deploy.add_argument("--write", choices=["public", "private"], default="private", help="Write access mode (default: private — token required to push events / control runs).")
    p_deploy.add_argument("--no-wait", dest="wait", action="store_false", default=True, help="Return as soon as files are uploaded; don't wait for the Space rebuild to finish.")

    args = parser.parse_args()

    commands = {
        "serve": cmd_serve,
        "cache": cmd_cache,
        "status": cmd_status,
        "stop": cmd_stop,
        "logs": cmd_logs,
        "load": cmd_load,
        "mcp": cmd_mcp,
        "mcp-stdio": cmd_mcp_stdio,
        "skill": cmd_skill,
        "deploy": _lazy_deploy,
        "runs": cmd_runs,
        "graph": cmd_graph,
        "loggables": cmd_loggables,
        "describe": cmd_describe,
        "alerts": cmd_alerts,
        "metrics": cmd_metrics,
        "text": cmd_text_log,
        "images": cmd_images_log,
        "audio": cmd_audio_log,
    }

    handler = commands.get(args.command)
    if not handler:
        parser.print_help()
        return

    # Translate daemon errors into clean messages + non-zero exit codes so
    # agents and shell pipelines see a usable error instead of a Python
    # traceback. HTTPError covers auth (401), missing routes (404), and
    # malformed query params (422). URLError covers daemon-not-running.
    import urllib.error

    try:
        handler(args)
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        msg = f"daemon returned HTTP {e.code}"
        if e.code == 401:
            msg += " (unauthorized — pass --api-token or set NEBO_API_TOKEN)"
        if body:
            msg += f": {body}"
        print(msg, file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(
            f"could not reach the nebo daemon: {e.reason}. "
            "Start it with `nebo serve` (default port 7861).",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
