---
name: nebo-runs-qa
description: Use when the user asks questions about nebo runs — logs, metrics, errors, DAG structure, comparisons across runs — or wants you to compute and display a derived metric (line, bar, pie, scatter, histogram) in the nebo web UI. Talks to the daemon via the `nebo` CLI (no MCP configuration required). The daemon must be running (`nebo serve`).
---

# Nebo Q&A and derived metrics (CLI)

Answer questions about nebo runs by spawning `nebo` CLI subprocesses with
`--json`. Optionally compute derived metrics and push them back into the
nebo UI via the same CLI.

## Precondition

The nebo daemon must be running:

    nebo serve            # foreground
    nebo serve --daemon   # background

The `nebo` CLI must be on `$PATH`. No MCP configuration required.

If the user asks about a finished run not loaded into the daemon, suggest:

    nebo load <path-to-.nebo>

## Finding the run id

When the user runs a script, the SDK prints a banner to their terminal:

    Nebo daemon fully connected. Your run id is: abc123def456.

Use that 12-character hex id in every subsequent command. If the user
hasn't shared their terminal output:

    nebo runs list --json

and pick the most recent.

## Q&A playbook (single run)

Always pass `--json`. Pipe the output into your reasoning step — don't
rely on the human-formatted columns.

| Intent | Command |
|---|---|
| What runs exist? | `nebo runs list --json` |
| Summarize run R | `nebo runs show <R> --json` |
| What does the workflow do? | `nebo describe --run <R> --json` |
| Inspect the DAG | `nebo graph show --run <R> --json` |
| What did node N do? | `nebo loggables show <N> --run <R> --json` |
| Get logs for node N | `nebo logs --run <R> --node <N> --json` |
| Get errors | `nebo errors --run <R> --json` |
| List available metrics | `nebo metrics list --run <R> --json` |
| Read metric values | `nebo metrics get <loggable> --name <M> --run <R> --json` |
| Filter a metric by tag | append `--tag <T>` |
| Filter a metric by step | append `--step <S>` |
| Wait for an alert | `nebo runs wait <R> --timeout 300 --min-level 20 --json` |

`nebo runs wait` blocks until `nb.alert(...)` fires in the pipeline at a
level at or above `--min-level`, or the `--timeout` elapses.

## Drawing a derived metric

When the answer is better as a chart, compute the values and write them
to the `__agent__` sandbox loggable:

    nebo metrics log --run <R> --entries-json '[{"name":"loss_ma_10","type":"line","value":0.412,"step":10}]'

Value shapes per chart type:

- `line` (accumulating): `value` is a number. `step` aligns the x-axis.
- `bar` (snapshot): `value` is `{"label": number}`; re-emit overwrites.
- `pie` (snapshot): `value` is `{"label": number}`; re-emit overwrites.
- `scatter` (accumulating): `value` is `{"label": {"x": [...], "y": [...]}}`.
- `histogram` (snapshot): `value` is `{"label": [number, ...]}`.

`loggable_id` defaults to `__agent__` when omitted — the right home for
derived work. Use a distinct `name` (e.g. `derived_<intent>`) to avoid
colliding with user-emitted metrics.

### Adding to an existing chart vs. making a new one

Each `(loggable_id, name)` pair is one chart. The **chart type** locks
on first emission for that pair — once a series is created as `scatter`
you can't later re-emit it as `bar`. The **data and labels do not lock**:

- `line` and `scatter` *accumulate*. Re-emitting the same
  `(loggable_id, name)` with a new value (and, for scatter, new labels)
  adds points/series to the existing chart. Old data stays.
- `bar`, `pie`, `histogram` are *snapshots*. Re-emitting overwrites the
  prior value — the chart now shows only the new data.

So to overlay agent-computed points onto a user's existing scatter chart,
emit with the user's exact `loggable_id` and `name` (and `type:"scatter"`).
To keep agent output separated, emit to `__agent__` (the default) under a
new `name`.

## Images and audio

You can emit images or audio with three input shapes:

| Field | Where the bytes are |
|---|---|
| `path: "/abs/path.png"` | On disk; the CLI reads and base64-encodes |
| `url: "https://..."` | Remote; the daemon fetches and stores |
| `data: "<base64>"` | Already base64 |

Exactly one of `path` / `url` / `data` per entry. Examples:

    nebo images log --run <R> --entries-json '[{"name":"plot","path":"/tmp/plot.png"}]'
    nebo audio log  --run <R> --entries-json '[{"name":"snd","path":"/tmp/snd.wav","sr":22050}]'

`path` is the most natural form when you've just generated the file
yourself (e.g. matplotlib `savefig` to a tmp file).

## Multi-run Q&A

There is no cross-run query. Loop:

1. `nebo runs list --json` — pick the relevant run ids.
2. For each: `nebo runs show <id> --json` (for `metrics_index`) then
   `nebo metrics get <loggable> --name <M> --run <id> --json` for the
   metrics of interest.
3. Reason across the responses in your reply.

Token discipline: prefer `metrics_index` from `runs show` over fetching
every loggable's metrics blindly.

### Visualizing a cross-run answer

Comparison views in the nebo web UI are pure UI state — the daemon
doesn't know which runs the user has selected, and you can't push the
UI into a particular comparison. But you have two ways to make a
cross-run answer *visual*:

**A. Seed an overlay the user can open themselves.** Emit the same
metric `name` to the same `loggable_id` on each run you want compared.
Example: after looping the runs you want to compare, write a
`derived_loss` line metric to `__agent__` on each:

    nebo metrics log --run R1 --entries-json '[{"name":"derived_loss","type":"line","value":0.41,"step":0}]'
    nebo metrics log --run R2 --entries-json '[{"name":"derived_loss","type":"line","value":0.38,"step":0}]'
    nebo metrics log --run R3 --entries-json '[{"name":"derived_loss","type":"line","value":0.45,"step":0}]'

Tell the user: "Open the comparison view, select R1/R2/R3, and look at
`__agent__ ▸ derived_loss`." The UI overlays the three series — same
loggable_id + name across selected runs is the comparison contract.

**B. Synthesize the comparison into a single chart on one run.** When
you don't need the user to do anything in the UI, fold the multi-run
result into a single chart on one chosen run. A bar chart keyed by run
name is the most common form:

    nebo metrics log --run R1 --entries-json '[{
      "name": "final_loss_by_run",
      "type": "bar",
      "value": {"R1": 0.41, "R2": 0.38, "R3": 0.45}
    }]'

That single bar chart on `__agent__` answers the cross-run question
without requiring the user to open the comparison view at all. Useful
when the comparison itself is the deliverable rather than a starting
point for further exploration.

## Anti-patterns

- Don't omit `--json`. Human columns drift and break parsers.
- Don't write to `__global__` — that's the user's space. Default
  `loggable_id` `__agent__` is correct for derived work.
- Don't try to declare new chart types — only line/bar/pie/scatter/histogram.
- Don't try to start/stop pipelines from the skill. That's the user's
  shell (`uv run python script.py`, Ctrl+C, `pkill`).

## Connection settings

Every read/write subcommand accepts:

- `--url <url>` — daemon URL (defaults to `NEBO_URL` env or `http://localhost:7861`).
- `--port <N>` — daemon port if the daemon isn't at the default.
- `--api-token <token>` — required if the daemon was started with
  `nebo serve --api-token <X>` and read access is gated.

You can also set `NEBO_URL`, `NEBO_PORT`, `NEBO_API_TOKEN` environment
variables once instead of passing flags every call.

## Optional: MCP

If the user already has the nebo MCP server configured, the same tools
are available without spawning subprocesses. Both transports are parallel
— pick one based on the user's setup.

| CLI | MCP tool |
|---|---|
| `nebo runs list` | `nebo_get_run_history` |
| `nebo runs show <R>` | `nebo_get_run_status` |
| `nebo describe` | `nebo_get_description` |
| `nebo graph show` | `nebo_get_graph` |
| `nebo loggables show <id>` | `nebo_get_loggable_status` |
| `nebo logs` | `nebo_get_logs` |
| `nebo errors` | `nebo_get_errors` |
| `nebo metrics get` | `nebo_get_metrics` |
| `nebo metrics log` | `nebo_log_metric` |
| `nebo text log` | `nebo_log_text` |
| `nebo images log` | `nebo_log_image` |
| `nebo audio log` | `nebo_log_audio` |
| `nebo runs wait` | `nebo_wait_for_alert` |
| `nebo load` | `nebo_load_file` |
