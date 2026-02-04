# Local Sync Spec

## Purpose
Incrementally apply server change-log entries to local state using the sync cursor, while keeping local-first behavior intact.

## Scope
- Add a pure sync-state module to merge change log entries into local data.
- Add a persistent client id and send it with API requests.
- Update the web client to apply remote changes on sync pull without a full refresh when possible.

## Non-Goals
- Full offline replay/push of pending changes to the server.
- Multi-device conflict resolution beyond "skip while local pending".

## Acceptance
- `autoRefreshOnChanges` applies change log entries to local state when safe.
- Sync cursor advances only after processing.
- Change application is covered by tests.
- Client id header is sent on API requests.
