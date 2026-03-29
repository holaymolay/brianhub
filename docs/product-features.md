# Product features (current)

This file captures the behavior currently implemented in BrianHub.

## Top-level model

- A human account can have multiple personal workspaces.
- Organizations are separate operating entities, not workspaces.
- Opening an organization switches the app into that organization’s operating surface.
- Organization settings are separate from the organization operating surface.
- Service workers are managed identities that stay inert until they receive a token.

## Workspaces

- `GET /workspaces` is membership-scoped for human users.
- Personal workspaces are isolated to their owner.
- Workspace creation automatically enrolls the creator as a member.
- Workspace management includes active, archived, and mobile switcher flows.

## Organizations

- Users can create organizations from Settings.
- Organization creators become the `owner`.
- Organization roles are `owner`, `admin`, and `member`.
- Organization members can be added by email or user id.
- Organization ownership can be transferred explicitly.
- Organizations have their own operating surface for tasks, projects, shopping, notices, workflows, and scheduling.
- Organization settings handle membership, roles, and ownership changes.

## Tasks

### Core task management
- Task rows with editable title and metadata
- Subtasks and dependency links
- Tags for classification and filtering
- Due date, repeat, reminder, assignee, and status support
- Bulk select, bulk edit, and bulk delete flows
- Context menu actions and keyboard-aware editing flows

### Views
- `List`
- `Kanban`
- `Calendar`
- `Smart`

### Lists and sections
- Multiple task lists per workspace
- `Inbox` and `Unassigned` task scopes
- Sections are represented by `task.group_label`
- Section ordering, rename, and delete flows are supported in the web app

### Search and filtering
- Search by title and description
- Tag filter
- Scope switching between `My tasks`, `Inbox`, `Unassigned`, lists, and projects
- On mobile, task scope is available from the task header rather than only from the tools sheet

### Related task-adjacent surfaces
- Projects
- Organization-scoped projects when an org is active
- Workflow instances and checklist surfaces
- Shopping inbox quick-add
- Notices

## Projects

- Project listing, create, update, archive, and delete
- Project rows appear directly in the sidebar
- When an organization is active, project rows swap to that org’s data

## Shopping

- Multiple shopping lists
- Shopping inbox capture and later assignment
- List completion and archive behavior
- Item editing, move, substitution, and unavailable outcomes
- Task-to-shopping conversion for leaf tasks

## Notices

- Notice types per workspace
- Notices with recurrence and lifecycle states
- Filters for open, closed, all, upcoming, overdue, and today

## Workflows

- Workflow blueprint and instance model
- Active and completed instance views
- Checklist progression within workflow instances

## Scheduling

- `Month`, `Week`, and `Day` calendar ranges
- Multiple calendars per workspace
- Event kinds: `event`, `time-block`, `day-off`
- Recurrence support
- Mobile scheduling shell and overlays
- Layer toggles for events, time blocks, day off, tasks, and holidays

## Auth, admin, and service workers

### Human auth
- Session-based login
- Invite acceptance flow for account creation
- Owner and admin roles
- `/auth/me` exposes normalized actor context

### Admin users
- User listing and filtering by org or workspace
- Role updates
- Password reset
- Export
- Archive and delete guardrails

### Service workers
- Service workers are created and managed in Admin Console today
- Worker identity is separate from token issuance
- Tokens are named, optionally narrowed, and optionally expiring
- Raw token secrets are shown once at create or rotate time only
- Existing tokens expose metadata only after issuance
- Workspace grants are explicit
- Activity history is recorded for lifecycle and access events
- In the admin users area, service workers can be filtered to the selected user when creator attribution is known

## Mobile behavior

- Dedicated mobile navigation
- Dedicated mobile create sheet
- Dedicated task tools sheet
- Direct mobile task scope switcher from the task header
- Mobile task rows reflow instead of compressing desktop rows
- Mobile task editor owns scroll and hides the footer nav while open
- One shared bottom-clearance contract for nav, sheets, and overlays
- Single-organization mobile users can jump directly into that org from the footer

## Desktop sidebar behavior

- Sidebar sections use independent scroll containers
- Sections can collapse and expand
- Sidebar rows are denser than the default panel rows
- Organizations appear alongside tasks, projects, workflows, shopping lists, and notices

## Data and operations

- Local-first sync endpoints: `/sync/push` and `/sync/pull`
- Import/export page
- Audit log page
- Automation console page
- In-app help page plus dedicated API documentation page
- Snapshot and restore scripts for VPS operations

## Not yet active

- CRM module placeholder
- Knowledge module placeholder
- Self-serve personal service worker management outside Admin Console
- Org-owned janitor/system worker UX
