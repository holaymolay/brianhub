# Roger API brief

This document is the handoff for Roger's interaction with BrianHub in production.

It separates two different access modes:

- server operations over Tailscale + SSH
- product API access over `https://brianhub.com`

Roger can use BrianHub product API automation only through owner-provisioned service-account auth with explicit workspace grants and scoped permissions.

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

Current production model:

- public health route
- browser/session-cookie auth for human users
- bearer-token auth for owner-provisioned service accounts
- organizations as separate collaboration entities with their own operating surface
- explicit workspace grants for service-account workspace access
- service accounts are constrained by route policy and fine-grained permissions
- Roger defaults to product-only task/project automation, not broader admin powers

The Telegram group is a request channel only. It is not a privilege boundary by itself.

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
  "auth_type": "none",
  "require_auth": true,
  "principal_type": null,
  "principal_id": null,
  "org_id": null,
  "user": null,
  "service_account": null,
  "session": null,
  "machine": null,
  "workspaces": [],
  "granted_permissions": [],
  "effective_permissions": [],
  "owner_email": "owner@example.com",
  "is_owner": false,
  "is_admin": false
}
```

Roger runtime/channel identifier to store as an alias:

- `agent:main:telegram:group:-5130223325`

Owner-only service-account provisioning routes:

- `GET /admin/service-accounts`
- `POST /admin/service-accounts`
- `PATCH /admin/service-accounts/:id`
- `GET /admin/service-accounts/:id/tokens`
- `POST /admin/service-accounts/:id/tokens`
- `PATCH /admin/service-account-tokens/:id`
- `POST /admin/service-account-tokens/:id/rotate`
- `DELETE /admin/service-account-tokens/:id`
- `GET /admin/service-accounts/:id/workspace-grants`
- `GET /admin/service-accounts/:id/activity`
- `POST /admin/service-accounts/:id/workspace-grants`
- `DELETE /admin/service-account-workspace-grants/:id`

Service-account token rules:

- raw token secrets are shown only once at create or rotate time
- existing token rows expose metadata only after issuance
- service-account inventory includes creator attribution and summary counts
- the admin UI labels these identities as `Service workers`

## Authenticated routes

When `BRIANHUB_REQUIRE_AUTH=true`, all non-public routes require an authenticated actor.

General authenticated routes:

- `GET /workspaces`
- `POST /workspaces`
- `GET /orgs`
- `POST /orgs`
- `GET /orgs/:id`
- `PATCH /orgs/:id`
- `GET /orgs/:id/members`
- `POST /orgs/:id/members`
- `PATCH /orgs/:id/members/:userId`
- `DELETE /orgs/:id/members/:userId`
- `POST /orgs/:id/transfer-ownership`
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
- `POST /tasks/:id/convert-to-shopping-item`
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
- `GET /admin/users`
- `PATCH /admin/users/:id`
- `POST /admin/users/:id/reset-password`
- `POST /admin/users/:id/export`
- `DELETE /admin/users/:id`
- `POST /admin/ownership/transfer`

Roger default service-account permissions:

- `workspaces.read`
- `tasks.read`
- `tasks.create`
- `tasks.update`
- `projects.read`

Roger default scope excludes `tasks.delete`. Destructive task authority must be explicitly granted later.

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

Minimal organization create:

```json
{
  "name": "Pipe Cam"
}
```

Minimal organization member add:

```json
{
  "email": "teammate@example.com",
  "role": "member"
}
```

Minimal organization ownership transfer:

```json
{
  "target_user_id": "<user-id>"
}
```

Minimal shopping list create:

```json
{
  "workspace_id": "00000000-0000-4000-8000-000000000001",
  "name": "Safeway run",
  "store_name": "Safeway",
  "scheduled_for": "2026-03-21",
  "archived": false
}
```

Convert a leaf task into a shopping item:

```json
{
  "list_id": "<shopping-list-id>"
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

## Important behavior notes

- Human workspace lists are membership-scoped.
- Personal workspaces are owner-isolated.
- Organizations are not normal workspace picker entries; they are separate operating surfaces.
- If Roger is using bearer auth and something fails, validate the current principal with `GET /auth/me` before assuming the route is broken.

## What Roger should do now

Approved:

- verify BrianHub health
- inspect service status and logs
- deploy or roll back server releases
- trigger backups

Not approved yet:

- use a human browser session to manipulate personal tasks
- use `X-Actor-Email`
- bypass service-account workspace grants or owner provisioning
- treat Telegram chat context as sufficient authorization by itself

## Phase 2 target

Before Roger should manipulate BrianHub data over the product API, add:

- claim/lease semantics for workers
- richer approval policies for high-risk admin actions
- webhook/subscription delivery instead of polling
- a dedicated operator UI for admin-action review and execution

At that point Roger can be given a narrow API credential and a documented workspace scope.
