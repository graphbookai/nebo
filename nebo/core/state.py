"""Global session state for nebo."""

from __future__ import annotations

import threading
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class NodeInfo:
    """Information about a registered node."""

    name: str
    func_name: str
    docstring: Optional[str] = None
    exec_count: int = 0
    is_source: bool = True  # starts as True, set to False when it receives an edge
    pausable: bool = False
    params: dict = field(default_factory=dict)
    logs: list = field(default_factory=list)
    metrics: dict = field(default_factory=lambda: {})  # name -> [(step, value)]
    errors: list = field(default_factory=list)
    images: list = field(default_factory=list)
    audio: list = field(default_factory=list)
    progress: Optional[dict] = None  # {current, total, name}
    materialized: bool = False
    group: Optional[str] = None  # Class name if method is in a decorated class
    ui_hints: Optional[dict] = None  # Per-node UI display hints


@dataclass
class DAGEdge:
    """An edge in the DAG."""

    source: str
    target: str


@dataclass
class _RunSnapshot:
    """Snapshot of per-run state fields for save/restore across runs."""
    nodes: dict
    edges: list
    edge_set: set
    return_origins: dict
    node_parents: dict
    workflow_description: Optional[str]
    ui_config: Optional[dict]
    has_pausable: bool


class SessionState:
    """Global singleton managing all nebo state."""

    _instance: Optional[SessionState] = None
    _lock = threading.Lock()

    def __new__(cls) -> SessionState:
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        self._initialized = True
        self.nodes: dict[str, NodeInfo] = {}
        self.edges: list[DAGEdge] = []
        self._edge_set: set[tuple[str, str]] = set()
        self.workflow_description: Optional[str] = None
        self.port: int = 2048
        self.server_process: Any = None
        self._display: Any = None
        self._initialized_display: bool = False
        self._initialized_server: bool = False
        self._client: Any = None  # DaemonClient when in server mode
        self._mode: str = "local"  # "local" or "server"
        self._return_origins: dict[int, tuple[str, Any]] = {}  # id(value) -> (producing node_id, value ref)
        self._node_parents: dict[str, Optional[str]] = {}  # node_id -> parent node_id
        self.dag_strategy: str = "object"
        self._lock_state = threading.Lock()
        # Pause support: Event is set (unblocked) by default; cleared when paused
        self._pause_event = threading.Event()
        self._pause_event.set()  # starts unpaused
        self._has_pausable = False
        self.ui_config: Optional[dict] = None  # Run-level UI defaults
        # Multi-run support
        self._run_snapshots: dict[str, _RunSnapshot] = {}
        self._active_run_id: Optional[str] = None

    def ensure_display(self) -> None:
        """Ensure the terminal display is created and started."""
        if self._initialized_display:
            return
        if self._display is not None:
            self._display.start()
            self._initialized_display = True

    def _send_to_client(self, event: dict) -> None:
        """Forward an event to the DaemonClient if connected."""
        if self._client is not None:
            try:
                self._client.send_event(event)
            except Exception:
                pass

    def register_node(
        self,
        node_id: str,
        func_name: str,
        docstring: Optional[str] = None,
        pausable: bool = False,
        group: Optional[str] = None,
        ui_hints: Optional[dict] = None,
    ) -> NodeInfo:
        """Register a new node locally but do NOT send node_register event.

        The node stays unmaterialized until ensure_node() is called
        (triggered by the first log/metric/image/audio/text call).
        """
        with self._lock_state:
            if node_id not in self.nodes:
                self.nodes[node_id] = NodeInfo(
                    name=node_id,
                    func_name=func_name,
                    docstring=docstring,
                    pausable=pausable,
                    group=group,
                    ui_hints=ui_hints,
                )
                if pausable:
                    self._has_pausable = True
            elif group is not None and self.nodes[node_id].group is None:
                self.nodes[node_id].group = group
        return self.nodes[node_id]

    def ensure_node(self, node_id: str) -> None:
        """Materialize a node and emit its ``node_register`` event.

        Called by the ``@nb.fn`` wrapper as soon as a decorated function
        starts executing, so every executed node appears in the graph
        regardless of whether it calls a log function. Also called
        defensively by the log/metric/image/audio/text paths so that
        logging from an already-executing node is a no-op on the
        already-materialized node (idempotent).
        """
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

    def wait_if_paused(self) -> None:
        """Block until unpaused. Used by pausable @fn nodes.

        Unblocks when:
        - An unpause (play) event is received
        - A KeyboardInterrupt occurs
        - The program is killed
        """
        self._pause_event.wait()

    def set_paused(self, paused: bool) -> None:
        """Set the pause state."""
        if paused:
            self._pause_event.clear()
        else:
            self._pause_event.set()

    def add_edge(self, source: str, target: str) -> None:
        """Add a DAG edge. Marks target as non-source."""
        added = False
        with self._lock_state:
            key = (source, target)
            if key not in self._edge_set:
                self._edge_set.add(key)
                self.edges.append(DAGEdge(source=source, target=target))
                if target in self.nodes:
                    self.nodes[target].is_source = False
                added = True
        if added:
            self._send_to_client({
                "type": "edge",
                "data": {"source": source, "target": target},
            })

    def track_return(self, node_id: str, value: Any) -> None:
        """Record that a return value was produced by a given node.

        Tracks id(value) and, for tuples/lists/dicts, also tracks
        id(element) for each element one level deep. Skips None.

        Stores (node_id, value_ref) so find_producers can verify identity
        and avoid false matches from id() reuse after garbage collection.
        """
        if value is None:
            return
        with self._lock_state:
            self._return_origins[id(value)] = (node_id, value)
            if isinstance(value, (tuple, list)):
                for item in value:
                    if item is not None:
                        self._return_origins[id(item)] = (node_id, item)
            elif isinstance(value, dict):
                for v in value.values():
                    if v is not None:
                        self._return_origins[id(v)] = (node_id, v)

    def find_producers(
        self, args: tuple, kwargs: dict, parent: Optional[str] = None,
    ) -> set[str]:
        """Find which sibling steps produced the given arguments.

        Checks id() of each arg/kwarg against _return_origins, then verifies
        with an identity check (``is``) to guard against id() reuse after
        garbage collection.

        Only returns producers that are **siblings** of the current node
        (share the same *parent*).  This ensures data-flow edges are short:
        an object creates one edge per hop and does not skip levels.

        Returns:
            Set of node_id strings for sibling steps that produced any
            of the arguments.
        """
        producers: set[str] = set()
        with self._lock_state:
            for arg in args:
                entry = self._return_origins.get(id(arg))
                if entry is not None and entry[1] is arg:
                    producer_id = entry[0]
                    # Only include if producer is a sibling (same parent)
                    if self._node_parents.get(producer_id) == parent:
                        producers.add(producer_id)
            for v in kwargs.values():
                entry = self._return_origins.get(id(v))
                if entry is not None and entry[1] is v:
                    producer_id = entry[0]
                    if self._node_parents.get(producer_id) == parent:
                        producers.add(producer_id)
        return producers

    def increment_count(self, node_id: str) -> None:
        """Increment the execution count for a node."""
        with self._lock_state:
            if node_id in self.nodes:
                self.nodes[node_id].exec_count += 1
        self._send_to_client({
            "type": "node_executed",
            "node": node_id,
            "data": {"node_id": node_id},
        })

    def get_sources(self) -> list[str]:
        """Return all nodes with in-degree 0."""
        return [nid for nid, n in self.nodes.items() if n.is_source]

    def get_graph_dict(self) -> dict:
        """Return the graph as a serializable dictionary."""
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
                    "ui_hints": n.ui_hints,
                }
                for nid, n in self.nodes.items()
                if n.materialized
            },
            "edges": [{"source": e.source, "target": e.target} for e in self.edges],
            "workflow_description": self.workflow_description,
        }

    def save_run_state(self, run_id: str) -> None:
        """Snapshot current per-run fields into _run_snapshots[run_id]."""
        with self._lock_state:
            self._run_snapshots[run_id] = _RunSnapshot(
                nodes=dict(self.nodes),
                edges=list(self.edges),
                edge_set=set(self._edge_set),
                return_origins=dict(self._return_origins),
                node_parents=dict(self._node_parents),
                workflow_description=self.workflow_description,
                ui_config=self.ui_config,
                has_pausable=self._has_pausable,
            )

    def restore_run_state(self, run_id: str) -> None:
        """Restore per-run fields from a snapshot."""
        snap = self._run_snapshots.get(run_id)
        if snap is None:
            self.clear_run_state()
            return
        with self._lock_state:
            self.nodes = dict(snap.nodes)
            self.edges = list(snap.edges)
            self._edge_set = set(snap.edge_set)
            self._return_origins = dict(snap.return_origins)
            self._node_parents = dict(snap.node_parents)
            self.workflow_description = snap.workflow_description
            self.ui_config = snap.ui_config
            self._has_pausable = snap.has_pausable

    def clear_run_state(self) -> None:
        """Reset per-run fields to empty (for new runs)."""
        with self._lock_state:
            self.nodes.clear()
            self.edges.clear()
            self._edge_set.clear()
            self._return_origins.clear()
            self._node_parents.clear()
            self.workflow_description = None
            self.ui_config = None
            self._has_pausable = False

    def reset(self) -> None:
        """Reset all state. Primarily for testing."""
        with self._lock_state:
            self.nodes.clear()
            self.edges.clear()
            self._edge_set.clear()
            self._return_origins.clear()
            self._node_parents.clear()
            self.dag_strategy = "object"
            self.workflow_description = None
            self._initialized_server = False
            self._client = None
            self._mode = "local"
            self._pause_event.set()
            self._has_pausable = False
            self.ui_config = None
            self._run_snapshots.clear()
            self._active_run_id = None

    @classmethod
    def reset_singleton(cls) -> None:
        """Completely reset the singleton. For testing only."""
        with cls._lock:
            if cls._instance is not None:
                cls._instance.reset()
                cls._instance._initialized = False
                cls._instance = None


# ContextVar for tracking current executing node
_current_node: ContextVar[Optional[str]] = ContextVar("current_node", default=None)

# ContextVar for tracking current class group context
_current_group: ContextVar[Optional[str]] = ContextVar("current_group", default=None)


def get_state() -> SessionState:
    """Get the global session state."""
    return SessionState()
