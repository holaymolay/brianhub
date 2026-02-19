const STORAGE_KEY = 'brianhub_ui_v1';
let localIdCounter = 0;

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  localIdCounter += 1;
  return `id-${Date.now().toString(36)}-${localIdCounter.toString(36)}`;
}

function defaultState() {
  return {
    ui: {
      showArchived: false,
      notificationsEnabled: false,
      collapsedTasks: {},
      activeProjectId: null,
      activeWorkspaceId: null,
      activeShoppingListId: null,
      activeView: 'tasks',
      showArchivedShoppingLists: false,
      taskView: 'list',
      syncCursor: 0,
      checkinExtendMinutes: 60,
      selectedTaskIds: [],
      bulkUndoStack: [],
      taskGroupMode: 'none',
      completedTaskVisibility: 'show',
      futureTaskVisibilityDays: 0,
      calendarHiddenHolidayKeys: [],
      schedulingShowTasks: false,
      schedulingHiddenKinds: [],
      schedulingWeekMode: 'seven',
      forceAuthGate: false
    }
  };
}

export function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    return defaultState();
  }
}

function normalizeState(state) {
  const next = { ...defaultState(), ...state };
  if (!next.ui) next.ui = defaultState().ui;
  if (typeof next.ui.showArchived !== 'boolean') next.ui.showArchived = false;
  if (typeof next.ui.notificationsEnabled !== 'boolean') next.ui.notificationsEnabled = false;
  if (!next.ui.collapsedTasks || typeof next.ui.collapsedTasks !== 'object') {
    next.ui.collapsedTasks = {};
  }
  if (!('activeProjectId' in next.ui)) next.ui.activeProjectId = null;
  if (!('activeWorkspaceId' in next.ui)) next.ui.activeWorkspaceId = null;
  if (!('activeShoppingListId' in next.ui)) next.ui.activeShoppingListId = null;
  if (!('activeView' in next.ui)) next.ui.activeView = 'tasks';
  if (!('showArchivedShoppingLists' in next.ui)) next.ui.showArchivedShoppingLists = false;
  if (!('taskView' in next.ui)) next.ui.taskView = 'list';
  if (!('syncCursor' in next.ui)) next.ui.syncCursor = 0;
  if (!('checkinExtendMinutes' in next.ui)) next.ui.checkinExtendMinutes = 60;
  if (!Array.isArray(next.ui.selectedTaskIds)) next.ui.selectedTaskIds = [];
  if (!Array.isArray(next.ui.bulkUndoStack)) next.ui.bulkUndoStack = [];
  if (!('taskGroupMode' in next.ui)) next.ui.taskGroupMode = 'none';
  if (!['show', 'hide'].includes(next.ui.completedTaskVisibility)) next.ui.completedTaskVisibility = 'show';
  if (!Number.isFinite(Number(next.ui.futureTaskVisibilityDays)) || Number(next.ui.futureTaskVisibilityDays) < 0) {
    next.ui.futureTaskVisibilityDays = 0;
  } else {
    next.ui.futureTaskVisibilityDays = Math.floor(Number(next.ui.futureTaskVisibilityDays));
  }
  if (!Array.isArray(next.ui.calendarHiddenHolidayKeys)) {
    next.ui.calendarHiddenHolidayKeys = [];
  }
  if (typeof next.ui.schedulingShowTasks !== 'boolean') {
    next.ui.schedulingShowTasks = false;
  }
  if (!Array.isArray(next.ui.schedulingHiddenKinds)) {
    next.ui.schedulingHiddenKinds = [];
  }
  if (!['seven', 'workweek'].includes(next.ui.schedulingWeekMode)) {
    next.ui.schedulingWeekMode = 'seven';
  }
  if (typeof next.ui.forceAuthGate !== 'boolean') next.ui.forceAuthGate = false;
  if (next.ui.admin && typeof next.ui.admin === 'object') {
    // Admin console data is server-backed and should not survive reloads.
    next.ui.admin.invitesLoading = false;
    next.ui.admin.usersLoading = false;
    next.ui.admin.invites = [];
    next.ui.admin.users = [];
    next.ui.admin.invitesError = '';
    next.ui.admin.usersError = '';
    next.ui.admin.invitesLoaded = false;
    next.ui.admin.usersLoaded = false;
    next.ui.admin.invitesRequestedAt = 0;
    next.ui.admin.usersRequestedAt = 0;
    next.ui.admin.selectedUserId = '';
  }
  return next;
}

export function saveState(state) {
  const payload = { ui: state.ui };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
