"""Example: Global logging — nb.log* outside any @nb.fn() context.

Calls made outside a decorated function land on the Global loggable, which
appears as its own card at the top of the grid view (never in the DAG).
This example emits logs, metrics, a text snippet, and an image at module /
main-function scope so you can see each tab populated under the Global card.
"""

import math
import time

import numpy as np
from PIL import Image

import nebo as nb


@nb.fn()
def summarize(values: list[float]) -> dict:
    """One real DAG node so the Global card is visible alongside a node."""
    mean = sum(values) / len(values)
    nb.log(f"mean over {len(values)} values = {mean:.4f}")
    return {"count": len(values), "mean": mean}


def main() -> None:
    nb.md(
        "# Global logging demo\n\n"
        "This run emits logs, metrics, text, and an image from outside any "
        "`@nb.fn()` function. They all land on the Global loggable."
    )

    # ── Plain text logs at the Global level ───────────────────────────────────
    nb.log("pipeline starting")
    nb.log("loading config from env")
    nb.log("env looks healthy — proceeding")

    # ── Scalar metrics at the Global level ────────────────────────────────────
    # Auto-step counter, one series per name.
    for step in range(50):
        nb.log_metric("global_heartbeat", math.sin(step / 5.0))
        nb.log_metric("global_cost", 1.0 / (1 + step))

    # ── Text / markdown snippet on the Global loggable ────────────────────────
    nb.log_text(
        "env_report",
        "- python: OK\n- gpu: absent (CPU path)\n- cache: warm\n",
    )

    # ── Image on the Global loggable ──────────────────────────────────────────
    xx, yy = np.meshgrid(np.linspace(-3, 3, 128), np.linspace(-3, 3, 128))
    z = np.exp(-(xx ** 2 + yy ** 2) / 2.0)
    rgb = np.stack(
        [(z * 255).astype(np.uint8)] * 3,
        axis=-1,
    )
    nb.log_image(Image.fromarray(rgb), name="warmup_heatmap")

    # ── Then do some real DAG work so Global and node cards render together ──
    values = [float(i) * 0.1 for i in range(32)]
    result = summarize(values)
    nb.log(f"pipeline finished: {result}")

    # Give the event queue a moment to flush to the daemon / UI.
    time.sleep(0.3)


if __name__ == "__main__":
    main()
