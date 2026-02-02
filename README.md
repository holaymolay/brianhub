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

Web UI runs at:
```
http://localhost:5173
```

API runs at:
```
http://localhost:3000
```

## Data
- Local sqlite DB: `services/api/db/brianhub.sqlite`
- Migrations live in: `services/api/db/migrations`

## Notes
- "Notices" are standalone items.
- Task "reminders" are due-date alerts tied to tasks.
