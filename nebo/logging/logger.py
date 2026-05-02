"""Logging functions for nebo."""

from __future__ import annotations

import logging as _stdlib_logging
import time
from typing import Any, Optional, Union

from nebo.core.state import MetricCursor, _current_node, get_state


GLOBAL_LOGGABLE_ID = "__global__"

# Surface for nb.log() text messages. nb.init(terminal=False) attaches a
# stdout StreamHandler to this logger so users in "released terminal" mode
# see their logs; with the default terminal=True, no handler is attached and
# emissions here are silent (the Rich panel renders them instead).
_text_logger = _stdlib_logging.getLogger("nebo")


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

    # Mirror to the stdlib "nebo" logger. With terminal=False this surfaces
    # the message on stdout (init() attaches a StreamHandler in that mode);
    # with the default terminal=True no handler is attached and the call is
    # a no-op, leaving the Rich panel as the only renderer.
    if _text_logger.handlers:
        loggable = state.loggables.get(node_id)
        if node_id == GLOBAL_LOGGABLE_ID or loggable is None:
            _text_logger.info(message)
        else:
            func_name = getattr(loggable, "func_name", "") or node_id
            _text_logger.info("[%s] %s", func_name, message)


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


def _normalize_histogram(value: Any) -> dict:
    """Histogram accepts ``{label: list[number]}`` only.

    Each label is one distribution. The UI bins all labels against a
    shared range so overlapping histograms are directly comparable.
    For a single distribution, wrap the samples in a single-key dict
    (e.g. ``{"all": samples}``).
    """
    if hasattr(value, "tolist"):
        value = value.tolist()
    if not isinstance(value, dict) or not value:
        raise TypeError(
            "log_histogram requires a non-empty dict {label: list[number]}, "
            f"got {type(value).__name__}"
        )
    out: dict[str, list] = {}
    for label, samples in value.items():
        if hasattr(samples, "tolist"):
            samples = samples.tolist()
        if not isinstance(samples, list):
            raise TypeError(
                f"log_histogram label {label!r} must map to list[number], "
                f"got {type(samples).__name__}"
            )
        out[str(label)] = [_scalar(v) for v in samples]
    return out


def _emit_metric(
    name: str,
    normalized: Any,
    mtype: str,
    *,
    step: Optional[int] = None,
    tags: Optional[list[str]] = None,
    colors: Optional[bool] = None,
) -> None:
    """Shared write path for the typed log_* functions.

    Maintains the per-`(loggable, name)` type lock and the auto-step
    behavior for line metrics.

    ``step`` and ``tags`` only apply to line metrics — every other
    chart type is a snapshot that overwrites prior emissions
    daemon-side. ``colors`` is forwarded for scatter/histogram so the
    UI can choose between shape-only and color-coded label rendering.
    """
    _ensure_initialized()
    state = get_state()
    node_id = _current_node.get() or GLOBAL_LOGGABLE_ID
    timestamp = time.time()
    state.ensure_loggable(node_id)

    cursors = state._metric_cursors.setdefault(node_id, {})
    cur = cursors.get(name)
    if cur is None:
        cur = MetricCursor(type=mtype)
        cursors[name] = cur
    elif cur.type != mtype:
        raise ValueError(
            f"metric {name!r} was emitted with type={cur.type!r} "
            f"first; cannot change to type={mtype!r}"
        )

    if mtype == "line":
        if step is None:
            step = cur.next_step
        # The next auto-step always advances past the highest step seen,
        # so an explicit step=N followed by an auto-step jumps to N+1
        # rather than reverting to the cursor's previous count.
        cur.next_step = max(cur.next_step, step + 1)
    else:
        # Snapshot types ignore step/tags entirely — those concepts only
        # make sense for line metrics. Send `None` so old replay paths
        # don't accidentally honor stale values.
        step = None
        tags = None

    payload: dict[str, Any] = {
        "type": "metric",
        "loggable_id": node_id,
        "name": name,
        "metric_type": mtype,
        "value": normalized,
        "step": step,
        "tags": list(tags) if tags else [],
        "timestamp": timestamp,
    }
    if colors is not None:
        payload["colors"] = bool(colors)
    state._send_to_client(payload)


def log_line(
    name: str,
    value: Any,
    *,
    step: Optional[int] = None,
    tags: Optional[list[str]] = None,
) -> None:
    """Log a scalar line-chart datapoint.

    ``step`` auto-increments per ``(loggable, name)`` when omitted.
    ``tags`` attach to the emission for UI chip filtering. Line is the
    only chart type that accumulates over time; calling ``log_line``
    repeatedly with the same name appends to the series.
    """
    _emit_metric(name, _normalize_line(value), "line", step=step, tags=tags)


def log_bar(name: str, value: dict) -> None:
    """Log a bar-chart snapshot. ``value`` is a dict ``{label: number}``.

    Bar emissions are snapshots — calling ``log_bar`` again with the
    same name overwrites the prior value. There is no concept of step
    or tags for bar charts.
    """
    _emit_metric(name, _normalize_categorical(value, "log_bar"), "bar")


def log_pie(name: str, value: dict) -> None:
    """Log a pie-chart snapshot. ``value`` is a dict ``{label: number}``.

    Pie emissions are snapshots — calling ``log_pie`` again with the
    same name overwrites the prior value. There is no concept of step
    or tags for pie charts.
    """
    _emit_metric(name, _normalize_categorical(value, "log_pie"), "pie")


def log_scatter(name: str, value: dict, *, colors: bool = False) -> None:
    """Log a labeled scatter snapshot.

    ``value`` is a dict ``{label: list[(x, y)]}`` — every label
    becomes its own series on the same chart and is toggleable via
    the UI chip row. Scatter emissions are snapshots; calling
    ``log_scatter`` again with the same name overwrites the prior
    value.

    ``colors`` (default ``False``) controls how the UI distinguishes
    labels:

    * ``False`` — every label uses the run's color and is
      distinguished by shape only.
    * ``True`` — every label uses a distinct palette color (and a
      shape). This is **not recommended in comparison views**, where
      color is reserved for run identity; turning ``colors=True`` on
      while comparing two runs makes it ambiguous whether a
      differently-colored point belongs to a different run or a
      different label within the same run.
    """
    _emit_metric(name, _normalize_scatter(value), "scatter", colors=colors)


def log_histogram(name: str, value: dict, *, colors: bool = False) -> None:
    """Log a labeled histogram emission.

    ``value`` is a dict ``{label: list[number]}`` — every label is a
    distribution; the UI bins all labels against a shared range so
    overlaps line up. To log a single histogram, wrap the samples in
    a single-key dict, e.g. ``{"all": samples}``. Histogram emissions
    are snapshots; calling ``log_histogram`` again with the same name
    overwrites the prior value.

    ``colors`` (default ``False``) controls how the UI distinguishes
    labels:

    * ``False`` — every label area uses the run's color, so the
      overlap reads as a single mass.
    * ``True`` — every label area uses a distinct palette color, so
      individual distributions can be picked out. This is **not
      recommended in comparison views**, where color is reserved for
      run identity; turning ``colors=True`` on while comparing two
      runs makes it ambiguous whether a differently-colored area
      belongs to a different run or a different label within the
      same run.
    """
    _emit_metric(name, _normalize_histogram(value), "histogram", colors=colors)


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
