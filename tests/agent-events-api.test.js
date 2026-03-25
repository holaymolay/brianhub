import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000001';
const ownerEmail = 'brian@pipecaminc.com';

let server = null;
const tempDir = mkdtempSync(join(tmpdir(), 'brianhub-agent-events-test-'));
const tempDbPath = join(tempDir, 'agent-events.sqlite');
const previousDb = process.env.BRIANHUB_DB;
const previousNodeEnv = process.env.NODE_ENV;
const previousExposeInviteToken = process.env.BRIANHUB_EXPOSE_INVITE_TOKEN;
const previousRequireAuth = process.env.BRIANHUB_REQUIRE_AUTH;
const previousAllowHeaderActorAuth = process.env.BRIANHUB_ALLOW_HEADER_ACTOR_AUTH;

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
    headers: {
      'x-actor-email': ownerEmail
    },
    payload: {
      name: workspaceName,
      type: 'personal',
      org_id: DEFAULT_ORG_ID
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
    cookie,
    auth: acceptRes.json()
  };
}

async function createEvent(cookie, workspaceId, overrides = {}) {
  const response = await server.inject({
    method: 'POST',
    url: '/agent-events',
    headers: {
      cookie
    },
    payload: {
      workspace_id: workspaceId,
      source_agent: 'roger',
      target_agent: 'codex',
      event_type: 'task.request',
      payload_json: {
        title: 'Do the thing'
      },
      ...overrides
    }
  });
  return response;
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

test('create event stores an auditable workspace-scoped record', async () => {
  const member = await createAcceptedUser({
    workspaceName: 'Agent event create',
    email: 'events-create@example.com',
    displayName: 'Create User',
    password: 'secret-123'
  });

  const createRes = await createEvent(member.cookie, member.workspaceId, {
    payload_json: {
      title: 'Add authenticated trading bot project page',
      metadata: {
        origin: 'telegram',
        requested_by: 'Brian'
      }
    }
  });
  assert.equal(createRes.statusCode, 200);
  const event = createRes.json();
  assert.equal(event.workspace_id, member.workspaceId);
  assert.equal(event.source_agent, 'roger');
  assert.equal(event.target_agent, 'codex');
  assert.equal(event.event_type, 'task.request');
  assert.equal(event.status, 'pending');
  assert.equal(event.priority, 'normal');
  assert.equal(event.payload_json.metadata.requested_by, 'Brian');
  assert.equal(typeof event.created_at, 'string');
  assert.equal(typeof event.updated_at, 'string');

  const fetchRes = await server.inject({
    method: 'GET',
    url: `/agent-events/${event.id}`,
    headers: {
      cookie: member.cookie
    }
  });
  assert.equal(fetchRes.statusCode, 200);
  assert.deepEqual(fetchRes.json().payload_json, event.payload_json);
});

test('list/filter events supports deterministic polling', async () => {
  const member = await createAcceptedUser({
    workspaceName: 'Agent event list',
    email: 'events-list@example.com',
    displayName: 'List User',
    password: 'secret-123'
  });

  const first = (await createEvent(member.cookie, member.workspaceId, {
    source_agent: 'roger',
    target_agent: 'codex',
    event_type: 'task.request'
  })).json();
  const second = (await createEvent(member.cookie, member.workspaceId, {
    source_agent: 'roger',
    target_agent: null,
    event_type: 'alert'
  })).json();
  const third = (await createEvent(member.cookie, member.workspaceId, {
    source_agent: 'codex',
    target_agent: 'roger',
    event_type: 'task.result'
  })).json();

  const handledRes = await server.inject({
    method: 'PATCH',
    url: `/agent-events/${third.id}`,
    headers: {
      cookie: member.cookie
    },
    payload: {
      status: 'handled'
    }
  });
  assert.equal(handledRes.statusCode, 200);

  const firstPageParams = new URLSearchParams({
    workspace_id: member.workspaceId,
    source_agent: 'roger',
    limit: '1'
  });
  const firstPageRes = await server.inject({
    method: 'GET',
    url: `/agent-events?${firstPageParams.toString()}`,
    headers: {
      cookie: member.cookie
    }
  });
  assert.equal(firstPageRes.statusCode, 200);
  const firstPage = firstPageRes.json();
  assert.equal(firstPage.events.length, 1);
  assert.equal(firstPage.events[0].id, first.id);
  assert.equal(typeof firstPage.next_cursor, 'string');

  const secondPageParams = new URLSearchParams({
    workspace_id: member.workspaceId,
    source_agent: 'roger',
    limit: '1',
    cursor: firstPage.next_cursor
  });
  const secondPageRes = await server.inject({
    method: 'GET',
    url: `/agent-events?${secondPageParams.toString()}`,
    headers: {
      cookie: member.cookie
    }
  });
  assert.equal(secondPageRes.statusCode, 200);
  const secondPage = secondPageRes.json();
  assert.equal(secondPage.events.length, 1);
  assert.equal(secondPage.events[0].id, second.id);

  const filteredParams = new URLSearchParams({
    workspace_id: member.workspaceId,
    status: 'handled',
    target_agent: 'roger',
    event_type: 'task.result'
  });
  const filteredRes = await server.inject({
    method: 'GET',
    url: `/agent-events?${filteredParams.toString()}`,
    headers: {
      cookie: member.cookie
    }
  });
  assert.equal(filteredRes.statusCode, 200);
  const filtered = filteredRes.json();
  assert.equal(filtered.events.length, 1);
  assert.equal(filtered.events[0].id, third.id);
});

test('patch status to handled sets handled_at without mutating event content', async () => {
  const member = await createAcceptedUser({
    workspaceName: 'Agent event patch',
    email: 'events-patch@example.com',
    displayName: 'Patch User',
    password: 'secret-123'
  });

  const created = (await createEvent(member.cookie, member.workspaceId, {
    payload_json: {
      title: 'Structured handoff',
      description: 'Leave a clear note'
    }
  })).json();

  const patchRes = await server.inject({
    method: 'PATCH',
    url: `/agent-events/${created.id}`,
    headers: {
      cookie: member.cookie
    },
    payload: {
      status: 'handled'
    }
  });
  assert.equal(patchRes.statusCode, 200);
  const updated = patchRes.json();
  assert.equal(updated.status, 'handled');
  assert.equal(typeof updated.handled_at, 'string');
  assert.deepEqual(updated.payload_json, created.payload_json);
  assert.equal(updated.source_agent, created.source_agent);
  assert.equal(updated.event_type, created.event_type);
});

test('workspace scoping blocks list, create, get, and patch across memberships', async () => {
  const alpha = await createAcceptedUser({
    workspaceName: 'Workspace alpha',
    email: 'events-alpha@example.com',
    displayName: 'Alpha User',
    password: 'secret-123'
  });
  const bravo = await createAcceptedUser({
    workspaceName: 'Workspace bravo',
    email: 'events-bravo@example.com',
    displayName: 'Bravo User',
    password: 'secret-123'
  });

  const bravoEvent = (await createEvent(bravo.cookie, bravo.workspaceId, {
    target_agent: 'roger',
    event_type: 'handoff'
  })).json();

  const listRes = await server.inject({
    method: 'GET',
    url: `/agent-events?workspace_id=${encodeURIComponent(bravo.workspaceId)}`,
    headers: {
      cookie: alpha.cookie
    }
  });
  assert.equal(listRes.statusCode, 403);

  const createRes = await createEvent(alpha.cookie, bravo.workspaceId, {
    event_type: 'question'
  });
  assert.equal(createRes.statusCode, 403);

  const getRes = await server.inject({
    method: 'GET',
    url: `/agent-events/${bravoEvent.id}`,
    headers: {
      cookie: alpha.cookie
    }
  });
  assert.equal(getRes.statusCode, 403);

  const patchRes = await server.inject({
    method: 'PATCH',
    url: `/agent-events/${bravoEvent.id}`,
    headers: {
      cookie: alpha.cookie
    },
    payload: {
      status: 'handled'
    }
  });
  assert.equal(patchRes.statusCode, 403);
});

test('dedupe_key returns the existing event within workspace and target scope', async () => {
  const member = await createAcceptedUser({
    workspaceName: 'Agent event dedupe',
    email: 'events-dedupe@example.com',
    displayName: 'Dedupe User',
    password: 'secret-123'
  });

  const firstRes = await createEvent(member.cookie, member.workspaceId, {
    dedupe_key: 'telegram-req-123'
  });
  assert.equal(firstRes.statusCode, 200);
  const first = firstRes.json();

  const secondRes = await createEvent(member.cookie, member.workspaceId, {
    dedupe_key: 'telegram-req-123',
    payload_json: {
      title: 'Retry should collapse'
    }
  });
  assert.equal(secondRes.statusCode, 200);
  const second = secondRes.json();
  assert.equal(second.id, first.id);

  const thirdRes = await createEvent(member.cookie, member.workspaceId, {
    target_agent: 'roger',
    dedupe_key: 'telegram-req-123'
  });
  assert.equal(thirdRes.statusCode, 200);
  const third = thirdRes.json();
  assert.notEqual(third.id, first.id);

  const listRes = await server.inject({
    method: 'GET',
    url: `/agent-events?workspace_id=${encodeURIComponent(member.workspaceId)}`,
    headers: {
      cookie: member.cookie
    }
  });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.json().events.length, 2);
});
