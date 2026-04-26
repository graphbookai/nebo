"""Example: All five image label kinds attached to one image.

Demonstrates ``nb.log_image(..., points=..., boxes=..., circles=...,
polygons=..., bitmask=...)``. With the daemon and UI running, open the
run's `label_demo` node > Images tab to see each label overlay rendered
on top of a synthetic 128x128 image. The Settings pane > "Image labels"
section lets you toggle each label's visibility and tune its opacity.
"""

import numpy as np
from PIL import Image

import nebo as nb


@nb.fn(ui={"default_tab": "images"})
def label_demo() -> None:
    """Emit one synthetic image with all five label kinds."""
    h, w = 128, 128

    # Synthetic gradient background so labels are easy to see.
    xx, yy = np.meshgrid(np.linspace(0, 1, w), np.linspace(0, 1, h))
    rgb = np.stack(
        [
            ((1 - xx) * 255).astype(np.uint8),
            ((xx * yy) * 255).astype(np.uint8),
            ((yy) * 255).astype(np.uint8),
        ],
        axis=-1,
    )
    img = Image.fromarray(rgb)

    # Five keypoints along a diagonal.
    points = [[20, 20], [40, 40], [60, 60], [80, 80], [100, 100]]

    # Two bounding boxes (xyxy).
    boxes = [[10, 10, 60, 60], [70, 20, 120, 100]]

    # Three circles (x, y, r).
    circles = [[30, 90, 8], [60, 30, 12], [100, 70, 5]]

    # One triangle polygon.
    polygons = [[[15, 110], [40, 60], [70, 115]]]

    # Segmentation mask: a 2D binary array the same resolution as the image.
    mask = np.zeros((h, w), dtype=np.uint8)
    mask[40:80, 40:80] = 1

    nb.log_image(
        img,
        name="demo",
        points=points,
        boxes=boxes,
        circles=circles,
        polygons=polygons,
        bitmask=mask,
    )


def main() -> None:
    nb.md(
        "# Image label demo\n\n"
        "One image tagged with points, boxes, circles, polygons, and a "
        "bitmask. Open Settings > Image labels to toggle visibility or "
        "tune opacity per label kind."
    )
    label_demo()


if __name__ == "__main__":
    main()
