"""Logging functions for nebo."""

from __future__ import annotations

import time
from typing import Any, Optional, Union

from nebo.core.state import _current_node, get_state


GLOBAL_LOGGABLE_ID = "__global__"


def _ensure_initialized() -> None:
    """Trigger auto-init if not yet initialized."""
    try:
        from nebo import _ensure_init
        _ensure_init()
    except ImportError:
        pass


def _is_tensor_like(obj: Any) -> bool:
    """Check if obj is a numpy ndarray or torch Tensor."""
    type_name = type(obj).__name__
    module = type(obj).__module__ or ""
    if type_name == "ndarray" and "numpy" in module:
        return True
    if type_name == "Tensor" and "torch" in module:
        return True
    return False


def _format_tensor(obj: Any) -> str:
    """Format a tensor-like object into a readable markdown string.

    Includes type, shape, dtype, and basic statistics (min/max/mean)
    so the log tab in the UI displays it nicely.
    """
    parts: list[str] = []
    type_name = type(obj).__name__
    module = type(obj).__module__ or ""

    # Header
    if "torch" in module:
        parts.append(f"**Tensor** (`torch.{type_name}`)")
    else:
        parts.append(f"**ndarray** (`numpy.{type_name}`)")

    # Shape
    if hasattr(obj, "shape"):
        parts.append(f"  shape: `{tuple(obj.shape)}`")

    # Dtype
    if hasattr(obj, "dtype"):
        parts.append(f"  dtype: `{obj.dtype}`")

    # Device (torch only)
    if hasattr(obj, "device"):
        parts.append(f"  device: `{obj.device}`")

    # Requires grad (torch only)
    if hasattr(obj, "requires_grad"):
        parts.append(f"  requires_grad: `{obj.requires_grad}`")

    # Statistics
    try:
        if hasattr(obj, "min") and hasattr(obj, "max"):
            min_val = float(obj.min())
            max_val = float(obj.max())
            parts.append(f"  min: `{min_val:.6g}`, max: `{max_val:.6g}`")
        if hasattr(obj, "mean"):
            mean_val = float(obj.mean())
            parts.append(f"  mean: `{mean_val:.6g}`")
    except Exception:
        pass

    return "\n".join(parts)


def log(message: Union[str, Any], *, step: Optional[int] = None) -> None:
    """Log a message to the current node.

    Accepts plain strings as well as tensor-like objects (numpy
    ndarray, torch Tensor).  Tensor-like objects are automatically
    formatted with shape, dtype, and basic statistics so they
    display nicely in the UI log tab.

    Args:
        message: The message string, or a tensor/ndarray to format.
        step: Optional step counter.
    """
    _ensure_initialized()

    if _is_tensor_like(message):
        message = _format_tensor(message)

    if not isinstance(message, str):
        message = str(message)

    state = get_state()
    node_id = _current_node.get() or GLOBAL_LOGGABLE_ID
    timestamp = time.time()

    state.ensure_loggable(node_id)

    entry = {
        "type": "log",
        "loggable_id": node_id,
        "message": message,
        "step": step,
        "timestamp": timestamp,
    }

    state.loggables[node_id].logs.append(entry)

    state._send_to_client(entry)


def _scalar(v: Any) -> Any:
    if hasattr(v, "item"):
        return v.item()
    return v


def _normalize_metric_value(value: Any, mtype: str) -> Any:
    """Per-type normalization; tensors/ndarrays -> plain Python."""
    if hasattr(value, "tolist"):
        value = value.tolist()
    if mtype == "line":
        if isinstance(value, (int, float)):
            return float(value)
        raise TypeError(
            f"line metric requires scalar value, got {type(value).__name__}"
        )
    if mtype == "bar" or mtype == "pie":
        if isinstance(value, dict):
            return {str(k): _scalar(v) for k, v in value.items()}
        raise TypeError(
            f"{mtype} metric requires dict[str, number], got {type(value).__name__}"
        )
    if mtype == "scatter":
        if isinstance(value, dict) and "x" in value and "y" in value:
            xs = list(value["x"])
            ys = list(value["y"])
            if len(xs) != len(ys):
                raise ValueError(
                    f"scatter metric x and y must be the same length, "
                    f"got len(x)={len(xs)} and len(y)={len(ys)}"
                )
            return {"x": xs, "y": ys}
        if isinstance(value, list):
            xs = []
            ys = []
            for pair in value:
                x, y = pair
                xs.append(_scalar(x))
                ys.append(_scalar(y))
            return {"x": xs, "y": ys}
        raise TypeError("scatter metric requires dict{x,y} or list[(x,y)]")
    if mtype == "histogram":
        if isinstance(value, dict) and "bins" in value and "counts" in value:
            return {"bins": list(value["bins"]), "counts": list(value["counts"])}
        if isinstance(value, list):
            return [_scalar(v) for v in value]
        raise TypeError("histogram metric requires list[number] or {bins, counts}")
    raise ValueError(f"unknown metric type: {mtype!r}")


def log_metric(
    name: str,
    value: Any,
    *,
    type: str = "line",
    step: Optional[int] = None,
    tags: Optional[list[str]] = None,
) -> None:
    """Log a metric emission.

    The `type` kwarg selects the chart renderer and locks after first
    emission for `name` on a given loggable. `tags` attach to the
    emission and can be used to filter the series in the UI.

    Supported types:
      - "line"      : value is a scalar (int | float)
      - "bar"       : value is a dict {label: number}
      - "pie"       : value is a dict {label: number}
      - "scatter"   : value is either {"x": [...], "y": [...]} or list[(x, y)]
      - "histogram" : value is either list[number] (raw samples) or
                       {"bins": [...], "counts": [...]} (pre-binned)
    """
    _ensure_initialized()
    state = get_state()
    node_id = _current_node.get() or GLOBAL_LOGGABLE_ID
    timestamp = time.time()
    state.ensure_loggable(node_id)

    normalized = _normalize_metric_value(value, type)

    loggable = state.loggables[node_id]
    existing = loggable.metrics.get(name)
    if existing is not None and existing.get("type") != type:
        raise ValueError(
            f"metric {name!r} was emitted with type={existing['type']!r} "
            f"first; cannot change to type={type!r}"
        )

    if step is None and type == "line":
        step = len(existing["entries"]) if existing else 0

    if existing is None:
        loggable.metrics[name] = {"type": type, "entries": []}
    series = loggable.metrics[name]
    entry = {
        "step": step,
        "value": normalized,
        "tags": list(tags) if tags else [],
        "timestamp": timestamp,
    }
    series["entries"].append(entry)

    state._send_to_client({
        "type": "metric",
        "loggable_id": node_id,
        "name": name,
        "metric_type": type,
        "value": normalized,
        "step": step,
        "tags": entry["tags"],
        "timestamp": timestamp,
    })


def log_image(
    image: Any,
    *,
    name: Optional[str] = None,
    step: Optional[int] = None,
    points: Any = None,
    boxes: Any = None,
    circles: Any = None,
    polygons: Any = None,
    bitmask: Any = None,
) -> None:
    """Log an image, optionally with geometric labels overlaid.

    Labels accept either a single geometry or a list of geometries.
    See docs/reference.rst for each label's schema. Tensors / ndarrays
    are converted to plain Python lists. Bitmasks are PNG-encoded and
    travel inline as base64.
    """
    _ensure_initialized()
    from nebo.logging.serializers import serialize_image, _serialize_labels

    import base64

    state = get_state()
    node_id = _current_node.get() or GLOBAL_LOGGABLE_ID
    timestamp = time.time()

    state.ensure_loggable(node_id)

    image_bytes = serialize_image(image)
    labels = _serialize_labels(
        points=points, boxes=boxes, circles=circles,
        polygons=polygons, bitmask=bitmask,
    )

    entry: dict = {
        "type": "image",
        "loggable_id": node_id,
        "name": name,
        "data": base64.b64encode(image_bytes).decode("ascii"),
        "step": step,
        "timestamp": timestamp,
    }
    if labels:
        entry["labels"] = labels

    state.loggables[node_id].images.append(
        {"name": name, "step": step, "timestamp": timestamp,
         "labels": labels or None}
    )
    state._send_to_client(entry)


def log_audio(audio: Any, sr: int = 16000, *, name: Optional[str] = None, step: Optional[int] = None) -> None:
    """Log audio data.

    Args:
        name: The audio clip name.
        audio: Audio data as numpy array.
        sr: Sample rate.
    """
    _ensure_initialized()
    from nebo.logging.serializers import serialize_audio

    import base64

    state = get_state()
    node_id = _current_node.get() or GLOBAL_LOGGABLE_ID
    timestamp = time.time()

    state.ensure_loggable(node_id)

    audio_bytes = serialize_audio(audio, sr)

    entry = {
        "type": "audio",
        "loggable_id": node_id,
        "name": name,
        "data": base64.b64encode(audio_bytes).decode("ascii"),
        "sr": sr,
        "step": step,
        "timestamp": timestamp,
    }

    state.loggables[node_id].audio.append({"name": name, "step": step, "sr": sr, "timestamp": timestamp})

    state._send_to_client(entry)


def log_text(name: str, text: str) -> None:
    """Log rich text or markdown content.

    Args:
        name: The text name/label.
        text: The text/markdown content.
    """
    _ensure_initialized()
    state = get_state()
    node_id = _current_node.get() or GLOBAL_LOGGABLE_ID
    timestamp = time.time()

    state.ensure_loggable(node_id)

    entry = {
        "type": "text",
        "loggable_id": node_id,
        "name": name,
        "content": text,
        "timestamp": timestamp,
    }

    state.loggables[node_id].logs.append(entry)

    state._send_to_client(entry)


def md(description: str) -> None:
    """Set or append to the workflow-level description.

    This is distinct from node-level docstrings — it describes the overall workflow.

    Args:
        description: Markdown description of the workflow.
    """
    _ensure_initialized()
    state = get_state()
    if state.workflow_description is None:
        state.workflow_description = description
    else:
        state.workflow_description += "\n\n" + description
    state._send_to_client({
        "type": "description",
        "data": {"description": description},
    })
