# Data Layer Adoption Spec

## Purpose
Adopt the DbClient abstraction in the API service layer and make async-safe data access the default.

## Scope
- Replace legacy SQL.js wrapper with DbClient-based `openDb`/`migrate`.
- Convert `taskService` to async and use DbClient helpers.
- Update API routes to await async service calls.
- Add org/workspace scaffolding migration for future multi-tenant support.
- Add TDD coverage for DbClient compatibility in task service.

## Non‑Goals
- Full repository layer extraction for all domains.
- Postgres implementation (stub remains in data-layer concept).

## Acceptance
- `services/api/src/db.js` uses DbClient + migration runner.
- Task service functions work with DbClient and are async.
- Tests cover DbClient compatibility and notices continue to pass.
