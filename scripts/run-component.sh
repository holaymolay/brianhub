#!/usr/bin/env bash
set -euo pipefail

# Wrapper to run CERES core component runner from the repo root.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

CORE_SCRIPT="$REPO_ROOT/.ceres/core/scripts/run-component.sh"
if [[ ! -x "$CORE_SCRIPT" ]]; then
  echo "CERES core run-component not found at $CORE_SCRIPT" >&2
  exit 1
fi

cd "$REPO_ROOT/.ceres/components"

if [[ "$#" -ge 2 ]]; then
  component="$1"
  shift
  cmd="$*"
  if [[ "$component" == "governance-orchestrator" && "$cmd" == *"validate-governance-contracts.py"* && "$cmd" != *"--hub-root"* ]]; then
    cmd="$cmd --hub-root $REPO_ROOT/.ceres/core"
  fi
  exec "$CORE_SCRIPT" "$component" "$cmd"
else
  exec "$CORE_SCRIPT" "$@"
fi
