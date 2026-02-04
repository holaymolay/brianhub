import test from 'node:test';
import assert from 'node:assert/strict';
import { replayPendingChanges } from '../apps/web/syncQueue.js';

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
});
