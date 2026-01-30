const STORAGE_KEY = 'brianhub_ui_v1';

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function defaultState() {
  return {
    ui: {
      showArchived: false,
      notificationsEnabled: false,
      collapsedTasks: {},
      activeProjectId: null,
      activeWorkspaceId: null
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
  return next;
}

export function saveState(state) {
  const payload = { ui: state.ui };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
