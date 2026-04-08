.. _Guide:

Guide
#####

This guide walks through building observable Python pipelines with Nebo, from basic usage to advanced features like class decoration, persistent log files, MCP integration, and Q&A.


Decorating Functions with ``@nb.fn()``
=======================================

The ``@nb.fn()`` decorator is the core primitive. It registers a function for scope tracking in the pipeline DAG. A node materializes (appears in the DAG) as soon as the decorated function runs for the first time — you do not have to call a logging function to make a node show up. Edges are inferred from **data flow**: when a node's return value is passed as an argument to another node, an edge is created from the producer to the consumer.

.. code-block:: python

    import nebo as nb

    @nb.fn()
    def load_data():
        """Load raw data."""
        nb.log("Loading data")
        return [1, 2, 3]

    @nb.fn()
    def transform(data):
        """Transform data."""
        nb.log(f"Transforming {len(data)} items")
        return [x * 2 for x in data]

    @nb.fn()
    def run():
        records = load_data()
        result = transform(records)  # edge: load_data -> transform (data flow)
        return result

The decorator can be used in several forms:

.. code-block:: python

    @nb.fn                       # bare (no parentheses)
    @nb.fn()                     # empty parentheses
    @nb.fn(depends_on=[setup])   # with explicit dependencies
    @nb.fn(ui={"collapsed": True})  # with per-node UI hints


Explicit Dependencies with ``depends_on``
------------------------------------------

Some dependencies cannot be detected automatically — shared mutable state, class attributes, closures, or global variables. Use ``depends_on`` to declare these explicitly:

.. code-block:: python

    @nb.fn()
    def setup():
        """Initialize shared resources."""
        nb.log("Setting up")

    @nb.fn(depends_on=[setup])
    def process():
        """Uses resources initialized by setup."""
        nb.log("Processing")

``depends_on`` accepts a list of decorated functions or node ID strings. Explicit dependencies are added alongside any auto-detected data-flow edges.

.. note::

    Nebo tracks data flow via argument passing (``id()``-based return value tracking). Dependencies through shared mutable state, class attributes, closures, or global variables are **not** automatically detected. Use ``depends_on`` for these cases.


Decorating Classes
===================

``@nb.fn()`` can also be applied to a class. All methods are wrapped with scope tracking. The class itself is never a node — it serves as a visual grouping container (transparent bounding box) in the DAG.

.. code-block:: python

    import nebo as nb

    @nb.fn()
    class DataPipeline:
        def load(self):
            nb.log("Loading data")
            return [1, 2, 3]

        def transform(self, data):
            nb.log(f"Transforming {len(data)} items")
            return [x * 2 for x in data]

        def save(self, data):
            nb.log(f"Saving {len(data)} items")

In the DAG, ``DataPipeline`` appears as a transparent bounding box containing ``load``, ``transform``, and ``save`` as individual nodes.

**Scoping rules:**

- Every method gets its own scope. Logs inside ``transform()`` are scoped to ``DataPipeline.transform``.
- Every method that runs materializes as a node, including silent methods that never call a log function — this keeps dependency chains in the DAG intact even when an intermediate method only orchestrates calls to other nodes.
- If a method also has ``@nb.fn()`` on it, a warning is issued (the decorator is redundant).
- A standalone ``@nb.fn()`` function called from within the class also appears inside the class group.
- A decorated method in an **undecorated** class is a regular standalone node with no bounding box.


Logging
=======

Nebo provides several logging functions, all scoped to the currently executing node.

Text Logs
---------

``nb.log(message)`` logs a plain text message. Tensor-like objects (NumPy arrays, PyTorch tensors) are auto-formatted with shape, dtype, and statistics:

.. code-block:: python

    @nb.fn()
    def train(model, data):
        nb.log("Starting training...")
        for epoch in range(10):
            loss = train_epoch(model, data)
            nb.log(f"Epoch {epoch}: loss={loss:.4f}")

Scalar Metrics
--------------

``nb.log_metric(name, value, step=None)`` logs a scalar metric. Steps are auto-incremented if not provided:

.. code-block:: python

    @nb.fn()
    def train(model, data):
        for epoch in range(100):
            loss = train_epoch(model, data)
            accuracy = evaluate(model, data)
            nb.log_metric("loss", loss)
            nb.log_metric("accuracy", accuracy)

Images
------

``nb.log_image(image, name=None, step=None)`` accepts PIL images, NumPy arrays, or PyTorch tensors:

.. code-block:: python

    @nb.fn()
    def augment(image):
        result = apply_transforms(image)
        nb.log_image(result, name="augmented")
        return result

Audio
-----

``nb.log_audio(audio, sr=16000, name=None)`` logs audio data as NumPy arrays:

.. code-block:: python

    @nb.fn()
    def synthesize(text):
        waveform = tts_model(text)
        nb.log_audio(waveform, sr=22050, name="speech")
        return waveform

Rich Text
---------

``nb.log_text(name, text)`` logs Markdown or formatted text:

.. code-block:: python

    @nb.fn()
    def summarize(stats):
        nb.log_text("report", f"""## Results
    - **Accuracy**: {stats['acc']:.2%}
    - **Loss**: {stats['loss']:.4f}
    """)

Configuration
-------------

``nb.log_cfg(cfg)`` logs configuration for the current node. Values are displayed in the Info tab:

.. code-block:: python

    @nb.fn()
    def train(lr=0.001, epochs=50):
        nb.log_cfg({"lr": lr, "epochs": epochs})
        ...

Multiple ``log_cfg()`` calls within the same node merge their dictionaries.


Progress Tracking
=================

``nb.track(iterable, name, total)`` wraps an iterable for tqdm-like progress tracking. The terminal dashboard and UI render a live progress bar:

.. code-block:: python

    @nb.fn()
    def process(items):
        results = []
        for item in nb.track(items, name="processing"):
            results.append(transform(item))
        return results

If the iterable has a ``__len__``, the total is auto-detected. Otherwise you can pass ``total`` explicitly:

.. code-block:: python

    for batch in nb.track(dataloader, name="training", total=len(dataloader)):
        ...


Workflow Description
====================

``nb.md(description)`` sets a Markdown description for the overall workflow. This is visible in MCP tools and the terminal dashboard:

.. code-block:: python

    nb.md("""
    # Image Classification Pipeline

    Loads images from disk, runs inference with a pretrained ResNet,
    and exports predictions to a JSON file.
    """)

Calling ``nb.md()`` multiple times appends to the description.


Human-in-the-Loop
==================

``nb.ask(question, options, timeout)`` pauses the pipeline and prompts the user for input. In server mode, the question appears in the web UI. In local mode, it falls back to a Rich terminal prompt:

.. code-block:: python

    @nb.fn()
    def review(predictions):
        answer = nb.ask(
            "Model accuracy is 73%. Continue training?",
            options=["yes", "no", "retrain"]
        )
        if answer == "no":
            return predictions
        elif answer == "retrain":
            return retrain(predictions)
        ...


UI Configuration from Code
============================

``nb.ui()`` sets run-level UI defaults. The web UI reads these as defaults that the user can override:

.. code-block:: python

    nb.ui(
        layout="horizontal",     # or "vertical"
        view="dag",              # or "grid"
        collapsed=False,         # default node collapse state
        minimap=True,            # show minimap
        theme="dark",            # or "light"
    )

Per-node display hints can be set via ``@nb.fn(ui={})``:

.. code-block:: python

    @nb.fn(ui={"collapsed": True})
    def data_loader():
        nb.log("Loading data")
        ...


Execution Modes
===============

Local Mode (Default)
--------------------

When you run a script directly (``python my_pipeline.py``), nebo operates in local mode. A Rich terminal display shows the DAG, node execution counts, progress bars, and logs. No daemon is required.

Server Mode
-----------

When the daemon is running, events are streamed to it via HTTP. This is activated automatically when using ``nb run``, which sets the ``NEBO_MODE``, ``NEBO_SERVER_PORT``, and ``NEBO_RUN_ID`` environment variables.

You can also trigger server mode manually:

.. code-block:: python

    import nebo as nb
    nb.init(mode="server", port=2048)

Auto Mode
---------

The default mode is ``auto``. On initialization, nebo checks for a running daemon — if found, it uses server mode; otherwise it falls back to local mode.


Persistent .nebo Files
=======================

Nebo can persist runs to append-only binary ``.nebo`` files using MessagePack. Storage is enabled by default and managed by the daemon.

When the daemon starts, it creates a ``.nebo/`` directory in its working directory. Each run is stored as ``.nebo/<timestamp>_<run_id>.nebo``.

To disable storage for a specific run:

.. code-block:: python

    nb.init(store=False)

To disable storage globally when starting the daemon:

.. code-block:: bash

    nb serve --no-store

To load a ``.nebo`` file into the daemon for viewing and Q&A:

.. code-block:: bash

    nb load path/to/run.nebo


Custom Logging Backends
========================

Implement the ``LoggingBackend`` protocol to route events to external systems (TensorBoard, MLflow, W&B, etc.):

.. code-block:: python

    from nebo import LoggingBackend

    class TensorBoardBackend:
        def __init__(self, log_dir="runs"):
            from torch.utils.tensorboard import SummaryWriter
            self.writer = SummaryWriter(log_dir)

        def on_log(self, node, message, timestamp):
            pass

        def on_metric(self, node, name, value, step):
            self.writer.add_scalar(f"{node}/{name}", value, step)

        def on_image(self, node, name, image_bytes, step):
            pass

        def on_audio(self, node, name, audio_bytes, sr):
            pass

        def on_node_start(self, node, params):
            pass

        def on_node_end(self, node, duration):
            pass

        def flush(self):
            self.writer.flush()

        def close(self):
            self.writer.close()

    nb.init(backends=[TensorBoardBackend()])

Multiple backends can be active simultaneously.


MCP Integration for AI Agents
===============================

Nebo includes 17 MCP tools that allow AI agents (like Claude) to run, monitor, debug, and query pipelines. To set up MCP:

1. Start the daemon:

   .. code-block:: console

       $ nb serve -d

2. Get the MCP config:

   .. code-block:: console

       $ nb mcp

3. Add the printed config to your Claude Desktop or Claude Code MCP configuration.

The MCP tools provide observation (``nebo_get_graph``, ``nebo_get_node_status``, ``nebo_get_logs``, ``nebo_get_metrics``, ``nebo_get_errors``, ``nebo_get_description``) and action (``nebo_run_pipeline``, ``nebo_stop_pipeline``, ``nebo_restart_pipeline``, ``nebo_get_run_status``, ``nebo_get_run_history``, ``nebo_get_source_code``, ``nebo_write_source_code``, ``nebo_ask_user``, ``nebo_load_file``, ``nebo_chat``) capabilities.

An AI agent can use these to autonomously run experiments, diagnose failures, patch code, ask questions about runs, and iterate.


Q&A Chat
=========

Nebo supports querying runs using natural language. From the web UI, users can open the Chat tab in the right panel and ask questions like "how did my training run go?" or "what metrics are underperforming?"

The daemon delegates Q&A to Claude Code CLI, spawning it as a subprocess with MCP config pointing back to itself. Claude Code reads the run's state via MCP tools and generates an answer.

This requires Claude Code CLI to be installed on the system where the daemon runs.


Complete Example: Data Processing Pipeline
============================================

.. code-block:: python

    import numpy as np
    import nebo as nb

    nb.md("# Data Processing Pipeline\nGenerate, normalize, filter, and analyze data.")

    @nb.fn()
    def generate(num_samples: int = 200, noise: float = 0.1, seed: int = 42):
        """Generate synthetic signal data."""
        nb.log_cfg({"num_samples": num_samples, "noise": noise, "seed": seed})
        np.random.seed(seed)
        t = np.linspace(0, 4 * np.pi, num_samples)
        signal = np.sin(t) + noise * np.random.randn(num_samples)
        nb.log(f"Generated {num_samples} samples")
        return signal

    @nb.fn()
    def normalize(data, method: str = "standard", clip_min: float = -3.0, clip_max: float = 3.0):
        """Normalize and clip the signal."""
        nb.log_cfg({"method": method, "clip_min": clip_min, "clip_max": clip_max})
        if method == "standard":
            data = (data - data.mean()) / (data.std() + 1e-8)
        data = np.clip(data, clip_min, clip_max)
        nb.log(f"Normalized with method={method}, clipped to [{clip_min}, {clip_max}]")
        return data

    @nb.fn()
    def analyze(data):
        """Compute statistics on the processed data."""
        stats = {"mean": float(data.mean()), "std": float(data.std()), "n": len(data)}
        nb.log(f"Stats: mean={stats['mean']:.4f}, std={stats['std']:.4f}")
        nb.log_metric("mean", stats["mean"])
        nb.log_metric("std", stats["std"])
        return stats

    @nb.fn()
    def run():
        """Main entry point."""
        data = generate()
        normed = normalize(data)
        return analyze(normed)

    if __name__ == "__main__":
        result = run()
        print(result)
