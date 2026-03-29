# BrianHub docs index

This folder tracks the current BrianHub product model, operational procedures, and implementation plans.

## Core product and API docs
- `docs/product-features.md`: current user-facing behavior by surface, including organizations and service workers
- `docs/roger-api-brief.md`: Roger handoff for production API and VPS operations
- `apps/web/help/api-docs.js`: source of truth for the in-app API reference shown at `/apps/web/help/api/`
- `docs/ownership-surface-agent-model-spec.md`: product model for users, organizations, workspaces, and agents
- `docs/ui-ux-execution-plan.md`: execution order for the shell and settings redesign
- `docs/ui-wireframe-spec.md`: lightweight build-oriented wireframes for the current IA

## Operations and infrastructure
- `docs/deployment.md`: dedicated VPS deployment, upgrades, rollback, and backup flow
- `docs/roger-ops.md`: private Roger access to the BrianHub VPS over Tailscale
- `docs/roger-github-write-access.md`: optional GitHub write path so Roger can edit, push, and deploy BrianHub independently
- `docs/security.md`: security scanning and hardening references
- `docs/pre-deploy-hardening.md`: pre-deploy hardening plan and acceptance criteria
- `docs/domain-email-rollout-plan.md`: domain and email rollout strategy
- `docs/data-layer.md`: data-layer direction and migration references

## Planning archives
- `docs/ceres/BRIANHUB_BRIEF.md`
- `docs/ceres/M1_PLAN.md`
- `docs/ceres/REPO_EXTRACTION_PLAN.md`

## Documentation rule

When behavior changes, update docs in the same workstream:
- Update `docs/product-features.md` for user-facing behavior and IA changes.
- Update `apps/web/help/api-docs.js` for any API or auth-surface changes.
- Update `docs/roger-api-brief.md` when Roger’s production path or guardrails change.
- Update the domain-specific doc when the change is primarily deployment, security, or data-layer related.
