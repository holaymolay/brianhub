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

function hashToken(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function createSessionToken() {
  return randomBytes(32).toString('base64url');
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
