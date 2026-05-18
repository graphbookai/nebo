import numpy as np
from PIL import Image
import nebo as nb


@nb.fn()
def augment():
    rng = np.random.default_rng(0)
    base = rng.integers(0, 255, size=(128, 128, 3), dtype=np.uint8)
    nb.log_image(Image.fromarray(base), name="original")
    nb.log_image(np.ascontiguousarray(np.flip(base, axis=1)), name="flipped")
    bright = np.clip(base.astype(int) + 40, 0, 255).astype(np.uint8)
    nb.log_image(bright, name="brightened")


augment()
