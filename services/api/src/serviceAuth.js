import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  intersectPermissionSets,
  normalizePermissionKeys
} from './permissionRegistry.js';

const API_TOKEN_PREFIX = 'bht';

function nowIso() {
  return new Date().toISOString();
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

function normalizeMetadataObject(value, fieldName) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value;
}

function parseJsonArray(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(text) {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function hashSecret(secret) {
  return createHash('sha256').update(String(secret ?? '')).digest('hex');
}

function constantTimeHexEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue ?? ''), 'hex');
  const right = Buffer.from(String(rightValue ?? ''), 'hex');
  if (!left.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function createOpaqueApiToken() {
  const publicId = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return {
    token_public_id: publicId,
    token_secret_hash: hashSecret(secret),
    token: `${API_TOKEN_PREFIX}_${publicId}_${secret}`
  };
}

function parseOpaqueApiToken(rawToken) {
  const safeToken = String(rawToken ?? '').trim();
  const match = safeToken.match(/^bht_([a-f0-9]{16})_([A-Za-z0-9_-]{20,})$/i);
  if (!match) return null;
  return {
    token_public_id: match[1].toLowerCase(),
    secret: match[2]
  };
}

function normalizeAliasEntries(values, { allowUndefined = true } = {}) {
  if (values === undefined) {
    if (allowUndefined) return undefined;
    return [];
  }
  if (values === null) return [];
  if (!Array.isArray(values)) {
    throw new Error('aliases must be an array');
  }
  const seen = new Set();
  const aliases = [];
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid alias');
    }
    const aliasType = normalizeText(value.alias_type ?? value.type, 'alias_type', { required: true, maxLength: 128 });
    const aliasValue = normalizeText(value.alias_value ?? value.value, 'alias_value', { required: true, maxLength: 512 });
    const metadata = normalizeMetadataObject(value.metadata ?? {}, 'alias metadata');
    const key = `${aliasType}:${aliasValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push({
      alias_type: aliasType,
      alias_value: aliasValue,
      metadata
    });
  }
  return aliases;
}

function normalizePermissionConstraintKeys(values) {
  if (values === undefined) return undefined;
  return normalizePermissionKeys(values, { allowNull: true });
}

function sanitizeAlias(row) {
  if (!row) return null;
  return {
    id: row.id,
    alias_type: row.alias_type,
    alias_value: row.alias_value,
    metadata: parseJsonObject(row.metadata_json),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null
  };
}

function sanitizeServiceAccount(row, aliases = []) {
  if (!row) return null;
  const summary = row.summary && typeof row.summary === 'object' && !Array.isArray(row.summary)
    ? row.summary
    : {
        token_count: Number(row.token_count) || 0,
        active_token_count: Number(row.active_token_count) || 0,
        workspace_grant_count: Number(row.workspace_grant_count) || 0,
        effective_workspace_count: Number(row.effective_workspace_count) || 0,
        last_token_used_at: row.last_token_used_at ?? null,
        last_activity_at: row.last_activity_at ?? null
      };
  return {
    id: row.id,
    org_id: row.org_id,
    created_by_user_id: row.created_by_user_id ?? null,
    display_name: row.display_name,
    description: row.description ?? null,
    permissions: normalizePermissionKeys(parseJsonArray(row.permissions_json)),
    archived: Number(row.archived) ? 1 : 0,
    aliases,
    summary,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null
  };
}

function sanitizeApiToken(row, { includeToken = false } = {}) {
  if (!row) return null;
  const permissionConstraints = row.permission_constraints_json === null || row.permission_constraints_json === undefined
    ? null
    : normalizePermissionKeys(parseJsonArray(row.permission_constraints_json));
  return {
    id: row.id,
    owner_kind: row.owner_kind,
    owner_id: row.owner_id,
    label: row.label ?? null,
    token_public_id: row.token_public_id,
    permission_constraints: permissionConstraints,
    created_by_user_id: row.created_by_user_id ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    expires_at: row.expires_at ?? null,
    revoked_at: row.revoked_at ?? null,
    last_used_at: row.last_used_at ?? null,
    rotated_from_token_id: row.rotated_from_token_id ?? null,
    replaced_by_token_id: row.replaced_by_token_id ?? null,
    ...(includeToken && row.token ? { token: row.token } : {})
  };
}

function sanitizeWorkspaceGrant(row) {
  if (!row) return null;
  return {
    id: row.id,
    service_account_id: row.service_account_id,
    workspace_id: row.workspace_id,
    workspace_name: row.workspace_name ?? null,
    org_id: row.org_id ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null
  };
}

function sanitizeServiceAccountActivityEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    org_id: row.org_id,
    service_account_id: row.service_account_id,
    token_id: row.token_id ?? null,
    token_label: row.token_label ?? null,
    token_public_id: row.token_public_id ?? null,
    workspace_id: row.workspace_id ?? null,
    workspace_name: row.workspace_name ?? null,
    actor_user_id: row.actor_user_id ?? null,
    actor_email: row.actor_email ?? null,
    actor_display_name: row.actor_display_name ?? null,
    event_type: row.event_type,
    request_method: row.request_method ?? null,
    request_path: row.request_path ?? null,
    status_code: row.status_code ?? null,
    metadata: parseJsonObject(row.metadata_json),
    created_at: row.created_at ?? null
  };
}

async function insertServiceAccountActivity(
  dbLike,
  {
    orgId,
    serviceAccountId,
    tokenId = null,
    workspaceId = null,
    actorUserId = null,
    eventType,
    requestMethod = null,
    requestPath = null,
    statusCode = null,
    metadata = {}
  } = {}
) {
  const safeOrgId = normalizeText(orgId, 'org_id', { required: true, maxLength: 64 });
  const safeServiceAccountId = normalizeText(serviceAccountId, 'service_account_id', { required: true, maxLength: 64 });
  const safeEventType = normalizeText(eventType, 'event_type', { required: true, maxLength: 128 });
  const safeTokenId = normalizeText(tokenId, 'token_id', { maxLength: 64 }) ?? null;
  const safeWorkspaceId = normalizeText(workspaceId, 'workspace_id', { maxLength: 64 }) ?? null;
  const safeActorUserId = normalizeText(actorUserId, 'actor_user_id', { maxLength: 64 }) ?? null;
  const safeMethod = normalizeText(requestMethod, 'request_method', { maxLength: 16 }) ?? null;
  const safePath = normalizeText(requestPath, 'request_path', { maxLength: 512 }) ?? null;
  const safeStatusCode = statusCode === null || statusCode === undefined || statusCode === ''
    ? null
    : Number(statusCode);
  const safeMetadata = normalizeMetadataObject(metadata ?? {}, 'metadata');
  const row = {
    id: randomUUID(),
    org_id: safeOrgId,
    service_account_id: safeServiceAccountId,
    token_id: safeTokenId,
    workspace_id: safeWorkspaceId,
    actor_user_id: safeActorUserId,
    event_type: safeEventType,
    request_method: safeMethod,
    request_path: safePath,
    status_code: Number.isInteger(safeStatusCode) ? safeStatusCode : null,
    metadata_json: JSON.stringify(safeMetadata),
    created_at: nowIso()
  };
  await dbLike.exec(
    `INSERT INTO service_account_activity_events (
      id, org_id, service_account_id, token_id, workspace_id, actor_user_id,
      event_type, request_method, request_path, status_code, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.org_id,
      row.service_account_id,
      row.token_id,
      row.workspace_id,
      row.actor_user_id,
      row.event_type,
      row.request_method,
      row.request_path,
      row.status_code,
      row.metadata_json,
      row.created_at
    ]
  );
  return sanitizeServiceAccountActivityEvent(row);
}

async function getServiceAccountById(db, serviceAccountId) {
  return db.queryOne(
    'SELECT * FROM service_accounts WHERE id = ? LIMIT 1',
    [String(serviceAccountId ?? '').trim()]
  );
}

async function getTokenById(db, tokenId) {
  return db.queryOne(
    'SELECT * FROM api_tokens WHERE id = ? LIMIT 1',
    [String(tokenId ?? '').trim()]
  );
}

function isTokenCurrentlyActive(tokenRow) {
  if (!tokenRow || tokenRow.revoked_at) return false;
  if (!tokenRow.expires_at) return true;
  const expiresAtMs = Date.parse(String(tokenRow.expires_at));
  return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
}

async function getAliasesForServiceAccount(db, serviceAccountId) {
  const rows = await db.query(
    `SELECT *
       FROM service_account_aliases
      WHERE service_account_id = ?
      ORDER BY created_at ASC`,
    [serviceAccountId]
  );
  return rows.map(sanitizeAlias);
}

async function getServiceAccountSummary(db, serviceAccountId) {
  const safeServiceAccountId = String(serviceAccountId ?? '').trim();
  if (!safeServiceAccountId) {
    return {
      token_count: 0,
      active_token_count: 0,
      workspace_grant_count: 0,
      effective_workspace_count: 0,
      last_token_used_at: null,
      last_activity_at: null
    };
  }
  const [tokenRows, workspaceGrantRow, effectiveWorkspaceRow, activityRow] = await Promise.all([
    db.query(
      `SELECT revoked_at, expires_at, last_used_at
         FROM api_tokens
        WHERE owner_kind = 'service_account' AND owner_id = ?`,
      [safeServiceAccountId]
    ),
    db.queryOne(
      `SELECT COUNT(*) AS workspace_grant_count
         FROM service_account_workspace_grants
        WHERE service_account_id = ?`,
      [safeServiceAccountId]
    ),
    db.queryOne(
      `SELECT COUNT(*) AS effective_workspace_count
         FROM service_account_workspace_grants g
         JOIN workspaces w ON w.id = g.workspace_id
        WHERE g.service_account_id = ? AND w.archived = 0`,
      [safeServiceAccountId]
    ),
    db.queryOne(
      `SELECT MAX(created_at) AS last_activity_at
         FROM service_account_activity_events
        WHERE service_account_id = ?`,
      [safeServiceAccountId]
    )
  ]);
  const sortedTokenUse = tokenRows
    .map((row) => String(row?.last_used_at ?? '').trim())
    .filter(Boolean)
    .sort((left, right) => (Date.parse(right) || 0) - (Date.parse(left) || 0));
  return {
    token_count: tokenRows.length,
    active_token_count: tokenRows.filter((row) => isTokenCurrentlyActive(row)).length,
    workspace_grant_count: Number(workspaceGrantRow?.workspace_grant_count) || 0,
    effective_workspace_count: Number(effectiveWorkspaceRow?.effective_workspace_count) || 0,
    last_token_used_at: sortedTokenUse[0] ?? null,
    last_activity_at: activityRow?.last_activity_at ?? null
  };
}

async function hydrateServiceAccount(db, row) {
  if (!row) return null;
  const [aliases, summary] = await Promise.all([
    getAliasesForServiceAccount(db, row.id),
    getServiceAccountSummary(db, row.id)
  ]);
  return sanitizeServiceAccount({ ...row, summary }, aliases);
}

async function replaceServiceAccountAliases(tx, serviceAccount, aliases) {
  await tx.exec('DELETE FROM service_account_aliases WHERE service_account_id = ?', [serviceAccount.id]);
  if (!aliases.length) return;
  const timestamp = nowIso();
  for (const alias of aliases) {
    await tx.exec(
      `INSERT INTO service_account_aliases (
        id, org_id, service_account_id, alias_type, alias_value, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        serviceAccount.org_id,
        serviceAccount.id,
        alias.alias_type,
        alias.alias_value,
        JSON.stringify(alias.metadata ?? {}),
        timestamp,
        timestamp
      ]
    );
  }
}

function getServiceAccountBaselinePermissions(serviceAccountRow) {
  return normalizePermissionKeys(parseJsonArray(serviceAccountRow?.permissions_json));
}

function getTokenPermissionConstraints(tokenRow) {
  if (!tokenRow) return null;
  if (tokenRow.permission_constraints_json === null || tokenRow.permission_constraints_json === undefined) {
    return null;
  }
  return normalizePermissionKeys(parseJsonArray(tokenRow.permission_constraints_json));
}

function computeEffectivePermissions(serviceAccountRow, tokenRow) {
  const baselinePermissions = getServiceAccountBaselinePermissions(serviceAccountRow);
  const tokenConstraints = getTokenPermissionConstraints(tokenRow);
  const effectivePermissions = tokenConstraints === null
    ? baselinePermissions
    : intersectPermissionSets(baselinePermissions, tokenConstraints);
  return {
    grantedPermissions: baselinePermissions,
    tokenConstraints,
    effectivePermissions
  };
}

export async function listServiceAccounts(db, { orgId, includeArchived = true } = {}) {
  const safeOrgId = normalizeText(orgId, 'org_id', { required: true, maxLength: 64 });
  const rows = await db.query(
    `SELECT *
       FROM service_accounts
      WHERE org_id = ?
      ORDER BY archived ASC, created_at ASC`,
    [safeOrgId]
  );
  const filtered = rows.filter((row) => includeArchived || !Number(row.archived));
  const accounts = [];
  for (const row of filtered) {
    accounts.push(await hydrateServiceAccount(db, row));
  }
  return accounts;
}

export async function createServiceAccount(
  db,
  { org_id: orgId, display_name: displayName, description = null, permissions = [], aliases = [] } = {},
  { createdByUserId = null } = {}
) {
  const safeOrgId = normalizeText(orgId, 'org_id', { required: true, maxLength: 64 });
  const safeDisplayName = normalizeText(displayName, 'display_name', { required: true, maxLength: 256 });
  const safeDescription = normalizeText(description, 'description', { maxLength: 1024 }) ?? null;
  const normalizedPermissions = normalizePermissionKeys(permissions ?? []);
  const normalizedAliases = normalizeAliasEntries(aliases, { allowUndefined: false });
  const timestamp = nowIso();
  const row = {
    id: randomUUID(),
    org_id: safeOrgId,
    display_name: safeDisplayName,
    description: safeDescription,
    permissions_json: JSON.stringify(normalizedPermissions),
    archived: 0,
    created_at: timestamp,
    updated_at: timestamp,
    created_by_user_id: createdByUserId
  };
  await db.transaction(async (tx) => {
    await tx.exec(
      `INSERT INTO service_accounts (
        id, org_id, display_name, description, permissions_json, archived, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.org_id,
        row.display_name,
        row.description,
        row.permissions_json,
        row.archived,
        row.created_by_user_id,
        row.created_at,
        row.updated_at
      ]
    );
    await replaceServiceAccountAliases(tx, row, normalizedAliases);
    await insertServiceAccountActivity(tx, {
      orgId: row.org_id,
      serviceAccountId: row.id,
      actorUserId: createdByUserId,
      eventType: 'service_account.created',
      metadata: {
        display_name: row.display_name,
        permissions: normalizedPermissions,
        alias_count: normalizedAliases.length
      }
    });
  });
  return await hydrateServiceAccount(db, row);
}

export async function updateServiceAccount(db, serviceAccountId, patch = {}, { actorUserId = null } = {}) {
  const existing = await getServiceAccountById(db, serviceAccountId);
  if (!existing) return null;
  const nextPermissions = patch.permissions !== undefined
    ? normalizePermissionKeys(patch.permissions ?? [])
    : getServiceAccountBaselinePermissions(existing);
  const nextAliases = normalizeAliasEntries(patch.aliases, { allowUndefined: true });
  const next = {
    ...existing,
    display_name: patch.display_name !== undefined
      ? normalizeText(patch.display_name, 'display_name', { required: true, maxLength: 256 })
      : existing.display_name,
    description: patch.description !== undefined
      ? (normalizeText(patch.description, 'description', { maxLength: 1024 }) ?? null)
      : (existing.description ?? null),
    permissions_json: JSON.stringify(nextPermissions),
    archived: patch.archived !== undefined
      ? (normalizeBoolean(patch.archived, Number(existing.archived) === 1) ? 1 : 0)
      : (Number(existing.archived) ? 1 : 0),
    updated_at: nowIso()
  };
  await db.transaction(async (tx) => {
    await tx.exec(
      `UPDATE service_accounts
          SET display_name = ?, description = ?, permissions_json = ?, archived = ?, updated_at = ?
        WHERE id = ?`,
      [
        next.display_name,
        next.description,
        next.permissions_json,
        next.archived,
        next.updated_at,
        existing.id
      ]
    );
    if (nextAliases !== undefined) {
      await replaceServiceAccountAliases(tx, next, nextAliases);
    }
    await insertServiceAccountActivity(tx, {
      orgId: existing.org_id,
      serviceAccountId: existing.id,
      actorUserId,
      eventType: 'service_account.updated',
      metadata: {
        display_name: next.display_name,
        archived: next.archived,
        permissions: nextPermissions,
        alias_count: nextAliases !== undefined ? nextAliases.length : undefined
      }
    });
  });
  return await hydrateServiceAccount(db, next);
}

export async function listServiceAccountTokens(db, serviceAccountId) {
  const serviceAccount = await getServiceAccountById(db, serviceAccountId);
  if (!serviceAccount) return [];
  const rows = await db.query(
    `SELECT *
       FROM api_tokens
      WHERE owner_kind = 'service_account' AND owner_id = ?
      ORDER BY created_at DESC`,
    [serviceAccount.id]
  );
  return rows.map((row) => sanitizeApiToken(row));
}

export async function createServiceAccountToken(
  db,
  serviceAccountId,
  { label = null, permission_constraints: permissionConstraints, expires_at: expiresAt = null } = {},
  { createdByUserId = null } = {}
) {
  const serviceAccount = await getServiceAccountById(db, serviceAccountId);
  if (!serviceAccount || Number(serviceAccount.archived)) {
    throw new Error('Service account not found');
  }
  const generated = createOpaqueApiToken();
  const normalizedConstraints = permissionConstraints === undefined
    ? null
    : normalizePermissionConstraintKeys(permissionConstraints);
  const timestamp = nowIso();
  const row = {
    id: randomUUID(),
    owner_kind: 'service_account',
    owner_id: serviceAccount.id,
    label: normalizeText(label, 'label', { maxLength: 256 }) ?? null,
    token_public_id: generated.token_public_id,
    token_secret_hash: generated.token_secret_hash,
    permission_constraints_json: normalizedConstraints === null ? null : JSON.stringify(normalizedConstraints),
    expires_at: normalizeDateTime(expiresAt, 'expires_at'),
    revoked_at: null,
    last_used_at: null,
    rotated_from_token_id: null,
    replaced_by_token_id: null,
    created_by_user_id: createdByUserId ? String(createdByUserId).trim() : null,
    created_at: timestamp,
    updated_at: timestamp,
    token: generated.token
  };
  await db.exec(
    `INSERT INTO api_tokens (
      id, owner_kind, owner_id, label, token_public_id, token_secret_hash, permission_constraints_json,
      expires_at, revoked_at, last_used_at, rotated_from_token_id, replaced_by_token_id,
      created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.owner_kind,
      row.owner_id,
      row.label,
      row.token_public_id,
      row.token_secret_hash,
      row.permission_constraints_json,
      row.expires_at,
      row.revoked_at,
      row.last_used_at,
      row.rotated_from_token_id,
      row.replaced_by_token_id,
      row.created_by_user_id,
      row.created_at,
      row.updated_at
    ]
  );
  await insertServiceAccountActivity(db, {
    orgId: serviceAccount.org_id,
    serviceAccountId: serviceAccount.id,
    tokenId: row.id,
    actorUserId: createdByUserId,
    eventType: 'token.created',
    metadata: {
      label: row.label,
      token_public_id: row.token_public_id,
      permission_constraints: normalizedConstraints,
      expires_at: row.expires_at
    }
  });
  return {
    service_account: await hydrateServiceAccount(db, serviceAccount),
    token: sanitizeApiToken(row, { includeToken: true })
  };
}

export async function updateApiToken(db, tokenId, patch = {}, { actorUserId = null } = {}) {
  const existing = await getTokenById(db, tokenId);
  if (!existing) return null;
  const nextConstraints = patch.permission_constraints !== undefined
    ? normalizePermissionConstraintKeys(patch.permission_constraints)
    : getTokenPermissionConstraints(existing);
  const next = {
    ...existing,
    label: patch.label !== undefined
      ? (normalizeText(patch.label, 'label', { maxLength: 256 }) ?? null)
      : (existing.label ?? null),
    permission_constraints_json: nextConstraints === null ? null : JSON.stringify(nextConstraints),
    expires_at: patch.expires_at !== undefined
      ? normalizeDateTime(patch.expires_at, 'expires_at')
      : (existing.expires_at ?? null),
    revoked_at: patch.revoked !== undefined
      ? (normalizeBoolean(patch.revoked, Boolean(existing.revoked_at)) ? (existing.revoked_at ?? nowIso()) : null)
      : (existing.revoked_at ?? null),
    updated_at: nowIso()
  };
  await db.exec(
    `UPDATE api_tokens
        SET label = ?, permission_constraints_json = ?, expires_at = ?, revoked_at = ?, updated_at = ?
      WHERE id = ?`,
    [
      next.label,
      next.permission_constraints_json,
      next.expires_at,
      next.revoked_at,
      next.updated_at,
      existing.id
    ]
  );
  const serviceAccount = existing.owner_kind === 'service_account'
    ? await getServiceAccountById(db, existing.owner_id)
    : null;
  if (serviceAccount) {
    await insertServiceAccountActivity(db, {
      orgId: serviceAccount.org_id,
      serviceAccountId: serviceAccount.id,
      tokenId: existing.id,
      actorUserId,
      eventType: next.revoked_at && !existing.revoked_at ? 'token.revoked' : 'token.updated',
      metadata: {
        label: next.label,
        token_public_id: existing.token_public_id,
        permission_constraints: nextConstraints,
        expires_at: next.expires_at,
        revoked_at: next.revoked_at
      }
    });
  }
  return sanitizeApiToken(next);
}

export async function rotateApiToken(
  db,
  tokenId,
  { label, permission_constraints: permissionConstraints, expires_at: expiresAt } = {},
  { createdByUserId = null } = {}
) {
  const existing = await getTokenById(db, tokenId);
  if (!existing) return null;
  if (existing.revoked_at) {
    throw new Error('Token already revoked');
  }
  const generated = createOpaqueApiToken();
  const nextConstraints = permissionConstraints !== undefined
    ? normalizePermissionConstraintKeys(permissionConstraints)
    : getTokenPermissionConstraints(existing);
  const timestamp = nowIso();
  const replacement = {
    id: randomUUID(),
    owner_kind: existing.owner_kind,
    owner_id: existing.owner_id,
    label: label !== undefined
      ? (normalizeText(label, 'label', { maxLength: 256 }) ?? null)
      : (existing.label ?? null),
    token_public_id: generated.token_public_id,
    token_secret_hash: generated.token_secret_hash,
    permission_constraints_json: nextConstraints === null ? null : JSON.stringify(nextConstraints),
    expires_at: expiresAt !== undefined
      ? normalizeDateTime(expiresAt, 'expires_at')
      : (existing.expires_at ?? null),
    revoked_at: null,
    last_used_at: null,
    rotated_from_token_id: existing.id,
    replaced_by_token_id: null,
    created_by_user_id: createdByUserId ? String(createdByUserId).trim() : (existing.created_by_user_id ?? null),
    created_at: timestamp,
    updated_at: timestamp,
    token: generated.token
  };
  await db.transaction(async (tx) => {
    await tx.exec(
      `INSERT INTO api_tokens (
        id, owner_kind, owner_id, label, token_public_id, token_secret_hash, permission_constraints_json,
        expires_at, revoked_at, last_used_at, rotated_from_token_id, replaced_by_token_id,
        created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        replacement.id,
        replacement.owner_kind,
        replacement.owner_id,
        replacement.label,
        replacement.token_public_id,
        replacement.token_secret_hash,
        replacement.permission_constraints_json,
        replacement.expires_at,
        replacement.revoked_at,
        replacement.last_used_at,
        replacement.rotated_from_token_id,
        replacement.replaced_by_token_id,
        replacement.created_by_user_id,
        replacement.created_at,
        replacement.updated_at
      ]
    );
    await tx.exec(
      'UPDATE api_tokens SET revoked_at = ?, replaced_by_token_id = ?, updated_at = ? WHERE id = ?',
      [timestamp, replacement.id, timestamp, existing.id]
    );
    if (existing.owner_kind === 'service_account') {
      const serviceAccount = await getServiceAccountById(tx, existing.owner_id);
      if (serviceAccount) {
        await insertServiceAccountActivity(tx, {
          orgId: serviceAccount.org_id,
          serviceAccountId: serviceAccount.id,
          tokenId: replacement.id,
          actorUserId: createdByUserId,
          eventType: 'token.rotated',
          metadata: {
            previous_token_id: existing.id,
            previous_token_public_id: existing.token_public_id,
            token_public_id: replacement.token_public_id,
            label: replacement.label
          }
        });
      }
    }
  });
  return {
    previous_token: sanitizeApiToken({ ...existing, revoked_at: timestamp, replaced_by_token_id: replacement.id, updated_at: timestamp }),
    token: sanitizeApiToken(replacement, { includeToken: true })
  };
}

export async function revokeApiToken(db, tokenId, { actorUserId = null } = {}) {
  const existing = await getTokenById(db, tokenId);
  if (!existing || existing.revoked_at) return false;
  const timestamp = nowIso();
  await db.exec(
    'UPDATE api_tokens SET revoked_at = ?, updated_at = ? WHERE id = ?',
    [timestamp, timestamp, existing.id]
  );
  if (existing.owner_kind === 'service_account') {
    const serviceAccount = await getServiceAccountById(db, existing.owner_id);
    if (serviceAccount) {
      await insertServiceAccountActivity(db, {
        orgId: serviceAccount.org_id,
        serviceAccountId: serviceAccount.id,
        tokenId: existing.id,
        actorUserId,
        eventType: 'token.revoked',
        metadata: {
          label: existing.label ?? null,
          token_public_id: existing.token_public_id,
          revoked_at: timestamp
        }
      });
    }
  }
  return true;
}

export async function listServiceAccountWorkspaceGrants(db, serviceAccountId) {
  const serviceAccount = await getServiceAccountById(db, serviceAccountId);
  if (!serviceAccount) return [];
  const rows = await db.query(
    `SELECT g.*, w.name AS workspace_name, w.org_id
       FROM service_account_workspace_grants g
       JOIN workspaces w ON w.id = g.workspace_id
      WHERE g.service_account_id = ?
      ORDER BY w.created_at ASC`,
    [serviceAccount.id]
  );
  return rows.map(sanitizeWorkspaceGrant);
}

export async function listServiceAccountWorkspaces(db, serviceAccountId) {
  const serviceAccount = await getServiceAccountById(db, serviceAccountId);
  if (!serviceAccount || Number(serviceAccount.archived)) return [];
  return db.query(
    `SELECT w.*
       FROM service_account_workspace_grants g
       JOIN workspaces w ON w.id = g.workspace_id
      WHERE g.service_account_id = ? AND w.archived = 0
      ORDER BY w.created_at ASC`,
    [serviceAccount.id]
  );
}

export async function createServiceAccountWorkspaceGrant(
  db,
  serviceAccountId,
  { workspace_id: workspaceId } = {},
  { actorUserId = null } = {}
) {
  const serviceAccount = await getServiceAccountById(db, serviceAccountId);
  if (!serviceAccount || Number(serviceAccount.archived)) {
    throw new Error('Service account not found');
  }
  const workspace = await db.queryOne(
    'SELECT id, org_id, name FROM workspaces WHERE id = ? LIMIT 1',
    [normalizeText(workspaceId, 'workspace_id', { required: true, maxLength: 64 })]
  );
  if (!workspace) {
    throw new Error('Workspace not found');
  }
  if (workspace.org_id !== serviceAccount.org_id) {
    throw new Error('Workspace must belong to the same organization');
  }
  const existing = await db.queryOne(
    `SELECT g.*, w.name AS workspace_name, w.org_id
       FROM service_account_workspace_grants g
       JOIN workspaces w ON w.id = g.workspace_id
      WHERE g.service_account_id = ? AND g.workspace_id = ?
      LIMIT 1`,
    [serviceAccount.id, workspace.id]
  );
  if (existing) {
    return sanitizeWorkspaceGrant(existing);
  }
  const timestamp = nowIso();
  const grant = {
    id: randomUUID(),
    service_account_id: serviceAccount.id,
    workspace_id: workspace.id,
    workspace_name: workspace.name,
    org_id: workspace.org_id,
    created_at: timestamp,
    updated_at: timestamp
  };
  await db.exec(
    `INSERT INTO service_account_workspace_grants (
      id, service_account_id, workspace_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)`,
    [
      grant.id,
      grant.service_account_id,
      grant.workspace_id,
      grant.created_at,
      grant.updated_at
    ]
  );
  await insertServiceAccountActivity(db, {
    orgId: serviceAccount.org_id,
    serviceAccountId: serviceAccount.id,
    workspaceId: workspace.id,
    actorUserId,
    eventType: 'workspace_grant.created',
    metadata: {
      workspace_name: workspace.name
    }
  });
  return sanitizeWorkspaceGrant(grant);
}

export async function revokeServiceAccountWorkspaceGrant(db, grantId, { actorUserId = null } = {}) {
  const existing = await db.queryOne(
    `SELECT g.id, g.service_account_id, g.workspace_id, s.org_id, w.name AS workspace_name
       FROM service_account_workspace_grants g
       JOIN service_accounts s ON s.id = g.service_account_id
       LEFT JOIN workspaces w ON w.id = g.workspace_id
      WHERE g.id = ?
      LIMIT 1`,
    [String(grantId ?? '').trim()]
  );
  if (!existing) return false;
  await db.exec('DELETE FROM service_account_workspace_grants WHERE id = ?', [existing.id]);
  await insertServiceAccountActivity(db, {
    orgId: existing.org_id,
    serviceAccountId: existing.service_account_id,
    workspaceId: existing.workspace_id,
    actorUserId,
    eventType: 'workspace_grant.revoked',
    metadata: {
      workspace_name: existing.workspace_name ?? null
    }
  });
  return true;
}

export async function serviceAccountHasWorkspaceAccess(db, serviceAccountId, workspaceId) {
  const serviceAccount = await getServiceAccountById(db, serviceAccountId);
  if (!serviceAccount || Number(serviceAccount.archived)) return false;
  const safeWorkspaceId = String(workspaceId ?? '').trim();
  if (!safeWorkspaceId) return false;
  const grant = await db.queryOne(
    `SELECT g.id
       FROM service_account_workspace_grants g
       JOIN workspaces w ON w.id = g.workspace_id
      WHERE g.service_account_id = ? AND g.workspace_id = ? AND w.archived = 0
      LIMIT 1`,
    [serviceAccount.id, safeWorkspaceId]
  );
  return Boolean(grant);
}

export async function resolveServiceAccountToken(db, bearerToken) {
  const parsed = parseOpaqueApiToken(bearerToken);
  if (!parsed) return null;
  const tokenRow = await db.queryOne(
    `SELECT t.*, s.org_id AS service_org_id, s.display_name, s.description, s.permissions_json,
            s.archived AS service_account_archived, s.created_at AS service_created_at, s.updated_at AS service_updated_at
       FROM api_tokens t
       JOIN service_accounts s ON s.id = t.owner_id
      WHERE t.owner_kind = 'service_account' AND t.token_public_id = ?
      LIMIT 1`,
    [parsed.token_public_id]
  );
  if (!tokenRow) return null;
  if (!constantTimeHexEqual(hashSecret(parsed.secret), tokenRow.token_secret_hash)) return null;
  if (tokenRow.revoked_at) return null;
  if (Number(tokenRow.service_account_archived)) return null;
  if (tokenRow.expires_at) {
    const expiresAtMs = Date.parse(tokenRow.expires_at);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;
  }
  const timestamp = nowIso();
  await db.exec('UPDATE api_tokens SET last_used_at = ?, updated_at = ? WHERE id = ?', [timestamp, timestamp, tokenRow.id]);
  const aliases = await getAliasesForServiceAccount(db, tokenRow.owner_id);
  const serviceAccount = sanitizeServiceAccount({
    id: tokenRow.owner_id,
    org_id: tokenRow.service_org_id,
    display_name: tokenRow.display_name,
    description: tokenRow.description,
    permissions_json: tokenRow.permissions_json,
    archived: tokenRow.service_account_archived,
    created_at: tokenRow.service_created_at,
    updated_at: tokenRow.service_updated_at
  }, aliases);
  const workspaces = await listServiceAccountWorkspaces(db, tokenRow.owner_id);
  const permissions = computeEffectivePermissions(
    {
      permissions_json: tokenRow.permissions_json
    },
    tokenRow
  );
  return {
    service_account: serviceAccount,
    token: sanitizeApiToken({
      ...tokenRow,
      updated_at: timestamp,
      last_used_at: timestamp
    }),
    workspaces,
    granted_permissions: permissions.grantedPermissions,
    token_constraints: permissions.tokenConstraints,
    effective_permissions: permissions.effectivePermissions
  };
}

export async function listServiceAccountActivity(db, serviceAccountId, { limit = 50 } = {}) {
  const serviceAccount = await getServiceAccountById(db, serviceAccountId);
  if (!serviceAccount) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await db.query(
    `SELECT e.*,
            t.label AS token_label,
            t.token_public_id,
            w.name AS workspace_name,
            u.email AS actor_email,
            u.display_name AS actor_display_name
       FROM service_account_activity_events e
       LEFT JOIN api_tokens t ON t.id = e.token_id
       LEFT JOIN workspaces w ON w.id = e.workspace_id
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.service_account_id = ?
      ORDER BY e.created_at DESC
      LIMIT ?`,
    [serviceAccount.id, safeLimit]
  );
  return rows.map(sanitizeServiceAccountActivityEvent);
}

export async function recordServiceAccountActivity(db, params = {}) {
  return insertServiceAccountActivity(db, params);
}
