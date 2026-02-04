# Local Sync Push Spec

## Purpose
Replay offline pending changes to the server in order, keeping client-generated ids stable.

## Scope
- Add a replay queue helper for pending changes.
- Push pending task/workspace/project/status/task type changes before pull when online.
- Allow server creates to honor client-provided ids (idempotent creates).

## Non-Goals
- Full conflict resolution across devices.
- Syncing all entity types beyond those queued offline today.

## Acceptance
- Pending task/workspace/project/status/task type changes are pushed sequentially when online.
- If a create change has already been applied, server returns existing record.
- Tests cover replay order and failure handling.
