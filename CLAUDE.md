# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nebo is a modern logging SDK for multi-modal data. Users decorate functions with `@nb.fn()` and emit events with `nb.log()` (text), `nb.log_line` / `log_bar` / `log_pie` / `log_scatter` / `log_histogram` (one helper per chart type), `nb.log_image` (with `nb.labels.{Points, Boxes, Circles, Polygons, Bitmasks}` overlays), `nb.log_audio`, `nb.log_cfg`, and `nb.track()`. Nebo infers a DAG from the call graph and surfaces everything through append-only `.nebo` files, a FastAPI daemon, a React web UI, and MCP tools. The repo contains the Python package (`nebo/`), the web UI (`ui/`), tests (`tests/`), docs (`docs/`), and runnable examples (`examples/`).

Nebo is a **logging** SDK — it does not run human-in-the-loop interactive features (no `nb.ask`, no pauseable nodes). Anything that needs to block on user input belongs outside the SDK.

## Commands

### Python (package is managed with `uv`, Python ≥3.10)

```bash
uv sync --all-groups            # install deps + dev tools
uv run pytest tests/ -v         # full test suite (CI matrix: 3.10, 3.11, 3.12)
uv run pytest tests/test_decorators.py -v         # single file
uv run pytest tests/test_decorators.py::test_bare_decorator -v   # single test
uv run nebo --help              # CLI entry point (defined in nebo/cli.py: main)
uv run nebo serve               # start daemon (port 7861)
uv run python examples/basic_pipeline.py   # run a pipeline (SDK auto-connects to the daemon)
```

### Web UI (`ui/`)

```bash
cd ui
npm install
npm run dev      # Vite dev server, proxies /health /events /runs /graph /logs /errors /nodes /stream → localhost:7861
npm run build    # tsc -b && vite build
npm run lint     # eslint
```

The dev UI only works when `nebo serve` is running on port 7861.

## Architecture

### Execution modes

Two transports share the same SDK surface, selected by the `uri=` arg
on `nb.init()` (or `NEBO_URI`):

- **File mode** (default, `uri=".nebo/"` or any path): the SDK writes
  events directly to an append-only `.nebo` file via
  `nebo/core/transport.py:FileTransport`. No daemon required. Each
  run lives at `<uri>/<timestamp>_<run_id>.nebo`.
- **Network mode** (`uri="http://…"` or `host:port`): the SDK pushes
  events to a long-lived FastAPI daemon (`nebo serve`, port 7861) via
  `nebo/core/client.py:NetworkTransport`. The daemon fans events out
  to the web UI (WebSocket at `/stream`) and MCP tools.

Mode is resolved by `nebo.core.uri.resolve_uri()` in `nb.init()`. URIs
starting with `http(s)://` or matching `host:port` are network; anything
else is a directory path. `_ensure_init()` lazily auto-initializes on
first `nb.*` call, so pipelines never need an explicit `nb.init()`.

Daemon side: `nebo serve` watches `--logdir` (default `./.nebo`) for
files written by SDK file-mode runs and ingests them as they grow
(`nebo/server/watcher.py:DirectoryWatcher`). With `--save-files PATH`,
network-received runs are also persisted to disk. The watcher and the
writer can't share a directory — the daemon refuses to start when
`--logdir` and `--save-files` resolve to the same path.

Env vars: `NEBO_URI` overrides the constructor arg.
`NEBO_RUN_ID`, `NEBO_FLUSH_INTERVAL`, `NEBO_API_TOKEN` are unchanged.
`NEBO_QUIET=1` suppresses the startup banner.
`NEBO_NO_STORE=1` makes file mode a no-op (used by the test suite).

Two process-wide escape hatches let headless contexts (CI, embedders,
tests) suppress side-effects:
- `NEBO_NO_STORE=1` — SDK file mode opens no file; events are dropped.
- The daemon's `--save-files` flag is opt-in, so no daemon-side
  persistence happens by default.

### DAG inference

Edges are inferred at runtime, not declared. `nebo/core/decorators.py` wraps every `@nb.fn()` call; `nebo/core/dag.py` and `nebo/core/state.py` track which node produced each return value (`return_origins`) and which node is currently on the call stack. When a wrapped callee receives an argument that was produced by another node, a data-flow edge is added; otherwise the edge falls back to the calling parent. `depends_on=[...]` declares edges that can't be inferred (shared state, globals, class attrs). `dag_strategy` switches between `object` (data-flow, default), `stack` (caller→callee only), `both`, `linear` (chain nodes in first-execution order), or `none`.

### Metrics model (line + scatter accumulate, bar/pie/histogram snapshot)

Two chart types accumulate — `log_line` and `log_scatter`. The other three (`log_bar`, `log_pie`, `log_histogram`) are snapshots: the SDK still sends an event over the wire on each call, but the daemon (`nebo/server/daemon.py` metric handler) and the UI store (`ui/src/store/index.ts:appendMetric`) **overwrite** the prior entry instead of appending. The chart type locks on first emission per `(loggable, name)` pair via `SessionState._metric_cursors[loggable][name]` (a `MetricCursor(type, next_step)` — that's the only metric metadata the SDK keeps in process, by design).

Per chart type:

- `log_line(name, value, *, step=None, tags=None)` — accumulating; `step` auto-increments via the cursor; `tags` partition emissions for the UI tag-chip filter.
- `log_bar(name, value)`, `log_pie(name, value)` — `value` is `{label: number}`; no step, no tags. Re-emitting overwrites.
- `log_scatter(name, value, *, step=None, tags=None, colors=False)` — accumulating; each emission's `value` is `{label: list[(x, y)]}` (stored on the wire as `{label: {"x": [...], "y": [...]}}`). The chart shows the union of all emissions' points; `step` auto-increments per emission. UI varies labels by shape (`shapeForLabel`).
- `log_histogram(name, value, *, colors=False)` — `value` is `{label: list[number]}`. UI bins all labels against a shared min/max so overlapping distributions line up. Bin count and per-label EMA smoothing are global settings (see "Chart settings" below).
- `colors=False` (default) draws labels in the run color; `colors=True` switches to `RUN_COLOR_PALETTE`. Document warning: not recommended in comparison views, where the palette is reserved for run identity.

Step/tags only flow on the wire for accumulating types (line, scatter). `_emit_metric` in `nebo/logging/logger.py` strips them to `None`/`[]` for snapshot types (bar/pie/histogram) so stale values can't leak.

Step filter: clicking a datapoint on a line or scatter chart sets `timeline.step` (and auto-flips `timeline.mode` to `'step'`) via the chart's `onClick`. `useTimelineFilter` then narrows logs/images/audio panels to entries whose `step` matches; metric charts ignore the entry-level filter and instead mark the active step inline (LineMetric draws a vertical guideline + value bubble via an inline chart.js plugin; ScatterMetric dims non-matching points). `useTimelineBounds` walks line/scatter entries so the scrubber's step range covers any clickable step. **Don't filter metric entries by step at the parent level** (e.g. in `LoggableGridView.MetricCardBody`) — doing so collapses the chart and breaks the in-chart highlight.

UI invariant: chart components index palette colors by `allLabels.indexOf(label)` (the full vocabulary), never by the iteration index over the filtered list — otherwise toggling a label off via the chip row reshuffles the remaining colors. `ScatterMetric` and `HistogramMetric` both follow this rule.

UI invariant: chart components must NOT early-return `null` for empty data while their canvas is conditionally mounted by a parent that re-mounts on data changes. `useChartJs`'s mount effect uses `[]` deps; if the canvas remounts, the Chart instance keeps a reference to the old detached canvas and subsequent `chart.update()` calls are invisible. Always render the canvas (an empty Chart.js plot is fine); guard via the parent component's "no data" placeholder if needed.

### Image labels (`nb.labels.*`)

`nb.log_image` accepts geometric overlays only as instances of the dataclasses in `nebo/labels.py`: `Points`, `Boxes`, `Circles`, `Polygons`, `Bitmasks`. Each pairs raw geometry (list / ndarray / tensor) with a CSS color string. Each kwarg on `log_image` accepts a single instance OR a `list[Class]` so one image can carry multiple groups of the same kind in different colors (e.g. predictions vs. ground truth boxes). Raw lists/tensors are rejected with a `TypeError` pointing at the matching `nb.labels.*` class — there is no backwards-compat path. `_serialize_labels` in `nebo/logging/serializers.py` flattens each kwarg to `[{data, color}, ...]` on the wire; `ImageWithLabels.tsx` renders each group with its own color.

`Polygons` carries an extra `fill: bool = True` flag (filled interior vs. outline only) which lands as `{data, color, fill}` on the wire. No other label kind has an analogue.

Bitmasks are tinted via CSS `mask-image` + `background-color` + `mask-mode: luminance`. The server emits a single-channel grayscale PNG (PIL mode `"L"`) with no alpha channel; without `mask-mode: luminance` the browser would default to `mask-mode: alpha` and treat every pixel as opaque, flooding the entire image with the group color.

Note the kwarg is `bitmasks=` (plural) — matches the dataclass name and parallels the other four kinds.

### Chart interactivity (zoom/pan/reset, smoothing, tag mute)

`ui/src/components/charts/zoomBindings.ts` is the shared zoom/pan glue, used by both `LineMetric` and `ScatterMetric`. The interaction model is fixed:

- Left click (no drag) → existing `onClick` (sets timeline step). Never overridden.
- Mouse wheel (integer `deltaY`, no `deltaX`) → zoom (chartjs-plugin-zoom).
- Trackpad pinch (`wheel` event with `ctrlKey`) → zoom.
- Middle-mouse drag → pan. Plain left-click drag is gated off via `pan.onPanStart` returning `false` unless `event.button === 1`.
- Trackpad two-finger drag → pan via a custom capture-phase wheel listener (`attachWheelHandler`) that detects fractional/horizontal `deltaY` with no `ctrlKey` and routes to `chart.pan()` before the plugin sees the event.

Line charts pan/zoom on `'x'` only (Y is locked); scatter is `'xy'`. Both expose a "Reset zoom" button calling `chart.resetZoom()`. Stroke and point pixel sizes are fixed; do not introduce data-driven sizing — that breaks the constant-size-during-zoom contract.

### Chart settings (global, in `Settings`)

`ui/src/store/index.ts:Settings` carries three global chart knobs surfaced in `SettingsPanel.tsx`:
- `lineSmoothing: number` (0–1, EMA factor) — `LineMetric` runs an EMA over each dataset's data at render time.
- `histogramSmoothing: number` (0–1, EMA factor) — `HistogramMetric` smooths bin counts per-label after binning.
- `histogramBinCount: number` — replaces the previously-hardcoded bin count. `DEFAULT_HISTOGRAM_BIN_COUNT` is exported from the store.

Smoothed values are rendered, not persisted: raw entries in the store remain untouched.

### Tag mute on line charts

`LineMetric` accepts `tags?: string[]` and `inactiveTags?: Set<string>`. When `tags` is provided, the chart renders one dataset per tag (each tag's emissions filtered by `entry.tags.includes(tag)`; untagged entries map to `UNTAGGED_KEY`). Tags in `inactiveTags` render in soft gray (`rgba(156, 163, 175, 0.45)`) instead of being filtered out. `NodeMetrics::MetricBlock` now passes `entries` + `allTags` + `inactiveTags` for line metrics instead of pre-filtering with `entriesMatchingTags()` — that helper is still used for non-line types.

### Global state singleton

`SessionState` in `nebo/core/state.py` is a threadsafe singleton holding nodes, edges, the daemon client, the terminal display, and per-run snapshots (`_run_snapshots`). `_current_node` is a `ContextVar` so concurrent node scopes work under threads. When working on anything involving run lifecycle, read `state.py` first — `save_run_state` / `restore_run_state` / `clear_run_state` are the primitives `start_run()` uses to multiplex multiple runs in one process.

### Package layout

- `nebo/core/` — decorators, DAG builder, session state, `DaemonClient`, config, tracker, `.nebo` file format.
- `nebo/logging/` — user-facing `log`/`log_line`/`log_bar`/`log_pie`/`log_scatter`/`log_histogram`/`log_image`/`log_audio`/`md`, plus the serializer/queue that batches events to the daemon.
- `nebo/labels.py` — public dataclasses (`Points`, `Boxes`, `Circles`, `Polygons`, `Bitmasks`) for `nb.log_image` overlays. Re-exported as `nb.labels`.
- `nebo/server/` — `daemon.py` (FastAPI app, created via `create_daemon_app` factory), `runner.py` (vestigial subprocess manager; the agent surface no longer launches pipelines, but the daemon's `POST /run` route still uses it), `protocol.py` (`MessageType` enum + `decode_batch`).
- `nebo/mcp/` — MCP tools (`tools.py`) and stdio/server entry points. Split into observation (graph, logs, metrics, errors, description, run status/history), utility (`wait_for_alert`, `load_file`), and write (`log_metric/text/image/audio`). Run lifecycle is NOT exposed — pipelines start/stop via the user's shell.
- `nebo/client.py` — single HTTP client shared by `nebo/mcp/tools.py` and `nebo/cli.py`. Owns all daemon-bound `urllib` traffic; resolves `--url`/`--port`/`--api-token` from kwargs → `NEBO_URL`/`NEBO_PORT`/`NEBO_API_TOKEN` → defaults.
- `nebo/core/transport.py` — `Transport` Protocol shared by the two SDK transports. `FileTransport` (this module) writes append-only `.nebo` files in file mode; `NetworkTransport` (in `nebo/core/client.py`) POSTs events to a daemon in network mode.
- `nebo/cli.py` — subcommands split into two groups:
  - **Server/admin:** `serve`, `status`, `stop`, `mcp`, `mcp-stdio`, `skill`, `deploy`. PID file at `~/.nebo/server.pid`.
  - **Agent-callable Q&A:** `runs list|show|wait`, `graph show`, `loggables show`, `describe`, `logs`, `errors`, `metrics list|get|log`, `text|images|audio log`, `load`. Each takes `--url`/`--port`/`--api-token`/`--json` via the shared `_common_conn_parser()` and routes through `nebo/client.py`.
- `nebo/extras/cv/` — optional computer-vision helpers. `nebo/extensions/` — extension hook point.

### Web UI (`ui/`)

React 19 + Vite 7 + TypeScript + Tailwind v4 + shadcn-style components. State via `zustand` (`src/store/index.ts`). WebSocket handled in `src/hooks/useWebSocket.ts`, connecting to the daemon's `/stream` endpoint. Graph rendering uses `@xyflow/react` with `@dagrejs/dagre` layout (`src/components/graph/DagGraph.tsx`). Metrics charts use **Chart.js 4** (registered in `src/components/charts/registerChartJs.ts`) with `chartjs-plugin-zoom` for pan/zoom; the shared lifecycle hook is `src/components/charts/useChartJs.ts`. The `@/` import alias maps to `ui/src/`. shadcn registry is configured via `.mcp.json` (the `shadcn` MCP server).

### Tests

Plain `pytest` + `pytest-asyncio`. Tests are self-contained and exercise the public surface (`test_decorators.py`, `test_client.py`, `test_daemon.py`, `test_mcp_tools.py`, `test_fileformat.py`, …). There is no separate lint/type-check step in CI — only the pytest matrix in `.github/workflows/ci.yml`.

`tests/conftest.py` carries an autouse `monkeypatch.setenv` fixture that pins `NEBO_NO_STORE=1` for every test. This keeps the suite from creating real `.nebo` files in the working directory. Tests that specifically exercise the file writer import `FileTransport` directly.

## Conventions to preserve

- **Auto-init is load-bearing.** Any new public SDK function that touches state must call `_ensure_init()` before reading/writing it (see `ui()` and `start_run()` for examples). Breaking this makes nebo require an explicit `nb.init()`, which it is explicitly designed not to need.
- **Run lifecycle flows through events.** The daemon only opens a `.nebo` writer after receiving a `run_start` event — so any code path that connects a client in network mode must also emit `run_start` (see the comment block in `init()` around `script_name`).
- **`MessageType` is the source of truth for protocol events.** Add new event kinds to `nebo/server/protocol.py` and handle them in the daemon, not ad-hoc strings.
- **The Global loggable is always present.** `SessionState.loggables["__global__"]` is seeded on init/reset/clear. `nb.log*` calls outside any `@nb.fn()` context route there. Any code that iterates loggables and assumes node-only fields (`func_name`, `exec_count`, etc.) must filter by `isinstance(l, NodeInfo)` or `kind == "node"`.
- **`@nb.fn(ui={})` keys.** Production code reads `color` and `default_tab`. `default_tab` values are `"info"` / `"logs"` / `"metrics"` / `"images"` / `"audio"` (no `"ask"` — that tab was removed along with `nb.ask`). Unknown keys are forwarded to the UI verbatim so adding a new hint requires only a UI consumer, no SDK change.
- **No interactive blocking from the SDK.** `nb.ask` and pauseable nodes are intentionally absent — the SDK is for logging, not orchestration. Don't reintroduce wire-level events that block the running pipeline; if a feature needs that, it belongs outside nebo.
- **`nb.log_image` only takes `nb.labels.*` instances.** Raw lists/tensors raise a `TypeError`. The kwarg names are `points`, `boxes`, `circles`, `polygons`, `bitmasks` (note plural for the last). Each kwarg accepts one instance or a list of them — don't reintroduce a "single raw geometry" path.
