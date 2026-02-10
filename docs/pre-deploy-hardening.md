# Pre-Deployment Hardening Runbook

## Scope
This runbook tracks the hardening pack execution for BrianHub pre-deployment readiness.

## Baseline Inventory (HARD-A1)

### API route groups currently implemented
- Health: `/health`
- Sync: `/sync/push`, `/sync/pull`
- AI stub: `/ai/suggest`
- Workspaces + org + users:
  - `/workspaces`, `/workspaces/:id`
  - `/orgs`
  - `/users`, `/users/:id`
  - `/workspace-memberships`, `/workspace-memberships/:id`
  - `/admin/info`, `/admin/invites`
- Tasks:
  - `/tasks`, `/tasks/:id`, `/tasks/tree`, `/tasks/search`
  - `/tasks/:id/reparent`, `/tasks/:id/checkin`, `/tasks/:id/reschedule`
  - `/task-dependencies`, `/task-dependencies/:taskId/:dependsOnId`
- Projects/templates/status/task types:
  - `/projects`, `/projects/:id`
  - `/templates`, `/templates/:id`
  - `/statuses`, `/statuses/:id`
  - `/task-types`, `/task-types/:id`
- Notices + notice types:
  - `/notices`, `/notices/:id`
  - `/notice-types`, `/notice-types/:id`
- Shopping:
  - `/shopping-lists`, `/shopping-lists/:id`
  - `/shopping-items`, `/shopping-items/:id`
  - `/store-rules`, `/store-rules/:id`

### Existing sync contract touchpoints
- Client queue/replay:
  - `apps/web/syncQueue.js`
  - `apps/web/syncState.js`
- API endpoints:
  - `POST /sync/push`
  - `POST /sync/pull`

## Baseline Patterns (HARD-A2)
- Server framework: Fastify v4.
- Prior to hardening, input checks were largely route-local `if (!field)` checks.
- Error responses were mixed (`{ error: "..." }`, ad-hoc status handling).
- Config was read ad-hoc from `process.env` in multiple modules.

## DB Safety Audit Notes (HARD-A3)
- Task service and data-layer query calls use positional params (`?`) consistently.
- No SQL string interpolation using template placeholders was found in:
  - `services/api/src/taskService.js`
  - `concepts/data-layer/*`
- Remaining hardening action: formalize route-level schema validation and sanitization hooks.

## Implemented Hardening (current pass)
- Added backend config module with fail-fast validation:
  - `services/api/src/config.js`
- Wired DB config through validated config:
  - `services/api/src/db.js`
- Added request id generation/propagation:
  - accepts `x-request-id` and returns `x-request-id`
- Added structured request completion logs:
  - requestId, method, url, route, statusCode, latencyMs
- Added centralized not-found and error handlers with safe error shape:
  - `{ error: { code, message, requestId } }`
- Added frontend runtime config:
  - `apps/web/config.js`
- Added frontend logger:
  - `apps/web/logger.js`
- Updated API client to:
  - use runtime API base
  - send `x-request-id`
  - parse structured error payloads
  - emit/log request-id-aware failures

## How To Run

### Dev
```bash
npm run dev
```

### Tests
```bash
npm test
```

### Migrations
```bash
npm run migrate
```

## Offline sync simulation (current)
1. Start app with `npm run dev`.
2. Open browser DevTools, switch Network to Offline.
3. Create/update tasks so local queue accumulates changes.
4. Re-enable network.
5. Confirm queued changes replay and UI re-syncs.

## Security scan
- Run:
  ```bash
  npm run security:semgrep
  ```
- Semgrep sources:
  - local config: `.semgrep.yml`
  - upstream baseline: `p/ci`
- The command attempts local `semgrep`, then Docker (`returntocorp/semgrep`), and prints a warning if neither is available.

## Next execution steps
1. Complete any remaining route schemas and response schemas where missing (`HARD-D1`).
2. Expand conflict integration coverage for additional entities if needed (`HARD-F4` follow-up).
3. Finalize docs/runbook parity in `README.md` and close acceptance checks (`HARD-I*`, `HARD-AC*`).
