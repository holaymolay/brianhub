import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let server = null;
const tempDir = mkdtempSync(join(tmpdir(), 'brianhub-api-test-'));
const tempDbPath = join(tempDir, 'api-test.sqlite');
const previousDb = process.env.BRIANHUB_DB;
const previousNodeEnv = process.env.NODE_ENV;

before(async () => {
  process.env.BRIANHUB_DB = tempDbPath;
  process.env.NODE_ENV = 'test';
  const serverModule = await import('../services/api/src/server.js');
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
