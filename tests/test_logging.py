"""Tests for the logging API.

After the v3 redesign, the SDK no longer mirrors metric values, image
metadata, or audio metadata in process — those flow straight to the
daemon. Tests that used to inspect ``state.loggables[*].metrics`` /
``.images`` / ``.audio`` now attach a ``CapturingClient`` (see
``tests/conftest.py``) and assert on the captured wire events. Tests
that read ``loggable.logs`` still work because the SDK keeps a
bounded ring of recent text logs for the terminal display.
"""

from __future__ import annotations

import pytest

from nebo.core.state import (
    MetricCursor,
    NodeInfo,
    SessionState,
    get_state,
)
from nebo.core.decorators import fn
from nebo.logging.logger import (
    log,
    log_bar,
    log_histogram,
    log_line,
    log_pie,
    log_scatter,
    md,
)
from nebo.core.config import log_cfg


def _node_by_func_name(name: str) -> NodeInfo:
    return next(
        l for l in get_state().loggables.values()
        if isinstance(l, NodeInfo) and l.func_name == name
    )


class TestLogging:
    """Tests for nb.log() and the typed log_* helpers."""

    def setup_method(self) -> None:
        SessionState.reset_singleton()

    def test_log_inside_step(self) -> None:
        """log() inside a step should attach to that node's recent_logs ring."""
        @fn()
        def my_step():
            log("hello world")

        my_step()
        node = _node_by_func_name("my_step")
        assert len(node.logs) == 1
        assert list(node.logs)[0]["message"] == "hello world"

    def test_log_line_inside_step_emits_wire_events(self, capturing_client) -> None:
        """log_line() should send one metric event per call and lock the cursor type."""
        @fn()
        def train():
            log_line("loss", 0.5, step=0)
            log_line("loss", 0.3, step=1)
            log_line("loss", 0.1, step=2)

        train()
        events = capturing_client.metrics_named("loss")
        assert [e["step"] for e in events] == [0, 1, 2]
        assert [e["value"] for e in events] == [0.5, 0.3, 0.1]
        assert all(e["metric_type"] == "line" for e in events)
        # The cursor's locked type is the only metric metadata still
        # held on the SDK side.
        node = _node_by_func_name("train")
        cursor = get_state()._metric_cursors[node.loggable_id]["loss"]
        assert isinstance(cursor, MetricCursor)
        assert cursor.type == "line"

    def test_md_sets_workflow_description(self) -> None:
        md("This is a test workflow")
        assert get_state().workflow_description == "This is a test workflow"

    def test_md_appends(self) -> None:
        md("Part 1")
        md("Part 2")
        wd = get_state().workflow_description
        assert wd is not None and "Part 1" in wd and "Part 2" in wd


class TestLogNumpy:
    """Tests for log() with numpy arrays — read off the recent_logs deque."""

    def setup_method(self) -> None:
        SessionState.reset_singleton()

    def test_log_numpy_array(self) -> None:
        try:
            import numpy as np
        except ImportError:
            pytest.skip("numpy not installed")

        @fn()
        def check_array():
            arr = np.zeros((3, 224, 224), dtype=np.float32)
            log(arr)

        check_array()
        node = _node_by_func_name("check_array")
        msg = list(node.logs)[0]["message"]
        assert "ndarray" in msg
        assert "(3, 224, 224)" in msg
        assert "float32" in msg
        assert "min:" in msg and "max:" in msg and "mean:" in msg

    def test_log_numpy_preserves_string(self) -> None:
        @fn()
        def my_step():
            log("plain text message")

        my_step()
        node = _node_by_func_name("my_step")
        assert list(node.logs)[0]["message"] == "plain text message"


class TestLogCfg:
    """Tests for nb.log_cfg() — config still lives on the node."""

    def setup_method(self) -> None:
        SessionState.reset_singleton()

    def test_log_cfg_stores_params(self) -> None:
        @fn()
        def train():
            log_cfg({"lr": 0.001, "batch_size": 32})

        train()
        node = _node_by_func_name("train")
        assert node.params["lr"] == 0.001
        assert node.params["batch_size"] == 32

    def test_log_cfg_merges(self) -> None:
        @fn()
        def train():
            log_cfg({"lr": 0.001})
            log_cfg({"batch_size": 32})

        train()
        node = _node_by_func_name("train")
        assert node.params["lr"] == 0.001
        assert node.params["batch_size"] == 32

    def test_log_cfg_later_call_overwrites(self) -> None:
        @fn()
        def train():
            log_cfg({"lr": 0.001, "epochs": 10})
            log_cfg({"lr": 0.01})

        train()
        node = _node_by_func_name("train")
        assert node.params["lr"] == 0.01
        assert node.params["epochs"] == 10

    def test_log_cfg_filters_non_serializable(self) -> None:
        @fn()
        def train():
            log_cfg({"lr": 0.001, "callback": lambda x: x})

        train()
        node = _node_by_func_name("train")
        assert "lr" in node.params
        assert "callback" not in node.params


class TestImageSerializer:
    """Tests for image serialization via nb.log_image."""

    def setup_method(self) -> None:
        SessionState.reset_singleton()

    def test_serialize_numpy_array_uint8_hwc(self) -> None:
        import numpy as np
        from nebo.logging.serializers import serialize_image

        arr = np.zeros((10, 10, 3), dtype=np.uint8)
        png = serialize_image(arr)
        assert isinstance(png, bytes)
        assert png[:8] == b"\x89PNG\r\n\x1a\n"

    def test_serialize_numpy_grayscale(self) -> None:
        import numpy as np
        from nebo.logging.serializers import serialize_image

        arr = np.zeros((8, 8), dtype=np.uint8)
        png = serialize_image(arr)
        assert png[:8] == b"\x89PNG\r\n\x1a\n"

    def test_serialize_pil_image(self) -> None:
        from PIL import Image
        from nebo.logging.serializers import serialize_image

        img = Image.new("RGB", (4, 4), color=(10, 20, 30))
        png = serialize_image(img)
        assert png[:8] == b"\x89PNG\r\n\x1a\n"

    def test_serialize_unsupported_type_raises_typeerror(self) -> None:
        from nebo.logging.serializers import serialize_image

        with pytest.raises(TypeError, match="Cannot serialize"):
            serialize_image("not an image")

    def test_log_image_emits_wire_event(self, capturing_client) -> None:
        """nb.log_image() now sends straight to the daemon — assert on the wire event."""
        import numpy as np
        from nebo.logging.logger import log_image

        @fn()
        def f():
            log_image(np.zeros((10, 10, 3), dtype=np.uint8), name="x")

        f()
        images = capturing_client.by_type("image")
        assert len(images) == 1
        assert images[0]["name"] == "x"
        # The SDK no longer keeps an ``images`` list.
        node = _node_by_func_name("f")
        assert not hasattr(node, "images")


def test_log_outside_fn_routes_to_global():
    import nebo as nb
    nb.get_state().reset()
    nb.log("hello from top-level")
    g = nb.get_state().loggables["__global__"]
    assert len(g.logs) == 1
    entry = list(g.logs)[0]
    assert entry["message"] == "hello from top-level"
    assert entry["loggable_id"] == "__global__"


def test_log_line_outside_fn_routes_to_global(capturing_client):
    import nebo as nb
    nb.log_line("top_lvl_metric", 3.14)
    events = capturing_client.metrics_named("top_lvl_metric")
    assert len(events) == 1
    assert events[0]["loggable_id"] == "__global__"
    assert events[0]["value"] == 3.14
    cursor = nb.get_state()._metric_cursors["__global__"]["top_lvl_metric"]
    assert cursor.type == "line"


def test_log_inside_fn_still_routes_to_node():
    import nebo as nb
    nb.get_state().reset()

    @nb.fn()
    def inner():
        nb.log("from inner")
        return 1

    inner()
    state = nb.get_state()
    assert "__global__" in state.loggables
    assert len(state.loggables["__global__"].logs) == 0
    inner_loggable = next(
        lg for lg in state.loggables.values()
        if getattr(lg, "func_name", None) == "inner"
    )
    assert len(inner_loggable.logs) == 1


def test_log_image_accepts_labels_and_emits_them(capturing_client):
    import numpy as np
    from PIL import Image
    import nebo as nb

    img = Image.fromarray(np.zeros((8, 8, 3), dtype=np.uint8))
    nb.log_image(
        img,
        name="edges",
        points=[[45, 80]],
        boxes=[[10, 10, 50, 50], [60, 60, 70, 70]],
        circles=[30, 30, 5],
        polygons=[[[0, 0], [1, 0], [1, 1]]],
    )

    image_events = capturing_client.by_type("image")
    assert len(image_events) == 1
    labels = image_events[0]["labels"]
    assert labels["points"] == [[45, 80]]
    assert labels["boxes"] == [[10, 10, 50, 50], [60, 60, 70, 70]]
    assert labels["circles"] == [[30, 30, 5]]
    assert labels["polygons"] == [[[0, 0], [1, 0], [1, 1]]]
    assert "bitmask" not in labels


def test_log_image_bitmask_stored_as_media_reference(capturing_client):
    import numpy as np
    from PIL import Image
    import nebo as nb

    img = Image.fromarray(np.zeros((8, 8, 3), dtype=np.uint8))
    mask = np.zeros((8, 8), dtype=np.uint8)
    mask[2:5, 2:5] = 1
    nb.log_image(img, name="seg", bitmask=mask)

    image_events = capturing_client.by_type("image")
    assert len(image_events) == 1
    labels = image_events[0]["labels"]
    assert "bitmask" in labels
    assert len(labels["bitmask"]) == 1
    entry = labels["bitmask"][0]
    assert entry["width"] == 8
    assert entry["height"] == 8
    assert "data" in entry  # inline base64


def test_log_line_emits_scalar_event(capturing_client):
    import nebo as nb
    nb.log_line("loss", 0.5)
    events = capturing_client.metrics_named("loss")
    assert events[-1]["metric_type"] == "line"
    assert events[-1]["value"] == 0.5


def test_log_bar_emits_dict_value(capturing_client):
    import nebo as nb
    nb.log_bar("class_counts", {"cat": 3, "dog": 5, "bird": 2})
    events = capturing_client.metrics_named("class_counts")
    assert events[-1]["metric_type"] == "bar"
    assert events[-1]["value"] == {"cat": 3, "dog": 5, "bird": 2}


def test_log_pie_emits_dict_value(capturing_client):
    import nebo as nb
    nb.log_pie("budget", {"prompt": 800, "completion": 200})
    events = capturing_client.metrics_named("budget")
    assert events[-1]["metric_type"] == "pie"
    assert events[-1]["value"] == {"prompt": 800, "completion": 200}


def test_log_line_tags_attached_to_emission(capturing_client):
    import nebo as nb
    nb.log_line("loss", 0.1, tags=["schedule:warmup"])
    nb.log_line("loss", 0.05, tags=["schedule:main"])
    events = capturing_client.metrics_named("loss")
    assert events[0]["tags"] == ["schedule:warmup"]
    assert events[1]["tags"] == ["schedule:main"]


def test_metric_type_locks_after_first_emission(capturing_client):
    import nebo as nb
    nb.log_line("m", 1.0)
    with pytest.raises(ValueError, match="type"):
        nb.log_bar("m", {"a": 1})


def test_log_histogram_emits_raw_samples(capturing_client):
    import nebo as nb
    import numpy as np
    samples = np.random.default_rng(0).normal(size=100).tolist()
    nb.log_histogram("latencies", samples)
    events = capturing_client.metrics_named("latencies")
    assert events[-1]["metric_type"] == "histogram"
    assert isinstance(events[-1]["value"], list)
    assert len(events[-1]["value"]) == 100


def test_log_scatter_emits_labeled_points(capturing_client):
    """{label: list[(x, y)]} → {label: {"x": [...], "y": [...]}} on the wire."""
    import nebo as nb
    nb.log_scatter(
        "embed",
        {
            "cluster_a": [(1, 2), (3, 4)],
            "cluster_b": [(5, 6), (7, 8), (9, 10)],
        },
    )
    events = capturing_client.metrics_named("embed")
    assert events[-1]["metric_type"] == "scatter"
    assert events[-1]["value"] == {
        "cluster_a": {"x": [1, 3], "y": [2, 4]},
        "cluster_b": {"x": [5, 7, 9], "y": [6, 8, 10]},
    }


def test_log_scatter_rejects_legacy_xy_dict():
    """Legacy {"x": [...], "y": [...]} format is no longer accepted."""
    import nebo as nb
    nb.get_state().reset()
    with pytest.raises(TypeError):
        nb.log_scatter("embed", {"x": [1, 2, 3], "y": [4, 5, 6]})


def test_log_scatter_rejects_flat_pair_list():
    import nebo as nb
    nb.get_state().reset()
    with pytest.raises(TypeError):
        nb.log_scatter("embed", [(1, 2), (3, 4)])


def test_log_line_auto_step_uses_cursor(capturing_client):
    """Without an explicit step, log_line takes the cursor's next_step
    counter — even though the SDK no longer keeps the entries list."""
    import nebo as nb
    for _ in range(5):
        nb.log_line("x", 1.0)
    steps = [e["step"] for e in capturing_client.metrics_named("x")]
    assert steps == [0, 1, 2, 3, 4]
    assert nb.get_state()._metric_cursors["__global__"]["x"].next_step == 5


def test_log_line_auto_step_advances_past_explicit_step(capturing_client):
    """An explicit step=N pushes the auto-step counter to N+1 so the
    next implicit emission can't collide with what the user just sent."""
    import nebo as nb
    nb.log_line("x", 1.0, step=10)
    nb.log_line("x", 2.0)
    steps = [e["step"] for e in capturing_client.metrics_named("x")]
    assert steps == [10, 11]


def test_high_volume_emissions_dont_grow_sdk_state(capturing_client):
    """The whole point of the v3 SDK redesign: 1k metric/log/image
    emissions must not grow loggable.metrics/.images/.audio (which
    were dropped) and the recent-logs ring stays bounded."""
    import nebo as nb
    import numpy as np

    @nb.fn()
    def emit():
        for i in range(1000):
            nb.log_line("v", float(i))
            nb.log(f"step {i}")
            nb.log_image(np.zeros((4, 4, 3), dtype=np.uint8), name="img")

    emit()
    node = _node_by_func_name("emit")
    # No metrics/images/audio mirrors at all.
    assert not hasattr(node, "metrics")
    assert not hasattr(node, "images")
    assert not hasattr(node, "audio")
    # Logs are bounded; the deque's maxlen is the cap regardless of N.
    from nebo.core.state import RECENT_LOGS_MAXLEN
    assert len(node.logs) == RECENT_LOGS_MAXLEN
    # The wire received every event.
    assert len(capturing_client.metrics_named("v")) == 1000
    assert len(capturing_client.by_type("image")) == 1000
    # Type-lock cursor still tracks the metric we emitted.
    assert get_state()._metric_cursors[node.loggable_id]["v"].next_step == 1000
