# Data Layer: SQLite now, Postgres later

## Overview
The data layer is isolated behind a narrow `DbClient` interface and tenant-scoped repositories. SQLite is used via `sql.js` today. Postgres can be introduced later by swapping the DbClient implementation without touching domain logic.

## DbClient swap strategy
1. Keep SQL portable (TEXT ids, TEXT timestamps, INTEGER booleans).
2. Reuse SQL migrations for Postgres (only minor type tuning if desired).
3. Implement `createPostgresClient` with `pg` and wire config via env.
4. Replace the DbClient wiring in the service layer.

## Migration strategy
- SQL-only migrations in `concepts/data-layer/migrations`.
- `migrations` table tracks applied migration filenames.
- Migrations are applied in lexical order.

## Export/import path (SQLite → Postgres)
1. Export SQLite tables to JSON (id-preserving).
2. Apply migrations to a fresh Postgres DB.
3. Import JSON into Postgres using parameterized inserts.
4. Swap DbClient in config.

## Configuration
- SQLite: `createSqliteClient({ filename })`
- Postgres (future): `createPostgresClient({ connectionString })`
