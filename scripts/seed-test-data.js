import { openDb, migrate } from '../services/api/src/db.js';
import {
  listWorkspaces,
  createWorkspace,
  listProjects,
  createProject,
  listStatuses,
  createStatus,
  listTaskTypes,
  createTaskType,
  listStoreRules,
  createStoreRule,
  listTemplates,
  listShoppingLists,
  createShoppingList,
  createShoppingItems,
  listNoticeTypes,
  createNoticeType,
  createNotice,
  createTemplate,
  createTask,
  addTaskDependency,
  updateTask,
  applyTaskCheckIn,
  listTasks,
  listNotices,
  listShoppingItems
} from '../services/api/src/taskService.js';

function isoOffset({ days = 0, hours = 0, minutes = 0 } = {}) {
  const next = new Date();
  next.setDate(next.getDate() + days);
  next.setHours(next.getHours() + hours);
  next.setMinutes(next.getMinutes() + minutes);
  return next.toISOString();
}

function byName(items, name) {
  return (items ?? []).find(item => String(item?.name ?? '').trim().toLowerCase() === name.toLowerCase()) ?? null;
}

function byLabel(items, label) {
  return (items ?? []).find(item => String(item?.label ?? '').trim().toLowerCase() === label.toLowerCase()) ?? null;
}

async function ensureWorkspace(db, name, type = 'personal') {
  const existing = byName(await listWorkspaces(db), name);
  if (existing) return existing;
  return createWorkspace(db, { name, type });
}

async function ensureProject(db, workspaceId, name, kind = 'project') {
  const existing = byName(await listProjects(db, workspaceId), name);
  if (existing) return existing;
  return createProject(db, { workspace_id: workspaceId, name, kind });
}

async function ensureStatus(db, workspaceId, label) {
  const statuses = await listStatuses(db, workspaceId);
  const existing = byLabel(statuses, label);
  if (existing) return existing;
  return createStatus(db, { workspace_id: workspaceId, label, kanban_visible: 1 });
}

async function ensureTaskType(db, workspaceId, name) {
  const existing = byName(await listTaskTypes(db, workspaceId), name);
  if (existing) return existing;
  return createTaskType(db, { workspace_id: workspaceId, name });
}

async function ensureStoreRule(db, workspaceId, storeName, keywords) {
  const existing = (await listStoreRules(db, workspaceId))
    .find(rule => String(rule.store_name ?? '').trim().toLowerCase() === storeName.toLowerCase());
  if (existing) return existing;
  return createStoreRule(db, { workspace_id: workspaceId, store_name: storeName, keywords });
}

async function ensureShoppingList(db, workspaceId, name) {
  const existing = byName(await listShoppingLists(db, workspaceId), name);
  if (existing) return existing;
  return createShoppingList(db, { workspace_id: workspaceId, name });
}

async function ensureShoppingSeed(db, workspaceId) {
  const groceries = await ensureShoppingList(db, workspaceId, 'Weekly Groceries');
  const hardware = await ensureShoppingList(db, workspaceId, 'Hardware Run');

  if ((await listShoppingItems(db, workspaceId, groceries.id)).length === 0) {
    await createShoppingItems(db, groceries.id, [
      { name: 'Milk' },
      { name: 'Eggs' },
      { name: 'Bread', is_checked: true },
      { name: 'Coffee Beans' }
    ]);
  }
  if ((await listShoppingItems(db, workspaceId, hardware.id)).length === 0) {
    await createShoppingItems(db, hardware.id, [
      { name: 'PVC Cleaner' },
      { name: 'Pipe Couplings (2in)' },
      { name: 'Nitrile Gloves', is_checked: true }
    ]);
  }
}

async function ensureNoticeType(db, workspaceId, label) {
  const existing = byLabel(await listNoticeTypes(db, workspaceId), label);
  if (existing) return existing;
  return createNoticeType(db, { workspace_id: workspaceId, label });
}

async function ensureNoticesSeed(db, workspaceId) {
  await ensureNoticeType(db, workspaceId, 'Client Follow-up');
  await ensureNoticeType(db, workspaceId, 'Billing');
  const notices = await listNotices(db, workspaceId);
  if (notices.length > 0) return;

  const createdAt = new Date();
  const fallbackTime = createdAt.toISOString().split('T')[1];
  const defaultTime = `1970-01-01T${fallbackTime}`;

  await createNotice(db, {
    workspace_id: workspaceId,
    title: 'Invoice due reminder',
    notify_at: isoOffset({ days: 2 }),
    notice_type: 'billing',
    recurrence_interval: 1,
    recurrence_unit: 'month',
    recurrence_rule_json: { preset: 'monthly' }
  });

  await createNotice(db, {
    workspace_id: workspaceId,
    title: 'Weekly planning check',
    notify_at: isoOffset({ days: 1 }),
    notice_type: 'general',
    recurrence_interval: 1,
    recurrence_unit: 'week',
    recurrence_rule_json: { preset: 'weekly' }
  });

  await createNotice(db, {
    workspace_id: workspaceId,
    title: 'Follow up with supplier',
    notify_at: isoOffset({ days: 3 }),
    notice_type: 'client-follow-up',
    recurrence_interval: null,
    recurrence_unit: null,
    recurrence_rule_json: { preset: 'does-not-repeat', default_time: defaultTime }
  });
}

async function ensureTemplateSeed(db, workspaceId, projectId) {
  const templates = await listTemplates(db, workspaceId);
  const exists = templates.find(template => String(template.name ?? '').toLowerCase() === 'monthly maintenance checklist');
  if (exists) return exists;
  return createTemplate(db, {
    workspace_id: workspaceId,
    project_id: projectId,
    name: 'Monthly Maintenance Checklist',
    steps: [
      'Review previous report',
      'Confirm site access',
      'Inspect lines and cleanouts',
      'Generate and send summary'
    ],
    lead_days: 7,
    recurrence_interval: 1,
    recurrence_unit: 'month'
  });
}

async function ensureTaskSeed(db, workspaceId, projects, statuses) {
  const currentTasks = await listTasks(db, workspaceId);
  if (currentTasks.length > 0) return;

  const projectByName = new Map(projects.map(project => [project.name, project]));
  const statusByLabel = new Map(statuses.map(status => [status.label, status]));

  const parent = await createTask(db, {
    workspace_id: workspaceId,
    project_id: projectByName.get('Customer Work')?.id ?? null,
    title: 'CCTV inspection - Elm Street',
    description_md: 'Collect footage, annotate findings, and deliver report.',
    status: statusByLabel.get('In Progress')?.key ?? 'in-progress',
    priority: 'high',
    due_at: isoOffset({ days: 1 }),
    start_at: isoOffset({ hours: -2 }),
    group_label: 'Field Work',
    type_label: 'Inspection'
  });

  const subA = await createTask(db, {
    workspace_id: workspaceId,
    parent_id: parent.id,
    project_id: parent.project_id,
    title: 'Capture upstream footage',
    status: statusByLabel.get('In Progress')?.key ?? 'in-progress',
    priority: 'high',
    due_at: isoOffset({ hours: 4 }),
    group_label: 'Field Work',
    type_label: 'Inspection'
  });

  const subB = await createTask(db, {
    workspace_id: workspaceId,
    parent_id: parent.id,
    project_id: parent.project_id,
    title: 'Annotate defects',
    status: statusByLabel.get('Planned')?.key ?? 'planned',
    priority: 'medium',
    due_at: isoOffset({ days: 1, hours: 2 }),
    group_label: 'Reporting',
    type_label: 'Report'
  });

  const blocked = await createTask(db, {
    workspace_id: workspaceId,
    project_id: parent.project_id,
    title: 'Send report to client',
    status: statusByLabel.get('Blocked')?.key ?? 'blocked',
    priority: 'high',
    due_at: isoOffset({ days: 2 }),
    group_label: 'Reporting',
    type_label: 'Report'
  });

  const waiting = await createTask(db, {
    workspace_id: workspaceId,
    project_id: projectByName.get('Internal Ops')?.id ?? null,
    title: 'Await permit confirmation',
    status: statusByLabel.get('Waiting')?.key ?? 'waiting',
    priority: 'medium',
    group_label: 'Admin',
    type_label: 'General'
  });

  const review = await createTask(db, {
    workspace_id: workspaceId,
    project_id: projectByName.get('Internal Ops')?.id ?? null,
    title: 'Review monthly KPI dashboard',
    status: statusByLabel.get('Review')?.key ?? statusByLabel.get('Planned')?.key ?? 'planned',
    priority: 'low',
    due_at: isoOffset({ days: 4 }),
    group_label: 'Admin',
    type_label: 'Review'
  });

  const recurring = await createTask(db, {
    workspace_id: workspaceId,
    project_id: projectByName.get('Internal Ops')?.id ?? null,
    title: 'Submit weekly crew summary',
    status: statusByLabel.get('Planned')?.key ?? 'planned',
    priority: 'medium',
    recurrence_interval: 1,
    recurrence_unit: 'week',
    due_at: isoOffset({ days: 5 }),
    group_label: 'Admin',
    type_label: 'General'
  });

  await addTaskDependency(db, blocked.id, subB.id);
  await addTaskDependency(db, subB.id, subA.id);

  await applyTaskCheckIn(db, waiting.id, 'in-progress');
  await updateTask(db, review.id, { status: statusByLabel.get('Done')?.key ?? 'done' });
  await updateTask(db, recurring.id, { urgency: 1 });
}

async function ensureWorkspaceSeed(db, workspaceName) {
  const workspace = await ensureWorkspace(db, workspaceName, workspaceName === 'Operations Lab' ? 'team' : 'personal');
  const customerWork = await ensureProject(db, workspace.id, 'Customer Work');
  await ensureProject(db, workspace.id, 'Internal Ops');
  await ensureProject(db, workspace.id, 'Backlog', 'area');

  await ensureStatus(db, workspace.id, 'Review');
  const statuses = await listStatuses(db, workspace.id);

  await ensureTaskType(db, workspace.id, 'Inspection');
  await ensureTaskType(db, workspace.id, 'Report');
  await ensureTaskType(db, workspace.id, 'Review');

  await ensureStoreRule(db, workspace.id, 'Safeway', ['milk', 'eggs', 'bread']);
  await ensureStoreRule(db, workspace.id, 'Home Depot', ['pipe', 'repair', 'tool']);
  await ensureStoreRule(db, workspace.id, 'Office Depot', ['paper', 'ink', 'printer']);

  await ensureShoppingSeed(db, workspace.id);
  await ensureNoticesSeed(db, workspace.id);
  await ensureTemplateSeed(db, workspace.id, customerWork.id);
  await ensureTaskSeed(db, workspace.id, await listProjects(db, workspace.id), statuses);
}

async function summarize(db) {
  const counts = async (sql, params = []) => (await db.queryOne(sql, params))?.c ?? 0;
  return {
    workspaces: await counts('SELECT COUNT(*) AS c FROM workspaces'),
    projects: await counts('SELECT COUNT(*) AS c FROM projects'),
    tasks: await counts('SELECT COUNT(*) AS c FROM tasks'),
    task_dependencies: await counts('SELECT COUNT(*) AS c FROM task_dependencies'),
    statuses: await counts('SELECT COUNT(*) AS c FROM workspace_statuses'),
    task_types: await counts('SELECT COUNT(*) AS c FROM task_types'),
    templates: await counts('SELECT COUNT(*) AS c FROM templates'),
    notices: await counts('SELECT COUNT(*) AS c FROM notices'),
    notice_types: await counts('SELECT COUNT(*) AS c FROM notice_types'),
    shopping_lists: await counts('SELECT COUNT(*) AS c FROM shopping_lists'),
    shopping_items: await counts('SELECT COUNT(*) AS c FROM shopping_list_items'),
    store_rules: await counts('SELECT COUNT(*) AS c FROM store_rules')
  };
}

async function main() {
  const db = await openDb();
  try {
    await migrate(db);
    await ensureWorkspaceSeed(db, 'Personal');
    await ensureWorkspaceSeed(db, 'Operations Lab');
    const stats = await summarize(db);
    console.log('Test data seed complete.');
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
