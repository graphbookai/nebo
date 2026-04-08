"""The @fn decorator for nebo."""

from __future__ import annotations

import functools
import inspect
import time
import traceback
import warnings
from typing import Any, Callable, Optional, TypeVar, overload

from nebo.core.state import _current_node, _current_group, get_state

F = TypeVar("F", bound=Callable[..., Any])


@overload
def fn(func: F) -> F: ...


@overload
def fn(
    depends_on: Optional[list[Any]] = None,
    pausable: bool = False,
    ui: Optional[dict] = None,
) -> Callable[[F], F]: ...


def fn(
    func: Optional[Any] = None,
    depends_on: Optional[list[Any]] = None,
    pausable: bool = False,
    ui: Optional[dict] = None,
) -> Any:
    """Decorator that registers a function or class as a DAG node.

    The node materializes (appears in the graph) as soon as the
    decorated function is executed for the first time — a call to
    ``nb.log*`` is **not** required. This keeps dependency chains
    intact when an intermediate function only orchestrates calls to
    other nodes without logging anything itself.

    Can be used as::

        @nb.fn
        @nb.fn()
        @nb.fn(depends_on=[other_fn])
        @nb.fn(pausable=True)

    When applied to a class, all methods are wrapped with scope tracking
    and the class name becomes a visual group container.

    DAG edges are inferred automatically from data flow between
    **sibling** nodes (nodes sharing the same parent/caller). An object
    creates one edge per hop—if node X produces a value that flows
    through node Y to node A, the edges are X->Y and Y->A, never X->A.
    When no sibling data-flow is detected, a parent edge is used.

    For dependencies that cannot be detected automatically (shared mutable
    state, class attributes, globals), use ``depends_on``::

        @nb.fn(depends_on=[foo])
        def bar(self):
            # bar depends on foo via shared state, not via arguments
            ...

    Args:
        func: The function or class to decorate (when used without parentheses).
        depends_on: Optional list of decorated functions or node ID strings
            that this node depends on. Creates explicit edges.
        pausable: If True, the function will block before execution when
            the web client sends a pause event. Default is False.

    Returns:
        The decorated function or class.
    """
    def decorator(f):
        if inspect.isclass(f):
            return _decorate_class(f, depends_on, pausable)
        return _decorate_function(f, depends_on, pausable, ui_hints=ui)

    # Handle @fn, @fn()
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
    class_name = cls.__name__

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

    if depends_on:
        cls._nb_depends_on = depends_on

    return cls


def _decorate_function(f, depends_on, pausable, group=None, ui_hints=None):
    """Wrap a single function with scope tracking."""
    # Use ClassName.method_name for methods in decorated classes
    if group:
        node_id = f"{group}.{f.__name__}"
    else:
        node_id = f.__qualname__
    registered = False

    # Resolve depends_on to node ID strings at decoration time
    depends_on_ids: list[str] = []
    if depends_on:
        for dep in depends_on:
            if callable(dep):
                depends_on_ids.append(dep.__qualname__)
            else:
                depends_on_ids.append(str(dep))

    @functools.wraps(f)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        nonlocal registered
        # Auto-init on first execution
        try:
            from nebo import _ensure_init
            _ensure_init()
        except ImportError:
            pass
        state = get_state()

        # Determine group: use explicit group, or inherit from _current_group
        effective_group = group or _current_group.get()

        # Register node on first execution (not at import time)
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
        elif effective_group:
            # Update group if this function is being called within a class context
            node = state.nodes.get(node_id)
            if node and node.group is None:
                node.group = effective_group

        # Materialize the node as soon as the wrapper starts executing, so
        # decorated functions that never call nb.log* still appear in the
        # graph and act as real links in dependency chains.
        state.ensure_node(node_id)

        state.ensure_display()
        parent = _current_node.get()
        token = _current_node.set(node_id)

        # Set group context if this function defines a group
        group_token = None
        if group:
            group_token = _current_group.set(group)

        try:
            # Record DAG edges (data-flow-aware)
            # 1. Explicit depends_on edges (always added)
            if depends_on_ids:
                for dep in depends_on_ids:
                    state.add_edge(dep, node_id)

            # Record this node's parent for sibling filtering
            state._node_parents[node_id] = parent
            strategy = state.dag_strategy

            # 2. Strategy-dependent edge inference
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
            else:  # "object" (default)
                producers = state.find_producers(args, kwargs, parent)
                if producers:
                    for producer in producers:
                        state.add_edge(producer, node_id)
                elif parent is not None and not depends_on_ids:
                    state.add_edge(parent, node_id)

            # Notify backends
            node_info = state.nodes.get(node_id)
            params = node_info.params if node_info else {}
            for backend in state.backends:
                try:
                    backend.on_node_start(node_id, params)
                except Exception:
                    pass

            # Block if paused (only for pausable functions)
            if pausable:
                state.wait_if_paused()

            state.increment_count(node_id)
            start_time = time.monotonic()
            result = f(*args, **kwargs)
            duration = time.monotonic() - start_time

            # Track return value for data-flow edge inference
            state.track_return(node_id, result)

            # Notify backends of completion
            for backend in state.backends:
                try:
                    backend.on_node_end(node_id, duration)
                except Exception:
                    pass

            return result
        except Exception as exc:
            # Capture exception with context
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

            # Send to queue if available
            if state._queue is not None:
                try:
                    state._queue.put_event({
                        "type": "error",
                        "data": error_info,
                    })
                except Exception:
                    pass

            raise  # Re-raise original exception
        finally:
            _current_node.reset(token)
            if group_token is not None:
                _current_group.reset(group_token)

    wrapper._nb_decorated = True
    wrapper._nb_original = f
    return wrapper  # type: ignore
