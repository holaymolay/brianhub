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
  const serverModule = await import('../services/api/src/server.js');
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
