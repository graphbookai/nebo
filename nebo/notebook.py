"""Notebook rendering helpers.

In a Jupyter / IPython context, ``nb.show()`` returns an object that renders
as an inline ``<iframe>`` pointing at the running nebo daemon. The iframe
drives the same query-param view scheme used elsewhere
(``?view=<kind>&run=<id>...``).
"""

from __future__ import annotations

from html import escape
from typing import Optional, Union

from nebo.core.state import get_state


_VALID_VIEWS = frozenset({"run", "nodes", "node", "logs", "metrics", "images", "audio"})


class _ShowHandle:
    """Renderable returned by :func:`show`. Has a ``_repr_html_`` that emits
    the iframe; in a non-notebook context, ``str()`` shows the URL."""

    def __init__(self, url: Optional[str], width: Union[str, int], height: Union[str, int],
                 hint: Optional[str] = None) -> None:
        self.url = url
        self.width = width
        self.height = height
        self.hint = hint

    def __repr__(self) -> str:
        if self.hint:
            return f"<nebo.show: {self.hint}>"
        return f"<nebo.show: {self.url}>"

    def _repr_html_(self) -> str:
        if not self.url:
            return f'<div style="color: #888; font-size: 13px;">{escape(self.hint or "nebo: nothing to show")}</div>'
        w = self.width if isinstance(self.width, str) else f"{self.width}px"
        h = self.height if isinstance(self.height, str) else f"{self.height}px"
        return (
            f'<iframe src="{escape(self.url)}" '
            f'width="{escape(str(w))}" height="{escape(str(h))}" '
            f'style="border: 1px solid #2a2a2a; border-radius: 6px;" '
            f'sandbox="allow-scripts allow-same-origin"></iframe>'
        )


def show(
    view: str = "run",
    *,
    run: Optional[str] = None,
    node: Optional[str] = None,
    name: Optional[str] = None,
    width: Union[str, int] = "100%",
    height: Union[str, int] = 600,
) -> _ShowHandle:
    """Return a Jupyter-renderable iframe of the daemon UI.

    Args:
        view: One of ``"run"``, ``"nodes"``, ``"node"``, ``"logs"``,
            ``"metrics"``, ``"images"``, ``"audio"``. ``"run"`` (default)
            shows the full run with no sidebar.
        run: Run ID to embed. Defaults to the currently active run.
        node: Node ID or function name. Used by ``view="node"`` to pick a
            single node card; optional filter for ``logs``/``metrics``/
            ``images``/``audio``.
        name: Item name (metric/image/audio). Used as a filter when ``view``
            is ``metrics``, ``images``, or ``audio``.
        width, height: iframe dimensions. Strings (``"100%"``) or ints (px).

    Returns:
        A handle with ``_repr_html_`` for inline notebook display.
    """
    if view not in _VALID_VIEWS:
        raise ValueError(f"view must be one of {sorted(_VALID_VIEWS)}; got {view!r}")

    state = get_state()
    run_id = run or state._active_run_id
    if run_id is None:
        return _ShowHandle(
            url=None,
            width=width,
            height=height,
            hint="No active run. Call nb.init() and start a run before nb.show().",
        )

    host = "localhost"  # daemon is local-only for the notebook renderer
    port = state.port
    base = f"http://{host}:{port}/"

    # Build query string in a fixed order so the URL is stable across calls.
    parts: list[str] = [f"view={view}", f"run={run_id}"]
    if node is not None:
        parts.append(f"node={node}")
    if name is not None:
        parts.append(f"name={name}")
    url = base + "?" + "&".join(parts)
    return _ShowHandle(url=url, width=width, height=height)
