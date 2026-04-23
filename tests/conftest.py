"""Shared pytest configuration.

Disables the daemon's on-disk `.nebo` writer during the test suite by default.
Tests that exercise the auto-create or run_start path still instantiate a
Run, but no file handle is opened and nothing touches the working directory.

Individual tests that need to exercise the file-format writer can monkeypatch
the env var back off or import `NeboFileWriter` directly.
"""

from __future__ import annotations

import os

import pytest


@pytest.fixture(autouse=True)
def _disable_daemon_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEBO_NO_STORE", "1")
