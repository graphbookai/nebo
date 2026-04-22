"""Example: All metric types + tag filtering.

Demonstrates ``nb.log_metric`` with ``type="line"`` (default), ``"bar"``,
``"scatter"``, ``"pie"``, and ``"histogram"``, plus tag-based filtering in
the UI.

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
    """Classic scalar time series — one chart, x = step."""
    for step in range(100):
        nb.log_metric("loss", math.exp(-step / 20.0) + 0.01 * math.sin(step))
        if step < 20:
            nb.log_metric("lr", 1e-3, tags=["warmup"])
        else:
            nb.log_metric("lr", 3e-4, tags=["main"])


@nb.fn()
def bar_demo() -> None:
    """Category counts — one chart per step."""
    rng = np.random.default_rng(10)
    for step in range(3):
        counts = {
            "cat":  int(rng.integers(10, 50)),
            "dog":  int(rng.integers(10, 50)),
            "bird": int(rng.integers(5, 25)),
            "fish": int(rng.integers(0, 15)),
        }
        nb.log_metric("class_counts", counts, type="bar", step=step)


@nb.fn()
def pie_demo() -> None:
    """Distribution snapshot — one chart per step."""
    schedules = [
        {"prompt": 820, "completion": 340, "scratch": 120},
        {"prompt": 640, "completion": 560, "scratch": 100},
        {"prompt": 300, "completion": 900, "scratch":  80},
    ]
    for step, s in enumerate(schedules):
        nb.log_metric("token_budget", s, type="pie", step=step)


@nb.fn()
def scatter_demo() -> None:
    """Point cloud — one scatter per step."""
    rng = np.random.default_rng(0)
    for step in range(3):
        slope = 0.25 + 0.25 * step
        xs = rng.normal(0, 1, size=200).tolist()
        ys = [x * slope + rng.normal(0, 0.3) for x in xs]
        nb.log_metric("embed_2d", {"x": xs, "y": ys}, type="scatter", step=step)


@nb.fn()
def histogram_demo() -> None:
    """Sample distribution — one histogram per step (rendered as an area curve)."""
    rng = np.random.default_rng(1)
    for step in range(10):
        samples = rng.gamma(shape=(step / 2.0 + 1), scale=2.0, size=500).tolist()
        nb.log_metric("latencies_ms", samples, type="histogram", step=step)


def main() -> None:
    nb.md(
        "# Metrics gallery\n\n"
        "Line metrics render as a single chart with step on the x-axis. Bar, "
        "pie, scatter, and histogram metrics emit **one chart per step**, "
        "stacked vertically. Tag chips above the `lr` chart filter emissions."
    )
    line_demo()
    bar_demo()
    pie_demo()
    scatter_demo()
    histogram_demo()


if __name__ == "__main__":
    main()
