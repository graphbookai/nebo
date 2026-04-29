"""Example: All typed log_* metric functions + tag/label filtering.

Demonstrates ``nb.log_line``, ``nb.log_bar``, ``nb.log_pie``,
``nb.log_scatter``, and ``nb.log_histogram``. Every demo attaches
``tags`` to each emission so you can use the chip row above each chart
in the UI to filter which emissions are shown. ``log_scatter`` also
exposes a per-label chip row — labels are the dict keys of the
``{label: list[(x, y)]}`` value.

Line series plot step on the x-axis (one chart per metric name). For
every other type, *each* emission produces its own chart in the UI —
so bar, pie, and histogram emissions emitted across multiple ``step``
values render as a stack of per-step charts.
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
    """Bar: one chart per step. Tag each step with an A/B split label."""
    rng = _rng(2)
    for step in range(4):
        split = "a" if step % 2 == 0 else "b"
        counts = {
            "cat":  int(rng.integers(10, 50)),
            "dog":  int(rng.integers(10, 50)),
            "bird": int(rng.integers(5, 25)),
            "fish": int(rng.integers(0, 15)),
        }
        nb.log_bar(
            "class_counts",
            counts,
            step=step,
            tags=[f"split:{split}"],
        )


@nb.fn(ui={"default_tab": "metrics"})
def pie_demo() -> None:
    """Pie: one chart per step. Tag with the run phase."""
    rng = _rng(3)
    phases = ["warmup", "warmup", "steady", "cooldown"]
    for step, phase in enumerate(phases):
        snapshot = {
            "prompt":     int(rng.integers(100, 1000)),
            "completion": int(rng.integers(100, 1000)),
            "scratch":    int(rng.integers(40, 200)),
        }
        nb.log_pie(
            "token_budget",
            snapshot,
            step=step,
            tags=[f"phase:{phase}"],
        )


@nb.fn(ui={"default_tab": "metrics"})
def scatter_demo() -> None:
    """Scatter: one chart per emission, with multiple labeled clusters.

    Each emission's value is ``{label: list[(x, y)]}`` — every label
    becomes its own series on the same chart, distinguished by shape,
    and the per-label chip row in the UI lets you toggle clusters on
    and off independently of the tag chips.
    """
    rng = _rng(4)
    for step in range(2):
        version = "v1" if step < 1 else "v2"
        # Two clusters per emission so the per-label chip row has
        # something to toggle. Each cluster picks its own slope.
        clusters = {}
        for label in ("inliers", "outliers"):
            slope = float(rng.uniform(0.1, 1.0))
            xs = rng.normal(0, 1, size=40).tolist()
            ys = [x * slope + float(rng.normal(0, 0.3)) for x in xs]
            clusters[label] = list(zip(xs, ys))
        nb.log_scatter(
            "embed_2d",
            clusters,
            step=step,
            tags=[f"model:{version}"],
        )


@nb.fn(ui={"default_tab": "metrics"})
def histogram_demo() -> None:
    """Histogram: one chart per step. Tag every other step as outlier-suspect."""
    rng = _rng(5)
    for step in range(10):
        shape = float(rng.uniform(1.0, 4.0)) + step / 4.0
        samples = rng.gamma(shape=shape, scale=2.0, size=500).tolist()
        bucket = "suspect" if step % 3 == 0 else "normal"
        nb.log_histogram(
            "latencies_ms",
            samples,
            step=step,
            tags=[f"bucket:{bucket}"],
        )


def main() -> None:
    nb.md(
        "# Metrics gallery\n\n"
        "Each demo attaches `tags` to every emission so the chip row above "
        "each chart can filter what's rendered. `log_line` plots a whole "
        "series on step; `log_bar` and `log_pie` emit **one chart per step**; "
        "`log_histogram` combines all steps into one chart (overlapping "
        "areas); `log_scatter` lays each emission's labeled clusters onto "
        "one chart, distinguishable by shape and toggleable via the per-"
        "label chip row. Colors indicate the **run** — single-run views "
        "use the run's color for every series."
    )
    nb.ui(tracker="step")
    line_demo()
    bar_demo()
    pie_demo()
    scatter_demo()
    histogram_demo()


if __name__ == "__main__":
    main()
