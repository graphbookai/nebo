"""Shared pytest configuration.

Two suite-wide invariants:

* ``NEBO_NO_STORE=1`` — the daemon's auto-create and run_start storage paths
  skip the on-disk ``.nebo`` writer. Tests that exercise the file-format
  writer import ``NeboFileWriter`` directly and write to ``tmp_path``.
* ``NEBO_NO_TERMINAL=1`` — ``nb.init()`` skips the Rich live dashboard.
  The dashboard is a background thread that repaints the `Daemon: not
  connected` panel into pytest's captured stdout on every state poll;
  suppressing it keeps test output readable. Tests that specifically
  exercise the display import ``TerminalDisplay`` directly.

Both env vars are set autouse-per-test so ``monkeypatch`` rolls them back
cleanly even after tests that call ``SessionState.reset_singleton()``.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _quiet_nebo(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEBO_NO_STORE", "1")
    monkeypatch.setenv("NEBO_NO_TERMINAL", "1")
