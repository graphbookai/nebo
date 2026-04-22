"""Serializers for various data types (images, audio, tensors)."""

from __future__ import annotations

import io
from typing import Any


def serialize_image(image: Any) -> bytes:
    """Serialize an image to PNG bytes.

    Supports: PIL.Image, numpy array, torch tensor.

    Args:
        image: The image to serialize.

    Returns:
        PNG-encoded bytes.

    Raises:
        TypeError: If *image* is not a supported type.
        Any exception raised by the underlying conversion (e.g. a
        broken numpy array, bad PIL dtype) is propagated unmodified
        rather than being silently remapped to "unsupported type".
    """
    # PIL Image
    try:
        from PIL import Image as _PILImage
    except ImportError:
        _PILImage = None

    if _PILImage is not None and isinstance(image, _PILImage.Image):
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()

    # Torch tensor
    try:
        import torch
    except ImportError:
        torch = None

    if torch is not None and isinstance(image, torch.Tensor):
        arr = image.detach().cpu().numpy()
        return _numpy_to_png(arr)

    # Numpy array
    try:
        import numpy as np
    except ImportError:
        np = None

    if np is not None and isinstance(image, np.ndarray):
        return _numpy_to_png(image)

    raise TypeError(f"Cannot serialize image of type {type(image).__name__}")


def _numpy_to_png(arr: Any) -> bytes:
    """Convert a numpy array to PNG bytes."""
    import numpy as np
    from PIL import Image

    if arr.ndim == 3 and arr.shape[0] in (1, 3, 4):
        # CHW -> HWC
        arr = np.transpose(arr, (1, 2, 0))

    if arr.dtype == np.float32 or arr.dtype == np.float64:
        arr = (arr * 255).clip(0, 255).astype(np.uint8)

    if arr.ndim == 3 and arr.shape[2] == 1:
        arr = arr.squeeze(2)

    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def serialize_audio(audio: Any, sr: int = 16000) -> bytes:
    """Serialize audio to WAV bytes.

    Args:
        audio: Audio data as numpy array.
        sr: Sample rate.

    Returns:
        WAV-encoded bytes.
    """
    import numpy as np
    import struct
    import wave

    if not isinstance(audio, np.ndarray):
        audio = np.array(audio, dtype=np.float32)

    if audio.dtype in (np.float32, np.float64):
        audio = (audio * 32767).clip(-32768, 32767).astype(np.int16)

    buf = io.BytesIO()
    channels = 1 if audio.ndim == 1 else audio.shape[1]

    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sr)
        wf.writeframes(audio.tobytes())

    return buf.getvalue()


def _to_list(value: Any) -> Any:
    """Convert tensor/ndarray to nested Python lists; pass lists through."""
    if hasattr(value, "tolist"):
        return value.tolist()
    return value


def _normalize_points(value: Any) -> list[list[float]]:
    v = _to_list(value)
    if not isinstance(v, list) or len(v) == 0:
        return []
    if not isinstance(v[0], (list, tuple)):
        return [list(v)]
    return [list(p) for p in v]


def _normalize_boxes(value: Any) -> list[list[float]]:
    v = _to_list(value)
    if not isinstance(v, list) or len(v) == 0:
        return []
    if not isinstance(v[0], (list, tuple)):
        return [list(v)]
    return [list(b) for b in v]


def _normalize_circles(value: Any) -> list[list[float]]:
    v = _to_list(value)
    if not isinstance(v, list) or len(v) == 0:
        return []
    if not isinstance(v[0], (list, tuple)):
        return [list(v)]
    return [list(c) for c in v]


def _normalize_polygons(value: Any) -> list[list[list[float]]]:
    v = _to_list(value)
    if not isinstance(v, list) or len(v) == 0:
        return []
    first = v[0]
    if (
        isinstance(first, (list, tuple))
        and len(first) > 0
        and not isinstance(first[0], (list, tuple))
    ):
        # Single polygon (outer is a flat list of points).
        return [[list(p) for p in v]]
    return [[list(p) for p in poly] for poly in v]


def _normalize_bitmask(value: Any) -> list:
    """Return a list of 2D mask objects (original dtype preserved)."""
    if isinstance(value, list):
        return list(value)
    if hasattr(value, "shape"):
        if len(value.shape) == 2:
            return [value]
        if len(value.shape) == 3:
            return [value[i] for i in range(value.shape[0])]
    return [value]
