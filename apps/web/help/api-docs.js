export const BRIANHUB_API_HELP_PATH = '/apps/web/help/api/';

function normalizeOrigin(origin) {
  const value = String(origin ?? '').trim().replace(/\/+$/, '');
  return value || 'https://brianhub.com';
}

function normalizeWorkspaceId(workspaceId) {
  const value = String(workspaceId ?? '').trim();
  return value || '<workspace-id>';
}

function formatJsonBlock(payload) {
  return ['```json', JSON.stringify(payload, null, 2), '```'].join('\n');
}

export function buildBrianhubApiHelpUrl(origin = '') {
  const value = String(origin ?? '').trim();
  if (!value) return BRIANHUB_API_HELP_PATH;
  return `${normalizeOrigin(value)}${BRIANHUB_API_HELP_PATH}`;
}

export function buildBrianhubApiHelpMarkdown({ origin = 'https://brianhub.com', workspaceId = '<workspace-id>' } = {}) {
  const baseUrl = normalizeOrigin(origin);
  const currentWorkspaceId = normalizeWorkspaceId(workspaceId);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  return [
    '---',
    'product: BrianHub',
    'document: api-reference',
    `base_url: ${baseUrl}`,
    `current_workspace_id: ${currentWorkspaceId}`,
    `docs_path: ${BRIANHUB_API_HELP_PATH}`,
    'auth_model: session-cookie-plus-bearer-service-account',
    'service_account_auth: available-v1',
    '---',
    '',
    '# BrianHub API',
    '',
    'Machine-readable implementation brief for the BrianHub product API.',
    '',
    '## Core rules',
    '- Use JSON request and response bodies.',
    '- In production, product routes use session-cookie authentication.',
    '- Do not use `X-Actor-Email` in production.',
    '- Bearer tokens are available for owner-provisioned service accounts only.',
    '- Telegram or another chat surface is the request channel, not the auth boundary.',
    '- Most resource families are scoped by `workspace_id`.',
    '- Errors use a normalized envelope with `code`, `message`, and `requestId`.',
    '',
    '## Service account auth',
    '- Owner-only provisioning routes:',
    '- `GET /admin/service-accounts`',
    '- `POST /admin/service-accounts`',
    '- `PATCH /admin/service-accounts/:id`',
    '- `GET /admin/service-accounts/:id/tokens`',
    '- `POST /admin/service-accounts/:id/tokens`',
    '- `PATCH /admin/service-account-tokens/:id`',
    '- `POST /admin/service-account-tokens/:id/rotate`',
    '- `DELETE /admin/service-account-tokens/:id`',
    '- `GET /admin/service-accounts/:id/workspace-grants`',
    '- `GET /admin/service-accounts/:id/activity`',
    '- `POST /admin/service-accounts/:id/workspace-grants`',
    '- `DELETE /admin/service-account-workspace-grants/:id`',
    '',
    'Example Roger service account:',
    formatJsonBlock({
      display_name: 'Roger - Ops',
      permissions: [
        'workspaces.read',
        'tasks.read',
        'tasks.create',
        'tasks.update',
        'projects.read'
      ],
      aliases: [
        {
          alias_type: 'telegram_group',
          alias_value: 'agent:main:telegram:group:-5130223325',
          metadata: {
            channel: 'telegram',
            group_id: '-5130223325'
          }
        }
      ]
    }),
    '',
    'Service accounts authenticate with `Authorization: Bearer <token>` and are constrained by explicit permissions, explicit workspace grants, and route-level policy checks.',
    '',
    '## Critical modeling rule for My Tasks sections',
    '- Sections are represented by `task.group_label`.',
    '- There is no dedicated task sections endpoint yet.',
    '- To put a task into a section, set `group_label` to the section label.',
    '- To remove a task from a section, set `group_label` to `null`.',
    '- Do not model sections as parent tasks or subtasks.',
    '',
    '## Public routes',
    '- `GET /health`',
    '- `GET /auth/me`',
    '- `POST /auth/login`',
    '- `POST /auth/logout`',
    '- `POST /auth/invite/accept`',
    '',
    '## Protected routes',
    'All remaining product routes require an authenticated actor when auth is enabled.',
    '',
    '## Workspaces',
    '- `GET /workspaces`',
    '- `POST /workspaces`',
    '',
    'Minimal create workspace request:',
    formatJsonBlock({
      name: 'Shared Ops',
      type: 'shared'
    }),
    '',
    '## Inter-agent events',
    '- `GET /agent-events?workspace_id=<uuid>`',
    '- `GET /agent-events/:id`',
    '- `POST /agent-events`',
    '- `PATCH /agent-events/:id`',
    '',
    'This is a deterministic inter-agent event bus, not a chat system.',
    '',
    'Minimal create event request:',
    formatJsonBlock({
      workspace_id: currentWorkspaceId,
      source_agent: 'roger',
      target_agent: 'codex',
      event_type: 'task.request',
      payload_json: {
        title: 'Add authenticated trading bot project page',
        acceptance_criteria: [
          'Login required',
          '403 if unauthorized'
        ],
        metadata: {
          origin: 'telegram',
          requested_by: 'Brian'
        }
      },
      priority: 'normal',
      dedupe_key: 'telegram-req-123'
    }),
    '',
    'Mark an event handled:',
    formatJsonBlock({
      status: 'handled',
      handled_at: tomorrow
    }),
    '',
    '## Tasks',
    '- `GET /tasks?workspace_id=<uuid>`',
    '- `GET /tasks/tree?workspace_id=<uuid>`',
    '- `GET /tasks/:id`',
    '- `POST /tasks`',
    '- `PATCH /tasks/:id`',
    '- `DELETE /tasks/:id`',
    '- `POST /tasks/search`',
    '- `POST /tasks/:id/checkin`',
    '- `POST /tasks/:id/reschedule`',
    '- `POST /tasks/:id/reparent`',
    '',
    'Minimal create task request:',
    formatJsonBlock({
      workspace_id: currentWorkspaceId,
      title: 'Buy groceries',
      group_label: 'Errands'
    }),
    '',
    'Move a task into a different section:',
    formatJsonBlock({
      group_label: 'Today'
    }),
    '',
    'Remove a task from any section:',
    formatJsonBlock({
      group_label: null
    }),
    '',
    '## Projects',
    '- `GET /projects?workspace_id=<uuid>`',
    '- `POST /projects`',
    '- `PATCH /projects/:id`',
    '- `DELETE /projects/:id`',
    '',
    'Minimal create project request:',
    formatJsonBlock({
      workspace_id: currentWorkspaceId,
      name: 'Launch website',
      kind: 'project',
      archived: false
    }),
    '',
    '## Shopping lists',
    '- `GET /shopping-lists?workspace_id=<uuid>`',
    '- `POST /shopping-lists`',
    '- `PATCH /shopping-lists/:id`',
    '- `DELETE /shopping-lists/:id`',
    '',
    'Minimal create shopping list request:',
    formatJsonBlock({
      workspace_id: currentWorkspaceId,
      name: 'Safeway run',
      store_name: 'Safeway',
      scheduled_for: '2026-03-21',
      archived: false
    }),
    '',
    '## Shopping items',
    '- `GET /shopping-items?workspace_id=<uuid>`',
    '- `GET /shopping-items?list_id=<uuid>`',
    '- `POST /shopping-items`',
    '- `PATCH /shopping-items/:id`',
    '- `DELETE /shopping-items/:id`',
    '',
    'Minimal add shopping items request:',
    formatJsonBlock({
      list_id: '<shopping-list-id>',
      items: [
        'Milk',
        'Eggs',
        {
          name: 'Bread',
          is_checked: false
        }
      ]
    }),
    '',
    'Convert a leaf task into a shopping item:',
    '- `POST /tasks/:id/convert-to-shopping-item`',
    formatJsonBlock({
      list_id: '<shopping-list-id>'
    }),
    '',
    '## Notice types',
    '- `GET /notice-types?workspace_id=<uuid>`',
    '- `POST /notice-types`',
    '- `PATCH /notice-types/:id`',
    '- `DELETE /notice-types/:id`',
    '',
    'Minimal create notice type request:',
    formatJsonBlock({
      workspace_id: currentWorkspaceId,
      label: 'Bill notice'
    }),
    '',
    '## Notices',
    '- `GET /notices?workspace_id=<uuid>`',
    '- `POST /notices`',
    '- `PATCH /notices/:id`',
    '- `DELETE /notices/:id`',
    '',
    'Minimal create notice request:',
    formatJsonBlock({
      workspace_id: currentWorkspaceId,
      title: 'Pay credit card bill',
      notify_at: tomorrow,
      notice_type: 'bill'
    }),
    '',
    '## Sync',
    '- `POST /sync/pull`',
    '- `POST /sync/push`',
    '',
    'Minimal sync pull request:',
    formatJsonBlock({
      workspace_id: currentWorkspaceId,
      cursor: 0
    }),
    '',
    '## Admin',
    '- `GET /admin/info`',
    '- `GET /admin/invites`',
    '- `POST /admin/invites`',
    '- `DELETE /admin/invites/:id`',
    '',
    'Minimal create invite request:',
    formatJsonBlock({
      workspace_id: currentWorkspaceId,
      email: 'roger@example.com',
      role: 'member'
    }),
    '',
    '## Authentication payload examples',
    'Login request:',
    formatJsonBlock({
      email: 'user@example.com',
      password: 'secret'
    }),
    '',
    '`GET /auth/me` returns normalized principal, workspace, and permission context. Example shape:',
    formatJsonBlock({
      authenticated: true,
      auth_type: 'service_account',
      require_auth: true,
      principal_type: 'service_account',
      principal_id: '<service-account-id>',
      org_id: '<org-id>',
      user: null,
      service_account: {
        id: '<service-account-id>',
        org_id: '<org-id>',
        display_name: 'Roger - Ops',
        permissions: [
          'workspaces.read',
          'tasks.read',
          'tasks.create',
          'tasks.update',
          'projects.read'
        ],
        aliases: [
          {
            id: '<alias-id>',
            alias_type: 'telegram_group',
            alias_value: 'agent:main:telegram:group:-5130223325',
            metadata: {
              channel: 'telegram'
            }
          }
        ],
        token_id: '<token-id>',
        token_label: 'Roger primary token',
        token_expires_at: null
      },
      session: null,
      workspaces: [
        {
          id: currentWorkspaceId,
          name: 'Personal',
          type: 'personal',
          role: 'member'
        }
      ],
      granted_permissions: [
        'workspaces.read',
        'tasks.read',
        'tasks.create',
        'tasks.update',
        'projects.read'
      ],
      effective_permissions: [
        'workspaces.read',
        'tasks.read',
        'tasks.create',
        'tasks.update',
        'projects.read'
      ]
    }),
    '',
    '## Error envelope',
    formatJsonBlock({
      code: 'validation_error',
      message: 'body must have required property workspace_id',
      requestId: '<request-id>'
    }),
    '',
    '## Automation guardrails',
    '- Roger is approved for server operations over Tailscale + SSH.',
    '- Roger uses an owner-provisioned service account with explicit workspace grants.',
    '- Roger default scope excludes destructive task authority until `tasks.delete` is explicitly granted.',
    '- Do not turn a chat or channel identifier into the canonical service-account identity; store it as an alias.',
    '- Use `group_label` for sections and true parent/child hierarchy only for actual subtasks.',
    '- Do not invent fake parent tasks as section placeholders.',
    '',
    '## Direct links',
    `- App: ${baseUrl}/apps/web/`,
    `- API help: ${buildBrianhubApiHelpUrl(baseUrl)}`
  ].join('\n');
}
