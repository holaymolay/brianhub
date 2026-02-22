# BrianHub

BrianHub is a local-first planning application with two active modules:
- `Tasks` for task management, workflows, projects, shopping, and notices
- `Scheduling` for calendar-first planning (events, time blocks, and day-off entries)

## Product snapshot

### Tasks module
- Task views: `List`, `Kanban`, `Calendar`, and `Smart`
- Task hierarchy: sections, subtasks, dependencies, tags, due dates, reminders, recurrence
- Calendar view supports `Month`, `Week`, and `Day` ranges
- Week and month date-click navigation to day view
- Notices are shown in task calendar (holidays intentionally not shown in task calendar)
- Sidebar includes: task lists, projects, workflows, shopping lists, notices
- Shopping quick-add inbox in sidebar for rapid capture

### Scheduling module
- Calendar views: `Month`, `Week`, and `Day`
- Multiple user calendars with show/hide and per-calendar colors
- Event kinds: event, time block, day off
- Drag-and-drop rescheduling in time grid
- Calendar layers (events, time blocks, day off, tasks, holidays)
- Mobile-tailored scheduling experience with dedicated controls

### Shared platform features
- Local-first sync with `/sync/push` and `/sync/pull`
- Authentication and session support (optional auth requirement)
- Owner/admin console with invite tokens and user controls
- Audit log page
- Automation console page
- Import/export page
- Backup scripts with retention and restore-check tooling

For detailed module behavior, see `docs/product-features.md`.

## Stack
- Frontend: vanilla HTML/CSS/JS (`apps/web`)
- API: Fastify v4 (`services/api/src/server.js`)
- Data: SQLite (`data/brianhub.sqlite`) via `sql.js`
- Runtime: Node.js ESM (`"type": "module"`)
- Tests: native Node test runner (`node --test`)

## Quick start

Install dependencies:
```bash
npm install
```

Run API + web in dev:
```bash
npm run dev
```

Default endpoints:
- Web UI: `http://localhost:5173/apps/web/`
- API: `http://localhost:3000`

## Common scripts

```bash
npm run dev                  # API + web
npm run dev:api              # API only
npm run migrate              # run DB migrations
npm run seed:test-data       # seed test/demo data
npm run test                 # run test suite
npm run security:semgrep     # run static security scan
npm run backup:db            # create snapshot backup
npm run backup:retention     # retention cleanup only
npm run backup:restore-check # restore integrity check
```

Auth bootstrap helper:
```bash
npm run auth:bootstrap-owner
```

## Configuration

### Core API/runtime
Key environment variables:
- `HOST` (default `0.0.0.0`)
- `PORT` (default `3000`)
- `LOG_LEVEL` (default `debug` in dev)
- `BRIANHUB_DB` (default `data/brianhub.sqlite`)
- `BRIANHUB_MIGRATIONS` (default `services/api/db/migrations`)
- `BRIANHUB_CORS_ORIGINS` (default `*` in local dev)
- `BRIANHUB_APP_ORIGIN` (optional, recommended for production)

### Auth/admin
- `BRIANHUB_OWNER_EMAIL` (default `brian@pipecaminc.com`)
- `BRIANHUB_REQUIRE_AUTH` (default `false`)
- `BRIANHUB_SESSION_COOKIE_NAME` (default `brianhub_session`)
- `BRIANHUB_SESSION_TTL_DAYS` (default `30`)
- `BRIANHUB_EXPOSE_INVITE_TOKEN` (default enabled outside production)

### Backups
- `BRIANHUB_BACKUP_DIR` (default `data/backups`)
- `BRIANHUB_BACKUP_PREFIX` (default `brianhub`)
- `BRIANHUB_BACKUP_ENCRYPTION_KEY` (optional)
- `BRIANHUB_BACKUP_UPLOAD_DIR` (optional)
- `BRIANHUB_BACKUP_S3_URI` (optional)
- `BRIANHUB_BACKUP_DAILY_KEEP_DAYS` (default `7`)
- `BRIANHUB_BACKUP_WEEKLY_KEEP_WEEKS` (default `52`)

Retention defaults:
- Keep last 7 daily snapshots
- Keep 52 weekly snapshots
- Keep quarterly snapshots for older backups

Scheduling templates:
- systemd: `scripts/systemd/brianhub-backup.service`, `scripts/systemd/brianhub-backup.timer`
- cron: `scripts/cron/brianhub-backup.cron`

## Documentation

- Documentation index: `docs/README.md`
- Product features: `docs/product-features.md`
- Security: `docs/security.md`
- Hardening/testing: `docs/pre-deploy-hardening.md`
- Domain/email rollout planning: `docs/domain-email-rollout-plan.md`

## Documentation policy

Feature changes must include documentation updates in the same workstream:
- Update `README.md` if setup, scripts, or top-level behavior changed
- Update feature docs (`docs/product-features.md` or relevant doc) when UX/behavior changes
