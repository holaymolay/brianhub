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
- Tests (state machine + tree invariants): ✅

## Gaps to Close
1) Local‑first offline persistence in the client
2) Check‑in UX (Yes / No / In‑Progress)
3) Waiting/pending follow‑up UX
4) AI suggestions UI (stub)
5) Search/filter UI
6) Inbox view/filter
7) Urgency (decide: remove from M1 or re‑introduce as a field)

## Task Tracking (M1)

### P0 — Must ship
- [ ] Implement local‑first task storage (offline source of truth)
  - [ ] Persist tasks/workspaces/statuses locally (indexed or localStorage)
  - [ ] Queue changes for sync (change log)
  - [ ] Merge incoming server changes via cursor
  - [ ] Offline mode: UI fully usable without backend
- [ ] Add check‑in UX
  - [ ] Trigger when task.next_checkin_at is due
  - [ ] UI for Yes / No / In‑Progress
  - [ ] Write response to `/tasks/:id/checkin`
- [ ] Add waiting/pending follow‑up UX
  - [ ] Surface tasks with waiting status + follow‑up date
  - [ ] Clear / reschedule follow‑up when user acts
- [ ] Add AI suggestions UI (stub)
  - [ ] Call `/ai/suggest` and display suggestions
  - [ ] Explicit accept/reject (no auto‑mutations)
- [ ] Add search/filter UI
  - [ ] Text search via `/tasks/search`
  - [ ] Inline filter controls (list view)

### P1 — Usability polish
- [ ] Add Inbox view/filter
- [ ] Confirm urgency decision (remove vs re‑introduce)
- [ ] Ensure “Add task” input never loses focus while typing

### P2 — Tests & correctness
- [ ] Add tests for reparenting correctness (server + client)
- [ ] Add tests for check‑in behavior edge cases
- [ ] Add tests for waiting follow‑up scheduling

## Acceptance Criteria (M1 complete)
- Works fully offline; no data loss if backend is down
- Unlimited nesting works; reparenting doesn’t corrupt tree
- Check‑ins are promptable and actionable
- Waiting tasks resurface as intended
- Search/filter works in list view
- AI suggestions visible and explicitly accepted/rejected

## Progress Log
- YYYY‑MM‑DD: Created M1 plan and gap list
