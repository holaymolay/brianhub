import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteClient } from '../concepts/data-layer/db/sqlite-client.js';
import { applyMigrations } from '../concepts/data-layer/migrations/runner.js';
import {
  createWorkspace,
  createTask,
  createUser,
  createWorkspaceMembership,
  createProject,
  createStatus,
  createTaskType,
  listTasks,
  getTask,
  reparentTask,
  applyTaskCheckIn
} from '../services/api/src/taskService.js';
import { TaskStatus } from '../packages/core/taskState.js';

const migrationsDir = 'services/api/db/migrations';
const IDS = {
  workspaceLocal: '11111111-1111-4111-8111-111111111111',
  taskLocal: '22222222-2222-4222-8222-222222222222',
  workspaceSeed: '33333333-3333-4333-8333-333333333333',
  projectLocal: '44444444-4444-4444-8444-444444444444',
  statusLocal: '55555555-5555-4555-8555-555555555555',
  typeLocal: '66666666-6666-4666-8666-666666666666'
};

async function withDb(fn) {
  const db = await createSqliteClient({ inMemory: true });
  try {
    await applyMigrations(db, migrationsDir);
    await fn(db);
  } finally {
    await db.close();
  }
}

test('task service works with DbClient interface', async () => {
  await withDb(async (db) => {
    const workspace = await createWorkspace(db, { name: 'Workspace', type: 'personal' });
    assert.ok(workspace?.id);

    const task = await createTask(db, { workspace_id: workspace.id, title: 'Task 1' });
    assert.equal(task.title, 'Task 1');

    const fetched = await getTask(db, task.id);
    assert.equal(fetched.id, task.id);

    const tasks = await listTasks(db, workspace.id);
    assert.equal(tasks.length, 1);
  });
});

test('createWorkspace and createTask honor provided ids', async () => {
  await withDb(async (db) => {
    const workspace = await createWorkspace(db, { id: IDS.workspaceLocal, name: 'Offline', type: 'personal' });
    assert.equal(workspace.id, IDS.workspaceLocal);

    const task = await createTask(db, { id: IDS.taskLocal, workspace_id: workspace.id, title: 'Offline Task' });
    assert.equal(task.id, IDS.taskLocal);

    const fetched = await getTask(db, IDS.taskLocal);
    assert.equal(fetched.id, IDS.taskLocal);
  });
});

test('createProject/status/taskType honor provided ids', async () => {
  await withDb(async (db) => {
    const workspace = await createWorkspace(db, { id: IDS.workspaceSeed, name: 'Seed', type: 'personal' });

    const project = await createProject(db, { id: IDS.projectLocal, workspace_id: workspace.id, name: 'Project' });
    assert.equal(project.id, IDS.projectLocal);

    const status = await createStatus(db, { id: IDS.statusLocal, workspace_id: workspace.id, label: 'Custom' });
    assert.equal(status.id, IDS.statusLocal);

    const taskType = await createTaskType(db, { id: IDS.typeLocal, workspace_id: workspace.id, name: 'Type' });
    assert.equal(taskType.id, IDS.typeLocal);
  });
});

test('create APIs reject invalid ids', async () => {
  await withDb(async (db) => {
    await assert.rejects(
      () => createWorkspace(db, { id: 'ws-local', name: 'Offline', type: 'personal' }),
      /Invalid workspace id/
    );

    const workspace = await createWorkspace(db, { name: 'Workspace', type: 'personal' });

    await assert.rejects(
      () => createTask(db, { id: 'task-local', workspace_id: workspace.id, title: 'Task' }),
      /Invalid task id/
    );

    await assert.rejects(
      () => createProject(db, { id: 'proj-local', workspace_id: workspace.id, name: 'Project' }),
      /Invalid project id/
    );
  });
});

test('task assignment enforces workspace membership', async () => {
  await withDb(async (db) => {
    const workspace = await createWorkspace(db, { name: 'Team', type: 'personal' });
    const member = await createUser(db, {
      org_id: workspace.org_id,
      display_name: 'Member User',
      email: 'member@example.com'
    });
    await createWorkspaceMembership(db, {
      workspace_id: workspace.id,
      user_id: member.id,
      role: 'member'
    });

    const assigned = await createTask(db, {
      workspace_id: workspace.id,
      title: 'Assigned task',
      assignee_user_id: member.id
    });
    assert.equal(assigned.assignee_user_id, member.id);
    assert.equal(assigned.assignee_label, null);

    const external = await createTask(db, {
      workspace_id: workspace.id,
      title: 'External task',
      assignee_label: 'Field Contractor'
    });
    assert.equal(external.assignee_user_id, null);
    assert.equal(external.assignee_label, 'Field Contractor');

    const nonMember = await createUser(db, {
      org_id: workspace.org_id,
      display_name: 'No Membership'
    });
    await assert.rejects(
      () => createTask(db, {
        workspace_id: workspace.id,
        title: 'Should fail',
        assignee_user_id: nonMember.id
      }),
      /Assignee user must be a member of this workspace/
    );
  });
});

test('server reparent updates parent linkage and closure edges', async () => {
  await withDb(async (db) => {
    const workspace = await createWorkspace(db, { name: 'Reparent Workspace', type: 'personal' });
    const parentA = await createTask(db, { workspace_id: workspace.id, title: 'Parent A' });
    const parentC = await createTask(db, { workspace_id: workspace.id, title: 'Parent C' });
    const childB = await createTask(db, { workspace_id: workspace.id, title: 'Child B', parent_id: parentA.id });

    const moved = await reparentTask(db, childB.id, parentC.id);
    assert.equal(moved.parent_id, parentC.id);

    const newEdge = await db.query(
      'SELECT depth FROM task_edges WHERE ancestor_id = ? AND descendant_id = ?',
      [parentC.id, childB.id]
    );
    assert.equal(newEdge.length, 1);
    assert.equal(newEdge[0].depth, 1);

    const oldEdge = await db.query(
      'SELECT depth FROM task_edges WHERE ancestor_id = ? AND descendant_id = ?',
      [parentA.id, childB.id]
    );
    assert.equal(oldEdge.length, 0);
  });
});

test('check-in "no" reschedules subtree and updates status', async () => {
  await withDb(async (db) => {
    const workspace = await createWorkspace(db, { name: 'Checkin Workspace', type: 'personal' });
    const root = await createTask(db, {
      workspace_id: workspace.id,
      title: 'Root',
      status: TaskStatus.PLANNED,
      due_at: '2026-02-10T10:00:00.000Z'
    });
    const child = await createTask(db, {
      workspace_id: workspace.id,
      title: 'Child',
      parent_id: root.id,
      status: TaskStatus.PLANNED,
      due_at: '2026-02-10T11:00:00.000Z'
    });

    const updated = await applyTaskCheckIn(db, root.id, 'no');
    assert.equal(updated.status, TaskStatus.PLANNED);
    assert.ok(updated.next_checkin_at);

    const refreshedRoot = await getTask(db, root.id);
    const refreshedChild = await getTask(db, child.id);
    assert.equal(
      refreshedRoot.due_at,
      '2026-02-11T10:00:00.000Z'
    );
    assert.equal(
      refreshedChild.due_at,
      '2026-02-11T11:00:00.000Z'
    );
  });
});

test('service waiting tasks set next_checkin_at on create', async () => {
  await withDb(async (db) => {
    const workspace = await createWorkspace(db, { name: 'Waiting Workspace', type: 'personal' });

    const autoFollowup = await createTask(db, {
      workspace_id: workspace.id,
      title: 'Waiting auto',
      status: TaskStatus.WAITING
    });
    assert.ok(autoFollowup.next_checkin_at);

    const explicitFollowup = await createTask(db, {
      workspace_id: workspace.id,
      title: 'Waiting explicit',
      status: TaskStatus.WAITING,
      waiting_followup_at: '2026-03-05T14:00:00.000Z'
    });
    assert.equal(explicitFollowup.next_checkin_at, '2026-03-05T14:00:00.000Z');
  });
});

test('applyTaskCheckIn returns null when task does not exist', async () => {
  await withDb(async (db) => {
    const result = await applyTaskCheckIn(db, '99999999-9999-4999-8999-999999999999', 'yes');
    assert.equal(result, null);
  });
});
