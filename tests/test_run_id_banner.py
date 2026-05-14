"""Tests for the run-id banner the SDK prints on daemon handshake."""
from __future__ import annotations

import io
import re
from contextlib import redirect_stdout
from unittest.mock import patch

import pytest

import nebo as nb
from nebo.core.state import SessionState


BANNER_RE = re.compile(r"Nebo daemon fully connected\. Your run id is: ([0-9a-fA-F]{12})\.")


def test_init_does_not_print_banner_when_terminal_disabled(monkeypatch):
    SessionState.reset_singleton()
    nb._auto_init_done = False
    monkeypatch.setenv("NEBO_NO_TERMINAL", "1")
    monkeypatch.setenv("NEBO_NO_STORE", "1")
    buf = io.StringIO()
    with redirect_stdout(buf):
        # Use mode="local" so we don't try to actually connect anywhere.
        # The banner code path should be gated behind NEBO_NO_TERMINAL
        # regardless of mode, so this should produce no banner.
        nb.init(mode="local")
    assert BANNER_RE.search(buf.getvalue()) is None
    SessionState.reset_singleton()
    nb._auto_init_done = False


def test_start_run_prints_banner_in_terminal_mode(monkeypatch):
    SessionState.reset_singleton()
    nb._auto_init_done = False
    monkeypatch.delenv("NEBO_NO_TERMINAL", raising=False)
    monkeypatch.setenv("NEBO_NO_STORE", "1")
    buf = io.StringIO()
    with redirect_stdout(buf):
        # Initialize without daemon so the test stays in-process.
        nb.init(mode="local")
        with nb.start_run() as run:
            captured_run_id = run.run_id
    out = buf.getvalue()
    m = BANNER_RE.search(out)
    assert m is not None, f"banner not in stdout: {out!r}"
    assert m.group(1) == captured_run_id
    SessionState.reset_singleton()
    nb._auto_init_done = False


def test_start_run_suppresses_banner_when_terminal_disabled(monkeypatch):
    """Banner must not appear when NEBO_NO_TERMINAL=1, even from start_run."""
    SessionState.reset_singleton()
    nb._auto_init_done = False
    monkeypatch.setenv("NEBO_NO_TERMINAL", "1")
    monkeypatch.setenv("NEBO_NO_STORE", "1")
    buf = io.StringIO()
    with redirect_stdout(buf):
        nb.init(mode="local")
        with nb.start_run() as run:
            pass
    assert BANNER_RE.search(buf.getvalue()) is None
    SessionState.reset_singleton()
    nb._auto_init_done = False
