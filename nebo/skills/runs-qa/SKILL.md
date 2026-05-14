---
name: nebo-runs-qa
description: Use when the user asks questions about nebo runs — logs, metrics, errors, DAG structure, comparisons across runs — or wants you to compute and display a derived metric (line, bar, pie, scatter, histogram) in the nebo web UI. Requires the nebo daemon to be running (`nebo serve`) and the nebo MCP server configured.
---

# Nebo Q&A and derived metrics

You are answering questions about nebo runs and, when useful, drawing new charts back into the nebo UI on the user's behalf.

## Precondition

The nebo daemon must be running locally on port 7861 (`nebo serve`). If MCP calls fail with a connection error, tell the user to run `nebo serve` (or `nebo serve --daemon` to background it). To configure the MCP server in Claude Code, run `nebo mcp` and follow the printout.

If the user is asking about a finished run that isn't loaded into the daemon, suggest `nebo load <path-to-.nebo>` first.

## Sandbox: the `__agent__` loggable

Every run has a synthetic loggable called `__agent__`. It is the **default home** for entries you write — `nebo_log_metric`, `nebo_log_text`, `nebo_log_image`, `nebo_log_audio` all default `loggable_id` to `__agent__` when you omit it. This keeps your derived metrics namespaced separately from user-emitted ones routed to `__global__` or to nodes.

**Rules of the sandbox:**
- Prefer `__agent__` for anything you compute. Only target a specific node (`loggable_id="some-node"`) if the user explicitly asks for the chart to live on that node.
- Pick metric names that won't collide with user-emitted metrics on `__agent__` (e.g. prefix with `derived_` or include the question's intent).
- Don't write to `__global__` — that's the user's scratch space.
- You cannot create new chart **types**. Only `line`, `bar`, `pie`, `scatter`, `histogram` are supported.

## MCP tool reference

### Observation (read)

| Tool | Args | Returns |
|------|------|---------|
| `nebo_get_run_history` | — | All runs with id, name, status, timestamps, error counts |
| `nebo_get_run_status` | `run_id` | One run's summary plus `metrics_index` (catalog of metric names per loggable) |
| `nebo_get_description` | — | Workflow description + per-node docstrings (latest run) |
| `nebo_get_graph` | `run_id?` | Nodes, edges, workflow description |
| `nebo_get_loggable_status` | `loggable_id`, `run_id?` | One loggable's full state — recent logs, metrics, errors, params, progress |
| `nebo_get_logs` | `loggable_id?`, `run_id?`, `limit?` | Log entries, optionally filtered by loggable |
| `nebo_get_metrics` | `loggable_id`, `name?` | Metric series under that loggable; pass `name` for a single metric |
| `nebo_get_errors` | `run_id?` | All errors with full tracebacks, per-node context |

### Write — defaults to `__agent__`

| Tool | Args (key fields) |
|------|-------------------|
| `nebo_log_metric` | `entries: [{loggable_id?, name, value, type?, step?, tags?}]` — `type` ∈ `line` (default, accumulating), `bar`, `pie`, `scatter`, `histogram` (snapshots) |
| `nebo_log_text` | `entries: [{loggable_id?, message, level?, step?}]` |
| `nebo_log_image` | `entries: [{loggable_id?, name, url? \| data?, step?, labels?}]` |
| `nebo_log_audio` | `entries: [{loggable_id?, name, url? \| data?, sr?, step?}]` |

### Metric value shapes

- **line:** `value: number`. Each call appends. `step` auto-increments per `(loggable, name)` if omitted.
- **bar:** `value: {label: number}`. Snapshot — re-emitting the same `name` overwrites.
- **pie:** `value: {label: number}`. Snapshot.
- **scatter:** `value: {label: {"x": [...], "y": [...]}}`. Accumulating. UI varies shape per label.
- **histogram:** `value: {label: [number, ...]}`. Snapshot. UI bins all labels against a shared min/max.

## Playbook A — single-run Q&A

1. **Anchor.** If the user doesn't specify a run, call `nebo_get_run_history` and assume the most recent one. State which run you picked.
2. **Orient.** Call `nebo_get_description` and (when the question is about structure) `nebo_get_graph` to know what nodes exist and what they do.
3. **Drill in.** Pick the right tool:
   - "What happened in node X?" → `nebo_get_loggable_status` with `loggable_id`.
   - "What was the final loss / accuracy / etc.?" → `nebo_get_run_status` first to find the metric in `metrics_index`, then `nebo_get_metrics`.
   - "Why did it fail / what errored?" → `nebo_get_errors`.
   - "What did node X log around step N?" → `nebo_get_logs` with `loggable_id` and a generous `limit`.
4. **Answer in plain prose.** Cite the run id and node names so the user can navigate the UI.

Concrete examples:

> *User: "What was the final accuracy?"*
> → `nebo_get_run_status` → find `accuracy` in `metrics_index` → `nebo_get_metrics(loggable_id, name="accuracy")` → report the last entry's value.

> *User: "Why did training crash?"*
> → `nebo_get_errors` → if found, summarize exception_type + exception_message + which node + last_logs.

## Playbook B — multi-run Q&A

There is no cross-run query endpoint. Loop manually:

1. `nebo_get_run_history` → pick the relevant runs (most recent N, or by name match).
2. For each, `nebo_get_run_status` (for `metrics_index`) and `nebo_get_metrics(loggable_id, name)` for the metrics of interest.
3. Reason across the results in your reply.

Concrete example:

> *User: "Compare final loss across the last 3 runs."*
> → `nebo_get_run_history` → take latest 3 → per run, `nebo_get_metrics` for `loss` → report final value per run, identify the best.

Token discipline: if there are many runs, prefer `nebo_get_run_history` + selective `nebo_get_metrics` over fetching every loggable.

## Playbook C — draw a new metric

When the user asks for something that would be clearer as a chart (a moving average, a comparison, a histogram of values, etc.), compute it and call `nebo_log_metric`. The chart appears in the nebo UI within a second.

Steps:

1. **Fetch the source data** with `nebo_get_metrics`.
2. **Compute the derived values** in your head or with code.
3. **Pick the chart type** that matches the shape of the answer:
   - Time series / trend → `line` (use `step` to align).
   - Category counts / shares → `bar` or `pie`.
   - Two-variable relationship → `scatter`.
   - Distribution of values → `histogram`.
4. **Emit.** Call `nebo_log_metric` with `run_id` set to the run you're answering about; omit `loggable_id` so it lands on `__agent__`.

Examples:

```jsonc
// Moving average of loss
{
  "entries": [
    {"name": "loss_ma_10", "type": "line", "value": 0.412, "step": 10},
    {"name": "loss_ma_10", "type": "line", "value": 0.387, "step": 11}
    // ...
  ],
  "run_id": "abc123"
}
```

```jsonc
// Per-class error counts as a bar snapshot
{
  "entries": [{
    "name": "errors_by_class",
    "type": "bar",
    "value": {"cat": 3, "dog": 7, "fish": 1}
  }],
  "run_id": "abc123"
}
```

```jsonc
// Distribution of step durations as a histogram
{
  "entries": [{
    "name": "step_duration_distribution",
    "type": "histogram",
    "value": {"durations_ms": [12.1, 13.4, 12.8, 14.0, 11.7, ...]}
  }],
  "run_id": "abc123"
}
```

After emitting, tell the user where to look (e.g. "Open the `__agent__` card in the nebo UI for run `abc123` — the new chart `loss_ma_10` is now there.").

## Anti-patterns

- **Don't dump raw metric arrays at the user** when a one-sentence answer suffices. Save the chart-emission tools for cases where the user explicitly asks for a chart or the answer is genuinely a distribution / trend.
- **Don't overwrite existing user metrics.** Always pick distinct names for derived metrics (e.g. prefix with `derived_` or `agent_`).
- **Don't log to `__global__`.** Use `__agent__` (the default).
- **Don't try to declare new chart types or layouts.** Stick to the five existing types.
- **Don't fetch every loggable's metrics in a multi-run loop.** Use `metrics_index` from `nebo_get_run_status` to pick the right names first.
- **Don't run pipelines speculatively.** `nebo_run_pipeline` exists but should only be used when the user explicitly asks to start, stop, or restart a script.
