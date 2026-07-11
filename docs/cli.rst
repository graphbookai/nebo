.. _CLI Reference:

CLI Reference
#############

Installing nebo also installs the ``nebo`` command. It has two groups of
subcommands:

* **Server & admin** — start/stop the daemon, manage its cache, install
  agent skills, deploy to a Hugging Face Space.
* **Agent-callable Q&A and writes** — read runs, logs, metrics, and the
  DAG from a running daemon, manage alert rules, and push new entries
  into a run. These are the same commands the shipped agent skills use.

.. code-block:: bash

    nebo serve                       # start the daemon (port 7861)
    nebo runs list                   # list runs
    nebo metrics get train --name train/loss --values-only
    nebo alerts set --title "loss spiked" --condition "train/loss > 5"


Connection options
******************

Every command that talks to a daemon accepts the same connection flags.
Values resolve in this order: explicit flag → environment variable →
default.

.. option:: --url <url>

    Daemon URL (overrides ``--port``). Default: ``NEBO_URL`` env or
    ``http://localhost:7861``.

.. option:: --port <port>

    Daemon port. Default: ``NEBO_PORT`` env or ``7861``.

.. option:: --api-token <token>

    ``X-Nebo-Token`` to send with requests — required when the daemon
    enforces auth (see :option:`nebo serve --api-token` and
    ``nebo deploy``). Default: ``NEBO_API_TOKEN`` env.

.. option:: --json

    Emit machine-readable JSON instead of human-formatted output.


Server & admin
**************

nebo serve
==========

.. program:: nebo serve

Start the persistent daemon: it watches a log directory for ``.nebo``
files written by SDK file-mode runs, accepts network-mode events over
HTTP, and serves the web UI, the REST API, and the ``/stream``
WebSocket.

.. code-block:: bash

    nebo serve                                  # foreground, ./.nebo watched
    nebo serve -d --logdir ~/experiments/.nebo  # background daemon

.. option:: --host <host>

    Host to bind (default: ``localhost``).

.. option:: --port <port>

    Port to bind (default: ``7861``).

.. option:: --daemon, -d

    Run in the background. The PID is written to ``~/.nebo/server.pid``.

.. option:: --logdir <dir>

    Directory the daemon watches for ``.nebo`` files written by SDK
    file-mode runs (default: ``./.nebo``). Files are ingested as they
    grow, and progress survives daemon restarts.

.. option:: --no-local

    Disable the directory watcher; the daemon listens for network
    events only.

.. option:: --save-files <dir>

    Persist network-mode events to ``.nebo`` files at this path. Off by
    default. Cannot be the same directory as ``--logdir`` (the watcher
    would re-ingest the daemon's own output).

.. option:: --api-token <token>

    Require this token on API requests via the ``X-Nebo-Token`` header
    or ``?token=`` query parameter. Sets ``NEBO_API_TOKEN``.

.. option:: --read <public|private>

    Read access mode (default: ``public``). Only matters when
    ``--api-token`` is set: ``private`` requires the token on GET
    requests too.

.. option:: --write <public|private>

    Write access mode (default: ``private``). Only matters when
    ``--api-token`` is set: ``private`` requires the token on any
    request that mutates state.

.. option:: --cache-path <file>

    SQLite cache database path (default:
    ``~/.nebo/cache/<logdir-hash>.db``). The cache bounds the daemon's
    memory and makes restarts fast; ``.nebo`` files remain the source
    of truth and the cache can always be rebuilt from them.

.. option:: --no-cache

    Disable the SQLite cache: pure-RAM daemon, no eviction, no restart
    persistence. Memory grows with everything ever ingested.

.. option:: --ram-budget <mb>

    RAM budget for resident run data — metric points and log lines
    across all runs (default: ``384``). Beyond it, idle
    completed runs are evicted from RAM and oversized live runs are
    served from the cache instead.

.. option:: --media-lru <mb>

    In-RAM media byte-cache budget (default: ``256``). This is a hot
    window, not a capacity limit — media beyond it is read back from
    disk on demand.

.. option:: --cache-retention-days <days>

    At startup, delete cache databases untouched for this many days
    (default: ``30``).

Environment mirrors for the cache flags: ``NEBO_CACHE_PATH``,
``NEBO_NO_CACHE``, ``NEBO_RAM_BUDGET_MB``, ``NEBO_MEDIA_LRU_MB``,
``NEBO_CACHE_RETENTION_DAYS``.

nebo cache
==========

.. program:: nebo cache

Inspect or delete the daemon's SQLite cache databases. Pure file
operations — no daemon required. Deleting a cache is safe for runs
backed by ``.nebo`` files (it rebuilds on the next ``serve``); runs
received over the network **without** ``--save-files`` live only in the
cache and are deleted with it.

.. code-block:: bash

    nebo cache ls                    # list cache dbs with logdir + size
    nebo cache clear ~/exp/.nebo     # delete the cache for one logdir
    nebo cache clear --all           # delete every cache db

.. option:: ls [--json]

    List cache databases with their recorded logdir, size, and last
    modification time.

.. option:: clear [LOGDIR | --all]

    Delete the cache database for ``LOGDIR`` (matched by path hash or
    recorded logdir), or every cache database with ``--all``.

nebo status
===========

.. program:: nebo status

Show daemon health and recent runs. Accepts the shared
`connection options`_.

nebo stop
=========

.. program:: nebo stop

Stop a running daemon.

.. option:: --port <port>

    Port of the daemon to stop (default: ``7861``).

nebo load
=========

.. program:: nebo load

Load a ``.nebo`` file into the daemon for viewing and Q&A — useful for
historical files that live outside the watched logdir.

.. code-block:: bash

    nebo load ./archive/2026-05-01_120000_abc123.nebo

.. option:: file

    Path to the ``.nebo`` file.

nebo mcp / nebo mcp-stdio
=========================

.. program:: nebo mcp

``nebo mcp`` prints an MCP server config block for Claude Code (or any
MCP client); ``nebo mcp-stdio`` is the stdio transport that config
invokes.

.. code-block:: bash

    nebo mcp >> .mcp.json            # or paste into your client config

.. option:: --port <port>

    Daemon port to embed in the MCP config (default: ``7861``).

nebo skill
==========

.. program:: nebo skill

List or install the agent skills that ship with nebo (e.g. ``runs-qa``
for run Q&A and derived metrics, and the instrumentation skill for
writing nebo-integrated code).

.. code-block:: bash

    nebo skill list
    nebo skill install --skill all --platform claude-code

.. option:: list

    List available skills.

.. option:: install [--platform <p>] [--skill <name>] [--project]

    Install a skill onto an agent platform.

    * ``--platform`` — ``claude-code`` (default), ``agents-md``, or
      ``all``.
    * ``--skill`` — skill name or ``all`` (default: ``runs-qa``).
    * ``--project`` — for claude-code, install under
      ``./.claude/skills`` instead of ``~/.claude/skills``.

nebo deploy
===========

.. program:: nebo deploy

Deploy the nebo daemon to a Hugging Face Space, so you can stream runs
to a URL and watch them from anywhere (the UI is mobile-friendly).

.. code-block:: bash

    nebo deploy --space-id username/my-dashboard

.. option:: --space-id <id>

    Hugging Face Space ID, e.g. ``username/my-dashboard``. Required.

.. option:: --hf-token <token>

    Hugging Face write token (defaults to ``HF_TOKEN`` env or the
    cached ``huggingface-cli`` login).

.. option:: --api-token <token>

    Token clients must send via ``X-Nebo-Token``. Random if omitted;
    printed at the end of the deploy.

.. option:: --private

    Create the Space as private.

.. option:: --from-source

    Build a wheel from this checkout and ship it instead of installing
    nebo from PyPI.

.. option:: --read <public|private>

    Read access mode (default: ``public`` — anyone can view).

.. option:: --write <public|private>

    Write access mode (default: ``private`` — token required to push
    events).

.. option:: --no-wait

    Return as soon as files are uploaded; don't wait for the Space
    rebuild to finish.


Reading runs
************

All commands below accept the shared `connection options`_
(``--url`` / ``--port`` / ``--api-token`` / ``--json``).

nebo runs
=========

.. program:: nebo runs

.. code-block:: bash

    nebo runs list
    nebo runs show run_1748_0
    nebo runs wait run_1748_0 --timeout 600 --min-level 30

.. option:: list

    List all runs with their summaries (script, timings, counts, latest
    step).

.. option:: show <run_id>

    Show one run's summary.

.. option:: wait <run_id> [--timeout <s>] [--min-level <n>]

    Block until an alert at or above ``--min-level`` fires on the run
    (default level ``20`` = INFO), or ``--timeout`` seconds pass
    (default ``300``). Prints ``{"status": "alert", ...}`` or
    ``{"status": "timeout"}`` — the building block for "tell me when
    the loss spikes" agent loops, paired with ``nebo alerts set``.

nebo graph
==========

.. program:: nebo graph

.. option:: show [--run <run_id>]

    Show the run's DAG nodes and edges (latest run if omitted).

nebo loggables
==============

.. program:: nebo loggables

.. option:: show <loggable_id> [--run <run_id>]

    Show a loggable's status: metadata, recent logs, metrics, progress.
    Loggables are ``@nb.fn`` node ids (function qualnames), plus the
    implicit ``__global__`` and ``__agent__`` loggables.

nebo describe
=============

.. program:: nebo describe

Print the workflow description (set via ``nb.md``) and per-node
docstrings.

.. option:: --run <run_id>

    Run id (latest if omitted).

nebo logs
=========

.. program:: nebo logs

.. option:: --run <run_id>

    Run ID (latest if omitted).

.. option:: --node <loggable_id>

    Filter to one loggable.

.. option:: --limit <n>

    Maximum entries to return (default: ``100``).

nebo metrics (read)
===================

.. program:: nebo metrics

.. code-block:: bash

    nebo metrics list
    nebo metrics get train --name train/loss --values-only
    nebo metrics get train --name train/loss --runs run_a,run_b --json

.. option:: list [--run <run_id>]

    List metric names per loggable.

.. option:: get <loggable_id> [--name <n>] [--tag <t>] [--step <n>] [--run <r>] [--runs <r1,r2>] [--values-only]

    Fetch metric entries for a loggable.

    * ``--name`` — only the named series.
    * ``--tag`` — keep only line/scatter entries carrying the tag.
    * ``--step`` — keep only entries at the exact step.
    * ``--run`` — run id (latest if omitted).
    * ``--runs`` — comma-separated run ids for a cross-run query; emits
      ``{run_id: series}`` keyed by run.
    * ``--values-only`` — with ``--name``: emit just the entries array
      ``[{step, value, tags, timestamp}, ...]``.

nebo alerts
===========

.. program:: nebo alerts

Alert rules are evaluated by the daemon on every incoming numeric
metric value and fire at most once per run; a fired alert wakes
``nebo runs wait``. Code-fired alerts (``nb.alert(...)``) appear in the
same listing.

.. code-block:: bash

    nebo alerts set --title "loss spiked" --condition "train/loss > 5" --level WARN
    nebo alerts ls
    nebo alerts rm 1a2b3c4d

.. option:: ls [--run <run_id>]

    List alert rules and code-fired alerts (optionally scoped to one
    run).

.. option:: get <rule_id>

    Show one alert rule.

.. option:: set --title <t> --condition <expr> [--text <body>] [--level <l>] [--loggable <id>] [--run <run_id>]

    Create an alert rule on a metric condition.

    * ``--condition`` — ``'<metric> <op> <number>'``, e.g.
      ``'train/loss > 5'``. Ops: ``>``, ``>=``, ``<``, ``<=``, ``==``,
      ``!=``.
    * ``--level`` — ``DEBUG``/``INFO``/``WARN``/``ERROR`` or an integer
      (default ``INFO``).
    * ``--loggable`` — only match the metric on this loggable id.
    * ``--run`` — only apply to this run id (default: all runs).

.. option:: rm <rule_id>

    Delete an alert rule.


Writing data
************

These commands push entries *into* a run — they exist so agents can
compute and deliver derived data (a smoothed metric, an annotated
image) straight to the UI. Entries default to the ``__agent__``
loggable so agent-authored data never mixes with your pipeline's own
streams.

nebo metrics log
================

.. program:: nebo metrics log

.. code-block:: bash

    nebo metrics log --entries-json '[
      {"name": "loss_ema", "value": 0.42, "step": 100},
      {"name": "loss_ema", "value": 0.41, "step": 101}
    ]'

.. option:: --entries-json <json>

    JSON list of metric entries. Each entry:
    ``{loggable_id?, name, value, type?, step?, tags?}`` — ``type`` is
    the chart type (``line`` default, or ``bar``/``pie``/``scatter``/
    ``histogram``), ``loggable_id`` defaults to ``__agent__``.

.. option:: --run <run_id>

    Target run (active run if omitted).

nebo text / images / audio log
==============================

.. program:: nebo text log

.. code-block:: bash

    nebo text log --entries-json '[{"message": "analysis complete"}]'
    nebo images log --entries-json '[{"name": "annotated", "path": "./out.png"}]'
    nebo audio log --entries-json '[{"name": "sample", "path": "./clip.wav", "sr": 22050}]'

.. option:: --entries-json <json>

    JSON list of entries.

    * **text**: ``{loggable_id?, message, name?, level?, step?}``
    * **images**: ``{loggable_id?, name, path? | url? | data?, step?,
      labels?}`` — exactly one of ``path`` (local file, read and
      encoded by the CLI), ``url`` (fetched server-side), or ``data``
      (already base64).
    * **audio**: same as images plus ``sr`` (sample rate, default
      ``16000``).

.. option:: --run <run_id>

    Target run (active run if omitted).
