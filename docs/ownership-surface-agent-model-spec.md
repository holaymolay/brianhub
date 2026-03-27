# BrianHub Ownership, Surface, and Agent Model Spec

## Purpose

This spec replaces the current muddled "org as workspace" behavior with a stable product model that supports:

- personal user surfaces
- separate organization surfaces
- clear ownership of records
- safe collaboration between humans
- personal agents as the next priority
- admin-managed Roger continuity without breaking the current live path

This is intended to be the implementation source of truth before further UI or auth changes.

## Why This Exists

BrianHub currently has a structural mismatch:

- workspaces were introduced first as the core container
- orgs and collaboration were added later
- users are org-scoped
- many routes still treat the org as the default workspace universe

That leads to incorrect behavior, including:

- users seeing workspaces they should not see
- stale workspace/task data surviving identity changes in the client
- product confusion about whether an org is a workspace, a team, or a principal

The target model is different:

- `User` and `Organization` are separate entities
- records belong to exactly one owner
- users can have multiple workspaces
- organizations do not have multiple workspaces
- an organization is its own surface and collaboration/transaction layer
- a user workspace may choose to surface org-owned data without changing ownership

## Non-Negotiable Product Rules

1. Every record belongs to exactly one owner.
   Owner is either a `user` or an `organization`.

2. Personal data is never exposed through org membership.

3. Organization data is shared only through org membership and org-scoped roles.

4. User workspaces are user-owned operating surfaces.

5. Organizations are not workspaces.
   An org is a distinct operating entity with its own surface.

6. A user may choose to integrate org data into one of their own workspaces, but that is a view-layer choice only.
   It does not change who owns the records.

7. Roger must continue to work during the migration.

8. Personal agents are the next agent priority.
   Org agents and janitor/system agents come later.

## Core Domain Model

### Principals

- `user`
  - natural person/operator
  - has login/session identity
  - has personal workspaces
  - will be able to own personal agents

- `organization`
  - distinct collaborative/transactional entity
  - has members and roles
  - has its own surface and owned records
  - may later own org agents

- `system`
  - reserved for janitor/custodian/break-glass concerns
  - not part of normal user-facing ownership

### Ownership

Every owner-aware record must support:

- `owner_type`: `user` | `organization`
- `owner_id`

Initial core entities that must become explicitly owner-aware:

- workspaces
- tasks
- projects
- service accounts / agents
- activity/audit records where relevant

### Surfaces

- `user surface`
  - personal shell for a user account
  - contains personal workspaces and personal settings

- `organization surface`
  - separate shell for an org
  - contains org-owned tasks, projects, settings, and later org-owned agents

- `workspace`
  - a user-owned operating surface
  - may display:
    - the user's own records
    - selected org-owned records from orgs the user belongs to
  - does not own org data

### Integration Rule

User workspaces may mount or surface organization data.

That means:

- a task owned by `Pipe Cam` is still owned by `Pipe Cam`
- a task owned by `Brian` is still owned by `Brian`
- the same user workspace may show both if the user chooses that setup

This is a display decision, not an ownership rewrite.

## Target Product Information Architecture

### Primary Navigation

- `My Workspaces`
- `Organizations`
- `Settings`
- `Org Settings` when inside an organization and the user has the right role
- `Admin Console` for high-privilege system/admin functions only

### User Surface

User-facing areas:

- personal workspaces
- personal settings
- `My Agents`

### Organization Surface

Org-facing areas:

- org overview
- org tasks
- org projects
- org notes/records as they exist today or later
- org settings

Organizations behave much like corporations:

- they are separate entities
- humans operate them
- they are not reducible to one member's personal surface

### Admin Console

Long-term purpose:

- user account administration
- janitor/system bots
- org-level emergency overrides
- audit and break-glass controls

It is not the final permanent home for personal agents.

## Agent Model

### Phase Priority

1. Preserve current Roger path.
2. Build personal agents.
3. Add org agents later.
4. Add janitor/system agents last.

### Roger

Roger remains:

- admin-provisioned for now
- service-account based
- focused on Brian's current workspaces/surfaces

Roger must not be broken by any ownership migration.

### Personal Agents

Personal agents are owned by a user and always bounded by:

- owner user's current access
- agent baseline permissions
- token narrowing constraints
- mounted/surfaced entity access
- endpoint policy

Effective access:

`effective_access = owner_user_access ∩ agent_permissions ∩ token_constraints ∩ endpoint_policy`

If user workspace mounting is introduced, the agent still acts only against source ownership the user can already reach.

### Org Agents

Later, org agents are owned by the organization and bounded by:

- org role/policy
- org-owned permissions
- token constraints
- endpoint policy

### System Agents

Reserved for janitor/custodian/admin-level operation.

## Authorization Rules

### Visibility

A user can see:

- their own personal workspaces
- records owned by themselves
- organizations they belong to
- records owned by those organizations
- org-owned data surfaced into one of their workspaces if configured

A user cannot see:

- another user's personal workspaces
- another user's personal records

### Record Access

For user-owned records:

- only the owner user and their authorized personal agents can access them

For org-owned records:

- access is determined by org membership, org role, and endpoint policy

### Workspace Rules

User workspace access is not derived from org membership.

Org membership only grants access to organization-owned data.

If a user workspace surfaces org data:

- access is evaluated against the source org ownership
- not against the workspace itself as if it owned that data

## Current-State Bugs That Must Be Fixed First

These are blocking correctness issues and must be fixed before any larger UI redesign.

### 1. Workspace listing leak

Current behavior:

- `GET /workspaces` returns all workspaces for an org for human users

Why this is wrong:

- user workspaces should be user-scoped
- org membership should not imply visibility into another user's personal workspaces

Required fix:

- split workspace listing into:
  - `listUserOwnedWorkspaces(user_id)`
  - optional mounted org surface listings
- stop using `listWorkspaces(org_id)` as the normal human path

### 2. Client cache leakage across identities

Current behavior:

- auth identity changes do not fully clear workspace/task/project domain state
- failed reloads can leave stale data on screen

Required fix:

- on auth identity change:
  - clear active workspace
  - clear tasks
  - clear projects
  - clear users
  - clear workspace memberships
  - clear all workspace-scoped caches
- on `403` or workspace load failure:
  - clear the visible workspace state for that workspace immediately

### 3. Overloaded org/workspace semantics

Current behavior:

- org membership and workspace membership are blurred

Required fix:

- formalize ownership and access separately
- stop treating org as the default source of all workspace records

## Backend Implementation Plan

## Phase 0: Correctness Guardrails

Ship first:

1. Fix `/workspaces` human scoping.
2. Fix client auth-change cache clearing.
3. Fix failed workspace reload behavior.
4. Audit all routes that currently default to `org_id`.
5. Add regression tests for user isolation.

Stop-ship invariants:

- a newly created user must never see another user's personal workspaces
- a newly created user must never see another user's personal tasks/projects
- logging out and logging in as a different user must not preserve prior workspace data

## Phase 1: Ownership Columns and Compatibility

Add explicit ownership to core entities without removing existing fields yet.

### Schema

Add:

- `owner_type` to `workspaces`
- `owner_id` to `workspaces`
- `owner_type` to `tasks`
- `owner_id` to `tasks`
- `owner_type` to `projects`
- `owner_id` to `projects`

Compatibility rule:

- keep existing `workspace_id` references during the migration
- backfill ownership from current known behavior

Backfill rules:

- current personal workspaces become `owner_type = 'user'`
- existing shared/team workspaces that are truly org-owned become `owner_type = 'organization'`
- tasks and projects inherit ownership from their workspace during backfill

### Service Accounts / Agents

Do not disrupt the existing Roger service-account path.

Add ownership compatibility in a later schema step:

- `owner_type`
- `owner_id`

But keep current admin-managed Roger records working until personal-agent UX is ready.

## Phase 2: Workspace as User Surface

Refactor workspace semantics:

- workspaces are user-owned operating surfaces
- organizations are separate entities

Add a mounting/surfacing table for workspace composition:

- `workspace_sources`
  - `id`
  - `workspace_id`
  - `source_type` = `user` | `organization`
  - `source_id`
  - `sort_order`
  - `created_at`
  - `updated_at`

Rules:

- a user workspace must include its owner user as a source
- an org source can be mounted only if the user belongs to that org
- mounting an org into a workspace does not change record ownership

## Phase 3: Query and Policy Refactor

Introduce central source-aware policy helpers:

- `canViewUserSurface(user, targetUserId)`
- `canViewOrganization(user, orgId)`
- `canAccessRecord(principal, ownerType, ownerId, action)`
- `listVisibleWorkspaces(principal)`
- `listVisibleRecordsForWorkspace(workspaceId, principal)`

Query strategy:

- user-owned records query by `owner_type = 'user' AND owner_id = ?`
- org-owned records query by `owner_type = 'organization' AND owner_id = ?`
- workspace views assemble visible records from mounted sources

## Phase 4: UI Restructure

### User-facing

Add:

- `My Workspaces`
- `Organizations`
- `Settings -> My Agents`

### Org-facing

Add:

- `Organization surface`
- `Org Settings`

### Admin-facing

Reduce Admin Console to:

- users
- janitor/system bots
- audits
- break-glass

## Phase 5: Personal Agents

Add a user-facing `My Agents` surface.

Core capabilities:

- create personal agent
- choose permissions
- choose which workspaces/org surfaces it may operate against
- mint/rotate/revoke tokens
- view recent activity

Personal agents must never exceed the owning user's actual access.

## API and Route Changes

### Keep

- current routes where possible for compatibility

### Add

- user-scoped workspace listing route semantics
- org listing routes that are distinct from workspace listing
- source-aware record queries
- user-facing personal-agent routes under settings

### Deprecate

- routes whose semantics assume "org = workspace universe"

## UI/UX Design Rules

1. Show ownership/source explicitly.
   Records shown in a workspace that surfaces org data must visually indicate their source.

2. Default to separation.
   Personal and org surfaces are separate by default.

3. Allow integration intentionally.
   A user can add an org source into a workspace if they want a combined operating view.

4. Creation must be explicit about destination owner.
   When creating a task/project/note, the UI must make clear whether it is being created for:
   - the user
   - the organization

5. Transfer between owners must be explicit.
   No silent reassignment.

## Migration Strategy

### Guiding Principle

Do not big-bang rewrite this in one deploy.

The way to "do it right" is:

- define the target model once
- add compatibility fields
- ship correctness fixes first
- migrate queries and UI in controlled steps
- preserve Roger throughout

### Deployment Sequence

1. Phase 0 correctness fixes
2. ownership schema additions and backfill
3. policy/query changes behind compatibility logic
4. new navigation and surfaces
5. personal agents
6. org settings
7. admin console narrowing

### Roger Safety

At every phase:

- Roger token auth must continue to work
- Roger must continue to operate against Brian's intended surfaces
- no migration step may require recreating Roger before cutover

## Test Plan

### Isolation

- user A cannot list user B's workspaces
- user A cannot see user B's tasks/projects after fresh login
- switching users clears prior workspace state fully

### Organization

- org member can see org-owned records
- org member cannot see another member's personal records
- leaving an org immediately removes org-owned visibility

### Workspace Surfacing

- user workspace shows mounted org records only when configured
- mounted org records remain org-owned
- create flow respects selected owner destination

### Agents

- Roger remains functional through each migration phase
- personal agent cannot exceed owner user access
- personal agent loses access immediately when user loses access

## Open Decisions Deferred on Purpose

These do not need to block the core ownership fix:

- whether orgs later have internal departments/areas beyond projects
- richer org-agent model
- janitor/system-bot UX
- combined dashboards that blend multiple sources more aggressively

## Immediate Next Step

Implement Phase 0 first.

Do not start with a broad UI redesign.

The first code pass should:

- fix workspace visibility
- fix auth-change cache clearing
- fix stale-data retention on failed workspace loads
- add regression coverage for user isolation

Only after those invariants are true should the ownership migration start.
