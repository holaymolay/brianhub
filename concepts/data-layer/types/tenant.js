/**
 * @typedef {Object} TenantCtx
 * @property {string} orgId
 * @property {string} [workspaceId]
 * @property {string} [userId]
 */

export function assertTenantCtx(ctx) {
  if (!ctx || typeof ctx.orgId !== 'string' || !ctx.orgId.trim()) {
    throw new Error('TenantCtx.orgId required');
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
