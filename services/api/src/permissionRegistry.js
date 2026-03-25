const PERMISSION_REGISTRY = Object.freeze({
  'workspaces.read': {
    key: 'workspaces.read',
    domain: 'workspaces',
    label: 'Read workspaces',
    description: 'List and inspect accessible workspaces.'
  },
  'tasks.read': {
    key: 'tasks.read',
    domain: 'tasks',
    label: 'Read tasks',
    description: 'List and inspect tasks inside granted workspaces.'
  },
  'tasks.create': {
    key: 'tasks.create',
    domain: 'tasks',
    label: 'Create tasks',
    description: 'Create tasks inside granted workspaces.'
  },
  'tasks.update': {
    key: 'tasks.update',
    domain: 'tasks',
    label: 'Update tasks',
    description: 'Update non-destructive task state and relationships inside granted workspaces.'
  },
  'tasks.delete': {
    key: 'tasks.delete',
    domain: 'tasks',
    label: 'Delete tasks',
    description: 'Delete tasks or convert them into another resource when the task is removed.'
  },
  'projects.read': {
    key: 'projects.read',
    domain: 'projects',
    label: 'Read projects',
    description: 'List and inspect projects inside granted workspaces.'
  },
  'projects.create': {
    key: 'projects.create',
    domain: 'projects',
    label: 'Create projects',
    description: 'Create projects inside granted workspaces.'
  },
  'projects.update': {
    key: 'projects.update',
    domain: 'projects',
    label: 'Update projects',
    description: 'Update projects inside granted workspaces.'
  },
  'projects.delete': {
    key: 'projects.delete',
    domain: 'projects',
    label: 'Delete projects',
    description: 'Delete projects inside granted workspaces.'
  }
});

export const ALL_PERMISSION_KEYS = Object.freeze(Object.keys(PERMISSION_REGISTRY));
export const ROGER_V1_DEFAULT_PERMISSIONS = Object.freeze([
  'workspaces.read',
  'tasks.read',
  'tasks.create',
  'tasks.update',
  'projects.read'
]);

function unique(values = []) {
  return Array.from(new Set(values));
}

export function getPermissionRegistry() {
  return PERMISSION_REGISTRY;
}

export function isKnownPermissionKey(value) {
  return Object.prototype.hasOwnProperty.call(PERMISSION_REGISTRY, String(value ?? '').trim());
}

export function normalizePermissionKeys(values, { allowNull = false } = {}) {
  if (values === undefined) return undefined;
  if (values === null) {
    if (allowNull) return null;
    return [];
  }
  if (!Array.isArray(values)) {
    throw new Error('permissions must be an array');
  }
  const normalized = [];
  for (const value of values) {
    const key = String(value ?? '').trim();
    if (!key || !isKnownPermissionKey(key)) {
      throw new Error(`Unknown permission: ${key || '<empty>'}`);
    }
    normalized.push(key);
  }
  return unique(normalized);
}

export function intersectPermissionSets(...sets) {
  const normalizedSets = sets
    .filter((set) => set !== undefined && set !== null)
    .map((set) => normalizePermissionKeys(set));
  if (!normalizedSets.length) return [];
  return normalizedSets.reduce((result, current) => result.filter((key) => current.includes(key)));
}

export function hasPermission(permissionKeys, permissionKey) {
  const safePermissionKey = String(permissionKey ?? '').trim();
  if (!safePermissionKey) return true;
  return normalizePermissionKeys(permissionKeys ?? []).includes(safePermissionKey);
}
