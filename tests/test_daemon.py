"""Tests for the daemon server state management."""

from __future__ import annotations

import threading
import time

import pytest

from nebo.server.daemon import DaemonState, Run, LoggableState, LogEntry, ErrorEntry


class TestDaemonState:
    """Tests for DaemonState run management."""

    def setup_method(self) -> None:
        self.state = DaemonState()

    def test_create_run(self) -> None:
        """Should create a run with correct defaults."""
        run = self.state.create_run("test_script.py", args=["--epochs", "10"])
        assert run.script_path == "test_script.py"
        assert run.args == ["--epochs", "10"]
        assert run.status == "starting"
        assert run.started_at is not None
        assert self.state.active_run_id == run.id

    def test_create_run_custom_id(self) -> None:
        """Should accept a custom run ID."""
        run = self.state.create_run("s.py", run_id="my_run")
        assert run.id == "my_run"
        assert "my_run" in self.state.runs

    def test_get_active_run(self) -> None:
        """Should return the currently running run."""
        run = self.state.create_run("s.py")
        run.status = "running"
        assert self.state.get_active_run() is run

    def test_get_active_run_none_when_not_running(self) -> None:
        """Should return None if no run is in 'running' status."""
        run = self.state.create_run("s.py")
        run.status = "completed"
        assert self.state.get_active_run() is None

    def test_get_latest_run(self) -> None:
        """Should return the most recent run."""
        self.state.create_run("a.py", run_id="r1")
        self.state.create_run("b.py", run_id="r2")
        latest = self.state.get_latest_run()
        assert latest is not None
        assert latest.id == "r2"

    def test_mark_run_stopped(self) -> None:
        """Should mark a run as manually stopped."""
        run = self.state.create_run("s.py", run_id="r1")
        self.state.mark_run_stopped("r1")
        assert run.status == "stopped"

    def test_mark_run_stopped_clears_active_run_id(self) -> None:
        """A manually stopped run must also clear active_run_id."""
        self.state.create_run("s.py", run_id="r1")
        self.state.mark_run_stopped("r1")
        assert self.state.active_run_id is None


class TestDaemonEventIngestion:
    """Tests for event processing into run state."""

    def setup_method(self) -> None:
        self.state = DaemonState()

    @pytest.mark.asyncio
    async def test_ingest_loggable_register(self) -> None:
        """Should register nodes from events."""
        run = self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {"type": "loggable_register", "data": {"loggable_id": "my_func", "func_name": "my_func", "docstring": "Does stuff"}},
        ], "r1")
        assert "my_func" in run.loggables
        assert run.loggables["my_func"].docstring == "Does stuff"
        assert run.status == "running"  # auto-transitions from starting

    @pytest.mark.asyncio
    async def test_ingest_loggable_register_preserves_group(self) -> None:
        """loggable_register events carrying 'group' must land on LoggableState.group."""
        run = self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {
                "type": "loggable_register",
                "data": {
                    "loggable_id": "Agent.think",
                    "func_name": "think",
                    "docstring": None,
                    "group": "Agent",
                },
            },
        ], "r1")
        node = run.loggables["Agent.think"]
        assert node.group == "Agent"
        # And it must be exposed by the graph API payload the UI consumes.
        graph = run.get_graph()
        assert graph["nodes"]["Agent.think"]["group"] == "Agent"

    @pytest.mark.asyncio
    async def test_ingest_loggable_register_preserves_ui_hints(self) -> None:
        """loggable_register events carrying 'ui_hints' must reach the graph payload."""
        run = self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {
                "type": "loggable_register",
                "data": {
                    "loggable_id": "train",
                    "func_name": "train",
                    "ui_hints": {"collapsed": True, "color": "blue"},
                },
            },
        ], "r1")
        node = run.loggables["train"]
        assert node.ui_hints == {"collapsed": True, "color": "blue"}
        graph = run.get_graph()
        assert graph["nodes"]["train"]["ui_hints"] == {"collapsed": True, "color": "blue"}

    @pytest.mark.asyncio
    async def test_ingest_loggable_register_without_group_defaults_to_none(self) -> None:
        """A plain @nb.fn node without a group should still register, with group=None."""
        run = self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {
                "type": "loggable_register",
                "data": {"loggable_id": "plain", "func_name": "plain"},
            },
        ], "r1")
        node = run.loggables["plain"]
        assert node.group is None
        assert node.ui_hints is None
        graph = run.get_graph()
        assert graph["nodes"]["plain"]["group"] is None
        assert graph["nodes"]["plain"]["ui_hints"] is None

    @pytest.mark.asyncio
    async def test_ingest_log(self) -> None:
        """Should append log entries."""
        self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {"type": "loggable_register", "data": {"loggable_id": "n1", "func_name": "n1"}},
            {"type": "log", "loggable_id": "n1", "message": "hello world"},
        ], "r1")
        run = self.state.runs["r1"]
        assert len(run.logs) == 1
        assert run.logs[0].message == "hello world"

    @pytest.mark.asyncio
    async def test_ingest_edge(self) -> None:
        """Should track DAG edges and mark targets as non-source."""
        self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {"type": "loggable_register", "data": {"loggable_id": "a", "func_name": "a"}},
            {"type": "loggable_register", "data": {"loggable_id": "b", "func_name": "b"}},
            {"type": "edge", "data": {"source": "a", "target": "b"}},
        ], "r1")
        run = self.state.runs["r1"]
        assert len(run.edges) == 1
        assert run.loggables["a"].is_source is True
        assert run.loggables["b"].is_source is False

    @pytest.mark.asyncio
    async def test_ingest_error(self) -> None:
        """Should capture enriched errors."""
        self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {"type": "loggable_register", "data": {"loggable_id": "n1", "func_name": "n1", "docstring": "A step"}},
            {"type": "error", "loggable_id": "n1", "data": {
                "loggable_id": "n1", "type": "ValueError", "error": "bad value",
                "traceback": "Traceback...", "timestamp": 1234,
            }},
        ], "r1")
        run = self.state.runs["r1"]
        assert len(run.errors) == 1
        assert run.errors[0].exception_type == "ValueError"
        assert run.errors[0].node_docstring == "A step"

    @pytest.mark.asyncio
    async def test_ingest_metric(self) -> None:
        """Should store metrics on nodes."""
        self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {"type": "loggable_register", "data": {"loggable_id": "train", "func_name": "train"}},
            {"type": "metric", "loggable_id": "train", "name": "loss", "value": 0.5, "step": 0},
            {"type": "metric", "loggable_id": "train", "name": "loss", "value": 0.3, "step": 1},
        ], "r1")
        run = self.state.runs["r1"]
        assert "loss" in run.loggables["train"].metrics
        series = run.loggables["train"].metrics["loss"]
        assert series["type"] == "line"
        assert len(series["entries"]) == 2
        assert series["entries"][0]["value"] == 0.5
        assert series["entries"][1]["value"] == 0.3

    @pytest.mark.asyncio
    async def test_ingest_metric_with_type_and_tags(self) -> None:
        """metric events carrying metric_type + tags must land on the new typed series."""
        run = self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {"type": "loggable_register", "data": {"loggable_id": "n", "func_name": "n"}},
            {"type": "metric", "loggable_id": "n", "name": "loss",
             "metric_type": "line", "value": 0.5, "step": 0, "tags": ["warmup"]},
            {"type": "metric", "loggable_id": "n", "name": "counts",
             "metric_type": "bar", "value": {"a": 1, "b": 2}, "step": 0, "tags": []},
        ], "r1")
        loss = run.loggables["n"].metrics["loss"]
        assert loss["type"] == "line"
        assert loss["entries"][-1]["tags"] == ["warmup"]
        assert loss["entries"][-1]["value"] == 0.5
        counts = run.loggables["n"].metrics["counts"]
        assert counts["type"] == "bar"
        assert counts["entries"][-1]["value"] == {"a": 1, "b": 2}

    @pytest.mark.asyncio
    async def test_ingest_metric_scatter_accumulates(self) -> None:
        """Scatter is accumulating like line: repeated emissions append
        rather than overwrite."""
        run = self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {"type": "loggable_register", "data": {"loggable_id": "n", "func_name": "n"}},
            {"type": "metric", "loggable_id": "n", "name": "embed",
             "metric_type": "scatter",
             "value": {"dog": {"x": [0], "y": [8]}}, "step": 0, "tags": []},
            {"type": "metric", "loggable_id": "n", "name": "embed",
             "metric_type": "scatter",
             "value": {"cat": {"x": [1], "y": [4]}}, "step": 1, "tags": []},
        ], "r1")
        embed = run.loggables["n"].metrics["embed"]
        assert embed["type"] == "scatter"
        assert len(embed["entries"]) == 2
        assert embed["entries"][0]["step"] == 0
        assert embed["entries"][0]["value"] == {"dog": {"x": [0], "y": [8]}}
        assert embed["entries"][1]["step"] == 1
        assert embed["entries"][1]["value"] == {"cat": {"x": [1], "y": [4]}}

    @pytest.mark.asyncio
    async def test_ingest_metric_snapshots_overwrite(self) -> None:
        """Bar/pie/histogram remain snapshots: re-emitting overwrites the
        prior entry rather than appending."""
        run = self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {"type": "loggable_register", "data": {"loggable_id": "n", "func_name": "n"}},
            {"type": "metric", "loggable_id": "n", "name": "counts",
             "metric_type": "bar", "value": {"a": 1}, "step": None, "tags": []},
            {"type": "metric", "loggable_id": "n", "name": "counts",
             "metric_type": "bar", "value": {"a": 2, "b": 3}, "step": None, "tags": []},
        ], "r1")
        counts = run.loggables["n"].metrics["counts"]
        assert counts["type"] == "bar"
        assert len(counts["entries"]) == 1
        assert counts["entries"][0]["value"] == {"a": 2, "b": 3}

    @pytest.mark.asyncio
    async def test_ingest_creates_implicit_run(self) -> None:
        """Should create an implicit run if none exists."""
        await self.state.ingest_events([
            {"type": "log", "message": "orphan log"},
        ])
        assert len(self.state.runs) == 1

    @pytest.mark.asyncio
    async def test_ingest_ui_config_exposed_via_get_graph(self) -> None:
        """ui_config events must reach the graph payload the UI consumes."""
        run = self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {
                "type": "ui_config",
                "data": {
                    "layout": "horizontal",
                    "view": "grid",
                    "collapsed": True,
                    "minimap": False,
                    "theme": "dark",
                },
            },
        ], "r1")
        assert run.ui_config == {
            "layout": "horizontal",
            "view": "grid",
            "collapsed": True,
            "minimap": False,
            "theme": "dark",
        }
        graph = run.get_graph()
        assert graph["ui_config"] == {
            "layout": "horizontal",
            "view": "grid",
            "collapsed": True,
            "minimap": False,
            "theme": "dark",
        }

    @pytest.mark.asyncio
    async def test_get_graph_ui_config_defaults_to_none(self) -> None:
        """When no ui_config event is sent, get_graph() exposes None."""
        run = self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {"type": "loggable_register", "data": {"loggable_id": "n1", "func_name": "n1"}},
        ], "r1")
        graph = run.get_graph()
        assert graph["ui_config"] is None

    @pytest.mark.asyncio
    async def test_ingest_image_with_labels_preserves_labels(self) -> None:
        """Image events carrying labels must land on LoggableState.images entries."""
        run = self.state.create_run("s.py", run_id="r1")
        await self.state.ingest_events([
            {"type": "loggable_register", "data": {"loggable_id": "seg", "func_name": "seg"}},
            {
                "type": "image",
                "loggable_id": "seg",
                "name": "pred",
                "data": "AA==",
                "step": 0,
                "labels": {"boxes": [[1, 2, 3, 4]], "points": [[5, 6]]},
            },
        ], "r1")
        images = run.loggables["seg"].images
        assert len(images) == 1
        assert images[0]["labels"] == {"boxes": [[1, 2, 3, 4]], "points": [[5, 6]]}


class TestRunSummary:
    """Tests for Run serialization methods."""

    def test_get_summary(self) -> None:
        """Should return a concise summary dict."""
        run = Run(id="r1", script_path="train.py", args=["--lr", "0.01"])
        summary = run.get_summary()
        assert summary["id"] == "r1"
        assert summary["script_path"] == "train.py"
        assert summary["args"] == ["--lr", "0.01"]

    def test_get_graph(self) -> None:
        """Should return serializable graph dict."""
        run = Run(id="r1", script_path="s.py")
        run.loggables["a"] = LoggableState(loggable_id="a", func_name="a", docstring="Step A")
        run.edges.append({"source": "a", "target": "b"})
        graph = run.get_graph()
        assert "a" in graph["nodes"]
        assert graph["nodes"]["a"]["docstring"] == "Step A"
        assert len(graph["edges"]) == 1

    def test_get_graph_excludes_global_loggable(self) -> None:
        """Global-kind loggables must not appear under the graph's nodes key."""
        run = Run(id="r1", script_path="s.py")
        run.loggables["__global__"] = LoggableState(
            loggable_id="__global__", kind="global"
        )
        run.loggables["a"] = LoggableState(loggable_id="a", func_name="a")
        graph = run.get_graph()
        assert "__global__" not in graph["nodes"]
        assert "a" in graph["nodes"]

    def test_get_graph_filters_edges_touching_global(self) -> None:
        """An edge whose endpoint is a known global loggable is dropped."""
        run = Run(id="r1", script_path="s.py")
        run.loggables["__global__"] = LoggableState(
            loggable_id="__global__", kind="global"
        )
        run.loggables["a"] = LoggableState(loggable_id="a", func_name="a")
        run.loggables["b"] = LoggableState(loggable_id="b", func_name="b")
        run.edges.append({"source": "a", "target": "b"})
        run.edges.append({"source": "__global__", "target": "a"})
        run.edges.append({"source": "a", "target": "__global__"})
        graph = run.get_graph()
        assert graph["edges"] == [{"source": "a", "target": "b"}]

    @pytest.mark.asyncio
    async def test_run_start_seeds_global_loggable(self) -> None:
        """A run_start event must seed the __global__ loggable with kind=global."""
        state = DaemonState()
        run = state.create_run("s.py", run_id="r1")
        await state.ingest_events(
            [{"type": "run_start", "data": {"script_path": "s.py", "store": False}}],
            run_id="r1",
        )
        assert "__global__" in run.loggables
        assert run.loggables["__global__"].kind == "global"

    @pytest.mark.asyncio
    async def test_run_start_global_seed_is_idempotent(self) -> None:
        """Re-firing run_start must not overwrite an already-seeded global."""
        state = DaemonState()
        run = state.create_run("s.py", run_id="r1")
        await state.ingest_events(
            [{"type": "run_start", "data": {"script_path": "s.py", "store": False}}],
            run_id="r1",
        )
        run.loggables["__global__"].logs.append({"message": "marker"})
        await state.ingest_events(
            [{"type": "run_start", "data": {"script_path": "s.py", "store": False}}],
            run_id="r1",
        )
        assert any(
            entry.get("message") == "marker"
            for entry in run.loggables["__global__"].logs
        )


class TestGetNodeEndpoint:
    """HTTP-level tests for the GET /loggables/{loggable_id} endpoint.

    Regression: the global loggable endpoint historically omitted
    `metrics` and `progress` from its response, which broke the
    `nebo_get_metrics` MCP tool (it reads from this endpoint and always
    saw an empty metrics dict).
    """

    def _client_with_metric(self):
        from fastapi.testclient import TestClient
        from nebo.server.daemon import DaemonState, create_daemon_app

        state = DaemonState()
        run = state.create_run("s.py", run_id="r1")
        run.status = "running"
        import asyncio
        asyncio.get_event_loop().run_until_complete(
            state.ingest_events([
                {"type": "loggable_register", "data": {"loggable_id": "train", "func_name": "train"}},
                {"type": "metric", "loggable_id": "train", "name": "loss", "value": 0.5, "step": 0},
                {"type": "metric", "loggable_id": "train", "name": "loss", "value": 0.3, "step": 1},
                {"type": "progress", "loggable_id": "train", "data": {"current": 1, "total": 2, "name": "epoch"}},
            ], "r1")
        )
        app = create_daemon_app(state=state)
        return TestClient(app)

    def test_get_node_returns_metrics(self) -> None:
        """GET /loggables/{loggable_id} must include the loggable's metrics dict."""
        client = self._client_with_metric()
        resp = client.get("/loggables/train")
        assert resp.status_code == 200
        body = resp.json()
        assert "metrics" in body, f"missing 'metrics' field in response: {body}"
        assert "loss" in body["metrics"]
        series = body["metrics"]["loss"]
        assert series["type"] == "line"
        assert len(series["entries"]) == 2

    def test_get_node_returns_progress(self) -> None:
        """GET /loggables/{loggable_id} must include the loggable's progress state."""
        client = self._client_with_metric()
        resp = client.get("/loggables/train")
        assert resp.status_code == 200
        body = resp.json()
        assert "progress" in body, f"missing 'progress' field in response: {body}"

    def test_get_node_returns_kind_node(self) -> None:
        """GET /loggables/{loggable_id} must expose kind so the UI can distinguish nodes from the global."""
        client = self._client_with_metric()
        body = client.get("/loggables/train").json()
        assert body["kind"] == "node"

    def test_get_global_loggable_returns_kind_global(self) -> None:
        """The pre-seeded __global__ loggable must be fetchable with kind=global."""
        from fastapi.testclient import TestClient
        from nebo.server.daemon import DaemonState, create_daemon_app
        import asyncio

        state = DaemonState()
        state.create_run("s.py", run_id="r1")
        asyncio.get_event_loop().run_until_complete(
            state.ingest_events(
                [{"type": "run_start", "data": {"script_path": "s.py", "store": False}}], "r1"
            )
        )
        client = TestClient(create_daemon_app(state=state))
        resp = client.get("/runs/r1/loggables/__global__")
        assert resp.status_code == 200
        body = resp.json()
        assert body["kind"] == "global"
        assert body["loggable_id"] == "__global__"


class TestRunCompletedEventClearsActiveRun:
    """Regression test for Bug 10 via the `/events` ingest path.

    Pipelines finalize by POSTing a `run_completed` event to `/events`,
    which is handled inline in `ingest_events`. Previously that branch
    updated `run.status` but never cleared `self.active_run_id`, so
    `/health` and `nebo status` kept reporting a finished run as "active"
    indefinitely.
    """

    def test_run_completed_event_clears_active_run_id(self) -> None:
        from fastapi.testclient import TestClient
        from nebo.server.daemon import DaemonState, create_daemon_app

        state = DaemonState()
        state.create_run("s.py", run_id="bug10_repro")
        assert state.active_run_id == "bug10_repro"

        app = create_daemon_app(state=state)
        client = TestClient(app)

        resp = client.post(
            "/events?run_id=bug10_repro",
            json=[{"type": "run_completed", "data": {"run_id": "bug10_repro", "exit_code": 0}}],
        )
        assert resp.status_code == 200

        assert state.active_run_id is None, (
            f"active_run_id should be None after run_completed event, "
            f"got {state.active_run_id!r}"
        )
        assert state.runs["bug10_repro"].status == "completed"

    def test_run_completed_event_crashed_clears_active_run_id(self) -> None:
        """Non-zero exit_code via /events should also clear active_run_id."""
        from fastapi.testclient import TestClient
        from nebo.server.daemon import DaemonState, create_daemon_app

        state = DaemonState()
        state.create_run("s.py", run_id="bug10_crash")

        app = create_daemon_app(state=state)
        client = TestClient(app)

        resp = client.post(
            "/events?run_id=bug10_crash",
            json=[{"type": "run_completed", "data": {"run_id": "bug10_crash", "exit_code": 1}}],
        )
        assert resp.status_code == 200
        assert state.active_run_id is None
        assert state.runs["bug10_crash"].status == "crashed"

    def test_run_completed_event_preserves_other_active_run(self) -> None:
        """A run_completed event for a non-active run must not clear active_run_id."""
        from fastapi.testclient import TestClient
        from nebo.server.daemon import DaemonState, create_daemon_app

        state = DaemonState()
        state.create_run("a.py", run_id="r1")
        state.create_run("b.py", run_id="r2")
        assert state.active_run_id == "r2"

        app = create_daemon_app(state=state)
        client = TestClient(app)

        resp = client.post(
            "/events?run_id=r1",
            json=[{"type": "run_completed", "data": {"run_id": "r1", "exit_code": 0}}],
        )
        assert resp.status_code == 200
        assert state.active_run_id == "r2"


class TestApiTokenAuth:
    """Bearer-token auth for the daemon. With NEBO_API_TOKEN set, the
    NEBO_READ_MODE / NEBO_WRITE_MODE env vars decide which sides of
    the API require the token. /health and the static UI bundle stay
    open in every mode."""

    def _app(self, monkeypatch, *, token=None, read=None, write=None):
        from fastapi.testclient import TestClient
        from nebo.server.daemon import DaemonState, create_daemon_app

        if token is not None:
            monkeypatch.setenv("NEBO_API_TOKEN", token)
        else:
            monkeypatch.delenv("NEBO_API_TOKEN", raising=False)
        if read is not None:
            monkeypatch.setenv("NEBO_READ_MODE", read)
        else:
            monkeypatch.delenv("NEBO_READ_MODE", raising=False)
        if write is not None:
            monkeypatch.setenv("NEBO_WRITE_MODE", write)
        else:
            monkeypatch.delenv("NEBO_WRITE_MODE", raising=False)

        state = DaemonState()
        return TestClient(create_daemon_app(state=state)), state

    # ── /health stays open in every config ──

    def test_health_open_without_token(self, monkeypatch) -> None:
        client, _ = self._app(monkeypatch, token="s3cret")
        assert client.get("/health").status_code == 200

    # ── Default mode: read=public, write=private ──

    def test_default_read_public(self, monkeypatch) -> None:
        # GET passes without a token because the default is public read.
        client, _ = self._app(monkeypatch, token="s3cret")
        assert client.get("/runs").status_code == 200

    def test_default_write_private_rejects_without_token(self, monkeypatch) -> None:
        # POST without a token fails because the default is private write.
        client, _ = self._app(monkeypatch, token="s3cret")
        resp = client.post("/events", json=[{"type": "log", "message": "x"}])
        assert resp.status_code == 401

    def test_default_write_accepts_token_header(self, monkeypatch) -> None:
        client, _ = self._app(monkeypatch, token="s3cret")
        resp = client.post(
            "/events",
            json=[{"type": "log", "message": "x"}],
            headers={"X-Nebo-Token": "s3cret"},
        )
        assert resp.status_code == 200

    def test_default_write_accepts_token_query(self, monkeypatch) -> None:
        # Browser/iframe flows can't set custom headers so the daemon
        # also accepts the token via `?token=`.
        client, _ = self._app(monkeypatch, token="s3cret")
        resp = client.post(
            "/events?token=s3cret",
            json=[{"type": "log", "message": "x"}],
        )
        assert resp.status_code == 200

    # ── Explicit read=private (fully private dashboard) ──

    def test_read_private_rejects_get_without_token(self, monkeypatch) -> None:
        client, _ = self._app(monkeypatch, token="s3cret", read="private")
        assert client.get("/runs").status_code == 401

    def test_read_private_accepts_get_with_token(self, monkeypatch) -> None:
        client, _ = self._app(monkeypatch, token="s3cret", read="private")
        resp = client.get("/runs", headers={"X-Nebo-Token": "s3cret"})
        assert resp.status_code == 200

    # ── Explicit write=public (read-only dashboard mistakenly opens writes) ──

    def test_write_public_accepts_post_without_token(self, monkeypatch) -> None:
        client, _ = self._app(monkeypatch, token="s3cret", write="public")
        resp = client.post("/events", json=[{"type": "log", "message": "x"}])
        assert resp.status_code == 200

    # ── No token at all → both gates open (preserves local dev) ──

    def test_unset_token_leaves_routes_open(self, monkeypatch) -> None:
        client, _ = self._app(monkeypatch)
        assert client.get("/runs").status_code == 200
        resp = client.post("/events", json=[{"type": "log", "message": "x"}])
        assert resp.status_code == 200


class TestMetricsQueryFilters:
    """Tests for ?tag= and ?step= query-string filters on the per-loggable endpoint.

    These filters only apply to accumulating series (line/scatter) that carry
    tags and step fields; snapshot types (bar/pie/histogram) are unaffected
    because their entries don't carry meaningful tags/steps.
    """

    def _make_client(self, run_id: str, metrics: dict):
        """Set up a TestClient with a single run + loggable pre-populated."""
        from fastapi.testclient import TestClient
        from nebo.server.daemon import DaemonState, LoggableState, create_daemon_app

        state = DaemonState()
        run = state.create_run("test.py", run_id=run_id, store=False)
        run.status = "running"
        lg = LoggableState(loggable_id="node_a", kind="node")
        run.loggables["node_a"] = lg
        lg.metrics.update(metrics)
        app = create_daemon_app(state=state)
        return TestClient(app), state

    def test_metrics_filter_by_tag(self) -> None:
        """?tag=train must return only line entries whose tags list includes 'train'."""
        client, _ = self._make_client(
            run_id="r_filter_tag",
            metrics={
                "loss": {
                    "type": "line",
                    "entries": [
                        {"step": 0, "value": 1.0, "tags": ["train"], "timestamp": 0},
                        {"step": 1, "value": 0.5, "tags": ["val"], "timestamp": 1},
                        {"step": 2, "value": 0.4, "tags": ["train"], "timestamp": 2},
                    ],
                }
            },
        )
        resp = client.get("/runs/r_filter_tag/loggables/node_a?name=loss&tag=train")
        assert resp.status_code == 200
        entries = resp.json()["metrics"]["loss"]["entries"]
        assert [e["step"] for e in entries] == [0, 2]

    def test_metrics_filter_by_step(self) -> None:
        """?step=1 must return only entries whose step equals 1."""
        client, _ = self._make_client(
            run_id="r_filter_step",
            metrics={
                "loss": {
                    "type": "line",
                    "entries": [
                        {"step": 0, "value": 1.0, "tags": [], "timestamp": 0},
                        {"step": 1, "value": 0.5, "tags": [], "timestamp": 1},
                        {"step": 2, "value": 0.4, "tags": [], "timestamp": 2},
                    ],
                }
            },
        )
        resp = client.get("/runs/r_filter_step/loggables/node_a?name=loss&step=1")
        assert resp.status_code == 200
        entries = resp.json()["metrics"]["loss"]["entries"]
        assert [e["step"] for e in entries] == [1]

    def test_metrics_filter_by_name(self) -> None:
        """?name=loss must return only the 'loss' series, not 'acc'."""
        client, _ = self._make_client(
            run_id="r_filter_name",
            metrics={
                "loss": {
                    "type": "line",
                    "entries": [{"step": 0, "value": 1.0, "tags": [], "timestamp": 0}],
                },
                "acc": {
                    "type": "line",
                    "entries": [{"step": 0, "value": 0.9, "tags": [], "timestamp": 0}],
                },
            },
        )
        resp = client.get("/runs/r_filter_name/loggables/node_a?name=loss")
        assert resp.status_code == 200
        metrics = resp.json()["metrics"]
        assert "loss" in metrics
        assert "acc" not in metrics

    def test_metrics_filter_tag_and_step_compose(self) -> None:
        """?tag= and ?step= filters compose (both must match)."""
        client, _ = self._make_client(
            run_id="r_filter_both",
            metrics={
                "loss": {
                    "type": "line",
                    "entries": [
                        {"step": 1, "value": 0.9, "tags": ["train"], "timestamp": 0},
                        {"step": 1, "value": 0.8, "tags": ["val"], "timestamp": 1},
                        {"step": 2, "value": 0.7, "tags": ["train"], "timestamp": 2},
                    ],
                }
            },
        )
        resp = client.get("/runs/r_filter_both/loggables/node_a?name=loss&tag=train&step=1")
        assert resp.status_code == 200
        entries = resp.json()["metrics"]["loss"]["entries"]
        assert len(entries) == 1
        assert entries[0]["value"] == 0.9

    def test_metrics_no_filter_returns_all(self) -> None:
        """Without filters, all entries are returned (no regression)."""
        client, _ = self._make_client(
            run_id="r_no_filter",
            metrics={
                "loss": {
                    "type": "line",
                    "entries": [
                        {"step": 0, "value": 1.0, "tags": ["train"], "timestamp": 0},
                        {"step": 1, "value": 0.5, "tags": ["val"], "timestamp": 1},
                    ],
                }
            },
        )
        resp = client.get("/runs/r_no_filter/loggables/node_a")
        assert resp.status_code == 200
        entries = resp.json()["metrics"]["loss"]["entries"]
        assert len(entries) == 2


def test_alert_event_is_appended_to_run():
    """Alert events must be persisted on Run.alerts and added to significant_events."""
    from fastapi.testclient import TestClient
    from nebo.server.daemon import DaemonState, create_daemon_app

    state = DaemonState()
    state.create_run("test.py", run_id="r_alert_1", store=False)

    app = create_daemon_app(state=state)
    client = TestClient(app)

    resp = client.post(
        "/events?run_id=r_alert_1",
        json=[{
            "type": "alert",
            "loggable_id": "node_a",
            "data": {
                "title": "Loss went up",
                "text": "epoch 12",
                "level": 30,
                "level_name": "WARN",
                "timestamp": 1700000000.0,
            },
        }],
    )
    assert resp.status_code == 200
    run = state.runs["r_alert_1"]
    assert len(run.alerts) == 1
    assert run.alerts[0]["title"] == "Loss went up"
    assert run.alerts[0]["level"] == 30
    assert run.alerts[0]["level_name"] == "WARN"
    assert run.alerts[0]["loggable_id"] == "node_a"


def test_alerts_wait_returns_alert():
    """Wait endpoint should unblock and return alert when one arrives at or above min_level."""
    from fastapi.testclient import TestClient
    from nebo.server.daemon import DaemonState, create_daemon_app

    state = DaemonState()
    state.create_run("test.py", run_id="r_wait_1", store=False)

    app = create_daemon_app(state=state)
    client = TestClient(app)

    result: dict = {}

    def waiter():
        resp = client.get("/runs/r_wait_1/alerts/wait?timeout=5")
        result["body"] = resp.json()

    t = threading.Thread(target=waiter, daemon=True)
    t.start()
    time.sleep(0.2)
    client.post(
        "/events?run_id=r_wait_1",
        json=[{
            "type": "alert",
            "data": {"title": "x", "text": "y", "level": 20, "level_name": "INFO", "timestamp": 1.0},
        }],
    )
    t.join(timeout=5)
    assert result["body"]["status"] == "alert"
    assert result["body"]["alert"]["title"] == "x"


def test_alerts_wait_respects_min_level():
    """Wait endpoint should timeout when only alerts below min_level arrive."""
    from fastapi.testclient import TestClient
    from nebo.server.daemon import DaemonState, create_daemon_app

    state = DaemonState()
    state.create_run("test.py", run_id="r_wait_2", store=False)

    app = create_daemon_app(state=state)
    client = TestClient(app)

    result: dict = {}

    def waiter():
        resp = client.get("/runs/r_wait_2/alerts/wait?timeout=1&min_level=30")
        result["body"] = resp.json()

    t = threading.Thread(target=waiter, daemon=True)
    t.start()
    time.sleep(0.1)
    # Submit an alert BELOW the min level — should not wake the waiter.
    client.post(
        "/events?run_id=r_wait_2",
        json=[{
            "type": "alert",
            "data": {"title": "i", "text": "", "level": 20, "level_name": "INFO", "timestamp": 1.0},
        }],
    )
    t.join(timeout=5)
    assert result["body"]["status"] == "timeout"
