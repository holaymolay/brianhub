# Prompt: CERES Governance Alignment

Prompt ID: 570e85df-6984-48e1-bde5-702cb145556f
Status: draft
Classification: decomposable
Owner: user
Created: 2026-02-03T00:00:00Z
Last-Modified: 2026-02-03T00:00:00Z

## Intent
Align this project with canonical CERES governance, including correct artifact usage and preflight execution, using the upstream CERES instruction set.

## Constraints
- Follow CERES Constitution, PROMPTLOADER, and AGENTS as authoritative.
- Use Concept–Synchronization architecture and single‑concept‑per‑commit.
- Use TDD where code changes are required.
- No secrets committed; parameterized queries only; adhere to security rules.

## Task Decomposition Guidance (decomposable only)
- Create/repair workspace artifacts (spec, objective, gap ledger, todo plan).
- Ensure required wrappers/components exist for preflight to run.
- Execute preflight with workspace paths and resolve issues.
- Record completion in workspace logs.

## Prompt Body
User request: “I want you to use CERES for this project the way CERES was intended to be used.”

## Validation Criteria
- Workspace artifacts updated and ready for planning/execution.
- Preflight passes using workspace artifacts.
- Governance alignment actions logged in workspace memory/completed.
