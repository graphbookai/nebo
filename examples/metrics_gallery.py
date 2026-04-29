"""Example: All typed log_* metric functions.

Demonstrates ``nb.log_line``, ``nb.log_bar``, ``nb.log_pie``,
``nb.log_scatter``, and ``nb.log_histogram``.

* ``log_line`` is the only chart type that accumulates over time —
  every call appends another step to the series, and the ``tags`` /
  ``step`` kwargs partition the emissions for chip-based UI filtering.

* ``log_bar``, ``log_pie``, ``log_scatter``, and ``log_histogram`` are
  **snapshots**: re-emitting the same metric name overwrites the
  prior value. They have no concept of step or tags.

* ``log_scatter`` and ``log_histogram`` accept a ``colors`` kwarg
  (default ``False``). When ``True`` the UI colors labels using the
  shared palette instead of distinguishing them by shape (scatter) or
  alpha-overlap only (histogram). ``colors=True`` is best in
  single-run views — comparison views reserve the palette for run
  identity, so colored labels become ambiguous.
"""

import math
import time

import numpy as np

import nebo as nb


# Unique per-execution seed so repeated runs produce different data and
# comparison views show distinct runs instead of identical overlays.
_SEED = int(time.time() * 1000) & 0xFFFFFFFF


def _rng(offset: int = 0) -> np.random.Generator:
    return np.random.default_rng(_SEED + offset)


@nb.fn(ui={"default_tab": "metrics"})
def line_demo() -> None:
    """Line: one chart with step on the x-axis.

    Tags partition emissions so clicking a tag chip shows only the
    matching subset of the series.
    """
    rng = _rng(1)
    jitter_scale = float(rng.uniform(0.5, 1.5))
    for step in range(100):
        phase = "warmup" if step < 20 else "main"
        nb.log_line(
            "loss",
            math.exp(-step / 20.0) + 0.1 * jitter_scale * math.sin(step + _SEED % 7),
            tags=[f"phase:{phase}"],
        )
        nb.log_line(
            "lr",
            1e-3 if phase == "warmup" else 3e-4,
            tags=[f"phase:{phase}"],
        )


@nb.fn(ui={"default_tab": "metrics"})
def bar_demo() -> None:
    """Bar: a single snapshot of category counts."""
    rng = _rng(2)
    nb.log_bar(
        "class_counts",
        {
            "cat":  int(rng.integers(10, 50)),
            "dog":  int(rng.integers(10, 50)),
            "bird": int(rng.integers(5, 25)),
            "fish": int(rng.integers(0, 15)),
        },
    )


@nb.fn(ui={"default_tab": "metrics"})
def pie_demo() -> None:
    """Pie: a single snapshot of a budget breakdown."""
    rng = _rng(3)
    nb.log_pie(
        "token_budget",
        {
            "prompt":     int(rng.integers(100, 1000)),
            "completion": int(rng.integers(100, 1000)),
            "scratch":    int(rng.integers(40, 200)),
        },
    )


@nb.fn(ui={"default_tab": "metrics"})
def scatter_demo() -> None:
    """Scatter: one labeled-cluster snapshot.

    The value is ``{label: list[(x, y)]}`` — every label becomes its
    own series on the same chart, distinguished by shape, and
    toggleable via the UI chip row.
    """
    rng = _rng(4)
    clusters = {}
    for label in ("inliers", "outliers"):
        slope = float(rng.uniform(0.1, 1.0))
        xs = rng.normal(0, 1, size=40).tolist()
        ys = [x * slope + float(rng.normal(0, 0.3)) for x in xs]
        clusters[label] = list(zip(xs, ys))
    nb.log_scatter("embed_2d", clusters, colors=True)


@nb.fn(ui={"default_tab": "metrics"})
def histogram_demo() -> None:
    """Histogram: a single snapshot with multiple labeled distributions.

    The value is ``{label: list[number]}``; the UI bins every label
    against a shared range so overlapping distributions line up. The
    ``colors=True`` flag asks the UI to color each label distinctly
    from the shared palette — useful in this single-run example where
    color isn't already encoding run identity.
    """
    rng = _rng(5)
    nb.log_histogram(
        "latencies_ms",
        {
            "p50": rng.gamma(shape=2.0, scale=2.0, size=500).tolist(),
            "p95": rng.gamma(shape=4.0, scale=2.5, size=500).tolist(),
            "p99": rng.gamma(shape=6.0, scale=3.0, size=500).tolist(),
        },
        colors=True,
    )


def main() -> None:
    nb.md(
        "# Metrics gallery\n\n"
        "`log_line` is the only chart type that accumulates over "
        "steps; the four snapshot helpers (`log_bar`, `log_pie`, "
        "`log_scatter`, `log_histogram`) overwrite on re-emission and "
        "have no concept of step or tags.\n\n"
        "`log_scatter` / `log_histogram` accept `colors=True` to "
        "distinguish labels using the shared palette. The histogram "
        "demo uses `colors=True` to make the three percentiles legible; "
        "scatter sticks with `colors=False` (the default) so shape "
        "alone carries the label distinction."
    )
    nb.ui(tracker="step")
    line_demo()
    bar_demo()
    pie_demo()
    scatter_demo()
    histogram_demo()


if __name__ == "__main__":
    main()
