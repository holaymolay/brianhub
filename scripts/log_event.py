#!/usr/bin/env python3
"""Wrapper for CERES core log_event.py (workspace-aware)."""
from __future__ import annotations

import runpy
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
CORE_LOGGER = ROOT / ".ceres" / "core" / "scripts" / "log_event.py"

if not CORE_LOGGER.exists():
    raise SystemExit(f"CERES core log_event.py not found at {CORE_LOGGER}")

sys.argv[0] = str(CORE_LOGGER)
runpy.run_path(str(CORE_LOGGER), run_name="__main__")
