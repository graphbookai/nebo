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


def _normalize_line(value: Any) -> float:
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(
            f"log_line requires a scalar number, got {type(value).__name__}"
        )
    return float(value)


def _normalize_categorical(value: Any, fname: str) -> dict:
    if hasattr(value, "tolist"):
        value = value.tolist()
    if not isinstance(value, dict):
        raise TypeError(
            f"{fname} requires dict[str, number], got {type(value).__name__}"
        )
    return {str(k): _scalar(v) for k, v in value.items()}


def _normalize_scatter(value: Any) -> dict:
    """Scatter accepts {label: list[(x, y)]}.

    Stored as {label: {"x": [...], "y": [...]}} so the UI can iterate
    labels without re-splitting tuples on every render.
    """
    if hasattr(value, "tolist"):
        value = value.tolist()
    if not isinstance(value, dict) or not value:
        raise TypeError(
            "log_scatter requires a non-empty dict {label: list[(x, y)]}, "
            f"got {type(value).__name__}"
        )
    out: dict[str, dict[str, list]] = {}
    for label, pairs in value.items():
        if hasattr(pairs, "tolist"):
            pairs = pairs.tolist()
        if not isinstance(pairs, list):
            raise TypeError(
                f"log_scatter label {label!r} must map to list[(x, y)], "
                f"got {type(pairs).__name__}"
            )
        xs: list = []
        ys: list = []
        for pair in pairs:
            try:
                x, y = pair
            except (TypeError, ValueError) as exc:
                raise TypeError(
                    f"log_scatter label {label!r} contains a non-(x, y) "
                    f"item: {pair!r}"
                ) from exc
            xs.append(_scalar(x))
            ys.append(_scalar(y))
        out[str(label)] = {"x": xs, "y": ys}
    return out


def _normalize_histogram(value: Any) -> Any:
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, dict) and "bins" in value and "counts" in value:
        return {"bins": list(value["bins"]), "counts": list(value["counts"])}
    if isinstance(value, list):
        return [_scalar(v) for v in value]
    raise TypeError(
        "log_histogram requires list[number] or {bins, counts}, "
        f"got {type(value).__name__}"
    )


def _emit_metric(
    name: str,
    normalized: Any,
    mtype: str,
    step: Optional[int],
    tags: Optional[list[str]],
) -> None:
    """Shared write path for the typed log_* functions.

    Maintains the per-`(loggable, name)` type lock and the auto-step
    behavior for line metrics.
    """
    _ensure_initialized()
    state = get_state()
    node_id = _current_node.get() or GLOBAL_LOGGABLE_ID
    timestamp = time.time()
    state.ensure_loggable(node_id)

    loggable = state.loggables[node_id]
    existing = loggable.metrics.get(name)
    if existing is not None and existing.get("type") != mtype:
        raise ValueError(
            f"metric {name!r} was emitted with type={existing['type']!r} "
            f"first; cannot change to type={mtype!r}"
        )

    if step is None and mtype == "line":
        step = len(existing["entries"]) if existing else 0

    if existing is None:
        loggable.metrics[name] = {"type": mtype, "entries": []}
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
        "metric_type": mtype,
        "value": normalized,
        "step": step,
        "tags": entry["tags"],
        "timestamp": timestamp,
    })


def log_line(
    name: str,
    value: Any,
    *,
    step: Optional[int] = None,
    tags: Optional[list[str]] = None,
) -> None:
    """Log a scalar line-chart datapoint.

    `step` auto-increments per `(loggable, name)` when omitted. `tags`
    attach to the emission for UI chip filtering.
    """
    _emit_metric(name, _normalize_line(value), "line", step, tags)


def log_bar(
    name: str,
    value: dict,
    *,
    step: Optional[int] = None,
    tags: Optional[list[str]] = None,
) -> None:
    """Log a bar-chart snapshot. `value` is a dict ``{label: number}``;
    each emission renders as one chart in the UI."""
    _emit_metric(name, _normalize_categorical(value, "log_bar"), "bar", step, tags)


def log_pie(
    name: str,
    value: dict,
    *,
    step: Optional[int] = None,
    tags: Optional[list[str]] = None,
) -> None:
    """Log a pie-chart snapshot. `value` is a dict ``{label: number}``;
    each emission renders as one chart in the UI."""
    _emit_metric(name, _normalize_categorical(value, "log_pie"), "pie", step, tags)


def log_scatter(
    name: str,
    value: dict,
    *,
    step: Optional[int] = None,
    tags: Optional[list[str]] = None,
) -> None:
    """Log a labeled scatter snapshot.

    `value` is a dict ``{label: list[(x, y)]}`` — every label becomes a
    separate series on the same chart, distinguishable by shape and
    toggleable via the UI chip row.
    """
    _emit_metric(name, _normalize_scatter(value), "scatter", step, tags)


def log_histogram(
    name: str,
    value: Any,
    *,
    step: Optional[int] = None,
    tags: Optional[list[str]] = None,
) -> None:
    """Log a histogram emission.

    `value` is either ``list[number]`` (raw samples; the UI bins them)
    or a pre-binned ``{"bins": [...], "counts": [...]}`` dict.
    """
    _emit_metric(name, _normalize_histogram(value), "histogram", step, tags)


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


def md(description: str) -> None:
    """Set or append to the workflow-level description.

    This is distinct from node-level docstrings — it describes the overall workflow.

    Args:
        description: Markdown description of the workflow.
    """
    _ensure_initialized()
    # Strip leading/trailing whitespace; otherwise an inline triple-quoted
    # block that begins on the next line drops its first line in the rendered
    # markdown.
    description = description.strip()
    state = get_state()
    if state.workflow_description is None:
        state.workflow_description = description
    else:
        state.workflow_description += "\n\n" + description
    state._send_to_client({
        "type": "description",
        "data": {"description": description},
    })
