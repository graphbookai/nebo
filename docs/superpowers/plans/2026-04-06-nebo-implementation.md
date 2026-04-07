# Nebo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the graphbook beta codebase into nebo — an AI-native observability SDK with persistent `.nebo` log files, class decoration, UI configuration from code, agent tracing, and Q&A via Claude Code.

**Architecture:** Daemon-centric. The daemon holds state in memory, optionally writes `.nebo` files in real-time, and can reload them. The SDK communicates via HTTP/WebSocket. Q&A delegates to Claude Code CLI subprocess spawned by the daemon. The React UI connects via WebSocket and renders DAG/grid views with a right-side panel for trace + chat.

**Tech Stack:** Python 3.10+, FastAPI, MessagePack, React 19, TypeScript, Zustand, @xyflow/react, Tailwind CSS, shadcn-ui

**Spec:** `docs/superpowers/specs/2026-04-06-nebo-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `nebo/core/fileformat.py` | `.nebo` file writer and reader (MessagePack binary format) |
| `nebo/server/chat.py` | Q&A backend — spawns Claude Code CLI, streams responses |
| `tests/test_fileformat.py` | File format round-trip tests |
| `tests/test_storage.py` | Daemon storage integration tests |
| `tests/test_class_decoration.py` | Class decoration + group tests |
| `tests/test_ui_config.py` | `nb.ui()` and per-node UI hint tests |
| `tests/test_chat.py` | Q&A subprocess tests |
| `ui/src/components/layout/RightPanel.tsx` | Right-side tabbed container (Trace + Chat) |
| `ui/src/components/trace/TraceTab.tsx` | Linear chronological event timeline |
| `ui/src/components/chat/ChatTab.tsx` | Chat box UI for Q&A |
| `ui/src/components/graph/GroupNode.tsx` | Transparent bounding box for class groups |

### Modified Files (Key Changes)
| File | Changes |
|------|---------|
| `pyproject.toml` | Entry point `nb`, add `msgpack` dep, fix build paths |
| `nebo/__init__.py` | Rename imports, add `ui()`, add `store` param to `init()`, export `ui` |
| `nebo/core/decorators.py` | Class detection, method wrapping, lazy materialization, `ui` param |
| `nebo/core/state.py` | `group` + `materialized` fields on `NodeInfo`, `ensure_node()`, `_decorated_meta` |
| `nebo/logging/logger.py` | Call `ensure_node()` in each log function |
| `nebo/server/daemon.py` | `.nebo/` directory, writer integration, `POST /load`, `POST /chat`, `ui_config` events |
| `nebo/server/protocol.py` | Add `UI_CONFIG` message type |
| `nebo/mcp/server.py` | Rename tools `graphbook_*` → `nebo_*`, add `nebo_load_file`, `nebo_chat` |
| `nebo/mcp/tools.py` | Add `load_file()` and `chat()` tool implementations |
| `nebo/cli.py` | Rename to `nb`, add `load` command, rename env vars |
| `ui/src/store/index.ts` | Group nodes, UI config state, chat state, trace state |
| `ui/src/components/graph/DagGraph.tsx` | Group/compound node rendering |
| `ui/src/App.tsx` | Add right panel to layout |
| All `nebo/**/*.py` | `graphbook.beta` → `nebo` imports |
| All `tests/*.py` | `graphbook.beta` → `nebo` imports |
| All `examples/*.py` | `import graphbook.beta as gb` → `import nebo as nb` |

---

## Task 1: Namespace Rename

Rename all `graphbook.beta` references to `nebo` across the entire codebase. This is a mechanical task that must be done first since all subsequent work builds on the new namespace.

**Files:** All `.py` files in `nebo/`, `tests/`, `examples/`, plus `pyproject.toml`

- [ ] **Step 1: Update pyproject.toml**

```toml
[tool.hatch.build]
exclude = ["nebo/server/static/.gitkeep"]

[tool.hatch.build.force-include]
"nebo/server/static" = "nebo/server/static"
```

Also add CLI entry point:

```toml
[project.scripts]
nb = "nebo.cli:main"
```

- [ ] **Step 2: Rename all Python imports**

Run these replacements across all `.py` files in `nebo/`, `tests/`, and `examples/`:

```
"graphbook.beta" → "nebo"          (import paths)
"graphbook" → "nebo"               (remaining references in strings/comments)
"gb\." → "nb."                     (in docstrings, comments, examples only — NOT variable names)
"GRAPHBOOK_" → "NEBO_"             (environment variables)
```

Key files that need careful attention:

**nebo/__init__.py** — Update module docstring, all imports, warning messages, env var names:
```python
"""Nebo — Lightweight observability for Python programs.

Usage:
    import nebo as nb

    @nb.fn()
    def my_function():
        nb.log("hello")
        nb.log_metric("loss", 0.5)
"""

from nebo.core.decorators import fn
from nebo.core.tracker import track
from nebo.core.config import log_cfg
from nebo.core.state import _current_node, get_state, LoggingBackend
from nebo.logging.logger import (
    log, log_metric, log_image, log_audio, log_text, md,
)
```

**nebo/__init__.py** `init()` function — Update env var names:
```python
env_mode = os.environ.get("NEBO_MODE")
env_port = os.environ.get("NEBO_SERVER_PORT")
env_run_id = os.environ.get("NEBO_RUN_ID")
env_flush_interval = os.environ.get("NEBO_FLUSH_INTERVAL")
```

And the auto-init warning:
```python
warnings.warn(
    "nebo was already implicitly initialized by a prior nb.* call. "
    "Call nb.init() before any @nb.fn() execution, nb.log(), nb.md(), etc. "
    "This nb.init() call will be ignored.",
    stacklevel=2,
)
```

And server fallback message:
```python
print(f"Warning: Could not connect to nebo daemon at {host}:{port}. Falling back to local mode.")
```

And DaemonClient imports:
```python
from nebo.core.client import DaemonClient
```

And TerminalDisplay import:
```python
from nebo.terminal.display import TerminalDisplay
```

**nebo/core/decorators.py** — Update imports and auto-init:
```python
from nebo.core.state import _current_node, get_state

# Inside wrapper:
from nebo import _ensure_init
```

**nebo/core/state.py** — Update module docstring:
```python
"""Global session state for nebo."""
```

**nebo/logging/logger.py** — Update imports:
```python
from nebo.core.state import _current_node, get_state

def _ensure_initialized():
    from nebo import _ensure_init
    _ensure_init()
```

And serializer imports:
```python
from nebo.logging.serializers import serialize_image
from nebo.logging.serializers import serialize_audio
```

**nebo/cli.py** — Update env vars set when spawning subprocess:
```python
env["NEBO_SERVER_PORT"] = str(port)
env["NEBO_RUN_ID"] = run_id
env["NEBO_MODE"] = "server"
env["NEBO_FLUSH_INTERVAL"] = str(flush_interval)
```

**All example files** — Update imports:
```python
# Before:
import graphbook.beta as gb
# After:
import nebo as nb
```
Then replace all `gb.` calls with `nb.` in each example file.

**All test files** — Update imports similarly.

- [ ] **Step 3: Run all tests to verify the rename**

Run: `pytest tests/ -v`
Expected: All existing tests pass with new namespace.

- [ ] **Step 4: Run an example to smoke test**

Run: `python examples/beta_basic_pipeline.py`
Expected: Runs without import errors (may fail to connect to daemon, that's fine).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename graphbook.beta namespace to nebo (gb → nb)"
```

---

## Task 2: MCP Tool Rename

Rename all MCP tool names from `graphbook_*` to `nebo_*`.

**Files:**
- Modify: `nebo/mcp/server.py`
- Modify: `nebo/mcp/tools.py`
- Test: `tests/test_mcp_tools.py`

- [ ] **Step 1: Write the failing test**

In `tests/test_mcp_tools.py`, add a test that verifies tool names:

```python
def test_all_tool_names_use_nebo_prefix():
    from nebo.mcp.server import MCP_TOOLS
    for tool in MCP_TOOLS:
        assert tool["name"].startswith("nebo_"), f"Tool {tool['name']} should start with nebo_"
        assert "graphbook" not in tool["name"], f"Tool {tool['name']} still contains graphbook"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mcp_tools.py::test_all_tool_names_use_nebo_prefix -v`
Expected: FAIL — tools still named `graphbook_*`

- [ ] **Step 3: Rename tools in server.py**

In `nebo/mcp/server.py`, replace all tool name strings:
```
"graphbook_get_graph"          → "nebo_get_graph"
"graphbook_get_node_status"    → "nebo_get_node_status"
"graphbook_get_logs"           → "nebo_get_logs"
"graphbook_get_metrics"        → "nebo_get_metrics"
"graphbook_get_errors"         → "nebo_get_errors"
"graphbook_get_description"    → "nebo_get_description"
"graphbook_run_pipeline"       → "nebo_run_pipeline"
"graphbook_stop_pipeline"      → "nebo_stop_pipeline"
"graphbook_restart_pipeline"   → "nebo_restart_pipeline"
"graphbook_get_run_status"     → "nebo_get_run_status"
"graphbook_get_run_history"    → "nebo_get_run_history"
"graphbook_get_source_code"    → "nebo_get_source_code"
"graphbook_write_source_code"  → "nebo_write_source_code"
"graphbook_wait_for_event"     → "nebo_wait_for_event"
"graphbook_ask_user"           → "nebo_ask_user"
```

Update `handle_tool_call()` dispatch to match new names.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mcp_tools.py -v`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add nebo/mcp/server.py nebo/mcp/tools.py tests/test_mcp_tools.py
git commit -m "refactor: rename MCP tools from graphbook_* to nebo_*"
```

---

## Task 3: Lazy Node Materialization

Nodes should only materialize (become visible in the DAG) when a log function is called from within them. The decorator registers metadata but doesn't create a visible node.

**Files:**
- Modify: `nebo/core/state.py`
- Modify: `nebo/core/decorators.py`
- Modify: `nebo/logging/logger.py`
- Test: `tests/test_decorators.py`

- [ ] **Step 1: Write the failing test**

In `tests/test_decorators.py`, add:

```python
def test_node_not_materialized_without_log(reset_state):
    """A decorated function that never logs should not appear as a node."""
    import nebo as nb
    from nebo.core.state import get_state

    @nb.fn()
    def silent_function(x):
        return x + 1

    result = silent_function(5)
    state = get_state()
    assert "silent_function" not in state.nodes or not state.nodes["silent_function"].materialized
    assert result == 6


def test_node_materializes_on_first_log(reset_state):
    """A decorated function should materialize when it first calls nb.log()."""
    import nebo as nb
    from nebo.core.state import get_state

    @nb.fn()
    def logging_function():
        nb.log("hello")

    logging_function()
    state = get_state()
    node = state.nodes.get("logging_function")
    assert node is not None
    assert node.materialized is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_decorators.py::test_node_not_materialized_without_log tests/test_decorators.py::test_node_materializes_on_first_log -v`
Expected: FAIL — `materialized` attribute doesn't exist yet.

- [ ] **Step 3: Add materialized field to NodeInfo**

In `nebo/core/state.py`, add to `NodeInfo`:

```python
@dataclass
class NodeInfo:
    name: str
    func_name: str
    docstring: Optional[str] = None
    exec_count: int = 0
    is_source: bool = True
    pausable: bool = False
    materialized: bool = False  # True after first log call
    params: dict = field(default_factory=dict)
    logs: list = field(default_factory=list)
    metrics: dict = field(default_factory=lambda: {})
    errors: list = field(default_factory=list)
    images: list = field(default_factory=list)
    audio: list = field(default_factory=list)
    progress: Optional[dict] = None
```

- [ ] **Step 4: Modify register_node to not send event**

In `nebo/core/state.py`, change `register_node` to not send the `node_register` event. Add `ensure_node()`:

```python
def register_node(
    self,
    node_id: str,
    func_name: str,
    docstring: Optional[str] = None,
    pausable: bool = False,
) -> NodeInfo:
    """Register a new node or return existing one.

    Creates NodeInfo locally but does NOT send node_register event.
    The node is not materialized until ensure_node() is called.
    """
    with self._lock_state:
        if node_id not in self.nodes:
            self.nodes[node_id] = NodeInfo(
                name=node_id,
                func_name=func_name,
                docstring=docstring,
                pausable=pausable,
            )
            if pausable:
                self._has_pausable = True
    return self.nodes[node_id]

def ensure_node(self, node_id: str) -> None:
    """Materialize a node on first log call. Sends node_register event."""
    node = self.nodes.get(node_id)
    if node is None or node.materialized:
        return
    node.materialized = True
    self._send_to_client({
        "type": "node_register",
        "node": node_id,
        "data": {
            "node_id": node_id,
            "func_name": node.func_name,
            "docstring": node.docstring,
            "pausable": node.pausable,
        },
    })
```

- [ ] **Step 5: Add ensure_node calls to all log functions**

In `nebo/logging/logger.py`, add `state.ensure_node(node_id)` after getting `node_id` in each log function. Example for `log()`:

```python
def log(message, *, step=None):
    _ensure_initialized()
    if _is_tensor_like(message):
        message = _format_tensor(message)
    if not isinstance(message, str):
        message = str(message)

    state = get_state()
    node_id = _current_node.get()
    if node_id:
        state.ensure_node(node_id)
    timestamp = time.time()
    # ... rest unchanged
```

Apply the same pattern to: `log_metric()`, `log_image()`, `log_audio()`, `log_text()`, `md()`.

Note: `md()` is workflow-level and doesn't have a node_id, so no `ensure_node` needed there.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_decorators.py -v`
Expected: All tests pass, including new ones.

- [ ] **Step 7: Run full test suite**

Run: `pytest tests/ -v`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add nebo/core/state.py nebo/core/decorators.py nebo/logging/logger.py tests/test_decorators.py
git commit -m "feat: lazy node materialization — nodes only appear on first log call"
```

---

## Task 4: Class Decoration

Add support for `@nb.fn()` on classes. All methods get scope tracking. The class becomes a visual group container.

**Files:**
- Modify: `nebo/core/decorators.py`
- Modify: `nebo/core/state.py`
- Create: `tests/test_class_decoration.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_class_decoration.py`:

```python
"""Tests for class decoration with @nb.fn()."""

import warnings
import pytest
from nebo.core.state import SessionState


@pytest.fixture
def reset_state():
    SessionState.reset_singleton()
    yield
    SessionState.reset_singleton()


def test_class_decoration_wraps_methods(reset_state):
    """Decorating a class wraps all methods with scope tracking."""
    import nebo as nb
    from nebo.core.state import get_state

    @nb.fn()
    class MyProcessor:
        def process(self):
            nb.log("processing")

        def finalize(self):
            nb.log("finalizing")

    p = MyProcessor()
    p.process()
    p.finalize()

    state = get_state()
    assert "MyProcessor.process" in state.nodes
    assert "MyProcessor.finalize" in state.nodes
    assert state.nodes["MyProcessor.process"].materialized
    assert state.nodes["MyProcessor.finalize"].materialized


def test_class_group_field(reset_state):
    """Methods in a decorated class have the group field set."""
    import nebo as nb
    from nebo.core.state import get_state

    @nb.fn()
    class MyAgent:
        def think(self):
            nb.log("thinking")

    agent = MyAgent()
    agent.think()

    state = get_state()
    node = state.nodes["MyAgent.think"]
    assert node.group == "MyAgent"


def test_no_log_no_node_in_class(reset_state):
    """Methods that don't call log functions don't materialize."""
    import nebo as nb
    from nebo.core.state import get_state

    @nb.fn()
    class MyClass:
        def logs(self):
            nb.log("visible")

        def silent(self):
            return 42

    obj = MyClass()
    obj.logs()
    obj.silent()

    state = get_state()
    assert state.nodes["MyClass.logs"].materialized
    node = state.nodes.get("MyClass.silent")
    assert node is None or not node.materialized


def test_redundant_decorator_warning(reset_state):
    """@nb.fn() on a method inside a decorated class issues a warning."""
    import nebo as nb

    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")

        @nb.fn()
        class MyClass:
            @nb.fn()
            def my_method(self):
                nb.log("hello")

        assert len(w) == 1
        assert "redundant" in str(w[0].message).lower()


def test_decorated_method_in_undecorated_class(reset_state):
    """@nb.fn() on a method in an undecorated class is a standalone node."""
    import nebo as nb
    from nebo.core.state import get_state

    class MyClass:
        @nb.fn()
        def my_method(self):
            nb.log("standalone")

    obj = MyClass()
    obj.my_method()

    state = get_state()
    node = state.nodes["MyClass.my_method"]
    assert node.materialized
    assert node.group is None


def test_called_fn_inside_class_group(reset_state):
    """A standalone @nb.fn() function called from a decorated class
    appears inside the class group."""
    import nebo as nb
    from nebo.core.state import get_state

    @nb.fn()
    def helper():
        nb.log("helping")

    @nb.fn()
    class MyClass:
        def run(self):
            nb.log("running")
            helper()

    obj = MyClass()
    obj.run()

    state = get_state()
    # helper was called within MyClass context, so it should be in the group
    assert state.nodes["helper"].group == "MyClass"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_class_decoration.py -v`
Expected: FAIL — class decoration not implemented.

- [ ] **Step 3: Add group field to NodeInfo**

In `nebo/core/state.py`, add `group` to `NodeInfo`:

```python
@dataclass
class NodeInfo:
    name: str
    func_name: str
    docstring: Optional[str] = None
    exec_count: int = 0
    is_source: bool = True
    pausable: bool = False
    materialized: bool = False
    group: Optional[str] = None  # Class name if method is in a decorated class
    params: dict = field(default_factory=dict)
    logs: list = field(default_factory=list)
    metrics: dict = field(default_factory=lambda: {})
    errors: list = field(default_factory=list)
    images: list = field(default_factory=list)
    audio: list = field(default_factory=list)
    progress: Optional[dict] = None
```

Update `register_node` to accept `group`:

```python
def register_node(
    self,
    node_id: str,
    func_name: str,
    docstring: Optional[str] = None,
    pausable: bool = False,
    group: Optional[str] = None,
) -> NodeInfo:
    with self._lock_state:
        if node_id not in self.nodes:
            self.nodes[node_id] = NodeInfo(
                name=node_id,
                func_name=func_name,
                docstring=docstring,
                pausable=pausable,
                group=group,
            )
            if pausable:
                self._has_pausable = True
        elif group is not None and self.nodes[node_id].group is None:
            # Update group if called from within a class context
            self.nodes[node_id].group = group
    return self.nodes[node_id]
```

Update `ensure_node` to include `group` in the event:

```python
def ensure_node(self, node_id: str) -> None:
    node = self.nodes.get(node_id)
    if node is None or node.materialized:
        return
    node.materialized = True
    self._send_to_client({
        "type": "node_register",
        "node": node_id,
        "data": {
            "node_id": node_id,
            "func_name": node.func_name,
            "docstring": node.docstring,
            "pausable": node.pausable,
            "group": node.group,
        },
    })
```

Update `get_graph_dict` to include `group`:

```python
def get_graph_dict(self) -> dict:
    return {
        "nodes": {
            nid: {
                "name": n.name,
                "func_name": n.func_name,
                "docstring": n.docstring,
                "exec_count": n.exec_count,
                "is_source": n.is_source,
                "params": n.params,
                "progress": n.progress,
                "group": n.group,
            }
            for nid, n in self.nodes.items()
            if n.materialized
        },
        "edges": [{"source": e.source, "target": e.target} for e in self.edges],
        "workflow_description": self.workflow_description,
    }
```

Also add a `_current_group` context var:

```python
_current_group: ContextVar[Optional[str]] = ContextVar("current_group", default=None)
```

- [ ] **Step 4: Implement class detection in decorators.py**

In `nebo/core/decorators.py`, update the `fn()` function to handle classes:

```python
import inspect
import warnings
from nebo.core.state import _current_node, _current_group, get_state


def fn(
    func=None,
    depends_on=None,
    pausable: bool = False,
):
    def decorator(f):
        if inspect.isclass(f):
            return _decorate_class(f, depends_on, pausable)
        return _decorate_function(f, depends_on, pausable)

    if func is None:
        return decorator
    if callable(func):
        return decorator(func)
    raise TypeError(
        f"fn() got an unexpected positional argument {func!r}. "
        "Use @nb.fn or @nb.fn() instead."
    )


def _decorate_class(cls, depends_on, pausable):
    """Wrap all methods of a class with scope tracking."""
    class_name = cls.__qualname__

    for attr_name in list(vars(cls)):
        attr = getattr(cls, attr_name)
        if not callable(attr) or isinstance(attr, type):
            continue

        # Check for redundant @nb.fn() on methods
        if hasattr(attr, "_nb_decorated"):
            warnings.warn(
                f"@nb.fn() on method '{class_name}.{attr_name}' is redundant — "
                f"the class '{class_name}' is already decorated.",
                stacklevel=2,
            )
            # Unwrap the redundant decorator and re-wrap with group
            original = attr._nb_original
            wrapped = _decorate_function(
                original, depends_on=None, pausable=pausable, group=class_name,
            )
            setattr(cls, attr_name, wrapped)
        else:
            wrapped = _decorate_function(
                attr, depends_on=None, pausable=pausable, group=class_name,
            )
            setattr(cls, attr_name, wrapped)

    # Add explicit depends_on edges
    if depends_on:
        cls._nb_depends_on = depends_on

    return cls


def _decorate_function(f, depends_on, pausable, group=None):
    """Wrap a single function with scope tracking."""
    node_id = f.__qualname__
    registered = False

    depends_on_ids = []
    if depends_on:
        for dep in depends_on:
            if callable(dep):
                depends_on_ids.append(dep.__qualname__)
            else:
                depends_on_ids.append(str(dep))

    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        nonlocal registered
        try:
            from nebo import _ensure_init
            _ensure_init()
        except ImportError:
            pass
        state = get_state()

        # Determine group: use explicit group, or inherit from _current_group
        effective_group = group or _current_group.get()

        if not registered:
            state.register_node(
                node_id=node_id,
                func_name=f.__name__,
                docstring=f.__doc__,
                pausable=pausable,
                group=effective_group,
            )
            registered = True
        elif effective_group:
            # Update group if this function is being called within a class context
            node = state.nodes.get(node_id)
            if node and node.group is None:
                node.group = effective_group

        state.ensure_display()
        parent = _current_node.get()
        token = _current_node.set(node_id)

        # Set group context if this function defines a group
        group_token = None
        if group:
            group_token = _current_group.set(group)

        try:
            if depends_on_ids:
                for dep in depends_on_ids:
                    state.add_edge(dep, node_id)

            state._node_parents[node_id] = parent
            strategy = state.dag_strategy

            if strategy == "none":
                pass
            elif strategy == "stack":
                if parent is not None:
                    state.add_edge(parent, node_id)
            elif strategy == "both":
                if parent is not None:
                    state.add_edge(parent, node_id)
                producers = state.find_producers(args, kwargs, parent)
                for producer in producers:
                    state.add_edge(producer, node_id)
            else:  # "object"
                producers = state.find_producers(args, kwargs, parent)
                if producers:
                    for producer in producers:
                        state.add_edge(producer, node_id)
                elif parent is not None and not depends_on_ids:
                    state.add_edge(parent, node_id)

            node_info = state.nodes.get(node_id)
            params = node_info.params if node_info else {}
            for backend in state.backends:
                try:
                    backend.on_node_start(node_id, params)
                except Exception:
                    pass

            if pausable:
                state.wait_if_paused()

            state.increment_count(node_id)
            start_time = time.monotonic()
            result = f(*args, **kwargs)
            duration = time.monotonic() - start_time

            state.track_return(node_id, result)

            for backend in state.backends:
                try:
                    backend.on_node_end(node_id, duration)
                except Exception:
                    pass

            return result
        except Exception as exc:
            node_info = state.nodes.get(node_id)
            error_info = {
                "node": node_id,
                "docstring": node_info.docstring if node_info else None,
                "exec_count": node_info.exec_count if node_info else 0,
                "params": node_info.params if node_info else {},
                "traceback": traceback.format_exc(),
                "error": str(exc),
                "type": type(exc).__name__,
                "timestamp": time.time(),
            }
            if node_info:
                node_info.errors.append(error_info)
            if state._queue is not None:
                try:
                    state._queue.put_event({"type": "error", "data": error_info})
                except Exception:
                    pass
            raise
        finally:
            _current_node.reset(token)
            if group_token is not None:
                _current_group.reset(group_token)

    wrapper._nb_decorated = True
    wrapper._nb_original = f
    return wrapper
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_class_decoration.py -v`
Expected: All tests pass.

- [ ] **Step 6: Run full test suite**

Run: `pytest tests/ -v`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add nebo/core/decorators.py nebo/core/state.py tests/test_class_decoration.py
git commit -m "feat: class decoration support with @nb.fn() and group nodes"
```

---

## Task 5: .nebo File Format

Implement the binary file writer and reader using MessagePack.

**Files:**
- Modify: `pyproject.toml` (add msgpack dependency)
- Create: `nebo/core/fileformat.py`
- Create: `tests/test_fileformat.py`

- [ ] **Step 1: Add msgpack dependency**

In `pyproject.toml`, add to dependencies:

```toml
dependencies = [
    "fastapi>=0.100.0",
    "httpx>=0.24.0",
    "msgpack>=1.0.0",
    "rich>=13.0.0",
    "uvicorn>=0.23.0",
    "websockets>=11.0"
]
```

Run: `uv sync` (or `pip install msgpack`)

- [ ] **Step 2: Write the failing tests**

Create `tests/test_fileformat.py`:

```python
"""Tests for .nebo file format."""

import io
import struct
import tempfile
import pytest
import msgpack


def test_write_header():
    """Writer should produce a valid header with magic, version, metadata."""
    from nebo.core.fileformat import NeboFileWriter

    buf = io.BytesIO()
    writer = NeboFileWriter(buf, run_id="test-run", script_path="test.py")
    writer.write_header()
    writer.close()

    buf.seek(0)
    magic = buf.read(4)
    assert magic == b"nebo"

    version = struct.unpack(">H", buf.read(2))[0]
    assert version == 1

    meta_size = struct.unpack(">I", buf.read(4))[0]
    meta = msgpack.unpackb(buf.read(meta_size), raw=False)
    assert meta["run_id"] == "test-run"
    assert meta["script_path"] == "test.py"


def test_write_and_read_entries():
    """Round-trip: write entries then read them back."""
    from nebo.core.fileformat import NeboFileWriter, NeboFileReader

    buf = io.BytesIO()
    writer = NeboFileWriter(buf, run_id="test-run", script_path="test.py")
    writer.write_header()

    writer.write_entry("log", {"node": "my_func", "message": "hello", "timestamp": 1000.0})
    writer.write_entry("metric", {"node": "my_func", "name": "loss", "value": 0.5, "step": 0, "timestamp": 1000.1})
    writer.close()

    buf.seek(0)
    reader = NeboFileReader(buf)
    meta = reader.read_header()
    assert meta["run_id"] == "test-run"

    entries = list(reader.read_entries())
    assert len(entries) == 2
    assert entries[0]["type"] == "log"
    assert entries[0]["payload"]["message"] == "hello"
    assert entries[1]["type"] == "metric"
    assert entries[1]["payload"]["value"] == 0.5


def test_write_binary_media():
    """Images and audio should be stored as raw bytes, not base64."""
    from nebo.core.fileformat import NeboFileWriter, NeboFileReader

    image_bytes = b"\x89PNG\r\n" + b"\x00" * 100

    buf = io.BytesIO()
    writer = NeboFileWriter(buf, run_id="test-run", script_path="test.py")
    writer.write_header()
    writer.write_entry("image", {"node": "my_func", "name": "out", "data": image_bytes, "timestamp": 1000.0})
    writer.close()

    buf.seek(0)
    reader = NeboFileReader(buf)
    reader.read_header()
    entries = list(reader.read_entries())
    assert len(entries) == 1
    assert entries[0]["payload"]["data"] == image_bytes


def test_skip_entry_by_size():
    """Reader should be able to skip entries using the size field."""
    from nebo.core.fileformat import NeboFileWriter, NeboFileReader

    buf = io.BytesIO()
    writer = NeboFileWriter(buf, run_id="test-run", script_path="test.py")
    writer.write_header()
    writer.write_entry("log", {"message": "first"})
    writer.write_entry("log", {"message": "second"})
    writer.write_entry("log", {"message": "third"})
    writer.close()

    buf.seek(0)
    reader = NeboFileReader(buf)
    reader.read_header()

    # Read first entry
    entry = reader.read_next_entry()
    assert entry["payload"]["message"] == "first"

    # Skip second entry
    reader.skip_next_entry()

    # Read third entry
    entry = reader.read_next_entry()
    assert entry["payload"]["message"] == "third"


def test_file_on_disk():
    """Write to a real file and read it back."""
    from nebo.core.fileformat import NeboFileWriter, NeboFileReader

    with tempfile.NamedTemporaryFile(suffix=".nebo", delete=False) as f:
        path = f.name
        writer = NeboFileWriter(f, run_id="disk-test", script_path="script.py")
        writer.write_header()
        writer.write_entry("log", {"message": "from disk"})
        writer.close()

    with open(path, "rb") as f:
        reader = NeboFileReader(f)
        meta = reader.read_header()
        assert meta["run_id"] == "disk-test"
        entries = list(reader.read_entries())
        assert len(entries) == 1
        assert entries[0]["payload"]["message"] == "from disk"

    import os
    os.unlink(path)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/test_fileformat.py -v`
Expected: FAIL — `nebo.core.fileformat` doesn't exist.

- [ ] **Step 4: Implement NeboFileWriter and NeboFileReader**

Create `nebo/core/fileformat.py`:

```python
"""Nebo binary file format — append-only, MessagePack-based log files.

File structure:
    [Header]
      magic: b"nebo" (4 bytes)
      version: u16 big-endian (currently 1)
      metadata_size: u32 big-endian
      metadata: msgpack map {run_id, script_path, started_at, nebo_version, args}

    [Entry]*
      type_byte: u8 (entry type index)
      size: u32 big-endian (payload size in bytes)
      payload: msgpack map (entry-specific data)
"""

from __future__ import annotations

import struct
import time
from typing import Any, BinaryIO, Iterator, Optional

import msgpack

FORMAT_VERSION = 1
MAGIC = b"nebo"

ENTRY_TYPES = {
    "log": 0,
    "metric": 1,
    "image": 2,
    "audio": 3,
    "node_register": 4,
    "edge": 5,
    "error": 6,
    "ask": 7,
    "ui_config": 8,
    "text": 9,
    "progress": 10,
    "config": 11,
    "description": 12,
    "node_executed": 13,
    "ask_response": 14,
    "run_start": 15,
    "run_completed": 16,
    "pause_state": 17,
}

ENTRY_TYPES_REVERSE = {v: k for k, v in ENTRY_TYPES.items()}


class NeboFileWriter:
    """Append-only writer for .nebo files."""

    def __init__(
        self,
        stream: BinaryIO,
        run_id: str,
        script_path: str,
        args: Optional[list[str]] = None,
    ) -> None:
        self._stream = stream
        self._run_id = run_id
        self._script_path = script_path
        self._args = args or []
        self._started_at = time.time()

    def write_header(self) -> None:
        """Write the file header (magic, version, metadata)."""
        self._stream.write(MAGIC)
        self._stream.write(struct.pack(">H", FORMAT_VERSION))

        metadata = {
            "run_id": self._run_id,
            "script_path": self._script_path,
            "started_at": self._started_at,
            "nebo_version": "0.1.0",
            "args": self._args,
        }
        meta_bytes = msgpack.packb(metadata, use_bin_type=True)
        self._stream.write(struct.pack(">I", len(meta_bytes)))
        self._stream.write(meta_bytes)
        self._stream.flush()

    def write_entry(self, entry_type: str, payload: dict[str, Any]) -> None:
        """Write a single log entry."""
        type_byte = ENTRY_TYPES.get(entry_type, 255)
        payload_bytes = msgpack.packb(payload, use_bin_type=True)

        self._stream.write(struct.pack(">B", type_byte))
        self._stream.write(struct.pack(">I", len(payload_bytes)))
        self._stream.write(payload_bytes)
        self._stream.flush()

    def close(self) -> None:
        """Flush and close the stream."""
        self._stream.flush()


class NeboFileReader:
    """Reader for .nebo files."""

    def __init__(self, stream: BinaryIO) -> None:
        self._stream = stream

    def read_header(self) -> dict[str, Any]:
        """Read and validate the file header. Returns metadata dict."""
        magic = self._stream.read(4)
        if magic != MAGIC:
            raise ValueError(f"Not a .nebo file: invalid magic {magic!r}")

        version = struct.unpack(">H", self._stream.read(2))[0]
        if version > FORMAT_VERSION:
            raise ValueError(f"Unsupported .nebo format version {version}")

        meta_size = struct.unpack(">I", self._stream.read(4))[0]
        meta_bytes = self._stream.read(meta_size)
        return msgpack.unpackb(meta_bytes, raw=False)

    def read_next_entry(self) -> Optional[dict[str, Any]]:
        """Read the next entry. Returns None at EOF."""
        type_data = self._stream.read(1)
        if not type_data:
            return None

        type_byte = struct.unpack(">B", type_data)[0]
        size = struct.unpack(">I", self._stream.read(4))[0]
        payload_bytes = self._stream.read(size)
        payload = msgpack.unpackb(payload_bytes, raw=False)

        entry_type = ENTRY_TYPES_REVERSE.get(type_byte, f"unknown_{type_byte}")
        return {"type": entry_type, "payload": payload}

    def skip_next_entry(self) -> bool:
        """Skip the next entry without parsing payload. Returns False at EOF."""
        type_data = self._stream.read(1)
        if not type_data:
            return False

        size = struct.unpack(">I", self._stream.read(4))[0]
        self._stream.seek(size, 1)  # seek relative to current position
        return True

    def read_entries(self) -> Iterator[dict[str, Any]]:
        """Iterate over all entries."""
        while True:
            entry = self.read_next_entry()
            if entry is None:
                break
            yield entry
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_fileformat.py -v`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml nebo/core/fileformat.py tests/test_fileformat.py
git commit -m "feat: .nebo binary file format with MessagePack serialization"
```

---

## Task 6: Storage & File Loading

Integrate the file writer into the daemon and add the `nb load` command.

**Files:**
- Modify: `nebo/server/daemon.py`
- Modify: `nebo/cli.py`
- Modify: `nebo/__init__.py` (add `store` param to `init()`)
- Create: `tests/test_storage.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_storage.py`:

```python
"""Tests for .nebo file storage integration."""

import os
import tempfile
import pytest
from unittest.mock import patch


def test_daemon_creates_nebo_directory(tmp_path):
    """Daemon should create .nebo/ directory in its cwd on startup."""
    from nebo.server.daemon import DaemonState

    with patch("nebo.server.daemon.NEBO_STORAGE_DIR", str(tmp_path / ".nebo")):
        state = DaemonState()
        state.init_storage()
        assert os.path.isdir(tmp_path / ".nebo")


def test_store_true_creates_file(tmp_path):
    """When store=True, daemon writes a .nebo file for the run."""
    from nebo.server.daemon import DaemonState

    storage_dir = str(tmp_path / ".nebo")
    with patch("nebo.server.daemon.NEBO_STORAGE_DIR", storage_dir):
        state = DaemonState()
        state.init_storage()
        run = state.create_run("test.py", [], "run-1", store=True)

        # Ingest a log event
        import asyncio
        asyncio.run(state.ingest_events([{
            "type": "log",
            "node": "func",
            "message": "hello",
            "timestamp": 1000.0,
        }], run_id="run-1"))

        state.finalize_run("run-1")

        # Check file was created
        files = os.listdir(storage_dir)
        assert len(files) == 1
        assert files[0].endswith(".nebo")


def test_store_false_no_file(tmp_path):
    """When store=False, no .nebo file is created."""
    from nebo.server.daemon import DaemonState

    storage_dir = str(tmp_path / ".nebo")
    with patch("nebo.server.daemon.NEBO_STORAGE_DIR", storage_dir):
        state = DaemonState()
        state.init_storage()
        run = state.create_run("test.py", [], "run-2", store=False)

        import asyncio
        asyncio.run(state.ingest_events([{
            "type": "log",
            "node": "func",
            "message": "hello",
            "timestamp": 1000.0,
        }], run_id="run-2"))

        state.finalize_run("run-2")

        files = os.listdir(storage_dir)
        assert len(files) == 0


def test_load_nebo_file(tmp_path):
    """Loading a .nebo file should reconstruct a Run in the daemon."""
    from nebo.core.fileformat import NeboFileWriter, NeboFileReader
    from nebo.server.daemon import DaemonState

    # Write a .nebo file
    filepath = str(tmp_path / "test.nebo")
    with open(filepath, "wb") as f:
        writer = NeboFileWriter(f, run_id="loaded-run", script_path="test.py")
        writer.write_header()
        writer.write_entry("node_register", {
            "node_id": "my_func",
            "func_name": "my_func",
            "docstring": "A function",
        })
        writer.write_entry("log", {
            "node": "my_func",
            "message": "loaded message",
            "timestamp": 1000.0,
        })
        writer.close()

    state = DaemonState()
    import asyncio
    asyncio.run(state.load_nebo_file(filepath))

    assert "loaded-run" in state.runs
    run = state.runs["loaded-run"]
    assert len(run.logs) == 1
    assert run.logs[0]["message"] == "loaded message"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_storage.py -v`
Expected: FAIL — `init_storage`, `store` param, `load_nebo_file` don't exist.

- [ ] **Step 3: Add store parameter to nb.init()**

In `nebo/__init__.py`, add `store` parameter to `init()`:

```python
def init(
    port: int = 2048,
    host: str = "localhost",
    mode: Literal["auto", "server", "local"] = "auto",
    backends: Optional[list[Any]] = None,
    terminal: bool = True,
    dag_strategy: Literal["object", "stack", "both", "none"] = "object",
    flush_interval: float = 0.1,
    store: bool = True,
    _internal: bool = False,
) -> None:
```

After establishing the client connection, send the `store` preference:

```python
if state._client is not None and script_name:
    state._send_to_client({
        "type": "run_start",
        "data": {"script_path": script_name, "store": store},
    })
```

- [ ] **Step 4: Add storage integration to daemon**

In `nebo/server/daemon.py`, add storage support:

1. Add `NEBO_STORAGE_DIR` module variable:
```python
import os
NEBO_STORAGE_DIR = os.path.join(os.getcwd(), ".nebo")
```

2. Add `init_storage()` to `DaemonState`:
```python
def init_storage(self):
    os.makedirs(NEBO_STORAGE_DIR, exist_ok=True)
```

3. Update `create_run()` to accept `store` param and open a file writer:
```python
def create_run(self, script_path, args, run_id, store=True):
    run = Run(id=run_id, script_path=script_path, args=args, ...)
    self.runs[run_id] = run

    if store:
        from nebo.core.fileformat import NeboFileWriter
        import time
        timestamp = time.strftime("%Y-%m-%d_%H%M%S")
        filepath = os.path.join(NEBO_STORAGE_DIR, f"{timestamp}.nebo")
        run._file_stream = open(filepath, "wb")
        run._file_writer = NeboFileWriter(
            run._file_stream, run_id=run_id, script_path=script_path, args=args,
        )
        run._file_writer.write_header()
    else:
        run._file_stream = None
        run._file_writer = None

    return run
```

4. In `_process_event()`, write each event to file:
```python
def _process_event(self, run, event):
    # Existing event processing...

    # Write to .nebo file if storage is enabled
    if run._file_writer is not None:
        entry_type = event.get("type", "log")
        payload = dict(event)
        run._file_writer.write_entry(entry_type, payload)
```

5. Add `finalize_run()`:
```python
def finalize_run(self, run_id):
    run = self.runs.get(run_id)
    if run and run._file_stream:
        run._file_writer.close()
        run._file_stream.close()
        run._file_stream = None
        run._file_writer = None
```

6. Add `load_nebo_file()`:
```python
async def load_nebo_file(self, filepath: str):
    from nebo.core.fileformat import NeboFileReader

    with open(filepath, "rb") as f:
        reader = NeboFileReader(f)
        meta = reader.read_header()
        run_id = meta["run_id"]

        run = self.create_run(
            meta["script_path"],
            meta.get("args", []),
            run_id,
            store=False,  # Don't re-write when loading
        )
        run.status = "completed"

        events = list(reader.read_entries())
        event_dicts = [
            {"type": e["type"], **e["payload"]}
            for e in events
        ]
        await self.ingest_events(event_dicts, run_id=run_id)
```

7. Add `POST /load` endpoint:
```python
@app.post("/load")
async def load_file(request: Request):
    body = await request.json()
    filepath = body.get("filepath")
    if not filepath or not os.path.exists(filepath):
        return {"error": "File not found"}
    await daemon_state.load_nebo_file(filepath)
    return {"status": "loaded", "filepath": filepath}
```

- [ ] **Step 5: Add --no-store flag to nb serve**

In `nebo/cli.py`, add `--no-store` to the `serve` subparser:

```python
serve_parser.add_argument("--no-store", action="store_true", help="Disable .nebo file storage")
```

Pass it to the daemon startup. When `--no-store` is set, the daemon skips `init_storage()` and ignores `store=True` from SDKs.

- [ ] **Step 6: Add nb load CLI command**

In `nebo/cli.py`, add the `load` subcommand:

```python
load_parser = subparsers.add_parser("load", help="Load a .nebo file into the daemon")
load_parser.add_argument("file", help="Path to .nebo file")
load_parser.add_argument("--port", type=int, default=2048)
load_parser.set_defaults(func=cmd_load)

def cmd_load(args):
    import httpx
    filepath = os.path.abspath(args.file)
    if not os.path.exists(filepath):
        print(f"Error: File not found: {filepath}")
        return 1
    url = f"http://localhost:{args.port}/load"
    resp = httpx.post(url, json={"filepath": filepath})
    data = resp.json()
    if "error" in data:
        print(f"Error: {data['error']}")
        return 1
    print(f"Loaded: {filepath}")
    return 0
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/test_storage.py -v`
Expected: All tests pass.

- [ ] **Step 8: Run full test suite**

Run: `pytest tests/ -v`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add nebo/server/daemon.py nebo/cli.py nebo/__init__.py tests/test_storage.py
git commit -m "feat: .nebo file storage with daemon integration and nb load command"
```

---

## Task 7: nb.ui() Configuration

Add run-level UI defaults and per-node UI hints.

**Files:**
- Modify: `nebo/__init__.py`
- Modify: `nebo/core/decorators.py`
- Modify: `nebo/server/daemon.py`
- Create: `tests/test_ui_config.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_ui_config.py`:

```python
"""Tests for nb.ui() and @nb.fn(ui={...})."""

import pytest
from nebo.core.state import SessionState


@pytest.fixture
def reset_state():
    SessionState.reset_singleton()
    yield
    SessionState.reset_singleton()


def test_ui_sends_config_event(reset_state):
    """nb.ui() should store config and send ui_config event."""
    import nebo as nb
    from nebo.core.state import get_state

    nb.ui(layout="horizontal", view="dag", collapsed=False, minimap=True, theme="dark")

    state = get_state()
    assert state.ui_config is not None
    assert state.ui_config["layout"] == "horizontal"
    assert state.ui_config["view"] == "dag"
    assert state.ui_config["theme"] == "dark"


def test_ui_overwrites_previous(reset_state):
    """Calling nb.ui() again overwrites previous config."""
    import nebo as nb
    from nebo.core.state import get_state

    nb.ui(layout="horizontal")
    nb.ui(layout="vertical")

    state = get_state()
    assert state.ui_config["layout"] == "vertical"


def test_fn_ui_parameter(reset_state):
    """@nb.fn(ui={...}) stores per-node UI hints."""
    import nebo as nb
    from nebo.core.state import get_state

    @nb.fn(ui={"collapsed": True})
    def my_func():
        nb.log("hello")

    my_func()

    state = get_state()
    node = state.nodes["my_func"]
    assert node.ui_hints == {"collapsed": True}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_ui_config.py -v`
Expected: FAIL — `nb.ui()` doesn't exist, `ui_config` not on state, `ui_hints` not on NodeInfo.

- [ ] **Step 3: Add ui_config to SessionState and ui_hints to NodeInfo**

In `nebo/core/state.py`:

Add to `NodeInfo`:
```python
ui_hints: Optional[dict] = None  # Per-node UI display hints
```

Add to `SessionState.__init__()`:
```python
self.ui_config: Optional[dict] = None  # Run-level UI defaults
```

Add to `register_node()` signature:
```python
def register_node(self, node_id, func_name, docstring=None, pausable=False, group=None, ui_hints=None):
    # ... in the creation block:
    self.nodes[node_id] = NodeInfo(
        name=node_id,
        func_name=func_name,
        docstring=docstring,
        pausable=pausable,
        group=group,
        ui_hints=ui_hints,
    )
```

Update `ensure_node` to include `ui_hints` in the event:
```python
def ensure_node(self, node_id):
    node = self.nodes.get(node_id)
    if node is None or node.materialized:
        return
    node.materialized = True
    self._send_to_client({
        "type": "node_register",
        "node": node_id,
        "data": {
            "node_id": node_id,
            "func_name": node.func_name,
            "docstring": node.docstring,
            "pausable": node.pausable,
            "group": node.group,
            "ui_hints": node.ui_hints,
        },
    })
```

Add to `reset()`:
```python
self.ui_config = None
```

- [ ] **Step 4: Add nb.ui() function**

In `nebo/__init__.py`:

```python
def ui(
    layout: Optional[Literal["horizontal", "vertical"]] = None,
    view: Optional[Literal["dag", "grid"]] = None,
    collapsed: Optional[bool] = None,
    minimap: Optional[bool] = None,
    theme: Optional[Literal["dark", "light"]] = None,
) -> None:
    """Set run-level UI defaults.

    These are sent to the daemon and UI as defaults.
    The user can still override them in the UI.

    Args:
        layout: DAG layout direction ("horizontal" or "vertical").
        view: Default view mode ("dag" or "grid").
        collapsed: Default node collapse state.
        minimap: Show minimap.
        theme: Color theme ("dark" or "light").
    """
    _ensure_init()
    state = get_state()
    config = {}
    if layout is not None:
        config["layout"] = layout
    if view is not None:
        config["view"] = view
    if collapsed is not None:
        config["collapsed"] = collapsed
    if minimap is not None:
        config["minimap"] = minimap
    if theme is not None:
        config["theme"] = theme

    state.ui_config = config
    state._send_to_client({
        "type": "ui_config",
        "data": config,
    })
```

Add `ui` to `__all__`:
```python
__all__ = [
    "fn", "track", "log_cfg", "init", "log", "log_metric",
    "log_image", "log_audio", "log_text", "md", "ask", "ui",
    "get_state", "LoggingBackend",
]
```

- [ ] **Step 5: Add ui parameter to @nb.fn()**

In `nebo/core/decorators.py`, update `fn()` to accept `ui` and pass it through to `_decorate_function`:

```python
def fn(func=None, depends_on=None, pausable=False, ui=None):
    def decorator(f):
        if inspect.isclass(f):
            return _decorate_class(f, depends_on, pausable)
        return _decorate_function(f, depends_on, pausable, ui_hints=ui)
    ...
```

In `_decorate_function`, pass `ui_hints` to `register_node`:

```python
def _decorate_function(f, depends_on, pausable, group=None, ui_hints=None):
    ...
    if not registered:
        state.register_node(
            node_id=node_id,
            func_name=f.__name__,
            docstring=f.__doc__,
            pausable=pausable,
            group=effective_group,
            ui_hints=ui_hints,
        )
        registered = True
```

- [ ] **Step 6: Handle ui_config events in daemon**

In `nebo/server/daemon.py`, add to `_process_event()`:

```python
elif event_type == "ui_config":
    run.ui_config = event.get("data", {})
```

Add `ui_config` field to the `Run` class:
```python
ui_config: Optional[dict] = None
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/test_ui_config.py -v`
Expected: All tests pass.

- [ ] **Step 8: Run full test suite**

Run: `pytest tests/ -v`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add nebo/__init__.py nebo/core/state.py nebo/core/decorators.py nebo/server/daemon.py tests/test_ui_config.py
git commit -m "feat: nb.ui() for run-level UI defaults and @nb.fn(ui={}) for per-node hints"
```

---

## Task 8: UI — Group Node Rendering

Add transparent bounding box rendering for decorated classes in the DAG view.

**Files:**
- Modify: `ui/src/store/index.ts`
- Create: `ui/src/components/graph/GroupNode.tsx`
- Modify: `ui/src/components/graph/DagGraph.tsx`

- [ ] **Step 1: Add group field to store**

In `ui/src/store/index.ts`, update `NodeState` to include `group`:

```typescript
interface NodeState {
  name: string
  funcName: string
  docstring: string | null
  params: Record<string, unknown>
  executionCount: number
  isSource: boolean
  progress: { current: number; total: number; name?: string } | null
  inDag: boolean
  hasPendingAsk: boolean
  group: string | null  // Class name if method is in a decorated class
  uiHints: Record<string, unknown> | null  // Per-node UI hints
}
```

In `processWsEvents`, handle the new fields in `node_register`:

```typescript
case "node_register": {
  const nodeId = event.data?.node_id || event.node
  if (nodeId) {
    runState.graph = runState.graph || { nodes: {}, edges: [] }
    runState.graph.nodes[nodeId] = {
      name: nodeId,
      funcName: event.data?.func_name || nodeId,
      docstring: event.data?.docstring || null,
      params: event.data?.params || {},
      executionCount: 0,
      isSource: true,
      progress: null,
      inDag: true,
      hasPendingAsk: false,
      group: event.data?.group || null,
      uiHints: event.data?.ui_hints || null,
    }
  }
  break
}
```

Also handle `ui_config` events:

```typescript
case "ui_config": {
  // Store in run state for UI to read
  runState.uiConfig = event.data || {}
  break
}
```

Add `uiConfig` to `RunState`:
```typescript
interface RunState {
  // ... existing fields
  uiConfig: Record<string, unknown>
}
```

- [ ] **Step 2: Create GroupNode component**

Create `ui/src/components/graph/GroupNode.tsx`:

```tsx
import { memo } from "react"

interface GroupNodeProps {
  data: {
    label: string
    width: number
    height: number
  }
}

export const GroupNode = memo(function GroupNode({ data }: GroupNodeProps) {
  return (
    <div
      className="rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/10"
      style={{
        width: data.width,
        height: data.height,
        padding: 12,
      }}
    >
      <div className="text-xs font-medium text-muted-foreground/60 mb-1">
        {data.label}
      </div>
    </div>
  )
})
```

- [ ] **Step 3: Integrate group nodes into DagGraph**

In `ui/src/components/graph/DagGraph.tsx`:

1. Register the custom node type:
```typescript
import { GroupNode } from "./GroupNode"

const nodeTypes = {
  graphbook: GraphbookNode,
  group: GroupNode,
}
```

2. In the node-building logic, after creating individual nodes, compute group bounding boxes:

```typescript
// After laying out individual nodes, compute group boxes
const groups = new Map<string, string[]>()
for (const [nodeId, nodeData] of Object.entries(graphData.nodes)) {
  if (nodeData.group) {
    if (!groups.has(nodeData.group)) {
      groups.set(nodeData.group, [])
    }
    groups.get(nodeData.group)!.push(nodeId)
  }
}

const groupNodes: Node[] = []
for (const [groupName, memberIds] of groups) {
  const memberNodes = layoutedNodes.filter(n => memberIds.includes(n.id))
  if (memberNodes.length === 0) continue

  const padding = 24
  const headerHeight = 28
  const minX = Math.min(...memberNodes.map(n => n.position.x)) - padding
  const minY = Math.min(...memberNodes.map(n => n.position.y)) - padding - headerHeight
  const maxX = Math.max(...memberNodes.map(n => n.position.x + (n.measured?.width || 180))) + padding
  const maxY = Math.max(...memberNodes.map(n => n.position.y + (n.measured?.height || 60))) + padding

  groupNodes.push({
    id: `group-${groupName}`,
    type: "group",
    position: { x: minX, y: minY },
    data: {
      label: groupName,
      width: maxX - minX,
      height: maxY - minY,
    },
    style: { zIndex: -1 },
    selectable: false,
    draggable: false,
  })
}
```

3. Merge group nodes with regular nodes:
```typescript
const allNodes = [...groupNodes, ...layoutedNodes]
```

- [ ] **Step 4: Verify in browser**

Start the daemon and UI, run an example with a decorated class. Verify the bounding box appears around class methods in the DAG.

- [ ] **Step 5: Commit**

```bash
git add ui/src/store/index.ts ui/src/components/graph/GroupNode.tsx ui/src/components/graph/DagGraph.tsx
git commit -m "feat: transparent bounding box rendering for decorated class groups in DAG"
```

---

## Task 9: UI — Agent Tracing (Right Panel + Trace Tab)

Add a right-side tabbed container with a Trace tab showing a linear timeline of all events.

**Files:**
- Modify: `ui/src/App.tsx`
- Create: `ui/src/components/layout/RightPanel.tsx`
- Create: `ui/src/components/trace/TraceTab.tsx`
- Modify: `ui/src/store/index.ts`

- [ ] **Step 1: Add right panel state to store**

In `ui/src/store/index.ts`, add:

```typescript
// In the store state
rightPanelTab: "trace" | "chat"
rightPanelOpen: boolean
setRightPanelTab: (tab: "trace" | "chat") => void
toggleRightPanel: () => void

// In the store actions
rightPanelTab: "trace",
rightPanelOpen: false,
setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
```

- [ ] **Step 2: Create TraceTab component**

Create `ui/src/components/trace/TraceTab.tsx`:

```tsx
import { memo, useMemo } from "react"
import { useStore } from "../../store"
import { ScrollArea } from "../ui/scroll-area"

interface TraceEvent {
  type: string
  node: string | null
  message?: string
  timestamp: number
}

export const TraceTab = memo(function TraceTab({ runId }: { runId: string }) {
  const runState = useStore((s) => s.runs.get(runId))

  const events = useMemo(() => {
    if (!runState) return []

    const allEvents: TraceEvent[] = []

    // Collect logs
    for (const log of runState.logs) {
      allEvents.push({
        type: "log",
        node: log.node,
        message: log.message,
        timestamp: log.timestamp,
      })
    }

    // Collect errors
    for (const error of runState.errors) {
      allEvents.push({
        type: "error",
        node: error.node,
        message: error.error || error.message,
        timestamp: error.timestamp,
      })
    }

    // Sort by timestamp
    allEvents.sort((a, b) => a.timestamp - b.timestamp)
    return allEvents
  }, [runState?.logs, runState?.errors])

  if (!runState) {
    return <div className="p-4 text-sm text-muted-foreground">No run selected</div>
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        {events.map((event, i) => (
          <div
            key={i}
            className={`text-xs font-mono p-2 rounded ${
              event.type === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {new Date(event.timestamp * 1000).toLocaleTimeString()}
              </span>
              {event.node && (
                <span className="text-primary/70 font-medium">{event.node}</span>
              )}
            </div>
            {event.message && (
              <div className="mt-0.5 text-foreground">{event.message}</div>
            )}
          </div>
        ))}
        {events.length === 0 && (
          <div className="text-sm text-muted-foreground p-4">No events yet</div>
        )}
      </div>
    </ScrollArea>
  )
})
```

- [ ] **Step 3: Create RightPanel component**

Create `ui/src/components/layout/RightPanel.tsx`:

```tsx
import { memo } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs"
import { TraceTab } from "../trace/TraceTab"
import { useStore } from "../../store"

export const RightPanel = memo(function RightPanel({ runId }: { runId: string }) {
  const tab = useStore((s) => s.rightPanelTab)
  const setTab = useStore((s) => s.setRightPanelTab)

  return (
    <div className="h-full flex flex-col border-l">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "trace" | "chat")} className="flex flex-col h-full">
        <TabsList className="w-full justify-start rounded-none border-b px-2">
          <TabsTrigger value="trace">Trace</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
        </TabsList>
        <TabsContent value="trace" className="flex-1 mt-0 overflow-hidden">
          <TraceTab runId={runId} />
        </TabsContent>
        <TabsContent value="chat" className="flex-1 mt-0 overflow-hidden">
          <div className="p-4 text-sm text-muted-foreground">Chat coming soon</div>
        </TabsContent>
      </Tabs>
    </div>
  )
})
```

- [ ] **Step 4: Update App.tsx layout**

In `ui/src/App.tsx`, add the right panel to the desktop layout:

```tsx
import { RightPanel } from "./components/layout/RightPanel"

// Desktop layout becomes:
<div className="flex h-screen">
  <Sidebar ... />
  <div className="flex-1 overflow-hidden">
    <RunDetailView ... />
  </div>
  {selectedRunId && rightPanelOpen && (
    <div className="w-80 overflow-hidden">
      <RightPanel runId={selectedRunId} />
    </div>
  )}
</div>
```

Add a toggle button in the toolbar or header to show/hide the right panel.

- [ ] **Step 5: Verify in browser**

Start daemon + UI, run an example, open the right panel. Verify the trace tab shows a chronological list of events.

- [ ] **Step 6: Commit**

```bash
git add ui/src/App.tsx ui/src/store/index.ts ui/src/components/layout/RightPanel.tsx ui/src/components/trace/TraceTab.tsx
git commit -m "feat: right-side panel with Trace tab for agent tracing"
```

---

## Task 10: UI — Chat Tab + Q&A Backend

Add the Chat tab in the right panel and the daemon Q&A backend that delegates to Claude Code CLI.

**Files:**
- Create: `ui/src/components/chat/ChatTab.tsx`
- Create: `nebo/server/chat.py`
- Modify: `nebo/server/daemon.py`
- Modify: `ui/src/store/index.ts`
- Modify: `ui/src/components/layout/RightPanel.tsx`
- Create: `tests/test_chat.py`

- [ ] **Step 1: Write the failing test for Q&A backend**

Create `tests/test_chat.py`:

```python
"""Tests for Q&A chat backend."""

import pytest
from unittest.mock import patch, MagicMock


def test_build_claude_command():
    """Should build correct claude CLI command with MCP config."""
    from nebo.server.chat import build_claude_command

    cmd = build_claude_command(
        question="How did my training go?",
        run_id="run-123",
        server_url="http://localhost:2048",
    )

    assert "claude" in cmd[0]
    assert any("How did my training go?" in arg for arg in cmd)


def test_chat_formats_mcp_config():
    """MCP config should point back to the daemon."""
    from nebo.server.chat import build_mcp_config

    config = build_mcp_config("http://localhost:2048")
    assert "nebo" in str(config).lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_chat.py -v`
Expected: FAIL — `nebo.server.chat` doesn't exist.

- [ ] **Step 3: Implement Q&A backend**

Create `nebo/server/chat.py`:

```python
"""Q&A backend — delegates to Claude Code CLI subprocess."""

from __future__ import annotations

import asyncio
import json
import subprocess
import shutil
from typing import AsyncIterator, Optional


def build_mcp_config(server_url: str) -> dict:
    """Build MCP config that points Claude Code back to the nebo daemon."""
    return {
        "mcpServers": {
            "nebo": {
                "command": shutil.which("python3") or "python3",
                "args": ["-m", "nebo.mcp.stdio", "--port", server_url.split(":")[-1]],
            }
        }
    }


def build_claude_command(
    question: str,
    run_id: str,
    server_url: str,
) -> list[str]:
    """Build the claude CLI command for Q&A."""
    claude_path = shutil.which("claude")
    if not claude_path:
        raise FileNotFoundError("Claude Code CLI not found. Install it to use Q&A.")

    system_prompt = (
        f"You are analyzing a nebo run (run_id: {run_id}). "
        "Use the nebo MCP tools to inspect the run's graph, logs, metrics, and errors. "
        "Answer the user's question based on what you find."
    )

    return [
        claude_path,
        "--print",
        "--system-prompt", system_prompt,
        "--mcp-config", json.dumps(build_mcp_config(server_url)),
        question,
    ]


async def stream_chat_response(
    question: str,
    run_id: str,
    server_url: str,
) -> AsyncIterator[str]:
    """Spawn claude CLI and stream its response."""
    cmd = build_claude_command(question, run_id, server_url)

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    if process.stdout:
        async for line in process.stdout:
            yield line.decode("utf-8", errors="replace")

    await process.wait()

    if process.returncode != 0 and process.stderr:
        stderr = await process.stderr.read()
        yield f"\n[Error: Claude CLI exited with code {process.returncode}]\n"
```

- [ ] **Step 4: Add /chat endpoint to daemon**

In `nebo/server/daemon.py`, add:

```python
from starlette.responses import StreamingResponse

@app.post("/chat")
async def chat(request: Request):
    body = await request.json()
    question = body.get("question", "")
    run_id = body.get("run_id") or daemon_state.active_run_id

    if not run_id:
        return {"error": "No run specified"}
    if not question:
        return {"error": "No question provided"}

    from nebo.server.chat import stream_chat_response

    server_url = f"http://localhost:{request.url.port or 2048}"

    async def generate():
        async for chunk in stream_chat_response(question, run_id, server_url):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

- [ ] **Step 5: Add chat state to store**

In `ui/src/store/index.ts`, add:

```typescript
interface ChatMessage {
  role: "user" | "assistant"
  content: string
  timestamp: number
}

// In RunState:
chatMessages: ChatMessage[]

// In store actions:
sendChatMessage: (runId: string, question: string) => Promise<void>
```

Implement `sendChatMessage`:
```typescript
sendChatMessage: async (runId, question) => {
  set((state) => {
    const run = state.runs.get(runId)
    if (run) {
      run.chatMessages.push({
        role: "user",
        content: question,
        timestamp: Date.now() / 1000,
      })
    }
  })

  const response = await fetch(`/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, run_id: runId }),
  })

  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let fullResponse = ""

  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value)
      const lines = text.split("\n")
      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          const data = JSON.parse(line.slice(6))
          fullResponse += data.text
        }
      }
    }
  }

  set((state) => {
    const run = state.runs.get(runId)
    if (run) {
      run.chatMessages.push({
        role: "assistant",
        content: fullResponse,
        timestamp: Date.now() / 1000,
      })
    }
  })
}
```

- [ ] **Step 6: Create ChatTab component**

Create `ui/src/components/chat/ChatTab.tsx`:

```tsx
import { memo, useState, useRef, useEffect } from "react"
import { useStore } from "../../store"
import { ScrollArea } from "../ui/scroll-area"
import ReactMarkdown from "react-markdown"

export const ChatTab = memo(function ChatTab({ runId }: { runId: string }) {
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const messages = useStore((s) => s.runs.get(runId)?.chatMessages || [])
  const sendMessage = useStore((s) => s.sendChatMessage)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return
    const question = input.trim()
    setInput("")
    setLoading(true)
    try {
      await sendMessage(runId, question)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`text-sm rounded-lg p-3 ${
                msg.role === "user"
                  ? "bg-primary/10 ml-8"
                  : "bg-muted mr-8"
              }`}
            >
              {msg.role === "assistant" ? (
                <ReactMarkdown className="prose prose-sm dark:prose-invert max-w-none">
                  {msg.content}
                </ReactMarkdown>
              ) : (
                msg.content
              )}
            </div>
          ))}
          {loading && (
            <div className="text-sm text-muted-foreground p-3">Thinking...</div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>
      <form onSubmit={handleSubmit} className="border-t p-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this run..."
            className="flex-1 text-sm bg-muted rounded-md px-3 py-2 outline-none"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="text-sm px-3 py-2 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  )
})
```

- [ ] **Step 7: Update RightPanel to include ChatTab**

In `ui/src/components/layout/RightPanel.tsx`, replace the placeholder:

```tsx
import { ChatTab } from "../chat/ChatTab"

// Replace the placeholder TabsContent for "chat":
<TabsContent value="chat" className="flex-1 mt-0 overflow-hidden">
  <ChatTab runId={runId} />
</TabsContent>
```

- [ ] **Step 8: Run tests**

Run: `pytest tests/test_chat.py -v`
Expected: All tests pass.

- [ ] **Step 9: Verify in browser**

Start daemon + UI, run an example, open Chat tab, ask a question. Verify it streams a response (requires Claude Code CLI installed).

- [ ] **Step 10: Commit**

```bash
git add nebo/server/chat.py nebo/server/daemon.py ui/src/components/chat/ChatTab.tsx ui/src/components/layout/RightPanel.tsx ui/src/store/index.ts tests/test_chat.py
git commit -m "feat: Q&A chat via Claude Code CLI with streaming responses"
```

---

## Task 11: New MCP Tools

Add `nebo_load_file` and `nebo_chat` tools to the MCP interface.

**Files:**
- Modify: `nebo/mcp/server.py`
- Modify: `nebo/mcp/tools.py`
- Modify: `tests/test_mcp_tools.py`

- [ ] **Step 1: Write the failing tests**

In `tests/test_mcp_tools.py`, add:

```python
def test_load_file_tool_exists():
    from nebo.mcp.server import MCP_TOOLS
    names = [t["name"] for t in MCP_TOOLS]
    assert "nebo_load_file" in names


def test_chat_tool_exists():
    from nebo.mcp.server import MCP_TOOLS
    names = [t["name"] for t in MCP_TOOLS]
    assert "nebo_chat" in names


@pytest.mark.asyncio
async def test_handle_load_file_tool():
    from nebo.mcp.server import handle_tool_call
    result = await handle_tool_call(
        "nebo_load_file",
        {"filepath": "/nonexistent/file.nebo"},
        "http://localhost:2048",
    )
    assert "error" in result or "status" in result
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_mcp_tools.py -v -k "load_file or chat_tool"`
Expected: FAIL — tools don't exist.

- [ ] **Step 3: Add tool definitions to server.py**

In `nebo/mcp/server.py`, add to `MCP_TOOLS`:

```python
{
    "name": "nebo_load_file",
    "description": "Load a .nebo log file into the daemon for viewing and Q&A. The file will appear as a historical run.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "filepath": {
                "type": "string",
                "description": "Absolute path to the .nebo file"
            }
        },
        "required": ["filepath"]
    }
},
{
    "name": "nebo_chat",
    "description": "Ask a question about a run. Uses the run's logs, metrics, graph, and errors to generate an answer.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "The question to ask about the run"
            },
            "run_id": {
                "type": "string",
                "description": "The run ID to query. If omitted, uses the active run."
            }
        },
        "required": ["question"]
    }
},
```

- [ ] **Step 4: Add tool implementations to tools.py**

In `nebo/mcp/tools.py`, add:

```python
async def load_file(filepath: str, server_url: str) -> dict:
    """Load a .nebo file into the daemon."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{server_url}/load",
            json={"filepath": filepath},
            timeout=30.0,
        )
        return resp.json()


async def chat(question: str, run_id: Optional[str] = None, server_url: str = "") -> dict:
    """Ask a question about a run via the daemon's Q&A endpoint."""
    async with httpx.AsyncClient() as client:
        payload = {"question": question}
        if run_id:
            payload["run_id"] = run_id
        resp = await client.post(
            f"{server_url}/chat",
            json=payload,
            timeout=120.0,
        )
        # For MCP, we collect the full streamed response
        full_text = ""
        async for line in resp.aiter_lines():
            if line.startswith("data: ") and line != "data: [DONE]":
                import json
                data = json.loads(line[6:])
                full_text += data.get("text", "")
        return {"answer": full_text}
```

- [ ] **Step 5: Add dispatch in handle_tool_call**

In `nebo/mcp/server.py`, add to `handle_tool_call()`:

```python
elif name == "nebo_load_file":
    return await tools.load_file(args["filepath"], server_url)
elif name == "nebo_chat":
    return await tools.chat(
        args["question"],
        run_id=args.get("run_id"),
        server_url=server_url,
    )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_mcp_tools.py -v`
Expected: All tests pass.

- [ ] **Step 7: Run full test suite**

Run: `pytest tests/ -v`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add nebo/mcp/server.py nebo/mcp/tools.py tests/test_mcp_tools.py
git commit -m "feat: add nebo_load_file and nebo_chat MCP tools"
```

---

## Task 12: Update Examples and Documentation

Update all examples to use the new `nebo` namespace and API. Update `nebo/README.md` with the current API.

**Files:**
- Modify: All files in `examples/`
- Modify: `nebo/README.md`

- [ ] **Step 1: Update example files**

For each example file, update:
- `import graphbook.beta as gb` → `import nebo as nb`
- All `gb.` calls → `nb.` calls
- File names: consider renaming `beta_*` → remove `beta_` prefix

Example for `examples/beta_basic_pipeline.py` → `examples/basic_pipeline.py`:

```python
"""Basic pipeline example showing @nb.fn(), nb.log(), and nb.track()."""

import nebo as nb

@nb.fn()
def load_data():
    nb.log("Loading dataset...")
    data = list(range(100))
    nb.log(f"Loaded {len(data)} items")
    return data

# ... rest of example with nb.* calls
```

- [ ] **Step 2: Update nebo/README.md**

Update `nebo/README.md` with:
- New import syntax: `import nebo as nb`
- All API functions with examples
- New features: class decoration, `nb.ui()`, `.nebo` file format, Q&A
- CLI commands with `nb` prefix

- [ ] **Step 3: Run examples to verify**

Run: `python examples/basic_pipeline.py`
Expected: Runs without errors.

- [ ] **Step 4: Commit**

```bash
git add examples/ nebo/README.md
git commit -m "docs: update examples and README for nebo namespace and new features"
```

---

## Task 13: Final Integration Test

Run all tests, verify examples work end-to-end, and ensure the UI builds.

**Files:** None (verification only)

- [ ] **Step 1: Run full Python test suite**

Run: `pytest tests/ -v`
Expected: All tests pass.

- [ ] **Step 2: Build the UI**

Run: `cd ui && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: End-to-end smoke test**

1. Start daemon: `nb serve`
2. Run example: `nb run examples/basic_pipeline.py`
3. Verify UI shows the run at `http://localhost:2048`
4. Open right panel, verify trace tab
5. Stop daemon: `nb stop`

- [ ] **Step 4: Test file loading**

1. Start daemon: `nb serve`
2. Run example to create a .nebo file: `nb run examples/basic_pipeline.py`
3. Find the .nebo file: `ls .nebo/`
4. Load it: `nb load .nebo/<filename>.nebo`
5. Verify it appears as a run in the UI

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test fixes"
```
