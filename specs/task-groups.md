# Task Groups Spec

## Purpose
Allow tasks to be labeled with a group name so list view can render grouped sections.

## Scope
- Add `group_label` column and index to tasks.
- Persist `group_label` in task create/update flows.
- Add list‑view grouping UI and drag‑to‑group behavior.
- Provide group rename UI that bulk updates tasks in the group.

## Non‑Goals
- Kanban grouping.
- Advanced group permissions or nested groups.

## Acceptance
- Tasks can store a nullable `group_label`.
- List view can display grouped sections and ungrouped tasks.
- Renaming a group updates all tasks with the old label.
