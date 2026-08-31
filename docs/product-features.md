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

Shopping exists on two surfaces today: inside the web app (`apps/web`), and as a
standalone installable PWA at `/shoppinglist` (`apps/shopping`). Both read and write
the same API, the same workspace, and the same trained aisle order. The web app's
shopping surface stays authoritative until the PWA has been verified side by side.

### Web app surface

- Multiple shopping lists
- Shopping inbox capture and later assignment
- List completion and archive behavior
- Item editing, move, substitution, and unavailable outcomes
- Task-to-shopping conversion for leaf tasks
- Two links out to the beta PWA, both pointing at `/shoppinglist`: a "Shopping · Beta"
  entry in the module navbar, and a "Beta app" link in the shopping panel header. The
  navbar is hidden below the mobile breakpoint, so the panel link is how a phone gets
  there. Neither replaces anything — this surface stays fully operational.

### Shopping PWA (`/shoppinglist`)

- Installable, offline-first: launches, renders and accepts edits with no network
- Every write is applied locally and queued, then replayed to the API in order.
  A 4xx halts the queue for attention; 5xx and network failures retry with backoff,
  and reconnecting (or reopening the app) cancels the backoff and retries at once
- Status banner distinguishes "offline", "can't reach the server", and "sync blocked"
- Lists: create, rename, set store and shopping day, complete/reopen, delete
- Items: single add, multi-line paste to add many at once (bullets and numbering
  stripped, duplicates dropped), tap to mark bought, drag to reorder, rename,
  move to another list, delete
- Item outcomes: bought, substituted (with the substitute name), couldn't get it
- Filters: open lists, done lists, all; optional hiding of bought items

#### Sign-in and workspace

With `BRIANHUB_REQUIRE_AUTH` on, the PWA shows a sign-in screen before it can sync;
`/auth/me`, `/auth/login` and `/health` are the only routes reachable without a
session. The cached lists still render offline once signed in.

The app shows one workspace at a time — whichever the account landed on. Accounts
with more than one get `Switch workspace…` in the menu, and an empty list screen
points at it, since "no lists" for an account with several workspaces usually means
the lists are in a different one. Switching flushes the write queue first and
refuses to switch while anything is still unsent, so offline edits cannot be
stranded against a workspace that is no longer shown.

#### The needs queue

`Stuff we need` is a standing backlog, pinned above the trips on the lists screen.
It is an ordinary shopping list on the server — so it syncs and works offline like
everything else — but it never appears as a shopping trip and is never "completed".

Each item can be marked as sold only at a particular store (`Where to buy it…` in
the item menu), or left available anywhere, which is the default. The store can be
typed in, so `only at Bunnings` can be recorded before any Bunnings list exists.

On a trip, `Needs` offers the queue filtered to what that store actually sells:
everything unrestricted, plus anything restricted to this store. Chosen items are
added to the trip and leave the queue. They are added fresh rather than moved, so
they land in the learned aisle position for that store.

A trip with no store set only sees unrestricted items — nothing can promise a
restricted item is available at an unnamed shop.

#### How often things get bought

Ticking an item off records a purchase, and the gaps between purchases give an
estimate of how often it is bought. The **median** gap is used, not the average, so
one holiday-sized gap cannot turn a weekly item into a monthly one. Two purchases
give one interval, which is treated as a guess: such an item must be clearly
overdue (25% past its interval) before it is suggested at all.

Cadence is reported as `about weekly`, `about fortnightly`, `about monthly`,
`every couple of months` or `now and then`, and appears against each item in the
`Usual` picker along with when it is next expected.

Items at or past their interval appear in a `Probably due` strip at the top of a
list, filtered to what that store sells, excluding anything already on the list.
`Add all` puts the lot on the trip in one tap. Something bought only once has no
interval and is never guessed at.

Purchase history rebuilds from the server on a new device, since bought items carry
the time they were ticked.

#### Learning the aisle order

The order items are **ticked off** is recorded, and completing a list writes that
sequence back as the per-store order. Walking the shop once teaches it; no dragging
is required. Dragging still works and still teaches, it is just no longer the only
way. Next time, items added to a list at that store arrive already in that order.

The store name is the key the order is learned against, so a list with no store
learns nothing. To stop that happening silently: a new list pre-fills the store
field with the last store used, and completing a list with no store says so.

Ticking a single item teaches nothing (one tick implies no ordering), and items
left un-ticked keep their relative position behind the ones that were.

#### Usual items

Every item ever added builds a per-device catalogue, which powers the `Usual`
picker next to the add box and the type-ahead suggestions in it. Entries are
ranked by how often they are bought, weighted towards this store and towards
recent use, and anything already on the current list is filtered out. Multi-select
adds several at once. The catalogue outlives the lists it came from, seeds itself
from existing server history on first run, and individual entries can be dropped
with `×`.

#### Standardised item names

The same item typed differently across trips is treated as one item. Case,
punctuation, accents, plurals, filler words and **word order** are all ignored, so
`Milk 2L`, `2L milk` and `Milk, 2 L` are the same thing. Quantities are not
ignored: `Milk 2L` and `Milk 3L` stay separate, as do `Chicken` and `Chicken stock`.
Only formatting is ever resolved automatically — a different word or a different
amount always means a different item.

When an item is added that matches something bought before, it is entered under
the spelling used most often, and the app says so. An item never bought before is
kept exactly as typed. This also protects the aisle order: the server keys its
per-store hints on the item name, so three spellings of one item would otherwise
train three separate half-learned positions.

`Tidy up item names…` in the menu handles names that already drifted. It groups
entries that differ only by a quantity or packaging word (`Milk` / `Milk 2L`) or
that are within two characters of each other (`Yoghurt` / `Yogurt`), and never
groups things that differ by a real word. Merging picks one spelling, renames the
item everywhere it is still on a list, and records the old spelling as an alias so
typing it again lands on the kept name rather than recreating what was tidied away.

One limit worth knowing: aisle-order hints already learned under a merged-away
spelling are orphaned on the server, since hints are keyed by name. They are
harmless — they simply stop matching — and the kept name relearns its position on
the next completed shop.

Adding something already waiting on the current list is skipped rather than
duplicated. Re-adding something already ticked off does add it again.

#### Checked items get out of the way

Ticked items leave the working list and collapse into an `In the trolley (n)`
group at the bottom, so what is left to get stays at the top of the screen instead
of being scattered between things already in the trolley. The group expands to
correct a mis-tap, and lists the most recently ticked item first.

Not carried over from the web surface: the shopping inbox and task-to-shopping
conversion, both of which belong to the task module.

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
