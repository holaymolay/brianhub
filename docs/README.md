# BrianHub docs index

This folder tracks current implementation behavior, rollout plans, and hardening notes.

## Core docs
- `docs/deployment.md`: dedicated VPS deployment, upgrades, rollback, and backup flow
- `docs/roger-ops.md`: private Roger access to the BrianHub VPS over Tailscale
- `docs/product-features.md`: current user-facing behavior by module
- `docs/security.md`: security scanning and hardening references
- `docs/pre-deploy-hardening.md`: pre-deploy hardening plan and acceptance criteria
- `docs/domain-email-rollout-plan.md`: domain + email rollout strategy
- `docs/data-layer.md`: data-layer direction and migration references

## Ceres planning docs
- `docs/ceres/BRIANHUB_BRIEF.md`
- `docs/ceres/M1_PLAN.md`
- `docs/ceres/REPO_EXTRACTION_PLAN.md`

## Documentation rule

When a feature changes, update docs in the same workstream:
- Update `README.md` for setup/script/top-level behavior changes
- Update `docs/product-features.md` for module behavior and UX updates
- Update the specific domain doc if the change is security/data/ops specific
