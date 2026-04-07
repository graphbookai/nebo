.. _API Reference:

API Reference
#############

This is the complete API reference for the ``nebo`` package.


Module: ``nebo``
=================

The top-level module provides all the public functions you need. Import it as:

.. code-block:: python

    import nebo as nb


Decorators
----------

.. function:: nb.fn(func=None, depends_on=None, pausable=False, ui=None)

    Register a function or class for observability. When applied to a function, it sets up scope tracking — a node materializes only when the function calls a log function. When applied to a class, all methods are wrapped with scope tracking and the class becomes a visual grouping container in the DAG.

    :param func: The function or class to decorate (when used without parentheses).
    :param depends_on: Optional list of decorated functions or node ID strings that this node depends on.
    :param pausable: If True, the function blocks before execution when paused via the web UI.
    :param ui: Optional dict of per-node UI display hints (e.g., ``{"collapsed": True}``).
    :returns: The decorated function or class (unchanged behavior, with observability added).

    Usage forms:

    .. code-block:: python

        @nb.fn                          # bare decorator
        @nb.fn()                        # with empty parentheses
        @nb.fn(depends_on=[setup])      # with explicit dependencies
        @nb.fn(ui={"collapsed": True})  # with per-node UI hints

    **On functions:** The node ID is derived from the function's ``__qualname__``. The function's docstring becomes the node's description. The node only materializes (becomes visible) when the function calls a log function.

    **On classes:** All methods are wrapped. The class itself is never a node — it is a transparent bounding box in the DAG. Methods that never log are invisible.


Logging Functions
-----------------

.. function:: nb.log(message: str | Any, *, step: int | None = None) -> None

    Log a text message to the current node. Tensor-like objects (NumPy arrays, PyTorch tensors) are auto-formatted with shape, dtype, and statistics.

    :param message: The message string or tensor-like object.
    :param step: Optional step counter.

.. function:: nb.log_metric(name: str, value: float, step: int | None = None) -> None

    Log a scalar metric value. If ``step`` is not provided, it auto-increments per metric name within the current node.

    :param name: The metric name (e.g., ``"loss"``, ``"accuracy"``).
    :param value: The scalar value.
    :param step: Optional step counter.

.. function:: nb.log_image(image: Any, *, name: str | None = None, step: int | None = None) -> None

    Log an image. Accepts PIL images, NumPy arrays (HWC or CHW), or PyTorch tensors.

    :param image: The image data.
    :param name: Optional image name/label.
    :param step: Optional step counter.

.. function:: nb.log_audio(audio: Any, sr: int = 16000, *, name: str | None = None, step: int | None = None) -> None

    Log audio data.

    :param audio: Audio data as a NumPy array.
    :param sr: Sample rate (default: 16000).
    :param name: Optional audio clip name.
    :param step: Optional step counter.

.. function:: nb.log_text(name: str, text: str) -> None

    Log rich text or Markdown content.

    :param name: The text name/label.
    :param text: The text/Markdown content.

.. function:: nb.log_cfg(cfg: dict[str, Any]) -> None

    Log configuration for the current node. Merges *cfg* into the node's ``params`` dict so the Info tab displays all configuration in one place.

    :param cfg: A flat or nested dictionary of configuration values. Only JSON-serializable values are retained.

    Multiple calls within the same node merge dictionaries (later calls win on key conflicts).


Progress Tracking
-----------------

.. function:: nb.track(iterable: Iterable[T], name: str | None = None, total: int | None = None) -> TrackedIterable[T]

    Wrap an iterable for tqdm-like progress tracking. The progress is reported to the terminal dashboard, daemon, and web UI.

    :param iterable: The iterable to wrap.
    :param name: Display name for the progress bar.
    :param total: Total number of items. Auto-detected from ``__len__`` if available.
    :returns: A ``TrackedIterable`` that yields items and reports progress.


Workflow Description
--------------------

.. function:: nb.md(description: str) -> None

    Set or append to the workflow-level Markdown description. Distinct from node docstrings — this describes the overall workflow.

    :param description: Markdown description text.


UI Configuration
-----------------

.. function:: nb.ui(layout: str | None = None, view: str | None = None, collapsed: bool | None = None, minimap: bool | None = None, theme: str | None = None) -> None

    Set run-level UI defaults. These are sent to the daemon and web UI as defaults that the user can override.

    :param layout: DAG layout direction: ``"horizontal"`` or ``"vertical"``.
    :param view: Default view mode: ``"dag"`` or ``"grid"``.
    :param collapsed: Default node collapse state.
    :param minimap: Whether to show the minimap.
    :param theme: Color theme: ``"dark"`` or ``"light"``.

    Calling ``nb.ui()`` again overwrites the previous defaults.


Initialization
--------------

.. function:: nb.init(port: int = 2048, host: str = "localhost", mode: str = "auto", backends: list | None = None, terminal: bool = True, dag_strategy: str = "object", flush_interval: float = 0.1, store: bool = True) -> None

    Explicitly initialize nebo.

    :param port: Daemon server port (default: 2048).
    :param host: Daemon server host (default: ``"localhost"``).
    :param mode: ``"auto"``, ``"server"``, or ``"local"``.
    :param backends: Optional list of ``LoggingBackend`` instances.
    :param terminal: Whether to show the Rich terminal display in local mode.
    :param dag_strategy: How DAG edges are inferred: ``"object"`` (default), ``"stack"``, ``"both"``, or ``"none"``.
    :param flush_interval: Seconds between event flushes (default: 0.1).
    :param store: Whether the daemon should persist this run to a ``.nebo`` file (default: True).

    Mode detection (when ``mode="auto"``):

    1. Check ``NEBO_MODE`` and ``NEBO_SERVER_PORT`` environment variables.
    2. Try connecting to the daemon at ``host:port``.
    3. If found, use server mode. If not, use local mode.

    .. note::

        You rarely need to call ``init()`` explicitly. When using ``nb run``, the SDK auto-initializes from environment variables on the first ``@fn`` execution.


Human-in-the-Loop
------------------

.. function:: nb.ask(question: str, options: list[str] | None = None, timeout: float | None = None) -> str

    Ask the user a question. In server mode, the question appears in the web UI. In local mode, falls back to a Rich terminal prompt.

    :param question: The question to ask.
    :param options: Optional list of valid response choices.
    :param timeout: Optional timeout in seconds.
    :returns: The user's response string.


State Access
------------

.. function:: nb.get_state() -> SessionState

    Get the global session state singleton. Advanced usage — most users won't need this.

    :returns: The ``SessionState`` instance containing all nodes, edges, and backends.


Protocol: ``LoggingBackend``
----------------------------

.. class:: LoggingBackend

    Protocol for custom logging backend extensions. Implement all methods to route events to external systems.

    .. method:: on_log(node: str, message: str, timestamp: float) -> None
    .. method:: on_metric(node: str, name: str, value: float, step: int) -> None
    .. method:: on_image(node: str, name: str, image_bytes: bytes, step: int) -> None
    .. method:: on_audio(node: str, name: str, audio_bytes: bytes, sr: int) -> None
    .. method:: on_node_start(node: str, params: dict) -> None
    .. method:: on_node_end(node: str, duration: float) -> None
    .. method:: flush() -> None
    .. method:: close() -> None


CLI Reference: ``nb``
======================

.. code-block:: text

    nb <command> [options]

Commands
--------

``serve``
    Start the persistent daemon server.

    .. code-block:: console

        $ nb serve [--host HOST] [--port PORT] [-d] [--no-store]

    ``--host``
        Host to bind (default: ``localhost``).

    ``--port``
        Port to bind (default: ``2048``).

    ``-d``, ``--daemon``
        Run in background (daemon mode).

    ``--no-store``
        Disable ``.nebo`` file storage globally.

``run``
    Run a pipeline script managed by the daemon.

    .. code-block:: console

        $ nb run <script> [--name NAME] [--port PORT] [--flush-interval SECS] [args...]

    ``<script>``
        Path to the Python script.

    ``--name``
        Run name/ID (auto-generated if not provided).

``status``
    Show daemon status and recent runs.

    .. code-block:: console

        $ nb status [--port PORT]

``stop``
    Stop the daemon.

    .. code-block:: console

        $ nb stop [--port PORT]

``logs``
    View logs from runs.

    .. code-block:: console

        $ nb logs [--run RUN_ID] [--node NODE] [--limit N] [--port PORT]

``errors``
    View errors from runs.

    .. code-block:: console

        $ nb errors [--run RUN_ID] [--port PORT]

``load``
    Load a ``.nebo`` file into the daemon for viewing and Q&A.

    .. code-block:: console

        $ nb load <file> [--port PORT]

``mcp``
    Print MCP connection config for Claude Code / Claude Desktop.

    .. code-block:: console

        $ nb mcp

``mcp-stdio``
    Run the MCP stdio bridge (used internally).

    .. code-block:: console

        $ nb mcp-stdio [--port PORT]


MCP Tools Reference
====================

The following 17 MCP tools are available when the daemon is running.

Observation Tools
-----------------

``nebo_get_graph``
    Get the full DAG structure: nodes (with docstrings, execution counts, group membership), edges, and workflow description.

    :param run_id: Optional run ID. Uses the latest run if omitted.

``nebo_get_node_status``
    Get detailed status for a specific node: execution count, params, docstring, recent logs, errors, and progress.

    :param name: The node name (required).
    :param run_id: Optional run ID.

``nebo_get_logs``
    Get recent log entries, optionally filtered by node and run.

    :param node: Optional node name filter.
    :param run_id: Optional run ID.
    :param limit: Maximum entries (default: 100).

``nebo_get_metrics``
    Get metric time series for a node.

    :param node: The node name (required).
    :param name: Optional specific metric name.

``nebo_get_errors``
    Get all errors with full tracebacks, node context, and parameter values.

    :param run_id: Optional run ID.

``nebo_get_description``
    Get the workflow-level description and all node docstrings.

Action Tools
------------

``nebo_run_pipeline``
    Start a pipeline script. Returns a ``run_id`` for tracking.

    :param script_path: Path to the Python script (required).
    :param args: Script arguments.
    :param name: Optional run name/ID.

``nebo_stop_pipeline``
    Stop a running pipeline by run ID.

    :param run_id: The run ID to stop (required).

``nebo_restart_pipeline``
    Stop and re-run a pipeline with the same script and arguments.

    :param run_id: The run ID to restart (required).

``nebo_get_run_status``
    Get the status of a run: running, completed, crashed, or stopped.

    :param run_id: The run ID (required).

``nebo_get_run_history``
    List all runs with outcomes, timestamps, and error counts.

``nebo_get_source_code``
    Read a pipeline source file.

    :param file_path: Path to the source file (required).

``nebo_write_source_code``
    Write or patch a pipeline source file.

    :param file_path: Path to the source file (required).
    :param content: Full file content (replaces entire file).
    :param patches: List of ``{old, new}`` patches to apply.

``nebo_ask_user``
    Send a question to the user via the web UI.

    :param question: The question to ask (required).
    :param options: Valid response options.

``nebo_load_file``
    Load a ``.nebo`` log file into the daemon for viewing and Q&A.

    :param filepath: Absolute path to the ``.nebo`` file (required).

``nebo_chat``
    Ask a question about a run. Uses the run's logs, metrics, graph, and errors to generate an answer via Claude Code CLI.

    :param question: The question to ask (required).
    :param run_id: Optional run ID. Uses the active run if omitted.


Environment Variables
======================

These are set automatically by ``nb run`` and read by the SDK during auto-initialization:

``NEBO_MODE``
    Execution mode: ``"server"`` or ``"local"``.

``NEBO_SERVER_PORT``
    The daemon server port.

``NEBO_RUN_ID``
    The current run identifier.

``NEBO_DAEMON_PORT``
    Used internally by the daemon process itself.

``NEBO_NO_STORE``
    When set, disables ``.nebo`` file storage globally.

``NEBO_FLUSH_INTERVAL``
    Override the event flush interval (seconds).


.nebo File Format
==================

Nebo persists runs as append-only binary files using MessagePack.

.. code-block:: text

    [Header]
      magic: "nebo" (4 bytes)
      version: u16 big-endian (currently 1)
      metadata_size: u32 big-endian
      metadata: msgpack map {run_id, script_path, started_at, nebo_version, args}

    [Entry]*
      type: u8 (entry type index)
      size: u32 big-endian (payload size in bytes)
      payload: msgpack map (entry-specific data)

Entry types: log (0), metric (1), image (2), audio (3), node_register (4), edge (5), error (6), ask (7), ui_config (8), text (9), progress (10), config (11), description (12), node_executed (13), ask_response (14), run_start (15), run_completed (16), pause_state (17).

Media assets (images, audio) are embedded as raw bytes inside the msgpack payload, avoiding base64 overhead.
