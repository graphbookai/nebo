"""Example: All metric types + tag filtering.

Demonstrates ``nb.log_metric`` with ``type="line"`` (default), ``"bar"``,
``"scatter"``, ``"pie"``, and ``"histogram"``. Every demo attaches ``tags``
to each emission so you can use the chip row above each chart in the UI
to filter which emissions are shown.

Line series plot step on the x-axis (one chart per metric name). For every
other type, *each* emission produces its own chart in the UI — so bar, pie,
scatter, and histogram emissions emitted across multiple ``step`` values
render as a stack of per-step charts.
"""

import math

import numpy as np

import nebo as nb


@nb.fn()
def line_demo() -> None:
    """Line: one chart with step on the x-axis.

    Tags partition emissions so clicking a tag chip shows only the
    matching subset of the series.
    """
    for step in range(100):
        phase = "warmup" if step < 20 else "main"
        nb.log_metric(
            "loss",
            math.exp(-step / 20.0) + 0.01 * math.sin(step),
            tags=[f"phase:{phase}"],
        )
        nb.log_metric(
            "lr",
            1e-3 if phase == "warmup" else 3e-4,
            tags=[f"phase:{phase}"],
        )


@nb.fn()
def bar_demo() -> None:
    """Bar: one chart per step. Tag each step with an A/B split label."""
    rng = np.random.default_rng(10)
    for step in range(4):
        split = "a" if step % 2 == 0 else "b"
        counts = {
            "cat":  int(rng.integers(10, 50)),
            "dog":  int(rng.integers(10, 50)),
            "bird": int(rng.integers(5, 25)),
            "fish": int(rng.integers(0, 15)),
        }
        nb.log_metric(
            "class_counts",
            counts,
            type="bar",
            step=step,
            tags=[f"split:{split}"],
        )


@nb.fn()
def pie_demo() -> None:
    """Pie: one chart per step. Tag with the run phase."""
    schedules = [
        ("warmup",  {"prompt": 820, "completion": 340, "scratch": 120}),
        ("warmup",  {"prompt": 640, "completion": 560, "scratch": 100}),
        ("steady",  {"prompt": 300, "completion": 900, "scratch":  80}),
        ("cooldown",{"prompt": 120, "completion": 200, "scratch":  40}),
    ]
    for step, (phase, s) in enumerate(schedules):
        nb.log_metric(
            "token_budget",
            s,
            type="pie",
            step=step,
            tags=[f"phase:{phase}"],
        )


@nb.fn()
def scatter_demo() -> None:
    """Scatter: one chart per step. Tag with the model version."""
    rng = np.random.default_rng(0)
    for step in range(4):
        version = "v1" if step < 2 else "v2"
        slope = 0.25 + 0.25 * step
        xs = rng.normal(0, 1, size=200).tolist()
        ys = [x * slope + rng.normal(0, 0.3) for x in xs]
        nb.log_metric(
            "embed_2d",
            {"x": xs, "y": ys},
            type="scatter",
            step=step,
            tags=[f"model:{version}"],
        )


@nb.fn()
def histogram_demo() -> None:
    """Histogram: one chart per step. Tag every other step as outlier-suspect."""
    rng = np.random.default_rng(1)
    for step in range(10):
        samples = rng.gamma(shape=(step / 2.0 + 1), scale=2.0, size=500).tolist()
        bucket = "suspect" if step % 3 == 0 else "normal"
        nb.log_metric(
            "latencies_ms",
            samples,
            type="histogram",
            step=step,
            tags=[f"bucket:{bucket}"],
        )


def main() -> None:
    nb.md(
        "# Metrics gallery\n\n"
        "Each demo attaches `tags` to every emission so the chip row above "
        "each chart can filter what's rendered. Line metrics plot over step; "
        "bar / pie / scatter / histogram emit **one chart per step**."
    )
    line_demo()
    bar_demo()
    pie_demo()
    scatter_demo()
    histogram_demo()


if __name__ == "__main__":
    main()
