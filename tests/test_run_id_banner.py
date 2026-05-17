"""Tests for the run-id banner the SDK prints on start-up."""
from __future__ import annotations

import io
import re
from contextlib import redirect_stdout

import pytest

import nebo as nb
from nebo.core.state import SessionState


FILE_BANNER_RE = re.compile(
    r"nebo: writing run \(run_id=([0-9a-fA-F]{12})\) to .+\.nebo"
)
NETWORK_BANNER_RE = re.compile(
    r"nebo: connected run \(run_id=([0-9a-fA-F]{12})\) to .+"
)
RUN_ID_RE = re.compile(r"run_id=([0-9a-fA-F]{12})")


def _reset():
    SessionState.reset_singleton()
    nb._auto_init_done = False


def test_init_prints_file_banner_with_default_uri(tmp_path, monkeypatch):
    _reset()
    monkeypatch.delenv("NEBO_QUIET", raising=False)
    monkeypatch.delenv("NEBO_NO_STORE", raising=False)
    monkeypatch.chdir(tmp_path)
    buf = io.StringIO()
    with redirect_stdout(buf):
        nb.init()
    out = buf.getvalue()
    assert FILE_BANNER_RE.search(out), repr(out)
    assert RUN_ID_RE.search(out), repr(out)
    _reset()


def test_init_suppresses_banner_when_quiet(tmp_path, monkeypatch):
    _reset()
    monkeypatch.setenv("NEBO_QUIET", "1")
    monkeypatch.setenv("NEBO_NO_STORE", "1")
    monkeypatch.chdir(tmp_path)
    buf = io.StringIO()
    with redirect_stdout(buf):
        nb.init()
    assert "nebo:" not in buf.getvalue()
    _reset()


def test_no_store_disables_file_write(tmp_path, monkeypatch):
    _reset()
    monkeypatch.setenv("NEBO_NO_STORE", "1")
    monkeypatch.delenv("NEBO_QUIET", raising=False)
    monkeypatch.chdir(tmp_path)
    buf = io.StringIO()
    with redirect_stdout(buf):
        nb.init()
    assert "NEBO_NO_STORE=1" in buf.getvalue()
    assert not list(tmp_path.glob("**/*.nebo"))
    _reset()
