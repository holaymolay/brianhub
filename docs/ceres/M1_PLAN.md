# M1 Plan & Task Tracking — Task Core (Local‑First)

This is the execution checklist for M1. It is intentionally focused only on Task Core.

## Scope (M1 only)
- Local‑first Task Core (usable offline)
- Unlimited task nesting (closure table)
- Task state machine + check‑ins
- Waiting/pending follow‑ups
- Sync cursor + change log (cloud stub)
- Minimal web UI for list + task detail + inline subtasks
- AI stub (suggestions only; no mutation)
- Tests for state machine + nesting invariants
- Workflows (templates → variants → phases → scaffolded tasks)
  - Workflow instance is a separate entity linked to tasks
  - Phases are milestones (grouping only, not tasks)
  - Tasks can have dependencies; assignments support users or free‑text people

## Out of Scope (explicitly excluded)
- Notes / markdown
- Capture / transcription
- Scheduling / time‑blocking / calendar integrations
- Team collaboration / permissions

## Current Status Summary
- Data model: ✅
- Task API + check‑in endpoint: ✅
- Change log + sync cursor: ✅
- Basic web UI: ✅
- Tests (state machine + tree invariants + edge cases): ✅

## Gaps to Close
1) None blocking for M1 (all previously identified M1 gaps have been closed)

## Task Tracking (M1)

### P0 — Must ship
- [x] Implement local‑first task storage (offline source of truth)
  - [x] Persist tasks/workspaces/statuses locally (indexed or localStorage)
  - [x] Queue changes for sync (change log)
  - [x] Merge incoming server changes via cursor
  - [x] Offline mode: UI fully usable without backend
- [x] Add check‑in UX
  - [x] Trigger when task.next_checkin_at is due
  - [x] UI for Yes / No / In‑Progress
  - [x] Write response to `/tasks/:id/checkin`
- [x] Add waiting/pending follow‑up UX
  - [x] Surface tasks with waiting status + follow‑up date
  - [x] Clear / reschedule follow‑up when user acts
- [x] Add AI suggestions UI (stub)
  - [x] Call `/ai/suggest` and display suggestions
  - [x] Explicit accept/reject (no auto‑mutations)
- [x] Add search/filter UI
  - [x] Text search via `/tasks/search`
  - [x] Inline filter controls (list view)
- [x] Add workflow templates + instances
  - [x] Define workflow template (variants + phases + tasks)
  - [x] Create workflow instance (title + notes only)
  - [x] Scaffold tasks from template with phase grouping
  - [x] Track instance open/closed based on linked task completion
  - [x] Support task dependencies inside workflow scaffold
  - [x] Support assignees (user id or free‑text person)

### P1 — Usability polish
- [x] Add Inbox view/filter
- [x] Confirm urgency decision (remove from M1)
- [x] Ensure “Add task” input never loses focus while typing

### P2 — Tests & correctness
- [x] Add tests for reparenting correctness (server + client)
- [x] Add tests for check‑in behavior edge cases
- [x] Add tests for waiting follow‑up scheduling

## Acceptance Criteria (M1 complete)
- Works fully offline; no data loss if backend is down
- Unlimited nesting works; reparenting doesn’t corrupt tree
- Check‑ins are promptable and actionable
- Waiting tasks resurface as intended
- Search/filter works in list view
- AI suggestions visible and explicitly accepted/rejected
- Workflow instance scaffolds tasks by phase and remains open until all tasks complete

## Progress Log
- YYYY‑MM‑DD: Created M1 plan and gap list
- 2026-02-08: Closed P0 items for offline storage, check-ins, waiting follow-up UX, AI stub UI, and workflow template/instance scaffolding.
- 2026-02-10: Closed remaining M1 gaps for `/tasks/search` UI wiring, Inbox filter, workflow assignee parity, and additional tree/check-in/waiting edge-case tests.
