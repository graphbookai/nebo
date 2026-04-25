# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nebo is a modern logging SDK for multi-modal data. Users decorate functions with `@nb.fn()` and emit events with `nb.log()` / `nb.log_metric()` / `nb.track()` / etc.; nebo infers a DAG from the call graph and surfaces everything through a Rich terminal, a FastAPI daemon, a React web UI, and MCP tools. The repo contains the Python package (`nebo/`), the web UI (`ui/`), tests (`tests/`), docs (`docs/`), and runnable examples (`examples/`).

## Commands

### Python (package is managed with `uv`, Python ≥3.10)

```bash
uv sync --all-groups            # install deps + dev tools
uv run pytest tests/ -v         # full test suite (CI matrix: 3.10, 3.11, 3.12)
uv run pytest tests/test_decorators.py -v         # single file
uv run pytest tests/test_decorators.py::test_bare_decorator -v   # single test
uv run nebo --help              # CLI entry point (defined in nebo/cli.py: main)
uv run nebo serve               # start daemon (port 2048)
uv run nebo run examples/basic_pipeline.py
```

### Web UI (`ui/`)

```bash
cd ui
npm install
npm run dev      # Vite dev server, proxies /health /events /runs /graph /logs /errors /nodes /stream → localhost:2048
npm run build    # tsc -b && vite build
npm run lint     # eslint
```

The dev UI only works when `nebo serve` is running on port 2048.

## Architecture

### Execution modes

Two execution modes coexist and share the same SDK surface:

- **Local mode** (default): in-process. The SDK renders a Rich terminal dashboard directly; no daemon involved.
- **Server mode**: the SDK sends events over HTTP to a long-lived FastAPI daemon (`nebo serve`, port 2048). The daemon persists runs as `.nebo` files (MessagePack, append-only) and fans events out to the web UI (WebSocket at `/stream`) and MCP tools.

Mode is resolved in `nebo/__init__.py::init()`. `mode="auto"` probes the daemon; env vars set by `nebo run` (`NEBO_MODE`, `NEBO_SERVER_PORT`, `NEBO_RUN_ID`, `NEBO_FLUSH_INTERVAL`) override user args. `_ensure_init()` lazily auto-initializes on first `nb.*` call, so pipelines never need an explicit `nb.init()`.

Two process-wide escape hatches let headless contexts (CI, embedders, tests) suppress side-effects without threading kwargs through every entry point:
- `NEBO_NO_STORE=1` — daemon's auto-create and `run_start` paths skip the on-disk `.nebo` writer.
- `NEBO_NO_TERMINAL=1` — `nb.init()` skips the Rich live dashboard even if `terminal=True` (the default).

### DAG inference

Edges are inferred at runtime, not declared. `nebo/core/decorators.py` wraps every `@nb.fn()` call; `nebo/core/dag.py` and `nebo/core/state.py` track which node produced each return value (`return_origins`) and which node is currently on the call stack. When a wrapped callee receives an argument that was produced by another node, a data-flow edge is added; otherwise the edge falls back to the calling parent. `depends_on=[...]` declares edges that can't be inferred (shared state, globals, class attrs). `dag_strategy` switches between `object` (data-flow, default), `stack` (caller→callee only), `both`, or `none`.

### Global state singleton

`SessionState` in `nebo/core/state.py` is a threadsafe singleton holding nodes, edges, the daemon client, the terminal display, and per-run snapshots (`_run_snapshots`). `_current_node` is a `ContextVar` so concurrent node scopes work under threads. When working on anything involving run lifecycle, read `state.py` first — `save_run_state` / `restore_run_state` / `clear_run_state` are the primitives `start_run()` uses to multiplex multiple runs in one process.

### Package layout

- `nebo/core/` — decorators, DAG builder, session state, `DaemonClient`, config, tracker, `.nebo` file format.
- `nebo/logging/` — user-facing `log`/`log_metric`/`log_image`/`log_audio`/`log_text`/`md`, plus the serializer/queue that batches events to the daemon.
- `nebo/server/` — `daemon.py` (FastAPI app, created via `create_daemon_app` factory), `runner.py` (manages subprocess pipelines kicked off by `nebo run` or MCP), `chat.py`, `protocol.py` (`MessageType` enum + `decode_batch`).
- `nebo/mcp/` — MCP tools (`tools.py`) and stdio/server entry points. 15 tools, roughly split into observation (graph, logs, metrics, errors, description) and action (run / stop / restart / ask / wait / read+write source).
- `nebo/terminal/` — Rich dashboard used in local mode.
- `nebo/cli.py` — `nebo serve|run|status|stop|logs|errors|load|mcp` subcommands. PID file at `~/.nebo/server.pid`.
- `nebo/extras/cv/` — optional computer-vision helpers. `nebo/extensions/` — extension hook point.

### Web UI (`ui/`)

React 19 + Vite 7 + TypeScript + Tailwind v4 + shadcn-style components. State via `zustand` (`src/store/index.ts`). WebSocket handled in `src/hooks/useWebSocket.ts`, connecting to the daemon's `/stream` endpoint. Graph rendering uses `@xyflow/react` with `@dagrejs/dagre` layout (`src/components/graph/DagGraph.tsx`). Metrics charts use `recharts`. The `@/` import alias maps to `ui/src/`. shadcn registry is configured via `.mcp.json` (the `shadcn` MCP server).

### Tests

Plain `pytest` + `pytest-asyncio`. Tests are self-contained and exercise the public surface (`test_decorators.py`, `test_client.py`, `test_daemon.py`, `test_mcp_tools.py`, `test_fileformat.py`, …). There is no separate lint/type-check step in CI — only the pytest matrix in `.github/workflows/ci.yml`.

`tests/conftest.py` carries an autouse `monkeypatch.setenv` fixture that pins both `NEBO_NO_STORE=1` and `NEBO_NO_TERMINAL=1` for every test. This keeps the suite from creating real `.nebo` files in the working directory and from spawning the Rich live display thread (which would otherwise paint into pytest's captured stdout and leak `ResourceWarning` into `-W error` runs). Tests that specifically exercise the file writer or the dashboard import `NeboFileWriter` / `TerminalDisplay` directly.

## Conventions to preserve

- **Auto-init is load-bearing.** Any new public SDK function that touches state must call `_ensure_init()` before reading/writing it (see `ui()` and `start_run()` for examples). Breaking this makes nebo require an explicit `nb.init()`, which it is explicitly designed not to need.
- **Run lifecycle flows through events.** The daemon only opens a `.nebo` writer after receiving a `run_start` event — so any code path that connects a client in non-local mode must also emit `run_start` (see the comment block in `init()` around `script_name`).
- **`MessageType` is the source of truth for protocol events.** Add new event kinds to `nebo/server/protocol.py` and handle them in the daemon, not ad-hoc strings.
- **The Global loggable is always present.** `SessionState.loggables["__global__"]` is seeded on init/reset/clear. `nb.log*` calls outside any `@nb.fn()` context route there. Any code that iterates loggables and assumes node-only fields (`func_name`, `exec_count`, etc.) must filter by `isinstance(l, NodeInfo)` or `kind == "node"`.
- **`@nb.fn(ui={})` keys.** Production code reads `collapsed`, `color`, and `default_tab`. Unknown keys are forwarded to the UI verbatim so adding a new hint requires only a UI consumer, no SDK change.
