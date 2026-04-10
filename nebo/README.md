# Nebo

Lightweight observability for Python programs. Decorate your functions with `@nb.fn()`, and nebo automatically infers a DAG from your call graph, captures logs, metrics, inspections, and errors -- all queryable in real time via CLI, MCP tools, or a Rich terminal dashboard.

## Installation

```bash
pip install nebo
```

The CLI entry point is `nebo`:

```bash
nebo --help
```

## Quick Start

```python
import nebo as nb

@nb.fn()
def load_data(path: str = "data.csv") -> list[dict]:
    """Load records from a file."""
    records = [{"id": i, "value": i * 0.5} for i in range(100)]
    nb.log(f"Loaded {len(records)} records from {path}")
    return records

@nb.fn()
def transform(records: list[dict]) -> list[dict]:
    """Normalize values."""
    out = []
    for r in nb.track(records, name="transforming"):
        out.append({**r, "value": r["value"] / 50.0})
    nb.log(f"Transformed {len(out)} records")
    nb.log_metric("record_count", float(len(out)))
    return out

@nb.fn()
def run():
    """Main pipeline entry point."""
    records = load_data()
    result = transform(records)
    nb.log(f"Pipeline complete: {len(result)} records")
    return result

if __name__ == "__main__":
    run()
```

Running this produces a Rich terminal display showing the DAG, node execution counts, logs, and progress bars. The DAG edges (`run -> load_data`, `load_data -> transform`) are inferred automatically from data flow -- no manual wiring required.

## Core Concepts

### `@nb.fn()` -- Register a function as a DAG node

Every function decorated with `@nb.fn()` becomes a node in the pipeline DAG. Edges are inferred from **data flow**: when a node's return value is passed as an argument to another node, an edge is created from the producer to the consumer.

```python
@nb.fn()
def load_data():
    return [1, 2, 3]

@nb.fn()
def transform(data):
    return [x * 2 for x in data]

@nb.fn()
def run():
    records = load_data()        # edge: run -> load_data (no data dependency)
    result = transform(records)  # edge: load_data -> transform (data flows from load_data)
    return result
```

When a child node receives no node-produced arguments, the edge falls back to the calling parent node.

You can use it in several ways:

```python
@nb.fn              # bare decorator
@nb.fn()            # with parentheses
@nb.fn(depends_on=[other_fn])  # with explicit dependencies
@nb.fn(ui={"collapsed": True})  # with per-node UI hints
```

### Class Decoration

`@nb.fn()` can be applied to classes. All methods are wrapped with scope tracking, and the class name becomes a visual group in the DAG:

```python
@nb.fn()
class Agent:
    def think(self, query):
        nb.log(f"Thinking about: {query}")
        return {"plan": "respond"}

    def act(self, plan):
        nb.log(f"Acting on: {plan}")
        return "result"

agent = Agent()
agent.think("hello")
agent.act({"plan": "respond"})
```

Methods appear as `Agent.think` and `Agent.act` in the DAG, grouped under `Agent`.

### Automatic Materialization

Decorated functions appear in the DAG as soon as they execute for the first time — a call to `nb.log()`, `nb.log_metric()`, etc. is not required. This keeps dependency chains intact when an intermediate function only orchestrates calls to other nodes without logging anything itself.

### `depends_on` -- Explicit dependency declaration

Some dependencies cannot be detected automatically (shared mutable state, class attributes, global variables). Use `depends_on` to declare these explicitly:

```python
@nb.fn()
def setup():
    """Initialize shared resources."""
    ...

@nb.fn(depends_on=[setup])
def process():
    """Uses resources initialized by setup."""
    ...
```

### `nb.log(message)` -- Text logging

Log a message to the current node. Messages appear in the terminal dashboard and are queryable via MCP tools.

```python
@nb.fn()
def train(data):
    nb.log(f"Training on {len(data)} samples")
    for epoch in range(10):
        loss = do_train(data)
        nb.log(f"Epoch {epoch}: loss={loss:.4f}")
```

### `nb.log_metric(name, value, step=None)` -- Scalar metrics

Log scalar metrics with automatic step counting.

```python
@nb.fn()
def train(model, data):
    for epoch in range(100):
        loss = train_one_epoch(model, data)
        nb.log_metric("loss", loss)
        nb.log_metric("lr", optimizer.param_groups[0]["lr"])
```

### `nb.log_cfg(cfg)` -- Configuration logging

Log configuration for the current node.

```python
@nb.fn()
def train(lr=0.001, epochs=50):
    nb.log_cfg({"lr": lr, "epochs": epochs})
    ...
```

### `nb.track(iterable, name=None, total=None)` -- Progress tracking

Wrap any iterable for tqdm-like progress tracking.

```python
@nb.fn()
def process(items):
    for item in nb.track(items, name="processing"):
        transform(item)
```

### `nb.log_image(image, name=None, step=None)` -- Image logging

Log images (PIL, NumPy arrays, or PyTorch tensors) for visual inspection.

### `nb.log_audio(audio, sr=16000, name=None, step=None)` -- Audio logging

Log audio data for playback and analysis.

### `nb.log_text(name, text)` -- Rich text / Markdown logging

Log formatted text or Markdown content.

### `nb.md(description)` -- Workflow description

Set a workflow-level description (Markdown supported). Visible in MCP tools and the dashboard.

```python
nb.md("A pipeline that loads images, runs inference, and exports predictions.")
```

### `nb.ui()` -- Run-level UI defaults

Set default layout and display options for the web UI:

```python
nb.ui(layout="horizontal", view="dag", minimap=True, theme="dark")
```

### `nb.ask(question, options=None, timeout=None)` -- Human-in-the-loop

Pause the pipeline and ask the user a question via MCP or the terminal.

```python
@nb.fn()
def review(predictions):
    answer = nb.ask(
        "Model accuracy is 73%. Continue training?",
        options=["yes", "no", "retrain with more data"]
    )
    if answer == "no":
        return predictions
    ...
```

## CLI Reference

### Start the daemon server

```bash
nebo serve                  # foreground
nebo serve -d               # background (daemon mode)
nebo serve --port 3000      # custom port
nebo serve --no-store       # disable .nebo file storage
```

### Run a pipeline

```bash
nebo run my_pipeline.py
nebo run my_pipeline.py --name "experiment-1"
```

### Load a .nebo file

```bash
nebo load .nebo/2026-04-06_143000_run-1.nebo
```

### Check status, logs, errors

```bash
nebo status
nebo logs
nebo logs --run experiment-1 --node train --limit 50
nebo errors
nebo errors --run experiment-1
```

### Stop the daemon

```bash
nebo stop
```

### MCP integration

```bash
nebo mcp   # print Claude Code MCP config
```

## MCP Tools for AI Agents

Nebo exposes 15 MCP tools for querying and controlling pipelines from an AI agent (e.g., Claude). The daemon server must be running.

### Observation Tools

| Tool | Description |
|------|-------------|
| `nebo_get_graph` | Full DAG structure: nodes, edges, execution counts |
| `nebo_get_node_status` | Detailed status for one node: logs, metrics, errors, params |
| `nebo_get_logs` | Recent log entries, filterable by node and run |
| `nebo_get_metrics` | Metric time series for a node |
| `nebo_get_errors` | All errors with full tracebacks and node context |
| `nebo_get_description` | Workflow description and all node docstrings |

### Action Tools

| Tool | Description |
|------|-------------|
| `nebo_run_pipeline` | Start a pipeline script, returns a run ID |
| `nebo_stop_pipeline` | Stop a running pipeline by run ID |
| `nebo_restart_pipeline` | Stop and re-run a pipeline with same args |
| `nebo_get_run_status` | Status of a specific run (running/completed/crashed) |
| `nebo_get_run_history` | List all runs with outcomes and timestamps |
| `nebo_get_source_code` | Read a pipeline source file |
| `nebo_write_source_code` | Write or patch a pipeline source file |
| `nebo_ask_user` | Send a question to the user via the terminal |
| `nebo_wait_for_event` | Block until a pipeline event occurs or timeout elapses |

## .nebo File Format

Runs are persisted as `.nebo` binary files using MessagePack serialization. Each file contains a header (magic, version, metadata) followed by append-only event entries. Use `nebo load` to replay a file into the daemon.

## Architecture

```
+----------------+     +------------------+     +------------------+
|  Your Python   |---->|    Nebo SDK      |---->|  Daemon Server   |
|   Pipeline     |     |  (@fn, log,      |     |  (FastAPI,       |
|                |     |   track, ...)    |     |   port 2048)     |
+----------------+     +--------+---------+     +--------+---------+
                                |                        |
                        +-------v-------+ +--------------+---------------+
                        |   Terminal    | |              |               |
                        |   Dashboard  | |       +------v------+ +------v------+
                        |   (Rich)     | |       |  MCP Tools  | |   Web UI    |
                        +--------------+ |       |  (Claude)   | |             |
                                         |       +-------------+ +-------------+
                                   +-----v-----+
                                   |    CLI    |
                                   |    nebo   |
                                   +-----------+
```

Two execution modes:

- **Local mode** (default): In-process only. No daemon needed.
- **Server mode**: Events stream to a persistent daemon via HTTP. Use `nebo serve` to start the daemon, then `nebo run` to execute pipelines.

## API Reference

### Module: `nebo`

| Function | Signature | Description |
|----------|-----------|-------------|
| `fn` | `@fn()`, `@fn(depends_on=[...])`, `@fn(ui={...})` | Register a function/class as a DAG node |
| `log` | `log(message: str)` | Log a text message |
| `log_metric` | `log_metric(name, value, step=None)` | Log a scalar metric |
| `log_cfg` | `log_cfg(cfg: dict)` | Log node configuration |
| `log_image` | `log_image(image, name=None, step=None)` | Log an image |
| `log_audio` | `log_audio(audio, sr=16000, name=None, step=None)` | Log audio data |
| `log_text` | `log_text(name, text)` | Log rich text / Markdown |
| `track` | `track(iterable, name=None, total=None)` | Progress tracking |
| `md` | `md(description: str)` | Set workflow description |
| `ui` | `ui(layout, view, collapsed, minimap, theme)` | Set run-level UI defaults |
| `init` | `init(port, host, mode, terminal, dag_strategy, flush_interval, store)` | Manual initialization |
| `ask` | `ask(question, options=None, timeout=None)` | Human-in-the-loop prompt |
| `get_state` | `get_state() -> SessionState` | Access the global state singleton |

