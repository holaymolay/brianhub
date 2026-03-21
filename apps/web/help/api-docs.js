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
    'auth_model: session-cookie',
    'machine_auth: not-yet-available',
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
    '- Bearer tokens and service-account auth are not active yet.',
    '- Most resource families are scoped by `workspace_id`.',
    '- Errors use a normalized envelope with `code`, `message`, and `requestId`.',
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
    '`GET /auth/me` returns user/session/workspace context. Example shape:',
    formatJsonBlock({
      authenticated: true,
      require_auth: true,
      user: {
        id: '<user-id>',
        org_id: '<org-id>',
        display_name: 'Brian',
        email: 'brianjason@gmail.com',
        org_role: 'admin'
      },
      session: {
        id: '<session-id>',
        expires_at: '<iso-datetime>'
      },
      workspaces: [
        {
          id: currentWorkspaceId,
          name: 'Personal',
          type: 'personal',
          role: 'owner'
        }
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
    '- Until machine auth exists, treat product API automation as human-session-only.',
    '- Use `group_label` for sections and true parent/child hierarchy only for actual subtasks.',
    '- Do not invent fake parent tasks as section placeholders.',
    '',
    '## Direct links',
    `- App: ${baseUrl}/apps/web/`,
    `- API help: ${buildBrianhubApiHelpUrl(baseUrl)}`
  ].join('\n');
}
