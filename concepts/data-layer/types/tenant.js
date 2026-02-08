/**
 * @typedef {Object} TenantCtx
 * @property {string} orgId
 * @property {string} [workspaceId]
 * @property {string} [userId]
 */

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value, fieldName = 'id') {
  const normalized = String(value ?? '');
  if (!UUID_V4_RE.test(normalized)) {
    throw new Error(`${fieldName} must be a UUID`);
  }
  return normalized;
}

export function assertTenantCtx(ctx) {
  if (!ctx || typeof ctx.orgId !== 'string' || !ctx.orgId.trim()) {
    throw new Error('TenantCtx.orgId required');
  }
  assertUuid(ctx.orgId, 'TenantCtx.orgId');
  if (ctx.workspaceId !== undefined && ctx.workspaceId !== null && ctx.workspaceId !== '') {
    assertUuid(ctx.workspaceId, 'TenantCtx.workspaceId');
  }
  if (ctx.userId !== undefined && ctx.userId !== null && ctx.userId !== '') {
    assertUuid(ctx.userId, 'TenantCtx.userId');
  }
}

export function buildTenantWhere(ctx) {
  assertTenantCtx(ctx);
  const clauses = ['org_id = ?'];
  const params = [ctx.orgId];
  if (ctx.workspaceId) {
    clauses.push('workspace_id = ?');
    params.push(ctx.workspaceId);
  }
  return { clause: clauses.join(' AND '), params };
}
