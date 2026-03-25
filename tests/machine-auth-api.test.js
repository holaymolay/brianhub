import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROGER_V1_DEFAULT_PERMISSIONS } from '../services/api/src/permissionRegistry.js';

const DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000001';
const ownerEmail = 'brian@pipecaminc.com';
const rogerAlias = 'agent:main:telegram:group:-5130223325';

let server = null;
const tempDir = mkdtempSync(join(tmpdir(), 'brianhub-service-auth-test-'));
const tempDbPath = join(tempDir, 'service-auth.sqlite');
const previousDb = process.env.BRIANHUB_DB;
const previousNodeEnv = process.env.NODE_ENV;
const previousExposeInviteToken = process.env.BRIANHUB_EXPOSE_INVITE_TOKEN;
const previousRequireAuth = process.env.BRIANHUB_REQUIRE_AUTH;
const previousAllowHeaderActorAuth = process.env.BRIANHUB_ALLOW_HEADER_ACTOR_AUTH;

function ownerHeaders() {
  return {
    'x-actor-email': ownerEmail
  };
}

function bearer(token) {
  return {
    authorization: `Bearer ${token}`
  };
}

async function createWorkspace(name) {
  const response = await server.inject({
    method: 'POST',
    url: '/workspaces',
    headers: ownerHeaders(),
    payload: {
      name,
      type: 'personal',
      org_id: DEFAULT_ORG_ID
    }
  });
  assert.equal(response.statusCode, 200);
  return response.json();
}

async function createProjectAsOwner(workspaceId, name) {
  const response = await server.inject({
    method: 'POST',
    url: '/projects',
    headers: ownerHeaders(),
    payload: {
      workspace_id: workspaceId,
      name,
      kind: 'project'
    }
  });
  assert.equal(response.statusCode, 200);
  return response.json();
}

async function createTaskAsOwner(workspaceId, title) {
  const response = await server.inject({
    method: 'POST',
    url: '/tasks',
    headers: ownerHeaders(),
    payload: {
      workspace_id: workspaceId,
      title
    }
  });
  assert.equal(response.statusCode, 200);
  return response.json();
}

async function createServiceAccount({
  displayName,
  permissions = ROGER_V1_DEFAULT_PERMISSIONS,
  aliases
}) {
  const normalizedAliases = aliases ?? [
    {
      alias_type: 'test_service_account',
      alias_value: `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomIdSuffix()}`,
      metadata: {
        channel: 'test'
      }
    }
  ];
  const response = await server.inject({
    method: 'POST',
    url: '/admin/service-accounts',
    headers: ownerHeaders(),
    payload: {
      org_id: DEFAULT_ORG_ID,
      display_name: displayName,
      permissions,
      aliases: normalizedAliases
    }
  });
  assert.equal(response.statusCode, 200);
  return response.json().service_account;
}

function randomIdSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

async function createToken(serviceAccountId, payload = {}) {
  const response = await server.inject({
    method: 'POST',
    url: `/admin/service-accounts/${serviceAccountId}/tokens`,
    headers: ownerHeaders(),
    payload
  });
  assert.equal(response.statusCode, 200);
  const token = response.json().token;
  assert.equal(typeof token.token, 'string');
  return token;
}

async function grantWorkspace(serviceAccountId, workspaceId) {
  const response = await server.inject({
    method: 'POST',
    url: `/admin/service-accounts/${serviceAccountId}/workspace-grants`,
    headers: ownerHeaders(),
    payload: {
      workspace_id: workspaceId
    }
  });
  assert.equal(response.statusCode, 200);
  return response.json().workspace_grant;
}

before(async () => {
  process.env.BRIANHUB_DB = tempDbPath;
  process.env.NODE_ENV = 'test';
  process.env.BRIANHUB_EXPOSE_INVITE_TOKEN = 'true';
  process.env.BRIANHUB_REQUIRE_AUTH = 'true';
  process.env.BRIANHUB_ALLOW_HEADER_ACTOR_AUTH = 'true';
  const serverUrl = new URL('../services/api/src/server.js', import.meta.url);
  serverUrl.search = `v=${Date.now()}-${process.hrtime.bigint().toString()}`;
  const serverModule = await import(serverUrl);
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

test('service-account bearer auth exposes principal-aware /auth/me and Roger default scope excludes task deletion', async () => {
  const workspaceA = await createWorkspace('Roger workspace A');
  const workspaceB = await createWorkspace('Roger workspace B');
  const serviceAccount = await createServiceAccount({
    displayName: 'Roger - Ops',
    aliases: [
      {
        alias_type: 'telegram_group',
        alias_value: rogerAlias,
        metadata: {
          channel: 'telegram',
          group_id: '-5130223325'
        }
      }
    ]
  });
  const token = await createToken(serviceAccount.id, {
    label: 'Roger primary token'
  });

  const beforeGrantMe = await server.inject({
    method: 'GET',
    url: '/auth/me',
    headers: bearer(token.token)
  });
  assert.equal(beforeGrantMe.statusCode, 200);
  assert.equal(beforeGrantMe.json().auth_type, 'service_account');
  assert.equal(beforeGrantMe.json().principal_type, 'service_account');
  assert.equal(beforeGrantMe.json().principal_id, serviceAccount.id);
  assert.deepEqual(beforeGrantMe.json().granted_permissions, ROGER_V1_DEFAULT_PERMISSIONS);
  assert.deepEqual(beforeGrantMe.json().effective_permissions, ROGER_V1_DEFAULT_PERMISSIONS);
  assert.equal(beforeGrantMe.json().service_account.aliases[0].alias_value, rogerAlias);
  assert.deepEqual(beforeGrantMe.json().workspaces, []);

  const deniedCreate = await server.inject({
    method: 'POST',
    url: '/tasks',
    headers: bearer(token.token),
    payload: {
      workspace_id: workspaceA.id,
      title: 'Denied before workspace grant'
    }
  });
  assert.equal(deniedCreate.statusCode, 403);

  await grantWorkspace(serviceAccount.id, workspaceA.id);

  const createTaskRes = await server.inject({
    method: 'POST',
    url: '/tasks',
    headers: bearer(token.token),
    payload: {
      workspace_id: workspaceA.id,
      title: 'Roger created this task'
    }
  });
  assert.equal(createTaskRes.statusCode, 200);
  const task = createTaskRes.json();

  const listAllowed = await server.inject({
    method: 'GET',
    url: `/tasks?workspace_id=${encodeURIComponent(workspaceA.id)}`,
    headers: bearer(token.token)
  });
  assert.equal(listAllowed.statusCode, 200);
  assert.equal(listAllowed.json().length, 1);

  const listDenied = await server.inject({
    method: 'GET',
    url: `/tasks?workspace_id=${encodeURIComponent(workspaceB.id)}`,
    headers: bearer(token.token)
  });
  assert.equal(listDenied.statusCode, 403);

  const deleteDenied = await server.inject({
    method: 'DELETE',
    url: `/tasks/${task.id}`,
    headers: bearer(token.token)
  });
  assert.equal(deleteDenied.statusCode, 403);
});

test('token-level permission constraints narrow access immediately without regenerating the token', async () => {
  const workspace = await createWorkspace('Token narrowing workspace');
  const serviceAccount = await createServiceAccount({
    displayName: 'Roger constrained token',
    permissions: [
      'workspaces.read',
      'tasks.read',
      'tasks.create',
      'tasks.update'
    ]
  });
  await grantWorkspace(serviceAccount.id, workspace.id);
  const token = await createToken(serviceAccount.id, {
    label: 'Mutable token'
  });

  const createBeforePatch = await server.inject({
    method: 'POST',
    url: '/tasks',
    headers: bearer(token.token),
    payload: {
      workspace_id: workspace.id,
      title: 'Task before narrowing'
    }
  });
  assert.equal(createBeforePatch.statusCode, 200);

  const narrowed = await server.inject({
    method: 'PATCH',
    url: `/admin/service-account-tokens/${token.id}`,
    headers: ownerHeaders(),
    payload: {
      permission_constraints: ['workspaces.read', 'tasks.read']
    }
  });
  assert.equal(narrowed.statusCode, 200);
  assert.deepEqual(narrowed.json().token.permission_constraints, ['workspaces.read', 'tasks.read']);

  const createAfterPatch = await server.inject({
    method: 'POST',
    url: '/tasks',
    headers: bearer(token.token),
    payload: {
      workspace_id: workspace.id,
      title: 'Task after narrowing'
    }
  });
  assert.equal(createAfterPatch.statusCode, 403);

  const readAfterPatch = await server.inject({
    method: 'GET',
    url: `/tasks?workspace_id=${encodeURIComponent(workspace.id)}`,
    headers: bearer(token.token)
  });
  assert.equal(readAfterPatch.statusCode, 200);
  assert.equal(readAfterPatch.json().length, 1);
});

test('service-account baseline permission edits apply immediately across existing tokens', async () => {
  const workspace = await createWorkspace('Baseline permission workspace');
  const serviceAccount = await createServiceAccount({
    displayName: 'Roger mutable baseline',
    permissions: ['workspaces.read', 'tasks.read', 'tasks.create']
  });
  await grantWorkspace(serviceAccount.id, workspace.id);
  const token = await createToken(serviceAccount.id, {
    label: 'Baseline token'
  });

  const createBeforeEdit = await server.inject({
    method: 'POST',
    url: '/tasks',
    headers: bearer(token.token),
    payload: {
      workspace_id: workspace.id,
      title: 'Created before baseline edit'
    }
  });
  assert.equal(createBeforeEdit.statusCode, 200);

  const updatedAccount = await server.inject({
    method: 'PATCH',
    url: `/admin/service-accounts/${serviceAccount.id}`,
    headers: ownerHeaders(),
    payload: {
      permissions: ['workspaces.read', 'tasks.read']
    }
  });
  assert.equal(updatedAccount.statusCode, 200);
  assert.deepEqual(updatedAccount.json().service_account.permissions, ['workspaces.read', 'tasks.read']);

  const createAfterEdit = await server.inject({
    method: 'POST',
    url: '/tasks',
    headers: bearer(token.token),
    payload: {
      workspace_id: workspace.id,
      title: 'Should be denied after baseline edit'
    }
  });
  assert.equal(createAfterEdit.statusCode, 403);

  const meAfterEdit = await server.inject({
    method: 'GET',
    url: '/auth/me',
    headers: bearer(token.token)
  });
  assert.equal(meAfterEdit.statusCode, 200);
  assert.deepEqual(meAfterEdit.json().granted_permissions, ['workspaces.read', 'tasks.read']);
  assert.deepEqual(meAfterEdit.json().effective_permissions, ['workspaces.read', 'tasks.read']);
});

test('task and project routes enforce workspace resolution and bearer token validity', async () => {
  const workspaceA = await createWorkspace('Scoped workspace A');
  const workspaceB = await createWorkspace('Scoped workspace B');
  const serviceAccount = await createServiceAccount({
    displayName: 'Roger scoped routes',
    permissions: [
      'workspaces.read',
      'tasks.read',
      'tasks.update',
      'projects.read',
      'projects.update'
    ]
  });
  await grantWorkspace(serviceAccount.id, workspaceA.id);
  const token = await createToken(serviceAccount.id, {
    label: 'Scoped token'
  });

  const taskA = await createTaskAsOwner(workspaceA.id, 'Workspace A task');
  const taskB = await createTaskAsOwner(workspaceB.id, 'Workspace B task');
  const projectA = await createProjectAsOwner(workspaceA.id, 'Workspace A project');
  const projectB = await createProjectAsOwner(workspaceB.id, 'Workspace B project');

  const patchTaskA = await server.inject({
    method: 'PATCH',
    url: `/tasks/${taskA.id}`,
    headers: bearer(token.token),
    payload: {
      title: 'Workspace A task updated'
    }
  });
  assert.equal(patchTaskA.statusCode, 200);

  const patchTaskB = await server.inject({
    method: 'PATCH',
    url: `/tasks/${taskB.id}`,
    headers: bearer(token.token),
    payload: {
      title: 'Workspace B task should be denied'
    }
  });
  assert.equal(patchTaskB.statusCode, 403);

  const patchProjectA = await server.inject({
    method: 'PATCH',
    url: `/projects/${projectA.id}`,
    headers: bearer(token.token),
    payload: {
      name: 'Workspace A project updated'
    }
  });
  assert.equal(patchProjectA.statusCode, 200);

  const patchProjectB = await server.inject({
    method: 'PATCH',
    url: `/projects/${projectB.id}`,
    headers: bearer(token.token),
    payload: {
      name: 'Workspace B project should be denied'
    }
  });
  assert.equal(patchProjectB.statusCode, 403);

  const projectListDenied = await server.inject({
    method: 'GET',
    url: `/projects?workspace_id=${encodeURIComponent(workspaceB.id)}`,
    headers: bearer(token.token)
  });
  assert.equal(projectListDenied.statusCode, 403);

  const revokeRes = await server.inject({
    method: 'DELETE',
    url: `/admin/service-account-tokens/${token.id}`,
    headers: ownerHeaders()
  });
  assert.equal(revokeRes.statusCode, 200);

  const revokedRead = await server.inject({
    method: 'GET',
    url: `/tasks?workspace_id=${encodeURIComponent(workspaceA.id)}`,
    headers: bearer(token.token)
  });
  assert.equal(revokedRead.statusCode, 401);
});
