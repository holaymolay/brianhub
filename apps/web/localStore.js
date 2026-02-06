const STORAGE_KEY = 'brianhub_ui_v1';

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const randomHex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${randomHex()}${randomHex()}-${randomHex()}-4${randomHex().slice(1)}-${((8 + Math.floor(Math.random() * 4)).toString(16))}${randomHex().slice(1)}-${randomHex()}${randomHex()}${randomHex()}`;
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
      taskGroupMode: 'none'
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
  return next;
}

export function saveState(state) {
  const payload = { ui: state.ui };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
