"""Tests for condition-based alert rules (created via CLI/MCP, no code changes).

Rules live on DaemonState and are evaluated as metric events arrive.
A rule that matches appends a fired alert to `run.alerts`, which the
existing `/runs/{id}/alerts/wait` endpoint already scans — so
`wait_for_alert` integration comes for free.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from nebo.server.daemon import (
    DaemonState,
    create_daemon_app,
    validate_alert_condition,
)


def _make_client() -> tuple[DaemonState, TestClient]:
    state = DaemonState()
    app = create_daemon_app(state=state)
    return state, TestClient(app)


def _metric_event(name: str, value, loggable_id: str = "__global__", step: int | None = None) -> dict:
    return {
        "type": "metric",
        "loggable_id": loggable_id,
        "name": name,
        "metric_type": "line",
        "value": value,
        "step": step,
        "tags": [],
    }


class TestConditionValidation:
    def test_valid_condition(self) -> None:
        assert validate_alert_condition(
            {"metric": "train/loss", "op": ">", "value": 5.0}
        ) is None

    def test_missing_metric(self) -> None:
        assert validate_alert_condition({"op": ">", "value": 1}) is not None

    def test_bad_op(self) -> None:
        assert validate_alert_condition(
            {"metric": "m", "op": "~", "value": 1}
        ) is not None

    def test_non_numeric_value(self) -> None:
        assert validate_alert_condition(
            {"metric": "m", "op": ">", "value": "high"}
        ) is not None

    def test_bool_value_rejected(self) -> None:
        assert validate_alert_condition(
            {"metric": "m", "op": ">", "value": True}
        ) is not None


class TestAlertRuleEndpoints:
    def test_create_and_list_rule(self) -> None:
        state, client = _make_client()
        resp = client.post("/alerts", json={
            "title": "loss diverged",
            "text": "investigate",
            "level": 30,
            "condition": {"metric": "train/loss", "op": ">", "value": 5},
        })
        assert resp.status_code == 200
        rule = resp.json()
        assert rule["id"]
        assert rule["triggered_by"] == "cli"
        assert rule["condition"]["metric"] == "train/loss"
        assert rule["fired"] == []

        listed = client.get("/alerts").json()["alerts"]
        assert any(a.get("id") == rule["id"] for a in listed)

    def test_get_and_delete_rule(self) -> None:
        state, client = _make_client()
        rule_id = client.post("/alerts", json={
            "title": "t",
            "condition": {"metric": "m", "op": "<", "value": 0.1},
        }).json()["id"]

        assert client.get(f"/alerts/{rule_id}").status_code == 200
        assert client.delete(f"/alerts/{rule_id}").status_code == 200
        assert client.get(f"/alerts/{rule_id}").status_code == 404
        assert rule_id not in state.alert_rules

    def test_create_requires_title(self) -> None:
        _, client = _make_client()
        resp = client.post("/alerts", json={
            "condition": {"metric": "m", "op": ">", "value": 1},
        })
        assert resp.status_code == 422

    def test_create_rejects_bad_condition(self) -> None:
        _, client = _make_client()
        resp = client.post("/alerts", json={
            "title": "t",
            "condition": {"metric": "m", "op": "between", "value": 1},
        })
        assert resp.status_code == 422

    def test_list_includes_code_alerts(self) -> None:
        """nb.alert() events (triggered_by=code) appear in the unified list."""
        state, client = _make_client()
        state.create_run("s.py", run_id="r1")
        client.post("/events?run_id=r1", json=[{
            "type": "alert",
            "data": {"title": "manual", "text": "", "level": 20,
                     "level_name": "INFO", "triggered_by": "code"},
        }])
        listed = client.get("/alerts").json()["alerts"]
        code_alerts = [a for a in listed if a.get("triggered_by") == "code"]
        assert len(code_alerts) == 1
        assert code_alerts[0]["title"] == "manual"
        assert code_alerts[0]["run_id"] == "r1"


class TestAlertRuleFiring:
    def test_rule_fires_on_matching_metric(self) -> None:
        state, client = _make_client()
        state.create_run("s.py", run_id="r1")
        client.post("/alerts", json={
            "title": "loss diverged",
            "level": 30,
            "condition": {"metric": "train/loss", "op": ">", "value": 5},
        })

        client.post("/events?run_id=r1", json=[_metric_event("train/loss", 6.2, step=3)])

        alerts = state.runs["r1"].alerts
        assert len(alerts) == 1
        fired = alerts[0]
        assert fired["title"] == "loss diverged"
        assert fired["triggered_by"] == "cli"
        assert fired["level"] == 30
        assert fired["value"] == 6.2
        assert fired["step"] == 3
        assert fired["condition"] == "train/loss > 5"

    def test_rule_does_not_fire_below_threshold(self) -> None:
        state, client = _make_client()
        state.create_run("s.py", run_id="r1")
        client.post("/alerts", json={
            "title": "t",
            "condition": {"metric": "train/loss", "op": ">", "value": 5},
        })
        client.post("/events?run_id=r1", json=[_metric_event("train/loss", 4.9)])
        assert state.runs["r1"].alerts == []

    def test_rule_fires_once_per_run(self) -> None:
        state, client = _make_client()
        state.create_run("s.py", run_id="r1")
        client.post("/alerts", json={
            "title": "t",
            "condition": {"metric": "train/loss", "op": ">", "value": 5},
        })
        client.post("/events?run_id=r1", json=[
            _metric_event("train/loss", 6, step=1),
            _metric_event("train/loss", 7, step=2),
        ])
        assert len(state.runs["r1"].alerts) == 1

        # ...but a different run fires independently.
        state.create_run("s.py", run_id="r2")
        client.post("/events?run_id=r2", json=[_metric_event("train/loss", 8)])
        assert len(state.runs["r2"].alerts) == 1

    def test_rule_scoped_to_run(self) -> None:
        state, client = _make_client()
        state.create_run("s.py", run_id="r1")
        state.create_run("s.py", run_id="r2")
        client.post("/alerts", json={
            "title": "t",
            "run_id": "r2",
            "condition": {"metric": "m", "op": ">=", "value": 1},
        })
        client.post("/events?run_id=r1", json=[_metric_event("m", 2)])
        client.post("/events?run_id=r2", json=[_metric_event("m", 2)])
        assert state.runs["r1"].alerts == []
        assert len(state.runs["r2"].alerts) == 1

    def test_rule_scoped_to_loggable(self) -> None:
        state, client = _make_client()
        state.create_run("s.py", run_id="r1")
        client.post("/alerts", json={
            "title": "t",
            "condition": {"metric": "m", "op": ">", "value": 0,
                          "loggable_id": "__agent__"},
        })
        client.post("/events?run_id=r1", json=[_metric_event("m", 1, loggable_id="__global__")])
        assert state.runs["r1"].alerts == []
        client.post("/events?run_id=r1", json=[_metric_event("m", 1, loggable_id="__agent__")])
        assert len(state.runs["r1"].alerts) == 1

    def test_non_numeric_values_skipped(self) -> None:
        """Snapshot metrics carry dict values — rules must not crash or fire."""
        state, client = _make_client()
        state.create_run("s.py", run_id="r1")
        client.post("/alerts", json={
            "title": "t",
            "condition": {"metric": "dist", "op": ">", "value": 1},
        })
        client.post("/events?run_id=r1", json=[{
            "type": "metric", "loggable_id": "__global__", "name": "dist",
            "metric_type": "bar", "value": {"a": 5}, "step": None, "tags": [],
        }])
        assert state.runs["r1"].alerts == []

    def test_fired_recorded_on_rule(self) -> None:
        state, client = _make_client()
        state.create_run("s.py", run_id="r1")
        rule_id = client.post("/alerts", json={
            "title": "t",
            "condition": {"metric": "m", "op": "==", "value": 1},
        }).json()["id"]
        client.post("/events?run_id=r1", json=[_metric_event("m", 1)])
        rule = client.get(f"/alerts/{rule_id}").json()
        assert len(rule["fired"]) == 1
        assert rule["fired"][0]["run_id"] == "r1"

    def test_fired_rule_wakes_alert_waiter(self) -> None:
        """Cli-fired alerts satisfy the existing /alerts/wait endpoint."""
        state, client = _make_client()
        state.create_run("s.py", run_id="r1")
        client.post("/alerts", json={
            "title": "threshold hit",
            "level": 30,
            "condition": {"metric": "m", "op": ">", "value": 5},
        })
        client.post("/events?run_id=r1", json=[_metric_event("m", 6)])

        resp = client.get("/runs/r1/alerts/wait?timeout=0.1&min_level=30")
        body = resp.json()
        assert body["status"] == "alert"
        assert body["alert"]["title"] == "threshold hit"
        assert body["alert"]["triggered_by"] == "cli"


class TestConditionParsing:
    """CLI-side condition-string parsing lives in nebo.client."""

    def test_parse_simple(self) -> None:
        from nebo.client import parse_condition
        assert parse_condition("train/loss > 5") == {
            "metric": "train/loss", "op": ">", "value": 5.0,
        }

    def test_parse_ops_and_floats(self) -> None:
        from nebo.client import parse_condition
        assert parse_condition("acc>=0.95")["op"] == ">="
        assert parse_condition("acc >= 0.95")["value"] == 0.95
        assert parse_condition("delta != -1.5")["value"] == -1.5

    def test_parse_invalid_raises(self) -> None:
        from nebo.client import parse_condition
        with pytest.raises(ValueError):
            parse_condition("train/loss soars")
        with pytest.raises(ValueError):
            parse_condition("> 5")
