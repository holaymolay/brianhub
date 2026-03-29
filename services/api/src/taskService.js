import { randomUUID } from 'node:crypto';
import { applyCheckIn, applyWaitingFollowup, TaskStatus } from '../../../packages/core/taskState.js';
import { compareTasksByPriority } from '../../../packages/core/priority.js';
import { buildAdjacency } from '../../../packages/core/tree.js';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FALLBACK_DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_ORG_ID = UUID_V4_RE.test(String(process.env.BRIANHUB_ORG_ID ?? ''))
  ? process.env.BRIANHUB_ORG_ID
  : FALLBACK_DEFAULT_ORG_ID;

const DEFAULT_WAITING_DAYS = 3;
const DEFAULT_STATUSES = [
  { key: TaskStatus.INBOX, label: 'Inbox', kind: TaskStatus.INBOX, sort_order: 10, kanban_visible: 0 },
  { key: TaskStatus.PLANNED, label: 'Planned', kind: TaskStatus.PLANNED, sort_order: 20, kanban_visible: 0 },
  { key: TaskStatus.IN_PROGRESS, label: 'In Progress', kind: TaskStatus.IN_PROGRESS, sort_order: 30, kanban_visible: 0 },
  { key: TaskStatus.WAITING, label: 'Waiting', kind: TaskStatus.WAITING, sort_order: 40, kanban_visible: 0 },
  { key: TaskStatus.BLOCKED, label: 'Blocked', kind: TaskStatus.BLOCKED, sort_order: 50, kanban_visible: 0 },
  { key: TaskStatus.DONE, label: 'Done', kind: TaskStatus.DONE, sort_order: 60, kanban_visible: 0 },
  { key: TaskStatus.CANCELED, label: 'Canceled', kind: TaskStatus.CANCELED, sort_order: 70, kanban_visible: 0 }
];

const DEFAULT_TASK_TYPES = [
  { name: 'General', is_default: 1 },
  { name: 'Bill Due', is_default: 1 }
];
const DEFAULT_INVITE_EXPIRY_DAYS = Number(process.env.BRIANHUB_INVITE_EXPIRY_DAYS ?? 7);
const DEFAULT_NOTICE_TYPES = [
  { key: 'general', label: 'General' },
  { key: 'bill', label: 'Bill notice' },
  { key: 'auto-payment', label: 'Auto-payment notice' },
  { key: 'birthday', label: 'Birthday' },
  { key: 'holiday', label: 'Holiday' }
];
const NOTICE_RECURRENCE_UNITS = new Set(['day', 'week', 'month', 'year']);
const NOTICE_TYPE_BIRTHDAY = 'birthday';
const SHOPPING_ITEM_STATE_PENDING = 'pending';
const SHOPPING_ITEM_STATE_BOUGHT = 'bought';
const SHOPPING_ITEM_STATE_SUBSTITUTED = 'substituted';
const SHOPPING_ITEM_STATE_UNAVAILABLE = 'unavailable';
const SHOPPING_ITEM_STATES = new Set([
  SHOPPING_ITEM_STATE_PENDING,
  SHOPPING_ITEM_STATE_BOUGHT,
  SHOPPING_ITEM_STATE_SUBSTITUTED,
  SHOPPING_ITEM_STATE_UNAVAILABLE
]);
const AGENT_EVENT_STATUS_PENDING = 'pending';
const AGENT_EVENT_STATUS_HANDLED = 'handled';
const AGENT_EVENT_STATUS_IGNORED = 'ignored';
const AGENT_EVENT_STATUS_FAILED = 'failed';
const AGENT_EVENT_STATUSES = new Set([
  AGENT_EVENT_STATUS_PENDING,
  AGENT_EVENT_STATUS_HANDLED,
  AGENT_EVENT_STATUS_IGNORED,
  AGENT_EVENT_STATUS_FAILED
]);
const AGENT_EVENT_PRIORITY_DEFAULT = 'normal';
const AGENT_EVENT_LIST_DEFAULT_LIMIT = 100;
const AGENT_EVENT_LIST_MAX_LIMIT = 500;
const ADMIN_ACTION_STATUS_REQUESTED = 'requested';
const ADMIN_ACTION_STATUS_APPROVED = 'approved';
const ADMIN_ACTION_STATUS_REJECTED = 'rejected';
const ADMIN_ACTION_STATUS_EXECUTED = 'executed';
const ADMIN_ACTION_STATUS_FAILED = 'failed';
const ADMIN_ACTION_STATUS_CANCELED = 'canceled';
const ADMIN_ACTION_STATUSES = new Set([
  ADMIN_ACTION_STATUS_REQUESTED,
  ADMIN_ACTION_STATUS_APPROVED,
  ADMIN_ACTION_STATUS_REJECTED,
  ADMIN_ACTION_STATUS_EXECUTED,
  ADMIN_ACTION_STATUS_FAILED,
  ADMIN_ACTION_STATUS_CANCELED
]);
const ADMIN_ACTION_APPROVAL_MODE_EXPLICIT = 'explicit';
const ADMIN_ACTION_APPROVAL_MODE_AUTO = 'auto';
const ADMIN_ACTION_APPROVAL_MODES = new Set([
  ADMIN_ACTION_APPROVAL_MODE_EXPLICIT,
  ADMIN_ACTION_APPROVAL_MODE_AUTO
]);
const ADMIN_ACTION_LIST_DEFAULT_LIMIT = 100;
const ADMIN_ACTION_LIST_MAX_LIMIT = 500;

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days) {
  const safeDays = Number.isFinite(days) && days > 0 ? days : 7;
  return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeEmail(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return text || null;
}

function normalizeOptionalText(value, fieldName, maxLength = 512) {
  if (value === undefined) return undefined;
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return text;
}

function normalizeRequiredText(value, fieldName, maxLength = 512) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return text;
}

function normalizeRole(value) {
  const role = String(value ?? '').trim().toLowerCase();
  return role || 'member';
}

function normalizeWorkspaceRecordType(value) {
  const type = String(value ?? '').trim().toLowerCase();
  return type === 'shared' ? 'shared' : 'personal';
}

function normalizeWorkspaceOrganizationId(value) {
  return optionalUuid(value, 'organization_id');
}

function normalizeOrgRole(value) {
  const role = String(value ?? '').trim().toLowerCase();
  if (!role) return 'member';
  if (role === 'member' || role === 'admin') return role;
  throw new Error('Invalid org role');
}

function normalizeOrgMembershipRole(value, { allowOwner = true } = {}) {
  const role = String(value ?? '').trim().toLowerCase();
  if (!role) return 'member';
  if (role === 'member' || role === 'admin') return role;
  if (allowOwner && role === 'owner') return role;
  throw new Error('Invalid organization role');
}

function normalizeAssigneeLabel(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeDateOnly(value, fieldName = 'date') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return text;
}

function normalizeDateTime(value, fieldName = 'datetime') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const text = String(value).trim();
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeShoppingStoreName(value) {
  if (value === undefined) return undefined;
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeShoppingItemName(value, fieldName = 'shopping item name') {
  const text = String(value ?? '').trim();
  if (!text || text.length > 512) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return text;
}

function normalizeShoppingItemSubstituteName(value) {
  if (value === undefined) return undefined;
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > 512) {
    throw new Error('Invalid substitute_name');
  }
  return text;
}

function normalizeShoppingItemState(value, { allowUndefined = true } = {}) {
  if (value === undefined) {
    return allowUndefined ? undefined : SHOPPING_ITEM_STATE_PENDING;
  }
  const state = String(value ?? '').trim().toLowerCase();
  if (!state) return SHOPPING_ITEM_STATE_PENDING;
  if (!SHOPPING_ITEM_STATES.has(state)) {
    throw new Error('Invalid shopping item state');
  }
  return state;
}

function isCompletedShoppingItemState(state) {
  return normalizeShoppingItemState(state, { allowUndefined: false }) !== SHOPPING_ITEM_STATE_PENDING;
}

function normalizeShoppingItemKey(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return text || null;
}

function getShoppingListStoreKey(list) {
  const storeName = normalizeShoppingStoreName(list?.store_name);
  return storeName ? storeName.toLowerCase() : null;
}

function resolveShoppingItemOutcome(existing, patch = {}) {
  const currentState = normalizeShoppingItemState(existing?.item_state, { allowUndefined: false });
  let nextState = patch.item_state !== undefined
    ? normalizeShoppingItemState(patch.item_state, { allowUndefined: false })
    : currentState;
  let nextSubstituteName = patch.substitute_name !== undefined
    ? normalizeShoppingItemSubstituteName(patch.substitute_name)
    : (existing?.substitute_name ?? null);
  const hasExplicitState = patch.item_state !== undefined;
  const hasExplicitChecked = patch.is_checked !== undefined;
  const hasExplicitSubstituteName = patch.substitute_name !== undefined;

  if (!hasExplicitState) {
    if (hasExplicitChecked) {
      if (patch.is_checked) {
        if (nextSubstituteName) {
          nextState = SHOPPING_ITEM_STATE_SUBSTITUTED;
        } else if (currentState === SHOPPING_ITEM_STATE_SUBSTITUTED && existing?.substitute_name && !hasExplicitSubstituteName) {
          nextState = SHOPPING_ITEM_STATE_SUBSTITUTED;
        } else if (currentState === SHOPPING_ITEM_STATE_UNAVAILABLE && !hasExplicitSubstituteName) {
          nextState = SHOPPING_ITEM_STATE_UNAVAILABLE;
        } else {
          nextState = SHOPPING_ITEM_STATE_BOUGHT;
        }
      } else {
        nextState = SHOPPING_ITEM_STATE_PENDING;
        nextSubstituteName = null;
      }
    } else if (hasExplicitSubstituteName) {
      nextState = nextSubstituteName ? SHOPPING_ITEM_STATE_SUBSTITUTED : SHOPPING_ITEM_STATE_PENDING;
    }
  }

  if (nextState === SHOPPING_ITEM_STATE_PENDING) {
    nextSubstituteName = null;
  } else if (nextState === SHOPPING_ITEM_STATE_SUBSTITUTED) {
    if (!nextSubstituteName) {
      throw new Error('Substitute item name is required');
    }
  } else {
    nextSubstituteName = null;
  }

  return {
    item_state: nextState,
    substitute_name: nextSubstituteName,
    is_checked: isCompletedShoppingItemState(nextState) ? 1 : 0
  };
}

function normalizeSettingsObject(value) {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('settings must be an object');
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 200000) {
    throw new Error('settings payload too large');
  }
  return JSON.parse(serialized);
}

function normalizeAgentEventPayload(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('payload_json must be an object');
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 200000) {
    throw new Error('payload_json too large');
  }
  return JSON.parse(serialized);
}

function normalizeJsonObject(value, fieldName, { allowNull = false, defaultValue = {} } = {}) {
  if (value === undefined) return defaultValue;
  if (value === null) {
    if (allowNull) return null;
    return defaultValue;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 200000) {
    throw new Error(`${fieldName} too large`);
  }
  return JSON.parse(serialized);
}

function parseAgentEventPayload(payloadJson) {
  if (!payloadJson) return {};
  try {
    const parsed = JSON.parse(String(payloadJson));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function parseJsonObject(payloadJson, fallback = {}) {
  if (!payloadJson) return fallback;
  try {
    const parsed = JSON.parse(String(payloadJson));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function normalizeAgentEventStatus(value, { allowUndefined = true } = {}) {
  if (value === undefined) {
    return allowUndefined ? undefined : AGENT_EVENT_STATUS_PENDING;
  }
  const status = String(value ?? '').trim().toLowerCase();
  if (!status) return AGENT_EVENT_STATUS_PENDING;
  if (!AGENT_EVENT_STATUSES.has(status)) {
    throw new Error('Invalid agent event status');
  }
  return status;
}

function normalizeAgentEventPriority(value) {
  if (value === undefined || value === null || value === '') {
    return AGENT_EVENT_PRIORITY_DEFAULT;
  }
  return normalizeRequiredText(value, 'priority', 32).toLowerCase();
}

function normalizeAgentEventListLimit(value) {
  if (value === undefined || value === null || value === '') {
    return AGENT_EVENT_LIST_DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Invalid limit');
  }
  return Math.min(parsed, AGENT_EVENT_LIST_MAX_LIMIT);
}

function normalizeAdminActionStatus(value, { allowUndefined = true } = {}) {
  if (value === undefined) {
    return allowUndefined ? undefined : ADMIN_ACTION_STATUS_REQUESTED;
  }
  const status = String(value ?? '').trim().toLowerCase();
  if (!status) return ADMIN_ACTION_STATUS_REQUESTED;
  if (!ADMIN_ACTION_STATUSES.has(status)) {
    throw new Error('Invalid admin action status');
  }
  return status;
}

function normalizeAdminActionApprovalMode(value) {
  if (value === undefined || value === null || value === '') {
    return ADMIN_ACTION_APPROVAL_MODE_EXPLICIT;
  }
  const mode = String(value ?? '').trim().toLowerCase();
  if (!ADMIN_ACTION_APPROVAL_MODES.has(mode)) {
    throw new Error('Invalid admin action approval_mode');
  }
  return mode;
}

function normalizeAdminActionListLimit(value) {
  if (value === undefined || value === null || value === '') {
    return ADMIN_ACTION_LIST_DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Invalid limit');
  }
  return Math.min(parsed, ADMIN_ACTION_LIST_MAX_LIMIT);
}

function parseAgentEventRow(row) {
  if (!row) return null;
  return {
    ...row,
    payload_json: parseAgentEventPayload(row.payload_json)
  };
}

function parseAdminActionRow(row) {
  if (!row) return null;
  return {
    ...row,
    arguments_json: parseJsonObject(row.arguments_json, {}),
    result_json: row.result_json ? parseJsonObject(row.result_json, null) : null
  };
}

function encodeAgentEventCursor(event) {
  if (!event?.created_at || !event?.id) return null;
  return `${event.created_at}|${event.id}`;
}

function decodeAgentEventCursor(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const separatorIndex = text.lastIndexOf('|');
  if (separatorIndex <= 0 || separatorIndex >= text.length - 1) {
    throw new Error('Invalid cursor');
  }
  const createdAt = normalizeDateTime(text.slice(0, separatorIndex), 'cursor');
  const id = assertUuid(text.slice(separatorIndex + 1), 'cursor');
  return { created_at: createdAt, id };
}

function parseSettingsJson(settingsJson) {
  if (!settingsJson) return {};
  try {
    const parsed = JSON.parse(String(settingsJson));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function normalizeTaskTagsInput(value, fieldName = 'tags') {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  const seen = new Set();
  const tags = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error(`Invalid ${fieldName}`);
    }
    const tag = entry.trim();
    if (!tag) continue;
    if (tag.length > 64) {
      throw new Error(`Invalid ${fieldName}`);
    }
    const dedupeKey = tag.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    tags.push(tag);
  }
  return tags;
}

function assertUuid(value, fieldName = 'id') {
  if (!UUID_V4_RE.test(String(value ?? ''))) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return String(value);
}

function ensureUuid(value, fieldName = 'id') {
  if (value === undefined || value === null || value === '') return randomUUID();
  return assertUuid(value, fieldName);
}

function optionalUuid(value, fieldName = 'id') {
  if (value === undefined || value === null || value === '') return null;
  return assertUuid(value, fieldName);
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeNoticeRecurrence(intervalValue, unitValue) {
  const interval = Number(intervalValue);
  if (!Number.isFinite(interval) || interval <= 0) {
    return { interval: null, unit: null };
  }
  const unit = NOTICE_RECURRENCE_UNITS.has(unitValue) ? unitValue : 'month';
  return { interval, unit };
}

function normalizeNoticeRecurrenceRuleJson(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeNoticeOccurrenceCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function applyBirthdayNoticeDefaults(noticeType, notifyAt, recurrenceInterval, recurrenceUnit, recurrenceRuleJson) {
  const normalizedType = String(noticeType ?? '').trim().toLowerCase();
  if (normalizedType !== NOTICE_TYPE_BIRTHDAY) {
    return {
      recurrenceInterval,
      recurrenceUnit,
      recurrenceRuleJson
    };
  }
  const nextInterval = recurrenceInterval ?? 1;
  const nextUnit = recurrenceUnit ?? 'year';
  const nextRuleJson = recurrenceRuleJson ?? normalizeNoticeRecurrenceRuleJson({
    interval: 1,
    unit: 'year',
    weekdays: [],
    endType: 'never',
    endDate: null,
    endCount: null,
    anchorDate: notifyAt ?? null
  });
  return {
    recurrenceInterval: nextInterval,
    recurrenceUnit: nextUnit,
    recurrenceRuleJson: nextRuleJson
  };
}

function normalizeTemplateRow(row) {
  if (!row) return row;
  const { steps_json, ...rest } = row;
  let steps = [];
  if (steps_json) {
    try {
      steps = JSON.parse(steps_json);
    } catch {
      steps = [];
    }
  }
  return { ...rest, steps };
}

async function ensureOrg(db, orgId, name = 'Default') {
  const existing = await getRow(db, 'SELECT id FROM orgs WHERE id = ?', [orgId]);
  if (existing) return;
  const timestamp = nowIso();
  await run(
    db,
    'INSERT INTO orgs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [orgId, name, timestamp, timestamp]
  );
}

const ORG_DETAIL_COLUMNS = `
  o.id,
  o.name,
  o.owner_user_id,
  o.created_at,
  o.updated_at,
  owner.display_name AS owner_display_name,
  owner.email AS owner_email,
  CAST((
    SELECT COUNT(*)
      FROM org_memberships om_count
      JOIN users u_count ON u_count.id = om_count.user_id
     WHERE om_count.org_id = o.id
       AND om_count.archived = 0
       AND u_count.archived = 0
  ) AS INTEGER) AS member_count
`;

async function getOrgRow(db, id) {
  const safeOrgId = assertUuid(id, 'org_id');
  return getRow(
    db,
    `SELECT ${ORG_DETAIL_COLUMNS}
       FROM orgs o
       LEFT JOIN users owner ON owner.id = o.owner_user_id
      WHERE o.id = ?
      LIMIT 1`,
    [safeOrgId]
  );
}

async function getOrgSurfaceWorkspace(db, orgId) {
  const safeOrgId = assertUuid(orgId, 'org_id');
  return getRow(
    db,
    'SELECT * FROM workspaces WHERE organization_id = ? LIMIT 1',
    [safeOrgId]
  );
}

function mapOrgMembershipRoleToWorkspaceRole(role) {
  return normalizeOrgMembershipRole(role) === 'member' ? 'member' : 'manager';
}

async function listActiveOrgMembershipRows(db, orgId) {
  const safeOrgId = assertUuid(orgId, 'org_id');
  return getRows(
    db,
    `SELECT om.*
       FROM org_memberships om
       JOIN users u ON u.id = om.user_id
      WHERE om.org_id = ?
        AND om.archived = 0
        AND u.archived = 0
      ORDER BY om.created_at ASC, om.id ASC`,
    [safeOrgId]
  );
}

async function syncOrgSurfaceWorkspaceMemberships(db, orgId, surfaceWorkspace = null) {
  const safeOrgId = assertUuid(orgId, 'org_id');
  const workspace = surfaceWorkspace ?? await getOrgSurfaceWorkspace(db, safeOrgId);
  if (!workspace?.id) return null;
  const memberships = await listActiveOrgMembershipRows(db, safeOrgId);
  const targetByUserId = new Map(
    memberships.map((membership) => [
      membership.user_id,
      mapOrgMembershipRoleToWorkspaceRole(membership.role)
    ])
  );
  const existing = await getRows(
    db,
    'SELECT * FROM workspace_memberships WHERE workspace_id = ?',
    [workspace.id]
  );
  for (const [userId, role] of targetByUserId.entries()) {
    const current = existing.find((membership) => membership.user_id === userId) ?? null;
    if (!current || Number(current.archived) || current.role !== role) {
      await createWorkspaceMembership(
        db,
        {
          workspace_id: workspace.id,
          user_id: userId,
          role,
          archived: 0
        },
        null
      );
    }
  }
  for (const membership of existing) {
    if (!targetByUserId.has(membership.user_id) && !Number(membership.archived)) {
      await updateWorkspaceMembership(
        db,
        membership.id,
        { archived: true },
        null
      );
    }
  }
  return getOrgSurfaceWorkspace(db, safeOrgId);
}

async function ensureOrgSurfaceWorkspace(db, orgId) {
  const safeOrgId = assertUuid(orgId, 'org_id');
  const org = await getOrgRow(db, safeOrgId);
  if (!org) return null;
  let surface = await getOrgSurfaceWorkspace(db, safeOrgId);
  if (!surface) {
    const ownerUser = org.owner_user_id ? await getUserById(db, org.owner_user_id) : null;
    const workspaceOrgId = ownerUser?.org_id ?? DEFAULT_ORG_ID;
    surface = await createWorkspace(
      db,
      {
        name: org.name,
        type: 'shared',
        org_id: workspaceOrgId,
        creator_user_id: org.owner_user_id ?? null,
        organization_id: safeOrgId
      },
      null
    );
  }
  if (surface.name !== org.name || Number(surface.archived)) {
    await run(
      db,
      'UPDATE workspaces SET name = ?, archived = 0, updated_at = ? WHERE id = ?',
      [org.name, nowIso(), surface.id]
    );
    surface = await getOrgSurfaceWorkspace(db, safeOrgId);
  }
  return syncOrgSurfaceWorkspaceMemberships(db, safeOrgId, surface);
}

async function attachOrgSurfaceWorkspace(db, org) {
  if (!org?.id) return null;
  const surface = await ensureOrgSurfaceWorkspace(db, org.id);
  return {
    ...org,
    surface_workspace_id: surface?.id ?? null,
    surface_workspace_name: surface?.name ?? null,
    surface_workspace_type: surface?.type ?? null,
    surface_workspace_org_id: surface?.org_id ?? null
  };
}

async function getOrgMembershipRow(db, orgId, userId, { includeArchived = false } = {}) {
  const safeOrgId = assertUuid(orgId, 'org_id');
  const safeUserId = assertUuid(userId, 'user_id');
  const archivedClause = includeArchived ? '' : ' AND archived = 0';
  return getRow(
    db,
    `SELECT *
       FROM org_memberships
      WHERE org_id = ? AND user_id = ?${archivedClause}
      LIMIT 1`,
    [safeOrgId, safeUserId]
  );
}

async function ensureOrgMembership(db, orgId, userId, role = 'member') {
  const safeOrgId = assertUuid(orgId, 'org_id');
  const safeUserId = assertUuid(userId, 'user_id');
  const safeRole = normalizeOrgMembershipRole(role);
  const existing = await getOrgMembershipRow(db, safeOrgId, safeUserId, { includeArchived: true });
  const timestamp = nowIso();
  if (existing) {
    const nextRole = safeRole === 'owner' || existing.role !== 'owner'
      ? safeRole
      : existing.role;
    await run(
      db,
      'UPDATE org_memberships SET role = ?, archived = 0, updated_at = ? WHERE id = ?',
      [nextRole, timestamp, existing.id]
    );
    return getOrgMembershipRow(db, safeOrgId, safeUserId);
  }
  const membership = {
    id: randomUUID(),
    org_id: safeOrgId,
    user_id: safeUserId,
    role: safeRole,
    archived: 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  await run(
    db,
    `INSERT INTO org_memberships
      (id, org_id, user_id, role, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      membership.id,
      membership.org_id,
      membership.user_id,
      membership.role,
      membership.archived,
      membership.created_at,
      membership.updated_at
    ]
  );
  return membership;
}

async function run(db, sql, params = []) {
  await db.exec(sql, params);
}

async function getRow(db, sql, params = []) {
  return db.queryOne(sql, params);
}

async function getRows(db, sql, params = []) {
  return db.query(sql, params);
}

async function resolveTagId(db, workspaceId, name) {
  const existing = await getRow(
    db,
    'SELECT id FROM tags WHERE workspace_id = ? AND lower(name) = lower(?) ORDER BY name LIMIT 1',
    [workspaceId, name]
  );
  if (existing?.id) return existing.id;
  const id = randomUUID();
  await run(
    db,
    'INSERT INTO tags (id, workspace_id, name) VALUES (?, ?, ?)',
    [id, workspaceId, name]
  );
  return id;
}

async function replaceTaskTags(db, taskId, workspaceId, tags = []) {
  const safeTaskId = assertUuid(taskId, 'task_id');
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  const normalized = normalizeTaskTagsInput(tags) ?? [];
  await run(db, 'DELETE FROM task_tags WHERE task_id = ?', [safeTaskId]);
  if (!normalized.length) return;
  for (const tagName of normalized) {
    const tagId = await resolveTagId(db, safeWorkspaceId, tagName);
    await run(
      db,
      'INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)',
      [safeTaskId, tagId]
    );
  }
}

async function attachTagsToTasks(db, tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  if (tasks.every(task => Array.isArray(task?.tags))) {
    return tasks.map(task => ({ ...task, tags: normalizeTaskTagsInput(task.tags) ?? [] }));
  }
  const ids = tasks.map((task) => task?.id).filter((id) => UUID_V4_RE.test(String(id ?? '')));
  if (!ids.length) {
    return tasks.map((task) => ({ ...task, tags: [] }));
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await getRows(
    db,
    `SELECT tt.task_id, t.name
       FROM task_tags tt
       JOIN tags t ON t.id = tt.tag_id
      WHERE tt.task_id IN (${placeholders})
      ORDER BY t.name COLLATE NOCASE`,
    ids
  );
  const tagsByTaskId = new Map();
  for (const row of rows) {
    const list = tagsByTaskId.get(row.task_id) ?? [];
    list.push(row.name);
    tagsByTaskId.set(row.task_id, list);
  }
  return tasks.map((task) => ({
    ...task,
    tags: tagsByTaskId.get(task.id) ?? []
  }));
}

async function attachTagsToTask(db, task) {
  if (!task) return null;
  const [tagged] = await attachTagsToTasks(db, [task]);
  return tagged ?? { ...task, tags: [] };
}

async function getWorkspaceRow(db, workspaceId) {
  const id = assertUuid(workspaceId, 'workspace_id');
  const row = await getRow(db, 'SELECT id, org_id, type, owner_user_id, archived FROM workspaces WHERE id = ?', [id]);
  if (!row) throw new Error('Workspace not found');
  return row;
}

async function assertWorkspaceExists(db, workspaceId) {
  const row = await getWorkspaceRow(db, workspaceId);
  return row.id;
}

async function assertTaskBelongsToWorkspace(db, taskId, workspaceId, fieldName = 'task_id') {
  const id = assertUuid(taskId, fieldName);
  const task = await getRow(db, 'SELECT id, workspace_id FROM tasks WHERE id = ?', [id]);
  if (!task) throw new Error('Task not found');
  if (task.workspace_id !== workspaceId) {
    throw new Error(`${fieldName} must belong to the same workspace`);
  }
  return id;
}

async function assertProjectBelongsToWorkspace(db, projectId, workspaceId, fieldName = 'project_id') {
  const id = assertUuid(projectId, fieldName);
  const project = await getRow(db, 'SELECT id, workspace_id FROM projects WHERE id = ?', [id]);
  if (!project) throw new Error('Project not found');
  if (project.workspace_id !== workspaceId) {
    throw new Error(`${fieldName} must belong to the same workspace`);
  }
  return id;
}

async function assertTemplateBelongsToWorkspace(db, templateId, workspaceId, fieldName = 'template_id') {
  const id = assertUuid(templateId, fieldName);
  const template = await getRow(db, 'SELECT id, workspace_id FROM templates WHERE id = ?', [id]);
  if (!template) throw new Error('Template not found');
  if (template.workspace_id !== workspaceId) {
    throw new Error(`${fieldName} must belong to the same workspace`);
  }
  return id;
}

async function getUserById(db, userId) {
  const id = assertUuid(userId, 'user_id');
  return getRow(db, 'SELECT * FROM users WHERE id = ?', [id]);
}

async function assertUserAssignableToWorkspace(db, userId, workspaceId) {
  const safeUserId = assertUuid(userId, 'assignee_user_id');
  const workspace = await getWorkspaceRow(db, workspaceId);
  const user = await getUserById(db, safeUserId);
  if (!user || Number(user.archived)) {
    throw new Error('Assignee user not found');
  }
  if (user.org_id !== workspace.org_id) {
    throw new Error('Assignee user must belong to the same organization');
  }
  const membership = await getRow(
    db,
    'SELECT id FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? AND archived = 0',
    [workspace.id, safeUserId]
  );
  if (!membership) {
    throw new Error('Assignee user must be a member of this workspace');
  }
  return safeUserId;
}

async function normalizeTaskAssignee(db, workspaceId, assigneeUserId, assigneeLabel) {
  const safeUserId = optionalUuid(assigneeUserId, 'assignee_user_id');
  if (safeUserId) {
    await assertUserAssignableToWorkspace(db, safeUserId, workspaceId);
    return {
      assignee_user_id: safeUserId,
      assignee_label: null
    };
  }
  return {
    assignee_user_id: null,
    assignee_label: normalizeAssigneeLabel(assigneeLabel)
  };
}

export async function recordChange(db, workspaceId, entityType, entityId, action, payload, clientId = null) {
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  await run(
    db,
    'INSERT INTO change_log (workspace_id, entity_type, entity_id, action, payload, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [safeWorkspaceId, entityType, entityId, action, JSON.stringify(payload ?? {}), clientId, nowIso()]
  );
}

export async function getWorkspace(db, id, orgId = null) {
  const workspaceId = assertUuid(id, 'workspace id');
  if (orgId) {
    const safeOrgId = assertUuid(orgId, 'org_id');
    return getRow(db, 'SELECT * FROM workspaces WHERE id = ? AND org_id = ?', [workspaceId, safeOrgId]);
  }
  return getRow(db, 'SELECT * FROM workspaces WHERE id = ?', [workspaceId]);
}

export async function createWorkspace(
  db,
  {
    id: providedId,
    name,
    type,
    org_id: orgId = DEFAULT_ORG_ID,
    org_name,
    creator_user_id: creatorUserId = null,
    organization_id: organizationId = null
  },
  clientId = null
) {
  const safeOrgId = assertUuid(orgId ?? DEFAULT_ORG_ID, 'org_id');
  const safeCreatorUserId = optionalUuid(creatorUserId, 'creator_user_id');
  const safeOrganizationId = normalizeWorkspaceOrganizationId(organizationId);
  if (providedId) {
    const existing = await getWorkspace(db, assertUuid(providedId, 'workspace id'), safeOrgId);
    if (existing) return existing;
  }
  const id = ensureUuid(providedId, 'workspace id');
  const timestamp = nowIso();
  const normalizedType = normalizeWorkspaceRecordType(type);
  let creatorUser = null;
  if (safeCreatorUserId) {
    creatorUser = await getUserById(db, safeCreatorUserId);
    if (!creatorUser || Number(creatorUser.archived)) {
      throw new Error('creator_user_id not found');
    }
    if (creatorUser.org_id !== safeOrgId) {
      throw new Error('creator_user_id must belong to the same organization');
    }
  }
  if (safeOrganizationId) {
    const org = await getOrgRow(db, safeOrganizationId);
    if (!org) {
      throw new Error('organization_id not found');
    }
  }
  await db.transaction(async (tx) => {
    await ensureOrg(tx, safeOrgId, org_name ?? (safeOrgId === DEFAULT_ORG_ID ? 'Default' : safeOrgId));
    await run(
      tx,
      'INSERT INTO workspaces (id, org_id, organization_id, owner_user_id, name, type, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, safeOrgId, safeOrganizationId, normalizedType === 'personal' ? safeCreatorUserId : null, name, type, 0, timestamp, timestamp]
    );
    await seedWorkspaceStatuses(tx, id);
    await seedWorkspaceTaskTypes(tx, id);
    await seedWorkspaceNoticeTypes(tx, id);
    if (creatorUser) {
      await createWorkspaceMembership(
        tx,
        {
          workspace_id: id,
          user_id: creatorUser.id,
          role: normalizedType === 'shared' ? 'manager' : 'member'
        },
        clientId
      );
    }
  });
  return getWorkspace(db, id, safeOrgId);
}

export async function listWorkspaces(db, orgId = DEFAULT_ORG_ID) {
  const safeOrgId = assertUuid(orgId ?? DEFAULT_ORG_ID, 'org_id');
  return getRows(db, 'SELECT * FROM workspaces WHERE org_id = ?', [safeOrgId]);
}

export async function getOrg(db, id) {
  const org = await getOrgRow(db, id);
  return attachOrgSurfaceWorkspace(db, org);
}

export async function listOrgs(db, { userId = null } = {}) {
  const safeUserId = optionalUuid(userId, 'user_id');
  if (!safeUserId) {
    const rows = await getRows(
      db,
      `SELECT ${ORG_DETAIL_COLUMNS}
         FROM orgs o
         LEFT JOIN users owner ON owner.id = o.owner_user_id
        ORDER BY lower(o.name) ASC`
    );
    return Promise.all(rows.map((row) => attachOrgSurfaceWorkspace(db, row)));
  }
  const rows = await getRows(
    db,
    `SELECT ${ORG_DETAIL_COLUMNS},
       om.role AS current_user_role
      FROM orgs o
      LEFT JOIN users owner ON owner.id = o.owner_user_id
      JOIN org_memberships om ON om.org_id = o.id
     WHERE om.user_id = ?
       AND om.archived = 0
     ORDER BY lower(o.name) ASC`,
    [safeUserId]
  );
  return Promise.all(rows.map((row) => attachOrgSurfaceWorkspace(db, row)));
}

export async function createOrg(db, data, clientId = null) {
  const id = ensureUuid(data?.id, 'org id');
  const existing = await getOrgRow(db, id);
  if (existing) return existing;
  const name = normalizeRequiredText(data?.name, 'name', 256);
  const ownerUserId = assertUuid(data?.owner_user_id, 'owner_user_id');
  const ownerUser = await getRow(db, 'SELECT id FROM users WHERE id = ? AND archived = 0 LIMIT 1', [ownerUserId]);
  if (!ownerUser) {
    throw new Error('owner_user_id not found');
  }
  const timestamp = nowIso();
  await db.transaction(async (tx) => {
    await run(
      tx,
      'INSERT INTO orgs (id, name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, name, ownerUserId, timestamp, timestamp]
    );
    await ensureOrgMembership(tx, id, ownerUserId, 'owner');
  });
  await ensureOrgSurfaceWorkspace(db, id);
  if (clientId) {
    // Org records are global, so only log when a workspace context is supplied by caller.
    const workspaceId = optionalUuid(data?.workspace_id, 'workspace_id');
    if (workspaceId) {
      await recordChange(db, workspaceId, 'org', id, 'create', { id, name, owner_user_id: ownerUserId }, clientId);
    }
  }
  return getOrg(db, id);
}

export async function updateOrg(db, id, patch, clientId = null) {
  const safeOrgId = assertUuid(id, 'org_id');
  const existing = await getOrgRow(db, safeOrgId);
  if (!existing) return null;
  const nextName = patch?.name !== undefined
    ? normalizeRequiredText(patch.name, 'name', 256)
    : existing.name;
  const updatedAt = nowIso();
  await run(
    db,
    'UPDATE orgs SET name = ?, updated_at = ? WHERE id = ?',
    [nextName, updatedAt, safeOrgId]
  );
  if (clientId) {
    const workspaceId = optionalUuid(patch?.workspace_id, 'workspace_id');
    if (workspaceId) {
      await recordChange(db, workspaceId, 'org', safeOrgId, 'update', { name: nextName }, clientId);
    }
  }
  await ensureOrgSurfaceWorkspace(db, safeOrgId);
  return getOrg(db, safeOrgId);
}

export async function getOrgMembership(db, orgId, userId) {
  return getOrgMembershipRow(db, orgId, userId);
}

export async function listOrgMembers(db, orgId, { includeArchived = false } = {}) {
  const safeOrgId = assertUuid(orgId, 'org_id');
  const where = ['om.org_id = ?'];
  const params = [safeOrgId];
  if (!includeArchived) {
    where.push('om.archived = 0');
    where.push('u.archived = 0');
  }
  return getRows(
    db,
    `SELECT
       om.id AS membership_id,
       om.org_id,
       om.user_id,
       om.role,
       om.archived,
       om.created_at,
       om.updated_at,
       u.display_name,
       u.email,
       u.archived AS user_archived
     FROM org_memberships om
     JOIN users u ON u.id = om.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE om.role
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        ELSE 2
      END,
      lower(u.display_name) ASC,
      lower(COALESCE(u.email, '')) ASC`,
    params
  );
}

export async function addOrgMember(db, orgId, data = {}) {
  const safeOrgId = assertUuid(orgId, 'org_id');
  const org = await getOrgRow(db, safeOrgId);
  if (!org) {
    throw new Error('organization not found');
  }
  const role = normalizeOrgMembershipRole(data?.role, { allowOwner: false });
  const explicitUserId = optionalUuid(data?.user_id, 'user_id');
  const email = normalizeEmail(data?.email);
  let user = null;
  if (explicitUserId) {
    user = await getRow(db, 'SELECT * FROM users WHERE id = ? LIMIT 1', [explicitUserId]);
  } else if (email) {
    user = await getUserByEmail(db, email);
  }
  if (!user?.id) {
    throw new Error('user not found');
  }
  await ensureOrgMembership(db, safeOrgId, user.id, role);
  await ensureOrgSurfaceWorkspace(db, safeOrgId);
  return getRow(
    db,
    `SELECT
       om.id AS membership_id,
       om.org_id,
       om.user_id,
       om.role,
       om.archived,
       om.created_at,
       om.updated_at,
       u.display_name,
       u.email,
       u.archived AS user_archived
     FROM org_memberships om
     JOIN users u ON u.id = om.user_id
    WHERE om.org_id = ? AND om.user_id = ?
    LIMIT 1`,
    [safeOrgId, user.id]
  );
}

export async function updateOrgMember(db, orgId, userId, patch = {}) {
  const safeOrgId = assertUuid(orgId, 'org_id');
  const safeUserId = assertUuid(userId, 'user_id');
  const existing = await getOrgMembershipRow(db, safeOrgId, safeUserId);
  if (!existing) return null;
  if (existing.role === 'owner' && patch?.role !== undefined) {
    throw new Error('use ownership transfer to change the owner');
  }
  const nextRole = patch?.role !== undefined
    ? normalizeOrgMembershipRole(patch.role, { allowOwner: false })
    : existing.role;
  const nextArchived = patch?.archived !== undefined ? (patch.archived ? 1 : 0) : Number(existing.archived) ? 1 : 0;
  await run(
    db,
    'UPDATE org_memberships SET role = ?, archived = ?, updated_at = ? WHERE id = ?',
    [nextRole, nextArchived, nowIso(), existing.id]
  );
  await ensureOrgSurfaceWorkspace(db, safeOrgId);
  return getRow(
    db,
    `SELECT
       om.id AS membership_id,
       om.org_id,
       om.user_id,
       om.role,
       om.archived,
       om.created_at,
       om.updated_at,
       u.display_name,
       u.email,
       u.archived AS user_archived
     FROM org_memberships om
     JOIN users u ON u.id = om.user_id
    WHERE om.org_id = ? AND om.user_id = ?
    LIMIT 1`,
    [safeOrgId, safeUserId]
  );
}

export async function removeOrgMember(db, orgId, userId) {
  const safeOrgId = assertUuid(orgId, 'org_id');
  const safeUserId = assertUuid(userId, 'user_id');
  const existing = await getOrgMembershipRow(db, safeOrgId, safeUserId);
  if (!existing) return null;
  if (existing.role === 'owner') {
    throw new Error('transfer ownership before removing the owner');
  }
  await run(
    db,
    'UPDATE org_memberships SET archived = 1, updated_at = ? WHERE id = ?',
    [nowIso(), existing.id]
  );
  await ensureOrgSurfaceWorkspace(db, safeOrgId);
  return true;
}

export async function transferOrgOwnership(db, orgId, targetUserId) {
  const safeOrgId = assertUuid(orgId, 'org_id');
  const safeTargetUserId = assertUuid(targetUserId, 'target_user_id');
  const org = await getOrgRow(db, safeOrgId);
  if (!org) return null;
  const targetMembership = await getOrgMembershipRow(db, safeOrgId, safeTargetUserId);
  if (!targetMembership) {
    throw new Error('target user must be an active organization member');
  }
  await db.transaction(async (tx) => {
    const timestamp = nowIso();
    if (org.owner_user_id && org.owner_user_id !== safeTargetUserId) {
      const previousOwnerMembership = await getOrgMembershipRow(tx, safeOrgId, org.owner_user_id, { includeArchived: true });
      if (previousOwnerMembership) {
        await run(
          tx,
          'UPDATE org_memberships SET role = ?, archived = 0, updated_at = ? WHERE id = ?',
          ['admin', timestamp, previousOwnerMembership.id]
        );
      }
    }
    await ensureOrgMembership(tx, safeOrgId, safeTargetUserId, 'owner');
    await run(
      tx,
      'UPDATE orgs SET owner_user_id = ?, updated_at = ? WHERE id = ?',
      [safeTargetUserId, timestamp, safeOrgId]
    );
  });
  await ensureOrgSurfaceWorkspace(db, safeOrgId);
  return getOrg(db, safeOrgId);
}

export async function listUsers(db, orgId, workspaceId = null) {
  let safeOrgId = orgId ? assertUuid(orgId, 'org_id') : null;
  const safeWorkspaceId = optionalUuid(workspaceId, 'workspace_id');
  if (safeWorkspaceId) {
    const workspace = await getWorkspaceRow(db, safeWorkspaceId);
    if (safeOrgId && workspace.org_id !== safeOrgId) {
      throw new Error('workspace_id does not belong to org_id');
    }
    safeOrgId = safeOrgId ?? workspace.org_id;
    return getRows(
      db,
      `SELECT u.*
         FROM users u
         JOIN workspace_memberships wm ON wm.user_id = u.id
        WHERE u.org_id = ? AND wm.workspace_id = ? AND wm.archived = 0
        ORDER BY u.display_name ASC`,
      [safeOrgId, safeWorkspaceId]
    );
  }
  if (!safeOrgId) {
    throw new Error('org_id required');
  }
  return getRows(
    db,
    `SELECT u.*
       FROM users u
       JOIN org_memberships om ON om.user_id = u.id
      WHERE om.org_id = ?
        AND om.archived = 0
      ORDER BY u.display_name ASC`,
    [safeOrgId]
  );
}

export async function createUser(db, data, clientId = null) {
  const orgId = assertUuid(data?.org_id ?? DEFAULT_ORG_ID, 'org_id');
  const providedId = optionalUuid(data?.id, 'user id');
  const email = normalizeEmail(data?.email);
  const displayName = String(data?.display_name ?? data?.name ?? '').trim();
  if (!displayName) {
    throw new Error('display_name required');
  }
  await ensureOrg(db, orgId);
  if (providedId) {
    const existing = await getRow(db, 'SELECT * FROM users WHERE id = ?', [providedId]);
    if (existing) return existing;
  }
  if (email) {
    const byEmail = await getRow(db, 'SELECT * FROM users WHERE org_id = ? AND email = ?', [orgId, email]);
    if (byEmail) return byEmail;
  }
  const id = providedId ?? randomUUID();
  const timestamp = nowIso();
  const user = {
    id,
    org_id: orgId,
    display_name: displayName,
    email,
    org_role: normalizeOrgRole(data?.org_role),
    archived: data?.archived ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  await run(
    db,
    `INSERT INTO users
      (id, org_id, display_name, email, org_role, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.org_id,
      user.display_name,
      user.email,
      user.org_role,
      user.archived,
      user.created_at,
      user.updated_at
    ]
  );
  await ensureOrgMembership(db, user.org_id, user.id, user.org_role);
  const workspaceId = optionalUuid(data?.workspace_id, 'workspace_id');
  if (workspaceId) {
    await recordChange(db, workspaceId, 'user', user.id, 'create', user, clientId);
  }
  return user;
}

export async function updateUser(db, id, patch, clientId = null) {
  const userId = assertUuid(id, 'user id');
  const existing = await getRow(db, 'SELECT * FROM users WHERE id = ?', [userId]);
  if (!existing) return null;
  const next = {
    ...existing,
    display_name: patch.display_name !== undefined ? String(patch.display_name).trim() || existing.display_name : existing.display_name,
    email: patch.email !== undefined ? normalizeEmail(patch.email) : existing.email,
    org_role: patch.org_role !== undefined ? normalizeOrgRole(patch.org_role) : normalizeOrgRole(existing.org_role),
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : Number(existing.archived) ? 1 : 0,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE users SET display_name = ?, email = ?, org_role = ?, archived = ?, updated_at = ? WHERE id = ?',
    [next.display_name, next.email, next.org_role, next.archived, next.updated_at, userId]
  );
  await ensureOrgMembership(db, existing.org_id, userId, next.org_role);
  if (next.archived) {
    await run(
      db,
      'UPDATE org_memberships SET archived = 1, updated_at = ? WHERE org_id = ? AND user_id = ?',
      [next.updated_at, existing.org_id, userId]
    );
  } else {
    await run(
      db,
      'UPDATE org_memberships SET archived = 0, updated_at = ? WHERE org_id = ? AND user_id = ?',
      [next.updated_at, existing.org_id, userId]
    );
  }
  const workspaceId = optionalUuid(patch.workspace_id, 'workspace_id');
  if (workspaceId) {
    await recordChange(db, workspaceId, 'user', userId, 'update', patch, clientId);
  }
  return getRow(db, 'SELECT * FROM users WHERE id = ?', [userId]);
}

export async function getUserByEmail(db, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return getRow(
    db,
    `SELECT *
       FROM users
      WHERE email = ?
      ORDER BY archived ASC, created_at ASC
      LIMIT 1`,
    [normalized]
  );
}

export async function getUserSettings(db, userId) {
  const id = assertUuid(userId, 'user id');
  const existingUser = await getRow(db, 'SELECT id FROM users WHERE id = ?', [id]);
  if (!existingUser) {
    throw new Error('User not found');
  }
  const row = await getRow(db, 'SELECT settings_json FROM user_settings WHERE user_id = ?', [id]);
  return parseSettingsJson(row?.settings_json ?? null);
}

export async function upsertUserSettings(db, userId, settings, { merge = false } = {}) {
  const id = assertUuid(userId, 'user id');
  const existingUser = await getRow(db, 'SELECT id FROM users WHERE id = ?', [id]);
  if (!existingUser) {
    throw new Error('User not found');
  }
  const normalizedPatch = normalizeSettingsObject(settings);
  const existing = await getRow(db, 'SELECT settings_json FROM user_settings WHERE user_id = ?', [id]);
  const existingSettings = parseSettingsJson(existing?.settings_json ?? null);
  const nextSettings = merge ? { ...existingSettings, ...normalizedPatch } : normalizedPatch;
  const timestamp = nowIso();
  const serialized = JSON.stringify(nextSettings);
  if (existing) {
    await run(
      db,
      'UPDATE user_settings SET settings_json = ?, updated_at = ? WHERE user_id = ?',
      [serialized, timestamp, id]
    );
  } else {
    await run(
      db,
      `INSERT INTO user_settings (user_id, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [id, serialized, timestamp, timestamp]
    );
  }
  return nextSettings;
}

export async function listUsersForAdmin(
  db,
  {
    org_id: orgId = null,
    workspace_id: workspaceId = null,
    include_archived: includeArchived = true
  } = {}
) {
  const users = await listUsers(db, orgId, workspaceId);
  const filtered = includeArchived
    ? users
    : users.filter((user) => !Number(user.archived));
  if (!filtered.length) return [];
  const userIds = filtered.map((user) => user.id);
  const placeholders = userIds.map(() => '?').join(', ');
  const settingRows = await getRows(
    db,
    `SELECT user_id, settings_json
       FROM user_settings
      WHERE user_id IN (${placeholders})`,
    userIds
  );
  const settingsByUserId = new Map(
    settingRows.map((row) => [row.user_id, parseSettingsJson(row.settings_json)])
  );
  return filtered.map((user) => ({
    ...user,
    org_role: normalizeOrgRole(user.org_role),
    settings: settingsByUserId.get(user.id) ?? {}
  }));
}

export async function deleteUserAccount(db, userId, clientId = null) {
  const id = assertUuid(userId, 'user id');
  const existing = await getRow(db, 'SELECT * FROM users WHERE id = ?', [id]);
  if (!existing) return { deleted: 0 };
  const workspaceForChange = await getRow(
    db,
    `SELECT workspace_id
       FROM workspace_memberships
      WHERE user_id = ?
      ORDER BY created_at ASC
      LIMIT 1`,
    [id]
  );
  await db.transaction(async (tx) => {
    await run(
      tx,
      'UPDATE tasks SET assignee_label = COALESCE(assignee_label, ?), assignee_user_id = NULL WHERE assignee_user_id = ?',
      [existing.display_name, id]
    );
    await run(tx, 'DELETE FROM users WHERE id = ?', [id]);
  });
  if (clientId) {
    // User deletions can span many workspaces; emit a lightweight org-scoped change entry where possible.
    if (workspaceForChange?.workspace_id) {
      await recordChange(db, workspaceForChange.workspace_id, 'user', id, 'delete', {}, clientId);
    }
  }
  return { deleted: 1, user: existing };
}

export async function exportUserDataBundle(db, userId) {
  const id = assertUuid(userId, 'user id');
  const user = await getRow(db, 'SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return null;
  const settings = await getUserSettings(db, id);
  const memberships = await getRows(db, 'SELECT * FROM workspace_memberships WHERE user_id = ?', [id]);
  const workspaceIds = memberships.map((membership) => membership.workspace_id);
  let workspaces = [];
  if (workspaceIds.length) {
    const placeholders = workspaceIds.map(() => '?').join(', ');
    workspaces = await getRows(
      db,
      `SELECT *
         FROM workspaces
        WHERE id IN (${placeholders})`,
      workspaceIds
    );
  }
  const assignedTasks = await getRows(db, 'SELECT * FROM tasks WHERE assignee_user_id = ?', [id]);
  const sessions = await getRows(
    db,
    `SELECT id, created_at, updated_at, expires_at, revoked_at, ip_address, user_agent
       FROM auth_sessions
      WHERE user_id = ?`,
    [id]
  );
  const invites = user.email
    ? await getRows(
      db,
      `SELECT id, workspace_id, email, role, status, invited_by_email, expires_at, accepted_at, created_at, updated_at
         FROM user_invites
        WHERE email = ? OR invited_by_email = ?`,
      [user.email, user.email]
    )
    : [];
  return {
    exported_at: nowIso(),
    user,
    settings,
    memberships,
    workspaces,
    assigned_tasks: assignedTasks,
    sessions,
    invites
  };
}

async function getInviteById(db, inviteId) {
  const id = assertUuid(inviteId, 'invite id');
  return getRow(db, 'SELECT * FROM user_invites WHERE id = ?', [id]);
}

async function getPendingInviteByWorkspaceEmail(db, workspaceId, email) {
  return getRow(
    db,
    `SELECT * FROM user_invites
     WHERE workspace_id = ? AND email = ? AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [workspaceId, email]
  );
}

function normalizeInviteStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  if (!status || status === 'all') return 'all';
  if (status === 'pending' || status === 'accepted' || status === 'expired' || status === 'revoked') {
    return status;
  }
  throw new Error('Invalid invite status');
}

export async function listUserInvites(db, { org_id: orgId = null, workspace_id: workspaceId = null, status = 'pending' } = {}) {
  const safeWorkspaceId = optionalUuid(workspaceId, 'workspace_id');
  let safeOrgId = orgId ? assertUuid(orgId, 'org_id') : null;
  if (safeWorkspaceId) {
    const workspace = await getWorkspaceRow(db, safeWorkspaceId);
    if (safeOrgId && workspace.org_id !== safeOrgId) {
      throw new Error('workspace_id does not belong to org_id');
    }
    safeOrgId = safeOrgId ?? workspace.org_id;
  }
  if (!safeOrgId) {
    throw new Error('org_id or workspace_id required');
  }
  const safeStatus = normalizeInviteStatus(status);
  const where = ['ui.org_id = ?'];
  const params = [safeOrgId];
  if (safeWorkspaceId) {
    where.push('ui.workspace_id = ?');
    params.push(safeWorkspaceId);
  }
  if (safeStatus !== 'all') {
    where.push('ui.status = ?');
    params.push(safeStatus);
  }
  return getRows(
    db,
    `SELECT ui.*, w.name AS workspace_name
       FROM user_invites ui
       LEFT JOIN workspaces w ON w.id = ui.workspace_id
      WHERE ${where.join(' AND ')}
      ORDER BY ui.created_at DESC`,
    params
  );
}

export async function revokeUserInvite(db, inviteId, actorEmail = null, clientId = null) {
  const id = assertUuid(inviteId, 'invite id');
  const invite = await getInviteById(db, id);
  if (!invite) return null;
  const currentStatus = String(invite.status ?? '').trim().toLowerCase();
  if (currentStatus !== 'pending') {
    throw new Error('Only pending invites can be deleted');
  }
  const updatedAt = nowIso();
  await run(
    db,
    'UPDATE user_invites SET status = ?, updated_at = ? WHERE id = ?',
    ['revoked', updatedAt, id]
  );
  if (invite.workspace_id) {
    await recordChange(
      db,
      invite.workspace_id,
      'user_invite',
      id,
      'update',
      {
        status: 'revoked',
        revoked_by_email: normalizeEmail(actorEmail),
        revoked_at: updatedAt
      },
      clientId
    );
  }
  return getInviteById(db, id);
}

export async function createUserInvite(db, data, clientId = null) {
  const workspace = await getWorkspaceRow(db, data?.workspace_id);
  const orgId = workspace.org_id;
  if (data?.org_id && assertUuid(data.org_id, 'org_id') !== orgId) {
    throw new Error('workspace_id does not belong to org_id');
  }
  const email = normalizeEmail(data?.email);
  if (!email) {
    throw new Error('email required');
  }
  const invitedByEmail = normalizeEmail(data?.invited_by_email);
  if (!invitedByEmail) {
    throw new Error('invited_by_email required');
  }
  const role = normalizeRole(data?.role);
  const existingUser = await getRow(
    db,
    'SELECT id, archived FROM users WHERE org_id = ? AND email = ?',
    [orgId, email]
  );
  if (existingUser && !Number(existingUser.archived)) {
    throw new Error('User with this email already exists');
  }

  const pendingInvite = await getPendingInviteByWorkspaceEmail(db, workspace.id, email);
  if (pendingInvite) {
    const expiresAtTs = Date.parse(pendingInvite.expires_at);
    if (Number.isFinite(expiresAtTs) && expiresAtTs > Date.now()) {
      return pendingInvite;
    }
    await run(
      db,
      'UPDATE user_invites SET status = ?, updated_at = ? WHERE id = ?',
      ['expired', nowIso(), pendingInvite.id]
    );
  }

  const id = ensureUuid(data?.id, 'invite id');
  const timestamp = nowIso();
  const invite = {
    id,
    org_id: orgId,
    workspace_id: workspace.id,
    email,
    role,
    invite_token: randomUUID(),
    status: 'pending',
    invited_by_email: invitedByEmail,
    expires_at: addDaysIso(DEFAULT_INVITE_EXPIRY_DAYS),
    accepted_at: null,
    created_at: timestamp,
    updated_at: timestamp
  };
  await run(
    db,
    `INSERT INTO user_invites (
      id, org_id, workspace_id, email, role, invite_token, status, invited_by_email,
      expires_at, accepted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invite.id,
      invite.org_id,
      invite.workspace_id,
      invite.email,
      invite.role,
      invite.invite_token,
      invite.status,
      invite.invited_by_email,
      invite.expires_at,
      invite.accepted_at,
      invite.created_at,
      invite.updated_at
    ]
  );
  await recordChange(db, workspace.id, 'user_invite', invite.id, 'create', {
    email: invite.email,
    role: invite.role,
    status: invite.status,
    invited_by_email: invite.invited_by_email,
    expires_at: invite.expires_at
  }, clientId);
  return getInviteById(db, invite.id);
}

export async function listWorkspaceMemberships(db, workspaceId) {
  if (!workspaceId) return [];
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  return getRows(
    db,
    `SELECT wm.*, u.display_name AS user_display_name, u.email AS user_email, u.archived AS user_archived, u.org_id
       FROM workspace_memberships wm
       JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = ?
      ORDER BY wm.archived ASC, u.display_name ASC`,
    [safeWorkspaceId]
  );
}

export async function createWorkspaceMembership(db, data, clientId = null) {
  const workspace = await getWorkspaceRow(db, data?.workspace_id);
  const userId = assertUuid(data?.user_id, 'user_id');
  const user = await getUserById(db, userId);
  if (!user || Number(user.archived)) {
    throw new Error('User not found');
  }
  if (user.org_id !== workspace.org_id) {
    throw new Error('User must belong to the same organization');
  }
  const existing = await getRow(
    db,
    'SELECT * FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?',
    [workspace.id, userId]
  );
  const timestamp = nowIso();
  if (existing) {
    const role = normalizeRole(data?.role ?? existing.role);
    const archived = data?.archived !== undefined ? (data.archived ? 1 : 0) : 0;
    await run(
      db,
      'UPDATE workspace_memberships SET role = ?, archived = ?, updated_at = ? WHERE id = ?',
      [role, archived, timestamp, existing.id]
    );
    const updated = await getRow(db, 'SELECT * FROM workspace_memberships WHERE id = ?', [existing.id]);
    await recordChange(db, workspace.id, 'workspace_membership', updated.id, 'update', updated, clientId);
    return updated;
  }
  const id = ensureUuid(data?.id, 'membership id');
  const membership = {
    id,
    workspace_id: workspace.id,
    user_id: userId,
    role: normalizeRole(data?.role),
    archived: data?.archived ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  await run(
    db,
    `INSERT INTO workspace_memberships
      (id, workspace_id, user_id, role, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      membership.id,
      membership.workspace_id,
      membership.user_id,
      membership.role,
      membership.archived,
      membership.created_at,
      membership.updated_at
    ]
  );
  await recordChange(db, workspace.id, 'workspace_membership', membership.id, 'create', membership, clientId);
  return membership;
}

export async function updateWorkspaceMembership(db, id, patch, clientId = null) {
  const membershipId = assertUuid(id, 'membership id');
  const existing = await getRow(db, 'SELECT * FROM workspace_memberships WHERE id = ?', [membershipId]);
  if (!existing) return null;
  const next = {
    ...existing,
    role: patch.role !== undefined ? normalizeRole(patch.role) : existing.role,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : Number(existing.archived) ? 1 : 0,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE workspace_memberships SET role = ?, archived = ?, updated_at = ? WHERE id = ?',
    [next.role, next.archived, next.updated_at, membershipId]
  );
  await recordChange(db, existing.workspace_id, 'workspace_membership', membershipId, 'update', patch, clientId);
  return getRow(db, 'SELECT * FROM workspace_memberships WHERE id = ?', [membershipId]);
}

export async function deleteWorkspaceMembership(db, id, clientId = null) {
  const membershipId = assertUuid(id, 'membership id');
  const existing = await getRow(db, 'SELECT * FROM workspace_memberships WHERE id = ?', [membershipId]);
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM workspace_memberships WHERE id = ?', [membershipId]);
  await recordChange(db, existing.workspace_id, 'workspace_membership', membershipId, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function updateWorkspace(db, id, patch, clientId = null) {
  const existing = await getWorkspace(db, id);
  if (!existing) return null;
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    type: patch.type ?? existing.type,
    owner_user_id: patch.owner_user_id !== undefined ? optionalUuid(patch.owner_user_id, 'owner_user_id') : existing.owner_user_id ?? null,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE workspaces SET name = ?, type = ?, owner_user_id = ?, archived = ?, updated_at = ? WHERE id = ?',
    [next.name, next.type, next.owner_user_id, next.archived, next.updated_at, id]
  );
  await recordChange(db, id, 'workspace', id, 'update', patch, clientId);
  return getWorkspace(db, id);
}

export async function deleteWorkspace(db, id, clientId = null) {
  const existing = await getWorkspace(db, id);
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM workspaces WHERE id = ?', [id]);
  await recordChange(db, id, 'workspace', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function getProject(db, id) {
  const projectId = assertUuid(id, 'project id');
  return getRow(db, 'SELECT * FROM projects WHERE id = ?', [projectId]);
}

export async function listProjects(db, workspaceId) {
  if (!workspaceId) return [];
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  return getRows(db, 'SELECT * FROM projects WHERE workspace_id = ?', [safeWorkspaceId]);
}

export async function createProject(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getProject(db, assertUuid(data.id, 'project id'));
    if (existing) return existing;
  }
  const id = ensureUuid(data?.id, 'project id');
  const workspaceId = await assertWorkspaceExists(db, data.workspace_id);
  const timestamp = nowIso();
  const project = {
    id,
    workspace_id: workspaceId,
    name: data.name,
    kind: data.kind ?? 'project',
    archived: data.archived ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  await run(
    db,
    'INSERT INTO projects (id, workspace_id, name, kind, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      project.id,
      project.workspace_id,
      project.name,
      project.kind,
      project.archived,
      project.created_at,
      project.updated_at
    ]
  );
  await recordChange(db, project.workspace_id, 'project', id, 'create', project, clientId);
  return getProject(db, id);
}

export async function updateProject(db, id, patch, clientId = null) {
  const projectId = assertUuid(id, 'project id');
  const existing = await getProject(db, projectId);
  if (!existing) return null;
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    kind: patch.kind ?? existing.kind,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE projects SET name = ?, kind = ?, archived = ?, updated_at = ? WHERE id = ?',
    [next.name, next.kind, next.archived, next.updated_at, projectId]
  );
  await recordChange(db, existing.workspace_id, 'project', projectId, 'update', patch, clientId);
  return getProject(db, projectId);
}

export async function deleteProject(db, id, clientId = null) {
  const projectId = assertUuid(id, 'project id');
  const existing = await getProject(db, projectId);
  if (!existing) return { deleted: 0 };
  await db.transaction(async (tx) => {
    await run(tx, 'UPDATE tasks SET project_id = NULL WHERE project_id = ?', [projectId]);
    await run(tx, 'DELETE FROM projects WHERE id = ?', [projectId]);
  });
  await recordChange(db, existing.workspace_id, 'project', projectId, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function getTemplate(db, id) {
  const templateId = assertUuid(id, 'template id');
  const row = await getRow(db, 'SELECT * FROM templates WHERE id = ?', [templateId]);
  return normalizeTemplateRow(row);
}

export async function listTemplates(db, workspaceId) {
  if (!workspaceId) return [];
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  const rows = await getRows(db, 'SELECT * FROM templates WHERE workspace_id = ?', [safeWorkspaceId]);
  return rows.map(normalizeTemplateRow);
}

export async function createTemplate(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getTemplate(db, assertUuid(data.id, 'template id'));
    if (existing) return existing;
  }
  const id = ensureUuid(data?.id, 'template id');
  const timestamp = nowIso();
  const workspaceId = await assertWorkspaceExists(db, data.workspace_id);
  const projectId = optionalUuid(data.project_id, 'project_id');
  if (projectId) {
    await assertProjectBelongsToWorkspace(db, projectId, workspaceId, 'project_id');
  }
  const template = {
    id,
    workspace_id: workspaceId,
    project_id: projectId,
    name: data.name,
    steps_json: JSON.stringify(data.steps ?? []),
    lead_days: data.lead_days ?? 0,
    next_event_date: data.next_event_date ?? null,
    recurrence_interval: data.recurrence_interval ?? null,
    recurrence_unit: data.recurrence_unit ?? null,
    archived: data.archived ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  await run(
    db,
    `INSERT INTO templates (
      id, workspace_id, project_id, name, steps_json, lead_days, next_event_date,
      recurrence_interval, recurrence_unit, archived, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      template.id,
      template.workspace_id,
      template.project_id,
      template.name,
      template.steps_json,
      template.lead_days,
      template.next_event_date,
      template.recurrence_interval,
      template.recurrence_unit,
      template.archived,
      template.created_at,
      template.updated_at
    ]
  );
  await recordChange(db, template.workspace_id, 'template', id, 'create', template, clientId);
  return getTemplate(db, id);
}

export async function updateTemplate(db, id, patch, clientId = null) {
  const templateId = assertUuid(id, 'template id');
  const existing = await getRow(db, 'SELECT * FROM templates WHERE id = ?', [templateId]);
  if (!existing) return null;
  const nextProjectId = patch.project_id !== undefined
    ? optionalUuid(patch.project_id, 'project_id')
    : existing.project_id;
  if (nextProjectId) {
    await assertProjectBelongsToWorkspace(db, nextProjectId, existing.workspace_id, 'project_id');
  }
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    project_id: nextProjectId,
    steps_json: patch.steps ? JSON.stringify(patch.steps) : existing.steps_json,
    lead_days: patch.lead_days ?? existing.lead_days,
    next_event_date: patch.next_event_date !== undefined ? patch.next_event_date : existing.next_event_date,
    recurrence_interval: 'recurrence_interval' in patch ? patch.recurrence_interval : existing.recurrence_interval,
    recurrence_unit: 'recurrence_unit' in patch ? patch.recurrence_unit : existing.recurrence_unit,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  await run(
    db,
    `UPDATE templates SET
      name = ?, project_id = ?, steps_json = ?, lead_days = ?, next_event_date = ?,
      recurrence_interval = ?, recurrence_unit = ?, archived = ?, updated_at = ?
     WHERE id = ?`,
    [
      next.name,
      next.project_id,
      next.steps_json,
      next.lead_days,
      next.next_event_date,
      next.recurrence_interval,
      next.recurrence_unit,
      next.archived,
      next.updated_at,
      templateId
    ]
  );
  await recordChange(db, existing.workspace_id, 'template', templateId, 'update', patch, clientId);
  return getTemplate(db, templateId);
}

export async function deleteTemplate(db, id, clientId = null) {
  const templateId = assertUuid(id, 'template id');
  const existing = await getRow(db, 'SELECT * FROM templates WHERE id = ?', [templateId]);
  if (!existing) return { deleted: 0 };
  await db.transaction(async (tx) => {
    await run(tx, 'UPDATE tasks SET template_id = NULL WHERE template_id = ?', [templateId]);
    await run(tx, 'DELETE FROM templates WHERE id = ?', [templateId]);
  });
  await recordChange(db, existing.workspace_id, 'template', templateId, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function getShoppingList(db, id) {
  const listId = assertUuid(id, 'shopping_list id');
  return getRow(db, 'SELECT * FROM shopping_lists WHERE id = ?', [listId]);
}

export async function listShoppingLists(db, workspaceId) {
  if (!workspaceId) return [];
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  return getRows(db, 'SELECT * FROM shopping_lists WHERE workspace_id = ?', [safeWorkspaceId]);
}

export async function createShoppingList(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getShoppingList(db, assertUuid(data.id, 'shopping_list id'));
    if (existing) return existing;
  }
  const id = ensureUuid(data?.id, 'shopping_list id');
  const timestamp = nowIso();
  const workspaceId = await assertWorkspaceExists(db, data.workspace_id);
  const list = {
    id,
    workspace_id: workspaceId,
    name: data.name,
    store_name: normalizeShoppingStoreName(data.store_name) ?? null,
    scheduled_for: normalizeDateOnly(data.scheduled_for, 'scheduled_for') ?? null,
    archived: data.archived ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  await run(
    db,
    'INSERT INTO shopping_lists (id, workspace_id, name, store_name, scheduled_for, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [list.id, list.workspace_id, list.name, list.store_name, list.scheduled_for, list.archived, list.created_at, list.updated_at]
  );
  await recordChange(db, list.workspace_id, 'shopping_list', id, 'create', list, clientId);
  return getShoppingList(db, id);
}

export async function updateShoppingList(db, id, patch, clientId = null) {
  const listId = assertUuid(id, 'shopping_list id');
  const existing = await getShoppingList(db, listId);
  if (!existing) return null;
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    store_name: patch.store_name !== undefined
      ? normalizeShoppingStoreName(patch.store_name)
      : existing.store_name ?? null,
    scheduled_for: patch.scheduled_for !== undefined
      ? normalizeDateOnly(patch.scheduled_for, 'scheduled_for')
      : existing.scheduled_for ?? null,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE shopping_lists SET name = ?, store_name = ?, scheduled_for = ?, archived = ?, updated_at = ? WHERE id = ?',
    [next.name, next.store_name, next.scheduled_for, next.archived, next.updated_at, listId]
  );
  await recordChange(db, existing.workspace_id, 'shopping_list', listId, 'update', patch, clientId);
  return getShoppingList(db, listId);
}

export async function deleteShoppingList(db, id, clientId = null) {
  const listId = assertUuid(id, 'shopping_list id');
  const existing = await getShoppingList(db, listId);
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM shopping_lists WHERE id = ?', [listId]);
  await recordChange(db, existing.workspace_id, 'shopping_list', listId, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function getShoppingItem(db, id) {
  const itemId = assertUuid(id, 'shopping_item id');
  return getRow(db, 'SELECT * FROM shopping_list_items WHERE id = ?', [itemId]);
}

async function getShoppingItemOrderHintsMap(db, workspaceId, storeNameKey) {
  if (!workspaceId || !storeNameKey) return new Map();
  const rows = await getRows(
    db,
    `SELECT item_name_key, sort_rank
       FROM shopping_item_order_hints
      WHERE workspace_id = ? AND store_name_key = ?`,
    [workspaceId, storeNameKey]
  );
  return new Map(
    rows
      .map((row) => [String(row.item_name_key ?? ''), Number(row.sort_rank)])
      .filter(([key, rank]) => key && Number.isFinite(rank))
  );
}

function getShoppingItemHintRank(item, hints) {
  const key = normalizeShoppingItemKey(item?.name);
  if (!key || !(hints instanceof Map)) return null;
  const rank = hints.get(key);
  return Number.isFinite(rank) ? rank : null;
}

function buildHintAwareShoppingOrder(existingItems, newRecords, hints) {
  const ordered = existingItems.map((record) => ({
    record,
    hintRank: getShoppingItemHintRank(record, hints),
    isExisting: true,
    inputIndex: -1
  }));
  const pending = newRecords
    .map((record, inputIndex) => ({
      record,
      hintRank: getShoppingItemHintRank(record, hints),
      isExisting: false,
      inputIndex
    }))
    .sort((a, b) => {
      const rankA = a.hintRank ?? Number.MAX_SAFE_INTEGER;
      const rankB = b.hintRank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.inputIndex - b.inputIndex;
    });

  for (const entry of pending) {
    if (entry.hintRank === null) {
      ordered.push(entry);
      continue;
    }
    let insertAt = ordered.length;
    let lastRankAtOrBefore = -1;
    for (let index = 0; index < ordered.length; index += 1) {
      const candidateRank = ordered[index].hintRank;
      if (candidateRank === null) continue;
      if (candidateRank <= entry.hintRank) {
        lastRankAtOrBefore = index;
        continue;
      }
      insertAt = lastRankAtOrBefore >= 0 ? lastRankAtOrBefore + 1 : index;
      break;
    }
    if (insertAt === ordered.length && lastRankAtOrBefore >= 0) {
      insertAt = lastRankAtOrBefore + 1;
    }
    ordered.splice(insertAt, 0, entry);
  }
  return ordered.map((entry) => entry.record);
}

function buildShoppingItemRecord(input, listId, timestamp) {
  const source = typeof input === 'string' ? { name: input } : (input ?? {});
  const outcome = resolveShoppingItemOutcome(null, source);
  const explicitSortOrder = Number.isFinite(Number(source.sort_order)) ? Number(source.sort_order) : null;
  return {
    id: ensureUuid(source?.id, 'shopping_item id'),
    list_id: listId,
    name: normalizeShoppingItemName(source.name ?? input),
    item_state: outcome.item_state,
    substitute_name: outcome.substitute_name,
    is_checked: outcome.is_checked,
    sort_order: explicitSortOrder,
    created_at: timestamp,
    updated_at: timestamp
  };
}

async function planShoppingItemInsertion(db, list, inputs) {
  const timestamp = nowIso();
  const records = inputs.map((input) => buildShoppingItemRecord(input, list.id, timestamp));
  const hasExplicitSortOrder = records.some((record) => Number.isFinite(record.sort_order));
  const existingItems = await listShoppingItems(db, null, list.id);
  const maxExistingSort = Math.max(0, ...existingItems.map((item) => Number(item.sort_order) || 0));

  if (hasExplicitSortOrder) {
    let nextSortOrder = maxExistingSort;
    for (const record of records) {
      if (Number.isFinite(record.sort_order)) continue;
      nextSortOrder += 1;
      record.sort_order = nextSortOrder;
    }
    return { timestamp, records, sortUpdates: [] };
  }

  const storeNameKey = getShoppingListStoreKey(list);
  const hints = await getShoppingItemOrderHintsMap(db, list.workspace_id, storeNameKey);
  if (!storeNameKey || !hints.size) {
    let nextSortOrder = maxExistingSort;
    for (const record of records) {
      nextSortOrder += 1;
      record.sort_order = nextSortOrder;
    }
    return { timestamp, records, sortUpdates: [] };
  }

  const ordered = buildHintAwareShoppingOrder(existingItems, records, hints);
  const sortUpdates = [];
  const nextSortById = new Map();
  ordered.forEach((record, index) => {
    nextSortById.set(record.id, (index + 1) * 100);
  });

  for (const existingItem of existingItems) {
    const nextSortOrder = nextSortById.get(existingItem.id);
    if (!Number.isFinite(nextSortOrder) || Number(existingItem.sort_order) === nextSortOrder) continue;
    sortUpdates.push({
      id: existingItem.id,
      sort_order: nextSortOrder,
      updated_at: timestamp
    });
  }

  for (const record of records) {
    record.sort_order = nextSortById.get(record.id) ?? record.sort_order ?? maxExistingSort + 1;
  }

  return { timestamp, records, sortUpdates };
}

async function applyShoppingItemSortUpdates(db, list, sortUpdates, clientId = null) {
  if (!Array.isArray(sortUpdates) || !sortUpdates.length) return;
  for (const update of sortUpdates) {
    await run(
      db,
      'UPDATE shopping_list_items SET sort_order = ?, updated_at = ? WHERE id = ?',
      [update.sort_order, update.updated_at ?? nowIso(), update.id]
    );
    await recordChange(db, list.workspace_id, 'shopping_item', update.id, 'update', { sort_order: update.sort_order }, clientId);
  }
}

async function learnShoppingItemOrderHints(db, list) {
  const storeNameKey = getShoppingListStoreKey(list);
  if (!list?.workspace_id || !storeNameKey) return;
  const orderedItems = await listShoppingItems(db, null, list.id);
  const timestamp = nowIso();
  for (let index = 0; index < orderedItems.length; index += 1) {
    const itemNameKey = normalizeShoppingItemKey(orderedItems[index]?.name);
    if (!itemNameKey) continue;
    const existing = await getRow(
      db,
      `SELECT workspace_id
         FROM shopping_item_order_hints
        WHERE workspace_id = ? AND store_name_key = ? AND item_name_key = ?`,
      [list.workspace_id, storeNameKey, itemNameKey]
    );
    if (existing) {
      await run(
        db,
        `UPDATE shopping_item_order_hints
            SET sort_rank = ?, updated_at = ?
          WHERE workspace_id = ? AND store_name_key = ? AND item_name_key = ?`,
        [(index + 1) * 100, timestamp, list.workspace_id, storeNameKey, itemNameKey]
      );
      continue;
    }
    await run(
      db,
      `INSERT INTO shopping_item_order_hints
        (workspace_id, store_name_key, item_name_key, sort_rank, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [list.workspace_id, storeNameKey, itemNameKey, (index + 1) * 100, timestamp, timestamp]
    );
  }
}

export async function listShoppingItems(db, workspaceId, listId = null) {
  if (listId) {
    const safeListId = assertUuid(listId, 'list_id');
    return getRows(
      db,
      'SELECT * FROM shopping_list_items WHERE list_id = ? ORDER BY sort_order ASC, created_at ASC',
      [safeListId]
    );
  }
  if (!workspaceId) return [];
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  return getRows(
    db,
    `SELECT items.* FROM shopping_list_items items
     JOIN shopping_lists lists ON lists.id = items.list_id
     WHERE lists.workspace_id = ?
     ORDER BY items.sort_order ASC, items.created_at ASC`,
    [safeWorkspaceId]
  );
}

export async function createShoppingItems(db, listId, items, clientId = null) {
  const safeListId = assertUuid(listId, 'list_id');
  const list = await getShoppingList(db, safeListId);
  if (!list) return [];
  const insertionPlan = await planShoppingItemInsertion(db, list, items);
  const created = [];
  await db.transaction(async (tx) => {
    await applyShoppingItemSortUpdates(tx, list, insertionPlan.sortUpdates, clientId);
    for (const record of insertionPlan.records) {
      await run(
        tx,
        `INSERT INTO shopping_list_items
          (id, list_id, name, is_checked, item_state, substitute_name, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.list_id,
          record.name,
          record.is_checked,
          record.item_state,
          record.substitute_name,
          record.sort_order,
          record.created_at,
          record.updated_at
        ]
      );
      await recordChange(tx, list.workspace_id, 'shopping_item', record.id, 'create', record, clientId);
      created.push(record);
    }
  });
  return Promise.all(created.map(item => getShoppingItem(db, item.id)));
}

export async function createShoppingItem(db, data, clientId = null) {
  const created = await createShoppingItems(db, data.list_id, [data], clientId);
  return created[0] ?? null;
}

export async function updateShoppingItem(db, id, patch, clientId = null) {
  id = assertUuid(id, 'shopping_item id');
  const existing = await getShoppingItem(db, id);
  if (!existing) return null;
  const currentList = await getShoppingList(db, existing.list_id);
  const { list_id } = patch;
  const name = patch.name !== undefined ? normalizeShoppingItemName(patch.name) : undefined;
  let { sort_order } = patch;
  let targetListId = existing.list_id;
  let targetList = currentList;
  if (list_id !== undefined) {
    targetListId = assertUuid(list_id, 'list_id');
    targetList = await getShoppingList(db, targetListId);
    if (!targetList) {
      throw new Error('Shopping list not found');
    }
    if (currentList && targetList.workspace_id !== currentList.workspace_id) {
      throw new Error('Shopping item and shopping list must belong to the same workspace');
    }
  }
  if (targetListId !== existing.list_id && !Number.isFinite(sort_order)) {
    const maxRow = await getRow(
      db,
      'SELECT MAX(sort_order) AS max_sort FROM shopping_list_items WHERE list_id = ?',
      [targetListId]
    );
    sort_order = Number(maxRow?.max_sort ?? 0) + 1;
  }
  const outcome = resolveShoppingItemOutcome(existing, patch);
  const updatedAt = nowIso();
  await run(
    db,
    `UPDATE shopping_list_items
     SET list_id = COALESCE(?, list_id),
         name = COALESCE(?, name),
         is_checked = ?,
         item_state = ?,
         substitute_name = ?,
         sort_order = COALESCE(?, sort_order),
         updated_at = ?
     WHERE id = ?`,
    [
      list_id ?? null,
      name ?? null,
      outcome.is_checked,
      outcome.item_state,
      outcome.substitute_name,
      sort_order ?? null,
      updatedAt,
      id
    ]
  );
  const workspaceId = currentList?.workspace_id ?? targetList?.workspace_id ?? null;
  if (workspaceId) {
    const changePayload = {};
    if (list_id !== undefined) changePayload.list_id = targetListId;
    if (name !== undefined) changePayload.name = name;
    if (sort_order !== undefined) changePayload.sort_order = sort_order;
    if (patch.is_checked !== undefined || patch.item_state !== undefined || patch.substitute_name !== undefined) {
      changePayload.is_checked = outcome.is_checked;
      changePayload.item_state = outcome.item_state;
      changePayload.substitute_name = outcome.substitute_name;
    }
    await recordChange(db, workspaceId, 'shopping_item', id, 'update', changePayload, clientId);
  }
  if (sort_order !== undefined && targetList) {
    await learnShoppingItemOrderHints(db, targetList);
  }
  return getShoppingItem(db, id);
}

export async function deleteShoppingItem(db, id, clientId = null) {
  const itemId = assertUuid(id, 'shopping_item id');
  const existing = await getShoppingItem(db, itemId);
  if (!existing) return { deleted: 0 };
  const list = await getShoppingList(db, existing.list_id);
  await run(db, 'DELETE FROM shopping_list_items WHERE id = ?', [itemId]);
  if (list) {
    await recordChange(db, list.workspace_id, 'shopping_item', itemId, 'delete', {}, clientId);
  }
  return { deleted: 1 };
}

export async function convertTaskToShoppingItem(db, id, data = {}, clientId = null) {
  const taskId = assertUuid(id, 'task id');
  const task = await getTask(db, taskId);
  if (!task) return null;

  const listId = assertUuid(data?.list_id, 'list_id');
  const list = await getShoppingList(db, listId);
  if (!list) {
    throw new Error('Shopping list not found');
  }
  if (list.workspace_id !== task.workspace_id) {
    throw new Error('Task and shopping list must belong to the same workspace');
  }

  const childRow = await getRow(
    db,
    'SELECT COUNT(*) AS child_count FROM tasks WHERE parent_id = ?',
    [taskId]
  );
  if (Number(childRow?.child_count ?? 0) > 0) {
    throw new Error('Only tasks without subtasks can be converted to shopping items');
  }

  const insertionPlan = await planShoppingItemInsertion(db, list, [{
    id: data?.shopping_item_id,
    name: task.title
  }]);
  const shoppingItem = insertionPlan.records[0];

  await db.transaction(async (tx) => {
    await applyShoppingItemSortUpdates(tx, list, insertionPlan.sortUpdates, clientId);
    await run(
      tx,
      `INSERT INTO shopping_list_items
        (id, list_id, name, is_checked, item_state, substitute_name, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shoppingItem.id,
        shoppingItem.list_id,
        shoppingItem.name,
        shoppingItem.is_checked,
        shoppingItem.item_state,
        shoppingItem.substitute_name,
        shoppingItem.sort_order,
        shoppingItem.created_at,
        shoppingItem.updated_at
      ]
    );
    await recordChange(tx, list.workspace_id, 'shopping_item', shoppingItem.id, 'create', shoppingItem, clientId);
    await run(tx, 'DELETE FROM tasks WHERE id = ?', [taskId]);
    await recordChange(tx, task.workspace_id, 'task', taskId, 'delete', { ids: [taskId] }, clientId);
  });

  return {
    shopping_item: await getShoppingItem(db, shoppingItem.id),
    deleted_task: {
      id: taskId,
      ids: [taskId]
    }
  };
}

export async function listNotices(db, workspaceId) {
  if (!workspaceId) return [];
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  return getRows(db, 'SELECT * FROM notices WHERE workspace_id = ? ORDER BY notify_at ASC', [safeWorkspaceId]);
}

async function getNotice(db, id) {
  const noticeId = assertUuid(id, 'notice id');
  return getRow(db, 'SELECT * FROM notices WHERE id = ?', [noticeId]);
}

export async function createNotice(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getNotice(db, assertUuid(data.id, 'notice id'));
    if (existing) return existing;
  }
  const id = ensureUuid(data?.id, 'notice id');
  const timestamp = nowIso();
  const title = (data.title ?? '').trim();
  const notifyAt = data.notify_at ?? null;
  if (!title || !notifyAt) {
    throw new Error('Invalid notice');
  }
  const { interval: recurrenceInterval, unit: recurrenceUnit } = normalizeNoticeRecurrence(
    data.recurrence_interval,
    data.recurrence_unit
  );
  const noticeType = data.notice_type ?? 'general';
  const recurrenceRuleJson = normalizeNoticeRecurrenceRuleJson(data.recurrence_rule_json ?? data.recurrence_rule);
  const recurrenceDefaults = applyBirthdayNoticeDefaults(
    noticeType,
    notifyAt,
    recurrenceInterval,
    recurrenceUnit,
    recurrenceRuleJson
  );
  const recurrenceOccurrenceCount = normalizeNoticeOccurrenceCount(data.recurrence_occurrence_count);
  const workspaceId = await assertWorkspaceExists(db, data.workspace_id);
  const notice = {
    id,
    workspace_id: workspaceId,
    title,
    notify_at: notifyAt,
    notice_type: noticeType,
    notice_sent_at: data.notice_sent_at ?? null,
    recurrence_interval: recurrenceDefaults.recurrenceInterval,
    recurrence_unit: recurrenceDefaults.recurrenceUnit,
    recurrence_rule_json: recurrenceDefaults.recurrenceRuleJson,
    recurrence_occurrence_count: recurrenceOccurrenceCount,
    dismissed_at: data.dismissed_at ?? null,
    created_at: timestamp,
    updated_at: timestamp
  };
  await run(
    db,
    `INSERT INTO notices (
      id, workspace_id, title, notify_at, notice_type, notice_sent_at, recurrence_interval,
      recurrence_unit, recurrence_rule_json, recurrence_occurrence_count, dismissed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      notice.id,
      notice.workspace_id,
      notice.title,
      notice.notify_at,
      notice.notice_type,
      notice.notice_sent_at,
      notice.recurrence_interval,
      notice.recurrence_unit,
      notice.recurrence_rule_json,
      notice.recurrence_occurrence_count,
      notice.dismissed_at,
      notice.created_at,
      notice.updated_at
    ]
  );
  await recordChange(db, notice.workspace_id, 'notice', id, 'create', notice, clientId);
  return getNotice(db, id);
}

export async function updateNotice(db, id, patch, clientId = null) {
  const noticeId = assertUuid(id, 'notice id');
  const existing = await getNotice(db, noticeId);
  if (!existing) return null;
  const { interval: recurrenceInterval, unit: recurrenceUnit } = normalizeNoticeRecurrence(
    'recurrence_interval' in patch ? patch.recurrence_interval : existing.recurrence_interval,
    'recurrence_unit' in patch ? patch.recurrence_unit : existing.recurrence_unit
  );
  const nextNoticeType = patch.notice_type ?? existing.notice_type ?? 'general';
  const nextNotifyAt = patch.notify_at ?? existing.notify_at;
  const nextRecurrenceRuleJson = ('recurrence_rule_json' in patch || 'recurrence_rule' in patch)
    ? normalizeNoticeRecurrenceRuleJson(patch.recurrence_rule_json ?? patch.recurrence_rule)
    : existing.recurrence_rule_json;
  const recurrenceDefaults = applyBirthdayNoticeDefaults(
    nextNoticeType,
    nextNotifyAt,
    recurrenceInterval,
    recurrenceUnit,
    nextRecurrenceRuleJson
  );
  const next = {
    ...existing,
    title: patch.title !== undefined ? String(patch.title).trim() : existing.title,
    notify_at: nextNotifyAt,
    notice_type: nextNoticeType,
    notice_sent_at: patch.notice_sent_at ?? existing.notice_sent_at,
    recurrence_interval: recurrenceDefaults.recurrenceInterval,
    recurrence_unit: recurrenceDefaults.recurrenceUnit,
    recurrence_rule_json: recurrenceDefaults.recurrenceRuleJson,
    recurrence_occurrence_count: ('recurrence_occurrence_count' in patch)
      ? normalizeNoticeOccurrenceCount(patch.recurrence_occurrence_count)
      : normalizeNoticeOccurrenceCount(existing.recurrence_occurrence_count),
    dismissed_at: patch.dismissed_at ?? existing.dismissed_at,
    updated_at: nowIso()
  };
  await run(
    db,
    `UPDATE notices SET
      title = ?, notify_at = ?, notice_type = ?, notice_sent_at = ?, recurrence_interval = ?,
      recurrence_unit = ?, recurrence_rule_json = ?, recurrence_occurrence_count = ?,
      dismissed_at = ?, updated_at = ? WHERE id = ?`,
    [
      next.title,
      next.notify_at,
      next.notice_type,
      next.notice_sent_at,
      next.recurrence_interval,
      next.recurrence_unit,
      next.recurrence_rule_json,
      next.recurrence_occurrence_count,
      next.dismissed_at,
      next.updated_at,
      noticeId
    ]
  );
  await recordChange(db, existing.workspace_id, 'notice', noticeId, 'update', patch, clientId);
  return getNotice(db, noticeId);
}

export async function deleteNotice(db, id, clientId = null) {
  const noticeId = assertUuid(id, 'notice id');
  const existing = await getNotice(db, noticeId);
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM notices WHERE id = ?', [noticeId]);
  await recordChange(db, existing.workspace_id, 'notice', noticeId, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function listNoticeTypes(db, workspaceId) {
  if (!workspaceId) return [];
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  await seedWorkspaceNoticeTypes(db, safeWorkspaceId);
  return getRows(db, 'SELECT * FROM notice_types WHERE workspace_id = ? ORDER BY label ASC', [safeWorkspaceId]);
}

async function getNoticeType(db, id) {
  const noticeTypeId = assertUuid(id, 'notice_type id');
  return getRow(db, 'SELECT * FROM notice_types WHERE id = ?', [noticeTypeId]);
}

async function getNoticeTypeByKey(db, workspaceId, key) {
  return getRow(db, 'SELECT * FROM notice_types WHERE workspace_id = ? AND key = ?', [workspaceId, key]);
}

async function getNoticeTypeByLabel(db, workspaceId, label) {
  return getRow(db, 'SELECT * FROM notice_types WHERE workspace_id = ? AND label = ?', [workspaceId, label]);
}

async function generateNoticeTypeKey(db, workspaceId, label) {
  const base = slugify(label || 'type');
  let key = base || 'type';
  let suffix = 1;
  while (await getNoticeTypeByKey(db, workspaceId, key)) {
    suffix += 1;
    key = `${base}-${suffix}`;
  }
  return key;
}

export async function createNoticeType(db, data, clientId = null) {
  const label = String(data.label ?? '').trim();
  if (!label) throw new Error('Label required');
  const workspaceId = await assertWorkspaceExists(db, data.workspace_id);
  const existing = await getNoticeTypeByLabel(db, workspaceId, label);
  if (existing) return existing;
  const id = ensureUuid(data?.id, 'notice_type id');
  const timestamp = nowIso();
  const key = await generateNoticeTypeKey(db, workspaceId, label);
  await run(
    db,
    'INSERT INTO notice_types (id, workspace_id, key, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, workspaceId, key, label, timestamp, timestamp]
  );
  await recordChange(db, workspaceId, 'notice_type', id, 'create', { key, label }, clientId);
  return getNoticeType(db, id);
}

export async function updateNoticeType(db, id, patch, clientId = null) {
  const noticeTypeId = assertUuid(id, 'notice_type id');
  const existing = await getNoticeType(db, noticeTypeId);
  if (!existing) return null;
  const nextLabel = patch.label !== undefined ? String(patch.label).trim() : existing.label;
  const next = {
    ...existing,
    label: nextLabel || existing.label,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE notice_types SET label = ?, updated_at = ? WHERE id = ?',
    [next.label, next.updated_at, noticeTypeId]
  );
  await recordChange(db, existing.workspace_id, 'notice_type', noticeTypeId, 'update', patch, clientId);
  return getNoticeType(db, noticeTypeId);
}

export async function deleteNoticeType(db, id, clientId = null) {
  const noticeTypeId = assertUuid(id, 'notice_type id');
  const existing = await getNoticeType(db, noticeTypeId);
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM notice_types WHERE id = ?', [noticeTypeId]);
  await recordChange(db, existing.workspace_id, 'notice_type', noticeTypeId, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function listStoreRules(db, workspaceId) {
  if (!workspaceId) return [];
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  return getRows(db, 'SELECT * FROM store_rules WHERE workspace_id = ? ORDER BY store_name ASC', [safeWorkspaceId]);
}

async function getStoreRule(db, id) {
  const storeRuleId = assertUuid(id, 'store_rule id');
  return getRow(db, 'SELECT * FROM store_rules WHERE id = ?', [storeRuleId]);
}

export async function createStoreRule(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getStoreRule(db, assertUuid(data.id, 'store_rule id'));
    if (existing) return existing;
  }
  const id = ensureUuid(data?.id, 'store_rule id');
  const timestamp = nowIso();
  const keywords = Array.isArray(data.keywords) ? data.keywords : [];
  const workspaceId = await assertWorkspaceExists(db, data.workspace_id);
  const rule = {
    id,
    workspace_id: workspaceId,
    store_name: data.store_name,
    keywords_json: JSON.stringify(keywords),
    archived: data.archived ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  await run(
    db,
    'INSERT INTO store_rules (id, workspace_id, store_name, keywords_json, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      rule.id,
      rule.workspace_id,
      rule.store_name,
      rule.keywords_json,
      rule.archived,
      rule.created_at,
      rule.updated_at
    ]
  );
  await recordChange(db, rule.workspace_id, 'store_rule', id, 'create', rule, clientId);
  return getStoreRule(db, id);
}

export async function updateStoreRule(db, id, patch, clientId = null) {
  const storeRuleId = assertUuid(id, 'store_rule id');
  const existing = await getStoreRule(db, storeRuleId);
  if (!existing) return null;
  const nextKeywords = Array.isArray(patch.keywords)
    ? JSON.stringify(patch.keywords)
    : existing.keywords_json;
  const next = {
    ...existing,
    store_name: patch.store_name ?? existing.store_name,
    keywords_json: nextKeywords,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE store_rules SET store_name = ?, keywords_json = ?, archived = ?, updated_at = ? WHERE id = ?',
    [next.store_name, next.keywords_json, next.archived, next.updated_at, storeRuleId]
  );
  await recordChange(db, existing.workspace_id, 'store_rule', storeRuleId, 'update', patch, clientId);
  return getStoreRule(db, storeRuleId);
}

export async function deleteStoreRule(db, id, clientId = null) {
  const storeRuleId = assertUuid(id, 'store_rule id');
  const existing = await getStoreRule(db, storeRuleId);
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM store_rules WHERE id = ?', [storeRuleId]);
  await recordChange(db, existing.workspace_id, 'store_rule', storeRuleId, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function listTaskTypes(db, workspaceId) {
  if (!workspaceId) return [];
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  return getRows(db, 'SELECT * FROM task_types WHERE workspace_id = ? ORDER BY is_default DESC, name ASC', [safeWorkspaceId]);
}

async function getTaskType(db, id) {
  const taskTypeId = assertUuid(id, 'task_type id');
  return getRow(db, 'SELECT * FROM task_types WHERE id = ?', [taskTypeId]);
}

async function getTaskTypeByName(db, workspaceId, name) {
  if (!workspaceId || !name) return null;
  return getRow(db, 'SELECT * FROM task_types WHERE workspace_id = ? AND name = ?', [workspaceId, name]);
}

async function getDefaultTaskType(db, workspaceId) {
  if (!workspaceId) return null;
  return getRow(
    db,
    'SELECT * FROM task_types WHERE workspace_id = ? AND is_default = 1 ORDER BY name ASC LIMIT 1',
    [workspaceId]
  );
}

export async function createTaskType(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getTaskType(db, assertUuid(data.id, 'task_type id'));
    if (existing) return existing;
  }
  const id = ensureUuid(data?.id, 'task_type id');
  const workspaceId = await assertWorkspaceExists(db, data.workspace_id);
  const timestamp = nowIso();
  const name = (data.name ?? '').trim();
  if (!name) throw new Error('Invalid task type name');
  if (await getTaskTypeByName(db, workspaceId, name)) {
    throw new Error('Task type already exists');
  }
  const type = {
    id,
    workspace_id: workspaceId,
    name,
    is_default: data.is_default ? 1 : 0,
    archived: data.archived ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  await run(
    db,
    'INSERT INTO task_types (id, workspace_id, name, is_default, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [type.id, type.workspace_id, type.name, type.is_default, type.archived, type.created_at, type.updated_at]
  );
  await recordChange(db, type.workspace_id, 'task_type', id, 'create', type, clientId);
  return getTaskType(db, id);
}

export async function updateTaskType(db, id, patch, clientId = null) {
  const taskTypeId = assertUuid(id, 'task_type id');
  const existing = await getTaskType(db, taskTypeId);
  if (!existing) return null;
  const nextName = patch.name !== undefined ? String(patch.name).trim() : existing.name;
  if (!nextName) throw new Error('Invalid task type name');
  if (nextName !== existing.name && await getTaskTypeByName(db, existing.workspace_id, nextName)) {
    throw new Error('Task type already exists');
  }
  const next = {
    ...existing,
    name: nextName,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived,
    updated_at: nowIso()
  };
  await db.transaction(async (tx) => {
    await run(
      tx,
      'UPDATE task_types SET name = ?, archived = ?, updated_at = ? WHERE id = ?',
      [next.name, next.archived, next.updated_at, taskTypeId]
    );
    if (next.name !== existing.name) {
      await run(
        tx,
        'UPDATE tasks SET type_label = ?, updated_at = ? WHERE workspace_id = ? AND type_label = ?',
        [next.name, next.updated_at, existing.workspace_id, existing.name]
      );
    }
  });
  await recordChange(db, existing.workspace_id, 'task_type', taskTypeId, 'update', patch, clientId);
  return getTaskType(db, taskTypeId);
}

export async function deleteTaskType(db, id, clientId = null) {
  const taskTypeId = assertUuid(id, 'task_type id');
  const existing = await getTaskType(db, taskTypeId);
  if (!existing) return { deleted: 0 };
  if (existing.is_default) {
    return { deleted: 0, error: 'protected' };
  }
  await db.transaction(async (tx) => {
    await run(
      tx,
      'UPDATE tasks SET type_label = NULL, updated_at = ? WHERE workspace_id = ? AND type_label = ?',
      [nowIso(), existing.workspace_id, existing.name]
    );
    await run(tx, 'DELETE FROM task_types WHERE id = ?', [taskTypeId]);
  });
  await recordChange(db, existing.workspace_id, 'task_type', taskTypeId, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function listStatuses(db, workspaceId) {
  if (!workspaceId) return [];
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  return getRows(
    db,
    'SELECT * FROM workspace_statuses WHERE workspace_id = ? ORDER BY sort_order ASC, created_at ASC',
    [safeWorkspaceId]
  );
}

export async function getStatusByKey(db, workspaceId, key) {
  if (!workspaceId || !key) return null;
  return getRow(db, 'SELECT * FROM workspace_statuses WHERE workspace_id = ? AND key = ?', [workspaceId, key]);
}

async function getStatusById(db, id) {
  if (!id) return null;
  const statusId = assertUuid(id, 'status id');
  return getRow(db, 'SELECT * FROM workspace_statuses WHERE id = ?', [statusId]);
}

async function getFallbackStatus(db, workspaceId) {
  if (!workspaceId) return null;
  const inbox = await getRow(
    db,
    'SELECT * FROM workspace_statuses WHERE workspace_id = ? AND kind = ?',
    [workspaceId, TaskStatus.INBOX]
  );
  if (inbox) return inbox;
  return getRow(
    db,
    'SELECT * FROM workspace_statuses WHERE workspace_id = ? ORDER BY sort_order ASC LIMIT 1',
    [workspaceId]
  );
}

async function ensureStatusKeyUnique(db, workspaceId, baseKey) {
  let key = baseKey;
  let suffix = 2;
  while (await getRow(db, 'SELECT 1 FROM workspace_statuses WHERE workspace_id = ? AND key = ?', [workspaceId, key])) {
    key = `${baseKey}-${suffix}`;
    suffix += 1;
  }
  return key;
}

export async function createStatus(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getStatusById(db, assertUuid(data.id, 'status id'));
    if (existing) return existing;
  }
  const id = ensureUuid(data?.id, 'status id');
  const workspaceId = await assertWorkspaceExists(db, data.workspace_id);
  const timestamp = nowIso();
  const label = (data.label ?? '').trim();
  const keyBase = data.key ? slugify(data.key) : slugify(label);
  if (!keyBase) throw new Error('Invalid status key');
  const key = await ensureStatusKeyUnique(db, workspaceId, keyBase);
  const maxRow = await getRow(
    db,
    'SELECT MAX(sort_order) AS max_sort FROM workspace_statuses WHERE workspace_id = ?',
    [workspaceId]
  );
  const nextSort = Number(maxRow?.max_sort ?? 0) + 10;
  const status = {
    id,
    workspace_id: workspaceId,
    key,
    label: label || key,
    kind: data.kind ?? 'custom',
    sort_order: Number.isFinite(data.sort_order) ? data.sort_order : nextSort,
    kanban_visible: data.kanban_visible !== undefined ? (data.kanban_visible ? 1 : 0) : 1,
    created_at: timestamp,
    updated_at: timestamp
  };
  await run(
    db,
    `INSERT INTO workspace_statuses
      (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      status.id,
      status.workspace_id,
      status.key,
      status.label,
      status.kind,
      status.sort_order,
      status.kanban_visible,
      status.created_at,
      status.updated_at
    ]
  );
  await recordChange(db, status.workspace_id, 'status', id, 'create', status, clientId);
  return getStatusByKey(db, status.workspace_id, status.key);
}

export async function updateStatus(db, id, patch, clientId = null) {
  const statusId = assertUuid(id, 'status id');
  const existing = await getRow(db, 'SELECT * FROM workspace_statuses WHERE id = ?', [statusId]);
  if (!existing) return null;
  const nextLabel = patch.label !== undefined ? String(patch.label).trim() : existing.label;
  const next = {
    ...existing,
    label: nextLabel || existing.label,
    sort_order: Number.isFinite(patch.sort_order) ? patch.sort_order : existing.sort_order,
    kanban_visible: patch.kanban_visible !== undefined ? (patch.kanban_visible ? 1 : 0) : existing.kanban_visible,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE workspace_statuses SET label = ?, sort_order = ?, kanban_visible = ?, updated_at = ? WHERE id = ?',
    [next.label, next.sort_order, next.kanban_visible, next.updated_at, statusId]
  );
  await recordChange(db, existing.workspace_id, 'status', statusId, 'update', patch, clientId);
  return getRow(db, 'SELECT * FROM workspace_statuses WHERE id = ?', [statusId]);
}

export async function deleteStatus(db, id, clientId = null) {
  const statusId = assertUuid(id, 'status id');
  const existing = await getRow(db, 'SELECT * FROM workspace_statuses WHERE id = ?', [statusId]);
  if (!existing) return { deleted: 0 };
  if (existing.kind !== 'custom') {
    return { deleted: 0, error: 'protected' };
  }
  const fallback = await getFallbackStatus(db, existing.workspace_id);
  const fallbackKey = fallback?.key ?? TaskStatus.INBOX;
  await db.transaction(async (tx) => {
    await run(
      tx,
      'UPDATE tasks SET status = ?, updated_at = ? WHERE workspace_id = ? AND status = ?',
      [fallbackKey, nowIso(), existing.workspace_id, existing.key]
    );
    await run(tx, 'DELETE FROM workspace_statuses WHERE id = ?', [statusId]);
  });
  await recordChange(db, existing.workspace_id, 'status', statusId, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function seedWorkspaceStatuses(db, workspaceId) {
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  const timestamp = nowIso();
  for (const status of DEFAULT_STATUSES) {
    const existing = await getStatusByKey(db, safeWorkspaceId, status.key);
    if (existing) continue;
    await run(
      db,
      `INSERT INTO workspace_statuses
        (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        safeWorkspaceId,
        status.key,
        status.label,
        status.kind,
        status.sort_order,
        status.kanban_visible,
        timestamp,
        timestamp
      ]
    );
  }
}

export async function seedWorkspaceTaskTypes(db, workspaceId) {
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  const timestamp = nowIso();
  for (const type of DEFAULT_TASK_TYPES) {
    const existing = await getTaskTypeByName(db, safeWorkspaceId, type.name);
    if (existing) continue;
    await run(
      db,
      'INSERT INTO task_types (id, workspace_id, name, is_default, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        randomUUID(),
        safeWorkspaceId,
        type.name,
        type.is_default ? 1 : 0,
        0,
        timestamp,
        timestamp
      ]
    );
  }
}

export async function seedWorkspaceNoticeTypes(db, workspaceId) {
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  const timestamp = nowIso();
  for (const type of DEFAULT_NOTICE_TYPES) {
    const existing = await getRow(
      db,
      'SELECT 1 FROM notice_types WHERE workspace_id = ? AND key = ?',
      [safeWorkspaceId, type.key]
    );
    if (existing) continue;
    await run(
      db,
      'INSERT INTO notice_types (id, workspace_id, key, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), safeWorkspaceId, type.key, type.label, timestamp, timestamp]
    );
  }
}

export async function createTask(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getTask(db, assertUuid(data.id, 'task id'));
    if (existing) return existing;
  }
  const id = ensureUuid(data?.id, 'task id');
  const workspaceId = await assertWorkspaceExists(db, data.workspace_id);
  const timestamp = nowIso();
  const statusInput = typeof data.status === 'string' ? data.status.trim() : '';
  const statusKey = statusInput || '';
  let statusRow = null;
  if (statusKey) {
    statusRow = await getStatusByKey(db, workspaceId, statusKey);
    if (!statusRow) {
      throw new Error('Invalid status');
    }
  }
  const status = statusRow?.key ?? '';
  const priority = data.priority ?? 'medium';
  const urgency = data.urgency ? 1 : 0;
  const parentId = optionalUuid(data.parent_id, 'parent_id');
  const projectId = optionalUuid(data.project_id, 'project_id');
  const recurrenceParentId = optionalUuid(data.recurrence_parent_id, 'recurrence_parent_id');
  const templateId = optionalUuid(data.template_id, 'template_id');
  const tags = normalizeTaskTagsInput(data.tags) ?? [];

  if (parentId) {
    await assertTaskBelongsToWorkspace(db, parentId, workspaceId, 'parent_id');
  }
  if (projectId) {
    await assertProjectBelongsToWorkspace(db, projectId, workspaceId, 'project_id');
  }
  if (recurrenceParentId) {
    await assertTaskBelongsToWorkspace(db, recurrenceParentId, workspaceId, 'recurrence_parent_id');
  }
  if (templateId) {
    await assertTemplateBelongsToWorkspace(db, templateId, workspaceId, 'template_id');
  }
  const assignee = await normalizeTaskAssignee(
    db,
    workspaceId,
    data.assignee_user_id ?? null,
    data.assignee_label ?? null
  );

  const task = {
    id,
    workspace_id: workspaceId,
    parent_id: parentId,
    project_id: projectId,
    group_label: data.group_label ?? null,
    title: data.title,
    description_md: data.description_md ?? '',
    type_label: data.type_label ?? null,
    recurrence_interval: data.recurrence_interval ?? null,
    recurrence_unit: data.recurrence_unit ?? null,
    reminder_offset_days: data.reminder_offset_days ?? null,
    auto_debit: data.auto_debit ? 1 : 0,
    reminder_sent_at: data.reminder_sent_at ?? null,
    recurrence_parent_id: recurrenceParentId,
    recurrence_generated_at: data.recurrence_generated_at ?? null,
    template_id: templateId,
    template_state: data.template_state ?? null,
    template_event_date: data.template_event_date ?? null,
    template_lead_days: data.template_lead_days ?? null,
    template_defer_until: data.template_defer_until ?? null,
    template_prompt_pending: data.template_prompt_pending ? 1 : 0,
    assignee_user_id: assignee.assignee_user_id,
    assignee_label: assignee.assignee_label,
    status,
    priority,
    urgency,
    start_at: data.start_at ?? null,
    due_at: data.due_at ?? null,
    completed_at: null,
    waiting_followup_at: data.waiting_followup_at ?? null,
    next_checkin_at: data.next_checkin_at ?? null,
    sort_order: data.sort_order ?? 0,
    task_type: data.task_type ?? 'task',
    created_at: timestamp,
    updated_at: timestamp
  };

  if (statusRow?.kind === TaskStatus.WAITING && !task.next_checkin_at) {
    const waitingTask = applyWaitingFollowup({ ...task, status: TaskStatus.WAITING }, new Date(), DEFAULT_WAITING_DAYS);
    task.next_checkin_at = waitingTask.next_checkin_at;
  }
  if (statusRow?.kind === TaskStatus.DONE && !task.completed_at) {
    task.completed_at = timestamp;
  }

  await db.transaction(async (tx) => {
    const insertColumns = [
      'id',
      'workspace_id',
      'parent_id',
      'project_id',
      'group_label',
      'title',
      'description_md',
      'status',
      'priority',
      'urgency',
      'type_label',
      'recurrence_interval',
      'recurrence_unit',
      'reminder_offset_days',
      'auto_debit',
      'reminder_sent_at',
      'recurrence_parent_id',
      'recurrence_generated_at',
      'template_id',
      'template_state',
      'template_event_date',
      'template_lead_days',
      'template_defer_until',
      'template_prompt_pending',
      'assignee_user_id',
      'assignee_label',
      'start_at',
      'due_at',
      'completed_at',
      'waiting_followup_at',
      'next_checkin_at',
      'sort_order',
      'task_type',
      'created_at',
      'updated_at'
    ];
    const insertValues = [
      task.id,
      task.workspace_id,
      task.parent_id,
      task.project_id,
      task.group_label,
      task.title,
      task.description_md,
      task.status,
      task.priority,
      task.urgency,
      task.type_label,
      task.recurrence_interval,
      task.recurrence_unit,
      task.reminder_offset_days,
      task.auto_debit,
      task.reminder_sent_at,
      task.recurrence_parent_id,
      task.recurrence_generated_at,
      task.template_id,
      task.template_state,
      task.template_event_date,
      task.template_lead_days,
      task.template_defer_until,
      task.template_prompt_pending,
      task.assignee_user_id,
      task.assignee_label,
      task.start_at,
      task.due_at,
      task.completed_at,
      task.waiting_followup_at,
      task.next_checkin_at,
      task.sort_order,
      task.task_type,
      task.created_at,
      task.updated_at
    ];
    const placeholders = insertColumns.map(() => '?').join(', ');
    await run(tx, `INSERT INTO tasks (${insertColumns.join(', ')}) VALUES (${placeholders})`, insertValues);

    // closure table inserts
    await run(tx, 'INSERT INTO task_edges (ancestor_id, descendant_id, depth) VALUES (?, ?, 0)', [id, id]);

    if (task.parent_id) {
      const ancestors = await getRows(
        tx,
        'SELECT ancestor_id, depth FROM task_edges WHERE descendant_id = ?',
        [task.parent_id]
      );
      for (const ancestor of ancestors) {
        await run(
          tx,
          'INSERT INTO task_edges (ancestor_id, descendant_id, depth) VALUES (?, ?, ?)',
          [ancestor.ancestor_id, id, ancestor.depth + 1]
        );
      }
    }

    await replaceTaskTags(tx, id, task.workspace_id, tags);
    await recordChange(tx, task.workspace_id, 'task', id, 'create', { ...task, tags }, clientId);
  });

  return getTask(db, id);
}

export async function getTask(db, id) {
  const taskId = assertUuid(id, 'task id');
  const task = await getRow(db, 'SELECT * FROM tasks WHERE id = ?', [taskId]);
  return attachTagsToTask(db, task);
}

export async function updateTask(db, id, patch, clientId = null) {
  const taskId = assertUuid(id, 'task id');
  const existing = await getTask(db, taskId);
  if (!existing) return null;
  const normalizedPatchTags = Object.prototype.hasOwnProperty.call(patch ?? {}, 'tags')
    ? normalizeTaskTagsInput(patch.tags)
    : undefined;
  const next = {
    ...existing,
    ...patch,
    id: existing.id,
    workspace_id: existing.workspace_id,
    parent_id: existing.parent_id,
    updated_at: nowIso()
  };

  if ('project_id' in patch) {
    next.project_id = optionalUuid(patch.project_id, 'project_id');
    if (next.project_id) {
      await assertProjectBelongsToWorkspace(db, next.project_id, existing.workspace_id, 'project_id');
    }
  }
  if ('template_id' in patch) {
    next.template_id = optionalUuid(patch.template_id, 'template_id');
    if (next.template_id) {
      await assertTemplateBelongsToWorkspace(db, next.template_id, existing.workspace_id, 'template_id');
    }
  }
  if ('recurrence_parent_id' in patch) {
    next.recurrence_parent_id = optionalUuid(patch.recurrence_parent_id, 'recurrence_parent_id');
    if (next.recurrence_parent_id) {
      await assertTaskBelongsToWorkspace(db, next.recurrence_parent_id, existing.workspace_id, 'recurrence_parent_id');
    }
  }
  if ('assignee_user_id' in patch || 'assignee_label' in patch) {
    const assignee = await normalizeTaskAssignee(
      db,
      existing.workspace_id,
      ('assignee_user_id' in patch) ? patch.assignee_user_id : existing.assignee_user_id,
      ('assignee_label' in patch) ? patch.assignee_label : existing.assignee_label
    );
    next.assignee_user_id = assignee.assignee_user_id;
    next.assignee_label = assignee.assignee_label;
  }

  if ('urgency' in patch) next.urgency = patch.urgency ? 1 : 0;
  if ('auto_debit' in patch) next.auto_debit = patch.auto_debit ? 1 : 0;
  if ('template_prompt_pending' in patch) next.template_prompt_pending = patch.template_prompt_pending ? 1 : 0;

  if (Object.prototype.hasOwnProperty.call(patch ?? {}, 'status')) {
    const statusInput = typeof patch.status === 'string' ? patch.status.trim() : '';
    next.status = statusInput || '';
    if (next.status !== existing.status) {
      let statusRow = null;
      if (next.status) {
        statusRow = await getStatusByKey(db, existing.workspace_id, next.status);
        if (!statusRow) {
          throw new Error('Invalid status');
        }
      }
      if (statusRow?.kind === TaskStatus.WAITING) {
        const explicitFollowup = patch.next_checkin_at ?? patch.waiting_followup_at ?? null;
        if (explicitFollowup) {
          next.next_checkin_at = explicitFollowup;
        } else {
          const waitingTask = applyWaitingFollowup({ ...next, status: TaskStatus.WAITING }, new Date(), DEFAULT_WAITING_DAYS);
          next.next_checkin_at = waitingTask.next_checkin_at;
        }
      }
      if (statusRow?.kind === TaskStatus.DONE) {
        next.completed_at = next.completed_at ?? nowIso();
      }
      if ((statusRow?.kind ?? null) !== TaskStatus.DONE && !('completed_at' in patch)) {
        next.completed_at = null;
      }
    }
  }

  const fields = [
    'title', 'description_md', 'type_label', 'recurrence_interval', 'recurrence_unit', 'reminder_offset_days',
    'auto_debit', 'reminder_sent_at', 'recurrence_parent_id', 'recurrence_generated_at',
    'template_id', 'template_state', 'template_event_date', 'template_lead_days', 'template_defer_until', 'template_prompt_pending',
    'assignee_user_id', 'assignee_label',
    'status', 'priority', 'urgency', 'start_at', 'due_at', 'completed_at',
    'waiting_followup_at', 'next_checkin_at', 'sort_order', 'task_type', 'project_id', 'group_label'
  ];
  const values = fields.map(field => next[field]);
  await db.transaction(async (tx) => {
    await run(
      tx,
      `UPDATE tasks SET ${fields.map(field => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      [...values, next.updated_at, taskId]
    );
    if (normalizedPatchTags !== undefined) {
      await replaceTaskTags(tx, taskId, next.workspace_id, normalizedPatchTags);
    }
    const changePayload = normalizedPatchTags === undefined
      ? patch
      : { ...patch, tags: normalizedPatchTags };
    await recordChange(tx, next.workspace_id, 'task', taskId, 'update', changePayload, clientId);
  });
  return getTask(db, taskId);
}

export async function deleteTask(db, id, clientId = null) {
  const taskId = assertUuid(id, 'task id');
  const existing = await getTask(db, taskId);
  if (!existing) return { deleted: 0 };
  const descendants = await getRows(
    db,
    'SELECT descendant_id FROM task_edges WHERE ancestor_id = ?',
    [taskId]
  );
  const ids = descendants.map(row => row.descendant_id);
  if (ids.length === 0) return { deleted: 0 };

  const placeholders = ids.map(() => '?').join(',');
  await db.transaction(async (tx) => {
    await run(tx, `DELETE FROM tasks WHERE id IN (${placeholders})`, ids);
  });

  await recordChange(db, existing.workspace_id, 'task', taskId, 'delete', { ids }, clientId);
  return { deleted: ids.length, ids };
}

async function getAgentEventRowByDedupe(db, workspaceId, targetAgent, dedupeKey) {
  if (!dedupeKey) return null;
  return getRow(
    db,
    `SELECT *
       FROM agent_events
      WHERE workspace_id = ?
        AND dedupe_key = ?
        AND COALESCE(target_agent, '') = ?
      LIMIT 1`,
    [workspaceId, dedupeKey, targetAgent ?? '']
  );
}

export async function getAgentEvent(db, id) {
  const eventId = assertUuid(id, 'agent event id');
  const row = await getRow(db, 'SELECT * FROM agent_events WHERE id = ?', [eventId]);
  return parseAgentEventRow(row);
}

export async function listAgentEvents(
  db,
  {
    workspace_id: workspaceId,
    target_agent: targetAgent = undefined,
    source_agent: sourceAgent = undefined,
    status = undefined,
    event_type: eventType = undefined,
    limit = undefined,
    cursor = undefined
  } = {}
) {
  if (!workspaceId) {
    return {
      events: [],
      next_cursor: null
    };
  }

  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  const safeTargetAgent = targetAgent === undefined
    ? undefined
    : normalizeOptionalText(targetAgent, 'target_agent', 128);
  const safeSourceAgent = sourceAgent === undefined
    ? undefined
    : normalizeOptionalText(sourceAgent, 'source_agent', 128);
  const safeStatus = status === undefined
    ? undefined
    : normalizeAgentEventStatus(status, { allowUndefined: false });
  const safeEventType = eventType === undefined
    ? undefined
    : normalizeOptionalText(eventType, 'event_type', 128);
  const safeLimit = normalizeAgentEventListLimit(limit);
  const safeCursor = cursor === undefined ? null : decodeAgentEventCursor(cursor);

  const where = ['workspace_id = ?'];
  const params = [safeWorkspaceId];

  if (safeTargetAgent !== undefined) {
    if (safeTargetAgent === null) {
      where.push('target_agent IS NULL');
    } else {
      where.push('target_agent = ?');
      params.push(safeTargetAgent);
    }
  }
  if (safeSourceAgent !== undefined) {
    if (safeSourceAgent === null) {
      where.push('source_agent IS NULL');
    } else {
      where.push('source_agent = ?');
      params.push(safeSourceAgent);
    }
  }
  if (safeStatus !== undefined) {
    where.push('status = ?');
    params.push(safeStatus);
  }
  if (safeEventType !== undefined) {
    if (safeEventType === null) {
      where.push('event_type IS NULL');
    } else {
      where.push('event_type = ?');
      params.push(safeEventType);
    }
  }
  if (safeCursor) {
    where.push('(created_at > ? OR (created_at = ? AND id > ?))');
    params.push(safeCursor.created_at, safeCursor.created_at, safeCursor.id);
  }

  const rows = await getRows(
    db,
    `SELECT *
       FROM agent_events
      WHERE ${where.join(' AND ')}
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    [...params, safeLimit + 1]
  );
  const hasMore = rows.length > safeLimit;
  const visibleRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const events = visibleRows.map(parseAgentEventRow);
  return {
    events,
    next_cursor: hasMore ? encodeAgentEventCursor(visibleRows[visibleRows.length - 1]) : null
  };
}

export async function createAgentEvent(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getAgentEvent(db, assertUuid(data.id, 'agent event id'));
    if (existing) return existing;
  }

  const id = ensureUuid(data?.id, 'agent event id');
  const workspaceId = await assertWorkspaceExists(db, data?.workspace_id);
  const sourceAgent = normalizeRequiredText(data?.source_agent, 'source_agent', 128);
  const targetAgent = normalizeOptionalText(data?.target_agent, 'target_agent', 128);
  const eventType = normalizeRequiredText(data?.event_type, 'event_type', 128);
  const payloadObject = normalizeAgentEventPayload(data?.payload_json);
  const status = normalizeAgentEventStatus(data?.status, { allowUndefined: false });
  const priority = normalizeAgentEventPriority(data?.priority);
  const dedupeKey = normalizeOptionalText(data?.dedupe_key, 'dedupe_key', 256) ?? null;
  const timestamp = nowIso();

  if (dedupeKey) {
    const existing = await getAgentEventRowByDedupe(db, workspaceId, targetAgent, dedupeKey);
    if (existing) {
      return parseAgentEventRow(existing);
    }
  }

  const event = {
    id,
    workspace_id: workspaceId,
    source_agent: sourceAgent,
    target_agent: targetAgent,
    event_type: eventType,
    payload_json: JSON.stringify(payloadObject),
    status,
    priority,
    dedupe_key: dedupeKey,
    created_at: timestamp,
    updated_at: timestamp,
    handled_at: normalizeDateTime(data?.handled_at, 'handled_at') ?? null,
    error_text: normalizeOptionalText(data?.error_text, 'error_text', 4000) ?? null
  };

  if (!event.handled_at && event.status !== AGENT_EVENT_STATUS_PENDING) {
    event.handled_at = timestamp;
  }

  try {
    await db.transaction(async (tx) => {
      await run(
        tx,
        `INSERT INTO agent_events (
          id, workspace_id, source_agent, target_agent, event_type, payload_json,
          status, priority, dedupe_key, created_at, updated_at, handled_at, error_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          event.workspace_id,
          event.source_agent,
          event.target_agent,
          event.event_type,
          event.payload_json,
          event.status,
          event.priority,
          event.dedupe_key,
          event.created_at,
          event.updated_at,
          event.handled_at,
          event.error_text
        ]
      );
      await recordChange(
        tx,
        event.workspace_id,
        'agent_event',
        event.id,
        'create',
        parseAgentEventRow(event),
        clientId
      );
    });
  } catch (error) {
    if (dedupeKey && /UNIQUE constraint failed/i.test(String(error?.message ?? ''))) {
      const existing = await getAgentEventRowByDedupe(db, workspaceId, targetAgent, dedupeKey);
      if (existing) {
        return parseAgentEventRow(existing);
      }
    }
    throw error;
  }

  return getAgentEvent(db, id);
}

export async function updateAgentEvent(db, id, patch, clientId = null) {
  const eventId = assertUuid(id, 'agent event id');
  const existing = await getAgentEvent(db, eventId);
  if (!existing) return null;

  const nextStatus = Object.prototype.hasOwnProperty.call(patch ?? {}, 'status')
    ? normalizeAgentEventStatus(patch.status, { allowUndefined: false })
    : existing.status;
  const hasHandledAt = Object.prototype.hasOwnProperty.call(patch ?? {}, 'handled_at');
  const hasErrorText = Object.prototype.hasOwnProperty.call(patch ?? {}, 'error_text');
  const normalizedHandledAt = hasHandledAt
    ? normalizeDateTime(patch.handled_at, 'handled_at')
    : undefined;
  const normalizedErrorText = hasErrorText
    ? normalizeOptionalText(patch.error_text, 'error_text', 4000)
    : undefined;
  const updatedAt = nowIso();

  let handledAt = hasHandledAt ? normalizedHandledAt : existing.handled_at;
  if (!hasHandledAt && Object.prototype.hasOwnProperty.call(patch ?? {}, 'status')) {
    if (nextStatus === AGENT_EVENT_STATUS_PENDING) {
      handledAt = null;
    } else {
      handledAt = existing.handled_at ?? updatedAt;
    }
  }

  const next = {
    ...existing,
    status: nextStatus,
    updated_at: updatedAt,
    handled_at: handledAt,
    error_text: hasErrorText ? normalizedErrorText : existing.error_text
  };

  const changePayload = {};
  if (Object.prototype.hasOwnProperty.call(patch ?? {}, 'status')) {
    changePayload.status = next.status;
  }
  if (hasHandledAt || handledAt !== existing.handled_at) {
    changePayload.handled_at = next.handled_at;
  }
  if (hasErrorText) {
    changePayload.error_text = next.error_text;
  }

  await db.transaction(async (tx) => {
    await run(
      tx,
      'UPDATE agent_events SET status = ?, updated_at = ?, handled_at = ?, error_text = ? WHERE id = ?',
      [next.status, next.updated_at, next.handled_at, next.error_text, eventId]
    );
    await recordChange(tx, existing.workspace_id, 'agent_event', eventId, 'update', changePayload, clientId);
  });

  return getAgentEvent(db, eventId);
}

export async function getAdminAction(db, id) {
  const actionId = assertUuid(id, 'admin action id');
  const row = await getRow(db, 'SELECT * FROM admin_actions WHERE id = ?', [actionId]);
  return parseAdminActionRow(row);
}

export async function listAdminActions(
  db,
  {
    org_id: orgId = undefined,
    workspace_id: workspaceId = undefined,
    status = undefined,
    action_type: actionType = undefined,
    requested_by_type: requestedByType = undefined,
    limit = undefined
  } = {}
) {
  const safeWorkspaceId = workspaceId === undefined ? undefined : optionalUuid(workspaceId, 'workspace_id');
  const safeOrgId = orgId === undefined ? undefined : assertUuid(orgId, 'org_id');
  const safeStatus = status === undefined ? undefined : normalizeAdminActionStatus(status, { allowUndefined: false });
  const safeActionType = actionType === undefined ? undefined : normalizeOptionalText(actionType, 'action_type', 128);
  const safeRequestedByType = requestedByType === undefined ? undefined : normalizeOptionalText(requestedByType, 'requested_by_type', 32);
  const safeLimit = normalizeAdminActionListLimit(limit);
  const where = [];
  const params = [];

  if (safeWorkspaceId) {
    where.push('workspace_id = ?');
    params.push(safeWorkspaceId);
  }
  if (safeOrgId) {
    where.push('org_id = ?');
    params.push(safeOrgId);
  }
  if (safeStatus) {
    where.push('status = ?');
    params.push(safeStatus);
  }
  if (safeActionType !== undefined) {
    if (safeActionType === null) {
      where.push('action_type IS NULL');
    } else {
      where.push('action_type = ?');
      params.push(safeActionType);
    }
  }
  if (safeRequestedByType !== undefined) {
    if (safeRequestedByType === null) {
      where.push('requested_by_type IS NULL');
    } else {
      where.push('requested_by_type = ?');
      params.push(safeRequestedByType);
    }
  }
  const sql = [
    'SELECT * FROM admin_actions',
    where.length ? `WHERE ${where.join(' AND ')}` : '',
    'ORDER BY created_at DESC, id DESC',
    'LIMIT ?'
  ].filter(Boolean).join(' ');
  const rows = await getRows(db, sql, [...params, safeLimit]);
  return rows.map(parseAdminActionRow);
}

export async function createAdminAction(db, data = {}) {
  const orgId = assertUuid(data?.org_id, 'org_id');
  const workspaceId = data?.workspace_id === undefined || data?.workspace_id === null || data?.workspace_id === ''
    ? null
    : await assertWorkspaceExists(db, data.workspace_id);
  if (workspaceId) {
    const workspace = await getWorkspaceRow(db, workspaceId);
    if (workspace.org_id !== orgId) {
      throw new Error('workspace_id does not belong to org_id');
    }
  }
  const action = {
    id: ensureUuid(data?.id, 'admin action id'),
    org_id: orgId,
    workspace_id: workspaceId,
    requested_by_type: normalizeRequiredText(data?.requested_by_type, 'requested_by_type', 32).toLowerCase(),
    requested_by_id: normalizeOptionalText(data?.requested_by_id, 'requested_by_id', 128) ?? null,
    requested_by_label: normalizeRequiredText(data?.requested_by_label, 'requested_by_label', 256),
    source_channel: normalizeOptionalText(data?.source_channel, 'source_channel', 256) ?? null,
    source_principal: normalizeOptionalText(data?.source_principal, 'source_principal', 512) ?? null,
    action_type: normalizeRequiredText(data?.action_type, 'action_type', 128),
    target: normalizeOptionalText(data?.target, 'target', 512) ?? null,
    arguments_json: JSON.stringify(normalizeJsonObject(data?.arguments_json, 'arguments_json')),
    approval_mode: normalizeAdminActionApprovalMode(data?.approval_mode),
    status: normalizeAdminActionStatus(data?.status, { allowUndefined: false }),
    approved_by_type: normalizeOptionalText(data?.approved_by_type, 'approved_by_type', 32) ?? null,
    approved_by_id: normalizeOptionalText(data?.approved_by_id, 'approved_by_id', 128) ?? null,
    approved_by_label: normalizeOptionalText(data?.approved_by_label, 'approved_by_label', 256) ?? null,
    result_json: data?.result_json === undefined
      ? null
      : (() => {
        const normalized = normalizeJsonObject(data?.result_json, 'result_json', { allowNull: true, defaultValue: {} });
        return normalized === null ? null : JSON.stringify(normalized);
      })(),
    error_text: normalizeOptionalText(data?.error_text, 'error_text', 4000) ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
    approved_at: normalizeDateTime(data?.approved_at, 'approved_at') ?? null,
    executed_at: normalizeDateTime(data?.executed_at, 'executed_at') ?? null
  };

  if (!action.approved_at && action.status === ADMIN_ACTION_STATUS_APPROVED) {
    action.approved_at = action.updated_at;
  }
  if (!action.executed_at && action.status === ADMIN_ACTION_STATUS_EXECUTED) {
    action.executed_at = action.updated_at;
  }

  await run(
    db,
    `INSERT INTO admin_actions (
      id, org_id, workspace_id, requested_by_type, requested_by_id, requested_by_label,
      source_channel, source_principal, action_type, target, arguments_json,
      approval_mode, status, approved_by_type, approved_by_id, approved_by_label,
      result_json, error_text, created_at, updated_at, approved_at, executed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      action.id,
      action.org_id,
      action.workspace_id,
      action.requested_by_type,
      action.requested_by_id,
      action.requested_by_label,
      action.source_channel,
      action.source_principal,
      action.action_type,
      action.target,
      action.arguments_json,
      action.approval_mode,
      action.status,
      action.approved_by_type,
      action.approved_by_id,
      action.approved_by_label,
      action.result_json,
      action.error_text,
      action.created_at,
      action.updated_at,
      action.approved_at,
      action.executed_at
    ]
  );

  return getAdminAction(db, action.id);
}

export async function updateAdminAction(db, id, patch = {}) {
  const actionId = assertUuid(id, 'admin action id');
  const existing = await getAdminAction(db, actionId);
  if (!existing) return null;

  const hasStatus = Object.prototype.hasOwnProperty.call(patch ?? {}, 'status');
  const hasApprovalMode = Object.prototype.hasOwnProperty.call(patch ?? {}, 'approval_mode');
  const hasErrorText = Object.prototype.hasOwnProperty.call(patch ?? {}, 'error_text');
  const hasResultJson = Object.prototype.hasOwnProperty.call(patch ?? {}, 'result_json');
  const hasExecutedAt = Object.prototype.hasOwnProperty.call(patch ?? {}, 'executed_at');
  const hasApprovedByType = Object.prototype.hasOwnProperty.call(patch ?? {}, 'approved_by_type');
  const hasApprovedById = Object.prototype.hasOwnProperty.call(patch ?? {}, 'approved_by_id');
  const hasApprovedByLabel = Object.prototype.hasOwnProperty.call(patch ?? {}, 'approved_by_label');
  const hasApprovedAt = Object.prototype.hasOwnProperty.call(patch ?? {}, 'approved_at');

  const next = {
    ...existing,
    status: hasStatus
      ? normalizeAdminActionStatus(patch.status, { allowUndefined: false })
      : existing.status,
    approval_mode: hasApprovalMode
      ? normalizeAdminActionApprovalMode(patch.approval_mode)
      : existing.approval_mode,
    error_text: hasErrorText
      ? (normalizeOptionalText(patch.error_text, 'error_text', 4000) ?? null)
      : existing.error_text,
    result_json: hasResultJson
      ? normalizeJsonObject(patch.result_json, 'result_json', { allowNull: true, defaultValue: {} })
      : existing.result_json,
    executed_at: hasExecutedAt
      ? (normalizeDateTime(patch.executed_at, 'executed_at') ?? null)
      : existing.executed_at,
    approved_by_type: hasApprovedByType
      ? (normalizeOptionalText(patch.approved_by_type, 'approved_by_type', 32) ?? null)
      : existing.approved_by_type,
    approved_by_id: hasApprovedById
      ? (normalizeOptionalText(patch.approved_by_id, 'approved_by_id', 128) ?? null)
      : existing.approved_by_id,
    approved_by_label: hasApprovedByLabel
      ? (normalizeOptionalText(patch.approved_by_label, 'approved_by_label', 256) ?? null)
      : existing.approved_by_label,
    approved_at: hasApprovedAt
      ? (normalizeDateTime(patch.approved_at, 'approved_at') ?? null)
      : existing.approved_at,
    updated_at: nowIso()
  };

  if (hasStatus) {
    if (next.status === ADMIN_ACTION_STATUS_APPROVED && !next.approved_at) {
      next.approved_at = next.updated_at;
    }
    if (next.status === ADMIN_ACTION_STATUS_EXECUTED && !next.executed_at) {
      next.executed_at = next.updated_at;
    }
  }

  await run(
    db,
    `UPDATE admin_actions
        SET status = ?, approval_mode = ?, approved_by_type = ?, approved_by_id = ?, approved_by_label = ?,
            approved_at = ?, executed_at = ?, result_json = ?, error_text = ?, updated_at = ?
      WHERE id = ?`,
    [
      next.status,
      next.approval_mode,
      next.approved_by_type,
      next.approved_by_id,
      next.approved_by_label,
      next.approved_at,
      next.executed_at,
      next.result_json === null ? null : JSON.stringify(next.result_json),
      next.error_text,
      next.updated_at,
      actionId
    ]
  );

  return getAdminAction(db, actionId);
}

export async function listTasks(db, workspaceId) {
  if (!workspaceId) return [];
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  const rows = await getRows(db, 'SELECT * FROM tasks WHERE workspace_id = ?', [safeWorkspaceId]);
  return attachTagsToTasks(db, rows);
}

export async function listTaskDependencies(db, workspaceId) {
  if (!workspaceId) return [];
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  return getRows(db, 'SELECT * FROM task_dependencies WHERE workspace_id = ?', [safeWorkspaceId]);
}

export async function addTaskDependency(db, taskId, dependsOnId, clientId = null) {
  const safeTaskId = assertUuid(taskId, 'task_id');
  const safeDependsOnId = assertUuid(dependsOnId, 'depends_on_id');
  if (safeTaskId === safeDependsOnId) throw new Error('Task cannot depend on itself');
  const task = await getTask(db, safeTaskId);
  const dependency = await getTask(db, safeDependsOnId);
  if (!task || !dependency) throw new Error('Task not found');
  if (task.workspace_id !== dependency.workspace_id) {
    throw new Error('Tasks must be in the same workspace');
  }
  const existing = await getRow(
    db,
    'SELECT 1 FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?',
    [safeTaskId, safeDependsOnId]
  );
  if (existing) return { task_id: safeTaskId, depends_on_id: safeDependsOnId, workspace_id: task.workspace_id };
  const created_at = nowIso();
  await run(
    db,
    'INSERT INTO task_dependencies (task_id, depends_on_id, workspace_id, created_at) VALUES (?, ?, ?, ?)',
    [safeTaskId, safeDependsOnId, task.workspace_id, created_at]
  );
  await recordChange(
    db,
    task.workspace_id,
    'task_dependency',
    `${safeTaskId}:${safeDependsOnId}`,
    'create',
    { task_id: safeTaskId, depends_on_id: safeDependsOnId },
    clientId
  );
  return { task_id: safeTaskId, depends_on_id: safeDependsOnId, workspace_id: task.workspace_id, created_at };
}

export async function removeTaskDependency(db, taskId, dependsOnId, clientId = null) {
  const safeTaskId = assertUuid(taskId, 'task_id');
  const safeDependsOnId = assertUuid(dependsOnId, 'depends_on_id');
  const task = await getTask(db, safeTaskId);
  if (!task) throw new Error('Task not found');
  const existing = await getRow(
    db,
    'SELECT 1 FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?',
    [safeTaskId, safeDependsOnId]
  );
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?', [safeTaskId, safeDependsOnId]);
  await recordChange(
    db,
    task.workspace_id,
    'task_dependency',
    `${safeTaskId}:${safeDependsOnId}`,
    'delete',
    { task_id: safeTaskId, depends_on_id: safeDependsOnId },
    clientId
  );
  return { deleted: 1 };
}

export async function getTaskTree(db, workspaceId, rootId = null) {
  let tasks;
  if (rootId) {
    const safeRootId = assertUuid(rootId, 'root_id');
    const descendants = await getRows(
      db,
      'SELECT descendant_id FROM task_edges WHERE ancestor_id = ?',
      [safeRootId]
    );
    const ids = descendants.map(row => row.descendant_id);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    tasks = await getRows(db, `SELECT * FROM tasks WHERE id IN (${placeholders})`, ids);
    if (workspaceId) {
      const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
      tasks = tasks.filter(task => task.workspace_id === safeWorkspaceId);
    }
  } else {
    tasks = await listTasks(db, workspaceId);
  }
  tasks = await attachTagsToTasks(db, tasks);

  const tree = buildAdjacency(tasks);
  tree.forEach(sortTreeByPriority);
  return tree;
}

function sortTreeByPriority(node) {
  node.children.sort(compareTasksByPriority);
  node.children.forEach(sortTreeByPriority);
}

export async function reparentTask(db, taskId, newParentId, clientId = null) {
  const safeTaskId = assertUuid(taskId, 'task id');
  const safeNewParentId = optionalUuid(newParentId, 'new_parent_id');
  if (safeTaskId === safeNewParentId) throw new Error('Cannot reparent task under itself');
  const sourceTask = await getTask(db, safeTaskId);
  if (!sourceTask) throw new Error('Task not found');

  if (safeNewParentId) {
    await assertTaskBelongsToWorkspace(db, safeNewParentId, sourceTask.workspace_id, 'new_parent_id');
  }

  if (safeNewParentId) {
    const cycle = await getRow(
      db,
      'SELECT 1 FROM task_edges WHERE ancestor_id = ? AND descendant_id = ? LIMIT 1',
      [safeTaskId, safeNewParentId]
    );
    if (cycle) throw new Error('Cannot reparent task under its descendant');
  }

  const descendants = await getRows(
    db,
    'SELECT descendant_id, depth FROM task_edges WHERE ancestor_id = ?',
    [safeTaskId]
  );
  const ancestorRows = await getRows(
    db,
    'SELECT ancestor_id, depth FROM task_edges WHERE descendant_id = ? AND depth > 0',
    [safeTaskId]
  );

  await db.transaction(async (tx) => {
    if (ancestorRows.length && descendants.length) {
      const ancestorIds = ancestorRows.map(row => row.ancestor_id);
      const descendantIds = descendants.map(row => row.descendant_id);
      const ancestorPlaceholders = ancestorIds.map(() => '?').join(',');
      const descendantPlaceholders = descendantIds.map(() => '?').join(',');
      await run(
        tx,
        `DELETE FROM task_edges WHERE ancestor_id IN (${ancestorPlaceholders}) AND descendant_id IN (${descendantPlaceholders})`,
        [...ancestorIds, ...descendantIds]
      );
    }

    if (safeNewParentId) {
      const newAncestors = await getRows(
        tx,
        'SELECT ancestor_id, depth FROM task_edges WHERE descendant_id = ?',
        [safeNewParentId]
      );
      for (const ancestor of newAncestors) {
        for (const descendant of descendants) {
          await run(
            tx,
            'INSERT INTO task_edges (ancestor_id, descendant_id, depth) VALUES (?, ?, ?)',
            [ancestor.ancestor_id, descendant.descendant_id, ancestor.depth + 1 + descendant.depth]
          );
        }
      }
    }

    await run(
      tx,
      'UPDATE tasks SET parent_id = ?, updated_at = ? WHERE id = ?',
      [safeNewParentId ?? null, nowIso(), safeTaskId]
    );
  });

  const updated = await getTask(db, safeTaskId);
  await recordChange(db, updated.workspace_id, 'task', safeTaskId, 'reparent', { new_parent_id: safeNewParentId }, clientId);
  return updated;
}

export async function applyTaskCheckIn(db, taskId, response, clientId = null) {
  const safeTaskId = assertUuid(taskId, 'task id');
  const task = await getTask(db, safeTaskId);
  if (!task) return null;
  if (response === 'no') {
    await rescheduleSubtree(db, safeTaskId, 24 * 60 * 60 * 1000, clientId);
  }
  const updated = applyCheckIn(task, response, new Date());

  await db.transaction(async (tx) => {
    await run(
      tx,
      'UPDATE tasks SET status = ?, completed_at = ?, next_checkin_at = ?, updated_at = ? WHERE id = ?',
      [updated.status, updated.completed_at, updated.next_checkin_at, nowIso(), safeTaskId]
    );
    const checkinId = randomUUID();
    await run(
      tx,
      'INSERT INTO task_checkins (id, task_id, scheduled_at, response, responded_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        checkinId,
        safeTaskId,
        task.next_checkin_at ?? nowIso(),
        response,
        nowIso(),
        nowIso()
      ]
    );
  });

  await recordChange(db, task.workspace_id, 'task', safeTaskId, 'checkin', { response }, clientId);
  return getTask(db, safeTaskId);
}

export async function rescheduleSubtree(db, taskId, deltaMs, clientId = null) {
  const safeTaskId = assertUuid(taskId, 'task id');
  const descendants = await getRows(
    db,
    'SELECT descendant_id FROM task_edges WHERE ancestor_id = ?',
    [safeTaskId]
  );
  const ids = descendants.map(row => row.descendant_id);
  if (ids.length === 0) return { updated: 0 };

  const placeholders = ids.map(() => '?').join(',');
  const tasks = await getRows(
    db,
    `SELECT id, start_at, due_at, next_checkin_at, workspace_id FROM tasks WHERE id IN (${placeholders})`,
    ids
  );
  await db.transaction(async (tx) => {
    for (const task of tasks) {
      const startAt = task.start_at ? new Date(task.start_at).getTime() + deltaMs : null;
      const dueAt = task.due_at ? new Date(task.due_at).getTime() + deltaMs : null;
      const nextCheck = task.next_checkin_at ? new Date(task.next_checkin_at).getTime() + deltaMs : null;
      await run(
        tx,
        'UPDATE tasks SET start_at = ?, due_at = ?, next_checkin_at = ?, updated_at = ? WHERE id = ?',
        [
          startAt ? new Date(startAt).toISOString() : null,
          dueAt ? new Date(dueAt).toISOString() : null,
          nextCheck ? new Date(nextCheck).toISOString() : null,
          nowIso(),
          task.id
        ]
      );
    }
  });

  if (tasks[0]) {
    await recordChange(db, tasks[0].workspace_id, 'task', safeTaskId, 'reschedule', { deltaMs }, clientId);
  }
  return { updated: tasks.length };
}

export async function searchTasks(db, workspaceId, { text, status, tag }) {
  const safeWorkspaceId = assertUuid(workspaceId, 'workspace_id');
  const params = [safeWorkspaceId];
  let where = 'workspace_id = ?';
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  if (text) {
    where += ' AND (title LIKE ? OR description_md LIKE ?)';
    const like = `%${text}%`;
    params.push(like, like);
  }
  if (tag) {
    where += ' AND id IN (SELECT task_id FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE lower(t.name) = lower(?))';
    params.push(String(tag).trim());
  }
  const rows = await getRows(db, `SELECT * FROM tasks WHERE ${where}`, params);
  return attachTagsToTasks(db, rows);
}
