import test from 'node:test';
import assert from 'node:assert/strict';
import { replayPendingChanges, getReplayBackoffMs } from '../apps/web/syncQueue.js';

test('replayPendingChanges applies changes sequentially', async () => {
  const pending = [
    { seq: 1, entity_type: 'task', action: 'create' },
    { seq: 2, entity_type: 'task', action: 'update' }
  ];
  const seen = [];
  const result = await replayPendingChanges(pending, async (change) => {
    seen.push(change.seq);
  });
  assert.deepEqual(seen, [1, 2]);
  assert.equal(result.remaining.length, 0);
  assert.equal(result.applied.length, 2);
});

test('replayPendingChanges stops on failure and returns remaining', async () => {
  const pending = [
    { seq: 1, entity_type: 'task', action: 'create' },
    { seq: 2, entity_type: 'task', action: 'update' },
    { seq: 3, entity_type: 'task', action: 'delete' }
  ];
  const result = await replayPendingChanges(pending, async (change) => {
    if (change.seq === 2) throw new Error('boom');
  });
  assert.equal(result.applied.length, 1);
  assert.equal(result.remaining.length, 2);
  assert.equal(result.remaining[0].seq, 2);
  assert.ok(result.error instanceof Error);
  assert.equal(result.remaining[0].retry_count, 1);
  assert.ok(typeof result.remaining[0].next_retry_at === 'string');
});

test('replayPendingChanges marks non-conflict 4xx errors as needs_attention', async () => {
  const pending = [
    { seq: 1, entity_type: 'task', action: 'create', client_mutation_id: 'm1' }
  ];
  const result = await replayPendingChanges(pending, async () => {
    const err = new Error('bad request');
    err.status = 400;
    throw err;
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.remaining.length, 1);
  assert.equal(result.remaining[0].needs_attention, true);
  assert.equal(result.remaining[0].last_error_code, 400);
});

test('replayPendingChanges marks 409 conflicts as needs_attention with conflict metadata', async () => {
  const pending = [
    { seq: 1, entity_type: 'task', action: 'update', client_mutation_id: 'm2' }
  ];
  const result = await replayPendingChanges(pending, async () => {
    const err = new Error('conflict');
    err.status = 409;
    err.conflict = {
      entity_type: 'task',
      entity_id: '33333333-3333-4333-8333-333333333333'
    };
    throw err;
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.remaining.length, 1);
  assert.equal(result.remaining[0].needs_attention, true);
  assert.equal(result.remaining[0].last_error_code, 409);
  assert.deepEqual(result.remaining[0].conflict, {
    entity_type: 'task',
    entity_id: '33333333-3333-4333-8333-333333333333'
  });
});

test('replayPendingChanges defers retry until next_retry_at', async () => {
  const nowMs = Date.now();
  const pending = [
    {
      seq: 1,
      entity_type: 'task',
      action: 'update',
      next_retry_at: new Date(nowMs + 10000).toISOString()
    }
  ];
  let called = false;
  const result = await replayPendingChanges(pending, async () => {
    called = true;
  }, { nowMs });
  assert.equal(called, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.remaining.length, 1);
});

test('getReplayBackoffMs increases with retry count and caps', () => {
  assert.equal(getReplayBackoffMs(1), 1500);
  assert.equal(getReplayBackoffMs(2), 3000);
  assert.equal(getReplayBackoffMs(5), 30000);
  assert.equal(getReplayBackoffMs(99), 60000);
});
