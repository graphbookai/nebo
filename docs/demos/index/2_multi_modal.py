import nebo as nb
import numpy as np
from PIL import Image


def _make_synthetic_image(index: int, size: int = 128) -> Image.Image:
    """Generate a colorful synthetic image based on the index."""
    arr = np.zeros((size, size, 3), dtype=np.uint8)
    freq = 1 + index * 0.5
    for y in range(size):
        for x in range(size):
            arr[y, x, 0] = int(127 + 127 * np.sin(2 * np.pi * freq * x / size))
            arr[y, x, 1] = int(127 + 127 * np.sin(2 * np.pi * freq * y / size + index))
            arr[y, x, 2] = int(127 + 127 * np.cos(2 * np.pi * freq * (x + y) / size))
    return arr


@nb.fn()
def load_images():
    images = []
    for i in range(4):
        im = _make_synthetic_image(i)
        images.append(im)
        nb.log_image(Image.fromarray(im), name="images", step=i)
    return images


@nb.fn()
def log_brightness(images):
    for im in images:
        nb.log_line("brightness", im.mean())


def run():
    data = load_images()
    log_brightness(data)


if __name__ == "__main__":
    run()
