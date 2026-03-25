import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createUser, createWorkspaceMembership, updateUser } from './taskService.js';

const scryptAsync = promisify(scrypt);
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 200;

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return null;
  return text;
}

function normalizeInviteToken(value) {
  return String(value ?? '').trim();
}

function normalizeOrgRole(value) {
  const role = String(value ?? '').trim().toLowerCase();
  if (!role) return 'member';
  return role === 'admin' ? 'admin' : 'member';
}

function normalizeText(value, fieldName, { maxLength = 512, required = false } = {}) {
  if (value === undefined) {
    if (required) throw new Error(`${fieldName} is required`);
    return undefined;
  }
  const text = String(value ?? '').trim();
  if (!text) {
    if (required) throw new Error(`${fieldName} is required`);
    return null;
  }
  if (text.length > maxLength) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return text;
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function normalizeDateTime(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return new Date(timestamp).toISOString();
}

function hashToken(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

function createMachineToken() {
  return `bhm_${randomBytes(32).toString('base64url')}`;
}

function assertValidPassword(password) {
  const text = String(password ?? '');
  if (text.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (text.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
  return text;
}

async function hashPassword(password, saltHex = null) {
  const safePassword = assertValidPassword(password);
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
  const derived = await scryptAsync(safePassword, salt, 64);
  return {
    password_hash: Buffer.from(derived).toString('hex'),
    password_salt: salt.toString('hex'),
    password_algo: 'scrypt-v1'
  };
}

async function verifyPassword(password, credential) {
  if (!credential?.password_hash || !credential?.password_salt) return false;
  const input = await hashPassword(String(password ?? ''), credential.password_salt);
  const left = Buffer.from(input.password_hash, 'hex');
  const right = Buffer.from(String(credential.password_hash), 'hex');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function getInviteByToken(db, inviteToken) {
  return db.queryOne(
    `SELECT ui.*, w.name AS workspace_name
       FROM user_invites ui
       JOIN workspaces w ON w.id = ui.workspace_id
      WHERE ui.invite_token = ?
      LIMIT 1`,
    [inviteToken]
  );
}

async function getUserByOrgEmail(db, orgId, email) {
  return db.queryOne(
    'SELECT * FROM users WHERE org_id = ? AND email = ? LIMIT 1',
    [orgId, email]
  );
}

async function setUserPasswordCredential(db, userId, password) {
  const credential = await hashPassword(password);
  const timestamp = nowIso();
  const existing = await db.queryOne('SELECT user_id FROM auth_credentials WHERE user_id = ? LIMIT 1', [userId]);
  if (existing) {
    await db.exec(
      `UPDATE auth_credentials
          SET password_hash = ?, password_salt = ?, password_algo = ?, password_updated_at = ?, updated_at = ?
        WHERE user_id = ?`,
      [
        credential.password_hash,
        credential.password_salt,
        credential.password_algo,
        timestamp,
        timestamp,
        userId
      ]
    );
  } else {
    await db.exec(
      `INSERT INTO auth_credentials (
         user_id, password_hash, password_salt, password_algo, password_updated_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        credential.password_hash,
        credential.password_salt,
        credential.password_algo,
        timestamp,
        timestamp,
        timestamp
      ]
    );
  }
}

export async function setUserPassword(db, { userId, password } = {}) {
  const safeUserId = String(userId ?? '').trim();
  if (!safeUserId) {
    throw new Error('userId is required');
  }
  await setUserPasswordCredential(db, safeUserId, password);
  return true;
}

async function createSession(db, userId, { ttlDays = 30, userAgent = null, ipAddress = null } = {}) {
  const token = createSessionToken();
  const tokenHash = hashToken(token);
  const timestamp = nowIso();
  const safeTtlDays = Number.isFinite(Number(ttlDays)) && Number(ttlDays) > 0
    ? Number(ttlDays)
    : 30;
  const expiresAt = new Date(Date.now() + safeTtlDays * 24 * 60 * 60 * 1000).toISOString();
  const row = {
    id: randomUUID(),
    user_id: userId,
    session_token_hash: tokenHash,
    created_at: timestamp,
    updated_at: timestamp,
    expires_at: expiresAt,
    revoked_at: null,
    ip_address: ipAddress ? String(ipAddress).slice(0, 128) : null,
    user_agent: userAgent ? String(userAgent).slice(0, 512) : null
  };
  await db.exec(
    `INSERT INTO auth_sessions (
      id, user_id, session_token_hash, created_at, updated_at, expires_at, revoked_at, ip_address, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.user_id,
      row.session_token_hash,
      row.created_at,
      row.updated_at,
      row.expires_at,
      row.revoked_at,
      row.ip_address,
      row.user_agent
    ]
  );
  return {
    token,
    session: row
  };
}

async function getActiveSessionByToken(db, token) {
  const safeToken = String(token ?? '').trim();
  if (!safeToken) return null;
  const tokenHash = hashToken(safeToken);
  const row = await db.queryOne(
    `SELECT s.*, u.display_name, u.email, u.org_id, u.org_role, u.archived AS user_archived
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.session_token_hash = ?
      LIMIT 1`,
    [tokenHash]
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (Number(row.user_archived)) return null;
  const expiresAtMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;
  return row;
}

export async function resolveSessionUser(db, sessionToken) {
  const session = await getActiveSessionByToken(db, sessionToken);
  if (!session) return null;
  await db.exec('UPDATE auth_sessions SET updated_at = ? WHERE id = ?', [nowIso(), session.id]);
  const workspaces = await listUserWorkspaces(db, session.user_id);
  return {
    user: {
      id: session.user_id,
      org_id: session.org_id,
      display_name: session.display_name,
      email: session.email,
      org_role: session.org_role ?? 'member'
    },
    session: {
      id: session.id,
      expires_at: session.expires_at
    },
    workspaces
  };
}

export async function revokeSessionByToken(db, sessionToken) {
  const safeToken = String(sessionToken ?? '').trim();
  if (!safeToken) return false;
  const tokenHash = hashToken(safeToken);
  const timestamp = nowIso();
  const existing = await db.queryOne(
    'SELECT id FROM auth_sessions WHERE session_token_hash = ? AND revoked_at IS NULL LIMIT 1',
    [tokenHash]
  );
  if (!existing) return false;
  await db.exec('UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE id = ?', [timestamp, timestamp, existing.id]);
  return true;
}

function sanitizeMachineActor(machineActor) {
  if (!machineActor) return null;
  return {
    id: machineActor.id,
    org_id: machineActor.org_id,
    principal: machineActor.principal,
    display_name: machineActor.display_name,
    org_role: normalizeOrgRole(machineActor.org_role),
    all_workspaces: Number(machineActor.all_workspaces) ? 1 : 0,
    archived: Number(machineActor.archived) ? 1 : 0,
    created_at: machineActor.created_at ?? null,
    updated_at: machineActor.updated_at ?? null
  };
}

function sanitizeMachineToken(machineToken, { includeToken = false } = {}) {
  if (!machineToken) return null;
  return {
    id: machineToken.id,
    machine_actor_id: machineToken.machine_actor_id,
    label: machineToken.label ?? null,
    created_at: machineToken.created_at ?? null,
    updated_at: machineToken.updated_at ?? null,
    expires_at: machineToken.expires_at ?? null,
    revoked_at: machineToken.revoked_at ?? null,
    last_used_at: machineToken.last_used_at ?? null,
    ...(includeToken && machineToken.token ? { token: machineToken.token } : {})
  };
}

function sanitizeMachineWorkspaceGrant(grant) {
  if (!grant) return null;
  return {
    id: grant.id,
    machine_actor_id: grant.machine_actor_id,
    workspace_id: grant.workspace_id,
    workspace_name: grant.workspace_name ?? null,
    org_id: grant.org_id ?? null,
    role: grant.role ?? 'member',
    created_at: grant.created_at ?? null,
    updated_at: grant.updated_at ?? null
  };
}

async function getMachineActorById(db, machineActorId) {
  return db.queryOne(
    'SELECT * FROM auth_machine_actors WHERE id = ? LIMIT 1',
    [String(machineActorId ?? '').trim()]
  );
}

async function getMachineActorByPrincipal(db, orgId, principal) {
  return db.queryOne(
    'SELECT * FROM auth_machine_actors WHERE org_id = ? AND principal = ? LIMIT 1',
    [orgId, principal]
  );
}

async function getMachineTokenById(db, tokenId) {
  return db.queryOne(
    'SELECT * FROM auth_machine_tokens WHERE id = ? LIMIT 1',
    [String(tokenId ?? '').trim()]
  );
}

async function getActiveMachineTokenByToken(db, token) {
  const safeToken = String(token ?? '').trim();
  if (!safeToken) return null;
  const tokenHash = hashToken(safeToken);
  const row = await db.queryOne(
    `SELECT t.*, a.org_id, a.principal, a.display_name, a.org_role, a.all_workspaces, a.archived AS actor_archived
       FROM auth_machine_tokens t
       JOIN auth_machine_actors a ON a.id = t.machine_actor_id
      WHERE t.token_hash = ?
      LIMIT 1`,
    [tokenHash]
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (Number(row.actor_archived)) return null;
  if (row.expires_at) {
    const expiresAtMs = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;
  }
  return row;
}

export async function listMachineActorWorkspaces(db, machineActorId) {
  const actor = await getMachineActorById(db, machineActorId);
  if (!actor || Number(actor.archived)) return [];
  if (Number(actor.all_workspaces)) {
    return db.query(
      `SELECT w.*, COALESCE(g.role, ?) AS role
         FROM workspaces w
         LEFT JOIN auth_machine_workspace_grants g
           ON g.workspace_id = w.id AND g.machine_actor_id = ?
        WHERE w.org_id = ? AND w.archived = 0
        ORDER BY w.created_at ASC`,
      [normalizeOrgRole(actor.org_role), actor.id, actor.org_id]
    );
  }
  return db.query(
    `SELECT w.*, g.role
       FROM auth_machine_workspace_grants g
       JOIN workspaces w ON w.id = g.workspace_id
      WHERE g.machine_actor_id = ? AND w.archived = 0
      ORDER BY w.created_at ASC`,
    [actor.id]
  );
}

export async function resolveMachineActor(db, bearerToken) {
  const tokenRow = await getActiveMachineTokenByToken(db, bearerToken);
  if (!tokenRow) return null;
  const timestamp = nowIso();
  await db.exec('UPDATE auth_machine_tokens SET last_used_at = ?, updated_at = ? WHERE id = ?', [timestamp, timestamp, tokenRow.id]);
  const workspaces = await listMachineActorWorkspaces(db, tokenRow.machine_actor_id);
  return {
    machine: sanitizeMachineActor({
      id: tokenRow.machine_actor_id,
      org_id: tokenRow.org_id,
      principal: tokenRow.principal,
      display_name: tokenRow.display_name,
      org_role: tokenRow.org_role,
      all_workspaces: tokenRow.all_workspaces,
      archived: tokenRow.actor_archived
    }),
    token: sanitizeMachineToken({
      id: tokenRow.id,
      machine_actor_id: tokenRow.machine_actor_id,
      label: tokenRow.label,
      created_at: tokenRow.created_at,
      updated_at: timestamp,
      expires_at: tokenRow.expires_at,
      revoked_at: tokenRow.revoked_at,
      last_used_at: timestamp
    }),
    workspaces
  };
}

export async function listMachineActors(db, { orgId, includeArchived = true } = {}) {
  const safeOrgId = normalizeText(orgId, 'org_id', { required: true, maxLength: 64 });
  const rows = await db.query(
    `SELECT *
       FROM auth_machine_actors
      WHERE org_id = ?
      ORDER BY archived ASC, created_at ASC`,
    [safeOrgId]
  );
  return rows
    .filter((row) => includeArchived || !Number(row.archived))
    .map(sanitizeMachineActor);
}

export async function createMachineActor(
  db,
  { org_id: orgId, principal, display_name: displayName, org_role: orgRole = 'member', all_workspaces: allWorkspaces = false } = {}
) {
  const safeOrgId = normalizeText(orgId, 'org_id', { required: true, maxLength: 64 });
  const safePrincipal = normalizeText(principal, 'principal', { required: true, maxLength: 512 });
  const safeDisplayName = normalizeText(displayName, 'display_name', { required: true, maxLength: 256 });
  const existing = await getMachineActorByPrincipal(db, safeOrgId, safePrincipal);
  if (existing) {
    return sanitizeMachineActor(existing);
  }
  const timestamp = nowIso();
  const actor = {
    id: randomUUID(),
    org_id: safeOrgId,
    principal: safePrincipal,
    display_name: safeDisplayName,
    org_role: normalizeOrgRole(orgRole),
    all_workspaces: normalizeBoolean(allWorkspaces, false) ? 1 : 0,
    archived: 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  await db.exec(
    `INSERT INTO auth_machine_actors (
      id, org_id, principal, display_name, org_role, all_workspaces, archived, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actor.id,
      actor.org_id,
      actor.principal,
      actor.display_name,
      actor.org_role,
      actor.all_workspaces,
      actor.archived,
      actor.created_at,
      actor.updated_at
    ]
  );
  return sanitizeMachineActor(actor);
}

export async function updateMachineActor(db, machineActorId, patch = {}) {
  const existing = await getMachineActorById(db, machineActorId);
  if (!existing) return null;
  const next = {
    ...existing,
    display_name: patch.display_name !== undefined
      ? normalizeText(patch.display_name, 'display_name', { required: true, maxLength: 256 })
      : existing.display_name,
    org_role: patch.org_role !== undefined
      ? normalizeOrgRole(patch.org_role)
      : normalizeOrgRole(existing.org_role),
    all_workspaces: patch.all_workspaces !== undefined
      ? (normalizeBoolean(patch.all_workspaces, Number(existing.all_workspaces) === 1) ? 1 : 0)
      : (Number(existing.all_workspaces) ? 1 : 0),
    archived: patch.archived !== undefined
      ? (normalizeBoolean(patch.archived, Number(existing.archived) === 1) ? 1 : 0)
      : (Number(existing.archived) ? 1 : 0),
    updated_at: nowIso()
  };
  await db.exec(
    `UPDATE auth_machine_actors
        SET display_name = ?, org_role = ?, all_workspaces = ?, archived = ?, updated_at = ?
      WHERE id = ?`,
    [next.display_name, next.org_role, next.all_workspaces, next.archived, next.updated_at, existing.id]
  );
  return sanitizeMachineActor(next);
}

export async function listMachineTokens(db, machineActorId) {
  const actor = await getMachineActorById(db, machineActorId);
  if (!actor) return [];
  const rows = await db.query(
    `SELECT *
       FROM auth_machine_tokens
      WHERE machine_actor_id = ?
      ORDER BY created_at DESC`,
    [actor.id]
  );
  return rows.map((row) => sanitizeMachineToken(row));
}

export async function createMachineActorToken(
  db,
  machineActorId,
  { label = null, expires_at: expiresAt = null } = {}
) {
  const actor = await getMachineActorById(db, machineActorId);
  if (!actor || Number(actor.archived)) {
    throw new Error('Machine actor not found');
  }
  const token = createMachineToken();
  const timestamp = nowIso();
  const row = {
    id: randomUUID(),
    machine_actor_id: actor.id,
    label: normalizeText(label, 'label', { required: false, maxLength: 256 }) ?? null,
    token_hash: hashToken(token),
    created_at: timestamp,
    updated_at: timestamp,
    expires_at: normalizeDateTime(expiresAt, 'expires_at'),
    revoked_at: null,
    last_used_at: null
  };
  await db.exec(
    `INSERT INTO auth_machine_tokens (
      id, machine_actor_id, label, token_hash, created_at, updated_at, expires_at, revoked_at, last_used_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.machine_actor_id,
      row.label,
      row.token_hash,
      row.created_at,
      row.updated_at,
      row.expires_at,
      row.revoked_at,
      row.last_used_at
    ]
  );
  return {
    machine: sanitizeMachineActor(actor),
    token: sanitizeMachineToken({ ...row, token }, { includeToken: true })
  };
}

export async function revokeMachineToken(db, tokenId) {
  const existing = await getMachineTokenById(db, tokenId);
  if (!existing || existing.revoked_at) return false;
  const timestamp = nowIso();
  await db.exec(
    'UPDATE auth_machine_tokens SET revoked_at = ?, updated_at = ? WHERE id = ?',
    [timestamp, timestamp, existing.id]
  );
  return true;
}

export async function listMachineWorkspaceGrants(db, machineActorId) {
  const actor = await getMachineActorById(db, machineActorId);
  if (!actor) return [];
  const rows = await db.query(
    `SELECT g.*, w.name AS workspace_name, w.org_id
       FROM auth_machine_workspace_grants g
       JOIN workspaces w ON w.id = g.workspace_id
      WHERE g.machine_actor_id = ?
      ORDER BY w.created_at ASC`,
    [actor.id]
  );
  return rows.map(sanitizeMachineWorkspaceGrant);
}

export async function createMachineWorkspaceGrant(
  db,
  machineActorId,
  { workspace_id: workspaceId, role = 'member' } = {}
) {
  const actor = await getMachineActorById(db, machineActorId);
  if (!actor || Number(actor.archived)) {
    throw new Error('Machine actor not found');
  }
  const workspace = await db.queryOne(
    'SELECT id, org_id, name FROM workspaces WHERE id = ? LIMIT 1',
    [normalizeText(workspaceId, 'workspace_id', { required: true, maxLength: 64 })]
  );
  if (!workspace) {
    throw new Error('Workspace not found');
  }
  if (workspace.org_id !== actor.org_id) {
    throw new Error('Workspace must belong to the same organization');
  }
  const existing = await db.queryOne(
    `SELECT g.*, w.name AS workspace_name, w.org_id
       FROM auth_machine_workspace_grants g
       JOIN workspaces w ON w.id = g.workspace_id
      WHERE g.machine_actor_id = ? AND g.workspace_id = ?
      LIMIT 1`,
    [actor.id, workspace.id]
  );
  if (existing) {
    return sanitizeMachineWorkspaceGrant(existing);
  }
  const timestamp = nowIso();
  const grant = {
    id: randomUUID(),
    machine_actor_id: actor.id,
    workspace_id: workspace.id,
    role: normalizeOrgRole(role),
    created_at: timestamp,
    updated_at: timestamp,
    workspace_name: workspace.name,
    org_id: workspace.org_id
  };
  await db.exec(
    `INSERT INTO auth_machine_workspace_grants (
      id, machine_actor_id, workspace_id, role, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      grant.id,
      grant.machine_actor_id,
      grant.workspace_id,
      grant.role,
      grant.created_at,
      grant.updated_at
    ]
  );
  return sanitizeMachineWorkspaceGrant(grant);
}

export async function revokeMachineWorkspaceGrant(db, grantId) {
  const existing = await db.queryOne(
    'SELECT id FROM auth_machine_workspace_grants WHERE id = ? LIMIT 1',
    [String(grantId ?? '').trim()]
  );
  if (!existing) return false;
  await db.exec('DELETE FROM auth_machine_workspace_grants WHERE id = ?', [existing.id]);
  return true;
}

export async function machineActorHasWorkspaceAccess(db, machineActorId, workspaceId) {
  const actor = await getMachineActorById(db, machineActorId);
  if (!actor || Number(actor.archived)) return false;
  const safeWorkspaceId = String(workspaceId ?? '').trim();
  if (!safeWorkspaceId) return false;
  if (Number(actor.all_workspaces)) {
    const workspace = await db.queryOne(
      'SELECT id FROM workspaces WHERE id = ? AND org_id = ? AND archived = 0 LIMIT 1',
      [safeWorkspaceId, actor.org_id]
    );
    return Boolean(workspace);
  }
  const grant = await db.queryOne(
    `SELECT g.id
       FROM auth_machine_workspace_grants g
       JOIN workspaces w ON w.id = g.workspace_id
      WHERE g.machine_actor_id = ? AND g.workspace_id = ? AND w.archived = 0
      LIMIT 1`,
    [actor.id, safeWorkspaceId]
  );
  return Boolean(grant);
}

export async function loginWithPassword(db, { email, password, ttlDays = 30, userAgent = null, ipAddress = null } = {}) {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail) {
    throw new Error('Valid email is required');
  }
  const user = await db.queryOne(
    `SELECT u.*, c.password_hash, c.password_salt, c.password_algo
       FROM users u
       JOIN auth_credentials c ON c.user_id = u.id
      WHERE u.email = ? AND u.archived = 0
      ORDER BY u.created_at ASC
      LIMIT 1`,
    [safeEmail]
  );
  if (!user) {
    throw new Error('Invalid email or password');
  }
  const matches = await verifyPassword(password, user);
  if (!matches) {
    throw new Error('Invalid email or password');
  }
  const { token, session } = await createSession(db, user.id, { ttlDays, userAgent, ipAddress });
  const workspaces = await listUserWorkspaces(db, user.id);
  return {
    token,
    user: {
      id: user.id,
      org_id: user.org_id,
      display_name: user.display_name,
      email: user.email,
      org_role: user.org_role ?? 'member'
    },
    session: {
      id: session.id,
      expires_at: session.expires_at
    },
    workspaces
  };
}

export async function acceptInviteRegistration(
  db,
  {
    inviteToken,
    email,
    displayName,
    password,
    ttlDays = 30,
    userAgent = null,
    ipAddress = null,
    clientId = null
  } = {}
) {
  const safeInviteToken = normalizeInviteToken(inviteToken);
  if (!safeInviteToken) {
    throw new Error('invite_token is required');
  }
  const invite = await getInviteByToken(db, safeInviteToken);
  if (!invite) {
    throw new Error('Invite not found');
  }
  if (invite.status !== 'pending') {
    throw new Error('Invite is no longer pending');
  }
  const expiresAt = Date.parse(invite.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await db.exec(
      'UPDATE user_invites SET status = ?, updated_at = ? WHERE id = ?',
      ['expired', nowIso(), invite.id]
    );
    throw new Error('Invite has expired');
  }
  const safeDisplayName = String(displayName ?? '').trim();
  if (!safeDisplayName) {
    throw new Error('display_name is required');
  }
  const inviteEmail = normalizeEmail(invite.email);
  if (!inviteEmail) {
    throw new Error('Invite email is invalid');
  }
  const requestedEmail = normalizeEmail(email);
  if (!requestedEmail) {
    throw new Error('email is required');
  }
  if (requestedEmail !== inviteEmail) {
    throw new Error('email does not match invite');
  }
  assertValidPassword(password);

  let result = null;
  await db.transaction(async (tx) => {
    const inviteOrgRole = normalizeOrgRole(invite.role);
    let user = await getUserByOrgEmail(tx, invite.org_id, inviteEmail);
    if (user && Number(user.archived)) {
      await tx.exec(
        'UPDATE users SET archived = 0, display_name = ?, updated_at = ? WHERE id = ?',
        [safeDisplayName, nowIso(), user.id]
      );
      user = await tx.queryOne('SELECT * FROM users WHERE id = ?', [user.id]);
    }
    if (!user) {
      user = await createUser(
        tx,
        {
          org_id: invite.org_id,
          workspace_id: invite.workspace_id,
          display_name: safeDisplayName,
          email: inviteEmail,
          org_role: inviteOrgRole
        },
        clientId
      );
    } else if (inviteOrgRole === 'admin' && normalizeOrgRole(user.org_role) !== 'admin') {
      user = await updateUser(
        tx,
        user.id,
        { org_role: 'admin' },
        clientId
      );
    }
    await createWorkspaceMembership(
      tx,
      {
        workspace_id: invite.workspace_id,
        user_id: user.id,
        role: inviteOrgRole
      },
      clientId
    );
    await setUserPasswordCredential(tx, user.id, password);
    const timestamp = nowIso();
    await tx.exec(
      'UPDATE user_invites SET status = ?, accepted_at = ?, updated_at = ? WHERE id = ?',
      ['accepted', timestamp, timestamp, invite.id]
    );
    const { token, session } = await createSession(tx, user.id, { ttlDays, userAgent, ipAddress });
    const workspaces = await listUserWorkspaces(tx, user.id);
    result = {
      token,
      user: {
        id: user.id,
        org_id: user.org_id,
        display_name: user.display_name,
        email: user.email,
        org_role: user.org_role ?? 'member'
      },
      invite: {
        id: invite.id,
        workspace_id: invite.workspace_id,
        workspace_name: invite.workspace_name,
        role: invite.role
      },
      session: {
        id: session.id,
        expires_at: session.expires_at
      },
      workspaces
    };
  });
  return result;
}

export async function listUserWorkspaces(db, userId) {
  return db.query(
    `SELECT w.*, wm.role
       FROM workspace_memberships wm
       JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = ? AND wm.archived = 0 AND w.archived = 0
      ORDER BY w.created_at ASC`,
    [userId]
  );
}
