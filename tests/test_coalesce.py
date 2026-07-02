"""Tests for the transport-level metric coalescer (nebo/core/coalesce.py)."""

from __future__ import annotations

from nebo.core.coalesce import MAX_BATCH_POINTS, coalesce, expand_metric_batch


def _pt(name, value, step, *, mtype="line", tags=None, colors=None, lid="a"):
    e = {
        "type": "metric",
        "loggable_id": lid,
        "name": name,
        "metric_type": mtype,
        "value": value,
        "step": step,
        "tags": list(tags or []),
        "timestamp": 100.0 + step,
    }
    if colors is not None:
        e["colors"] = colors
    return e


class TestCoalesce:
    def test_interleaved_series_batch_separately(self):
        events = [
            _pt("loss", 0.5, 0), _pt("acc", 0.1, 0),
            _pt("loss", 0.4, 1), _pt("acc", 0.2, 1),
            _pt("loss", 0.3, 2),
        ]
        out = coalesce(events)
        assert [e["type"] for e in out] == ["metric_batch", "metric_batch"]
        loss, acc = out
        assert loss["name"] == "loss"
        assert loss["steps"] == [0, 1, 2]
        assert loss["values"] == [0.5, 0.4, 0.3]
        assert loss["timestamps"] == [100.0, 101.0, 102.0]
        assert acc["steps"] == [0, 1]
        assert acc["values"] == [0.1, 0.2]

    def test_singleton_passes_through_as_metric(self):
        events = [_pt("loss", 0.5, 0), _pt("acc", 0.1, 0), _pt("loss", 0.4, 1)]
        out = coalesce(events)
        assert [e["type"] for e in out] == ["metric_batch", "metric"]
        assert out[1]["name"] == "acc"
        assert out[1] == events[1]

    def test_non_metric_events_untouched_in_order(self):
        log1 = {"type": "log", "message": "a"}
        log2 = {"type": "log", "message": "b"}
        events = [log1, _pt("loss", 0.5, 0), log2, _pt("loss", 0.4, 1)]
        out = coalesce(events)
        # Batch lands at its first member's position; logs keep their order.
        assert [e["type"] for e in out] == ["log", "metric_batch", "log"]
        assert out[0] is log1
        assert out[2] is log2

    def test_tags_change_cuts_batch(self):
        events = [
            _pt("loss", 0.5, 0, tags=["train"]),
            _pt("loss", 0.4, 1, tags=["train"]),
            _pt("loss", 0.9, 2, tags=["val"]),
            _pt("loss", 0.8, 3, tags=["val"]),
        ]
        out = coalesce(events)
        assert [e["type"] for e in out] == ["metric_batch", "metric_batch"]
        assert out[0]["tags"] == ["train"]
        assert out[0]["steps"] == [0, 1]
        assert out[1]["tags"] == ["val"]
        assert out[1]["steps"] == [2, 3]

    def test_colors_change_cuts_batch(self):
        events = [
            _pt("pts", {"a": {"x": [1], "y": [1]}}, 0, mtype="scatter", colors=False),
            _pt("pts", {"a": {"x": [2], "y": [2]}}, 1, mtype="scatter", colors=False),
            _pt("pts", {"a": {"x": [3], "y": [3]}}, 2, mtype="scatter", colors=True),
            _pt("pts", {"a": {"x": [4], "y": [4]}}, 3, mtype="scatter", colors=True),
        ]
        out = coalesce(events)
        assert len(out) == 2
        assert out[0]["colors"] is False
        assert out[1]["colors"] is True

    def test_snapshot_types_never_batch(self):
        events = [
            _pt("dist", {"x": 1}, 0, mtype="bar"),
            _pt("dist", {"x": 2}, 1, mtype="bar"),
            _pt("h", {"a": [1, 2]}, 0, mtype="histogram"),
            _pt("h", {"a": [3]}, 1, mtype="histogram"),
            _pt("p", {"x": 1}, 0, mtype="pie"),
        ]
        out = coalesce(events)
        assert out == events

    def test_max_batch_points_split(self):
        events = [_pt("loss", float(i), i) for i in range(MAX_BATCH_POINTS + 3)]
        out = coalesce(events)
        assert [e["type"] for e in out] == ["metric_batch", "metric_batch"]
        assert len(out[0]["steps"]) == MAX_BATCH_POINTS
        assert len(out[1]["steps"]) == 3
        assert out[1]["steps"][0] == MAX_BATCH_POINTS

    def test_expand_roundtrip(self):
        events = [
            _pt("loss", 0.5, 0, tags=["t"]),
            _pt("loss", 0.4, 1, tags=["t"]),
            _pt("pts", {"a": {"x": [1], "y": [2]}}, 0, mtype="scatter", colors=True),
            _pt("pts", {"a": {"x": [3], "y": [4]}}, 1, mtype="scatter", colors=True),
        ]
        out = coalesce(events)
        expanded = []
        for e in out:
            expanded.extend(expand_metric_batch(e) if e["type"] == "metric_batch" else [e])
        assert expanded == events

    def test_different_loggables_batch_separately(self):
        events = [
            _pt("loss", 0.5, 0, lid="a"), _pt("loss", 0.1, 0, lid="b"),
            _pt("loss", 0.4, 1, lid="a"), _pt("loss", 0.2, 1, lid="b"),
        ]
        out = coalesce(events)
        assert len(out) == 2
        assert {e["loggable_id"] for e in out} == {"a", "b"}

    def test_empty_and_no_metrics(self):
        assert coalesce([]) == []
        logs = [{"type": "log", "message": "x"}]
        assert coalesce(logs) == logs
