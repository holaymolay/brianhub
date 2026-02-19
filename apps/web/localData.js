const DATA_KEY = 'brianhub_data_v1';
let mutationCounter = 0;

function createMutationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  mutationCounter += 1;
  return `mut-${Date.now().toString(36)}-${mutationCounter.toString(36)}`;
}

function defaultData() {
  return {
    localSeq: 0,
    pendingChanges: [],
    auditLog: [],
    workspaces: [],
    projects: [],
    statuses: [],
    taskTypes: [],
    users: [],
    workspaceMemberships: [],
    tasks: {},
    taskDependencies: [],
    taskSections: [],
    templates: [],
    workflows: [],
    workflowVariants: [],
    workflowPhases: [],
    workflowVariantPhases: [],
    workflowPhaseTasks: [],
    workflowPatterns: [],
    workflowPatternTasks: [],
    workflowFragments: [],
    workflowFragmentTasks: [],
    workflowInstances: [],
    workflowInstanceTasks: [],
    scheduleEvents: [],
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
  if (!Array.isArray(next.users)) next.users = [];
  if (!Array.isArray(next.workspaceMemberships)) next.workspaceMemberships = [];
  if (!Array.isArray(next.taskDependencies)) next.taskDependencies = [];
  if (!Array.isArray(next.taskSections)) next.taskSections = [];
  if (!Array.isArray(next.templates)) next.templates = [];
  if (!Array.isArray(next.workflows)) next.workflows = [];
  if (!Array.isArray(next.workflowVariants)) next.workflowVariants = [];
  if (!Array.isArray(next.workflowPhases)) next.workflowPhases = [];
  if (!Array.isArray(next.workflowVariantPhases)) next.workflowVariantPhases = [];
  if (!Array.isArray(next.workflowPhaseTasks)) next.workflowPhaseTasks = [];
  if (!Array.isArray(next.workflowPatterns)) next.workflowPatterns = Array.isArray(next.workflowFragments) ? [...next.workflowFragments] : [];
  if (!Array.isArray(next.workflowPatternTasks)) next.workflowPatternTasks = Array.isArray(next.workflowFragmentTasks) ? [...next.workflowFragmentTasks] : [];
  if (!Array.isArray(next.workflowFragments)) next.workflowFragments = [];
  if (!Array.isArray(next.workflowFragmentTasks)) next.workflowFragmentTasks = [];
  if (!Array.isArray(next.workflowInstances)) next.workflowInstances = [];
  if (!Array.isArray(next.workflowInstanceTasks)) next.workflowInstanceTasks = [];
  if (!Array.isArray(next.scheduleEvents)) next.scheduleEvents = [];
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
  if (!Array.isArray(next.pendingChanges)) {
    next.pendingChanges = [];
  } else {
    next.pendingChanges = next.pendingChanges.map((change) => {
      const normalized = { ...(change ?? {}) };
      normalized.seq = Number.isFinite(normalized.seq) ? normalized.seq : 0;
      normalized.created_at = normalized.created_at ?? new Date().toISOString();
      normalized.client_mutation_id = String(normalized.client_mutation_id ?? '').trim() || createMutationId();
      normalized.ts = Number.isFinite(normalized.ts) ? normalized.ts : Date.now();
      normalized.retry_count = Number.isFinite(normalized.retry_count) ? normalized.retry_count : 0;
      normalized.next_retry_at = normalized.next_retry_at ?? null;
      normalized.needs_attention = Boolean(normalized.needs_attention);
      normalized.last_error = normalized.last_error ?? null;
      normalized.last_error_code = normalized.last_error_code ?? null;
      normalized.conflict = normalized.conflict ?? null;
      return normalized;
    });
  }
  if (!Array.isArray(next.auditLog)) next.auditLog = [];
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
  const mutationId = String(change?.client_mutation_id ?? '').trim() || createMutationId();
  const nowIso = new Date().toISOString();
  next.localSeq = seq;
  next.pendingChanges.push({
    seq,
    created_at: nowIso,
    client_mutation_id: mutationId,
    ts: Date.now(),
    retry_count: 0,
    next_retry_at: null,
    needs_attention: false,
    last_error: null,
    last_error_code: null,
    conflict: null,
    ...(change ?? {})
  });
  return next;
}

export function clearLocalChanges(data) {
  const next = normalizeData(data);
  next.pendingChanges = [];
  return next;
}
