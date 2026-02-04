import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRemoteChanges } from '../apps/web/syncState.js';
import { TaskStatus } from '../packages/core/taskState.js';

function baseData() {
  return {
    workspaces: [],
    projects: [],
    statuses: [],
    taskTypes: [],
    tasks: {},
    taskDependencies: [],
    templates: [],
    notices: [],
    noticeTypes: [],
    storeRules: [],
    shoppingLists: [],
    shoppingItems: {}
  };
}

function statusDefs() {
  return [
    { key: TaskStatus.INBOX, kind: TaskStatus.INBOX },
    { key: TaskStatus.WAITING, kind: TaskStatus.WAITING },
    { key: TaskStatus.DONE, kind: TaskStatus.DONE }
  ];
}

test('applyRemoteChanges creates tasks from change log', () => {
  const data = baseData();
  const changes = [
    {
      entity_type: 'task',
      entity_id: 't1',
      action: 'create',
      payload: { id: 't1', title: 'Task 1', status: TaskStatus.INBOX }
    }
  ];
  const result = applyRemoteChanges(data, changes, { now: new Date('2024-01-01T00:00:00Z') });
  assert.equal(result.data.tasks.t1.title, 'Task 1');
  assert.equal(result.needsRefresh, false);
});

test('applyRemoteChanges patches task updates and sets completed_at when done', () => {
  const data = baseData();
  data.statuses = statusDefs();
  data.tasks.t1 = { id: 't1', title: 'Task 1', status: TaskStatus.INBOX, completed_at: null };
  const now = new Date('2024-01-02T12:00:00Z');
  const changes = [
    { entity_type: 'task', entity_id: 't1', action: 'update', payload: { status: TaskStatus.DONE } }
  ];
  const result = applyRemoteChanges(data, changes, { now });
  assert.equal(result.data.tasks.t1.status, TaskStatus.DONE);
  assert.equal(result.data.tasks.t1.completed_at, now.toISOString());
});

test('applyRemoteChanges sets waiting followup when status is waiting', () => {
  const data = baseData();
  data.statuses = statusDefs();
  data.tasks.t1 = { id: 't1', title: 'Task 1', status: TaskStatus.INBOX, waiting_followup_at: null };
  const now = new Date('2024-01-03T09:00:00Z');
  const changes = [
    { entity_type: 'task', entity_id: 't1', action: 'update', payload: { status: TaskStatus.WAITING } }
  ];
  const result = applyRemoteChanges(data, changes, { now, waitingDays: 2 });
  assert.ok(result.data.tasks.t1.next_checkin_at);
});

test('applyRemoteChanges deletes task ids for delete payloads', () => {
  const data = baseData();
  data.tasks.t1 = { id: 't1', title: 'Task 1' };
  data.tasks.t2 = { id: 't2', title: 'Task 2' };
  const changes = [
    { entity_type: 'task', entity_id: 't1', action: 'delete', payload: { ids: ['t1', 't2'] } }
  ];
  const result = applyRemoteChanges(data, changes);
  assert.equal(result.data.tasks.t1, undefined);
  assert.equal(result.data.tasks.t2, undefined);
});

test('applyRemoteChanges flags refresh for checkin/reschedule actions', () => {
  const data = baseData();
  data.tasks.t1 = { id: 't1', title: 'Task 1' };
  const changes = [
    { entity_type: 'task', entity_id: 't1', action: 'checkin', payload: { response: 'yes' } }
  ];
  const result = applyRemoteChanges(data, changes);
  assert.equal(result.needsRefresh, true);
});
