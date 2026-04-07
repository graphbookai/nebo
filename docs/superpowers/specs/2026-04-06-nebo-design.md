# Nebo Design Spec

**Date**: 2026-04-06
**Status**: Approved

Nebo is an AI-native, flexible observability SDK for Python with a modern UI. It supports multimodal agentic workflows, data processing pipelines, and machine learning metrics. This spec defines the features and behavior for the first complete release, built on top of the existing graphbook beta codebase.

---

## 1. Namespace & API Rename

All `graphbook.beta` references become `nebo`. Public alias `gb` becomes `nb`.

### Python SDK

```python
import nebo as nb

@nb.fn()
def train(data):
    nb.log("Starting training")
    nb.log_metric("loss", 0.5, step=1)
```

### Internal imports

All internal imports change from `from graphbook.beta.core...` to `from nebo.core...`, etc.

### CLI

The CLI entry point changes from `graphbook` to `nb`. All commands use `nb` prefix:

```
nb serve, nb run, nb status, nb stop, nb logs, nb errors, nb load, nb mcp, nb mcp-stdio
```

`pyproject.toml` entry point: `nb = nebo.cli:main`

### MCP Tools

All MCP tools rename from `graphbook_*` to `nebo_*`.

---

## 2. `.nebo` File Format

Binary, append-only, self-contained log files using MessagePack serialization.

### File Structure

```
[Header]
  magic: "nebo" (4 bytes)
  version: u16 (format version, starts at 1)
  metadata_size: u32
  metadata: msgpack map {
    run_id: str,
    script_path: str,
    started_at: float (unix timestamp),
    nebo_version: str,
    args: list[str]
  }

[Entry 0]
  type: u8 (0=log, 1=metric, 2=image, 3=audio, 4=node_register,
            5=edge, 6=error, 7=ask, 8=ui_config, ...)
  size: u32 (payload size in bytes)
  payload: msgpack map { node, timestamp, data... }

[Entry 1]
  ...
```

### Behavior

- Daemon writes entries in real-time as events arrive (when `store=True`).
- Each entry is self-contained. The size field allows skipping entries without parsing the payload.
- Media assets (images, audio) are embedded as raw bytes inside the msgpack payload. MessagePack's native binary support avoids base64 overhead.
- On crash, the file is valid up to the last fully-written entry.
- Loading a file into the daemon replays entries sequentially to reconstruct a full `Run` object.

---

## 3. Storage

### `.nebo/` Directory

- Created by the daemon in its cwd on startup.
- All run files are stored as `.nebo/<timestamp>.nebo`.
- Timestamp format: `YYYY-MM-DD_HHMMSS.nebo` (e.g., `2026-04-06_143022.nebo`).

### `nb.init()` Storage Toggle

- `store=True` (default): SDK tells the daemon to persist this run to a `.nebo` file.
- `store=False`: Memory only, no file written for this run.
- Communicated to the daemon as part of the initial handshake/run registration.

The SDK never controls the file path. The daemon decides where to write.

### Loading Historical Runs

- CLI: `nb load <path>` sends the file path to the daemon.
- API: `POST /load` with the file path.
- Daemon reads the `.nebo` file, replays entries, reconstructs a `Run` object.
- The loaded run appears in the UI alongside live and past runs.
- Q&A works against loaded runs identically to live runs.

---

## 4. Class Decoration & Lazy Node Materialization

### `@nb.fn()` on Functions

Decorating a function registers scope tracking. A node materializes only when the function calls a log function (`nb.log`, `nb.log_metric`, `nb.log_image`, `nb.log_audio`, `nb.log_text`, `nb.md`). No log calls means no node in the DAG.

### `@nb.fn()` on Classes

- Decorating a class wraps **all** methods with scope tracking. No methods are excluded based on naming conventions (`__dunder__`, `_private`, etc.).
- Nodes materialize only when a method calls a log function.
- The class itself is never a node. It is a visual grouping container (transparent bounding box in the DAG).

### Scoping Rules

- Every method in a decorated class gets its own scope. `nb.log()` inside `my_method()` is scoped to `my_method`, and `my_method` appears as a node inside the class group.
- If a method inside a decorated class also has `@nb.fn()` on it, issue a warning ("decorator is redundant, class is already decorated") and proceed normally. The method appears inside the class group.
- If a standalone `@nb.fn()` function is called from within a decorated class method, that function's node appears inside the class group as well.
- A decorated method (`@nb.fn()`) in an **undecorated** class is a regular standalone node with no bounding box grouping.

### DAG Representation

- A decorated class renders as a transparent bounding box containing all nodes that executed within its context.
- Edges between methods follow the same inference strategies (`object`, `stack`, `both`, `none`) and can cross group boundaries.

### Detection

- `@nb.fn()` detects whether it's applied to a class via `inspect.isclass()`.
- For classes, it wraps each method with the existing `_current_node` context var mechanism.
- Group membership is stored as a `group` field on `NodeInfo`.
- The UI receives group info as part of node registration events.

---

## 5. UI Configuration from Code

### Run-Level Defaults: `nb.ui()`

```python
nb.ui(
    layout="horizontal",      # or "vertical"
    view="dag",               # or "grid"
    collapsed=False,          # default node collapse state
    minimap=True,             # show minimap
    theme="dark",             # or "light"
)
```

- Called once per run (typically after `nb.init()`).
- Sent to the daemon as a `ui_config` event and stored in the `.nebo` file.
- The UI reads these as defaults. The user can still override in the UI.
- Calling `nb.ui()` again overwrites the previous defaults.

### Per-Node Hints: `@nb.fn(ui={...})`

```python
@nb.fn(ui={"collapsed": True})
def data_loader():
    ...
```

- Node-level display hints sent as part of the node registration event.
- Only supports node-specific visual properties (e.g., `collapsed`). View mode (`dag`/`grid`) is run-level only, not per-node.
- The UI treats these as defaults. The user can override.

---

## 6. Agent Tracing & Chat UI

### Layout

Right-side tabbed container with two tabs: **Trace** and **Chat**.

### Trace Tab

A linear, chronological log of all events across the run (thoughts, messages, actions, tool calls). A flattened timeline view ordered by timestamp.

Works naturally with the existing `object` DAG strategy where the agent is one node and tool calls are other nodes.

### Chat Tab (Q&A)

- Simple chat box UI: text input + message history.
- User submits a question. The UI sends it to the daemon via `POST /chat`.
- The daemon spawns a `claude` CLI subprocess with MCP config pointing back to itself.
- Claude Code reads the run's state via MCP tools (logs, metrics, graph, errors, etc.) and generates an answer.
- The response streams back to the UI via WebSocket.
- Chat history is per-run, held in daemon memory. Not persisted to `.nebo` files.

---

## 7. MCP

### Renamed Tools (14 existing)

All renamed from `graphbook_*` to `nebo_*`:

**Observation:**
1. `nebo_get_graph` — full DAG
2. `nebo_get_node_status` — node details
3. `nebo_get_logs` — filter logs by node/run
4. `nebo_get_metrics` — time series for a metric
5. `nebo_get_errors` — errors with tracebacks
6. `nebo_get_description` — workflow description + docstrings
7. `nebo_get_run_status` — run status
8. `nebo_get_run_history` — all runs summary

**Action:**
9. `nebo_run_pipeline` — start script
10. `nebo_stop_pipeline` — terminate run
11. `nebo_restart_pipeline` — stop + re-run
12. `nebo_get_source_code` — read file
13. `nebo_write_source_code` — write/patch file
14. `nebo_wait_for_event` — block until event
15. `nebo_ask_user` — interactive question

### New Tools

- `nebo_load_file` — load a `.nebo` file into the daemon
- `nebo_chat` — submit a Q&A question about a run

---

## 8. CLI

```
nb serve [--host] [--port] [--daemon] [--no-store]   Start daemon
nb run SCRIPT [--name] [--port] [--flush-interval]    Run pipeline with daemon
nb status [--port]                                     Daemon status + recent runs
nb stop [--port]                                       Stop daemon
nb logs [--run] [--node] [--limit] [--port]           View logs
nb errors [--run] [--port]                             View errors
nb load FILE [--port]                                  Load .nebo file into daemon
nb mcp                                                 Print MCP config
nb mcp-stdio                                           Run MCP stdio bridge
```

---

## 9. Existing Features (Unchanged)

These features carry over from the graphbook beta codebase with only the namespace rename:

- DAG inference strategies: `object`, `stack`, `both`, `none`
- `depends_on` parameter for explicit edges
- `nb.track()` progress tracking
- `nb.log_cfg()` configuration logging
- `nb.ask()` interactive prompts with pause/resume
- `nb.md()` workflow-level markdown
- `nb.log_text()` rich text/markdown
- Backend extensibility (`LoggingBackend` protocol, MLflow, TensorBoard)
- Rich terminal display (local mode)
- DaemonClient with reconnection and fallback
- WebSocket event streaming
- Run lifecycle management (start, stop, pause, unpause)
- Run comparison in UI
- Responsive UI (desktop/mobile)

---

## 10. Out of Scope

- Artifact storage (future)
- Offline file inspection without a running daemon (future)
- Nested class groups (decorated class inside decorated class)
- Persisting chat history to `.nebo` files
- Auto-reloading `.nebo/` directory on daemon restart (nice-to-have, not v1)
- Direct Anthropic API calls for Q&A (using Claude Code CLI only)
