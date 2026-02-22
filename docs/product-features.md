# Product features (current)

This file captures implemented behavior in the current BrianHub app.

## Modules

## 1) Tasks module

### Task management
- Task rows with editable title and metadata
- Subtasks and dependency links
- Tags for classification/filtering
- Due date, repeat, reminder, assignee, and status support
- Bulk select/edit/delete workflows
- Right-click actions for task-level operations

### Views
- `List` view
- `Kanban` view
- `Calendar` view
- `Smart` view (priority-ordered task queue behavior)

### Calendar (inside Tasks module)
- Range support: `Month`, `Week`, `Day`
- Clicking a date in month/week opens day view for that date
- Shows tasks and notices
- Does not show holidays (holidays are scheduling-only)

### Related surfaces in Tasks sidebar
- My Tasks lists (multiple list support)
- Projects
- Workflow instances/entry points
- Shopping lists and Shopping Inbox quick-add
- Notices

## 2) Scheduling module

### Calendar core
- Range support: `Month`, `Week`, `Day`
- Today/prev/next controls and date jump inputs
- Time-grid rendering for week/day
- Multiple calendar support per workspace
- Optional workweek mode support via settings

### Events and calendar items
- Event kinds: `event`, `time-block`, `day-off`
- Event create/view/edit flows
- Recurrence support
- Color by type with per-event override
- Event context menu actions (edit/copy/duplicate/delete)
- Drag-based rescheduling in week/day views

### Layers and overlays
- Layer toggles for events, time blocks, day off, tasks, holidays
- Holiday support and visibility controls (scheduling context)

## 3) Shared app capabilities

### Notices
- Standalone notices with type, recurrence, and lifecycle states
- List filters and sort options

### Shopping lists
- Multiple shopping lists
- Completion/archive behavior
- Sidebar quick-add inbox for item capture and later assignment

### Workflows
- Blueprint/instance model with active/completed instance views
- Checklist style progression inside instances

### Auth and admin
- Optional auth gate
- Session-based login
- Owner/admin roles
- Invite token flow for account creation
- Admin console for invite management and user administration

### Data and operations
- Local-first sync endpoints (`/sync/push`, `/sync/pull`)
- Import/export page
- Audit log page
- Automation console page
- Backup scripts (snapshot, retention, restore-check)

## 4) Mobile behavior
- Mobile-adaptive shell and bottom navigation
- Module switch via mobile title menu
- Scheduling module has mobile-focused calendar controls
- Some builder/admin-heavy features remain desktop-oriented

## 5) Not yet active
- CRM module (placeholder)
- Knowledge module (placeholder)
