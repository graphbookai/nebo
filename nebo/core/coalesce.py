"""Transport-level metric coalescing (format v4 `metric_batch`).

Both transports drain their queue on a flush tick and pass the batch
through :func:`coalesce` before writing/POSTing. Accumulating metric
events (line, scatter) sharing a `(loggable_id, name)` series are folded
into one `metric_batch` event with parallel ``steps``/``timestamps``/
``values`` arrays; everything else passes through untouched.

Semantics:
  * Equivalence rule — a `metric_batch` of length N is identical to N
    consecutive v3 `metric` events with the shared fields copied onto
    each (:func:`expand_metric_batch` is the inverse).
  * Per-series order is preserved exactly: a series' current batch is
    cut whenever its `(metric_type, tags, colors)` signature changes or
    `MAX_BATCH_POINTS` is reached, so per-point arrays never carry
    mixed metadata.
  * Cross-type ordering within a flush window is best-effort: a batch
    lands at its first member's position. Timestamps are authoritative.
  * Coalescing is an optimization, never required — every consumer
    accepts both `metric` and `metric_batch`, and size-1 groups stay
    plain `metric` events.
"""

from __future__ import annotations

from typing import Any

# Cap keeps a single frame comfortably under NetworkTransport's 2 MB
# chunk limit and bounds daemon-side fan-out per event.
MAX_BATCH_POINTS = 5000

# Chart types that accumulate over time. Snapshots (bar/pie/histogram)
# overwrite on re-emit, so batching them would be pure overhead.
ACCUMULATING_TYPES = ("line", "scatter")

_MARKER = "__coalesce_run__"


def coalesce(events: list[dict]) -> list[dict]:
    """Fold same-series accumulating metric events into metric_batch events."""
    staged: list[dict] = []
    open_runs: dict[tuple, dict] = {}  # (loggable_id, name) -> run

    for event in events:
        if (
            event.get("type") == "metric"
            and event.get("metric_type") in ACCUMULATING_TYPES
        ):
            key = (event.get("loggable_id"), event.get("name"))
            sig = (
                event.get("metric_type"),
                tuple(event.get("tags") or []),
                event.get("colors"),
            )
            run = open_runs.get(key)
            if (
                run is None
                or run["sig"] != sig
                or len(run["items"]) >= MAX_BATCH_POINTS
            ):
                run = {"sig": sig, "items": []}
                open_runs[key] = run
                staged.append({_MARKER: run})
            run["items"].append(event)
        else:
            staged.append(event)

    out: list[dict] = []
    for item in staged:
        run = item.get(_MARKER) if len(item) == 1 else None
        if run is None:
            out.append(item)
            continue
        items = run["items"]
        if len(items) == 1:
            out.append(items[0])
            continue
        first = items[0]
        batch: dict[str, Any] = {
            "type": "metric_batch",
            "loggable_id": first.get("loggable_id"),
            "name": first.get("name"),
            "metric_type": first.get("metric_type"),
            "steps": [e.get("step") for e in items],
            "timestamps": [e.get("timestamp") for e in items],
            "values": [e.get("value") for e in items],
            "tags": list(first.get("tags") or []),
        }
        if "colors" in first:
            batch["colors"] = first["colors"]
        out.append(batch)
    return out


def expand_metric_batch(payload: dict) -> list[dict]:
    """Inverse of :func:`coalesce` for one batch: N v3-shaped metric events."""
    steps = payload.get("steps") or []
    timestamps = payload.get("timestamps") or []
    values = payload.get("values") or []
    tags = list(payload.get("tags") or [])
    out: list[dict] = []
    for step, ts, value in zip(steps, timestamps, values):
        event: dict[str, Any] = {
            "type": "metric",
            "loggable_id": payload.get("loggable_id"),
            "name": payload.get("name"),
            "metric_type": payload.get("metric_type"),
            "value": value,
            "step": step,
            "tags": list(tags),
            "timestamp": ts,
        }
        if "colors" in payload:
            event["colors"] = payload["colors"]
        out.append(event)
    return out
