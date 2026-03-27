import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let server = null;
let serverModuleRef = null;
const tempDir = mkdtempSync(join(tmpdir(), 'brianhub-api-test-'));
const tempDbPath = join(tempDir, 'api-test.sqlite');
const previousDb = process.env.BRIANHUB_DB;
const previousNodeEnv = process.env.NODE_ENV;
const previousExposeInviteToken = process.env.BRIANHUB_EXPOSE_INVITE_TOKEN;
const previousRequireAuth = process.env.BRIANHUB_REQUIRE_AUTH;
const previousAllowHeaderActorAuth = process.env.BRIANHUB_ALLOW_HEADER_ACTOR_AUTH;
const ownerEmail = 'brian@pipecaminc.com';

function getSessionCookie(res) {
  const header = res.headers['set-cookie'];
  if (!header) return null;
  const raw = Array.isArray(header) ? header[0] : header;
  const match = String(raw).match(/^[^;]+/);
  return match ? match[0] : null;
}

async function createAcceptedUser({
  workspaceName,
  email,
  displayName,
  password,
  role = 'member'
}) {
  const workspaceRes = await server.inject({
    method: 'POST',
    url: '/workspaces',
    payload: {
      name: workspaceName,
      type: 'personal',
      org_id: '00000000-0000-4000-8000-000000000001'
    }
  });
  assert.equal(workspaceRes.statusCode, 200);
  const workspaceId = workspaceRes.json().id;

  const inviteRes = await server.inject({
    method: 'POST',
    url: '/admin/invites',
    headers: {
      'x-actor-email': ownerEmail
    },
    payload: {
      workspace_id: workspaceId,
      email,
      role
    }
  });
  assert.equal(inviteRes.statusCode, 200);
  const inviteToken = inviteRes.json().invite?.invite_token;
  assert.equal(typeof inviteToken, 'string');

  const acceptRes = await server.inject({
    method: 'POST',
    url: '/auth/invite/accept',
    payload: {
      invite_token: inviteToken,
      email,
      display_name: displayName,
      password
    }
  });
  assert.equal(acceptRes.statusCode, 200);
  const cookie = getSessionCookie(acceptRes);
  assert.ok(cookie);

  return {
    workspaceId,
    inviteToken,
    auth: acceptRes.json(),
    cookie
  };
}

before(async () => {
  process.env.BRIANHUB_DB = tempDbPath;
  process.env.NODE_ENV = 'test';
  process.env.BRIANHUB_EXPOSE_INVITE_TOKEN = 'true';
  process.env.BRIANHUB_REQUIRE_AUTH = 'false';
  process.env.BRIANHUB_ALLOW_HEADER_ACTOR_AUTH = 'true';
  const serverUrl = new URL('../services/api/src/server.js', import.meta.url);
  serverUrl.search = `v=${Date.now()}-${process.hrtime.bigint().toString()}`;
  const serverModule = await import(serverUrl);
  serverModuleRef = serverModule;
  server = serverModule.server;
  await server.ready();
});

after(async () => {
  if (server) await server.close();
  if (previousDb === undefined) {
    delete process.env.BRIANHUB_DB;
  } else {
    process.env.BRIANHUB_DB = previousDb;
  }
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
  if (previousExposeInviteToken === undefined) {
    delete process.env.BRIANHUB_EXPOSE_INVITE_TOKEN;
  } else {
    process.env.BRIANHUB_EXPOSE_INVITE_TOKEN = previousExposeInviteToken;
  }
  if (previousRequireAuth === undefined) {
    delete process.env.BRIANHUB_REQUIRE_AUTH;
  } else {
    process.env.BRIANHUB_REQUIRE_AUTH = previousRequireAuth;
  }
  if (previousAllowHeaderActorAuth === undefined) {
    delete process.env.BRIANHUB_ALLOW_HEADER_ACTOR_AUTH;
  } else {
    process.env.BRIANHUB_ALLOW_HEADER_ACTOR_AUTH = previousAllowHeaderActorAuth;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

test('server propagates request id header and standardized not found errors', async () => {
  const inboundRequestId = 'req-hardening-001';
  const healthRes = await server.inject({
    method: 'GET',
    url: '/health',
    headers: {
      'x-request-id': inboundRequestId
    }
  });
  assert.equal(healthRes.statusCode, 200);
  assert.equal(healthRes.headers['x-request-id'], inboundRequestId);

  const missingRes = await server.inject({
    method: 'GET',
    url: '/missing-route'
  });
  assert.equal(missingRes.statusCode, 404);
  assert.ok(typeof missingRes.headers['x-request-id'] === 'string');
  const body = missingRes.json();
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(body.error.requestId, missingRes.headers['x-request-id']);
});

test('sync push validates payloads and dedupes repeated client mutation ids', async () => {
  const invalidPush = await server.inject({
    method: 'POST',
    url: '/sync/push',
    payload: {}
  });
  assert.equal(invalidPush.statusCode, 400);
  const invalidPushBody = invalidPush.json();
  assert.equal(typeof invalidPushBody.error.requestId, 'string');

  const firstPush = await server.inject({
    method: 'POST',
    url: '/sync/push',
    payload: {
      workspace_id: '00000000-0000-4000-8000-000000000001',
      client_id: 'client-a',
      changes: [
        {
          entity_type: 'task',
          entity_id: '11111111-1111-4111-8111-111111111111',
          action: 'create',
          client_mutation_id: 'mutation-001',
          payload: { title: 'Test task' }
        }
      ]
    }
  });
  assert.equal(firstPush.statusCode, 200);
  assert.equal(firstPush.json().applied, 1);
  assert.equal(firstPush.json().deduped, 0);

  const secondPush = await server.inject({
    method: 'POST',
    url: '/sync/push',
    payload: {
      workspace_id: '00000000-0000-4000-8000-000000000001',
      client_id: 'client-a',
      changes: [
        {
          entity_type: 'task',
          entity_id: '11111111-1111-4111-8111-111111111111',
          action: 'create',
          client_mutation_id: 'mutation-001',
          payload: { title: 'Test task' }
        }
      ]
    }
  });
  assert.equal(secondPush.statusCode, 200);
  assert.equal(secondPush.json().applied, 0);
  assert.equal(secondPush.json().deduped, 1);

  const pullRes = await server.inject({
    method: 'POST',
    url: '/sync/pull',
    payload: {
      workspace_id: '00000000-0000-4000-8000-000000000001',
      cursor: 0
    }
  });
  assert.equal(pullRes.statusCode, 200);
  const pullBody = pullRes.json();
  assert.equal(Array.isArray(pullBody.changes), true);
  assert.equal(pullBody.changes.length, 1);
});

test('sync push returns 409 conflict with server version for stale task mutation', async () => {
  const taskId = '33333333-3333-4333-8333-333333333333';

  const workspaceRes = await server.inject({
    method: 'POST',
    url: '/workspaces',
    payload: {
      name: 'Sync test workspace',
      type: 'personal',
      org_id: '00000000-0000-4000-8000-000000000001'
    }
  });
  assert.equal(workspaceRes.statusCode, 200);
  const workspaceId = workspaceRes.json().id;

  const taskRes = await server.inject({
    method: 'POST',
    url: '/tasks',
    payload: {
      id: taskId,
      workspace_id: workspaceId,
      title: 'Stale task test'
    }
  });
  assert.equal(taskRes.statusCode, 200);
  const createdTask = taskRes.json();
  assert.equal(createdTask.status, '');
  assert.equal(typeof createdTask.updated_at, 'string');

  const conflictRes = await server.inject({
    method: 'POST',
    url: '/sync/push',
    payload: {
      workspace_id: workspaceId,
      client_id: 'client-c',
      changes: [
        {
          entity_type: 'task',
          entity_id: taskId,
          action: 'update',
          client_mutation_id: 'mutation-conflict-001',
          payload: {
            title: 'Stale update',
            expected_updated_at: '2024-01-01T00:00:00.000Z'
          }
        }
      ]
    }
  });

  assert.equal(conflictRes.statusCode, 409);
  const conflictBody = conflictRes.json();
  assert.equal(conflictBody.error.code, 'CONFLICT');
  assert.equal(conflictBody.error.conflict.entity_type, 'task');
  assert.equal(conflictBody.error.conflict.entity_id, taskId);
  assert.equal(conflictBody.error.conflict.reason, 'stale');
  assert.equal(conflictBody.error.conflict.server_version.entity_id, taskId);
  assert.equal(conflictBody.error.conflict.server_version.updated_at, createdTask.updated_at);
});

test('shopping lists persist scheduled_for and tasks can convert into shopping items', async () => {
  const workspaceRes = await server.inject({
    method: 'POST',
    url: '/workspaces',
    payload: {
      name: 'Shopping convert workspace',
      type: 'personal',
      org_id: '00000000-0000-4000-8000-000000000001'
    }
  });
  assert.equal(workspaceRes.statusCode, 200);
  const workspaceId = workspaceRes.json().id;

  const listRes = await server.inject({
    method: 'POST',
    url: '/shopping-lists',
    payload: {
      workspace_id: workspaceId,
      name: 'Weekend run',
      scheduled_for: '2026-03-21'
    }
  });
  assert.equal(listRes.statusCode, 200);
  const list = listRes.json();
  assert.equal(list.scheduled_for, '2026-03-21');

  const taskRes = await server.inject({
    method: 'POST',
    url: '/tasks',
    payload: {
      workspace_id: workspaceId,
      title: 'Buy hand wipes'
    }
  });
  assert.equal(taskRes.statusCode, 200);
  const task = taskRes.json();

  const convertRes = await server.inject({
    method: 'POST',
    url: `/tasks/${task.id}/convert-to-shopping-item`,
    payload: {
      list_id: list.id
    }
  });
  assert.equal(convertRes.statusCode, 200);
  const converted = convertRes.json();
  assert.equal(converted.shopping_item.name, 'Buy hand wipes');
  assert.equal(converted.shopping_item.item_state, 'pending');
  assert.equal(converted.shopping_item.substitute_name, null);
  assert.deepEqual(converted.deleted_task.ids, [task.id]);

  const fetchedTaskRes = await server.inject({
    method: 'GET',
    url: `/tasks/${task.id}`
  });
  assert.equal(fetchedTaskRes.statusCode, 404);

  const itemsRes = await server.inject({
    method: 'GET',
    url: `/shopping-items?workspace_id=${workspaceId}`
  });
  assert.equal(itemsRes.statusCode, 200);
  assert.equal(itemsRes.json().some((item) => item.name === 'Buy hand wipes' && item.list_id === list.id), true);
});

test('shopping items support unavailable substitutions and preserved outcomes over the API', async () => {
  const workspaceRes = await server.inject({
    method: 'POST',
    url: '/workspaces',
    payload: {
      name: 'Shopping outcomes workspace',
      type: 'personal',
      org_id: '00000000-0000-4000-8000-000000000001'
    }
  });
  assert.equal(workspaceRes.statusCode, 200);
  const workspaceId = workspaceRes.json().id;

  const listRes = await server.inject({
    method: 'POST',
    url: '/shopping-lists',
    payload: {
      workspace_id: workspaceId,
      name: 'Safeway run',
      store_name: 'Safeway'
    }
  });
  assert.equal(listRes.statusCode, 200);
  const list = listRes.json();

  const itemRes = await server.inject({
    method: 'POST',
    url: '/shopping-items',
    payload: {
      list_id: list.id,
      name: 'Hand wipes'
    }
  });
  assert.equal(itemRes.statusCode, 200);
  const item = itemRes.json();

  const substitutedRes = await server.inject({
    method: 'PATCH',
    url: `/shopping-items/${item.id}`,
    payload: {
      item_state: 'substituted',
      substitute_name: 'Disinfecting wipes'
    }
  });
  assert.equal(substitutedRes.statusCode, 200);
  assert.equal(substitutedRes.json().name, 'Hand wipes');
  assert.equal(substitutedRes.json().item_state, 'substituted');
  assert.equal(substitutedRes.json().substitute_name, 'Disinfecting wipes');
  assert.equal(substitutedRes.json().is_checked, 1);

  const unavailableRes = await server.inject({
    method: 'PATCH',
    url: `/shopping-items/${item.id}`,
    payload: {
      item_state: 'unavailable'
    }
  });
  assert.equal(unavailableRes.statusCode, 200);
  assert.equal(unavailableRes.json().item_state, 'unavailable');
  assert.equal(unavailableRes.json().substitute_name, null);
  assert.equal(unavailableRes.json().is_checked, 1);
});

test('invite accept creates credentials and session, then login/logout cycle works', async () => {
  const inviteeEmail = 'new.user@example.com';
  const inviteeName = 'New User';
  const inviteePassword = 'Passw0rd!234';

  const workspaceRes = await server.inject({
    method: 'POST',
    url: '/workspaces',
    payload: {
      name: 'Auth workspace',
      type: 'personal',
      org_id: '00000000-0000-4000-8000-000000000001'
    }
  });
  assert.equal(workspaceRes.statusCode, 200);
  const workspaceId = workspaceRes.json().id;

  const inviteRes = await server.inject({
    method: 'POST',
    url: '/admin/invites',
    headers: {
      'x-actor-email': ownerEmail
    },
    payload: {
      workspace_id: workspaceId,
      email: inviteeEmail,
      role: 'member'
    }
  });
  assert.equal(inviteRes.statusCode, 200);
  const inviteToken = inviteRes.json().invite?.invite_token;
  assert.equal(typeof inviteToken, 'string');
  assert.ok(inviteToken.length > 10);

  const acceptRes = await server.inject({
    method: 'POST',
    url: '/auth/invite/accept',
    payload: {
      invite_token: inviteToken,
      email: inviteeEmail,
      display_name: inviteeName,
      password: inviteePassword
    }
  });
  assert.equal(acceptRes.statusCode, 200);
  const accepted = acceptRes.json();
  assert.equal(accepted.authenticated, true);
  assert.equal(accepted.user.email, inviteeEmail);
  const acceptedCookie = getSessionCookie(acceptRes);
  assert.ok(acceptedCookie);

  const meRes = await server.inject({
    method: 'GET',
    url: '/auth/me',
    headers: {
      cookie: acceptedCookie
    }
  });
  assert.equal(meRes.statusCode, 200);
  const meBody = meRes.json();
  assert.equal(meBody.authenticated, true);
  assert.equal(meBody.user.email, inviteeEmail);
  assert.equal(Array.isArray(meBody.workspaces), true);
  assert.ok(meBody.workspaces.length >= 1);

  const logoutRes = await server.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: {
      cookie: acceptedCookie
    }
  });
  assert.equal(logoutRes.statusCode, 200);
  const clearedCookie = getSessionCookie(logoutRes);
  assert.ok(clearedCookie);
  assert.match(clearedCookie, /^brianhub_session=/);

  const meAfterLogoutRes = await server.inject({
    method: 'GET',
    url: '/auth/me',
    headers: {
      cookie: acceptedCookie
    }
  });
  assert.equal(meAfterLogoutRes.statusCode, 200);
  assert.equal(meAfterLogoutRes.json().authenticated, false);

  const loginRes = await server.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {
      email: inviteeEmail,
      password: inviteePassword
    }
  });
  assert.equal(loginRes.statusCode, 200);
  const loginBody = loginRes.json();
  assert.equal(loginBody.authenticated, true);
  assert.equal(loginBody.user.email, inviteeEmail);
  const loginCookie = getSessionCookie(loginRes);
  assert.ok(loginCookie);
});

test('authenticated users only list workspaces they belong to', async () => {
  const userA = await createAcceptedUser({
    workspaceName: 'Scoped workspace A',
    email: 'workspace.scope.a@example.com',
    displayName: 'Workspace Scope A',
    password: 'Passw0rd!ScopeA'
  });
  const userB = await createAcceptedUser({
    workspaceName: 'Scoped workspace B',
    email: 'workspace.scope.b@example.com',
    displayName: 'Workspace Scope B',
    password: 'Passw0rd!ScopeB'
  });

  const listA = await server.inject({
    method: 'GET',
    url: '/workspaces',
    headers: {
      cookie: userA.cookie
    }
  });
  assert.equal(listA.statusCode, 200);
  assert.deepEqual(listA.json().map((workspace) => workspace.id), [userA.workspaceId]);

  const meA = await server.inject({
    method: 'GET',
    url: '/auth/me',
    headers: {
      cookie: userA.cookie
    }
  });
  assert.equal(meA.statusCode, 200);
  assert.deepEqual(meA.json().workspaces.map((workspace) => workspace.id), [userA.workspaceId]);

  const listB = await server.inject({
    method: 'GET',
    url: '/workspaces',
    headers: {
      cookie: userB.cookie
    }
  });
  assert.equal(listB.statusCode, 200);
  assert.deepEqual(listB.json().map((workspace) => workspace.id), [userB.workspaceId]);
});

test('authenticated workspace creators are automatically enrolled in their new workspace', async () => {
  const creator = await createAcceptedUser({
    workspaceName: 'Workspace creator home',
    email: 'workspace.creator@example.com',
    displayName: 'Workspace Creator',
    password: 'Passw0rd!Creator'
  });

  const createRes = await server.inject({
    method: 'POST',
    url: '/workspaces',
    headers: {
      cookie: creator.cookie
    },
    payload: {
      name: 'Roger',
      type: 'personal',
      org_id: creator.auth.user.org_id
    }
  });
  assert.equal(createRes.statusCode, 200);
  const createdWorkspace = createRes.json();

  const listRes = await server.inject({
    method: 'GET',
    url: '/workspaces',
    headers: {
      cookie: creator.cookie
    }
  });
  assert.equal(listRes.statusCode, 200);
  assert.deepEqual(
    listRes.json().map((workspace) => workspace.id),
    [creator.workspaceId, createdWorkspace.id]
  );

  const membershipsRes = await server.inject({
    method: 'GET',
    url: `/workspace-memberships?workspace_id=${encodeURIComponent(createdWorkspace.id)}`,
    headers: {
      cookie: creator.cookie
    }
  });
  assert.equal(membershipsRes.statusCode, 200);
  assert.equal(membershipsRes.json().length, 1);
  assert.equal(membershipsRes.json()[0].user_id, creator.auth.user.id);
});

test('authenticated users cannot read or mutate another users workspace-scoped resources', async () => {
  const userA = await createAcceptedUser({
    workspaceName: 'Isolation source workspace',
    email: 'isolation.source@example.com',
    displayName: 'Isolation Source',
    password: 'Passw0rd!IsolationA'
  });
  const userB = await createAcceptedUser({
    workspaceName: 'Isolation viewer workspace',
    email: 'isolation.viewer@example.com',
    displayName: 'Isolation Viewer',
    password: 'Passw0rd!IsolationB'
  });

  const authHeadersA = { cookie: userA.cookie };
  const authHeadersB = { cookie: userB.cookie };
  const previousRequireAuth = serverModuleRef.config.requireAuth;
  serverModuleRef.config.requireAuth = true;

  try {
    const projectRes = await server.inject({
      method: 'POST',
      url: '/projects',
      headers: authHeadersA,
      payload: {
        workspace_id: userA.workspaceId,
        name: 'Source project'
      }
    });
    assert.equal(projectRes.statusCode, 200);
    const project = projectRes.json();

    const templateRes = await server.inject({
      method: 'POST',
      url: '/templates',
      headers: authHeadersA,
      payload: {
        workspace_id: userA.workspaceId,
        name: 'Source template'
      }
    });
    assert.equal(templateRes.statusCode, 200);
    const template = templateRes.json();

    const statusRes = await server.inject({
      method: 'POST',
      url: '/statuses',
      headers: authHeadersA,
      payload: {
        workspace_id: userA.workspaceId,
        label: 'Source status'
      }
    });
    assert.equal(statusRes.statusCode, 200);
    const status = statusRes.json();

    const taskTypeRes = await server.inject({
      method: 'POST',
      url: '/task-types',
      headers: authHeadersA,
      payload: {
        workspace_id: userA.workspaceId,
        name: 'Source type'
      }
    });
    assert.equal(taskTypeRes.statusCode, 200);
    const taskType = taskTypeRes.json();

    const noticeTypeRes = await server.inject({
      method: 'POST',
      url: '/notice-types',
      headers: authHeadersA,
      payload: {
        workspace_id: userA.workspaceId,
        label: 'Reminder'
      }
    });
    assert.equal(noticeTypeRes.statusCode, 200);
    const noticeType = noticeTypeRes.json();

    const noticeRes = await server.inject({
      method: 'POST',
      url: '/notices',
      headers: authHeadersA,
      payload: {
        workspace_id: userA.workspaceId,
        title: 'Source notice',
        notify_at: '2026-03-28T08:00:00.000Z',
        notice_type_id: noticeType.id
      }
    });
    assert.equal(noticeRes.statusCode, 200);
    const notice = noticeRes.json();

    const storeRuleRes = await server.inject({
      method: 'POST',
      url: '/store-rules',
      headers: authHeadersA,
      payload: {
        workspace_id: userA.workspaceId,
        store_name: 'Costco'
      }
    });
    assert.equal(storeRuleRes.statusCode, 200);
    const storeRule = storeRuleRes.json();

    const shoppingListRes = await server.inject({
      method: 'POST',
      url: '/shopping-lists',
      headers: authHeadersA,
      payload: {
        workspace_id: userA.workspaceId,
        name: 'Source shopping list'
      }
    });
    assert.equal(shoppingListRes.statusCode, 200);
    const shoppingList = shoppingListRes.json();

    const shoppingItemRes = await server.inject({
      method: 'POST',
      url: '/shopping-items',
      headers: authHeadersA,
      payload: {
        list_id: shoppingList.id,
        name: 'Source shopping item'
      }
    });
    assert.equal(shoppingItemRes.statusCode, 200);
    const shoppingItem = shoppingItemRes.json();

    const taskRes = await server.inject({
      method: 'POST',
      url: '/tasks',
      headers: authHeadersA,
      payload: {
        workspace_id: userA.workspaceId,
        title: 'Source task'
      }
    });
    assert.equal(taskRes.statusCode, 200);
    const task = taskRes.json();

    const forbiddenReads = [
      `/projects?workspace_id=${encodeURIComponent(userA.workspaceId)}`,
      `/templates?workspace_id=${encodeURIComponent(userA.workspaceId)}`,
      `/statuses?workspace_id=${encodeURIComponent(userA.workspaceId)}`,
      `/task-types?workspace_id=${encodeURIComponent(userA.workspaceId)}`,
      `/notice-types?workspace_id=${encodeURIComponent(userA.workspaceId)}`,
      `/notices?workspace_id=${encodeURIComponent(userA.workspaceId)}`,
      `/store-rules?workspace_id=${encodeURIComponent(userA.workspaceId)}`,
      `/shopping-lists?workspace_id=${encodeURIComponent(userA.workspaceId)}`,
      `/shopping-items?workspace_id=${encodeURIComponent(userA.workspaceId)}`,
      `/shopping-items?list_id=${encodeURIComponent(shoppingList.id)}`,
      `/tasks?workspace_id=${encodeURIComponent(userA.workspaceId)}`,
      `/task-dependencies?workspace_id=${encodeURIComponent(userA.workspaceId)}`,
      `/tasks/tree?workspace_id=${encodeURIComponent(userA.workspaceId)}`
    ];

    for (const url of forbiddenReads) {
      const response = await server.inject({
        method: 'GET',
        url,
        headers: authHeadersB
      });
      assert.equal(response.statusCode, 403, `expected forbidden for ${url}`);
    }

    const searchRes = await server.inject({
      method: 'POST',
      url: '/tasks/search',
      headers: authHeadersB,
      payload: {
        workspace_id: userA.workspaceId,
        text: 'Source'
      }
    });
    assert.equal(searchRes.statusCode, 403);

    const syncPullRes = await server.inject({
      method: 'POST',
      url: '/sync/pull',
      headers: authHeadersB,
      payload: {
        workspace_id: userA.workspaceId,
        cursor: 0
      }
    });
    assert.equal(syncPullRes.statusCode, 403);

    const forbiddenMutations = [
      ['PATCH', `/projects/${project.id}`, { name: 'Intrusion project' }],
      ['PATCH', `/templates/${template.id}`, { name: 'Intrusion template' }],
      ['PATCH', `/statuses/${status.id}`, { label: 'Intrusion status' }],
      ['PATCH', `/task-types/${taskType.id}`, { name: 'Intrusion type' }],
      ['PATCH', `/notice-types/${noticeType.id}`, { label: 'Intrusion notice type' }],
      ['PATCH', `/notices/${notice.id}`, { title: 'Intrusion notice' }],
      ['PATCH', `/store-rules/${storeRule.id}`, { store_name: 'Intrusion store' }],
      ['PATCH', `/shopping-lists/${shoppingList.id}`, { name: 'Intrusion shopping list' }],
      ['PATCH', `/shopping-items/${shoppingItem.id}`, { name: 'Intrusion shopping item' }],
      ['PATCH', `/tasks/${task.id}`, { title: 'Intrusion task' }],
      ['DELETE', `/shopping-lists/${shoppingList.id}`, null],
      ['DELETE', `/templates/${template.id}`, null]
    ];

    for (const [method, url, payload] of forbiddenMutations) {
      const response = await server.inject({
        method,
        url,
        headers: authHeadersB,
        payload: payload ?? undefined
      });
      assert.equal(response.statusCode, 403, `expected forbidden for ${method} ${url}`);
    }

    const convertRes = await server.inject({
      method: 'POST',
      url: `/tasks/${task.id}/convert-to-shopping-item`,
      headers: authHeadersB,
      payload: {
        list_id: shoppingList.id
      }
    });
    assert.equal(convertRes.statusCode, 403);
  } finally {
    serverModuleRef.config.requireAuth = previousRequireAuth;
  }
});

test('invite accept rejects email that does not match the invite', async () => {
  const inviteeEmail = 'mismatch.user@example.com';
  const workspaceRes = await server.inject({
    method: 'POST',
    url: '/workspaces',
    payload: {
      name: 'Auth mismatch workspace',
      type: 'personal',
      org_id: '00000000-0000-4000-8000-000000000001'
    }
  });
  assert.equal(workspaceRes.statusCode, 200);
  const workspaceId = workspaceRes.json().id;

  const inviteRes = await server.inject({
    method: 'POST',
    url: '/admin/invites',
    headers: {
      'x-actor-email': ownerEmail
    },
    payload: {
      workspace_id: workspaceId,
      email: inviteeEmail,
      role: 'member'
    }
  });
  assert.equal(inviteRes.statusCode, 200);
  const inviteToken = inviteRes.json().invite?.invite_token;
  assert.equal(typeof inviteToken, 'string');

  const rejectRes = await server.inject({
    method: 'POST',
    url: '/auth/invite/accept',
    payload: {
      invite_token: inviteToken,
      email: 'different.user@example.com',
      display_name: 'Wrong User',
      password: 'Passw0rd!234'
    }
  });
  assert.equal(rejectRes.statusCode, 400);
  assert.equal(rejectRes.json().error.message, 'email does not match invite');
});

test('admin can delete a pending invite (revokes and removes from pending list)', async () => {
  const workspaceRes = await server.inject({
    method: 'POST',
    url: '/workspaces',
    payload: {
      name: 'Invite revoke workspace',
      type: 'personal',
      org_id: '00000000-0000-4000-8000-000000000001'
    }
  });
  assert.equal(workspaceRes.statusCode, 200);
  const workspaceId = workspaceRes.json().id;

  const inviteRes = await server.inject({
    method: 'POST',
    url: '/admin/invites',
    headers: {
      'x-actor-email': ownerEmail
    },
    payload: {
      workspace_id: workspaceId,
      email: 'delete.me@example.com',
      role: 'member'
    }
  });
  assert.equal(inviteRes.statusCode, 200);
  const inviteId = inviteRes.json().invite?.id;
  assert.equal(typeof inviteId, 'string');

  const deleteRes = await server.inject({
    method: 'DELETE',
    url: `/admin/invites/${inviteId}`,
    headers: {
      'x-actor-email': ownerEmail
    }
  });
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.json().invite?.status, 'revoked');

  const pendingRes = await server.inject({
    method: 'GET',
    url: `/admin/invites?workspace_id=${encodeURIComponent(workspaceId)}&status=pending`,
    headers: {
      'x-actor-email': ownerEmail
    }
  });
  assert.equal(pendingRes.statusCode, 200);
  assert.equal(pendingRes.json().count, 0);

  const allRes = await server.inject({
    method: 'GET',
    url: `/admin/invites?workspace_id=${encodeURIComponent(workspaceId)}&status=all`,
    headers: {
      'x-actor-email': ownerEmail
    }
  });
  assert.equal(allRes.statusCode, 200);
  assert.equal(allRes.json().count, 1);
  assert.equal(allRes.json().invites[0].id, inviteId);
  assert.equal(allRes.json().invites[0].status, 'revoked');
});

test('admin invite endpoints honor exposeInviteToken config', async () => {
  const previousValue = serverModuleRef.config.exposeInviteToken;
  serverModuleRef.config.exposeInviteToken = false;
  try {
    const workspaceRes = await server.inject({
      method: 'POST',
      url: '/workspaces',
      payload: {
        name: 'No token workspace',
        type: 'personal',
        org_id: '00000000-0000-4000-8000-000000000001'
      }
    });
    assert.equal(workspaceRes.statusCode, 200);
    const workspaceId = workspaceRes.json().id;

    const inviteRes = await server.inject({
      method: 'POST',
      url: '/admin/invites',
      headers: {
        'x-actor-email': ownerEmail
      },
      payload: {
        workspace_id: workspaceId,
        email: 'no.token@example.com'
      }
    });
    assert.equal(inviteRes.statusCode, 200);
    assert.equal(inviteRes.json().invite.invite_token, undefined);

    const listRes = await server.inject({
      method: 'GET',
      url: `/admin/invites?workspace_id=${encodeURIComponent(workspaceId)}&status=pending`,
      headers: {
        'x-actor-email': ownerEmail
      }
    });
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.json().invites[0].invite_token, undefined);
  } finally {
    serverModuleRef.config.exposeInviteToken = previousValue;
  }
});

test('owner account is normalized to admin role in user records', async () => {
  const createOwnerRes = await server.inject({
    method: 'POST',
    url: '/users',
    payload: {
      org_id: '00000000-0000-4000-8000-000000000001',
      display_name: 'Owner Seed',
      email: ownerEmail
    }
  });
  assert.equal(createOwnerRes.statusCode, 200);
  assert.equal(createOwnerRes.json().email, ownerEmail);
  assert.equal(createOwnerRes.json().org_role, 'admin');

  const listOwnerRes = await server.inject({
    method: 'GET',
    url: '/users?org_id=00000000-0000-4000-8000-000000000001'
  });
  assert.equal(listOwnerRes.statusCode, 200);
  const ownerRow = listOwnerRes.json().find((user) => user.email === ownerEmail);
  assert.ok(ownerRow);
  assert.equal(ownerRow.org_role, 'admin');
});

test('task creation defaults assignee to authenticated creator', async () => {
  const creator = await createAcceptedUser({
    workspaceName: 'Default assignee workspace',
    email: 'default.assignee@example.com',
    displayName: 'Default Assignee',
    password: 'Passw0rd!Default'
  });
  const creatorId = creator.auth.user.id;

  const createTaskRes = await server.inject({
    method: 'POST',
    url: '/tasks',
    headers: {
      cookie: creator.cookie
    },
    payload: {
      workspace_id: creator.workspaceId,
      title: 'Task assigned to creator by default'
    }
  });
  assert.equal(createTaskRes.statusCode, 200);
  const createdTask = createTaskRes.json();
  assert.equal(createdTask.assignee_user_id, creatorId);
  assert.equal(createdTask.assignee_label, null);
});

test('profile/settings updates stay scoped to the authenticated account', async () => {
  const userA = await createAcceptedUser({
    workspaceName: 'Scoped settings workspace A',
    email: 'scoped.a@example.com',
    displayName: 'Scoped User A',
    password: 'Passw0rd!A'
  });
  const userB = await createAcceptedUser({
    workspaceName: 'Scoped settings workspace B',
    email: 'scoped.b@example.com',
    displayName: 'Scoped User B',
    password: 'Passw0rd!B'
  });

  const setA = await server.inject({
    method: 'PATCH',
    url: '/auth/settings',
    headers: {
      cookie: userA.cookie
    },
    payload: {
      settings: {
        checkin_extend_minutes: 25,
        task_ui: {
          quick_add_visible: false
        }
      }
    }
  });
  assert.equal(setA.statusCode, 200);
  assert.equal(setA.json().settings.checkin_extend_minutes, 25);
  assert.equal(setA.json().settings.task_ui.quick_add_visible, false);

  const getA = await server.inject({
    method: 'GET',
    url: '/auth/settings',
    headers: {
      cookie: userA.cookie
    }
  });
  assert.equal(getA.statusCode, 200);
  assert.equal(getA.json().settings.checkin_extend_minutes, 25);

  const getB = await server.inject({
    method: 'GET',
    url: '/auth/settings',
    headers: {
      cookie: userB.cookie
    }
  });
  assert.equal(getB.statusCode, 200);
  assert.deepEqual(getB.json().settings, {});

  const profileA = await server.inject({
    method: 'PATCH',
    url: '/auth/profile',
    headers: {
      cookie: userA.cookie
    },
    payload: {
      display_name: 'Scoped User A Prime'
    }
  });
  assert.equal(profileA.statusCode, 200);
  assert.equal(profileA.json().user.display_name, 'Scoped User A Prime');

  const forbidden = await server.inject({
    method: 'PATCH',
    url: `/users/${userB.auth.user.id}`,
    headers: {
      cookie: userA.cookie
    },
    payload: {
      display_name: 'Should Fail'
    }
  });
  assert.equal(forbidden.statusCode, 403);
});

test('owner-only admin promotion is enforced for invites', async () => {
  const adminUser = await createAcceptedUser({
    workspaceName: 'Invite role admin workspace',
    email: 'invite.admin@example.com',
    displayName: 'Invite Admin',
    password: 'Passw0rd!Admin',
    role: 'admin'
  });
  assert.equal(adminUser.auth.user.org_role, 'admin');

  const adminInfo = await server.inject({
    method: 'GET',
    url: '/admin/info',
    headers: {
      cookie: adminUser.cookie
    }
  });
  assert.equal(adminInfo.statusCode, 200);
  assert.equal(adminInfo.json().is_owner, false);
  assert.equal(adminInfo.json().is_admin, true);

  const workspaceRes = await server.inject({
    method: 'POST',
    url: '/workspaces',
    payload: {
      name: 'Admin invite restriction workspace',
      type: 'personal',
      org_id: '00000000-0000-4000-8000-000000000001'
    }
  });
  assert.equal(workspaceRes.statusCode, 200);
  const workspaceId = workspaceRes.json().id;

  const rejectAdminInvite = await server.inject({
    method: 'POST',
    url: '/admin/invites',
    headers: {
      cookie: adminUser.cookie
    },
    payload: {
      workspace_id: workspaceId,
      email: 'blocked.admin.invite@example.com',
      role: 'admin'
    }
  });
  assert.equal(rejectAdminInvite.statusCode, 403);
});

test('owner/admin permissions enforce role guardrails and ownership transfer', async () => {
  const candidate = await createAcceptedUser({
    workspaceName: 'Ownership transfer workspace',
    email: 'owner.candidate@example.com',
    displayName: 'Owner Candidate',
    password: 'Passw0rd!Owner'
  });
  const member = await createAcceptedUser({
    workspaceName: 'Ownership transfer member workspace',
    email: 'admin.member@example.com',
    displayName: 'Admin Member',
    password: 'Passw0rd!Member'
  });

  const transferRes = await server.inject({
    method: 'POST',
    url: '/admin/ownership/transfer',
    headers: {
      'x-actor-email': ownerEmail
    },
    payload: {
      target_user_id: candidate.auth.user.id
    }
  });
  assert.equal(transferRes.statusCode, 200);
  assert.equal(transferRes.json().owner_email, candidate.auth.user.email);

  const ownerInfo = await server.inject({
    method: 'GET',
    url: '/admin/info',
    headers: {
      cookie: candidate.cookie
    }
  });
  assert.equal(ownerInfo.statusCode, 200);
  assert.equal(ownerInfo.json().is_owner, true);
  assert.equal(ownerInfo.json().is_admin, true);

  const promoteMember = await server.inject({
    method: 'PATCH',
    url: `/admin/users/${member.auth.user.id}`,
    headers: {
      cookie: candidate.cookie
    },
    payload: {
      org_role: 'admin'
    }
  });
  assert.equal(promoteMember.statusCode, 200);
  assert.equal(promoteMember.json().user.org_role, 'admin');

  const ownerRoleChangeByAdmin = await server.inject({
    method: 'PATCH',
    url: `/admin/users/${candidate.auth.user.id}`,
    headers: {
      cookie: member.cookie
    },
    payload: {
      org_role: 'member'
    }
  });
  assert.equal(ownerRoleChangeByAdmin.statusCode, 403);

  const ownerPasswordResetByAdmin = await server.inject({
    method: 'POST',
    url: `/admin/users/${candidate.auth.user.id}/reset-password`,
    headers: {
      cookie: member.cookie
    },
    payload: {
      password: 'Passw0rd!Reset'
    }
  });
  assert.equal(ownerPasswordResetByAdmin.statusCode, 403);
});

test('organization settings support create, membership management, and ownership transfer', async () => {
  const orgOwner = await createAcceptedUser({
    workspaceName: 'Org owner home workspace',
    email: 'org.owner@example.com',
    displayName: 'Org Owner',
    password: 'Passw0rd!OrgOwner'
  });
  const orgAdmin = await createAcceptedUser({
    workspaceName: 'Org admin home workspace',
    email: 'org.admin@example.com',
    displayName: 'Org Admin',
    password: 'Passw0rd!OrgAdmin'
  });
  const orgMember = await createAcceptedUser({
    workspaceName: 'Org member home workspace',
    email: 'org.member@example.com',
    displayName: 'Org Member',
    password: 'Passw0rd!OrgMember'
  });

  const createOrgRes = await server.inject({
    method: 'POST',
    url: '/orgs',
    headers: {
      cookie: orgOwner.cookie
    },
    payload: {
      name: 'Pipe Cam'
    }
  });
  assert.equal(createOrgRes.statusCode, 200);
  const createdOrg = createOrgRes.json();
  assert.equal(createdOrg.name, 'Pipe Cam');
  assert.equal(createdOrg.owner_user_id, orgOwner.auth.user.id);

  const ownerOrgsRes = await server.inject({
    method: 'GET',
    url: '/orgs',
    headers: {
      cookie: orgOwner.cookie
    }
  });
  assert.equal(ownerOrgsRes.statusCode, 200);
  const ownerOrgEntry = ownerOrgsRes.json().find((org) => org.id === createdOrg.id);
  assert.equal(ownerOrgEntry.current_user_role, 'owner');

  const addAdminRes = await server.inject({
    method: 'POST',
    url: `/orgs/${createdOrg.id}/members`,
    headers: {
      cookie: orgOwner.cookie
    },
    payload: {
      email: orgAdmin.auth.user.email,
      role: 'admin'
    }
  });
  assert.equal(addAdminRes.statusCode, 200);
  assert.equal(addAdminRes.json().member.role, 'admin');

  const addMemberRes = await server.inject({
    method: 'POST',
    url: `/orgs/${createdOrg.id}/members`,
    headers: {
      cookie: orgOwner.cookie
    },
    payload: {
      email: orgMember.auth.user.email,
      role: 'member'
    }
  });
  assert.equal(addMemberRes.statusCode, 200);
  assert.equal(addMemberRes.json().member.role, 'member');

  const adminMembersRes = await server.inject({
    method: 'GET',
    url: `/orgs/${createdOrg.id}/members`,
    headers: {
      cookie: orgAdmin.cookie
    }
  });
  assert.equal(adminMembersRes.statusCode, 200);
  assert.equal(adminMembersRes.json().count, 3);

  const promoteMemberRes = await server.inject({
    method: 'PATCH',
    url: `/orgs/${createdOrg.id}/members/${orgMember.auth.user.id}`,
    headers: {
      cookie: orgAdmin.cookie
    },
    payload: {
      role: 'admin'
    }
  });
  assert.equal(promoteMemberRes.statusCode, 200);
  assert.equal(promoteMemberRes.json().member.role, 'admin');

  const transferRes = await server.inject({
    method: 'POST',
    url: `/orgs/${createdOrg.id}/transfer-ownership`,
    headers: {
      cookie: orgOwner.cookie
    },
    payload: {
      target_user_id: orgAdmin.auth.user.id
    }
  });
  assert.equal(transferRes.statusCode, 200);
  assert.equal(transferRes.json().org.owner_user_id, orgAdmin.auth.user.id);

  const adminOrgsAfterTransferRes = await server.inject({
    method: 'GET',
    url: '/orgs',
    headers: {
      cookie: orgAdmin.cookie
    }
  });
  assert.equal(adminOrgsAfterTransferRes.statusCode, 200);
  const adminOrgAfterTransfer = adminOrgsAfterTransferRes.json().find((org) => org.id === createdOrg.id);
  assert.equal(adminOrgAfterTransfer.current_user_role, 'owner');

  const ownerOrgsAfterTransferRes = await server.inject({
    method: 'GET',
    url: '/orgs',
    headers: {
      cookie: orgOwner.cookie
    }
  });
  assert.equal(ownerOrgsAfterTransferRes.statusCode, 200);
  const ownerOrgAfterTransfer = ownerOrgsAfterTransferRes.json().find((org) => org.id === createdOrg.id);
  assert.equal(ownerOrgAfterTransfer.current_user_role, 'admin');

  const removeMemberRes = await server.inject({
    method: 'DELETE',
    url: `/orgs/${createdOrg.id}/members/${orgMember.auth.user.id}`,
    headers: {
      cookie: orgAdmin.cookie
    }
  });
  assert.equal(removeMemberRes.statusCode, 200);
  assert.equal(removeMemberRes.json().ok, true);

  const membersAfterRemovalRes = await server.inject({
    method: 'GET',
    url: `/orgs/${createdOrg.id}/members`,
    headers: {
      cookie: orgAdmin.cookie
    }
  });
  assert.equal(membersAfterRemovalRes.statusCode, 200);
  assert.equal(membersAfterRemovalRes.json().count, 2);
});
