# Task Editor Layout Spec

## Purpose
Improve the task editor readability by organizing fields in a two‑column layout and emphasizing the title input.

## Scope
- Reorder the task editor form into a 2‑column layout.
- Increase the task title input size.
- Guard optional start date input access in JS.

## Non‑Goals
- Changing task data model.
- Introducing new editor fields.

## Acceptance
- The task editor renders in two columns with the title spanning both columns.
- Title input is slightly larger than other fields.
- No errors when the start date input is absent.
