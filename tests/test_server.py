"""Tests for the server protocol and state."""

from __future__ import annotations

import json
import pytest

from nebo.server.protocol import Message, MessageType, encode_batch, decode_batch


class TestProtocol:
    """Tests for the message protocol."""

    def test_message_to_json(self) -> None:
        """Message should serialize to JSON."""
        msg = Message(type=MessageType.LOG, data={"message": "hello"}, loggable_id="my_node")
        raw = msg.to_json()
        parsed = json.loads(raw)
        assert parsed["type"] == "log"
        assert parsed["data"]["message"] == "hello"
        assert parsed["loggable_id"] == "my_node"

    def test_message_from_json(self) -> None:
        """Message should deserialize from JSON."""
        raw = json.dumps({
            "type": "metric",
            "data": {"name": "loss", "value": 0.5},
            "timestamp": 1234567890.0,
            "loggable_id": "train",
        })
        msg = Message.from_json(raw)
        assert msg.type == MessageType.METRIC
        assert msg.data["value"] == 0.5
        assert msg.loggable_id == "train"

    def test_encode_decode_batch(self) -> None:
        """Batch encoding/decoding should round-trip."""
        events = [
            {"type": "log", "message": "hello"},
            {"type": "metric", "name": "loss", "value": 0.1},
        ]
        encoded = encode_batch(events)
        decoded = decode_batch(encoded)
        assert decoded == events

    def test_message_types_enum(self) -> None:
        """All expected message types should be defined."""
        assert MessageType.LOG.value == "log"
        assert MessageType.METRIC.value == "metric"
        assert MessageType.PROGRESS.value == "progress"
        assert MessageType.ERROR.value == "error"
        assert MessageType.ASK.value == "ask_prompt"


class TestDaemonIngest:
    """Tests for the daemon state event ingestion."""

    @pytest.mark.asyncio
    async def test_ingest_log_event(self) -> None:
        """Daemon state should ingest log events."""
        from nebo.server.daemon import DaemonState

        state = DaemonState()
        state.create_run("test.py", run_id="r1")
        await state.ingest_events([{
            "type": "loggable_register",
            "data": {"loggable_id": "my_node", "func_name": "my_func"},
        }], "r1")
        assert "my_node" in state.runs["r1"].loggables

        await state.ingest_events([{
            "type": "log",
            "loggable_id": "my_node",
            "message": "test log",
        }], "r1")
        assert len(state.runs["r1"].logs) == 1

    @pytest.mark.asyncio
    async def test_ingest_edge(self) -> None:
        """Daemon state should track edges."""
        from nebo.server.daemon import DaemonState

        state = DaemonState()
        state.create_run("test.py", run_id="r1")
        await state.ingest_events([
            {"type": "loggable_register", "data": {"loggable_id": "a", "func_name": "a"}},
            {"type": "loggable_register", "data": {"loggable_id": "b", "func_name": "b"}},
        ], "r1")
        await state.ingest_events([{
            "type": "edge",
            "data": {"source": "a", "target": "b"},
        }], "r1")
        assert len(state.runs["r1"].edges) == 1
        assert state.runs["r1"].loggables["b"].is_source is False

    @pytest.mark.asyncio
    async def test_ingest_error(self) -> None:
        """Daemon state should capture errors."""
        from nebo.server.daemon import DaemonState

        state = DaemonState()
        state.create_run("test.py", run_id="r1")
        await state.ingest_events([
            {"type": "loggable_register", "data": {"loggable_id": "err_node", "func_name": "err"}},
        ], "r1")
        await state.ingest_events([{
            "type": "error",
            "loggable_id": "err_node",
            "data": {"error": "something went wrong", "type": "RuntimeError"},
        }], "r1")
        assert len(state.runs["r1"].loggables["err_node"].errors) == 1


class TestStaticAssets:
    """Regression guards for the bundled static UI assets."""

    def test_index_html_title_is_nebo(self) -> None:
        """The built UI shipped inside the package must say 'Nebo', not 'Graphbook'."""
        import pathlib
        import nebo

        static_index = (
            pathlib.Path(nebo.__file__).parent
            / "server" / "static" / "index.html"
        )
        assert static_index.exists(), (
            f"Built UI index.html is missing at {static_index}. "
            "Run `cd ui && npm run build` and copy dist/* into nebo/server/static/."
        )
        html = static_index.read_text()
        assert "<title>Nebo</title>" in html, (
            "nebo/server/static/index.html does not contain <title>Nebo</title>. "
            "The UI bundle is stale; run `cd ui && npm run build` and copy the "
            "dist/ output into nebo/server/static/."
        )
        assert "Graphbook" not in html, (
            "nebo/server/static/index.html still contains the old 'Graphbook' "
            "branding. Rebuild the UI and recopy dist/* into nebo/server/static/."
        )

    def test_static_assets_have_no_graphbook_references(self) -> None:
        """No built asset in nebo/server/static should contain the old 'Graphbook' string."""
        import pathlib
        import nebo

        static_dir = pathlib.Path(nebo.__file__).parent / "server" / "static"
        offenders = []
        for path in static_dir.rglob("*"):
            if not path.is_file():
                continue
            try:
                text = path.read_text(errors="ignore")
            except Exception:
                continue
            if "Graphbook" in text:
                offenders.append(str(path.relative_to(static_dir)))
        assert not offenders, (
            "Stale UI bundle: the following static files still contain "
            "'Graphbook' and must be rebuilt: " + ", ".join(offenders)
        )
