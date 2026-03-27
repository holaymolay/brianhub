import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from './db.js';
import { getApiConfig } from './config.js';
import { attachRouteSchemas } from './routeSchemas.js';
import {
  createWorkspace,
  listWorkspaces,
  getOrg,
  listOrgs,
  createOrg,
  updateOrg,
  getOrgMembership,
  listOrgMembers,
  addOrgMember,
  updateOrgMember,
  removeOrgMember,
  transferOrgOwnership,
  listUsers,
  listUsersForAdmin,
  createUser,
  updateUser,
  getUserByEmail,
  getUserSettings,
  upsertUserSettings,
  deleteUserAccount,
  exportUserDataBundle,
  listUserInvites,
  createUserInvite,
  revokeUserInvite,
  listWorkspaceMemberships,
  createWorkspaceMembership,
  updateWorkspaceMembership,
  deleteWorkspaceMembership,
  updateWorkspace,
  deleteWorkspace,
  getProject,
  createProject,
  listProjects,
  updateProject,
  deleteProject,
  createTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  createShoppingList,
  listShoppingLists,
  updateShoppingList,
  deleteShoppingList,
  createShoppingItem,
  createShoppingItems,
  listShoppingItems,
  updateShoppingItem,
  deleteShoppingItem,
  convertTaskToShoppingItem,
  listStatuses,
  createStatus,
  updateStatus,
  deleteStatus,
  listTaskTypes,
  createTaskType,
  updateTaskType,
  deleteTaskType,
  listNoticeTypes,
  createNoticeType,
  updateNoticeType,
  deleteNoticeType,
  listNotices,
  createNotice,
  updateNotice,
  deleteNotice,
  listStoreRules,
  createStoreRule,
  updateStoreRule,
  deleteStoreRule,
  createTask,
  getTask,
  updateTask,
  deleteTask,
  getAgentEvent,
  listAgentEvents,
  createAgentEvent,
  updateAgentEvent,
  getAdminAction,
  listAdminActions,
  createAdminAction,
  updateAdminAction,
  listTasks,
  listTaskDependencies,
  addTaskDependency,
  removeTaskDependency,
  getTaskTree,
  reparentTask,
  applyTaskCheckIn,
  rescheduleSubtree,
  searchTasks,
  recordChange
} from './taskService.js';
import { sendInviteEmail } from './email.js';
import {
  acceptInviteRegistration,
  loginWithPassword,
  listUserWorkspaces,
  resolveSessionUser,
  revokeSessionByToken,
  setUserPassword,
} from './authService.js';
import {
  createServiceAccount,
  createServiceAccountToken,
  createServiceAccountWorkspaceGrant,
  listServiceAccountActivity,
  listServiceAccounts,
  listServiceAccountTokens,
  listServiceAccountWorkspaceGrants,
  listServiceAccountWorkspaces,
  recordServiceAccountActivity,
  resolveServiceAccountToken,
  revokeApiToken,
  revokeServiceAccountWorkspaceGrant,
  rotateApiToken,
  serviceAccountHasWorkspaceAccess,
  updateApiToken,
  updateServiceAccount
} from './serviceAuth.js';
import {
  ALL_PERMISSION_KEYS,
  hasPermission as permissionSetHasPermission
} from './permissionRegistry.js';

export const config = getApiConfig();

export const server = Fastify({
  logger: {
    level: config.logLevel
  },
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'requestId',
  genReqId: (request) => {
    const incoming = String(request.headers['x-request-id'] ?? '').trim();
    return incoming || randomUUID();
  }
});
export const db = await openDb({ filename: config.dbPath });
await migrate(db, config.migrationsDir);
const OWNER_SUPER_ADMIN_EMAIL = config.ownerSuperAdminEmail;
const OWNER_SETTINGS_SINGLETON_ID = 1;
const DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000001';
const SERVICE_ACCOUNT_ROUTE_POLICIES = new Map([
  ['GET /auth/me', { permission: null }],
  ['GET /workspaces', { permission: 'workspaces.read' }],
  ['GET /projects', { permission: 'projects.read' }],
  ['POST /projects', { permission: 'projects.create' }],
  ['PATCH /projects/:id', { permission: 'projects.update' }],
  ['DELETE /projects/:id', { permission: 'projects.delete' }],
  ['POST /tasks/:id/convert-to-shopping-item', { permission: 'tasks.delete' }],
  ['POST /tasks', { permission: 'tasks.create' }],
  ['GET /tasks/:id', { permission: 'tasks.read' }],
  ['PATCH /tasks/:id', { permission: 'tasks.update' }],
  ['DELETE /tasks/:id', { permission: 'tasks.delete' }],
  ['GET /tasks', { permission: 'tasks.read' }],
  ['GET /task-dependencies', { permission: 'tasks.read' }],
  ['POST /task-dependencies', { permission: 'tasks.update' }],
  ['DELETE /task-dependencies/:taskId/:dependsOnId', { permission: 'tasks.update' }],
  ['GET /tasks/tree', { permission: 'tasks.read' }],
  ['POST /tasks/:id/reparent', { permission: 'tasks.update' }],
  ['POST /tasks/:id/checkin', { permission: 'tasks.update' }],
  ['POST /tasks/:id/reschedule', { permission: 'tasks.update' }],
  ['POST /tasks/search', { permission: 'tasks.read' }]
]);

let cachedOwnerEmail = null;
let ownerEmailCacheLoaded = false;

function normalizeEmail(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return null;
  return text;
}

function normalizeOrgRole(value) {
  const role = String(value ?? '').trim().toLowerCase();
  if (!role) return 'member';
  return role === 'admin' ? 'admin' : 'member';
}

function isOwnerEmail(email, ownerEmail) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedOwnerEmail = normalizeEmail(ownerEmail);
  return Boolean(normalizedEmail && normalizedOwnerEmail && normalizedEmail === normalizedOwnerEmail);
}

async function getCurrentOwnerEmail({ forceRefresh = false } = {}) {
  if (!forceRefresh && ownerEmailCacheLoaded && cachedOwnerEmail) {
    return cachedOwnerEmail;
  }
  try {
    const row = await db.queryOne(
      'SELECT owner_email FROM app_owner_settings WHERE singleton_id = ? LIMIT 1',
      [OWNER_SETTINGS_SINGLETON_ID]
    );
    const fromDb = normalizeEmail(row?.owner_email ?? null);
    cachedOwnerEmail = fromDb ?? OWNER_SUPER_ADMIN_EMAIL;
    ownerEmailCacheLoaded = true;
    return cachedOwnerEmail;
  } catch {
    // In case migrations are still catching up, fall back to configured owner.
    cachedOwnerEmail = OWNER_SUPER_ADMIN_EMAIL;
    ownerEmailCacheLoaded = true;
    return cachedOwnerEmail;
  }
}

async function setCurrentOwnerEmail(nextOwnerEmail) {
  const normalizedOwnerEmail = normalizeEmail(nextOwnerEmail);
  if (!normalizedOwnerEmail) {
    throw new Error('Valid owner email is required');
  }
  const timestamp = new Date().toISOString();
  await db.transaction(async (tx) => {
    const existing = await tx.queryOne(
      'SELECT singleton_id FROM app_owner_settings WHERE singleton_id = ? LIMIT 1',
      [OWNER_SETTINGS_SINGLETON_ID]
    );
    if (existing) {
      await tx.exec(
        'UPDATE app_owner_settings SET owner_email = ?, updated_at = ? WHERE singleton_id = ?',
        [normalizedOwnerEmail, timestamp, OWNER_SETTINGS_SINGLETON_ID]
      );
    } else {
      await tx.exec(
        `INSERT INTO app_owner_settings (singleton_id, owner_email, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        [OWNER_SETTINGS_SINGLETON_ID, normalizedOwnerEmail, timestamp, timestamp]
      );
    }
  });
  cachedOwnerEmail = normalizedOwnerEmail;
  ownerEmailCacheLoaded = true;
  return normalizedOwnerEmail;
}

async function ensureOwnerRoleForUser(user, clientId = null) {
  if (!user?.id || !user?.email) return user ?? null;
  const ownerEmail = await getCurrentOwnerEmail();
  if (!isOwnerEmail(user.email, ownerEmail)) return user;
  if (normalizeOrgRole(user.org_role) === 'admin') return user;
  const updated = await updateUser(db, user.id, { org_role: 'admin' }, clientId);
  return updated ?? user;
}

async function ensureOwnerBootstrap() {
  const currentOwnerEmail = await getCurrentOwnerEmail({ forceRefresh: true });
  const normalizedOwnerEmail = await setCurrentOwnerEmail(currentOwnerEmail);
  const ownerUser = await getUserByEmail(db, normalizedOwnerEmail);
  if (ownerUser) {
    await ensureOwnerRoleForUser(ownerUser, null);
  }
}

async function isWorkspaceMember(userId, workspaceId) {
  const safeUserId = String(userId ?? '').trim();
  const safeWorkspaceId = String(workspaceId ?? '').trim();
  if (!safeUserId || !safeWorkspaceId) return false;
  const membership = await db.queryOne(
    `SELECT id
       FROM workspace_memberships
      WHERE workspace_id = ? AND user_id = ? AND archived = 0
      LIMIT 1`,
    [safeWorkspaceId, safeUserId]
  );
  return Boolean(membership);
}

function mapStatusCodeToErrorCode(statusCode) {
  if (statusCode === 400) return 'BAD_REQUEST';
  if (statusCode === 401) return 'UNAUTHORIZED';
  if (statusCode === 403) return 'FORBIDDEN';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 409) return 'CONFLICT';
  if (statusCode === 422) return 'UNPROCESSABLE_ENTITY';
  if (statusCode === 429) return 'RATE_LIMITED';
  return statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
}

function parseBooleanish(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function getCorsOrigin(originHeader) {
  const allowedOrigins = config.corsOrigins ?? ['*'];
  const origin = String(originHeader ?? '').trim();
  if (allowedOrigins.includes('*')) {
    return origin || '*';
  }
  if (!origin) return allowedOrigins[0] ?? '';
  if (allowedOrigins.includes(origin)) return origin;
  return '';
}

function parsePayloadAsObject(payload) {
  if (!payload) return null;
  if (typeof payload === 'object') return payload;
  if (typeof payload !== 'string') return null;
  const trimmed = payload.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

class SyncConflictError extends Error {
  constructor(message, conflict) {
    super(message);
    this.name = 'SyncConflictError';
    this.code = 'CONFLICT';
    this.statusCode = 409;
    this.conflict = conflict;
  }
}

async function isDuplicateSyncMutation(workspaceId, mutationId) {
  if (!workspaceId || !mutationId) return false;
  const row = await db.queryOne(
    'SELECT id FROM sync_mutations WHERE workspace_id = ? AND client_mutation_id = ? LIMIT 1',
    [workspaceId, mutationId]
  );
  return Boolean(row);
}

async function recordSyncMutation(workspaceId, clientId, mutationId) {
  await db.exec(
    'INSERT INTO sync_mutations (id, workspace_id, client_id, client_mutation_id) VALUES (?, ?, ?, ?)',
    [randomUUID(), workspaceId, clientId ?? null, mutationId]
  );
}

async function getTaskServerVersion(workspaceId, entityId) {
  const row = await db.queryOne(
    'SELECT id, updated_at FROM tasks WHERE workspace_id = ? AND id = ? LIMIT 1',
    [workspaceId, entityId]
  );
  if (!row) return null;
  return {
    entity_type: 'task',
    entity_id: row.id,
    updated_at: row.updated_at
  };
}

async function assertNoSyncConflict(workspaceId, change) {
  if (!workspaceId || !change || change.entity_type !== 'task') return;
  if (change.action === 'create') return;
  const expectedUpdatedAt = String(
    change?.payload?.expected_updated_at
      ?? change?.payload?.updated_at_expected
      ?? ''
  ).trim();
  if (!expectedUpdatedAt) return;
  const entityId = String(change.entity_id ?? '').trim();
  if (!entityId) return;
  const serverVersion = await getTaskServerVersion(workspaceId, entityId);
  if (!serverVersion) {
    throw new SyncConflictError('Entity no longer exists', {
      entity_type: 'task',
      entity_id: entityId,
      reason: 'missing',
      server_version: null
    });
  }
  if (serverVersion.updated_at !== expectedUpdatedAt) {
    throw new SyncConflictError('Entity has changed on server', {
      entity_type: 'task',
      entity_id: entityId,
      reason: 'stale',
      server_version: serverVersion
    });
  }
}

const TRIM_SAFE_FIELDS = new Set([
  'name',
  'title',
  'label',
  'email',
  'display_name',
  'org_name',
  'store_name',
  'workspace_id',
  'org_id',
  'user_id',
  'project_id',
  'list_id',
  'task_id',
  'depends_on_id',
  'client_id',
  'entity_type',
  'entity_id',
  'action',
  'status',
  'kind',
  'role',
  'org_role',
  'notice_type',
  'response',
  'owner_email',
  'source_agent',
  'target_agent',
  'event_type',
  'priority',
  'dedupe_key',
  'cursor'
]);

function sanitizeRequestValue(value, key = '') {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRequestValue(item, key));
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((childKey) => {
      value[childKey] = sanitizeRequestValue(value[childKey], childKey);
    });
    return value;
  }
  if (typeof value === 'string' && TRIM_SAFE_FIELDS.has(key)) {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value;
}

function getHeaderActorEmail(request) {
  return String(request.headers['x-actor-email'] ?? '').trim().toLowerCase();
}

function getBearerTokenFromRequest(request) {
  const header = String(request.headers.authorization ?? '').trim();
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { invalid: true, token: null };
  const token = String(match[1] ?? '').trim();
  if (!token) return { invalid: true, token: null };
  return { invalid: false, token };
}

function parseCookieHeader(cookieHeader) {
  const values = {};
  const header = String(cookieHeader ?? '').trim();
  if (!header) return values;
  const parts = header.split(';');
  for (const part of parts) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = part.slice(0, separatorIndex).trim();
    if (!key) continue;
    const rawValue = part.slice(separatorIndex + 1).trim();
    values[key] = rawValue;
  }
  return values;
}

function getSessionTokenFromRequest(request) {
  const cookies = parseCookieHeader(request.headers.cookie);
  const token = cookies[config.sessionCookieName];
  if (!token) return null;
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

function getServiceAccountRoutePolicy(request) {
  const routePath = String(request.routeOptions?.url ?? '').trim();
  const method = String(request.method ?? '').toUpperCase();
  return SERVICE_ACCOUNT_ROUTE_POLICIES.get(`${method} ${routePath}`) ?? null;
}

function getActorLabel(security) {
  if (security?.serviceAccount?.display_name) return security.serviceAccount.display_name;
  if (security?.machine?.display_name) return security.machine.display_name;
  if (security?.actor?.display_name) return security.actor.display_name;
  if (security?.user?.display_name) return security.user.display_name;
  if (security?.actor?.principal_id) return security.actor.principal_id;
  if (security?.actor?.email) return security.actor.email;
  return 'unknown';
}

function getAuditPrincipal(security) {
  if (security?.serviceAccount?.id || security?.actor?.service_account_id) {
    return {
      requested_by_type: 'service_account',
      requested_by_id: security.serviceAccount?.id ?? security.actor?.service_account_id ?? null,
      requested_by_label: getActorLabel(security),
      source_principal: security.serviceAccount?.aliases?.[0]?.alias_value ?? security.actor?.principal_id ?? null
    };
  }
  return {
    requested_by_type: 'user',
    requested_by_id: security?.user?.id ?? security?.actor?.user_id ?? null,
    requested_by_label: getActorLabel(security),
    source_principal: security?.actor?.email ?? null
  };
}

function getSessionCookieAttributes(expiresAtIso, maxAgeSeconds) {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  return `${config.sessionCookieName}=__VALUE__; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Expires=${new Date(expiresAtIso).toUTCString()}${secure}`;
}

function setSessionCookie(reply, sessionToken, expiresAtIso) {
  const expiresAtMs = Date.parse(expiresAtIso);
  const maxAgeSeconds = Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000))
    : config.sessionTtlDays * 24 * 60 * 60;
  const serialized = getSessionCookieAttributes(expiresAtIso, maxAgeSeconds).replace(
    '__VALUE__',
    encodeURIComponent(sessionToken)
  );
  reply.header('Set-Cookie', serialized);
}

function clearSessionCookie(reply) {
  const expiresAtIso = new Date(0).toISOString();
  const serialized = getSessionCookieAttributes(expiresAtIso, 0).replace('__VALUE__', '');
  reply.header('Set-Cookie', serialized);
}

async function resolveRequestActor(request) {
  if (request.actorResolved) {
    return request.actor ?? null;
  }
  let actor = null;
  request.invalidAuthorization = false;
  request.serviceAccountAuth = null;
  const bearerAuth = getBearerTokenFromRequest(request);
  if (bearerAuth) {
    if (bearerAuth.invalid) {
      request.invalidAuthorization = true;
    } else {
      const serviceAccountAuth = await resolveServiceAccountToken(db, bearerAuth.token);
      if (serviceAccountAuth?.service_account?.id) {
        actor = {
          source: 'bearer',
          type: 'service_account',
          principal_type: 'service_account',
          principal_id: serviceAccountAuth.service_account.id,
          display_name: serviceAccountAuth.service_account.display_name,
          email: null,
          user_id: null,
          service_account_id: serviceAccountAuth.service_account.id,
          org_id: serviceAccountAuth.service_account.org_id,
          org_role: 'member',
          session_id: null
        };
        request.serviceAccountAuth = serviceAccountAuth;
      } else {
        request.invalidAuthorization = true;
      }
    }
  }
  if (!actor && !request.invalidAuthorization) {
    const sessionToken = getSessionTokenFromRequest(request);
    if (sessionToken) {
      const session = await resolveSessionUser(db, sessionToken);
      if (session?.user?.email) {
        actor = {
          source: 'session',
          type: 'user',
          principal_type: 'user',
          principal_id: session.user.id,
          email: String(session.user.email).trim().toLowerCase(),
          user_id: session.user.id,
          service_account_id: null,
          org_id: session.user.org_id,
          org_role: normalizeOrgRole(session.user.org_role),
          session_id: session.session?.id ?? null
        };
        request.authSession = session;
      }
    }
  }
  if (!actor && !request.invalidAuthorization && config.allowHeaderActorAuth) {
    const fallbackEmail = getHeaderActorEmail(request);
      if (fallbackEmail) {
        actor = {
          source: 'header',
          type: 'user',
          principal_type: 'user',
          principal_id: null,
          email: fallbackEmail,
          user_id: null,
          service_account_id: null,
          org_id: null,
          org_role: 'member',
          session_id: null
      };
    }
  }
  if (actor?.email && !actor.user_id) {
    const userByEmail = await getUserByEmail(db, actor.email);
    if (userByEmail) {
      actor.user_id = userByEmail.id;
      actor.principal_id = userByEmail.id;
      actor.org_id = userByEmail.org_id;
      actor.org_role = normalizeOrgRole(userByEmail.org_role);
    }
  }
  request.actor = actor;
  request.actorResolved = true;
  return actor;
}

async function resolveActorSecurity(request) {
  if (request.actorSecurityResolved) {
    return request.actorSecurity ?? null;
  }
  const actor = await resolveRequestActor(request);
  const ownerEmail = await getCurrentOwnerEmail();
  let user = null;
  let serviceAccount = null;
  if (actor?.user_id) {
    user = await db.queryOne(
      'SELECT id, org_id, email, org_role, archived FROM users WHERE id = ? LIMIT 1',
      [actor.user_id]
    );
  } else if (actor?.service_account_id) {
    serviceAccount = request.serviceAccountAuth?.service_account ?? null;
  } else if (actor?.email) {
    user = await getUserByEmail(db, actor.email);
  }
  const actorEmail = normalizeEmail(actor?.email ?? null);
  const isOwner = isOwnerEmail(actorEmail, ownerEmail);
  const isAdminRole = Boolean(user && !Number(user.archived) && normalizeOrgRole(user.org_role) === 'admin');
  const sessionWorkspaces = request.authSession?.workspaces
    ?? (user?.id ? await listUserWorkspaces(db, user.id) : []);
  const grantedWorkspaces = serviceAccount
    ? (request.serviceAccountAuth?.workspaces ?? [])
    : sessionWorkspaces;
  const grantedPermissions = serviceAccount
    ? (request.serviceAccountAuth?.granted_permissions ?? [])
    : (user ? ALL_PERMISSION_KEYS : []);
  const effectivePermissions = serviceAccount
    ? (request.serviceAccountAuth?.effective_permissions ?? [])
    : (user ? ALL_PERMISSION_KEYS : []);
  const security = {
    actor,
    user,
    machine: null,
    serviceAccount,
    ownerEmail,
    isOwner,
    isAdmin: isOwner || isAdminRole,
    principalType: actor?.principal_type ?? null,
    principalId: actor?.principal_id ?? user?.id ?? serviceAccount?.id ?? null,
    orgId: serviceAccount?.org_id ?? user?.org_id ?? actor?.org_id ?? null,
    grantedWorkspaces,
    grantedPermissions,
    effectivePermissions
  };
  request.actorSecurity = security;
  request.actorSecurityResolved = true;
  return security;
}

async function ensureOwnerAccess(request, reply) {
  const security = await resolveActorSecurity(request);
  if (!security?.isOwner) {
    reply.code(403).send({ error: 'owner access required' });
    return null;
  }
  return security;
}

async function ensureAdminAccess(request, reply, { allowMachine = false } = {}) {
  const security = await resolveActorSecurity(request);
  if (!security?.isAdmin) {
    reply.code(403).send({ error: 'admin access required' });
    return null;
  }
  if (!allowMachine && security?.principalType === 'service_account') {
    reply.code(403).send({ error: 'human admin access required' });
    return null;
  }
  return security;
}

async function ensureAuthenticatedAccess(request, reply) {
  const actor = await resolveRequestActor(request);
  if (request.invalidAuthorization) {
    reply.code(401).send({ error: 'invalid bearer token' });
    return null;
  }
  if (!actor) {
    reply.code(401).send({ error: 'authentication required' });
    return null;
  }
  return actor;
}

async function ensureAuthenticatedHumanSecurity(request, reply) {
  const actor = await ensureAuthenticatedAccess(request, reply);
  if (!actor) return null;
  const security = await resolveActorSecurity(request);
  if (!security?.user?.id || security?.principalType === 'service_account') {
    reply.code(403).send({ error: 'human user access required' });
    return null;
  }
  return security;
}

function getOrgMembershipRoleLevel(role) {
  const normalized = String(role ?? '').trim().toLowerCase();
  if (normalized === 'owner') return 3;
  if (normalized === 'admin') return 2;
  return 1;
}

async function ensureOrgAccess(request, reply, orgId, { minimumRole = 'member' } = {}) {
  const safeOrgId = String(orgId ?? '').trim();
  if (!safeOrgId) {
    reply.code(400).send({ error: 'org_id required' });
    return null;
  }
  const security = await ensureAuthenticatedHumanSecurity(request, reply);
  if (!security) return null;
  const org = await getOrg(db, safeOrgId);
  if (!org) {
    reply.code(404).send({ error: 'organization not found' });
    return null;
  }
  const membership = await getOrgMembership(db, safeOrgId, security.user.id);
  if (!membership || Number(membership.archived)) {
    reply.code(403).send({ error: 'organization membership required' });
    return null;
  }
  if (getOrgMembershipRoleLevel(membership.role) < getOrgMembershipRoleLevel(minimumRole)) {
    reply.code(403).send({ error: `${minimumRole} role required` });
    return null;
  }
  return { security, org, membership };
}

async function ensureWorkspaceAccess(request, reply, workspaceId) {
  const safeWorkspaceId = String(workspaceId ?? '').trim();
  if (!safeWorkspaceId) {
    reply.code(400).send({ error: 'workspace_id required' });
    return null;
  }
  request.serviceAccountAccessWorkspaceId = safeWorkspaceId;
  if (!config.requireAuth) {
    return await resolveActorSecurity(request);
  }
  const actor = await ensureAuthenticatedAccess(request, reply);
  if (!actor) return null;
  const security = await resolveActorSecurity(request);
  if (security?.isOwner) {
    return security;
  }
  const routePolicy = getServiceAccountRoutePolicy(request);
  if (security?.principalType === 'service_account') {
    if (routePolicy?.permission && !permissionSetHasPermission(security.effectivePermissions, routePolicy.permission)) {
      reply.code(403).send({ error: `${routePolicy.permission} required` });
      return null;
    }
    const allowed = await serviceAccountHasWorkspaceAccess(db, security.actor.service_account_id, safeWorkspaceId);
    if (!allowed) {
      reply.code(403).send({ error: 'workspace access required' });
      return null;
    }
    return security;
  }
  const userId = security?.user?.id ?? security?.actor?.user_id ?? null;
  if (!userId) {
    reply.code(403).send({ error: 'workspace access required' });
    return null;
  }
  const member = await isWorkspaceMember(userId, safeWorkspaceId);
  if (!member) {
    reply.code(403).send({ error: 'workspace access required' });
    return null;
  }
  return security;
}

const AUTH_PUBLIC_ROUTES = new Set([
  '/health',
  '/auth/me',
  '/auth/login',
  '/auth/logout',
  '/auth/invite/accept'
]);

function sanitizeInvite(invite, { includeToken = false } = {}) {
  if (!invite) return invite;
  return {
    id: invite.id,
    org_id: invite.org_id,
    workspace_id: invite.workspace_id,
    workspace_name: invite.workspace_name ?? null,
    email: invite.email,
    role: invite.role,
    status: invite.status,
    invited_by_email: invite.invited_by_email,
    expires_at: invite.expires_at,
    accepted_at: invite.accepted_at,
    created_at: invite.created_at,
    updated_at: invite.updated_at,
    ...(includeToken ? { invite_token: invite.invite_token } : {})
  };
}

function shouldExposeInviteToken() {
  return Boolean(config.exposeInviteToken);
}

function sanitizeAdminUserRecord(user, { ownerEmail = OWNER_SUPER_ADMIN_EMAIL } = {}) {
  if (!user) return null;
  const email = normalizeEmail(user.email ?? null);
  const isOwner = isOwnerEmail(email, ownerEmail);
  const orgRole = normalizeOrgRole(user.org_role);
  return {
    id: user.id,
    org_id: user.org_id,
    display_name: user.display_name,
    email: email ?? '',
    org_role: orgRole,
    archived: Number(user.archived) ? 1 : 0,
    created_at: user.created_at ?? null,
    updated_at: user.updated_at ?? null,
    settings: user.settings && typeof user.settings === 'object' ? user.settings : {},
    is_owner: isOwner,
    is_admin: isOwner || orgRole === 'admin'
  };
}

async function ensureTaskAccess(request, reply, taskId) {
  const task = await getTask(db, taskId);
  if (!task) {
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'not found',
        requestId: request.id
      }
    });
    return null;
  }
  const access = await ensureWorkspaceAccess(request, reply, task.workspace_id);
  if (!access) return null;
  return { task, access };
}

async function ensureProjectAccess(request, reply, projectId) {
  const project = await getProject(db, projectId);
  if (!project) {
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'not found',
        requestId: request.id
      }
    });
    return null;
  }
  const access = await ensureWorkspaceAccess(request, reply, project.workspace_id);
  if (!access) return null;
  return { project, access };
}

async function ensureAdminActionReadAccess(request, reply, action) {
  const security = await ensureAuthenticatedAccess(request, reply);
  if (!security) return null;
  if (!action) {
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'not found',
        requestId: request.id
      }
    });
    return null;
  }
  const actorSecurity = await resolveActorSecurity(request);
  const requesterId = actorSecurity?.principalId
    ?? actorSecurity?.user?.id
    ?? actorSecurity?.actor?.user_id
    ?? null;
  if (action.workspace_id) {
    const access = await ensureWorkspaceAccess(request, reply, action.workspace_id);
    if (!access) return null;
    return { action, security: actorSecurity };
  }
  if (actorSecurity?.isAdmin || (requesterId && requesterId === action.requested_by_id)) {
    return { action, security: actorSecurity };
  }
  reply.code(403).send({ error: 'admin action access required' });
  return null;
}

async function ensureAdminActionWriteAccess(request, reply, action = null) {
  const security = await resolveActorSecurity(request);
  if (!security?.isAdmin) {
    reply.code(403).send({ error: 'admin access required' });
    return null;
  }
  if (action?.workspace_id) {
    const access = await ensureWorkspaceAccess(request, reply, action.workspace_id);
    if (!access) return null;
  }
  return security;
}

server.addHook('onRequest', (request, reply, done) => {
  request.startedAtMs = Date.now();
  request.actorResolved = false;
  request.actor = null;
  request.actorSecurityResolved = false;
  request.actorSecurity = null;
  request.authSession = null;
  request.serviceAccountAuth = null;
  request.serviceAccountAccessWorkspaceId = null;
  request.invalidAuthorization = false;
  const corsOrigin = getCorsOrigin(request.headers.origin);
  if (corsOrigin) {
    reply.header('Access-Control-Allow-Origin', corsOrigin);
  }
  reply.header('Access-Control-Allow-Credentials', 'true');
  reply.header('Vary', 'Origin');
  reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Client-Id, X-Actor-Email, X-Request-Id');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  reply.header('x-request-id', request.id);
  if (request.method === 'OPTIONS') {
    reply.code(204).send();
    return;
  }
  done();
});

server.addHook('onReady', async () => {
  await ensureOwnerBootstrap();
});

server.addHook('preValidation', (request, _reply, done) => {
  try {
    if (request.body !== undefined) {
      if (request.body === null || typeof request.body !== 'object' || Array.isArray(request.body)) {
        const error = new Error('request body must be an object');
        error.statusCode = 400;
        error.code = 'INVALID_BODY';
        throw error;
      }
      request.body = sanitizeRequestValue(request.body);
    }
    if (request.query && typeof request.query === 'object') {
      request.query = sanitizeRequestValue(request.query);
    }
    if (request.params && typeof request.params === 'object') {
      request.params = sanitizeRequestValue(request.params);
    }
    done();
  } catch (error) {
    done(error);
  }
});

server.addHook('preHandler', async (request, reply) => {
  if (!config.requireAuth) return;
  const routePath = String(request.routeOptions?.url ?? '').trim();
  if (AUTH_PUBLIC_ROUTES.has(routePath)) return;
  const actor = await resolveRequestActor(request);
  if (request.invalidAuthorization) {
    reply.code(401).send({ error: 'invalid bearer token' });
    return reply;
  }
  if (!actor) {
    reply.code(401).send({ error: 'authentication required' });
    return reply;
  }
  if (actor.principal_type === 'service_account') {
    const policy = getServiceAccountRoutePolicy(request);
    if (!policy) {
      reply.code(403).send({ error: 'service account route not allowed' });
      return reply;
    }
    if (policy.permission) {
      const security = await resolveActorSecurity(request);
      if (!permissionSetHasPermission(security?.effectivePermissions ?? [], policy.permission)) {
        reply.code(403).send({ error: `${policy.permission} required` });
        return reply;
      }
    }
  }
});

server.addHook('onSend', async (request, reply, payload) => {
  if (reply.statusCode < 400) return payload;
  const parsed = parsePayloadAsObject(payload);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return payload;
  if (!Object.prototype.hasOwnProperty.call(parsed, 'error')) return payload;
  const baseCode = mapStatusCodeToErrorCode(reply.statusCode);
  if (typeof parsed.error === 'string') {
    reply.type('application/json; charset=utf-8');
    return JSON.stringify({
      error: {
        code: baseCode,
        message: parsed.error,
        requestId: request.id
      }
    });
  }
  if (parsed.error && typeof parsed.error === 'object') {
    const { code, message, requestId, ...rest } = parsed.error;
    reply.type('application/json; charset=utf-8');
    return JSON.stringify({
      error: {
        code: code ?? baseCode,
        message: message ?? 'Request failed',
        requestId: requestId ?? request.id,
        ...rest
      }
    });
  }
  return payload;
});

server.addHook('onResponse', async (request, reply) => {
  const latencyMs = Math.max(0, Date.now() - Number(request.startedAtMs ?? Date.now()));
  request.log.info({
    method: request.method,
    url: request.url,
    route: request.routeOptions?.url ?? null,
    statusCode: reply.statusCode,
    latencyMs
  }, 'request completed');
  if (request.serviceAccountAuth?.service_account?.id) {
    try {
      await recordServiceAccountActivity(db, {
        orgId: request.serviceAccountAuth.service_account.org_id,
        serviceAccountId: request.serviceAccountAuth.service_account.id,
        tokenId: request.serviceAccountAuth.token?.id ?? null,
        workspaceId: request.serviceAccountAccessWorkspaceId ?? null,
        eventType: 'token.accessed',
        requestMethod: request.method,
        requestPath: request.routeOptions?.url ?? request.url,
        statusCode: reply.statusCode,
        metadata: {
          request_id: request.id,
          request_url: request.url,
          principal_type: request.actor?.principal_type ?? null
        }
      });
    } catch (error) {
      request.log.warn({
        requestId: request.id,
        err: {
          name: error?.name,
          message: error?.message
        }
      }, 'service-account activity logging failed');
    }
  }
});

server.setNotFoundHandler((request, reply) => {
  reply.code(404).send({
    error: {
      code: 'NOT_FOUND',
      message: 'not found',
      requestId: request.id
    }
  });
});

server.setErrorHandler((error, request, reply) => {
  const candidate = Number(error?.statusCode ?? 500);
  const statusCode = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
  const code = typeof error?.code === 'string' ? error.code : mapStatusCodeToErrorCode(statusCode);
  const message = statusCode >= 500 ? 'Internal server error' : (error?.message ?? 'Request failed');
  const conflict = error?.conflict && typeof error.conflict === 'object'
    ? error.conflict
    : null;
  request.log.error({
    method: request.method,
    url: request.url,
    route: request.routeOptions?.url ?? null,
    statusCode,
    err: {
      name: error?.name,
      message: error?.message,
      stack: error?.stack
    }
  }, 'request failed');
  reply.code(statusCode).send({
    error: {
      code,
      message,
      requestId: request.id,
      ...(conflict ? { conflict } : {})
    }
  });
});

attachRouteSchemas(server);

server.get('/health', async () => ({ ok: true }));

server.post('/workspaces', async (request, reply) => {
  const { name, type, org_id, org_name } = request.body ?? {};
  if (!name || !type) return reply.code(400).send({ error: 'name and type required' });
  return await createWorkspace(db, { name, type, org_id, org_name });
});

server.get('/workspaces', async (request, reply) => {
  const { org_id } = request.query ?? {};
  const security = await resolveActorSecurity(request);
  if (security?.principalType === 'service_account') {
    const grantedWorkspaces = security.grantedWorkspaces ?? [];
    if (!org_id) return grantedWorkspaces;
    return grantedWorkspaces.filter((workspace) => workspace.org_id === org_id);
  }
  if (security?.user?.id) {
    const userWorkspaces = await listUserWorkspaces(db, security.user.id);
    if (!org_id) return userWorkspaces;
    return userWorkspaces.filter((workspace) => workspace.org_id === org_id);
  }
  return await listWorkspaces(db, org_id);
});

server.get('/orgs', async (request, reply) => {
  const security = await resolveActorSecurity(request);
  if (security?.user?.id) {
    return await listOrgs(db, { userId: security.user.id });
  }
  if (config.requireAuth) {
    return reply.code(401).send({ error: 'authentication required' });
  }
  return await listOrgs(db);
});

server.post('/orgs', async (request, reply) => {
  const { name } = request.body ?? {};
  if (!name) return reply.code(400).send({ error: 'name required' });
  const security = await ensureAuthenticatedHumanSecurity(request, reply);
  if (!security) return;
  try {
    return await createOrg(
      db,
      {
        ...(request.body ?? {}),
        owner_user_id: security.user.id
      },
      request.headers['x-client-id'] ?? null
    );
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/orgs/:id', async (request, reply) => {
  const access = await ensureOrgAccess(request, reply, request.params?.id, { minimumRole: 'member' });
  if (!access) return;
  return access.org;
});

server.patch('/orgs/:id', async (request, reply) => {
  const access = await ensureOrgAccess(request, reply, request.params?.id, { minimumRole: 'admin' });
  if (!access) return;
  try {
    const updated = await updateOrg(db, request.params?.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'organization not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/orgs/:id/members', async (request, reply) => {
  const access = await ensureOrgAccess(request, reply, request.params?.id, { minimumRole: 'member' });
  if (!access) return;
  try {
    const members = await listOrgMembers(db, request.params?.id, {
      includeArchived: parseBooleanish(request.query?.include_archived, false)
    });
    return {
      org: access.org,
      members,
      count: members.length
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/orgs/:id/members', async (request, reply) => {
  const access = await ensureOrgAccess(request, reply, request.params?.id, { minimumRole: 'admin' });
  if (!access) return;
  try {
    const member = await addOrgMember(db, request.params?.id, request.body ?? {});
    return { member };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/orgs/:id/members/:userId', async (request, reply) => {
  const access = await ensureOrgAccess(request, reply, request.params?.id, { minimumRole: 'admin' });
  if (!access) return;
  try {
    const updated = await updateOrgMember(db, request.params?.id, request.params?.userId, request.body ?? {});
    if (!updated) return reply.code(404).send({ error: 'organization member not found' });
    return { member: updated };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/orgs/:id/members/:userId', async (request, reply) => {
  const access = await ensureOrgAccess(request, reply, request.params?.id, { minimumRole: 'admin' });
  if (!access) return;
  try {
    const removed = await removeOrgMember(db, request.params?.id, request.params?.userId);
    if (!removed) return reply.code(404).send({ error: 'organization member not found' });
    return { ok: true };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/orgs/:id/transfer-ownership', async (request, reply) => {
  const access = await ensureOrgAccess(request, reply, request.params?.id, { minimumRole: 'owner' });
  if (!access) return;
  try {
    const updated = await transferOrgOwnership(db, request.params?.id, request.body?.target_user_id);
    if (!updated) return reply.code(404).send({ error: 'organization not found' });
    return { org: updated };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/users', async (request, reply) => {
  const { org_id, workspace_id } = request.query ?? {};
  if (!org_id && !workspace_id) {
    return reply.code(400).send({ error: 'org_id or workspace_id required' });
  }
  try {
    const orgId = org_id ?? null;
    return await listUsers(db, orgId, workspace_id ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/users', async (request, reply) => {
  const { org_id, display_name, name, workspace_id } = request.body ?? {};
  if (!org_id || !(display_name || name)) {
    return reply.code(400).send({ error: 'org_id and display_name required' });
  }
  try {
    const created = await createUser(
      db,
      { ...(request.body ?? {}), workspace_id: workspace_id ?? null },
      request.headers['x-client-id'] ?? null
    );
    return await ensureOwnerRoleForUser(created, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/auth/me', async (request) => {
  const actor = await resolveRequestActor(request);
  const session = request.authSession ?? null;
  const serviceAccountAuth = request.serviceAccountAuth ?? null;
  const security = await resolveActorSecurity(request);
  const ownerEmail = await getCurrentOwnerEmail();
  if (!actor) {
    return {
      authenticated: false,
      auth_type: 'none',
      require_auth: Boolean(config.requireAuth),
      principal_type: null,
      principal_id: null,
      org_id: null,
      user: null,
      service_account: null,
      session: null,
      machine: null,
      workspaces: [],
      granted_permissions: [],
      effective_permissions: [],
      owner_email: ownerEmail,
      is_owner: false,
      is_admin: false
    };
  }
  if (actor.principal_type === 'service_account' && serviceAccountAuth?.service_account?.id) {
    return {
      authenticated: true,
      auth_type: 'service_account',
      require_auth: Boolean(config.requireAuth),
      principal_type: 'service_account',
      principal_id: serviceAccountAuth.service_account.id,
      org_id: serviceAccountAuth.service_account.org_id,
      user: null,
      service_account: {
        ...serviceAccountAuth.service_account,
        token_id: serviceAccountAuth.token?.id ?? null,
        token_label: serviceAccountAuth.token?.label ?? null,
        token_expires_at: serviceAccountAuth.token?.expires_at ?? null
      },
      session: null,
      machine: {
        id: serviceAccountAuth.service_account.id,
        org_id: serviceAccountAuth.service_account.org_id,
        principal: serviceAccountAuth.service_account.aliases?.[0]?.alias_value ?? serviceAccountAuth.service_account.id,
        display_name: serviceAccountAuth.service_account.display_name,
        org_role: 'member',
        all_workspaces: 0,
        archived: serviceAccountAuth.service_account.archived,
        token_id: serviceAccountAuth.token?.id ?? null,
        token_label: serviceAccountAuth.token?.label ?? null,
        token_expires_at: serviceAccountAuth.token?.expires_at ?? null
      },
      workspaces: serviceAccountAuth.workspaces ?? [],
      granted_permissions: security?.grantedPermissions ?? [],
      effective_permissions: security?.effectivePermissions ?? [],
      owner_email: ownerEmail,
      is_owner: false,
      is_admin: false
    };
  }
  const user = session?.user ?? (actor.user_id
    ? await db.queryOne(
      'SELECT id, org_id, display_name, email, org_role FROM users WHERE id = ? LIMIT 1',
      [actor.user_id]
    )
    : null);
  if (!user) {
    return {
      authenticated: true,
      auth_type: actor.source === 'header' ? 'header' : 'session',
      require_auth: Boolean(config.requireAuth),
      principal_type: 'user',
      principal_id: actor.principal_id ?? null,
      org_id: actor.org_id ?? null,
      user: null,
      service_account: null,
      session: null,
      machine: null,
      workspaces: [],
      granted_permissions: [],
      effective_permissions: [],
      owner_email: ownerEmail,
      is_owner: isOwnerEmail(actor.email, ownerEmail),
      is_admin: isOwnerEmail(actor.email, ownerEmail)
    };
  }
  const workspaces = session?.workspaces ?? await listUserWorkspaces(db, user.id);
  const isOwner = isOwnerEmail(actor.email, ownerEmail);
  const isAdmin = isOwner || normalizeOrgRole(user.org_role) === 'admin';
  return {
    authenticated: true,
    auth_type: actor.source === 'header' ? 'header' : 'session',
    require_auth: Boolean(config.requireAuth),
    principal_type: 'user',
    principal_id: user.id,
    org_id: user.org_id,
    user,
    service_account: null,
    session: session?.session ?? null,
    machine: null,
    workspaces: session?.workspaces ?? workspaces,
    granted_permissions: ALL_PERMISSION_KEYS,
    effective_permissions: ALL_PERMISSION_KEYS,
    owner_email: ownerEmail,
    is_owner: isOwner,
    is_admin: isAdmin
  };
});

server.post('/auth/login', async (request, reply) => {
  const { email, password } = request.body ?? {};
  try {
    const login = await loginWithPassword(db, {
      email,
      password,
      ttlDays: config.sessionTtlDays,
      userAgent: request.headers['user-agent'] ?? null,
      ipAddress: request.ip
    });
    const ownerEmail = await getCurrentOwnerEmail();
    const isOwner = isOwnerEmail(login.user.email, ownerEmail);
    const isAdmin = isOwner || normalizeOrgRole(login.user.org_role) === 'admin';
    setSessionCookie(reply, login.token, login.session.expires_at);
    return {
      authenticated: true,
      auth_type: 'session',
      require_auth: Boolean(config.requireAuth),
      principal_type: 'user',
      principal_id: login.user.id,
      org_id: login.user.org_id,
      user: login.user,
      service_account: null,
      session: login.session,
      machine: null,
      workspaces: login.workspaces ?? [],
      granted_permissions: ALL_PERMISSION_KEYS,
      effective_permissions: ALL_PERMISSION_KEYS,
      owner_email: ownerEmail,
      is_owner: isOwner,
      is_admin: isAdmin
    };
  } catch (err) {
    return reply.code(401).send({ error: err.message });
  }
});

server.post('/auth/logout', async (request, reply) => {
  const sessionToken = getSessionTokenFromRequest(request);
  if (sessionToken) {
    await revokeSessionByToken(db, sessionToken);
  }
  clearSessionCookie(reply);
  return { ok: true };
});

server.post('/auth/invite/accept', async (request, reply) => {
  const { invite_token, email, display_name, password } = request.body ?? {};
  try {
    const accepted = await acceptInviteRegistration(db, {
      inviteToken: invite_token,
      email,
      displayName: display_name,
      password,
      ttlDays: config.sessionTtlDays,
      userAgent: request.headers['user-agent'] ?? null,
      ipAddress: request.ip,
      clientId: request.headers['x-client-id'] ?? null
    });
    accepted.user = await ensureOwnerRoleForUser(accepted.user, request.headers['x-client-id'] ?? null);
    const ownerEmail = await getCurrentOwnerEmail();
    const isOwner = isOwnerEmail(accepted.user.email, ownerEmail);
    const isAdmin = isOwner || normalizeOrgRole(accepted.user.org_role) === 'admin';
    setSessionCookie(reply, accepted.token, accepted.session.expires_at);
    return {
      authenticated: true,
      auth_type: 'session',
      require_auth: Boolean(config.requireAuth),
      principal_type: 'user',
      principal_id: accepted.user.id,
      org_id: accepted.user.org_id,
      user: accepted.user,
      service_account: null,
      session: accepted.session,
      machine: null,
      workspaces: accepted.workspaces ?? [],
      granted_permissions: ALL_PERMISSION_KEYS,
      effective_permissions: ALL_PERMISSION_KEYS,
      owner_email: ownerEmail,
      is_owner: isOwner,
      is_admin: isAdmin
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/admin/info', async (request, reply) => {
  const security = await resolveActorSecurity(request);
  const actorEmail = security?.actor?.email ?? null;
  const ownerEmail = security?.ownerEmail ?? await getCurrentOwnerEmail();
  return {
    owner_email: ownerEmail,
    actor_email: actorEmail,
    is_owner: Boolean(security?.isOwner),
    is_admin: Boolean(security?.isAdmin)
  };
});

server.get('/admin/service-accounts', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  const orgId = request.query?.org_id ?? security.user?.org_id ?? DEFAULT_ORG_ID;
  try {
    const serviceAccounts = await listServiceAccounts(db, {
      orgId,
      includeArchived: parseBooleanish(request.query?.include_archived, true)
    });
    return {
      service_accounts: serviceAccounts,
      count: serviceAccounts.length
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/admin/service-accounts', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  try {
    const created = await createServiceAccount(
      db,
      {
        org_id: request.body?.org_id ?? security.user?.org_id ?? DEFAULT_ORG_ID,
        display_name: request.body?.display_name,
        description: request.body?.description ?? null,
        permissions: request.body?.permissions ?? [],
        aliases: request.body?.aliases ?? []
      },
      {
        createdByUserId: security.user?.id ?? null
      }
    );
    return { service_account: created };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/admin/service-accounts/:id', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  try {
    const updated = await updateServiceAccount(
      db,
      request.params?.id,
      request.body ?? {},
      { actorUserId: security.user?.id ?? null }
    );
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return { service_account: updated };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/admin/service-accounts/:id/tokens', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  try {
    const tokens = await listServiceAccountTokens(db, request.params?.id);
    return {
      tokens,
      count: tokens.length
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/admin/service-accounts/:id/tokens', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  try {
    const created = await createServiceAccountToken(
      db,
      request.params?.id,
      request.body ?? {},
      { createdByUserId: security.user?.id ?? null }
    );
    return created;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/admin/service-account-tokens/:id', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  try {
    const updated = await updateApiToken(
      db,
      request.params?.id,
      request.body ?? {},
      { actorUserId: security.user?.id ?? null }
    );
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return { token: updated };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/admin/service-account-tokens/:id/rotate', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  try {
    const rotated = await rotateApiToken(
      db,
      request.params?.id,
      request.body ?? {},
      { createdByUserId: security.user?.id ?? null }
    );
    if (!rotated) return reply.code(404).send({ error: 'not found' });
    return rotated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/admin/service-account-tokens/:id', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  try {
    const revoked = await revokeApiToken(db, request.params?.id, {
      actorUserId: security.user?.id ?? null
    });
    if (!revoked) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/admin/service-accounts/:id/workspace-grants', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  try {
    const grants = await listServiceAccountWorkspaceGrants(db, request.params?.id);
    const workspaces = await listServiceAccountWorkspaces(db, request.params?.id);
    return {
      workspace_grants: grants,
      count: grants.length,
      effective_workspaces: workspaces
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/admin/service-accounts/:id/workspace-grants', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  try {
    const grant = await createServiceAccountWorkspaceGrant(
      db,
      request.params?.id,
      request.body ?? {},
      { actorUserId: security.user?.id ?? null }
    );
    return { workspace_grant: grant };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/admin/service-account-workspace-grants/:id', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  try {
    const revoked = await revokeServiceAccountWorkspaceGrant(db, request.params?.id, {
      actorUserId: security.user?.id ?? null
    });
    if (!revoked) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/admin/service-accounts/:id/activity', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  try {
    const activity = await listServiceAccountActivity(db, request.params?.id, {
      limit: request.query?.limit
    });
    return {
      activity,
      count: activity.length
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/admin/invites', async (request, reply) => {
  const security = await ensureAdminAccess(request, reply);
  if (!security) return;
  const { org_id, workspace_id, status } = request.query ?? {};
  try {
    const invites = await listUserInvites(db, {
      org_id: org_id ?? null,
      workspace_id: workspace_id ?? null,
      status: status ?? 'pending'
    });
    return {
      invites: invites.map((invite) => sanitizeInvite(invite, { includeToken: shouldExposeInviteToken() })),
      count: invites.length
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/admin/invites', async (request, reply) => {
  const security = await ensureAdminAccess(request, reply);
  if (!security) return;
  const { workspace_id, email } = request.body ?? {};
  if (!workspace_id || !email) {
    return reply.code(400).send({ error: 'workspace_id and email required' });
  }
  const requestedRole = normalizeOrgRole(request.body?.role);
  if (requestedRole === 'admin' && !security.isOwner) {
    return reply.code(403).send({ error: 'owner access required to invite admins' });
  }
  try {
    const created = await createUserInvite(
      db,
      {
        ...(request.body ?? {}),
        role: requestedRole,
        invited_by_email: security.actor.email
      },
      request.headers['x-client-id'] ?? null
    );
    const delivery = await sendInviteEmail({
      toEmail: created.email,
      inviteToken: created.invite_token,
      workspaceName: created.workspace_name ?? null,
      invitedByEmail: security.actor.email,
      expiresAt: created.expires_at
    });
    const includeToken = shouldExposeInviteToken();
    return {
      invite: sanitizeInvite(created, { includeToken }),
      delivery: {
        provider: delivery.provider,
        accepted: delivery.accepted,
        message_id: delivery.message_id
      }
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/admin/invites/:id', async (request, reply) => {
  const security = await ensureAdminAccess(request, reply);
  if (!security) return;
  const inviteId = request.params?.id;
  if (!inviteId) {
    return reply.code(400).send({ error: 'invite id required' });
  }
  try {
    const revoked = await revokeUserInvite(
      db,
      inviteId,
      security.actor.email,
      request.headers['x-client-id'] ?? null
    );
    if (!revoked) {
      return reply.code(404).send({ error: 'not found' });
    }
    return {
      invite: sanitizeInvite(revoked, { includeToken: shouldExposeInviteToken() })
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/users/:id', async (request, reply) => {
  const security = await resolveActorSecurity(request);
  const actorUserId = security?.user?.id ?? security?.actor?.user_id ?? null;
  if (!security?.actor?.email) {
    return reply.code(401).send({ error: 'authentication required' });
  }
  const targetUserId = request.params?.id;
  const isSelf = Boolean(actorUserId && actorUserId === targetUserId);
  if (!security.isAdmin && !isSelf) {
    return reply.code(403).send({ error: 'insufficient permissions' });
  }
  const patch = { ...(request.body ?? {}) };
  if (!security.isAdmin) {
    delete patch.org_role;
    delete patch.archived;
    delete patch.workspace_id;
  } else if (patch.org_role !== undefined && !security.isOwner) {
    return reply.code(403).send({ error: 'owner access required to change roles' });
  }
  try {
    const ownerEmail = security.ownerEmail ?? await getCurrentOwnerEmail();
    const targetUser = await db.queryOne('SELECT * FROM users WHERE id = ? LIMIT 1', [targetUserId]);
    if (!targetUser) return reply.code(404).send({ error: 'not found' });
    const targetIsOwner = isOwnerEmail(targetUser.email, ownerEmail);
    if (targetIsOwner) {
      if (patch.archived !== undefined) {
        return reply.code(400).send({ error: 'owner account cannot be disabled' });
      }
      if (patch.org_role !== undefined) {
        return reply.code(400).send({ error: 'owner role is immutable' });
      }
    }
    const updated = await updateUser(db, request.params.id, patch, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    if (targetIsOwner && patch.email !== undefined && normalizeEmail(updated.email)) {
      await setCurrentOwnerEmail(updated.email);
    }
    return await ensureOwnerRoleForUser(updated, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/auth/profile', async (request, reply) => {
  const actor = await ensureAuthenticatedAccess(request, reply);
  if (!actor) return;
  if (!request.authSession?.user?.id) {
    return reply.code(401).send({ error: 'session authentication required' });
  }
  if (!actor.user_id) {
    return reply.code(401).send({ error: 'session user required' });
  }
  const patch = {};
  if (request.body && Object.prototype.hasOwnProperty.call(request.body, 'display_name')) {
    patch.display_name = request.body.display_name;
  }
  if (request.body && Object.prototype.hasOwnProperty.call(request.body, 'email')) {
    patch.email = request.body.email;
  }
  if (!Object.keys(patch).length) {
    return reply.code(400).send({ error: 'display_name or email required' });
  }
  try {
    let updated = await updateUser(db, actor.user_id, patch, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    const ownerEmail = await getCurrentOwnerEmail();
    if (isOwnerEmail(actor.email, ownerEmail) && patch.email !== undefined && normalizeEmail(updated.email)) {
      await setCurrentOwnerEmail(updated.email);
    }
    updated = await ensureOwnerRoleForUser(updated, request.headers['x-client-id'] ?? null);
    return {
      user: updated,
      owner_email: await getCurrentOwnerEmail()
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/auth/settings', async (request, reply) => {
  const actor = await ensureAuthenticatedAccess(request, reply);
  if (!actor) return;
  if (!request.authSession?.user?.id) {
    return reply.code(401).send({ error: 'session authentication required' });
  }
  if (!actor.user_id) {
    return reply.code(401).send({ error: 'session user required' });
  }
  try {
    const settings = await getUserSettings(db, actor.user_id);
    return { settings };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/auth/settings', async (request, reply) => {
  const actor = await ensureAuthenticatedAccess(request, reply);
  if (!actor) return;
  if (!request.authSession?.user?.id) {
    return reply.code(401).send({ error: 'session authentication required' });
  }
  if (!actor.user_id) {
    return reply.code(401).send({ error: 'session user required' });
  }
  const settings = request.body?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return reply.code(400).send({ error: 'settings object required' });
  }
  try {
    const updated = await upsertUserSettings(db, actor.user_id, settings, { merge: false });
    return { settings: updated };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/admin/users', async (request, reply) => {
  const security = await ensureAdminAccess(request, reply);
  if (!security) return;
  const { org_id, workspace_id, include_archived } = request.query ?? {};
  const requestedOrgId = org_id ?? security.user?.org_id ?? null;
  if (!requestedOrgId && !workspace_id) {
    return reply.code(400).send({ error: 'org_id or workspace_id required' });
  }
  const includeArchived = parseBooleanish(include_archived, true);
  try {
    const ownerEmail = security.ownerEmail ?? await getCurrentOwnerEmail();
    const users = await listUsersForAdmin(db, {
      org_id: requestedOrgId,
      workspace_id: workspace_id ?? null,
      include_archived: includeArchived
    });
    return {
      owner_email: ownerEmail,
      users: users.map((user) => sanitizeAdminUserRecord(user, { ownerEmail })),
      count: users.length
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/admin/users/:id', async (request, reply) => {
  const security = await ensureAdminAccess(request, reply);
  if (!security) return;
  const userId = request.params?.id;
  if (!userId) return reply.code(400).send({ error: 'user id required' });
  try {
    const ownerEmail = security.ownerEmail ?? await getCurrentOwnerEmail();
    const targetUser = await db.queryOne('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!targetUser) return reply.code(404).send({ error: 'not found' });
    const targetIsOwner = isOwnerEmail(targetUser.email, ownerEmail);
    if (targetIsOwner && !security.isOwner) {
      return reply.code(403).send({ error: 'owner account can only be modified by owner' });
    }

    const patch = request.body ?? {};
    const userPatch = {};
    if (Object.prototype.hasOwnProperty.call(patch, 'display_name')) userPatch.display_name = patch.display_name;
    if (Object.prototype.hasOwnProperty.call(patch, 'email')) userPatch.email = patch.email;
    if (Object.prototype.hasOwnProperty.call(patch, 'archived')) userPatch.archived = patch.archived;
    if (Object.prototype.hasOwnProperty.call(patch, 'org_role')) {
      if (!security.isOwner) {
        return reply.code(403).send({ error: 'owner access required to change roles' });
      }
      if (targetIsOwner) {
        return reply.code(400).send({ error: 'owner role is immutable' });
      }
      userPatch.org_role = patch.org_role;
    }
    if (targetIsOwner && Object.prototype.hasOwnProperty.call(userPatch, 'archived')) {
      return reply.code(400).send({ error: 'owner account cannot be disabled' });
    }

    let updatedUser = targetUser;
    if (Object.keys(userPatch).length) {
      updatedUser = await updateUser(db, userId, userPatch, request.headers['x-client-id'] ?? null);
    }
    let updatedSettings = await getUserSettings(db, userId);
    if (Object.prototype.hasOwnProperty.call(patch, 'settings')) {
      updatedSettings = await upsertUserSettings(db, userId, patch.settings, { merge: false });
    }

    let nextOwnerEmail = ownerEmail;
    if (targetIsOwner && Object.prototype.hasOwnProperty.call(userPatch, 'email') && normalizeEmail(updatedUser.email)) {
      nextOwnerEmail = await setCurrentOwnerEmail(updatedUser.email);
    }
    updatedUser = await ensureOwnerRoleForUser(updatedUser, request.headers['x-client-id'] ?? null);

    return {
      user: sanitizeAdminUserRecord(
        { ...updatedUser, settings: updatedSettings },
        { ownerEmail: nextOwnerEmail }
      ),
      owner_email: nextOwnerEmail
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/admin/users/:id/reset-password', async (request, reply) => {
  const security = await ensureAdminAccess(request, reply);
  if (!security) return;
  const userId = request.params?.id;
  if (!userId) return reply.code(400).send({ error: 'user id required' });
  const password = String(request.body?.password ?? '');
  if (!password) return reply.code(400).send({ error: 'password required' });
  try {
    const ownerEmail = security.ownerEmail ?? await getCurrentOwnerEmail();
    const targetUser = await db.queryOne('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!targetUser) return reply.code(404).send({ error: 'not found' });
    const targetIsOwner = isOwnerEmail(targetUser.email, ownerEmail);
    if (targetIsOwner && !security.isOwner) {
      return reply.code(403).send({ error: 'owner access required' });
    }
    await setUserPassword(db, { userId, password });
    return { ok: true };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/admin/users/:id/export', async (request, reply) => {
  const security = await ensureAdminAccess(request, reply);
  if (!security) return;
  const userId = request.params?.id;
  if (!userId) return reply.code(400).send({ error: 'user id required' });
  try {
    const ownerEmail = security.ownerEmail ?? await getCurrentOwnerEmail();
    const bundle = await exportUserDataBundle(db, userId);
    if (!bundle) return reply.code(404).send({ error: 'not found' });
    return {
      owner_email: ownerEmail,
      user: sanitizeAdminUserRecord(bundle.user, { ownerEmail }),
      data: bundle
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/admin/users/:id', async (request, reply) => {
  const security = await ensureAdminAccess(request, reply);
  if (!security) return;
  const userId = request.params?.id;
  if (!userId) return reply.code(400).send({ error: 'user id required' });
  try {
    const ownerEmail = security.ownerEmail ?? await getCurrentOwnerEmail();
    const targetUser = await db.queryOne('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!targetUser) return reply.code(404).send({ error: 'not found' });
    if (isOwnerEmail(targetUser.email, ownerEmail)) {
      return reply.code(400).send({ error: 'owner account cannot be deleted' });
    }
    const result = await deleteUserAccount(db, userId, request.headers['x-client-id'] ?? null);
    return result;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/admin/ownership/transfer', async (request, reply) => {
  const security = await ensureOwnerAccess(request, reply);
  if (!security) return;
  const targetUserId = String(request.body?.target_user_id ?? '').trim();
  const targetEmail = normalizeEmail(request.body?.target_email ?? null);
  if (!targetUserId && !targetEmail) {
    return reply.code(400).send({ error: 'target_user_id or target_email required' });
  }
  try {
    const previousOwnerEmail = security.ownerEmail ?? await getCurrentOwnerEmail();
    let targetUser = null;
    if (targetUserId) {
      targetUser = await db.queryOne('SELECT * FROM users WHERE id = ? LIMIT 1', [targetUserId]);
    } else {
      targetUser = await getUserByEmail(db, targetEmail);
    }
    if (!targetUser || Number(targetUser.archived)) {
      return reply.code(404).send({ error: 'target user not found' });
    }
    const nextOwnerEmail = normalizeEmail(targetUser.email);
    if (!nextOwnerEmail) {
      return reply.code(400).send({ error: 'target user email is invalid' });
    }
    await setCurrentOwnerEmail(nextOwnerEmail);

    if (normalizeOrgRole(targetUser.org_role) !== 'admin') {
      await updateUser(db, targetUser.id, { org_role: 'admin' }, request.headers['x-client-id'] ?? null);
      targetUser = await db.queryOne('SELECT * FROM users WHERE id = ? LIMIT 1', [targetUser.id]);
    }
    if (!isOwnerEmail(previousOwnerEmail, nextOwnerEmail)) {
      const previousOwnerUser = await getUserByEmail(db, previousOwnerEmail);
      if (previousOwnerUser && previousOwnerUser.id !== targetUser.id) {
        await updateUser(
          db,
          previousOwnerUser.id,
          { org_role: 'admin' },
          request.headers['x-client-id'] ?? null
        );
      }
    }

    return {
      owner_email: nextOwnerEmail,
      previous_owner_email: previousOwnerEmail,
      user: sanitizeAdminUserRecord(targetUser, { ownerEmail: nextOwnerEmail })
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/workspace-memberships', async (request, reply) => {
  const { workspace_id } = request.query ?? {};
  if (!workspace_id) return reply.code(400).send({ error: 'workspace_id required' });
  try {
    return await listWorkspaceMemberships(db, workspace_id);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/workspace-memberships', async (request, reply) => {
  const { workspace_id, user_id } = request.body ?? {};
  if (!workspace_id || !user_id) {
    return reply.code(400).send({ error: 'workspace_id and user_id required' });
  }
  try {
    return await createWorkspaceMembership(db, request.body ?? {}, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/workspace-memberships/:id', async (request, reply) => {
  try {
    const updated = await updateWorkspaceMembership(
      db,
      request.params.id,
      request.body ?? {},
      request.headers['x-client-id'] ?? null
    );
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/workspace-memberships/:id', async (request, reply) => {
  try {
    const result = await deleteWorkspaceMembership(db, request.params.id, request.headers['x-client-id'] ?? null);
    if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
    return result;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/workspaces/:id', async (request, reply) => {
  const updated = await updateWorkspace(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/workspaces/:id', async (request, reply) => {
  const result = await deleteWorkspace(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.get('/agent-events', async (request, reply) => {
  const { workspace_id } = request.query ?? {};
  const access = await ensureWorkspaceAccess(request, reply, workspace_id);
  if (!access) return;
  try {
    return await listAgentEvents(db, request.query ?? {});
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/agent-events/:id', async (request, reply) => {
  try {
    const event = await getAgentEvent(db, request.params.id);
    if (!event) {
      return reply.code(404).send({ error: 'not found' });
    }
    const access = await ensureWorkspaceAccess(request, reply, event.workspace_id);
    if (!access) return;
    return event;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/agent-events', async (request, reply) => {
  const { workspace_id, source_agent, event_type } = request.body ?? {};
  if (!workspace_id || !source_agent || !event_type) {
    return reply.code(400).send({ error: 'workspace_id, source_agent, and event_type required' });
  }
  const access = await ensureWorkspaceAccess(request, reply, workspace_id);
  if (!access) return;
  try {
    return await createAgentEvent(db, request.body ?? {}, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/agent-events/:id', async (request, reply) => {
  try {
    const event = await getAgentEvent(db, request.params.id);
    if (!event) {
      return reply.code(404).send({ error: 'not found' });
    }
    const access = await ensureWorkspaceAccess(request, reply, event.workspace_id);
    if (!access) return;
    const updated = await updateAgentEvent(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/admin-actions', async (request, reply) => {
  const { workspace_id } = request.query ?? {};
  try {
    if (workspace_id) {
      const access = await ensureWorkspaceAccess(request, reply, workspace_id);
      if (!access) return;
      return {
        actions: await listAdminActions(db, request.query ?? {})
      };
    }
    const security = await ensureAdminActionWriteAccess(request, reply);
    if (!security) return;
    return {
      actions: await listAdminActions(db, {
        ...(request.query ?? {}),
        org_id: request.query?.org_id ?? security.machine?.org_id ?? security.user?.org_id ?? security.actor?.org_id ?? DEFAULT_ORG_ID
      })
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/admin-actions/:id', async (request, reply) => {
  try {
    const action = await getAdminAction(db, request.params?.id);
    const access = await ensureAdminActionReadAccess(request, reply, action);
    if (!access) return;
    return action;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/admin-actions', async (request, reply) => {
  const security = await resolveActorSecurity(request);
  if (!security?.actor) {
    return reply.code(401).send({ error: 'authentication required' });
  }
  try {
    const workspaceId = request.body?.workspace_id ?? null;
    if (workspaceId) {
      const access = await ensureWorkspaceAccess(request, reply, workspaceId);
      if (!access) return;
    } else {
      const admin = await ensureAdminActionWriteAccess(request, reply);
      if (!admin) return;
    }
    const principal = getAuditPrincipal(security);
    const action = await createAdminAction(db, {
      ...principal,
      org_id: request.body?.org_id ?? security.machine?.org_id ?? security.user?.org_id ?? security.actor?.org_id ?? DEFAULT_ORG_ID,
      workspace_id: workspaceId,
      source_channel: request.body?.source_channel ?? null,
      source_principal: request.body?.source_principal ?? principal.source_principal,
      action_type: request.body?.action_type,
      target: request.body?.target ?? null,
      arguments_json: request.body?.arguments_json ?? {},
      approval_mode: request.body?.approval_mode ?? 'explicit',
      status: request.body?.status ?? 'requested'
    });
    return action;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/admin-actions/:id', async (request, reply) => {
  try {
    const existing = await getAdminAction(db, request.params?.id);
    const security = await ensureAdminActionWriteAccess(request, reply, existing);
    if (!security) return;
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const principal = getAuditPrincipal(security);
    const updated = await updateAdminAction(db, request.params?.id, {
      ...(request.body ?? {}),
      approved_by_type: request.body?.approved_by_type ?? (request.body?.status === 'approved' ? principal.requested_by_type : undefined),
      approved_by_id: request.body?.approved_by_id ?? (request.body?.status === 'approved' ? principal.requested_by_id : undefined),
      approved_by_label: request.body?.approved_by_label ?? (request.body?.status === 'approved' ? principal.requested_by_label : undefined)
    });
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/projects', async (request, reply) => {
  const { workspace_id } = request.query ?? {};
  const access = await ensureWorkspaceAccess(request, reply, workspace_id);
  if (!access) return;
  return await listProjects(db, workspace_id);
});

server.post('/projects', async (request, reply) => {
  const { workspace_id, name, kind } = request.body ?? {};
  if (!workspace_id || !name) {
    return reply.code(400).send({ error: 'workspace_id and name required' });
  }
  const access = await ensureWorkspaceAccess(request, reply, workspace_id);
  if (!access) return;
  return await createProject(db, { workspace_id, name, kind }, request.headers['x-client-id'] ?? null);
});

server.patch('/projects/:id', async (request, reply) => {
  const projectAccess = await ensureProjectAccess(request, reply, request.params.id);
  if (!projectAccess) return;
  const updated = await updateProject(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/projects/:id', async (request, reply) => {
  const projectAccess = await ensureProjectAccess(request, reply, request.params.id);
  if (!projectAccess) return;
  const result = await deleteProject(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.get('/templates', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listTemplates(db, workspace_id);
});

server.post('/templates', async (request, reply) => {
  const { workspace_id, name } = request.body ?? {};
  if (!workspace_id || !name) {
    return reply.code(400).send({ error: 'workspace_id and name required' });
  }
  return await createTemplate(db, request.body ?? {});
});

server.patch('/templates/:id', async (request, reply) => {
  const updated = await updateTemplate(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/templates/:id', async (request, reply) => {
  const result = await deleteTemplate(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.get('/statuses', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listStatuses(db, workspace_id);
});

server.post('/statuses', async (request, reply) => {
  const { workspace_id, label } = request.body ?? {};
  if (!workspace_id || !label) {
    return reply.code(400).send({ error: 'workspace_id and label required' });
  }
  try {
    return await createStatus(db, request.body ?? {}, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/statuses/:id', async (request, reply) => {
  const updated = await updateStatus(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/statuses/:id', async (request, reply) => {
  const result = await deleteStatus(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) {
    if (result?.error === 'protected') {
      return reply.code(400).send({ error: 'status is protected' });
    }
    return reply.code(404).send({ error: 'not found' });
  }
  return result;
});

server.get('/task-types', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listTaskTypes(db, workspace_id);
});

server.post('/task-types', async (request, reply) => {
  const { workspace_id, name } = request.body ?? {};
  if (!workspace_id || !name) {
    return reply.code(400).send({ error: 'workspace_id and name required' });
  }
  try {
    return await createTaskType(db, request.body ?? {}, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/task-types/:id', async (request, reply) => {
  try {
    const updated = await updateTaskType(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/task-types/:id', async (request, reply) => {
  const result = await deleteTaskType(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) {
    if (result?.error === 'protected') {
      return reply.code(400).send({ error: 'type is protected' });
    }
    return reply.code(404).send({ error: 'not found' });
  }
  return result;
});

server.get('/notice-types', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listNoticeTypes(db, workspace_id);
});

server.post('/notice-types', async (request, reply) => {
  const { workspace_id, label } = request.body ?? {};
  if (!workspace_id || !label) {
    return reply.code(400).send({ error: 'workspace_id and label required' });
  }
  try {
    return await createNoticeType(db, { workspace_id, label }, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/notice-types/:id', async (request, reply) => {
  try {
    const updated = await updateNoticeType(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/notice-types/:id', async (request) => {
  return await deleteNoticeType(db, request.params.id, request.headers['x-client-id'] ?? null);
});

server.get('/notices', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listNotices(db, workspace_id);
});

server.post('/notices', async (request, reply) => {
  const { workspace_id, title, notify_at } = request.body ?? {};
  if (!workspace_id || !title || !notify_at) {
    return reply.code(400).send({ error: 'workspace_id, title, and notify_at required' });
  }
  return await createNotice(db, request.body ?? {}, request.headers['x-client-id'] ?? null);
});

server.patch('/notices/:id', async (request, reply) => {
  const updated = await updateNotice(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/notices/:id', async (request, reply) => {
  const result = await deleteNotice(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.get('/store-rules', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listStoreRules(db, workspace_id);
});

server.post('/store-rules', async (request, reply) => {
  const { workspace_id, store_name } = request.body ?? {};
  if (!workspace_id || !store_name) {
    return reply.code(400).send({ error: 'workspace_id and store_name required' });
  }
  return await createStoreRule(db, request.body ?? {}, request.headers['x-client-id'] ?? null);
});

server.patch('/store-rules/:id', async (request, reply) => {
  const updated = await updateStoreRule(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/store-rules/:id', async (request, reply) => {
  const result = await deleteStoreRule(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.get('/shopping-lists', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listShoppingLists(db, workspace_id);
});

server.post('/shopping-lists', async (request, reply) => {
  const { workspace_id, name, store_name, scheduled_for } = request.body ?? {};
  if (!workspace_id || !name) {
    return reply.code(400).send({ error: 'workspace_id and name required' });
  }
  return await createShoppingList(
    db,
    { workspace_id, name, store_name, scheduled_for, archived: request.body?.archived },
    request.headers['x-client-id'] ?? null
  );
});

server.patch('/shopping-lists/:id', async (request, reply) => {
  const updated = await updateShoppingList(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/shopping-lists/:id', async (request, reply) => {
  const result = await deleteShoppingList(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.get('/shopping-items', async (request) => {
  const { workspace_id, list_id } = request.query ?? {};
  return await listShoppingItems(db, workspace_id, list_id ?? null);
});

server.post('/shopping-items', async (request, reply) => {
  const { list_id, name, items } = request.body ?? {};
  if (!list_id) {
    return reply.code(400).send({ error: 'list_id required' });
  }
  if (Array.isArray(items) && items.length) {
    return { items: await createShoppingItems(db, list_id, items, request.headers['x-client-id'] ?? null) };
  }
  if (!name) {
    return reply.code(400).send({ error: 'name required' });
  }
  const created = await createShoppingItem(db, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!created) return reply.code(404).send({ error: 'list not found' });
  return created;
});

server.patch('/shopping-items/:id', async (request, reply) => {
  const updated = await updateShoppingItem(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/shopping-items/:id', async (request, reply) => {
  const result = await deleteShoppingItem(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.post('/tasks/:id/convert-to-shopping-item', async (request, reply) => {
  const taskAccess = await ensureTaskAccess(request, reply, request.params.id);
  if (!taskAccess) return;
  try {
    const converted = await convertTaskToShoppingItem(
      db,
      request.params.id,
      request.body ?? {},
      request.headers['x-client-id'] ?? null
    );
    if (!converted) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'not found',
          requestId: request.id
        }
      });
    }
    return converted;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/tasks', async (request, reply) => {
  const data = request.body ?? {};
  if (!data.workspace_id || !data.title) {
    return reply.code(400).send({ error: 'workspace_id and title required' });
  }
  const access = await ensureWorkspaceAccess(request, reply, data.workspace_id);
  if (!access) return;
  try {
    const security = await resolveActorSecurity(request);
    const taskPayload = { ...data };
    const hasAssigneeUserId = String(taskPayload.assignee_user_id ?? '').trim().length > 0;
    const hasAssigneeLabel = String(taskPayload.assignee_label ?? '').trim().length > 0;
    if (!hasAssigneeUserId && !hasAssigneeLabel && security?.user?.id) {
      const creatorIsMember = await isWorkspaceMember(security.user.id, taskPayload.workspace_id);
      if (creatorIsMember) {
        taskPayload.assignee_user_id = security.user.id;
        taskPayload.assignee_label = null;
      }
    }
    return await createTask(db, taskPayload, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/tasks/:id', async (request, reply) => {
  const taskAccess = await ensureTaskAccess(request, reply, request.params.id);
  if (!taskAccess) return;
  return taskAccess.task;
});

server.patch('/tasks/:id', async (request, reply) => {
  const taskAccess = await ensureTaskAccess(request, reply, request.params.id);
  if (!taskAccess) return;
  try {
    const updated = await updateTask(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/tasks/:id', async (request, reply) => {
  const taskAccess = await ensureTaskAccess(request, reply, request.params.id);
  if (!taskAccess) return;
  return await deleteTask(db, request.params.id, request.headers['x-client-id'] ?? null);
});

server.get('/tasks', async (request, reply) => {
  const { workspace_id } = request.query;
  const access = await ensureWorkspaceAccess(request, reply, workspace_id);
  if (!access) return;
  return await listTasks(db, workspace_id);
});

server.get('/task-dependencies', async (request, reply) => {
  const { workspace_id } = request.query;
  const access = await ensureWorkspaceAccess(request, reply, workspace_id);
  if (!access) return;
  return await listTaskDependencies(db, workspace_id);
});

server.post('/task-dependencies', async (request, reply) => {
  const { task_id, depends_on_id } = request.body ?? {};
  if (!task_id || !depends_on_id) {
    return reply.code(400).send({ error: 'task_id and depends_on_id required' });
  }
  const taskAccess = await ensureTaskAccess(request, reply, task_id);
  if (!taskAccess) return;
  const dependsOnTaskAccess = await ensureTaskAccess(request, reply, depends_on_id);
  if (!dependsOnTaskAccess) return;
  try {
    return await addTaskDependency(db, task_id, depends_on_id, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/task-dependencies/:taskId/:dependsOnId', async (request, reply) => {
  const taskAccess = await ensureTaskAccess(request, reply, request.params.taskId);
  if (!taskAccess) return;
  const dependsOnTaskAccess = await ensureTaskAccess(request, reply, request.params.dependsOnId);
  if (!dependsOnTaskAccess) return;
  try {
    return await removeTaskDependency(
      db,
      request.params.taskId,
      request.params.dependsOnId,
      request.headers['x-client-id'] ?? null
    );
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/tasks/tree', async (request, reply) => {
  const { workspace_id, root_id } = request.query;
  const access = await ensureWorkspaceAccess(request, reply, workspace_id);
  if (!access) return;
  return await getTaskTree(db, workspace_id, root_id ?? null);
});

server.post('/tasks/:id/reparent', async (request, reply) => {
  const { new_parent_id } = request.body ?? {};
  const taskAccess = await ensureTaskAccess(request, reply, request.params.id);
  if (!taskAccess) return;
  if (new_parent_id) {
    const parentAccess = await ensureTaskAccess(request, reply, new_parent_id);
    if (!parentAccess) return;
  }
  try {
    return await reparentTask(db, request.params.id, new_parent_id ?? null, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/tasks/:id/checkin', async (request, reply) => {
  const { response } = request.body ?? {};
  const taskAccess = await ensureTaskAccess(request, reply, request.params.id);
  if (!taskAccess) return;
  try {
    const updated = await applyTaskCheckIn(db, request.params.id, response, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/tasks/:id/reschedule', async (request, reply) => {
  const { deltaMs } = request.body ?? {};
  if (typeof deltaMs !== 'number') return reply.code(400).send({ error: 'deltaMs required' });
  const taskAccess = await ensureTaskAccess(request, reply, request.params.id);
  if (!taskAccess) return;
  return await rescheduleSubtree(db, request.params.id, deltaMs, request.headers['x-client-id'] ?? null);
});

server.post('/tasks/search', async (request, reply) => {
  const { workspace_id, text, status, tag } = request.body ?? {};
  const access = await ensureWorkspaceAccess(request, reply, workspace_id);
  if (!access) return;
  return await searchTasks(db, workspace_id, { text, status, tag });
});

server.post('/sync/push', async (request, reply) => {
  const { workspace_id, client_id, changes } = request.body ?? {};
  const access = await ensureWorkspaceAccess(request, reply, workspace_id);
  if (!access) return;
  const applied = [];
  const deduped = [];
  if (Array.isArray(changes)) {
    for (const change of changes) {
      const mutationId = String(change?.client_mutation_id ?? '').trim();
      if (mutationId) {
        const duplicate = await isDuplicateSyncMutation(workspace_id, mutationId);
        if (duplicate) {
          deduped.push(mutationId);
          continue;
        }
      }
      await assertNoSyncConflict(workspace_id, change);
      await recordChange(db, workspace_id, change.entity_type, change.entity_id, change.action, change.payload, client_id ?? null);
      if (mutationId) {
        await recordSyncMutation(workspace_id, client_id ?? null, mutationId);
      }
      applied.push(change);
    }
  }
  return { applied: applied.length, deduped: deduped.length };
});

server.post('/sync/pull', async (request, reply) => {
  const { workspace_id, cursor } = request.body ?? {};
  const access = await ensureWorkspaceAccess(request, reply, workspace_id);
  if (!access) return;
  const rows = await db.query(
    'SELECT seq, entity_type, entity_id, action, payload, client_id, created_at FROM change_log WHERE workspace_id = ? AND seq > ? ORDER BY seq ASC',
    [workspace_id, cursor ?? 0]
  );
  const changes = rows.map(row => ({
    seq: row.seq,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    action: row.action,
    payload: JSON.parse(row.payload),
    client_id: row.client_id,
    created_at: row.created_at
  }));
  const nextCursor = rows.length ? rows[rows.length - 1].seq : cursor ?? 0;
  return { changes, next_cursor: nextCursor };
});

server.post('/ai/suggest', async (request) => {
  const { tasks, context } = request.body ?? {};
  const suggestions = [];
  if (Array.isArray(tasks)) {
    const next = tasks.find(task => task.status !== 'done' && task.status !== 'canceled');
    if (next) {
      suggestions.push({
        type: 'next-action',
        task_id: next.id,
        message: `Focus on "${next.title}" next.`
      });
    }
  }
  if (context?.time_available_minutes) {
    suggestions.push({
      type: 'time-block',
      message: `You have ${context.time_available_minutes} minutes. Pick a task that fits that window.`
    });
  }
  return { suggestions, notes: 'AI stub only; no state mutation.' };
});

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

export async function startServer() {
  await server.listen({ port: config.port, host: config.host });
  return server;
}

if (isEntrypoint()) {
  startServer().catch((error) => {
    server.log.fatal({ err: error }, 'failed to start server');
    process.exit(1);
  });
}
