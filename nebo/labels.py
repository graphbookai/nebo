"""Image label dataclasses for nb.log_image.

Each class wraps the raw geometry data (list, numpy array, or torch
tensor) with a color string. Pass a single instance or a list of
instances to nb.log_image so a single image can carry multiple groups
of the same label kind in different colors (e.g. predictions vs.
ground truth).

    nb.log_image(
        img,
        boxes=[
            nb.labels.Boxes(pred_boxes, color="#22d3ee"),
            nb.labels.Boxes(gt_boxes, color="#22c55e"),
        ],
        points=nb.labels.Points([[10, 20]], color="red"),
    )

The `color` accepts any CSS color the browser understands — hex
strings (`"#ff0000"`) or named colors (`"red"`, `"cornflowerblue"`).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class Points:
    """A set of (x, y) points sharing one color.

    `data` accepts list[[x, y]], a 2D numpy array of shape (N, 2), a
    torch tensor of the same shape, or a single [x, y] for one point.
    """
    data: Any
    color: str


@dataclass
class Boxes:
    """A set of axis-aligned boxes [x1, y1, x2, y2] sharing one color."""
    data: Any
    color: str


@dataclass
class Circles:
    """A set of circles [x, y, r] sharing one color."""
    data: Any
    color: str


@dataclass
class Polygons:
    """A set of polygons sharing one color.

    Each polygon is a list of [x, y] points; `data` is a list of those
    polygons (list[list[[x, y]]]). When `fill` is True (the default) the
    polygon interior is filled with `color` at the rendered opacity; when
    False only the outline is stroked.
    """
    data: Any
    color: str
    fill: bool = True


@dataclass
class Bitmasks:
    """One or more 2D binary masks sharing one color.

    `data` accepts a 2D HxW mask, a 3D NxHxW stack, or a list of 2D
    masks. Numpy arrays and torch tensors are accepted.
    """
    data: Any
    color: str


__all__ = ["Points", "Boxes", "Circles", "Polygons", "Bitmasks"]
