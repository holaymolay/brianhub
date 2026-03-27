# BrianHub UI Wireframe Spec

## Purpose

This is a single-pass wireframe spec meant to unblock implementation.

It is intentionally:

- functional
- low-polish
- explicit enough to build from

It is not the final UI/UX design system document.

## Global Shell

### Desktop

Top shell:

- app title / search
- account menu
- module nav:
  - Tasks
  - Scheduling
  - later CRM / Knowledge

Left rail:

- `My Workspaces`
- `Organizations`
- `Settings`
- `Admin Console` only when authorized

Main pane:

- selected surface content

### Mobile

Top title / menu switcher:

- My Workspaces
- Organizations
- Settings

Bottom nav remains module-oriented:

- Tasks
- Projects
- Shopping
- Workflows

Current surface must always be visibly labeled:

- personal workspace name
- or org name

## 1. My Workspaces

### Purpose

User-owned operating surfaces.

### List Screen

Header:

- `My Workspaces`
- `New Workspace`

List rows:

- workspace name
- type
- optional mounted org badges
- last activity

States:

- empty: `No workspaces yet`
- loading
- populated

### Workspace Screen

Header:

- workspace name
- owner: `You`
- mounted org badges if present
- `Manage Workspace`

Body:

- normal module content for that workspace

Important UI rule:

If the workspace is surfacing org data, creation UI must show destination clearly:

- `Create in Personal`
- `Create in <Org Name>`

## 2. Organizations

### Purpose

Directory of organizations the user belongs to.

### Organization Directory

Header:

- `Organizations`

List rows:

- org name
- your role
- last activity

States:

- empty: `You are not a member of any organizations`
- loading
- populated

### Organization Surface

Header:

- org name
- your role
- `Org Settings` if authorized

Subnav:

- Overview
- Tasks
- Projects
- later additional modules

Body:

- org-owned content only

No personal workspace controls should appear as native org controls.

## 3. Settings

### Tabs

- General
- Tasks
- Scheduling
- My Agents
- Help / Data / Audit links as needed

## 4. My Agents

### Purpose

Personal self-serve bot management.

### Layout

Left column:

- agent list
- `New Agent`

Right column:

- selected agent detail

### Agent List Row

- name
- status
- active tokens
- last used

### Agent Detail

Sections:

- Overview
- Access
- Tokens
- Activity
- Settings

#### Overview

- name
- status
- summary cards:
  - permissions
  - workspaces
  - active tokens
  - last used

#### Access

- baseline permissions
- accessible workspaces
- optional visible org sources later

#### Tokens

Token table:

- label
- public id
- status
- last used
- expires

Actions:

- Create token
- Rotate
- Revoke

Token reveal must be a modal, not inline.

#### Activity

- recent lifecycle and access events

#### Settings

- rename
- archive

States:

- no agent selected
- no agents yet
- loading
- populated

## 5. Org Settings

### Purpose

Org-owner/admin configuration.

### Sections

- Org profile
- Members
- Roles
- later org agents

### Members Screen

List rows:

- user name
- email
- role
- status

Actions:

- invite member
- change role
- remove member

## 6. Admin Console

### Purpose

High-privilege system administration only.

### Sections

- Users
- Organizations
- System Agents
- Audit / Emergency Controls

The current service-account management surface should eventually move out of the mixed long-form layout and into this structure only for admin-managed bots.

## 7. Token Reveal Modal

### Required Layout

Header:

- `Copy token now`

Body:

- warning text
- raw token field
- `Copy token`

Footer:

- `Done`

Behavior:

- shown only immediately after create or rotate
- never shown again

## 8. Ownership Indicators

Where combined views exist, every row/card must make ownership obvious.

Examples:

- badge: `Personal`
- badge: `Pipe Cam`

This is required anywhere org data is surfaced inside a personal workspace.

## 9. Required Empty States

At minimum, these surfaces need explicit empty states:

- no workspaces
- no organizations
- no agents
- no tokens
- no org members

## 10. Implementation Priority

Build in this order:

1. fix current auth/workspace correctness bugs
2. add shell split:
   - My Workspaces
   - Organizations
3. build `My Agents`
4. build organization directory and org surface
5. build `Org Settings`
6. narrow `Admin Console`

## 11. Out of Scope for This Wireframe Pass

- final visual design language
- animation/motion
- advanced responsive polish
- final iconography
- full design system rules

Those can come later after the architecture works.
