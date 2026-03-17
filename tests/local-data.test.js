import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBootLocalData,
  prepareLocalDataForStorage,
  shouldHydrateLocalDomainData
} from '../apps/web/localData.js';

test('boot data ignores persisted domain snapshot without pending changes', () => {
  const result = getBootLocalData({
    workspaces: [{ id: 'workspace-1', name: 'Personal' }],
    tasks: { 'task-1': { id: 'task-1', title: 'Persisted task' } },
    shoppingItems: { 'item-1': { id: 'item-1', name: 'Milk' } },
    auditLog: [{ id: 'audit-1', event: 'boot' }],
    pendingChanges: []
  });

  assert.equal(shouldHydrateLocalDomainData(result), false);
  assert.deepEqual(result.workspaces, []);
  assert.deepEqual(result.tasks, {});
  assert.deepEqual(result.shoppingItems, {});
  assert.deepEqual(result.auditLog, [{ id: 'audit-1', event: 'boot' }]);
});

test('boot data keeps persisted domain snapshot when pending changes exist', () => {
  const result = getBootLocalData({
    workspaces: [{ id: 'workspace-1', name: 'Personal' }],
    tasks: { 'task-1': { id: 'task-1', title: 'Queued task' } },
    pendingChanges: [
      {
        seq: 1,
        client_mutation_id: 'mut-1',
        entity_type: 'task',
        entity_id: 'task-1',
        action: 'update',
        payload: { title: 'Queued task' }
      }
    ]
  });

  assert.equal(shouldHydrateLocalDomainData(result), true);
  assert.equal(result.workspaces.length, 1);
  assert.equal(result.tasks['task-1']?.title, 'Queued task');
});

test('storage payload strips domain data when queue is empty', () => {
  const result = prepareLocalDataForStorage({
    localSeq: 7,
    pendingChanges: [],
    workspaces: [{ id: 'workspace-1', name: 'Personal' }],
    tasks: { 'task-1': { id: 'task-1', title: 'Persisted task' } },
    auditLog: [{ id: 'audit-1', event: 'boot' }]
  }, { keepDomainData: false });

  assert.equal(result.localSeq, 7);
  assert.deepEqual(result.pendingChanges, []);
  assert.deepEqual(result.workspaces, []);
  assert.deepEqual(result.tasks, {});
  assert.deepEqual(result.auditLog, [{ id: 'audit-1', event: 'boot' }]);
});
