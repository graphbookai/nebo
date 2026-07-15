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


# ─── Heartbeat (last_event) rules ────────────────────────────────────────────


def _heartbeat_rule(
    rule_id: str = "hb1",
    run_id: str | None = None,
    value: float = 60.0,
    op: str = ">",
    created_at: float = 0.0,
    level: int = 20,
) -> dict:
    """Hand-built rule dict (bypasses POST /alerts so created_at is exact)."""
    return {
        "id": rule_id,
        "title": "run done",
        "text": "",
        "level": level,
        "triggered_by": "cli",
        "condition": {
            "metric": "last_event", "op": op, "value": value,
            "loggable_id": None,
        },
        "run_id": run_id,
        "created_at": created_at,
        "fired": [],
    }


class TestHeartbeatValidation:
    def test_accepts_gt_and_ge(self) -> None:
        for op in (">", ">="):
            assert validate_alert_condition(
                {"metric": "last_event", "op": op, "value": 60}
            ) is None

    def test_rejects_instant_or_never_ops(self) -> None:
        for op in ("<", "<=", "==", "!="):
            assert validate_alert_condition(
                {"metric": "last_event", "op": op, "value": 60}
            ) is not None

    def test_rejects_negative_value(self) -> None:
        assert validate_alert_condition(
            {"metric": "last_event", "op": ">", "value": -1}
        ) is not None

    def test_rejects_loggable_scope(self) -> None:
        assert validate_alert_condition(
            {"metric": "last_event", "op": ">", "value": 60,
             "loggable_id": "train"}
        ) is not None

    def test_endpoint_rejects_bad_heartbeat(self) -> None:
        _, client = _make_client()
        resp = client.post("/alerts", json={
            "title": "t",
            "condition": {"metric": "last_event", "op": "<", "value": 60},
        })
        assert resp.status_code == 422


class TestHeartbeatRules:
    """evaluate_heartbeat_rules unit tests — injected `now`, no sleeps."""

    def test_run_scoped_fires_when_idle(self) -> None:
        state, _ = _make_client()
        state.create_run("s.py", run_id="r1")
        state.runs["r1"].last_event_at = 1000.0
        state.alert_rules["hb1"] = _heartbeat_rule(run_id="r1", value=60.0)

        assert state.evaluate_heartbeat_rules(now=1061.0) is True
        (alert,) = state.runs["r1"].alerts
        assert alert["triggered_by"] == "cli"
        assert alert["condition"] == "last_event > 60"
        assert alert["value"] == 61.0
        assert alert["loggable_id"] is None
        assert state.runs["r1"].significant_events[-1]["type"] == "alert"

    def test_not_fired_while_active(self) -> None:
        state, _ = _make_client()
        state.create_run("s.py", run_id="r1")
        state.runs["r1"].last_event_at = 1000.0
        state.alert_rules["hb1"] = _heartbeat_rule(run_id="r1", value=60.0)

        assert state.evaluate_heartbeat_rules(now=1059.0) is False
        assert state.runs["r1"].alerts == []

    def test_fires_once_per_run(self) -> None:
        state, _ = _make_client()
        state.create_run("s.py", run_id="r1")
        state.runs["r1"].last_event_at = 1000.0
        state.alert_rules["hb1"] = _heartbeat_rule(run_id="r1", value=60.0)

        assert state.evaluate_heartbeat_rules(now=1061.0) is True
        assert state.evaluate_heartbeat_rules(now=1100.0) is False
        assert len(state.runs["r1"].alerts) == 1
        assert len(state.alert_rules["hb1"]["fired"]) == 1

    def test_run_scoped_fires_for_already_idle_run(self) -> None:
        """A run quiet since before the rule existed fires on the first
        tick — waiting on an already-finished run returns immediately."""
        state, _ = _make_client()
        state.create_run("s.py", run_id="r1")
        state.runs["r1"].last_event_at = 1000.0
        state.alert_rules["hb1"] = _heartbeat_rule(
            run_id="r1", value=60.0, created_at=5000.0,
        )

        assert state.evaluate_heartbeat_rules(now=5001.0) is True

    def test_global_rule_skips_stale_runs(self) -> None:
        state, _ = _make_client()
        state.create_run("s.py", run_id="stale")
        state.create_run("s.py", run_id="live")
        state.runs["stale"].last_event_at = 1000.0   # before created_at
        state.runs["live"].last_event_at = 5010.0    # after created_at
        state.alert_rules["hb1"] = _heartbeat_rule(
            value=60.0, created_at=5000.0,
        )

        assert state.evaluate_heartbeat_rules(now=5100.0) is True
        assert state.runs["stale"].alerts == []
        assert len(state.runs["live"].alerts) == 1

    def test_metric_named_last_event_does_not_trigger(self) -> None:
        """The reserved name cuts both ways: a real metric called
        last_event never fires the rule, and the heartbeat still does."""
        state, client = _make_client()
        state.create_run("s.py", run_id="r1")
        state.alert_rules["hb1"] = _heartbeat_rule(run_id="r1", value=60.0)

        client.post("/events?run_id=r1", json=[_metric_event("last_event", 999)])
        assert state.runs["r1"].alerts == []

        state.runs["r1"].last_event_at = 1000.0
        assert state.evaluate_heartbeat_rules(now=1061.0) is True

    def test_run_scoped_fires_for_evicted_run(self, tmp_path) -> None:
        """A RAM-evicted run resolves recency from the cache — long-idle
        is exactly the evicted regime."""
        from nebo.server.cache import RunCache

        cache = RunCache(tmp_path / "cache.db", logdir=tmp_path / "logs")
        cache.start()
        try:
            state = DaemonState(cache=cache)
            app = create_daemon_app(state=state)
            client = TestClient(app)

            state.create_run("s.py", run_id="r1")
            state._cache_put(("run_upsert", "r1", {"last_event_at": 1000.0}))
            assert cache.flush()
            del state.runs["r1"]  # simulate eviction

            # POST targets the evicted run — pins has_run_anywhere.
            resp = client.post("/alerts", json={
                "title": "run done", "run_id": "r1",
                "condition": {"metric": "last_event", "op": ">", "value": 60},
            })
            assert resp.status_code == 200

            assert state.evaluate_heartbeat_rules(now=1061.0) is True
            assert cache.flush()
            alerts = state.run_alerts("r1")
            assert alerts and alerts[0]["title"] == "run done"
        finally:
            cache.close()

    def test_metric_rule_alert_reaches_cache(self, tmp_path) -> None:
        """Rule-fired alerts persist to SQL like code-fired ones."""
        from nebo.server.cache import RunCache

        cache = RunCache(tmp_path / "cache.db", logdir=tmp_path / "logs")
        cache.start()
        try:
            state = DaemonState(cache=cache)
            app = create_daemon_app(state=state)
            client = TestClient(app)
            state.create_run("s.py", run_id="r1")
            client.post("/alerts", json={
                "title": "threshold hit",
                "condition": {"metric": "m", "op": ">", "value": 5},
            })
            client.post("/events?run_id=r1", json=[_metric_event("m", 6)])
            assert cache.flush()
            cached = cache.get_alerts("r1")
            assert cached and cached[0]["title"] == "threshold hit"
        finally:
            cache.close()

    def test_heartbeat_wakes_alert_waiter(self, monkeypatch) -> None:
        """End-to-end: the always-on loop fires the rule and notifies the
        waiter itself (no ingest happens — the run is quiet)."""
        import time as _time

        import nebo.server.daemon as daemon_mod

        monkeypatch.setattr(daemon_mod, "HEARTBEAT_TICK_S", 0.02)
        state = DaemonState()
        app = create_daemon_app(state=state)
        # Context manager: runs the lifespan, which starts the loop.
        with TestClient(app) as client:
            state.create_run("s.py", run_id="r1")
            state.runs["r1"].last_event_at = _time.time() - 10.0
            resp = client.post("/alerts", json={
                "title": "run done", "run_id": "r1",
                "condition": {"metric": "last_event", "op": ">", "value": 5},
            })
            assert resp.status_code == 200

            body = client.get("/runs/r1/alerts/wait?timeout=2").json()
            assert body["status"] == "alert"
            assert body["alert"]["condition"] == "last_event > 5"
