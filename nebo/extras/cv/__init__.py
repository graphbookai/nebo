"""Computer vision extras for nebo.

Install with: pip install nebo[cv]

Provides pre-built @fn decorated functions for common CV operations.
"""

from nebo.extras.cv.resize import resize
from nebo.extras.cv.augment import augment
from nebo.extras.cv.transforms import normalize, to_tensor, color_convert, detect_edges, draw_boxes

__all__ = [
    "resize",
    "augment",
    "normalize",
    "to_tensor",
    "color_convert",
    "detect_edges",
    "draw_boxes",
]
