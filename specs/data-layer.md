# Data Layer Concept Spec

## Purpose
Provide a DB-agnostic data layer with SQL-only migrations and tenant-scoped repositories to support SQLite now and Postgres later.

## Interfaces
- DbClient: query / queryOne / exec / transaction
- TenantCtx: { orgId, workspaceId?, userId? }
- Repositories: accept TenantCtx and must scope all queries by org_id (and workspace_id when present)

## Migrations
- SQL-only files in `concepts/data-layer/migrations`
- `migrations` table tracks applied files (id, name, applied_at)

## Initial Repo
- TaskRepository: create + list using tenant scoping

## Future
- Add Postgres client (pg) behind config
- Expand repos and add RLS notes for org_id
