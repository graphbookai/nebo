"""Example: each ``nb.labels.*`` kind in its own node, plus a combined demo.

Demonstrates ``nb.log_image`` with ``nb.labels.{Points, Boxes, Circles,
Polygons, Bitmasks}``. Each label kind gets its own node so you can see
the overlay shape in isolation; the final ``combined_demo`` shows that
all five compose on the same image. Each kwarg on ``nb.log_image``
accepts a single dataclass instance or a list of them, so one image can
carry multiple groups of the same kind in different colors (the
``boxes_demo`` shows the canonical predictions-vs-ground-truth pattern).

With the daemon and UI running, open each node's Images tab. The
Settings pane > "Image labels" section lets you toggle each label's
visibility and tune its opacity.
"""

import numpy as np
from PIL import Image

import nebo as nb


H, W = 128, 128


def _gradient_image() -> Image.Image:
    """Synthetic gradient background so labels are easy to see."""
    xx, yy = np.meshgrid(np.linspace(0, 1, W), np.linspace(0, 1, H))
    rgb = np.stack(
        [
            ((xx) * 255).astype(np.uint8),
            ((xx * yy) * 255).astype(np.uint8),
            ((yy) * 255).astype(np.uint8),
        ],
        axis=-1,
    )
    return Image.fromarray(rgb)


@nb.fn(ui={"default_tab": "images"})
def points_demo() -> None:
    """Five keypoints along the diagonal, one color."""
    nb.log_image(
        _gradient_image(),
        name="points",
        points=nb.labels.Points(
            [[20, 20], [40, 40], [60, 60], [80, 80], [100, 100]],
            color="#facc15",
        ),
    )


@nb.fn(ui={"default_tab": "images"})
def boxes_demo() -> None:
    """Two box groups in different colors — predictions vs. ground truth.

    The canonical use case for ``nb.log_image(..., boxes=[Boxes(...), Boxes(...)])``.
    """
    nb.log_image(
        _gradient_image(),
        name="boxes",
        boxes=[
            nb.labels.Boxes([[10, 10, 60, 60]], color="#22d3ee"),  # predictions
            nb.labels.Boxes([[70, 20, 120, 100]], color="#22c55e"),  # ground truth
        ],
    )


@nb.fn(ui={"default_tab": "images"})
def circles_demo() -> None:
    """Three circles of varying radii, one color."""
    nb.log_image(
        _gradient_image(),
        name="circles",
        circles=nb.labels.Circles(
            [[30, 90, 8], [60, 30, 12], [100, 70, 5]],
            color="#f472b6",
        ),
    )


@nb.fn(ui={"default_tab": "images"})
def polygons_demo() -> None:
    """Two polygons: one filled, one outline-only.

    ``Polygons`` takes ``fill: bool = True``; flip it to draw the
    outline only.
    """
    nb.log_image(
        _gradient_image(),
        name="polygons",
        polygons=[
            nb.labels.Polygons(
                [[[15, 110], [40, 60], [70, 115]]],
                color="#86efac",
                fill=True,
            ),
            nb.labels.Polygons(
                [[[80, 30], [115, 50], [110, 90], [85, 80]]],
                color="#fb923c",
                fill=False,
            ),
        ],
    )


@nb.fn(ui={"default_tab": "images"})
def bitmasks_demo() -> None:
    """One binary segmentation mask, tinted to the group's color."""
    mask = np.zeros((H, W), dtype=np.uint8)
    mask[40:80, 40:80] = 1
    nb.log_image(
        _gradient_image(),
        name="bitmask",
        bitmasks=nb.labels.Bitmasks(mask, color="#a78bfa"),
    )


@nb.fn(ui={"default_tab": "images"})
def combined_demo() -> None:
    """All five label kinds on one image."""
    mask = np.zeros((H, W), dtype=np.uint8)
    mask[40:80, 40:80] = 1
    nb.log_image(
        _gradient_image(),
        name="combined",
        points=nb.labels.Points(
            [[20, 20], [40, 40], [60, 60], [80, 80], [100, 100]],
            color="#facc15",
        ),
        boxes=[
            nb.labels.Boxes([[10, 10, 60, 60]], color="#22d3ee"),
            nb.labels.Boxes([[70, 20, 120, 100]], color="#22c55e"),
        ],
        circles=nb.labels.Circles(
            [[30, 90, 8], [60, 30, 12], [100, 70, 5]],
            color="#f472b6",
        ),
        polygons=nb.labels.Polygons(
            [[[15, 110], [40, 60], [70, 115]]],
            color="#86efac",
            fill=False,
        ),
        bitmasks=nb.labels.Bitmasks(mask, color="#a78bfa"),
    )


def main() -> None:
    nb.md(
        "# Image label demo\n\n"
        "Each label kind in its own node, plus a `combined_demo` that "
        "shows all five composed on a single image. Open Settings > "
        "Image labels to toggle visibility or tune opacity per label kind."
    )
    points_demo()
    boxes_demo()
    circles_demo()
    polygons_demo()
    bitmasks_demo()
    combined_demo()


if __name__ == "__main__":
    main()
