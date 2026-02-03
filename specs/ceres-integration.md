# CERES Integration Spec

## Purpose
Align repo execution with CERES governance by providing root-level wrappers that call core tooling and enabling component execution.

## Scope
- Add root wrappers for component execution and event logging.
- Keep workspace artifacts in `.ceres/workspace`.
- Ensure preflight can execute using CERES components.
- Provide repo-local binding docs for agents and security.

## Non-Goals
- Modifying core governance rules.
- Changing application runtime code.

## Acceptance
- `scripts/run-component.sh` delegates to `.ceres/core/scripts/run-component.sh` and runs from `.ceres/components`.
- `scripts/log_event.py` delegates to core logger.
- Preflight can invoke governance orchestrator once components are cloned.
- `docs/agents.md` and `docs/security.md` exist and reference Core as canonical.
