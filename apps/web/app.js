import { loadState, saveState } from './localStore.js';
import * as api from './api.js';
import { compareTasksByPriority } from '../../packages/core/priority.js';
import { applyCheckIn, applyWaitingFollowup, TaskStatus } from '../../packages/core/taskState.js';

const state = {
  ...loadState(),
  workspaces: [],
  workspace: null,
  projects: [],
  templates: [],
  tasks: {}
};
const taskTreeEl = document.getElementById('task-tree');
const workspaceListEl = document.getElementById('workspace-list');
const showArchivedToggle = document.getElementById('show-archived');
const workspaceMenuButton = document.getElementById('workspace-menu-button');
const workspaceMenu = document.getElementById('workspace-menu');
const enableNotificationsBtn = document.getElementById('enable-notifications');
const notificationStatus = document.getElementById('notification-status');
const templateListEl = document.getElementById('template-list');
const newTemplateBtn = document.getElementById('new-template-btn');
const projectListEl = document.getElementById('project-list');
const newProjectBtn = document.getElementById('new-project-btn');
const syncBtn = document.getElementById('sync-btn');
const syncStatus = document.getElementById('sync-status');
const newWorkspaceBtn = document.getElementById('new-workspace-btn');
const newTaskBtn = document.getElementById('new-task-btn');
const taskModal = document.getElementById('task-modal');
const taskModalForm = document.getElementById('task-modal-form');
const modalTitle = document.getElementById('modal-title');
const modalPriority = document.getElementById('modal-priority');
const modalUrgency = document.getElementById('modal-urgency');
const modalStatus = document.getElementById('modal-status');
const modalStart = document.getElementById('modal-start');
const modalDue = document.getElementById('modal-due');
const modalDesc = document.getElementById('modal-desc');
const modalCancel = document.getElementById('modal-cancel');
const modalShoppingItems = document.getElementById('modal-shopping-items');
const modalParseItems = document.getElementById('modal-parse-items');
const modalType = document.getElementById('modal-type');
const modalRepeatInterval = document.getElementById('modal-repeat-interval');
const modalRepeatUnit = document.getElementById('modal-repeat-unit');
const modalReminder = document.getElementById('modal-reminder');
const modalAutoDebit = document.getElementById('modal-auto-debit');
const modalProject = document.getElementById('modal-project');
const templateModal = document.getElementById('template-modal');
const templateModalForm = document.getElementById('template-modal-form');
const templateName = document.getElementById('template-name');
const templateSteps = document.getElementById('template-steps');
const templateLeadDays = document.getElementById('template-lead-days');
const templateNextDate = document.getElementById('template-next-date');
const templateRepeatInterval = document.getElementById('template-repeat-interval');
const templateRepeatUnit = document.getElementById('template-repeat-unit');
const templateCancel = document.getElementById('template-cancel');
const templateProject = document.getElementById('template-project');
const settingsButton = document.getElementById('settings-button');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const taskEditor = document.getElementById('task-editor');
const taskEditorForm = document.getElementById('task-editor-form');
const editorTitle = document.getElementById('editor-title');
const editorType = document.getElementById('editor-type');
const editorPriority = document.getElementById('editor-priority');
const editorUrgency = document.getElementById('editor-urgency');
const editorRepeatInterval = document.getElementById('editor-repeat-interval');
const editorRepeatUnit = document.getElementById('editor-repeat-unit');
const editorReminder = document.getElementById('editor-reminder');
const editorAutoDebit = document.getElementById('editor-auto-debit');
const editorStatus = document.getElementById('editor-status');
const editorStart = document.getElementById('editor-start');
const editorDue = document.getElementById('editor-due');
const editorDesc = document.getElementById('editor-desc');
const editorCancel = document.getElementById('editor-cancel');
const editorDelete = document.getElementById('editor-delete');
const editorClose = document.getElementById('editor-close');
const editorProject = document.getElementById('editor-project');
const editorShoppingItems = document.getElementById('editor-shopping-items');
const editorParseItems = document.getElementById('editor-parse-items');
const templatePrompt = document.getElementById('template-prompt');
const templatePromptTitle = document.getElementById('template-prompt-title');
const templatePromptText = document.getElementById('template-prompt-text');
const templatePromptStart = document.getElementById('template-prompt-start');
const templatePromptDefer = document.getElementById('template-prompt-defer');
const templatePromptDismiss = document.getElementById('template-prompt-dismiss');
let openMenu = null;
let editingTemplateId = null;
let activeTaskId = null;
let templatePromptTaskId = null;

document.addEventListener('click', () => {
  if (openMenu) {
    openMenu.classList.add('hidden');
    openMenu = null;
  }
});

workspaceMenuButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (openMenu && openMenu !== workspaceMenu) {
    openMenu.classList.add('hidden');
  }
  if (workspaceMenu.classList.contains('hidden')) {
    workspaceMenu.classList.remove('hidden');
    openMenu = workspaceMenu;
  } else {
    workspaceMenu.classList.add('hidden');
    openMenu = null;
  }
});

workspaceMenu?.addEventListener('click', (event) => {
  event.stopPropagation();
});

function nowIso() {
  return new Date().toISOString();
}

function stringToHue(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

function addInterval(date, interval, unit) {
  const next = new Date(date.getTime());
  if (unit === 'day') next.setDate(next.getDate() + interval);
  if (unit === 'week') next.setDate(next.getDate() + interval * 7);
  if (unit === 'month') next.setMonth(next.getMonth() + interval);
  if (unit === 'year') next.setFullYear(next.getFullYear() + interval);
  return next;
}

function getProjectName(projectId) {
  if (!projectId) return null;
  const project = (state.projects ?? []).find(item => item.id === projectId);
  return project?.name ?? null;
}

async function loadWorkspaces() {
  let workspaces = await api.listWorkspaces();
  if (!workspaces.length) {
    const created = await api.createWorkspace({ name: 'Personal', type: 'personal' });
    workspaces = [created];
  }
  const normalized = workspaces.map(normalizeWorkspace);
  state.workspaces = normalized;
  const preferredId = state.ui?.activeWorkspaceId;
  state.workspace = normalized.find(ws => ws.id === preferredId) ?? normalized[0];
  state.ui.activeWorkspaceId = state.workspace.id;
}

async function loadWorkspaceData() {
  if (!state.workspace) return;
  state.projects = (await api.listProjects(state.workspace.id)).map(normalizeProject);
  state.templates = (await api.listTemplates(state.workspace.id)).map(normalizeTemplate);
  const tasks = await api.listTasks(state.workspace.id);
  state.tasks = Object.fromEntries(tasks.map(task => [task.id, normalizeTask(task)]));
}

async function refreshWorkspace() {
  if (!state.workspace) {
    render();
    return;
  }
  await loadWorkspaceData();
  await ensureTemplateReminders();
  await loadWorkspaceData();
  render();
  await maybePromptTemplate();
}

async function selectWorkspace(workspace) {
  state.workspace = workspace;
  state.ui.activeWorkspaceId = workspace.id;
  state.ui.activeProjectId = null;
  await refreshWorkspace();
}

function normalizeWorkspace(workspace) {
  return { ...workspace, archived: Boolean(workspace.archived) };
}

function normalizeProject(project) {
  return { ...project, archived: Boolean(project.archived) };
}

function normalizeTemplate(template) {
  return { ...template, archived: Boolean(template.archived) };
}

function normalizeTask(task) {
  return {
    ...task,
    urgency: Number(task.urgency) ? 1 : 0,
    auto_debit: Number(task.auto_debit) ? 1 : 0,
    template_prompt_pending: Number(task.template_prompt_pending) ? 1 : 0
  };
}

function upsertTask(task) {
  state.tasks[task.id] = normalizeTask(task);
}

function upsertProject(project) {
  state.projects = state.projects ?? [];
  const normalized = normalizeProject(project);
  const index = state.projects.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.projects[index] = normalized;
  } else {
    state.projects.push(normalized);
  }
}

function upsertTemplate(template) {
  state.templates = state.templates ?? [];
  const normalized = normalizeTemplate(template);
  const index = state.templates.findIndex(item => item.id === normalized.id);
  if (index >= 0) {
    state.templates[index] = normalized;
  } else {
    state.templates.push(normalized);
  }
}

async function createTaskRecord(payload) {
  if (!state.workspace) return null;
  const created = await api.createTask({ ...payload, workspace_id: state.workspace.id });
  upsertTask(created);
  return created;
}

async function updateTaskRecord(id, patch) {
  const updated = await api.updateTask(id, patch);
  if (updated) upsertTask(updated);
  return updated;
}

async function deleteTaskRecord(id) {
  const result = await api.deleteTask(id);
  if (result?.ids?.length) {
    result.ids.forEach(taskId => delete state.tasks[taskId]);
  } else if (result?.deleted) {
    delete state.tasks[id];
  }
  return result;
}

function parseShoppingItems(input) {
  if (!input) return [];
  const raw = input
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return raw.map(item => {
    let value = item.replace(/\s+/g, ' ');
    value = value.replace(/\b(k\s*cups|k-cups)\b/gi, 'K-cups');
    value = value.charAt(0).toUpperCase() + value.slice(1);
    return value;
  });
}

function normalizeShoppingItems(input) {
  return parseShoppingItems(input).join('\n');
}

function checklistFromItems(items) {
  return items.map(item => `- [ ] ${item}`).join('\n');
}

function extractChecklistItems(description = '') {
  return description
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- [ ] '))
    .map(line => line.replace('- [ ] ', '').trim());
}

function buildTree(tasks) {
  const map = new Map();
  tasks.forEach(task => {
    map.set(task.id, { ...task, children: [] });
  });
  const roots = [];
  map.forEach(task => {
    if (task.parent_id && map.has(task.parent_id)) {
      map.get(task.parent_id).children.push(task);
    } else {
      roots.push(task);
    }
  });
  return roots;
}

function sortTree(nodes) {
  nodes.sort(compareTasksByPriority);
  nodes.forEach(node => sortTree(node.children));
}

function render() {
  renderWorkspaceList();
  renderProjectList();
  renderTemplateList();
  if (activeTaskId && !state.tasks[activeTaskId]) {
    closeTaskEditor();
  }
  taskTreeEl.innerHTML = '';
  const tasks = getFilteredTasks();
  const tree = buildTree(tasks);
  sortTree(tree);
  renderStatusSections(tree);
  renderNotificationStatus();
  saveState(state);
}

function getProjectsForWorkspace() {
  if (!state.workspace) return [];
  return (state.projects ?? []).filter(project => project.workspace_id === state.workspace.id && !project.archived);
}

function getFilteredTasks() {
  if (!state.workspace) return [];
  const tasks = Object.values(state.tasks).filter(task => task.workspace_id === state.workspace.id);
  const filter = state.ui?.activeProjectId ?? null;
  if (!filter) return tasks;
  if (filter === 'unassigned') {
    return tasks.filter(task => !task.project_id);
  }
  return tasks.filter(task => task.project_id === filter);
}

function renderProjectList() {
  if (!projectListEl) return;
  if (!state.workspace) {
    projectListEl.innerHTML = '';
    return;
  }
  projectListEl.innerHTML = '';
  const active = state.ui?.activeProjectId ?? null;
  if (active && active !== 'unassigned') {
    const exists = (state.projects ?? []).some(project => project.id === active && project.workspace_id === state.workspace.id && !project.archived);
    if (!exists) {
      state.ui.activeProjectId = null;
    }
  }
  const allRow = document.createElement('div');
  allRow.className = 'workspace-row' + (!active ? ' active' : '');
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'workspace-select';
  allBtn.textContent = 'All tasks';
  allBtn.addEventListener('click', () => {
    state.ui = state.ui ?? {};
    state.ui.activeProjectId = null;
    render();
  });
  allRow.appendChild(allBtn);
  projectListEl.appendChild(allRow);

  const unassignedRow = document.createElement('div');
  unassignedRow.className = 'workspace-row' + (active === 'unassigned' ? ' active' : '');
  const unassignedBtn = document.createElement('button');
  unassignedBtn.type = 'button';
  unassignedBtn.className = 'workspace-select';
  unassignedBtn.textContent = 'Unassigned';
  unassignedBtn.addEventListener('click', () => {
    state.ui = state.ui ?? {};
    state.ui.activeProjectId = 'unassigned';
    render();
  });
  unassignedRow.appendChild(unassignedBtn);
  projectListEl.appendChild(unassignedRow);

  getProjectsForWorkspace().forEach(project => {
    const row = document.createElement('div');
    row.className = 'workspace-row project-row' + (project.id === active ? ' active' : '');

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'workspace-select';
    selectBtn.textContent = project.name;
    selectBtn.addEventListener('click', () => {
      state.ui = state.ui ?? {};
      state.ui.activeProjectId = project.id;
      render();
    });

    const menuWrapper = document.createElement('div');
    menuWrapper.className = 'workspace-menu-wrapper';
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'workspace-menu-button icon-button';
    menuButton.textContent = '⋯';

    const menu = document.createElement('div');
    menu.className = 'workspace-menu hidden';

    const renameItem = document.createElement('button');
    renameItem.type = 'button';
    renameItem.className = 'workspace-menu-item';
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const nextName = prompt('Project name', project.name);
      if (!nextName) return;
      const updatedName = nextName.trim() || project.name;
      const updated = await api.updateProject(project.id, { name: updatedName });
      if (updated) upsertProject(updated);
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    const archiveItem = document.createElement('button');
    archiveItem.type = 'button';
    archiveItem.className = 'workspace-menu-item';
    archiveItem.textContent = 'Archive';
    archiveItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const updated = await api.updateProject(project.id, { archived: 1 });
      if (updated) upsertProject(updated);
      if (state.ui?.activeProjectId === project.id) {
        state.ui.activeProjectId = null;
      }
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    const deleteItem = document.createElement('button');
    deleteItem.type = 'button';
    deleteItem.className = 'workspace-menu-item';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const confirmed = confirm(`Delete project \"${project.name}\"? Tasks will become unassigned.`);
      if (!confirmed) return;
      await api.deleteProject(project.id);
      await refreshWorkspace();
      menu.classList.add('hidden');
      openMenu = null;
    });

    menu.appendChild(renameItem);
    menu.appendChild(archiveItem);
    menu.appendChild(deleteItem);
    menuWrapper.appendChild(menuButton);
    menuWrapper.appendChild(menu);

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (openMenu && openMenu !== menu) {
        openMenu.classList.add('hidden');
      }
      if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        openMenu = menu;
      } else {
        menu.classList.add('hidden');
        openMenu = null;
      }
    });

    menu.addEventListener('click', (event) => event.stopPropagation());

    const badge = document.createElement('span');
    badge.className = 'project-badge';
    badge.textContent = 'Project';

    row.appendChild(selectBtn);
    row.appendChild(badge);
    row.appendChild(menuWrapper);
    projectListEl.appendChild(row);
  });
}

function populateProjectSelect(selectEl, selectedId = null, includeNone = true) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  if (includeNone) {
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'None';
    selectEl.appendChild(noneOption);
  }
  getProjectsForWorkspace().forEach(project => {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    selectEl.appendChild(option);
  });
  selectEl.value = selectedId ?? '';
}

function renderTemplateList() {
  if (!templateListEl) return;
  if (!state.workspace) {
    templateListEl.innerHTML = '';
    return;
  }
  templateListEl.innerHTML = '';
  const templates = state.templates ?? [];
  templates
    .filter(t => t.workspace_id === state.workspace.id && !t.archived)
    .forEach(template => {
    const row = document.createElement('div');
    row.className = 'workspace-row';

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'workspace-select';
    selectBtn.textContent = template.next_event_date
      ? `${template.name} · next ${template.next_event_date}`
      : template.name;
    selectBtn.addEventListener('click', () => {
      openTemplateModal(template);
    });

    const menuWrapper = document.createElement('div');
    menuWrapper.className = 'workspace-menu-wrapper';
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'workspace-menu-button icon-button';
    menuButton.textContent = '⋯';

    const menu = document.createElement('div');
    menu.className = 'workspace-menu hidden';

    const planItem = document.createElement('button');
    planItem.type = 'button';
    planItem.className = 'workspace-menu-item';
    planItem.textContent = 'Start plan';
    planItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      await startTemplatePlan(template);
      await refreshWorkspace();
      menu.classList.add('hidden');
      openMenu = null;
    });

    const archiveItem = document.createElement('button');
    archiveItem.type = 'button';
    archiveItem.className = 'workspace-menu-item';
    archiveItem.textContent = 'Archive';
    archiveItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const updated = await api.updateTemplate(template.id, { archived: 1 });
      if (updated) upsertTemplate(updated);
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    const deleteItem = document.createElement('button');
    deleteItem.type = 'button';
    deleteItem.className = 'workspace-menu-item';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const confirmed = confirm(`Delete template \"${template.name}\"?`);
      if (!confirmed) return;
      await api.deleteTemplate(template.id);
      await refreshWorkspace();
      menu.classList.add('hidden');
      openMenu = null;
    });

    menu.appendChild(planItem);
    menu.appendChild(archiveItem);
    menu.appendChild(deleteItem);
    menuWrapper.appendChild(menuButton);
    menuWrapper.appendChild(menu);

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (openMenu && openMenu !== menu) {
        openMenu.classList.add('hidden');
      }
      if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        openMenu = menu;
      } else {
        menu.classList.add('hidden');
        openMenu = null;
      }
    });

    menu.addEventListener('click', (event) => event.stopPropagation());

    row.appendChild(selectBtn);
    row.appendChild(menuWrapper);
    templateListEl.appendChild(row);
  });
}

function renderNotificationStatus() {
  if (!notificationStatus || !enableNotificationsBtn) return;
  if (!('Notification' in window)) {
    notificationStatus.textContent = 'Notifications not supported in this browser.';
    return;
  }
  const permission = Notification.permission;
  const enabled = Boolean(state.ui?.notificationsEnabled);
  enableNotificationsBtn.checked = enabled;
  if (permission === 'granted' && enabled) {
    notificationStatus.textContent = 'Notifications enabled.';
    return;
  }
  if (permission === 'denied') {
    notificationStatus.textContent = 'Notifications blocked in browser settings.';
    return;
  }
  notificationStatus.textContent = enabled ? 'Permission pending.' : 'Notifications off.';
}

const STATUS_SECTIONS = [
  { status: TaskStatus.INBOX, label: 'Inbox', className: 'status-inbox' },
  { status: TaskStatus.PLANNED, label: 'Planned', className: 'status-planned' },
  { status: TaskStatus.IN_PROGRESS, label: 'In Progress', className: 'status-in-progress' },
  { status: TaskStatus.WAITING, label: 'Waiting', className: 'status-waiting' },
  { status: TaskStatus.BLOCKED, label: 'Blocked', className: 'status-blocked' },
  { status: TaskStatus.DONE, label: 'Done', className: 'status-done' },
  { status: TaskStatus.CANCELED, label: 'Canceled', className: 'status-canceled' }
];

function renderStatusSections(roots) {
  const grouped = new Map();
  roots.forEach(task => {
    const status = task.status ?? TaskStatus.INBOX;
    if (!grouped.has(status)) grouped.set(status, []);
    grouped.get(status).push(task);
  });

  STATUS_SECTIONS.forEach(section => {
    const items = grouped.get(section.status) ?? [];
    if (!items.length) return;
    const wrapper = document.createElement('section');
    wrapper.className = `status-section ${section.className}`;

    const header = document.createElement('div');
    header.className = 'status-header';
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    const label = document.createElement('span');
    label.textContent = section.label;
    header.appendChild(dot);
    header.appendChild(label);
    wrapper.appendChild(header);

    items.forEach(node => wrapper.appendChild(renderTask(node)));
    taskTreeEl.appendChild(wrapper);
  });
}

function renderWorkspaceList() {
  workspaceListEl.innerHTML = '';
  if (!state.workspace) return;
  const workspaces = state.workspaces ?? [state.workspace];
  const showArchived = Boolean(state.ui?.showArchived);
  const filtered = showArchived ? workspaces : workspaces.filter(ws => !ws.archived);

  showArchivedToggle.checked = showArchived;

  filtered.forEach(workspace => {
    const row = document.createElement('div');
    row.className = 'workspace-row' + (workspace.id === state.workspace.id ? ' active' : '');

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'workspace-select';
    selectBtn.textContent = workspace.archived ? `${workspace.name} (archived)` : workspace.name;
    selectBtn.addEventListener('click', () => {
      selectWorkspace(workspace);
    });

    const menuWrapper = document.createElement('div');
    menuWrapper.className = 'workspace-menu-wrapper';

    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'workspace-menu-button icon-button';
    menuButton.title = 'Workspace menu';
    menuButton.textContent = '⋯';

    const menu = document.createElement('div');
    menu.className = 'workspace-menu hidden';

    const renameItem = document.createElement('button');
    renameItem.type = 'button';
    renameItem.className = 'workspace-menu-item';
    renameItem.textContent = 'Rename';

    const archiveItem = document.createElement('button');
    archiveItem.type = 'button';
    archiveItem.className = 'workspace-menu-item';
    archiveItem.textContent = workspace.archived ? 'Unarchive' : 'Archive';

    const deleteItem = document.createElement('button');
    deleteItem.type = 'button';
    deleteItem.className = 'workspace-menu-item';
    deleteItem.textContent = 'Delete';

    renameItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const nextName = prompt('Workspace name', workspace.name);
      if (!nextName) return;
      const updatedName = nextName.trim() || workspace.name;
      const updated = await api.updateWorkspace(workspace.id, { name: updatedName });
      const normalized = updated ? normalizeWorkspace(updated) : null;
      if (!normalized) return;
      workspace.name = normalized.name;
      if (state.workspace?.id === workspace.id) {
        state.workspace.name = normalized.name;
      }
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    archiveItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const nextArchived = !workspace.archived;
      const updated = await api.updateWorkspace(workspace.id, { archived: nextArchived ? 1 : 0 });
      const normalized = updated ? normalizeWorkspace(updated) : null;
      if (!normalized) return;
      workspace.archived = normalized.archived;
      if (nextArchived && state.workspace.id === workspace.id) {
        const active = workspaces.find(ws => ws.id !== workspace.id && !ws.archived);
        if (active) await selectWorkspace(active);
      }
      menu.classList.add('hidden');
      openMenu = null;
      render();
    });

    deleteItem.addEventListener('click', async (event) => {
      event.stopPropagation();
      const confirmed = confirm(`Delete workspace \"${workspace.name}\" and all its tasks?`);
      if (!confirmed) return;
      await api.deleteWorkspace(workspace.id);
      await loadWorkspaces();
      if (state.workspace?.id === workspace.id) {
        state.workspace = state.workspaces[0] ?? null;
      }
      if (state.workspace) {
        await refreshWorkspace();
      } else {
        render();
      }
      menu.classList.add('hidden');
      openMenu = null;
    });

    menu.appendChild(renameItem);
    menu.appendChild(archiveItem);
    menu.appendChild(deleteItem);
    menuWrapper.appendChild(menuButton);
    menuWrapper.appendChild(menu);

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (openMenu && openMenu !== menu) {
        openMenu.classList.add('hidden');
      }
      if (menu.classList.contains('hidden')) {
        menu.classList.remove('hidden');
        openMenu = menu;
      } else {
        menu.classList.add('hidden');
        openMenu = null;
      }
    });

    menu.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    row.appendChild(selectBtn);
    row.appendChild(menuWrapper);
    workspaceListEl.appendChild(row);
  });
}

function renderTask(task) {
  const template = document.getElementById('task-item-template');
  const node = template.content.cloneNode(true);
  const item = node.querySelector('.task-item');
  const titleEl = node.querySelector('.task-title');
  const metaEl = node.querySelector('.task-meta');
  const typeBadge = node.querySelector('.task-type-badge');
  const toggleBtn = node.querySelector('.task-toggle');
  const editBtn = node.querySelector('.edit-task');
  const completeButton = node.querySelector('.task-complete-button');
  const menuButton = node.querySelector('.task-menu-button');
  const menu = node.querySelector('.task-menu');
  const menuItems = node.querySelectorAll('.task-menu-item');
  const childrenEl = node.querySelector('.task-children');
  const hasChildren = task.children && task.children.length > 0;
  const collapsedMap = state.ui?.collapsedTasks ?? {};
  const isCollapsed = Boolean(collapsedMap[task.id]);

  titleEl.textContent = task.title;
  item.dataset.status = task.status ?? TaskStatus.INBOX;
  const projectName = getProjectName(task.project_id);
  const projectText = projectName ? ` · ${projectName}` : '';
  metaEl.textContent = `${task.status} · priority ${task.priority}${task.urgency ? ' · urgent' : ''}${projectText}`;
  const recurrenceText = task.recurrence_interval && task.recurrence_unit
    ? ` · repeats every ${task.recurrence_interval} ${task.recurrence_unit}${task.recurrence_interval > 1 ? 's' : ''}`
    : '';
  const hasReminder = task.reminder_offset_days !== null && task.reminder_offset_days !== undefined;
  const reminderText = hasReminder ? ` · reminds ${task.reminder_offset_days}d before` : '';
  if (recurrenceText || reminderText) {
    metaEl.textContent += `${recurrenceText}${reminderText}`;
  }
  if (task.type_label) {
    typeBadge.textContent = task.type_label;
    typeBadge.style.display = 'inline-flex';
    typeBadge.style.background = `hsla(${stringToHue(task.type_label)}, 60%, 35%, 0.35)`;
    typeBadge.style.color = '#e9edf5';
  } else {
    typeBadge.style.display = 'none';
  }
  if (task.status === TaskStatus.DONE) {
    item.classList.add('completed');
  }

  if (hasChildren) {
    node.querySelector('.task-main').classList.add('has-children');
    toggleBtn.textContent = isCollapsed ? '▾' : '▴';
    toggleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      state.ui = state.ui ?? {};
      state.ui.collapsedTasks = state.ui.collapsedTasks ?? {};
      const next = !state.ui.collapsedTasks[task.id];
      state.ui.collapsedTasks[task.id] = next;
      render();
    });
    childrenEl.classList.toggle('hidden', isCollapsed);
  } else {
    toggleBtn.classList.add('hidden');
  }

  completeButton.addEventListener('click', async () => {
    const isDone = task.status === TaskStatus.DONE;
    if (!isDone && hasIncompleteDescendants(task.id)) {
      const confirmed = confirm('This task has incomplete subtasks. Mark complete anyway?');
      if (!confirmed) return;
    }
    const patch = isDone
      ? { status: TaskStatus.PLANNED, completed_at: null }
      : { status: TaskStatus.DONE, completed_at: task.completed_at ?? nowIso() };
    const updated = await updateTaskRecord(task.id, patch);
    if (!updated) return;
    if (!isDone) {
      await maybeCreateRecurringTask(state.tasks[task.id]);
      await maybePromptCompleteParent(task.id);
    }
    render();
  });

  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (openMenu && openMenu !== menu) {
      openMenu.classList.add('hidden');
    }
    if (menu.classList.contains('hidden')) {
      menu.classList.remove('hidden');
      openMenu = menu;
    } else {
      menu.classList.add('hidden');
      openMenu = null;
    }
  });

  menu.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  menuItems.forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      if (action === 'subtask') {
        const title = prompt('Subtask title');
        if (!title) return;
        await createTaskRecord({ title, parent_id: task.id, project_id: task.project_id ?? null });
        render();
      }
      if (action === 'duplicate') {
        await createTaskRecord({
          title: `${task.title} (copy)`,
          parent_id: task.parent_id,
          project_id: task.project_id ?? null,
          priority: task.priority,
          urgency: task.urgency,
          status: TaskStatus.INBOX,
          start_at: task.start_at,
          due_at: task.due_at,
          description_md: task.description_md ?? '',
          type_label: task.type_label ?? null,
          recurrence_interval: task.recurrence_interval ?? null,
          recurrence_unit: task.recurrence_unit ?? null,
          reminder_offset_days: task.reminder_offset_days ?? null,
          auto_debit: task.auto_debit ?? 0
        });
        render();
      }
      if (action === 'start-template') {
        const template = (state.templates ?? []).find(t => t.id === task.template_id);
        if (template) {
          await updateTaskRecord(task.id, { template_prompt_pending: 0 });
          await startPlanFromReminder(task, template);
          await refreshWorkspace();
        }
      }
      if (action === 'defer-template') {
        const days = Number(prompt('Defer by how many days?', '3'));
        if (!Number.isFinite(days) || days <= 0) return;
        const newDue = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        await updateTaskRecord(task.id, { due_at: newDue, template_defer_until: newDue, template_prompt_pending: 0 });
        render();
      }
      if (action === 'dismiss-template') {
        const template = (state.templates ?? []).find(t => t.id === task.template_id);
        if (template) {
          await advanceTemplateDate(template);
        }
        await deleteTaskRecord(task.id);
        render();
      }
      menu.classList.add('hidden');
      openMenu = null;
    });
  });

  const templateItems = menu.querySelectorAll('.template-only');
  templateItems.forEach(item => {
    if (task.template_id) {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });

  editBtn.addEventListener('click', () => {
    openTaskEditor(task.id);
  });

  task.children.forEach(child => childrenEl.appendChild(renderTask(child)));

  return item;
}

async function handleCheckIn(task, response) {
  const updated = applyCheckIn(task, response, new Date());
  await updateTaskRecord(task.id, {
    status: updated.status,
    completed_at: updated.completed_at ?? null,
    next_checkin_at: updated.next_checkin_at ?? null
  });
  if (updated.status === TaskStatus.DONE) {
    await maybeCreateRecurringTask(state.tasks[task.id]);
    await maybePromptCompleteParent(task.id);
  }
  render();
}

async function deleteTaskSubtree(taskId) {
  await deleteTaskRecord(taskId);
}

function getDescendants(taskId) {
  const descendants = [];
  const ids = new Set([taskId]);
  let added = true;
  while (added) {
    added = false;
    for (const task of Object.values(state.tasks)) {
      if (task.parent_id && ids.has(task.parent_id) && !ids.has(task.id)) {
        ids.add(task.id);
        descendants.push(task);
        added = true;
      }
    }
  }
  return descendants;
}

function hasIncompleteDescendants(taskId) {
  return getDescendants(taskId).some(task => task.status !== TaskStatus.DONE);
}

function allDescendantsComplete(taskId) {
  const descendants = getDescendants(taskId);
  if (!descendants.length) return false;
  return descendants.every(task => task.status === TaskStatus.DONE);
}

async function maybePromptCompleteParent(taskId) {
  const task = state.tasks[taskId];
  if (!task?.parent_id) return;
  const parent = state.tasks[task.parent_id];
  if (!parent) return;
  if (parent.status === TaskStatus.DONE || parent.status === TaskStatus.CANCELED) return;
  if (!allDescendantsComplete(parent.id)) return;

  const confirmed = confirm(`All subtasks are complete. Mark \"${parent.title}\" complete?`);
  if (!confirmed) return;
  await updateTaskRecord(parent.id, {
    status: TaskStatus.DONE,
    completed_at: parent.completed_at ?? nowIso()
  });
}

async function maybeCreateRecurringTask(task) {
  if (!task) return;
  if (!task.recurrence_interval || !task.recurrence_unit) return;
  if (task.recurrence_generated_at) return;
  const baseDate = task.due_at || task.start_at;
  if (!baseDate) return;

  const interval = Number(task.recurrence_interval);
  if (!interval || interval < 1) return;

  const nextDue = task.due_at ? addInterval(new Date(task.due_at), interval, task.recurrence_unit) : null;
  const nextStart = task.start_at ? addInterval(new Date(task.start_at), interval, task.recurrence_unit) : null;

  await createTaskRecord({
    title: task.title,
    parent_id: task.parent_id,
    project_id: task.project_id ?? null,
    priority: task.priority,
    urgency: task.urgency,
    status: TaskStatus.PLANNED,
    start_at: nextStart ? nextStart.toISOString() : null,
    due_at: nextDue ? nextDue.toISOString() : null,
    description_md: task.description_md ?? '',
    type_label: task.type_label ?? null,
    recurrence_interval: task.recurrence_interval,
    recurrence_unit: task.recurrence_unit,
    reminder_offset_days: task.reminder_offset_days ?? null,
    auto_debit: task.auto_debit ?? 0,
    recurrence_parent_id: task.id
  });
  await updateTaskRecord(task.id, { recurrence_generated_at: nowIso() });
}

function parseTemplateSteps(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split('|').map(part => part.trim());
      if (parts.length === 1) {
        return { title: parts[0], offset_days: null };
      }
      const offset = Number(parts[1]);
      return { title: parts[0], offset_days: Number.isFinite(offset) ? offset : null };
    });
}

function formatTemplateSteps(steps = []) {
  return steps
    .map(step => step.offset_days !== null && step.offset_days !== undefined
      ? `${step.title} | ${step.offset_days}`
      : step.title
    )
    .join('\n');
}

function openTemplateModal(template = null) {
  editingTemplateId = template?.id ?? null;
  templateName.value = template?.name ?? '';
  templateSteps.value = formatTemplateSteps(template?.steps ?? []);
  templateLeadDays.value = template?.lead_days ?? '';
  templateNextDate.value = template?.next_event_date ?? '';
  templateRepeatInterval.value = template?.recurrence_interval ?? '';
  templateRepeatUnit.value = template?.recurrence_unit ?? 'year';
  populateProjectSelect(templateProject, template?.project_id ?? '', true);
  templateModal.classList.remove('hidden');
  templateName.focus();
}

function closeTemplateModal() {
  templateModal.classList.add('hidden');
  editingTemplateId = null;
}

function openSettings() {
  settingsModal?.classList.remove('hidden');
}

function closeSettings() {
  settingsModal?.classList.add('hidden');
}

function openTaskEditor(taskId) {
  const task = state.tasks[taskId];
  if (!task) return;
  activeTaskId = taskId;
  editorTitle.value = task.title ?? '';
  editorType.value = task.type_label ?? '';
  editorPriority.value = task.priority ?? 'medium';
  populateProjectSelect(editorProject, task.project_id ?? '', true);
  editorUrgency.checked = Boolean(task.urgency);
  editorRepeatInterval.value = task.recurrence_interval ?? '';
  editorRepeatUnit.value = task.recurrence_unit ?? 'month';
  editorReminder.value = task.reminder_offset_days ?? '';
  editorAutoDebit.checked = Boolean(task.auto_debit);
  editorStatus.value = task.status ?? TaskStatus.INBOX;
  editorStart.value = toDatetimeLocal(task.start_at);
  editorDue.value = toDatetimeLocal(task.due_at);
  editorDesc.value = task.description_md ?? '';
  editorShoppingItems.value = task.type_label === 'Shopping List'
    ? extractChecklistItems(task.description_md ?? '').join('\n')
    : '';
  taskEditor.classList.add('is-open');
}

function closeTaskEditor() {
  taskEditor.classList.remove('is-open');
  activeTaskId = null;
}

function closeTemplatePrompt() {
  templatePrompt?.classList.add('hidden');
  templatePromptTaskId = null;
}

async function dismissTemplatePrompt() {
  if (!templatePromptTaskId) return;
  await updateTaskRecord(templatePromptTaskId, { template_prompt_pending: 0 });
  closeTemplatePrompt();
  render();
}

async function advanceTemplateDate(template) {
  if (!template?.recurrence_interval || !template?.recurrence_unit || !template.next_event_date) {
    return;
  }
  const next = addInterval(new Date(template.next_event_date), Number(template.recurrence_interval), template.recurrence_unit);
  const updated = await api.updateTemplate(template.id, { next_event_date: next.toISOString().slice(0, 10) });
  if (updated) upsertTemplate(updated);
}

async function ensureTemplateReminders() {
  const templates = state.templates ?? [];
  const now = Date.now();
  for (const task of Object.values(state.tasks)) {
    if (task.template_state !== 'pending') continue;
    if (!task.template_defer_until) continue;
    const deferTime = new Date(task.template_defer_until).getTime();
    if (Number.isNaN(deferTime)) continue;
    if (now >= deferTime) {
      const updated = await api.updateTask(task.id, { template_prompt_pending: 1, template_defer_until: null });
      if (updated) upsertTask(updated);
    }
  }
  for (const template of templates) {
    if (template.archived) continue;
    if (template.workspace_id && template.workspace_id !== state.workspace.id) continue;
    if (!template.next_event_date) continue;
    const eventDate = new Date(`${template.next_event_date}T00:00:00`);
    if (Number.isNaN(eventDate.getTime())) continue;
    const leadDays = Number(template.lead_days ?? 0);
    const reminderAt = eventDate.getTime() - leadDays * 24 * 60 * 60 * 1000;
    if (now < reminderAt) continue;
    const existingReminder = Object.values(state.tasks).find(task =>
      task.template_id === template.id && task.template_state === 'pending'
    );
    if (existingReminder) continue;
    const reminderTask = await createTaskRecord({
      title: `Plan: ${template.name}`,
      status: TaskStatus.INBOX,
      priority: 'medium',
      project_id: template.project_id ?? null,
      type_label: 'Template Reminder',
      due_at: new Date(reminderAt).toISOString(),
      reminder_offset_days: 0,
      template_id: template.id,
      template_event_date: template.next_event_date,
      template_lead_days: leadDays,
      template_state: 'pending',
      template_prompt_pending: 1
    });
    if (reminderTask) upsertTask(reminderTask);
  }
}

async function startTemplatePlan(template) {
  const eventDate = template.next_event_date ? new Date(`${template.next_event_date}T00:00:00`) : null;
  const reminderTask = await createTaskRecord({
    title: `Plan: ${template.name}`,
    status: TaskStatus.PLANNED,
    priority: 'medium',
    project_id: template.project_id ?? null,
    type_label: template.name,
    due_at: eventDate ? eventDate.toISOString() : null,
    template_id: template.id,
    template_event_date: template.next_event_date ?? null,
    template_state: 'started'
  });
  if (reminderTask) {
    await generateTemplateSteps(template, reminderTask.id, eventDate);
  }
  if (template.recurrence_interval && template.recurrence_unit) {
    await advanceTemplateDate(template);
  }
}

async function startPlanFromReminder(task, template) {
  const eventDate = task.template_event_date ? new Date(`${task.template_event_date}T00:00:00`) : null;
  const updated = await updateTaskRecord(task.id, {
    status: TaskStatus.PLANNED,
    type_label: template.name,
    template_state: 'started',
    project_id: template.project_id ?? task.project_id ?? null,
    due_at: eventDate ? eventDate.toISOString() : task.due_at
  });
  if (updated) {
    await generateTemplateSteps(template, task.id, eventDate);
  }
  if (template.recurrence_interval && template.recurrence_unit) {
    await advanceTemplateDate(template);
  }
}

async function generateTemplateSteps(template, parentId, eventDate) {
  const steps = template.steps ?? [];
  if (!steps.length) return;
  const leadDays = Number(template.lead_days ?? 0);
  const eventTime = eventDate?.getTime();
  const spacing = leadDays && steps.length > 1 ? leadDays / (steps.length - 1) : 0;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    let dueAt = null;
    if (eventTime) {
      if (step.offset_days !== null && step.offset_days !== undefined) {
        dueAt = new Date(eventTime + step.offset_days * 24 * 60 * 60 * 1000);
      } else if (leadDays) {
        const offset = leadDays - index * spacing;
        dueAt = new Date(eventTime - offset * 24 * 60 * 60 * 1000);
      } else {
        dueAt = new Date(eventTime);
      }
    }
    await createTaskRecord({
      title: step.title,
      parent_id: parentId,
      status: TaskStatus.PLANNED,
      priority: 'medium',
      project_id: template.project_id ?? null,
      due_at: dueAt ? dueAt.toISOString() : null,
      type_label: template.name,
      template_id: template.id
    });
  }
}

async function maybePromptTemplate() {
  if (templatePromptTaskId) return;
  if (!templatePrompt) return;
  if (!state.workspace) return;
  const pending = Object.values(state.tasks).find(task =>
    task.workspace_id === state.workspace.id &&
    task.template_prompt_pending &&
    task.template_state === 'pending'
  );
  if (!pending) return;
  if (pending.template_defer_until) {
    const deferTime = new Date(pending.template_defer_until).getTime();
    if (!Number.isNaN(deferTime) && Date.now() < deferTime) return;
  }
  const template = (state.templates ?? []).find(t => t.id === pending.template_id);
  if (!template) {
    await updateTaskRecord(pending.id, { template_prompt_pending: 0 });
    return;
  }

  templatePromptTaskId = pending.id;
  templatePromptTitle.textContent = `Start planning: ${template.name}?`;
  const details = [];
  if (pending.template_event_date) details.push(`Event date: ${pending.template_event_date}`);
  if (template.lead_days) details.push(`Lead time: ${template.lead_days} days`);
  templatePromptText.textContent = details.join(' · ');
  templatePrompt.classList.remove('hidden');
}

function shouldNotify(task) {
  if (!task.due_at) return false;
  if (task.status === TaskStatus.DONE || task.status === TaskStatus.CANCELED) return false;
  if (task.reminder_offset_days === null || task.reminder_offset_days === undefined) return false;
  const reminderMs = Number(task.reminder_offset_days) * 24 * 60 * 60 * 1000;
  if (Number.isNaN(reminderMs)) return false;
  const dueTime = new Date(task.due_at).getTime();
  if (Number.isNaN(dueTime)) return false;
  const reminderTime = dueTime - reminderMs;
  if (Date.now() < reminderTime) return false;
  if (task.reminder_sent_at) {
    const sentTime = new Date(task.reminder_sent_at).getTime();
    if (!Number.isNaN(sentTime) && sentTime >= reminderTime) return false;
  }
  return true;
}

async function checkReminders() {
  if (!state.ui?.notificationsEnabled) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  for (const task of Object.values(state.tasks)) {
    if (!shouldNotify(task)) continue;
    new Notification('BrianHub Reminder', {
      body: `${task.title} is due soon.`,
      tag: task.id
    });
    await updateTaskRecord(task.id, { reminder_sent_at: nowIso() });
  }
}

function toDatetimeLocal(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

function fromDatetimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function openTaskModal() {
  modalTitle.value = '';
  modalPriority.value = 'medium';
  modalUrgency.checked = false;
  modalStatus.value = 'inbox';
  modalStart.value = '';
  modalDue.value = '';
  modalDesc.value = '';
  modalShoppingItems.value = '';
  modalType.value = '';
  modalRepeatInterval.value = '';
  modalRepeatUnit.value = 'month';
  modalReminder.value = '';
  modalAutoDebit.checked = false;
  const activeProject = state.ui?.activeProjectId;
  populateProjectSelect(modalProject, activeProject && activeProject !== 'unassigned' ? activeProject : '', true);
  taskModal.classList.remove('hidden');
  modalTitle.focus();
}

function closeTaskModal() {
  taskModal.classList.add('hidden');
}

newTaskBtn.addEventListener('click', openTaskModal);
modalCancel.addEventListener('click', closeTaskModal);
taskModal.querySelector('.modal-backdrop').addEventListener('click', closeTaskModal);

settingsButton?.addEventListener('click', openSettings);
settingsClose?.addEventListener('click', closeSettings);
settingsModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeSettings);

editorCancel?.addEventListener('click', closeTaskEditor);
editorClose?.addEventListener('click', closeTaskEditor);

taskEditorForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeTaskId) return;
  const task = state.tasks[activeTaskId];
  if (!task) return;
  const title = editorTitle.value.trim();
  if (!title) return;
  const nextStatus = editorStatus.value;
  if (nextStatus === TaskStatus.DONE && hasIncompleteDescendants(task.id)) {
    const confirmed = confirm('This task has incomplete subtasks. Mark complete anyway?');
    if (!confirmed) return;
  }
  const items = parseShoppingItems(editorShoppingItems.value);
  const checklist = items.length ? checklistFromItems(items) : '';
  const notes = editorDesc.value ?? '';
  const description = checklist ? `${checklist}${notes ? `\n\n${notes}` : ''}` : notes;
  const typeLabel = items.length ? 'Shopping List' : (editorType.value.trim() || null);
  const patch = {
    type_label: typeLabel,
    title,
    description_md: description,
    priority: editorPriority.value,
    project_id: editorProject.value || null,
    urgency: editorUrgency.checked ? 1 : 0,
    recurrence_interval: parseInt(editorRepeatInterval.value, 10) || null,
    recurrence_unit: editorRepeatInterval.value ? editorRepeatUnit.value : null,
    reminder_offset_days: parseInt(editorReminder.value, 10) || null,
    auto_debit: editorAutoDebit.checked ? 1 : 0,
    start_at: fromDatetimeLocal(editorStart.value),
    due_at: fromDatetimeLocal(editorDue.value),
    status: nextStatus
  };
  if (nextStatus === TaskStatus.WAITING) {
    const withFollowup = applyWaitingFollowup({ ...task, status: TaskStatus.WAITING }, new Date());
    patch.next_checkin_at = withFollowup.next_checkin_at;
  }
  if (nextStatus === TaskStatus.DONE) {
    patch.completed_at = task.completed_at ?? nowIso();
  } else if (nextStatus !== TaskStatus.DONE) {
    patch.completed_at = null;
  }
  await updateTaskRecord(task.id, patch);
  if (nextStatus === TaskStatus.DONE) {
    await maybeCreateRecurringTask(state.tasks[task.id]);
    await maybePromptCompleteParent(task.id);
  }
  closeTaskEditor();
  render();
});

editorDelete?.addEventListener('click', async () => {
  if (!activeTaskId) return;
  const task = state.tasks[activeTaskId];
  if (!task) return;
  const confirmed = confirm(`Delete \"${task.title}\" and all subtasks?`);
  if (!confirmed) return;
  await deleteTaskSubtree(task.id);
  closeTaskEditor();
  render();
});

editorParseItems?.addEventListener('click', () => {
  editorShoppingItems.value = normalizeShoppingItems(editorShoppingItems.value);
});

templatePromptStart?.addEventListener('click', async () => {
  if (!templatePromptTaskId) return;
  const task = state.tasks[templatePromptTaskId];
  const template = (state.templates ?? []).find(t => t.id === task?.template_id);
  if (task && template) {
    await updateTaskRecord(task.id, { template_prompt_pending: 0 });
    await startPlanFromReminder(task, template);
  }
  closeTemplatePrompt();
  await refreshWorkspace();
});

templatePromptDefer?.addEventListener('click', async () => {
  if (!templatePromptTaskId) return;
  const task = state.tasks[templatePromptTaskId];
  if (!task) return;
  const days = Number(prompt('Defer by how many days?', '3'));
  if (!Number.isFinite(days) || days <= 0) return;
  const newDue = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  await updateTaskRecord(task.id, {
    due_at: newDue,
    template_defer_until: newDue,
    template_prompt_pending: 0
  });
  closeTemplatePrompt();
  render();
});

templatePromptDismiss?.addEventListener('click', async () => {
  if (!templatePromptTaskId) return;
  const task = state.tasks[templatePromptTaskId];
  const template = (state.templates ?? []).find(t => t.id === task?.template_id);
  if (template) await advanceTemplateDate(template);
  if (task) await deleteTaskRecord(task.id);
  closeTemplatePrompt();
  render();
});

templatePrompt?.querySelector('.modal-backdrop')?.addEventListener('click', dismissTemplatePrompt);

taskModalForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = modalTitle.value.trim();
  if (!title) return;
  const items = parseShoppingItems(modalShoppingItems.value);
  const checklist = items.length ? checklistFromItems(items) : '';
  const notes = modalDesc.value ?? '';
  const description = checklist ? `${checklist}${notes ? `\n\n${notes}` : ''}` : notes;
  const typeLabel = items.length ? 'Shopping List' : (modalType.value.trim() || null);
  await createTaskRecord({
    title,
    project_id: modalProject.value || null,
    priority: modalPriority.value,
    urgency: modalUrgency.checked ? 1 : 0,
    status: modalStatus.value,
    type_label: typeLabel,
    recurrence_interval: parseInt(modalRepeatInterval.value, 10) || null,
    recurrence_unit: modalRepeatInterval.value ? modalRepeatUnit.value : null,
    reminder_offset_days: parseInt(modalReminder.value, 10) || null,
    auto_debit: modalAutoDebit.checked ? 1 : 0,
    start_at: fromDatetimeLocal(modalStart.value),
    due_at: fromDatetimeLocal(modalDue.value),
    description_md: description
  });
  closeTaskModal();
  render();
});

modalParseItems?.addEventListener('click', () => {
  modalShoppingItems.value = normalizeShoppingItems(modalShoppingItems.value);
});

newTemplateBtn?.addEventListener('click', () => openTemplateModal(null));
templateCancel?.addEventListener('click', closeTemplateModal);
templateModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeTemplateModal);

templateModalForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = templateName.value.trim();
  if (!name) return;
  const data = {
    name,
    steps: parseTemplateSteps(templateSteps.value),
    lead_days: parseInt(templateLeadDays.value, 10) || 0,
    next_event_date: templateNextDate.value || null,
    project_id: templateProject.value || null,
    recurrence_interval: parseInt(templateRepeatInterval.value, 10) || null,
    recurrence_unit: templateRepeatInterval.value ? templateRepeatUnit.value : null
  };
  if (!state.workspace) return;
  let updated;
  if (editingTemplateId) {
    updated = await api.updateTemplate(editingTemplateId, data);
  } else {
    updated = await api.createTemplate({ ...data, workspace_id: state.workspace.id });
  }
  if (updated) upsertTemplate(updated);
  closeTemplateModal();
  render();
});

syncBtn.addEventListener('click', async () => {
  syncStatus.textContent = 'Refreshing...';
  try {
    await refreshWorkspace();
    syncStatus.textContent = 'Synced (local)';
  } catch (err) {
    syncStatus.textContent = 'Sync failed (offline OK)';
  }
});

newWorkspaceBtn.addEventListener('click', async () => {
  const name = prompt('Workspace name');
  if (!name) return;
  const created = await api.createWorkspace({ name: name.trim(), type: 'personal' });
  const workspace = created ? normalizeWorkspace(created) : null;
  if (!workspace) return;
  state.workspaces = state.workspaces ?? [];
  state.workspaces.push(workspace);
  await selectWorkspace(workspace);
});

newProjectBtn?.addEventListener('click', async () => {
  const name = prompt('Project name');
  if (!name) return;
  if (!state.workspace) return;
  const project = await api.createProject({ name: name.trim(), workspace_id: state.workspace.id, kind: 'project' });
  if (!project) return;
  upsertProject(project);
  state.ui = state.ui ?? {};
  state.ui.activeProjectId = project.id;
  render();
});

showArchivedToggle.addEventListener('change', () => {
  state.ui = state.ui ?? {};
  state.ui.showArchived = showArchivedToggle.checked;
  render();
});

enableNotificationsBtn?.addEventListener('change', async () => {
  if (!('Notification' in window)) {
    render();
    return;
  }
  if (!enableNotificationsBtn.checked) {
    state.ui = state.ui ?? {};
    state.ui.notificationsEnabled = false;
    render();
    return;
  }
  const permission = await Notification.requestPermission();
  state.ui = state.ui ?? {};
  state.ui.notificationsEnabled = permission === 'granted';
  render();
});

setInterval(checkReminders, 60 * 1000);

async function init() {
  await loadWorkspaces();
  await refreshWorkspace();
  checkReminders();
}

init();
