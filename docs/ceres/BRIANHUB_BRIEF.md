# BrianHub CERES Brief

This file is the working CERES planning reference for BrianHub.
It is intentionally separate from PROMPTLOADER (which stays immutable).

## Original Prompt

```text
You are Codex operating under CERES governance.

PROJECT: BrianHub (working name)
GOAL: Build an Android app + web front-end + backend that unifies:
- Powerful task management (ADHD-friendly, GTD-compatible)
- Second-brain knowledge capture (Tiago Forte style, markdown-first)
- Later: dynamic scheduling/time-blocking (Motion-like), AI assistance, and integrations (Google Calendar first)

NON-NEGOTIABLES
- Ask clarifying questions ONE AT A TIME (ADHD mode). Only ask when a decision is blocking.
- Start with Task Management first (highest immediate value). Everything else is modular and can come later.
- Design for scalability: can evolve from single-user to small teams, and potentially enterprise.
- No arbitrary limits on task nesting depth (infinite hierarchical subtasks).
- Support personal/work separation and future team/shared workspaces (multi-tenant concepts).
- Prefer fastest path to a working product while keeping architecture extensible.

PHASE 0 — OUTPUTS REQUIRED IMMEDIATELY (READABLE + ACTIONABLE)
1) A concise system overview in plain English (1 page max).
2) A modular architecture outline (components, boundaries, responsibilities, interfaces).
3) A step-by-step build plan that starts with Task Management MVP.
4) A “Decision Ledger” listing any blocking decisions you must ask me (one-at-a-time).
5) Repo plan: folders, packages, naming, and how Android/web/backend share schemas.
6) Testing plan (unit/integration/e2e) suitable for AI-driven iteration.

PRODUCT CONCEPT (INCORPORATE ALL)
A) TASK MANAGEMENT (BUILD FIRST)
- Core objects:
  - Workspace: personal, side-hustle, team (future), etc.
  - Project/Area (optional but supported)
  - Task: can be simple or complex, can become a “task-note” or “reference-note”
  - Subtasks: unlimited nesting depth; each node can have status, priority, due/start, tags, links, and assignees
- Status model:
  - inbox/new, planned, in-progress, waiting/pending, blocked, done, canceled
- Priority/urgency:
  - Priority levels + urgency flags; preserve hierarchy when rescheduling or bumping
- AI assist (for tasks):
  - Suggest “what to do next” based on context, time available, priorities, and deadlines
  - Suggest subtasks for a task; user can accept/edit/reject
- Delegation:
  - Subtasks (and tasks) can be assigned to other users (team phase); for now implement data model + stubs if needed
- “Did you do this?” check-ins:
  - After a scheduled window passes: prompt Yes/No/In-Progress
  - If No: reschedule while maintaining priority
  - If In-Progress: keep active and propose next action/next slot
- Waiting/pending tracking:
  - If a task becomes “waiting” (e.g., “client mailing check in 3 days”), system sets follow-up reminders intelligently

B) NOTES / SECOND BRAIN (MODULAR; CAN BE PHASE 2)
- Markdown-first notes
- Note types / classification:
  - actionable vs reference (and others if needed)
- Deep docs supported (long-form notes), plus quick capture notes
- Tight linking:
  - tasks <-> notes <-> external resources
  - When working a task, all relevant references are surfaced instantly

C) CAPTURE (RAINDROP-LIKE) + TRANSCRIPTION (PHASE 3)
- Share-in capture from Android (YouTube link, web page, etc.)
- Auto-parse metadata (title/description/thumbnail)
- If video/audio: transcribe to text, store alongside link
- Generate summary/key points/outline; UI supports collapsing the transcript
- Convert content to searchable text for retrieval + AI organization

D) SCHEDULING / TIME-BLOCKING (PHASE 4)
- Integrate with Google Calendar initially (keep using it)
- Fixed vs flexible blocks:
  - Fixed events cannot move
  - Flexible task blocks can be rescheduled automatically
- Dynamic rescheduling:
  - If day goes sideways (appointments run long), bump tasks forward while preserving priority and dependencies
- Event templates:
  - Certain event types can auto-attach checklists (in-field vs after-hours)
  - Checklist items can generate follow-up tasks (including waiting/pending scenarios)

E) INTEGRATIONS + APIs (DESIGN NOW; IMPLEMENT LATER)
- Internal storage as source of truth or backup
- Modular connectors to pull from / push to external systems
- “Route inward/outward” design: choose what lives internally vs externally per user preference

F) TEAM EVOLUTION (DESIGN NOW; IMPLEMENT LATER)
- One user can have multiple workspaces
- Add shared/team workspace later:
  - interoperability across accounts
  - assignment, shared projects, shared knowledge

TECH/ARCH REQUIREMENTS
- Android client + web client (platform-agnostic web UI)
- Backend API (auth, sync, storage, AI jobs)
- Sync-first approach with offline tolerance where feasible (at least for tasks/notes)
- Choose a stack optimized for speed-to-MVP but scalable:
  - Recommend stack + rationale + migration path (if any)
- Use a shared schema/contract approach (e.g., OpenAPI/JSON Schema/TypeScript types) so Android/web stay aligned

AI REQUIREMENTS
- AI suggests next action, subtasks, and rescheduling proposals
- AI helps classify notes (actionable vs reference) and surface relevant references for a task
- AI runs as modular services/jobs, not baked everywhere (clear boundaries, auditable outputs)

DELIVERABLES (WHAT YOU MUST PRODUCE NEXT)
1) Modular component list with interfaces (Task Core, Workspace, Notes, Capture, Scheduler, Integrations, AI, Team).
2) A Task Management MVP spec:
   - entities + fields
   - state machine
   - priority rules
   - nesting rules
   - check-in behavior
   - waiting/pending follow-up behavior
3) API endpoints for Task MVP (CRUD + bulk ops + search + graph/nesting ops).
4) Data model design (DB tables/collections) for Task MVP with unlimited nesting.
5) UI outline for Task MVP (Android + Web):
   - Inbox
   - Today/Next
   - Projects/Areas
   - Task detail with nested subtasks
   - Quick capture
6) Implementation plan in milestones:
   - Milestone 1: Task Core (single user, local + backend sync)
   - Milestone 2: AI “next action” + subtask suggestions
   - Milestone 3: Notes linking + markdown notes
   - Milestone 4: Capture + transcription pipeline
   - Milestone 5: Scheduling + Google Calendar integration
   - Milestone 6: Team/shared workspace
7) Only after producing the above, ask me the FIRST blocking question (one question only).

CONSTRAINTS
- No long “options lists” unless necessary. Prefer a recommendation + fallback.
- Keep scope disciplined: Task Management MVP must ship fast and be usable even before scheduling/notes/capture.

Start now.
```

## Variation: Prompt Review / Improvements

Short answer: **this is very strong planning output**. You did not waste Codex’s time, and Codex did not misunderstand your intent. What you got back is *above average* for first-pass planning.

Below is a clear rundown of **what you are asking Codex to do**, followed by **specific, concrete improvements** you can make to the prompt or next iteration.

---

### 1. What you are asking Codex to do (in plain English)

You are asking Codex to act as **architect + lead engineer under CERES governance**, not just a coder.

Specifically, you are asking Codex to:

#### A. Define the product correctly

* Understand BrianHub as:

  * A **task-first system**
  * ADHD-friendly
  * GTD-compatible
  * With *future* expansion into notes, capture, scheduling, AI, and teams
* Treat **Task Management as the foundation**, not notes or calendar

#### B. Design a future-proof architecture

* Modular, phased system
* Android + web + backend
* Sync-first, offline-tolerant
* Multi-tenant from day one (personal → team → enterprise)
* AI as *advisory*, not mutating data directly (this is a big win)

#### C. Make concrete engineering decisions

* Pick a stack optimized for:

  * Speed to MVP
  * Long-term scalability
* Define schemas, APIs, state machines, and invariants
* Propose repo structure and build milestones

#### D. Control scope creep

* Explicit phasing (M1–M6)
* Task MVP must be useful *alone*
* Other modules must not block Task MVP

#### E. Respect your cognitive constraints

* One question at a time
* No arbitrary limits (e.g., subtask depth)
* Avoid option overload unless necessary

**Net:**
You are not asking for an app.
You are asking for a **controlled system evolution plan** that can survive your attention cycles and grow later.

Codex understood that.

---

### 2. Is Codex’s response good?

Yes — and here’s *why*:

#### What it nailed

* ✅ Correct priority ordering (Task Core first)
* ✅ Closure table for unlimited nesting (correct choice)
* ✅ Separation of AI as auditable suggestions
* ✅ Sync model awareness (cursor-based)
* ✅ Clean API surface
* ✅ No premature calendar/notes coupling
* ✅ Future team support without poisoning MVP
* ✅ Decision Ledger pattern (very CERES-aligned)

This is *not* a hallucinated architecture. It’s coherent.

---

### 3. Where the prompt (or next iteration) can be improved

These are **surgical improvements**, not rewrites.

---

#### Improvement 1: Make “Task-first” even harder to violate

Right now, Codex respected it — but future iterations might drift.

Add one explicit constraint:

> **Notes, capture, scheduling, and AI must not introduce required dependencies into Task Core schemas or APIs during M1.**

Why:

* Prevents “just one more field” syndrome
* Keeps Task Core deployable alone

---

#### Improvement 2: Clarify what “ADHD-friendly” means operationally

You imply it well, but Codex could optimize further if you define it mechanically.

Add a short section like:

> ADHD-FRIENDLY PRINCIPLES
>
> * Default views favor “Now / Next” over long lists
> * Reduce required decisions at capture time
> * Prefer resurfacing over archiving
> * System should ask questions *after* action windows, not before

This will influence UI + AI behavior later.

---

#### Improvement 3: Tighten the AI guardrails even more

You did well isolating AI, but you can make it *CERES-proof*.

Add:

> AI suggestions must be:
>
> * Explicitly accepted or rejected by the user
> * Logged with source context and timestamp
> * Reversible (no destructive actions)

This prevents silent state corruption.

---

#### Improvement 4: Add an explicit “failure mode” requirement

This is important for long-term trust.

Add:

> SYSTEM FAILURE MODE REQUIREMENT
>
> * If AI, sync, or integrations fail, the system must degrade to a usable local task manager without data loss.

This keeps BrianHub usable during outages or partial builds.

---

#### Improvement 5: The first blocking question is the *right* one

This is important:
**Codex chose the correct first question.**

Auth choice affects:

* Schema
* Sync
* Deployment
* UX
* Trust model

You may want to slightly reframe it to preserve momentum:

Instead of:

> “Require account-based cloud sync from day 1?”

You could guide it:

> Default to local-first with optional account sync unless strong reasons justify otherwise.

That nudges Codex toward momentum-preserving decisions.

---

### 4. Overall verdict

* **Prompt quality:** 9/10
* **Codex interpretation:** Correct
* **Architecture direction:** Sound
* **Risk of rework:** Low
* **Next step:** Answer the auth question, then let Codex proceed to M1 execution

You are doing this *the right way*:
task value first, architecture second, features later.

If you want, next we can:

* Lock the auth decision
* Tighten the Task Core UX rules
* Or convert this into a **PROMPTLOADER.md**–style initializer so BrianHub can be spun up instantly in future repos

Say which direction.

## M1 Decision: Local-First Task MVP

Decision: Proceed with a local-first Task MVP.

Auth model for M1:
- Local-first by default.
- No account required to use Task Core.
- Optional account sign-in enables cloud sync, backup, and future multi-device use.
- No Task MVP feature may require cloud connectivity.
- Design schema and APIs so cloud sync and teams can be added later without rework.

Instruction:
Proceed immediately with **Milestone 1: Task Core implementation only**.

Scope constraints for M1:
- Ignore notes, capture, scheduling, and team features except where minimal schema foresight is required.
- Implement:
  - Task Core data model (tasks, unlimited nested subtasks, closure table).
  - Task state machine.
  - Priority + urgency rules.
  - Check-ins (“Did you do this?” Yes / No / In-Progress).
  - Waiting/pending follow-ups.
  - Local persistence + sync cursor/change tracking (cloud stub only).
- Produce working code, not additional planning.

Next required outputs:
1) Database schema + migrations.
2) Core Task API (CRUD, tree ops, reparenting, check-ins).
3) Local storage + sync stub implementation.
4) Minimal UI for Task MVP (choose web or Android—pick fastest path).
5) Minimal AI stub that produces suggestions but does not mutate state.
6) Tests for task state machine and nesting invariants.

Ask clarifying questions only if a decision blocks implementation, and ask **one question at a time**.

Begin execution now.

## M1 Definition and Scope

**M1 = Task Core (local-first, usable by itself).**
Nothing else. No notes, no calendar, no capture.

### What M1 includes (hard requirements)

**1) Data model**

* Tasks with **unlimited nesting** (closure table or equivalent)
* Status, priority, urgency
* Waiting / pending state
* Check-ins
* Change log for sync
* Workspace separation (even if single-user)

**2) Task behavior**

* State machine (inbox → planned → in-progress → done, etc.)
* Reparenting + reordering without breaking priority
* “Did you do this?” check-ins (Yes / No / In-Progress)
* If No → reschedule, priority preserved
* Waiting → automatic follow-up reminders

**3) Local-first storage**

* Works fully offline
* Local persistence is source of truth
* Cloud sync is **optional stub**, not required

**4) API (even if only used locally)**

* CRUD tasks
* Tree operations (move, reparent)
* Check-ins
* Search/filter
* Sync push/pull (cursor-based)

**5) Minimal UI**

* Inbox / list view
* Task detail
* Inline subtask creation
* No modal-heavy UX

**6) AI (stub only)**

* Can suggest next action or subtasks
* **Must not mutate data**
* Suggestions are auditable + ignorable

**7) Tests**

* State machine invariants
* Tree / nesting invariants
* Reparenting correctness

---

### What M1 explicitly does *not* include

* Notes / markdown docs
* Content capture or transcription
* Scheduling / time blocking
* Google Calendar
* Team collaboration
* Permissions / roles beyond scaffolding

---

### Definition of “M1 complete”

* You can use it **daily** as a task manager
* It survives offline use
* It doesn’t lose tasks when rescheduling
* It doesn’t block future features

If you want, next I can:

* Turn this into a **checklist you can tick off**, or
* Compare what you already built vs M1 and flag gaps (if any)
```
