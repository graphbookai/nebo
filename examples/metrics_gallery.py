"""Example: All metric types + tag filtering.

Demonstrates ``nb.log_metric`` with ``type="line"`` (default), ``"bar"``,
``"scatter"``, ``"pie"``, and ``"histogram"``, plus tag-based filtering in
the UI.
"""

import math

import numpy as np

import nebo as nb


@nb.fn()
def line_demo() -> None:
    """Classic scalar time series."""
    for step in range(100):
        nb.log_metric("loss", math.exp(-step / 20.0) + 0.01 * math.sin(step))
        if step < 20:
            nb.log_metric("lr", 1e-3, tags=["warmup"])
        else:
            nb.log_metric("lr", 3e-4, tags=["main"])


@nb.fn()
def bar_demo() -> None:
    """Category counts — each call is a snapshot."""
    nb.log_metric(
        "class_counts",
        {"cat": 43, "dog": 31, "bird": 12, "fish": 7},
        type="bar",
    )


@nb.fn()
def pie_demo() -> None:
    """Distribution at a point in time."""
    nb.log_metric(
        "token_budget",
        {"prompt": 820, "completion": 340, "scratch": 120},
        type="pie",
    )


@nb.fn()
def scatter_demo() -> None:
    """Point cloud — dimensionality reduction, embeddings, etc."""
    rng = np.random.default_rng(0)
    xs = rng.normal(0, 1, size=200).tolist()
    ys = [x * 0.5 + rng.normal(0, 0.3) for x in xs]
    nb.log_metric("embed_2d", {"x": xs, "y": ys}, type="scatter")


@nb.fn()
def histogram_demo() -> None:
    """Sample distribution — rendered as an area curve."""
    rng = np.random.default_rng(1)
    samples = rng.gamma(shape=2.0, scale=2.0, size=500).tolist()
    nb.log_metric("latencies_ms", samples, type="histogram")


def main() -> None:
    nb.md(
        "# Metrics gallery\n\n"
        "One node per metric type. Histogram uses an area curve. `line_demo`'s "
        "`lr` metric carries `warmup` and `main` tags — use the chip row "
        "above the chart to filter."
    )
    line_demo()
    bar_demo()
    pie_demo()
    scatter_demo()
    histogram_demo()


if __name__ == "__main__":
    main()
