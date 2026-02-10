# BrianHub

BrianHub is a lightweight task hub with list, kanban, and calendar views, plus shopping lists and standalone notices.

## Features (high level)
- Tasks with subtasks, dependencies, and due-date reminders
- List, kanban, and calendar views
- Shopping lists with store selection
- Notices (standalone alerts) with types, sorting, and filtering

## Development

Install dependencies:
```
npm install
```

Run the dev server (API + web UI):
```
npm run dev
```

Run tests:
```
npm test
```

Run static security scan:
```
npm run security:semgrep
```

Web UI runs at:
```
http://localhost:5173
```

API runs at:
```
http://localhost:3000
```

## Data
- Local sqlite DB: `data/brianhub.sqlite` (or `BRIANHUB_DB`)
- Migrations live in: `services/api/db/migrations`

## Backups
Run an on-demand backup:
```
npm run backup:db
```

Run retention-only cleanup:
```
npm run backup:retention
```

Run restore integrity check against latest backup:
```
npm run backup:restore-check
```

Backup behavior:
- Snapshot DB file, gzip it, optional AES-256-GCM encryption, optional upload.
- Retention policy defaults to:
  - Keep last 7 daily snapshots.
  - Keep 52 weekly snapshots after that.
  - Keep quarterly snapshots for anything older.
- Configure with env vars:
  - `BRIANHUB_BACKUP_DIR` (default `data/backups`)
  - `BRIANHUB_BACKUP_PREFIX` (default `brianhub`)
  - `BRIANHUB_BACKUP_ENCRYPTION_KEY` (optional)
  - `BRIANHUB_BACKUP_UPLOAD_DIR` (optional offsite mounted directory)
  - `BRIANHUB_BACKUP_S3_URI` (optional S3 destination)
  - `BRIANHUB_BACKUP_DAILY_KEEP_DAYS` (default `7`)
  - `BRIANHUB_BACKUP_WEEKLY_KEEP_WEEKS` (default `52`)

Scheduling templates:
- systemd: `scripts/systemd/brianhub-backup.service` + `scripts/systemd/brianhub-backup.timer`
- cron: `scripts/cron/brianhub-backup.cron`

## Notes
- "Notices" are standalone items.
- Task "reminders" are due-date alerts tied to tasks.
- Sync endpoints enforce request validation and return request-correlated error payloads.
