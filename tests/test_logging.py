"""Tests for the logging API."""

from __future__ import annotations

import pytest

from nebo.core.state import NodeInfo, SessionState, get_state, _current_node
from nebo.core.decorators import fn
from nebo.logging.logger import log, log_metric, log_text, md
from nebo.core.config import log_cfg


class TestLogging:
    """Tests for nb.log(), nb.log_metric(), etc."""

    def setup_method(self) -> None:
        SessionState.reset_singleton()

    def test_log_inside_step(self) -> None:
        """log() inside a step should attach to that node."""
        @fn()
        def my_step():
            log("hello world")

        my_step()
        state = get_state()
        node = next(l for l in state.loggables.values() if isinstance(l, NodeInfo) and l.func_name == "my_step")
        assert len(node.logs) == 1
        assert node.logs[0]["message"] == "hello world"

    def test_log_metric_inside_step(self) -> None:
        """log_metric() should store metrics on the node."""
        @fn()
        def train():
            log_metric("loss", 0.5, step=0)
            log_metric("loss", 0.3, step=1)
            log_metric("loss", 0.1, step=2)

        train()
        state = get_state()
        node = next(l for l in state.loggables.values() if isinstance(l, NodeInfo) and l.func_name == "train")
        assert "loss" in node.metrics
        series = node.metrics["loss"]
        assert series["type"] == "line"
        assert len(series["entries"]) == 3
        assert series["entries"][0]["step"] == 0
        assert series["entries"][0]["value"] == 0.5
        assert series["entries"][2]["step"] == 2
        assert series["entries"][2]["value"] == 0.1

    def test_log_text(self) -> None:
        """log_text() should store text entries."""
        @fn()
        def report():
            log_text("summary", "## Results\nAll good!")

        report()
        state = get_state()
        node = next(l for l in state.loggables.values() if isinstance(l, NodeInfo) and l.func_name == "report")
        assert len(node.logs) == 1
        assert node.logs[0]["content"] == "## Results\nAll good!"

    def test_md_sets_workflow_description(self) -> None:
        """md() should set the workflow-level description."""
        md("This is a test workflow")
        state = get_state()
        assert state.workflow_description == "This is a test workflow"

    def test_md_appends(self) -> None:
        """Multiple md() calls should append descriptions."""
        md("Part 1")
        md("Part 2")
        state = get_state()
        assert state.workflow_description is not None
        assert "Part 1" in state.workflow_description
        assert "Part 2" in state.workflow_description


class TestLogNumpy:
    """Tests for log() with numpy arrays."""

    def setup_method(self) -> None:
        SessionState.reset_singleton()

    def test_log_numpy_array(self) -> None:
        """log() should format numpy arrays with shape, dtype, and stats."""
        try:
            import numpy as np
        except ImportError:
            pytest.skip("numpy not installed")

        @fn()
        def check_array():
            arr = np.zeros((3, 224, 224), dtype=np.float32)
            log(arr)

        check_array()
        state = get_state()
        node = next(l for l in state.loggables.values() if isinstance(l, NodeInfo) and l.func_name == "check_array")
        assert len(node.logs) == 1
        msg = node.logs[0]["message"]
        assert "ndarray" in msg
        assert "(3, 224, 224)" in msg
        assert "float32" in msg
        assert "min:" in msg
        assert "max:" in msg
        assert "mean:" in msg

    def test_log_numpy_preserves_string(self) -> None:
        """log() with a plain string should still work as before."""
        @fn()
        def my_step():
            log("plain text message")

        my_step()
        state = get_state()
        node = next(l for l in state.loggables.values() if isinstance(l, NodeInfo) and l.func_name == "my_step")
        assert node.logs[0]["message"] == "plain text message"


class TestLogCfg:
    """Tests for nb.log_cfg()."""

    def setup_method(self) -> None:
        SessionState.reset_singleton()

    def test_log_cfg_stores_params(self) -> None:
        """log_cfg() should store config in node params."""
        @fn()
        def train():
            log_cfg({"lr": 0.001, "batch_size": 32})

        train()
        state = get_state()
        node = next(l for l in state.loggables.values() if isinstance(l, NodeInfo) and l.func_name == "train")
        assert node.params["lr"] == 0.001
        assert node.params["batch_size"] == 32

    def test_log_cfg_merges(self) -> None:
        """Multiple log_cfg() calls should merge into one dict."""
        @fn()
        def train():
            log_cfg({"lr": 0.001})
            log_cfg({"batch_size": 32})

        train()
        state = get_state()
        node = next(l for l in state.loggables.values() if isinstance(l, NodeInfo) and l.func_name == "train")
        assert node.params["lr"] == 0.001
        assert node.params["batch_size"] == 32

    def test_log_cfg_later_call_overwrites(self) -> None:
        """Later log_cfg() calls should overwrite conflicting keys."""
        @fn()
        def train():
            log_cfg({"lr": 0.001, "epochs": 10})
            log_cfg({"lr": 0.01})

        train()
        state = get_state()
        node = next(l for l in state.loggables.values() if isinstance(l, NodeInfo) and l.func_name == "train")
        assert node.params["lr"] == 0.01
        assert node.params["epochs"] == 10

    def test_log_cfg_filters_non_serializable(self) -> None:
        """log_cfg() should only keep JSON-serializable values."""
        @fn()
        def train():
            log_cfg({"lr": 0.001, "callback": lambda x: x})

        train()
        state = get_state()
        node = next(l for l in state.loggables.values() if isinstance(l, NodeInfo) and l.func_name == "train")
        assert "lr" in node.params
        assert "callback" not in node.params


class TestImageSerializer:
    """Tests for image serialization via nb.log_image."""

    def setup_method(self) -> None:
        SessionState.reset_singleton()

    def test_serialize_numpy_array_uint8_hwc(self) -> None:
        """serialize_image should accept a (H, W, 3) uint8 numpy array and return PNG bytes."""
        import numpy as np
        from nebo.logging.serializers import serialize_image

        arr = np.zeros((10, 10, 3), dtype=np.uint8)
        png = serialize_image(arr)
        assert isinstance(png, bytes)
        assert png[:8] == b"\x89PNG\r\n\x1a\n"

    def test_serialize_numpy_grayscale(self) -> None:
        """serialize_image should accept a (H, W) grayscale numpy array."""
        import numpy as np
        from nebo.logging.serializers import serialize_image

        arr = np.zeros((8, 8), dtype=np.uint8)
        png = serialize_image(arr)
        assert png[:8] == b"\x89PNG\r\n\x1a\n"

    def test_serialize_pil_image(self) -> None:
        """serialize_image should accept a PIL.Image directly."""
        from PIL import Image
        from nebo.logging.serializers import serialize_image

        img = Image.new("RGB", (4, 4), color=(10, 20, 30))
        png = serialize_image(img)
        assert png[:8] == b"\x89PNG\r\n\x1a\n"

    def test_serialize_unsupported_type_raises_typeerror(self) -> None:
        """serialize_image should raise TypeError for unsupported types, not ImportError."""
        from nebo.logging.serializers import serialize_image

        with pytest.raises(TypeError, match="Cannot serialize"):
            serialize_image("not an image")

    def test_log_image_numpy_end_to_end(self) -> None:
        """nb.log_image(numpy_array) should attach an image to the current node."""
        import numpy as np
        from nebo.logging.logger import log_image

        @fn()
        def f():
            log_image(np.zeros((10, 10, 3), dtype=np.uint8), name="x")

        f()
        state = get_state()
        node = next(l for l in state.loggables.values() if isinstance(l, NodeInfo) and l.func_name == "f")
        assert len(node.images) == 1
        assert node.images[0]["name"] == "x"


def test_log_outside_fn_routes_to_global():
    import nebo as nb
    nb.get_state().reset()  # state already seeds "__global__"
    nb.log("hello from top-level")
    g = nb.get_state().loggables["__global__"]
    assert len(g.logs) == 1
    assert g.logs[0]["message"] == "hello from top-level"
    assert g.logs[0]["loggable_id"] == "__global__"


def test_log_metric_outside_fn_routes_to_global():
    import nebo as nb
    nb.get_state().reset()
    nb.log_metric("top_lvl_metric", 3.14)
    g = nb.get_state().loggables["__global__"]
    assert "top_lvl_metric" in g.metrics
    assert g.metrics["top_lvl_metric"]["entries"][-1]["value"] == 3.14


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
    assert state.loggables["__global__"].logs == []
    # node_id uses __qualname__, which for a function defined inside a
    # pytest test function is "<test_fn>.<locals>.inner"; look it up by
    # func_name instead of by a hard-coded key.
    inner_loggable = next(
        lg for lg in state.loggables.values()
        if getattr(lg, "func_name", None) == "inner"
    )
    assert len(inner_loggable.logs) == 1


def test_log_image_accepts_labels_and_emits_them():
    import numpy as np
    from PIL import Image
    import nebo as nb

    nb.get_state().reset()
    captured: list[dict] = []

    class FakeClient:
        def send_event(self, event): captured.append(event)

    nb.get_state()._client = FakeClient()

    img = Image.fromarray(np.zeros((8, 8, 3), dtype=np.uint8))
    nb.log_image(
        img,
        name="edges",
        points=[[45, 80]],
        boxes=[[10, 10, 50, 50], [60, 60, 70, 70]],
        circles=[30, 30, 5],
        polygons=[[[0, 0], [1, 0], [1, 1]]],
    )

    image_events = [e for e in captured if e["type"] == "image"]
    assert len(image_events) == 1
    labels = image_events[0]["labels"]
    assert labels["points"] == [[45, 80]]
    assert labels["boxes"] == [[10, 10, 50, 50], [60, 60, 70, 70]]
    assert labels["circles"] == [[30, 30, 5]]
    assert labels["polygons"] == [[[0, 0], [1, 0], [1, 1]]]
    assert "bitmask" not in labels


def test_log_image_bitmask_stored_as_media_reference():
    import numpy as np
    from PIL import Image
    import nebo as nb

    nb.get_state().reset()
    captured: list[dict] = []

    class FakeClient:
        def send_event(self, event): captured.append(event)

    nb.get_state()._client = FakeClient()

    img = Image.fromarray(np.zeros((8, 8, 3), dtype=np.uint8))
    mask = np.zeros((8, 8), dtype=np.uint8)
    mask[2:5, 2:5] = 1
    nb.log_image(img, name="seg", bitmask=mask)

    image_events = [e for e in captured if e["type"] == "image"]
    assert len(image_events) == 1
    labels = image_events[0]["labels"]
    assert "bitmask" in labels
    assert len(labels["bitmask"]) == 1
    entry = labels["bitmask"][0]
    assert entry["width"] == 8
    assert entry["height"] == 8
    assert "data" in entry  # inline base64


def test_log_metric_default_type_is_line():
    import nebo as nb
    nb.get_state().reset()
    nb.log_metric("loss", 0.5)
    series = nb.get_state().loggables["__global__"].metrics["loss"]
    assert series["type"] == "line"
    assert series["entries"][-1]["value"] == 0.5


def test_log_metric_bar_type_accepts_dict_value():
    import nebo as nb
    nb.get_state().reset()
    nb.log_metric("class_counts", {"cat": 3, "dog": 5, "bird": 2}, type="bar")
    series = nb.get_state().loggables["__global__"].metrics["class_counts"]
    assert series["type"] == "bar"
    assert series["entries"][-1]["value"] == {"cat": 3, "dog": 5, "bird": 2}


def test_log_metric_tags_attached_to_emission():
    import nebo as nb
    nb.get_state().reset()
    nb.log_metric("loss", 0.1, tags=["schedule:warmup"])
    nb.log_metric("loss", 0.05, tags=["schedule:main"])
    series = nb.get_state().loggables["__global__"].metrics["loss"]
    assert series["entries"][0]["tags"] == ["schedule:warmup"]
    assert series["entries"][1]["tags"] == ["schedule:main"]


def test_log_metric_type_locks_after_first_emission():
    import nebo as nb
    import pytest
    nb.get_state().reset()
    nb.log_metric("m", 1.0)  # default type=line
    with pytest.raises(ValueError, match="type"):
        nb.log_metric("m", {"a": 1}, type="bar")


def test_log_metric_histogram_accepts_raw_samples():
    import nebo as nb
    import numpy as np
    nb.get_state().reset()
    samples = np.random.default_rng(0).normal(size=100).tolist()
    nb.log_metric("latencies", samples, type="histogram")
    series = nb.get_state().loggables["__global__"].metrics["latencies"]
    assert series["type"] == "histogram"
    assert isinstance(series["entries"][-1]["value"], list)
    assert len(series["entries"][-1]["value"]) == 100


def test_log_metric_scatter_accepts_list_of_pairs():
    import nebo as nb
    nb.get_state().reset()
    points = [(1, 2), (3, 4), (5, 6)]
    nb.log_metric("embed", points, type="scatter")
    series = nb.get_state().loggables["__global__"].metrics["embed"]
    assert series["type"] == "scatter"
    entry_value = series["entries"][-1]["value"]
    assert entry_value == {"x": [1, 3, 5], "y": [2, 4, 6]}
