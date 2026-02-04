# Task Grouping Spec

## Purpose
Allow tasks to be organized into sections and grouped by key attributes in list view.

## Scope
- Add `group_label` column and index to tasks (used as section labels).
- Persist `group_label` in task create/update flows.
- Add list‑view grouping modes: Section, Task type, Priority.
- Support drag‑to‑group behavior for the active grouping mode.
- Provide section rename UI that bulk updates tasks in the section.

## Non‑Goals
- Kanban grouping.
- Advanced group permissions or nested groups.

## Acceptance
- Tasks can store a nullable `group_label` (section).
- List view can group by section, task type, or priority.
- Renaming a section updates all tasks with the old label.
