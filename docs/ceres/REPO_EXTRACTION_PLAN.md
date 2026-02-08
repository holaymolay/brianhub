# Repository Extraction Plan (TenantCtx / org-scoped)

## Objective
Move service-layer SQL access behind concept repositories so domain flows stay DbClient-backed, tenant-scoped, and portable from SQLite to Postgres.

## Guardrails
- Every repository method accepts `TenantCtx` and validates `orgId` (UUID).
- Workspace-bound entities require `workspaceId` in context or method args.
- Service layer orchestrates business behavior only; repositories own SQL.
- No direct SQL in route handlers.

## Current Baseline
- `TaskRepository` exists in `concepts/data-layer/repos/task-repo.js`.
- `TenantCtx` and UUID assertions exist in `concepts/data-layer/types/tenant.js`.
- `services/api/src/taskService.js` now validates UUIDs and workspace ownership across linked entities.

## Extraction Sequence
1. `WorkspaceRepository`
- `list/get/create/update/delete` for workspaces.
- Enforce org ownership at query boundary.

2. `ProjectRepository`
- `list/get/create/update/delete` for projects.
- Enforce workspace and org scoping.

3. `TaxonomyRepository`
- Statuses and task types (`workspace_statuses`, `task_types`).
- Preserve default seed behavior at workspace creation.

4. `NoticeRepository`
- Notice types + notices + recurrence fields.
- Keep recurrence rule JSON handling in repository adapter methods.

5. `ShoppingRepository`
- Shopping lists + items + store rules.
- Preserve list-level completion and item ordering semantics.

6. `WorkflowRepository`
- Blueprints, types, phases, patterns, instances, instance-task links.
- Keep scaffold helpers in service layer; persistence methods in repository.

## Implementation Approach
- Add one repository at a time with tests.
- For each extraction:
  - Add repository + tests under `tests/*-repo.test.js`.
  - Replace the equivalent SQL slice in `taskService.js` with repository calls.
  - Keep external API contracts unchanged.
  - Run full suite after each step.

## Definition of Done
- No direct SQL remains in route handlers.
- `taskService.js` uses repository methods for all non-task domains.
- Tenant/org scoping is enforced at repository boundaries for each domain.
- All touched tests pass with SQLite DbClient.

