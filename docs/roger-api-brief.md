# Roger API brief

This document is the handoff for Roger's interaction with BrianHub in production.

It separates two different access modes:

- server operations over Tailscale + SSH
- product API access over `https://brianhub.com`

Roger is currently approved for server operations only. Product API automation should wait until machine auth exists.

## Current production rules

- BrianHub production URL: `https://brianhub.com`
- BrianHub server access: private Tailscale path only
- Production requires auth: `BRIANHUB_REQUIRE_AUTH=true`
- Production disables header actor auth: `BRIANHUB_ALLOW_HEADER_ACTOR_AUTH=false`
- Do not use `X-Actor-Email` in production
- Do not use public-internet SSH for Roger workflows

## Approved path today: server ops

Roger can operate the BrianHub VPS over Tailscale with the restricted `roger-admin` account.

Required path:

- Tailscale reachability to the BrianHub VPS
- SSH identity authorized for `roger-admin`
- wrapper command: `sudo /usr/local/bin/brianhub-admin`

Typical verification:

```bash
tailscale ping <brianhub-tailnet-ip>
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@<brianhub-tailnet-ip> \
  'sudo /usr/local/bin/brianhub-admin health'
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@<brianhub-tailnet-ip> \
  'sudo /usr/local/bin/brianhub-admin status'
```

Supported remote operations:

- `deploy [git-ref]`
- `rollback [release]`
- `restart`
- `status`
- `logs [lines]`
- `health`
- `backup-now`
- `current-release`

Example deploy:

```bash
ssh -i ~/.ssh/roger_brianhub_ed25519 roger-admin@<brianhub-tailnet-ip> \
  'sudo /usr/local/bin/brianhub-admin deploy'
```

## Product API status

Roger should treat BrianHub product API access as human-session-only for now.

Current production model:

- public health route
- browser/session-cookie auth for authenticated routes
- no bearer token auth
- no service-account auth
- no workspace-scoped machine permissions

Because of that, Roger should not automate a human workspace through the product API yet.

## Public routes

These routes are reachable without prior auth in production:

- `GET /health`
- `GET /auth/me`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/invite/accept`

Examples:

```bash
curl https://brianhub.com/health

curl -X POST https://brianhub.com/auth/login \
  -H 'Content-Type: application/json' \
  --data '{"email":"user@example.com","password":"secret"}'
```

Expected `GET /auth/me` shape:

```json
{
  "authenticated": false,
  "require_auth": true,
  "user": null,
  "session": null,
  "workspaces": [],
  "owner_email": "owner@example.com",
  "is_owner": false,
  "is_admin": false
}
```

## Authenticated routes

When `BRIANHUB_REQUIRE_AUTH=true`, all non-public routes require an authenticated actor.

General authenticated routes:

- `GET /workspaces`
- `POST /workspaces`
- `GET /tasks?workspace_id=<uuid>`
- `GET /tasks/tree?workspace_id=<uuid>`
- `GET /tasks/:id`
- `POST /tasks`
- `PATCH /tasks/:id`
- `DELETE /tasks/:id`
- `POST /tasks/search`
- `POST /tasks/:id/checkin`
- `POST /tasks/:id/reschedule`
- `POST /tasks/:id/reparent`
- `GET /projects?workspace_id=<uuid>`
- `POST /projects`
- `PATCH /projects/:id`
- `DELETE /projects/:id`
- `GET /shopping-lists?workspace_id=<uuid>`
- `POST /shopping-lists`
- `PATCH /shopping-lists/:id`
- `DELETE /shopping-lists/:id`
- `GET /shopping-items?workspace_id=<uuid>` or `GET /shopping-items?list_id=<uuid>`
- `POST /shopping-items`
- `PATCH /shopping-items/:id`
- `DELETE /shopping-items/:id`
- `GET /notice-types?workspace_id=<uuid>`
- `POST /notice-types`
- `PATCH /notice-types/:id`
- `DELETE /notice-types/:id`
- `GET /notices?workspace_id=<uuid>`
- `POST /notices`
- `PATCH /notices/:id`
- `DELETE /notices/:id`
- `POST /sync/pull`
- `POST /sync/push`

There is currently no dedicated `/sections` or `/task-sections` product API route.

For My Tasks list sections, the server-facing field is `group_label` on each task:

- set `group_label` when creating a task to place it in a section
- patch `group_label` to move a task into a different section
- set `group_label` to `null` to remove the task from a section

Section rename/delete flows in the current web app are client-driven and update tasks by changing their `group_label` values. Section settings and some section UI metadata are still local-web-app state, not a first-class server API resource.

Admin-only routes:

- `GET /admin/info`
- `GET /admin/invites`
- `POST /admin/invites`
- `DELETE /admin/invites/:id`
- `POST /admin/users/:id/reset-password`
- `POST /admin/ownership/transfer`

## Minimal request shapes

Minimal task create:

```json
{
  "workspace_id": "00000000-0000-4000-8000-000000000001",
  "title": "New task",
  "group_label": "Errands"
}
```

Minimal task update:

```json
{
  "title": "Updated title",
  "group_label": "Today"
}
```

Minimal section removal from a task:

```json
{
  "group_label": null
}
```

Minimal sync pull:

```json
{
  "workspace_id": "00000000-0000-4000-8000-000000000001",
  "cursor": 0
}
```

Minimal shopping list create:

```json
{
  "workspace_id": "00000000-0000-4000-8000-000000000001",
  "name": "Safeway run",
  "archived": false
}
```

Minimal project create:

```json
{
  "workspace_id": "00000000-0000-4000-8000-000000000001",
  "name": "Launch website",
  "kind": "project",
  "archived": false
}
```

Minimal project update:

```json
{
  "name": "Launch website v2",
  "kind": "project",
  "archived": false
}
```

Minimal shopping item create:

```json
{
  "list_id": "00000000-0000-4000-8000-000000000002",
  "name": "Milk"
}
```

Bulk shopping item create:

```json
{
  "list_id": "00000000-0000-4000-8000-000000000002",
  "items": [
    "Milk",
    "Eggs",
    {
      "name": "Bread",
      "is_checked": false
    }
  ]
}
```

Minimal notice type create:

```json
{
  "workspace_id": "00000000-0000-4000-8000-000000000001",
  "label": "Bill notice"
}
```

Minimal notice create:

```json
{
  "workspace_id": "00000000-0000-4000-8000-000000000001",
  "title": "Pay credit card bill",
  "notify_at": "2026-03-18T17:00:00.000Z",
  "notice_type": "bill"
}
```

Minimal notice update:

```json
{
  "dismissed_at": null,
  "notify_at": "2026-03-19T17:00:00.000Z"
}
```

Minimal sync push:

```json
{
  "workspace_id": "00000000-0000-4000-8000-000000000001",
  "client_id": "roger",
  "changes": [
    {
      "entity_type": "task",
      "entity_id": "00000000-0000-4000-8000-000000000002",
      "action": "upsert",
      "client_mutation_id": "roger-1",
      "payload": {
        "id": "00000000-0000-4000-8000-000000000002",
        "workspace_id": "00000000-0000-4000-8000-000000000001",
        "title": "New task"
      }
    }
  ]
}
```

## Error model

Errors are normalized as JSON:

```json
{
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "authentication required",
    "requestId": "..."
  }
}
```

Common statuses:

- `401` unauthenticated
- `403` authenticated but insufficient role
- `404` not found
- `409` sync conflict

## What Roger should do now

Approved:

- verify BrianHub health
- inspect service status and logs
- deploy or roll back server releases
- trigger backups

Not approved yet:

- use a human browser session to manipulate personal tasks
- use `X-Actor-Email`
- access a personal workspace as a machine actor
- assume direct API automation is supported in production

## Phase 2 target

Before Roger should manipulate BrianHub data over the product API, add:

- bearer-token or service-account auth
- workspace-scoped machine permissions
- a dedicated Roger workspace
- explicit approval before any access to a human workspace

At that point Roger can be given a narrow API credential and a documented workspace scope.
