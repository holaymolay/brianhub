const DATA_KEY = 'brianhub_data_v1';

function defaultData() {
  return {
    localSeq: 0,
    pendingChanges: [],
    workspaces: [],
    projects: [],
    statuses: [],
    taskTypes: [],
    tasks: {},
    taskDependencies: [],
    taskSections: [],
    templates: [],
    notices: [],
    noticeTypes: [],
    storeRules: [],
    shoppingLists: [],
    shoppingItems: {}
  };
}

function normalizeData(data) {
  const next = { ...defaultData(), ...(data ?? {}) };
  if (!Array.isArray(next.workspaces)) next.workspaces = [];
  if (!Array.isArray(next.projects)) next.projects = [];
  if (!Array.isArray(next.statuses)) next.statuses = [];
  if (!Array.isArray(next.taskTypes)) next.taskTypes = [];
  if (!Array.isArray(next.taskDependencies)) next.taskDependencies = [];
  if (!Array.isArray(next.taskSections)) next.taskSections = [];
  if (!Array.isArray(next.templates)) next.templates = [];
  if (!Array.isArray(next.notices)) next.notices = [];
  if (!Array.isArray(next.noticeTypes)) next.noticeTypes = [];
  if (!Array.isArray(next.storeRules)) next.storeRules = [];
  if (!Array.isArray(next.shoppingLists)) next.shoppingLists = [];
  if (!next.shoppingItems || typeof next.shoppingItems !== 'object') next.shoppingItems = {};
  if (!next.tasks || typeof next.tasks !== 'object') {
    if (Array.isArray(next.tasks)) {
      next.tasks = Object.fromEntries(next.tasks.map(task => [task.id, task]));
    } else {
      next.tasks = {};
    }
  }
  if (!Array.isArray(next.pendingChanges)) next.pendingChanges = [];
  if (!Number.isFinite(next.localSeq)) next.localSeq = 0;
  return next;
}

export function loadLocalData() {
  const raw = localStorage.getItem(DATA_KEY);
  if (!raw) return defaultData();
  try {
    const parsed = JSON.parse(raw);
    return normalizeData(parsed);
  } catch {
    return defaultData();
  }
}

export function saveLocalData(data) {
  const payload = normalizeData(data);
  localStorage.setItem(DATA_KEY, JSON.stringify(payload));
}

export function recordLocalChange(data, change) {
  const next = normalizeData(data);
  const seq = next.localSeq + 1;
  next.localSeq = seq;
  next.pendingChanges.push({
    seq,
    created_at: new Date().toISOString(),
    ...change
  });
  return next;
}

export function clearLocalChanges(data) {
  const next = normalizeData(data);
  next.pendingChanges = [];
  return next;
}
