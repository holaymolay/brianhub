# BrianHub UI/UX Execution Plan

## Purpose

This document defines the UI/UX execution plan for BrianHub after the ownership model clarification in [ownership-surface-agent-model-spec.md](/home/holaymolay/WorkingDir/Code/brianhub/docs/ownership-surface-agent-model-spec.md).

The goal is not to incrementally patch the current shell forever. The goal is to move BrianHub to a coherent product shape where:

- users have their own personal surface
- organizations have their own separate surface
- user workspaces remain user-owned operating surfaces
- users may choose to surface org data inside a workspace
- personal agents come before org/system agents
- Roger continues working throughout

## What Is Broken Today

The current UI reflects the older "workspace-first" architecture rather than the intended product model.

Current symptoms:

- the account menu and workspace picker imply that workspace is the top-level unit of the app
- organization and workspace concepts are intermixed
- admin console is trying to be:
  - invite management
  - user administration
  - service-account management
  - token management
  - workspace grant management
  - audit/history
  all in one page
- service-account UI behaves like a long, mixed form instead of an inventory + detail workspace
- the shell does not cleanly distinguish:
  - "my personal surface"
  - "organization surface"
  - "system/admin surface"

This makes the product hard to reason about even when the underlying auth is correct.

## Product Design Principles

1. Ownership must be obvious.
   The user should always understand whether they are operating as themselves or inside an organization.

2. Navigation should follow the real entity model.
   `User`, `Organization`, `Workspace`, and `Admin` should not be collapsed into one menu.

3. Existing state should be visible before edit flows.
   Inventory first, details second, editing third.

4. The shell should be stable across surfaces.
   Personal and organization surfaces can reuse patterns, but their identity and authority must stay distinct.

5. Admin is not the default home for normal users.
   Admin Console is for high-privilege management, not everyday user/bot setup.

6. Personal agents are the first real self-serve agent flow.

7. Combined operation is allowed, but only intentionally.
   A workspace may surface org data, but the source owner remains explicit.

## UI Entity Model

The UI should revolve around these top-level entities:

- `User`
- `Organization`
- `Workspace`
- `Agent`

Their UI roles are:

- `User`
  - own account shell
  - owns personal workspaces
  - owns personal agents

- `Organization`
  - separate operating surface
  - shared collaboration/transaction layer
  - does not have multiple workspaces

- `Workspace`
  - user-owned operating desk/surface
  - may surface personal and org-owned records

- `Agent`
  - acts on behalf of a user now
  - later may act on behalf of an organization or system

## Target Information Architecture

## Global Shell

Top-level primary navigation should evolve toward:

- `My Workspaces`
- `Organizations`
- module navigation inside the active surface:
  - Tasks
  - Scheduling
  - later CRM / Knowledge
- account/settings access

### Current-to-target shell change

Today:

- module navigation exists
- workspace switcher lives in the account dropdown
- org and workspace concepts are not separated

Target:

- the user chooses a surface first
- then chooses a module within that surface

## Surface Types

### 1. User Surface

This is the user's own operating environment.

Contains:

- personal workspaces
- profile
- settings
- `My Agents`

### 2. Organization Surface

This is the organization's operating environment.

Contains:

- org overview
- org tasks
- org projects
- org records/notes as features exist
- `Org Settings`

### 3. Admin Surface

Contains only:

- user administration
- org administration
- janitor/system bots
- audit/break-glass controls

Admin is not the primary surface for normal agent setup.

## Navigation Model

## Desktop

The left side of the shell should eventually become a two-layer navigation system:

### Layer 1: surface picker

- `My Workspaces`
- `Organizations`

### Layer 2: local navigation inside the selected surface

For `My Workspaces`:

- list of the user's workspaces
- create/manage workspace
- optional mounted org indicators

For `Organizations`:

- list of organizations the user belongs to
- selecting one opens that organization surface

### Module row

Once a surface is selected, the module row remains:

- Tasks
- Scheduling
- later CRM / Knowledge

That preserves reuse of existing module navigation while fixing the ownership shell.

## Mobile

Mobile should follow the same model, but surface selection must be lightweight:

- top title dropdown or dedicated surface switcher
- explicit sections for:
  - My Workspaces
  - Organizations
  - Settings

Mobile should never hide whether the user is in:

- a personal workspace
- an organization

## Primary Screen Designs

## A. My Workspaces

Purpose:

- personal operating surfaces
- launch point for personal work
- optional surfacing of org data

### List View

Each workspace row should show:

- workspace name
- type or visual classification
- mounted org badges, if any
- last activity
- quick access count indicators when relevant

### Workspace Detail

A workspace should make it obvious that it is user-owned.

Workspace chrome should show:

- workspace name
- owner = user
- mounted org sources, if any

Creation inside the workspace must clarify destination owner when both personal and mounted org sources are visible.

## B. Organizations

Purpose:

- display all organizations the user belongs to
- let the user "enter" an org as a distinct operating entity

### Org Directory View

Each org row shows:

- org name
- role
- last activity
- quick counts if cheap to show

### Organization Surface

Entering an org should feel like entering a corporation's operating environment.

The header should show:

- org name
- user role in the org
- org-level actions/settings if authorized

Within the org:

- tasks
- projects
- shared records
- org settings

No personal workspace controls should appear as if they are native org controls.

## C. Settings

Settings should be split into:

- `Account Settings`
- `My Agents`
- linked pages like import/export/help if still needed

### My Agents

This is the highest-priority new UI after correctness fixes.

Purpose:

- allow a human user to manage their own bots/agents

Capabilities:

- create agent
- edit baseline permissions
- manage accessible workspaces/surfaces
- mint/rotate/revoke tokens
- inspect recent activity

### My Agents IA

Do not build it as one giant form.

Use:

- left inventory list of agents
- right detail workspace

Agent list row fields:

- name
- status
- active tokens
- accessible workspace count
- last used

Detail workspace sections:

- Overview
- Access
- Tokens
- Activity
- Settings

## D. Org Settings

This is separate from both personal settings and admin console.

Purpose:

- org-owner/admin configuration

Capabilities:

- org profile/config
- org members and roles
- org-level policies later
- org-owned agents later

Not in first phase:

- broad system admin functions
- janitor/system bots

## E. Admin Console

Admin Console should eventually be reduced to true high-privilege responsibilities.

Long-term sections:

- Users
- Organizations
- System Agents / Janitor Bots
- Audit / Emergency Controls

The current mixed service-account UI should not become the final universal agent-management surface.

## Agent Management UX

## UX Rule: Inventory First

For any agent management surface:

- first show what exists
- then show detail for the selected item
- only then present edit flows

That means:

- no default blank giant form as the primary experience
- no hidden current state
- no requiring the user to guess whether an agent already exists

## Token UX

Token UX must be explicit and reliable.

Required behaviors:

- token list always shows:
  - label
  - status
  - public id
  - last used
  - expires
  - inherit/narrowed state

- token creation/rotation uses a dedicated one-time reveal modal
  - strong warning
  - primary copy action
  - fallback manual select

- token reveal is not an inline afterthought

### Token modal requirements

- modal title: `Copy token now`
- raw token in selectable field
- prominent `Copy token` button
- warning that it will not be shown again
- explicit close action

## Workspace and Org Access UX

Access needs two distinct ideas:

- `what this agent/user can reach`
- `what this current surface is showing`

### Personal agent access

For personal agents, the UI should show:

- baseline permissions
- accessible personal workspaces
- optionally visible org sources if supported in that phase

### Org access inside workspaces

If a workspace surfaces org data, the UI should show source chips or banners like:

- `Personal`
- `Pipe Cam`

This avoids silent blending.

## Existing Configuration Display

This is the current major admin/service-account failure.

For any management UI, existing configuration must be visible immediately.

### For agents

Show immediately:

- existing agents
- token counts
- active token counts
- accessible workspace counts
- last used
- last activity

### For orgs

Show immediately:

- current organizations
- current role
- visible org sections/modules

### For users

Show immediately:

- current personal workspaces
- mounted org sources if any

## Visual / Interaction Design Guidance

## Desktop layout

Preferred pattern:

- inventory list on the left
- detail workspace on the right
- section tabs within the detail workspace when needed

Avoid:

- full-page megafroms
- long vertical walls of unrelated controls
- hidden side effects

## Tone

Use sober operator UI, not toy settings UI.

Service-agent and org-management surfaces should feel like:

- inventory
- authority
- auditability

## Data density

High enough for real administration, but not crammed.

Default pattern:

- summary row/cards at top
- tables/lists for real records
- modals/drawers for create/rotate/reveal actions

## Execution Plan

## Phase 0: Correctness before redesign

Do not redesign the shell on top of broken visibility.

First ship:

- workspace visibility fix
- auth-change cache clearing
- stale-data clearing on forbidden/failed workspace loads
- user-isolation regression tests

This is required before trustworthy UX work.

## Phase 1: Navigation framing

Add the conceptual shell without full migration yet:

- separate `My Workspaces` vs `Organizations` entry points
- keep existing module nav
- preserve current Roger functionality

At this phase, orgs may still use compatibility-backed data paths, but the shell must stop implying org = workspace.

## Phase 2: My Agents

Build `Settings -> My Agents` first.

This is the first major user-facing new management surface.

Deliverables:

- agent inventory
- agent detail workspace
- token modal
- access management
- activity feed

This is higher priority than org agents.

## Phase 3: Organizations shell and Org Settings

Build:

- organization directory
- org surface shell
- org settings shell

This establishes organizations as first-class entities in the UI.

## Phase 4: Admin Console narrowing

Move Admin Console toward:

- users
- organizations
- system agents
- audit/emergency controls

Remove the expectation that normal personal agent creation happens there.

## Phase 5: Org agents later

Only after personal agents and org surface are coherent.

## Screen-by-Screen Execution Order

1. Fix current auth/workspace correctness bugs.
2. Add shell entry points for `My Workspaces` and `Organizations`.
3. Build `My Agents`.
4. Build organization directory + org surface shell.
5. Build `Org Settings`.
6. Re-scope Admin Console.

## Design Review Checklist

Before shipping each surface, validate:

1. Is ownership obvious?
2. Is the selected surface obvious?
3. Can the user tell what already exists before editing?
4. Is personal vs org data clearly separated?
5. If combined in one workspace, is the source owner still obvious?
6. Are token flows reliable and one-time reveal safe?
7. Does the UI match the actual authority model?

## Immediate Next Design Deliverable

The next concrete UI/UX artifact should be a wireframe-level spec for:

- `My Workspaces`
- `Organizations`
- `Settings -> My Agents`
- `Organization Surface`
- `Org Settings`
- `Admin Console` narrowed role

That wireframe spec should be created before larger implementation work begins on the new shell.
