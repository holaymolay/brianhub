import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRemoteChanges, reconcileServerDataWithPendingChanges } from '../apps/web/syncState.js';
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

test('reconcileServerDataWithPendingChanges preserves local queued project and task state over server snapshot', () => {
  const serverData = baseData();
  serverData.projects = [{ id: 'project-server', workspace_id: 'w1', name: 'Server list', kind: 'list' }];
  serverData.tasks = {
    'task-server': { id: 'task-server', workspace_id: 'w1', title: 'Server task', project_id: 'project-server' }
  };

  const localData = baseData();
  localData.projects = [
    { id: 'project-server', workspace_id: 'w1', name: 'Renamed locally', kind: 'list' },
    { id: 'project-local', workspace_id: 'w1', name: 'Queued local list', kind: 'list' }
  ];
  localData.tasks = {
    'task-server': { id: 'task-server', workspace_id: 'w1', title: 'Renamed task locally', project_id: 'project-server' },
    'task-local': { id: 'task-local', workspace_id: 'w1', title: 'Queued local task', project_id: 'project-local' }
  };

  const result = reconcileServerDataWithPendingChanges(serverData, localData, [
    { entity_type: 'project', entity_id: 'project-server', action: 'update' },
    { entity_type: 'project', entity_id: 'project-local', action: 'create' },
    { entity_type: 'task', entity_id: 'task-server', action: 'update' },
    { entity_type: 'task', entity_id: 'task-local', action: 'create' }
  ]);

  assert.equal(result.projects.find((project) => project.id === 'project-server')?.name, 'Renamed locally');
  assert.equal(result.projects.find((project) => project.id === 'project-local')?.name, 'Queued local list');
  assert.equal(result.tasks['task-server']?.title, 'Renamed task locally');
  assert.equal(result.tasks['task-local']?.title, 'Queued local task');
});

test('reconcileServerDataWithPendingChanges honors queued deletes', () => {
  const serverData = baseData();
  serverData.tasks = {
    t1: { id: 't1', workspace_id: 'w1', title: 'Server task' }
  };
  serverData.projects = [
    { id: 'p1', workspace_id: 'w1', name: 'Server list', kind: 'list' }
  ];

  const result = reconcileServerDataWithPendingChanges(serverData, baseData(), [
    { entity_type: 'task', entity_id: 't1', action: 'delete' },
    { entity_type: 'project', entity_id: 'p1', action: 'delete' }
  ]);

  assert.equal(result.tasks.t1, undefined);
  assert.equal(result.projects.find((project) => project.id === 'p1'), undefined);
});
