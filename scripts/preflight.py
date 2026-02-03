#!/usr/bin/env python3
"""Wrapper for CERES core preflight.py (workspace-aware)."""
from __future__ import annotations

import runpy
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
CORE_PREFLIGHT = ROOT / ".ceres" / "core" / "scripts" / "preflight.py"

if not CORE_PREFLIGHT.exists():
    raise SystemExit(f"CERES core preflight.py not found at {CORE_PREFLIGHT}")

sys.argv[0] = str(CORE_PREFLIGHT)
runpy.run_path(str(CORE_PREFLIGHT), run_name="__main__")
