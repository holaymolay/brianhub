import { randomUUID } from 'node:crypto';
import { assertTenantCtx, buildTenantWhere } from '../types/tenant.js';

function nowIso() {
  return new Date().toISOString();
}

export class TaskRepository {
  constructor(db) {
    this.db = db;
  }

  async create(input, ctx) {
    assertTenantCtx(ctx);
    if (!ctx.workspaceId) {
      throw new Error('TenantCtx.workspaceId required for tasks');
    }
    const id = input.id ?? randomUUID();
    const timestamp = nowIso();
    const task = {
      id,
      org_id: ctx.orgId,
      workspace_id: ctx.workspaceId,
      parent_id: input.parent_id ?? null,
      title: input.title,
      status: input.status ?? 'inbox',
      description_md: input.description_md ?? '',
      priority: input.priority ?? 'medium',
      created_at: timestamp,
      updated_at: timestamp
    };

    await this.db.exec(
      `INSERT INTO tasks (
        id, org_id, workspace_id, parent_id, title, status, description_md, priority, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.org_id,
        task.workspace_id,
        task.parent_id,
        task.title,
        task.status,
        task.description_md,
        task.priority,
        task.created_at,
        task.updated_at
      ]
    );

    return task;
  }

  async list(filter, ctx) {
    assertTenantCtx(ctx);
    const tenant = buildTenantWhere(ctx);
    const clauses = [tenant.clause];
    const params = [...tenant.params];
    if (filter?.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    const sql = `SELECT * FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`;
    return this.db.query(sql, params);
  }
}
