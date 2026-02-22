# Notes Module UI/UX Schema (BrianHub)

Status: Draft for implementation planning
Date: 2026-02-20
Owner: BrianHub product + engineering

## 1) Goal
Design a new BrianHub `Notes` module that reaches functional parity with Joplin's core note-taking experience while remaining:
- architecturally native to BrianHub (web module, not standalone app),
- compliant with CERES governance,
- and legally safe by avoiding copied Joplin code, UI assets, or literal implementation structure.

## 2) Governance and licensing constraints

### 2.1 CERES governance alignment
- Use canonical governance from `.ceres/core/AGENTS.md`.
- Keep this as a module-level concept, not a cross-cutting rewrite.
- Implement in PDCA increments with explicit acceptance checks per phase.
- Preserve existing BrianHub local-first + sync queue conventions.
- Keep core workspace artifacts current when implementation work begins (`.ceres/workspace/completed.md`, `.ceres/workspace/handover.md`).

### 2.2 Open source and clean-room guardrails
- Joplin repository default license is AGPL-3.0-or-later (`joplin-repo/joplin-dev/LICENSE`).
- Do not copy Joplin source code, styles, icons, or strings wholesale.
- Use Joplin only as a behavior reference (feature goals, interaction outcomes).
- Build original BrianHub UI structure and naming with BrianHub conventions.
- Keep provenance notes in PR/spec text: "behavior informed by Joplin docs; implementation is original."

### 2.3 Non-copy implementation policy
- Allowed: feature parity, common UX patterns, similar user outcomes.
- Disallowed: copied component trees, copied algorithms verbatim, copied CSS, copied shortcuts matrix as-is without adaptation.
- Required: BrianHub naming, BrianHub event/state contracts, BrianHub visual language.

### 2.4 Blocked-design inspiration rule
- If implementation is blocked on a specific UX/design problem, the LLM/team may take targeted inspiration from how Joplin solves that specific problem.
- This is limited to problem-solving guidance, not code/UI copying.
- Any inspired solution must be re-expressed in BrianHub-native architecture, naming, and interaction patterns.
- For traceability, note the inspired behavior and the BrianHub-specific implementation decision in PR/spec notes.

## 3) Current BrianHub architecture baseline (integration points)

### 3.1 Existing web shell
- Module navbar currently enables `Tasks` and `Scheduling`, with `Knowledge` disabled in `apps/web/index.html`.
- Active route/view is driven by `state.ui.activeView` in `apps/web/app.js`.
- Navigable views are controlled by `NAVIGABLE_VIEWS` in `apps/web/app.js`.

### 3.2 Existing local-first/sync patterns
- UI state persisted through `apps/web/localStore.js`.
- Domain data + pending mutation queue stored in `apps/web/localData.js`.
- Retry/backoff/conflict attention handled in `apps/web/syncQueue.js`.
- Remote change application keyed by `entity_type` in `apps/web/syncState.js`.
- API conventions include `X-Client-Id`, `X-Request-Id`, conflict payload support in `apps/web/api.js` and `services/api/src/server.js`.

### 3.3 Existing editor capability to reuse
- BrianHub already has a markdown/rich note editor inside task editing (`apps/web/index.html`, `apps/web/app.js`).
- Notes module should extract this into a shared editor primitive, not duplicate editor logic per module.

## 4) Joplin parity scope translated to BrianHub

| Joplin capability (reference behavior) | BrianHub Notes parity target | BrianHub-distinct implementation note |
| --- | --- | --- |
| Notebook tree + subnotebooks | Hierarchical `Notebooks` in sidebar | Keep BrianHub sidebar patterns, context menus, and mobile drawer behavior |
| Note list with sorting/filtering | Virtualized list with sort chips + saved views | Use BrianHub toolbar style; avoid Joplin list renderer structure |
| Markdown + Rich text modes | Dual-mode editor with markdown source of truth | Reuse BrianHub editor base and unique toolbar layout |
| Note tags | Workspace tags + quick filter pills | Share tagging model style with tasks where possible |
| To-do note patterns | Not included in Notes V1; actionable work stays in My Tasks | Notes may include plain checklist formatting, but no task status/due workflow inside Notes |
| Note reminders | Reminder on note creates/updates a Notice in My Tasks | Notice includes note deep link; no Scheduling event/time-block creation in V1 |
| Search syntax filters | Advanced query parser for notes | Keep compatible filter semantics, but use BrianHub parser and UX labels |
| "Goto Anything" | Command palette (`Quick Open`) | Extend existing command palette style for module-wide jump/search |
| Attachments/resources | Deferred from V1 (text-only notes first) | Attachments and resource panel move to a later phase |
| Note links | Internal wikilinks + explicit link picker | Reuse BrianHub modal/menu conventions |
| External links/deep links | Stable note URL scheme | Use BrianHub route format and workspace scope |
| Note history | Periodic revisions + restore flow | Revisions surfaced in side panel, restore creates new revision checkpoint |
| Conflict handling | Conflict inbox + merge chooser | Use existing sync conflict handling path (`needs_attention`) |
| Trash | Soft delete + restore/or permanent delete | Follow existing archive/delete safety patterns |
| Import/export | Markdown/JEX-compatible import and markdown/pdf/html export | Implement original parsers/serializers; no Joplin code reuse |
| Publish/share note | Optional share link (phase 3+) | Align with BrianHub auth/access model |
| Mobile note workflows | Mobile-first list->note navigation + quick capture | Use current BrianHub mobile nav shell |

## 5) Module information architecture

### 5.1 Module placement
- Enable new top-level module button: `Notes` (replace disabled `Knowledge` placeholder in module nav).
- `activeView = 'notes'` becomes first-class route target.
- Keep `Tasks` and `Scheduling` unchanged.

### 5.2 Desktop layout schema (3-pane, BrianHub style)
1. Left pane: `Notes Sidebar`
   - Sections: `All notes`, `Notebooks`, `Tags`, `Shared`, `Trash`, `Conflicts`.
   - Notebook tree supports collapse/expand, drag to move, and nested creation.
2. Middle pane: `Note List`
   - Search box, filter chip row, sort menu, scope toggles (`All`, `Pinned`, `Recently updated`).
   - Note preview rows: title, snippet, tag chips, reminder badge, updated timestamp.
3. Right pane: `Editor Workspace`
   - Title row with status pills and actions.
   - Editor mode toggle: `Rich` <-> `Markdown`.
   - Text-only content area in V1 (no file/media embeds).
   - Footer/status row: word count, char count, updated time, sync state, encryption/share marker when relevant.

### 5.3 Mobile layout schema
1. Screen A: Notebook/Tag browser (drawer modal style).
2. Screen B: Note list for selected notebook/filter.
3. Screen C: Note editor/viewer with top action bar.
- Mobile quick actions: new note, move to notebook, set reminder.
- Preserve existing BrianHub bottom-nav shell and module switching behavior.

## 6) Detailed UI/UX behavior schema

### 6.1 Sidebar behaviors
- Notebook actions: create, rename, archive, delete (with move-to-trash semantics), reorder, nest.
- Tag actions: create, rename, merge tags, delete tag mapping only.
- Context menus are BrianHub-style menu cards, not Joplin menu structures.
- Drag and drop:
  - notebook onto notebook => reparent notebook.
  - note onto notebook => move note.
  - tag onto note list selection => bulk tag.

### 6.2 Note list behaviors
- Selection modes:
  - single click opens note.
  - shift/control for multi-select desktop.
  - long-press multi-select mobile.
- Bulk actions: move, tag, duplicate, export, delete, restore.
- Sorting: updated desc (default), updated asc, created desc, title asc, title desc.
- View density: compact/cozy with remembered preference.

### 6.3 Editor behaviors
- Markdown-first persistence (`content_md` canonical).
- Storage contract: notes are persisted as Markdown only in V1.
- Rich editor mode is an interaction layer that reads/writes Markdown; no separate HTML persistence field is stored.
- Rich mode provides editing convenience; conversion is deterministic and lossy cases are warned inline.
- In-note search bar with next/previous and match count.
- Note metadata drawer:
  - notebook,
  - tags,
  - created/updated,
  - source URL,
  - reminder status and linked notice id,
  - linked tasks count.
- Autosave strategy:
  - local save debounce (<=700ms),
  - sync mutation enqueue on settled edits,
  - optimistic UI with failure badge + retry actions.

### 6.4 Search UX
- Global search entry in module toolbar.
- V1 search engine: SQL `LIKE` over `title` + `content_md` (case-insensitive normalization).
- FTS upgrade path: keep `/notes/search` API stable so backend internals can migrate to full-text indexing later without UI contract changes.
- Query grammar v1:
  - plain terms: `meeting notes`
  - notebook filter: `notebook:Clients`
  - tag filter: `tag:urgent`
  - date filters: `created:2026-02-01..2026-02-20`, `updated:day-7`
  - flags: `is:pinned`, `has:reminder`
- Live result grouping:
  - notes,
  - notebooks,
  - tags,
  - commands (from quick-open palette).

### 6.5 Note history UX
- Hybrid revision policy (V1): auto snapshots on interval + event-based checkpoints.
- Event checkpoints include: explicit save milestones, restore actions, and conflict resolution actions.
- Revision retention policy (V1): keep only the most recent 10 days of revisions per note.
- Pruning behavior: revisions older than 10 days are automatically purged by background cleanup.
- Revisions panel shows timestamp, author/device, summary.
- Restore options:
  - restore in-place (new checkpoint created first),
  - restore as duplicate note.
- Git-style history behavior (V1 scope):
  - each revision stores a `parent_revision_id` (commit-like chain),
  - each revision stores `content_sha256` for integrity and quick no-op detection,
  - UI supports viewing revision diffs and restoring from any prior revision.
- Full git feature parity (branches/rebase/cherry-pick) is out of scope; this is a git-like audit and restore model.

### 6.6 Conflict UX
- Conflict notes are surfaced in `Conflicts`.
- Conflict card includes:
  - local vs remote updated times,
  - diff preview,
  - actions: keep local, keep remote, merge manually.
- Conflict decisions generate explicit sync mutations and audit entries.

### 6.7 Trash UX
- Soft delete moves notes/notebooks to trash with retention countdown.
- Restore returns item to original parent when possible, else root notebook.
- Empty trash supports scoped purge (`selected`, `all older than N days`).

### 6.8 Reminder lifecycle UX
- V1 supports one active reminder per note.
- Setting or editing a reminder updates the single linked Notice in My Tasks.
- If a reminder becomes overdue/unresolved, the future agentic layer may propose a new reminder time.
- Reminder rescheduling remains user-confirmed (no automatic silent date/time mutation).

## 7) Cross-module interoperability schema

### 7.1 Tasks <-> Notes linkage
- New entity bridge: `task_note_links`.
- Entry points:
  - from Task editor: "Link note", "Create note from task".
  - from Note editor: "Link task", "Create linked task from selected text".
- Task detail surfaces linked notes list with quick preview.
- Notes surface linked tasks as side chips with status badges.

### 7.2 My Tasks / Notices interoperability
- Notes does not own todo/task lifecycle; action execution stays in My Tasks.
- Note reminders create/update linked Notice records so reminders surface in the My Tasks module.
- Notice payload includes note reference (`note_id`) and deep link context for quick open.
- Clearing a note reminder resolves/archives the linked Notice.

### 7.3 Scheduling interoperability
- No direct Notes->Scheduling event/time-block creation in V1.
- If scheduling interoperability is added later, it should be opt-in and built on top of Notices/Tasks flows.

### 7.4 AI interoperability (future-safe boundary)
- AI does not mutate notes directly.
- AI jobs may return suggestions:
  - summarize note,
  - extract actions,
  - suggest tags/notebook,
  - propose next reminder timing for unresolved reminder notices.
- User must explicitly accept suggestions before mutation.

### 7.5 Workspace/auth interoperability
- All note entities are workspace-scoped.
- V1 privacy policy: notes are private to the creating user only (no public links, no cross-user sharing).
- Use existing auth/session model and role checks.
- Team/organization knowledgebase behavior is deferred at runtime, but schema stubs are added now for forward compatibility.

## 8) Data model schema (proposed, BrianHub-native)

### 8.1 Primary entities
1. `notebooks`
   - `id`, `workspace_id`, `owner_user_id`, `parent_id`, `name`, `icon`, `sort_order`, `archived_at`, `created_at`, `updated_at`
2. `notes`
   - `id`, `workspace_id`, `owner_user_id`, `notebook_id`, `title`, `content_md`, `source_url`, `is_pinned`, `remind_at`, `reminder_notice_id`, `created_at`, `updated_at`, `deleted_at`
3. `note_tags`
   - `id`, `workspace_id`, `name`, `color`, `created_at`, `updated_at`
4. `note_tag_links`
   - `note_id`, `tag_id`, `created_at`
5. `note_revisions`
   - `id`, `workspace_id`, `note_id`, `parent_revision_id`, `content_md`, `title`, `reason`, `revision_kind`, `content_sha256`, `created_by`, `origin_client_id`, `created_at`
   - `revision_kind` values (v1): `interval_snapshot`, `manual_checkpoint`, `restore_checkpoint`, `conflict_resolution`
6. `note_links`
   - `source_note_id`, `target_note_id`, `anchor`, `created_at`
7. `task_note_links`
   - `task_id`, `note_id`, `link_type`, `created_at`
8. `note_conflicts`
   - `id`, `workspace_id`, `note_id`, `local_revision_id`, `remote_revision_id`, `status`, `created_at`, `resolved_at`

### 8.1.1 Deferred content-resource entities (post-V1)
1. `note_resources`
   - `id`, `workspace_id`, `filename`, `mime_type`, `size_bytes`, `storage_key`, `checksum_sha256`, `created_at`, `updated_at`, `deleted_at`
2. `note_resource_links`
   - `note_id`, `resource_id`, `block_id`, `display_mode`, `created_at`

### 8.2 Knowledgebase permission stubs (schema-only, no V1 runtime sharing)
1. `note_acl_entries` (stub)
   - `id`, `workspace_id`, `note_id`, `principal_type`, `principal_id`, `access_role`, `created_at`, `updated_at`
   - `principal_type` stub values: `user`, `group`, `org_role`
   - `access_role` stub values: `viewer`, `commenter`, `editor`, `owner`
2. `notebook_acl_entries` (stub)
   - `id`, `workspace_id`, `notebook_id`, `principal_type`, `principal_id`, `access_role`, `created_at`, `updated_at`
3. `knowledge_spaces` (stub)
   - `id`, `workspace_id`, `slug`, `name`, `description`, `visibility`, `created_at`, `updated_at`
   - Intended future use: organization-level knowledgebase partitions.
4. `knowledge_space_memberships` (stub)
   - `id`, `workspace_id`, `knowledge_space_id`, `principal_type`, `principal_id`, `space_role`, `created_at`, `updated_at`
5. `notes.knowledge_space_id` (nullable stub FK)
   - V1 rule: always `NULL`.
6. `notebooks.knowledge_space_id` (nullable stub FK)
   - V1 rule: always `NULL`.
7. Enforcement rule in V1
   - ACL and knowledge-space tables/fields are schema-only and non-authoritative in V1.
   - Authorization remains owner-only/private regardless of stub values.

### 8.3 Sync entity types to add
- `notebook`
- `note`
- `note_tag`
- `note_tag_link`
- `note_revision`
- `note_link`
- `task_note_link`
- `note_conflict`
- `note_acl_entry` (stub; no V1 permission effect)
- `notebook_acl_entry` (stub; no V1 permission effect)
- `knowledge_space` (stub; no V1 permission effect)
- `knowledge_space_membership` (stub; no V1 permission effect)
- `note_resource` (deferred post-V1)
- `note_resource_link` (deferred post-V1)

## 9) API contract schema (proposed)

### 9.1 REST endpoints
- `GET /notebooks?workspace_id=...`
- `POST /notebooks`
- `PATCH /notebooks/:id`
- `DELETE /notebooks/:id`
- `GET /notes?workspace_id=...&notebook_id=...`
- `GET /notes/:id`
- `POST /notes`
- `PATCH /notes/:id`
- `DELETE /notes/:id`
- `POST /notes/:id/restore`
- `POST /notes/search`
- `POST /notes/:id/reminder` (set/update reminder and linked Notice)
- `DELETE /notes/:id/reminder` (clear reminder and resolve linked Notice)
- `POST /notes/:id/revisions`
- `GET /notes/:id/revisions`
- `GET /notes/:id/revisions/:revisionId/diff` (compare selected revision with parent or current)
- `POST /notes/:id/link-task`
- `DELETE /notes/:id/link-task/:taskId`
- `GET /knowledge/spaces` (stub, admin/owner only, returns empty or seed values in V1)
- `POST /knowledge/spaces` (stub, disabled in V1 runtime)
- `GET /notes/:id/acl` (stub, owner-only response in V1)
- `PUT /notes/:id/acl` (stub, accepted but non-authoritative in V1)
- `GET /notebooks/:id/acl` (stub, owner-only response in V1)
- `PUT /notebooks/:id/acl` (stub, accepted but non-authoritative in V1)
- `POST /notes/:id/resources` (deferred post-V1)
- `DELETE /resources/:id` (deferred post-V1)

### 9.1.1 Notes payload format contract (V1)
- Canonical content field is `content_md`.
- Create/update requests persist note body from `content_md`; rich-mode clients must serialize to Markdown before save.
- Server stores Markdown as authoritative content; no HTML mirror field is persisted in V1.

### 9.2 Sync behavior
- Keep existing `/sync/push` and `/sync/pull`.
- Notes module emits normal change-log records with `entity_type` values above.
- Conflict responses continue to use HTTP `409` and payload `{ conflict: ... }`.

### 9.3 Search implementation contract
- V1: `/notes/search` executes basic `LIKE` queries for speed-to-ship and low complexity.
- Post-V1: migrate search backend to FTS with no breaking API changes.

## 10) UI state schema additions (`localStore` + `localData`)

### 10.1 UI state additions (suggested)
- `ui.notesActiveNotebookId`
- `ui.notesActiveTagIds`
- `ui.notesSearchQuery`
- `ui.notesSort`
- `ui.notesViewDensity`
- `ui.notesEditorMode` (`rich` | `markdown`)
- `ui.notesSelectedIds`
- `ui.notesShowTrash`
- `ui.notesPaneSizes` (desktop resizable layout persistence)

### 10.2 Local data additions (suggested)
- Add arrays/maps in `apps/web/localData.js` default payload:
  - `notebooks`
  - `notes`
  - `noteTags`
  - `noteTagLinks`
  - `noteResources`
  - `noteResourceLinks`
  - `noteRevisions`
  - `noteLinks`
  - `taskNoteLinks`
  - `noteConflicts`

## 11) Visual and interaction differentiation (anti-copy UX)

### 11.1 BrianHub visual direction for Notes
- Keep BrianHub's current shell, spacing scale, and control style.
- Use BrianHub iconography, menu patterns, modal patterns, and mobile sheets.
- Avoid cloning Joplin pane chrome, typography hierarchy, and toolbar layouts.

### 11.2 Distinctive interaction choices
- BrianHub command palette naming: `Quick Open` (not Joplin naming).
- BrianHub filter chips and segmented controls instead of Joplin-style controls.
- Unified task-note link surfaces as a BrianHub differentiator.

## 12) Implementation rollout plan (CERES-friendly)

### Phase A: Module skeleton + routing
- Enable `Notes` module nav.
- Add notes sidebar/content panels and mobile route.
- Add base entities to local state and sync appliers.

### Phase B: Core notebook + note CRUD
- Notebook tree, note list, editor, autosave, markdown/rich mode.
- Tagging and core search.
- Basic `LIKE`-based search implementation.
- Note reminders routed to Notices in My Tasks.
- Text-only notes (attachments/resources disabled in V1).
- Basic trash + restore.
- Revision retention cleanup (10-day window).

### Phase C: Advanced parity
- Revisions/history UI.
- Note links and task-note links.
- Conflict inbox and merge actions.
- Search quality/performance upgrade path (FTS backend).

### Phase D: Extended ecosystem
- Attachments/resources.
- Import/export formats.
- Optional share/publish.
- Organization knowledgebase capabilities (shared/team notes).
- AI assistant hooks for summarization/classification (user-approved mutations only).

## 13) Acceptance criteria for "Joplin-like but BrianHub-native"

1. User can create nested notebooks and move notes between them.
2. User can edit notes in rich and markdown modes with markdown as source of truth.
   - Persisted note body is Markdown (`content_md`) only.
3. User can search notes with advanced filters and retrieve expected results.
   - V1 implementation uses basic `LIKE` search.
4. V1 is text-only: attachments/resources are disabled.
5. User can restore prior revisions and recover from conflicts.
   - Revision history is git-style (parent-linked chain with diff view), using hybrid checkpointing.
   - Only revisions from the last 10 days are retained in V1.
6. User can delete to trash and restore without data loss.
7. User can link notes to tasks and navigate both directions.
8. Note reminders appear as linked Notices in My Tasks (not Scheduling events).
9. V1 enforces one active reminder per note; unresolved reminders can trigger agentic reschedule suggestions that require user confirmation.
10. Notes module works offline and syncs via existing change-log flow.
11. No Joplin source code/assets are copied; implementation passes legal-clean-room review.
12. Schema includes forward-compatible knowledgebase permission stubs with no sharing enabled in V1 runtime.

## 14) Open decisions (blocking order)
1. Resolved: V1 notes are private to the user; sharing/public links are deferred.
2. Resolved: Notes V1 excludes todo/task workflow; actionable work stays in My Tasks.
3. Resolved: note reminders surface as Notices in My Tasks; no direct Scheduling event creation in V1.
4. Resolved: V1 allows one active reminder per note; unresolved reminders are handled via agentic follow-up suggestions with explicit user confirmation.
5. Resolved: create schema stubs now for future organization knowledgebase permissions while keeping V1 strictly private.
6. Resolved: defer attachments/resources; V1 launches with text-only notes.
7. Resolved: V1 uses basic `LIKE` search; upgrade to FTS is planned post-V1.
8. Resolved: note history uses a hybrid checkpoint policy with a git-style parent-linked revision chain, diff/restore UX, and a strict 10-day retention window.
