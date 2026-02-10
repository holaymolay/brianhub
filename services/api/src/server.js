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
  listOrgs,
  createOrg,
  listUsers,
  createUser,
  updateUser,
  listUserInvites,
  createUserInvite,
  listWorkspaceMemberships,
  createWorkspaceMembership,
  updateWorkspaceMembership,
  deleteWorkspaceMembership,
  updateWorkspace,
  deleteWorkspace,
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
  resolveSessionUser,
  revokeSessionByToken
} from './authService.js';

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
  'notice_type',
  'response'
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
  const sessionToken = getSessionTokenFromRequest(request);
  if (sessionToken) {
    const session = await resolveSessionUser(db, sessionToken);
    if (session?.user?.email) {
      actor = {
        source: 'session',
        email: String(session.user.email).trim().toLowerCase(),
        user_id: session.user.id,
        org_id: session.user.org_id,
        session_id: session.session?.id ?? null
      };
      request.authSession = session;
    }
  }
  if (!actor && config.allowHeaderActorAuth) {
    const fallbackEmail = getHeaderActorEmail(request);
    if (fallbackEmail) {
      actor = {
        source: 'header',
        email: fallbackEmail,
        user_id: null,
        org_id: null,
        session_id: null
      };
    }
  }
  request.actor = actor;
  request.actorResolved = true;
  return actor;
}

async function ensureOwnerAccess(request, reply) {
  const actor = await resolveRequestActor(request);
  if (!actor?.email || actor.email !== OWNER_SUPER_ADMIN_EMAIL) {
    reply.code(403).send({ error: 'owner access required' });
    return null;
  }
  return actor;
}

async function ensureAuthenticatedAccess(request, reply) {
  const actor = await resolveRequestActor(request);
  if (!actor) {
    reply.code(401).send({ error: 'authentication required' });
    return null;
  }
  return actor;
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

server.addHook('onRequest', (request, reply, done) => {
  request.startedAtMs = Date.now();
  request.actorResolved = false;
  request.actor = null;
  request.authSession = null;
  const corsOrigin = getCorsOrigin(request.headers.origin);
  if (corsOrigin) {
    reply.header('Access-Control-Allow-Origin', corsOrigin);
  }
  reply.header('Access-Control-Allow-Credentials', 'true');
  reply.header('Vary', 'Origin');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id, X-Actor-Email, X-Request-Id');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  reply.header('x-request-id', request.id);
  if (request.method === 'OPTIONS') {
    reply.code(204).send();
    return;
  }
  done();
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
  if (!actor) {
    reply.code(401).send({ error: 'authentication required' });
    return reply;
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

server.addHook('onResponse', (request, reply, done) => {
  const latencyMs = Math.max(0, Date.now() - Number(request.startedAtMs ?? Date.now()));
  request.log.info({
    method: request.method,
    url: request.url,
    route: request.routeOptions?.url ?? null,
    statusCode: reply.statusCode,
    latencyMs
  }, 'request completed');
  done();
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

server.get('/workspaces', async (request) => {
  const { org_id } = request.query ?? {};
  return await listWorkspaces(db, org_id);
});

server.get('/orgs', async () => {
  return await listOrgs(db);
});

server.post('/orgs', async (request, reply) => {
  const { name } = request.body ?? {};
  if (!name) return reply.code(400).send({ error: 'name required' });
  try {
    return await createOrg(db, request.body ?? {}, request.headers['x-client-id'] ?? null);
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
    return await createUser(
      db,
      { ...(request.body ?? {}), workspace_id: workspace_id ?? null },
      request.headers['x-client-id'] ?? null
    );
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/auth/me', async (request) => {
  const actor = await resolveRequestActor(request);
  const session = request.authSession ?? null;
  if (!actor || !session?.user) {
    return {
      authenticated: false,
      require_auth: Boolean(config.requireAuth),
      user: null,
      session: null,
      workspaces: [],
      owner_email: OWNER_SUPER_ADMIN_EMAIL,
      is_owner: false
    };
  }
  return {
    authenticated: true,
    require_auth: Boolean(config.requireAuth),
    user: session.user,
    session: session.session,
    workspaces: session.workspaces ?? [],
    owner_email: OWNER_SUPER_ADMIN_EMAIL,
    is_owner: actor.email === OWNER_SUPER_ADMIN_EMAIL
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
    setSessionCookie(reply, login.token, login.session.expires_at);
    return {
      authenticated: true,
      require_auth: Boolean(config.requireAuth),
      user: login.user,
      session: login.session,
      workspaces: login.workspaces ?? [],
      owner_email: OWNER_SUPER_ADMIN_EMAIL,
      is_owner: String(login.user.email ?? '').toLowerCase() === OWNER_SUPER_ADMIN_EMAIL
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
  const { invite_token, display_name, password } = request.body ?? {};
  try {
    const accepted = await acceptInviteRegistration(db, {
      inviteToken: invite_token,
      displayName: display_name,
      password,
      ttlDays: config.sessionTtlDays,
      userAgent: request.headers['user-agent'] ?? null,
      ipAddress: request.ip,
      clientId: request.headers['x-client-id'] ?? null
    });
    setSessionCookie(reply, accepted.token, accepted.session.expires_at);
    return {
      authenticated: true,
      require_auth: Boolean(config.requireAuth),
      user: accepted.user,
      session: accepted.session,
      workspaces: accepted.workspaces ?? [],
      owner_email: OWNER_SUPER_ADMIN_EMAIL,
      is_owner: String(accepted.user.email ?? '').toLowerCase() === OWNER_SUPER_ADMIN_EMAIL
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/admin/info', async (request, reply) => {
  const actor = await resolveRequestActor(request);
  const actorEmail = actor?.email ?? null;
  return {
    owner_email: OWNER_SUPER_ADMIN_EMAIL,
    actor_email: actorEmail,
    is_owner: Boolean(actorEmail && actorEmail === OWNER_SUPER_ADMIN_EMAIL)
  };
});

server.get('/admin/invites', async (request, reply) => {
  const actor = await ensureOwnerAccess(request, reply);
  if (!actor) return;
  const { org_id, workspace_id, status } = request.query ?? {};
  try {
    const invites = await listUserInvites(db, {
      org_id: org_id ?? null,
      workspace_id: workspace_id ?? null,
      status: status ?? 'pending'
    });
    return {
      invites: invites.map((invite) => sanitizeInvite(invite)),
      count: invites.length
    };
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/admin/invites', async (request, reply) => {
  const actor = await ensureOwnerAccess(request, reply);
  if (!actor) return;
  const { workspace_id, email } = request.body ?? {};
  if (!workspace_id || !email) {
    return reply.code(400).send({ error: 'workspace_id and email required' });
  }
  try {
    const created = await createUserInvite(
      db,
      {
        ...(request.body ?? {}),
        invited_by_email: actor.email
      },
      request.headers['x-client-id'] ?? null
    );
    const delivery = await sendInviteEmail({
      toEmail: created.email,
      inviteToken: created.invite_token,
      workspaceName: created.workspace_name ?? null,
      invitedByEmail: actor.email,
      expiresAt: created.expires_at
    });
    const includeToken = config.exposeInviteToken;
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

server.patch('/users/:id', async (request, reply) => {
  try {
    const updated = await updateUser(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
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

server.get('/projects', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listProjects(db, workspace_id);
});

server.post('/projects', async (request, reply) => {
  const { workspace_id, name, kind } = request.body ?? {};
  if (!workspace_id || !name) {
    return reply.code(400).send({ error: 'workspace_id and name required' });
  }
  return await createProject(db, { workspace_id, name, kind });
});

server.patch('/projects/:id', async (request, reply) => {
  const updated = await updateProject(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/projects/:id', async (request, reply) => {
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
  const { workspace_id, name } = request.body ?? {};
  if (!workspace_id || !name) {
    return reply.code(400).send({ error: 'workspace_id and name required' });
  }
  return await createShoppingList(db, { workspace_id, name, archived: request.body?.archived }, request.headers['x-client-id'] ?? null);
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
  const created = await createShoppingItem(db, { list_id, name }, request.headers['x-client-id'] ?? null);
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

server.post('/tasks', async (request, reply) => {
  const data = request.body ?? {};
  if (!data.workspace_id || !data.title) {
    return reply.code(400).send({ error: 'workspace_id and title required' });
  }
  try {
    return await createTask(db, data, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/tasks/:id', async (request, reply) => {
  const task = await getTask(db, request.params.id);
  if (!task) return reply.code(404).send({ error: 'not found' });
  return task;
});

server.patch('/tasks/:id', async (request, reply) => {
  try {
    const updated = await updateTask(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/tasks/:id', async (request) => {
  return await deleteTask(db, request.params.id, request.headers['x-client-id'] ?? null);
});

server.get('/tasks', async (request) => {
  const { workspace_id } = request.query;
  return await listTasks(db, workspace_id);
});

server.get('/task-dependencies', async (request) => {
  const { workspace_id } = request.query;
  return await listTaskDependencies(db, workspace_id);
});

server.post('/task-dependencies', async (request, reply) => {
  const { task_id, depends_on_id } = request.body ?? {};
  if (!task_id || !depends_on_id) {
    return reply.code(400).send({ error: 'task_id and depends_on_id required' });
  }
  try {
    return await addTaskDependency(db, task_id, depends_on_id, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/task-dependencies/:taskId/:dependsOnId', async (request, reply) => {
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

server.get('/tasks/tree', async (request) => {
  const { workspace_id, root_id } = request.query;
  return await getTaskTree(db, workspace_id, root_id ?? null);
});

server.post('/tasks/:id/reparent', async (request, reply) => {
  const { new_parent_id } = request.body ?? {};
  try {
    return await reparentTask(db, request.params.id, new_parent_id ?? null, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/tasks/:id/checkin', async (request, reply) => {
  const { response } = request.body ?? {};
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
  return await rescheduleSubtree(db, request.params.id, deltaMs, request.headers['x-client-id'] ?? null);
});

server.post('/tasks/search', async (request) => {
  const { workspace_id, text, status, tag } = request.body ?? {};
  return await searchTasks(db, workspace_id, { text, status, tag });
});

server.post('/sync/push', async (request) => {
  const { workspace_id, client_id, changes } = request.body ?? {};
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

server.post('/sync/pull', async (request) => {
  const { workspace_id, cursor } = request.body ?? {};
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
