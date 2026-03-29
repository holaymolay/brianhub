import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSqliteClient } from '../concepts/data-layer/db/sqlite-client.js';
import { applyMigrations } from '../concepts/data-layer/migrations/runner.js';
import { listUserWorkspaces } from '../services/api/src/authService.js';

const SOURCE_MIGRATIONS_DIR = new URL('../services/api/db/migrations/', import.meta.url);
const DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_USER_ID = '11111111-1111-4111-8111-111111111111';
const PERSONAL_USER_ID = '22222222-2222-4222-8222-222222222222';
const PERSONAL_WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';

function copyMigrations(targetDir, maxPrefix) {
  const maxValue = Number(maxPrefix);
  const files = readdirSync(SOURCE_MIGRATIONS_DIR)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .filter((name) => Number(name.slice(0, 3)) <= maxValue)
    .sort();
  for (const file of files) {
    copyFileSync(new URL(file, SOURCE_MIGRATIONS_DIR), join(targetDir, file));
  }
}

async function seedLegacyPersonalWorkspace(db, { includeChangeLog = false } = {}) {
  await db.exec(
    'INSERT INTO app_owner_settings (singleton_id, owner_email, created_at, updated_at) VALUES (1, ?, ?, ?)',
    ['brian@pipecaminc.com', '2026-03-20T10:00:00.000Z', '2026-03-20T10:00:00.000Z']
  );
  await db.exec(
    'INSERT INTO users (id, org_id, display_name, email, org_role, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    [OWNER_USER_ID, DEFAULT_ORG_ID, 'Brian @ PipeCam', 'brian@pipecaminc.com', 'admin', '2026-03-20T10:00:00.000Z', '2026-03-20T10:00:00.000Z']
  );
  await db.exec(
    'INSERT INTO users (id, org_id, display_name, email, org_role, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    [PERSONAL_USER_ID, DEFAULT_ORG_ID, 'Brian Jason', 'brianjason@gmail.com', 'member', '2026-03-20T10:05:00.000Z', '2026-03-20T10:05:00.000Z']
  );
  await db.exec(
    'UPDATE orgs SET owner_user_id = ?, updated_at = ? WHERE id = ?',
    [OWNER_USER_ID, '2026-03-20T10:00:00.000Z', DEFAULT_ORG_ID]
  );
  await db.exec(
    'INSERT INTO workspaces (id, name, type, created_at, updated_at, archived, org_id) VALUES (?, ?, ?, ?, ?, 0, ?)',
    [PERSONAL_WORKSPACE_ID, 'Personal', 'personal', '2026-03-20T10:06:00.000Z', '2026-03-20T10:06:00.000Z', DEFAULT_ORG_ID]
  );
  await db.exec(
    'INSERT INTO workspace_memberships (id, workspace_id, user_id, role, archived, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    ['44444444-4444-4444-8444-444444444444', PERSONAL_WORKSPACE_ID, OWNER_USER_ID, 'member', '2026-03-20T10:07:00.000Z', '2026-03-20T10:07:00.000Z']
  );
  await db.exec(
    'INSERT INTO workspace_memberships (id, workspace_id, user_id, role, archived, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    ['55555555-5555-4555-8555-555555555555', PERSONAL_WORKSPACE_ID, PERSONAL_USER_ID, 'member', '2026-03-20T10:08:00.000Z', '2026-03-20T10:08:00.000Z']
  );
  if (includeChangeLog) {
    await db.exec(
      'INSERT INTO change_log (workspace_id, entity_type, entity_id, action, payload, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        PERSONAL_WORKSPACE_ID,
        'user',
        PERSONAL_USER_ID,
        'create',
        JSON.stringify({ id: PERSONAL_USER_ID, email: 'brianjason@gmail.com' }),
        null,
        '2026-03-20T10:05:00.000Z'
      ]
    );
  }
}

async function withLegacyMigrations(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'bh-workspace-owner-migration-'));
  const db = await createSqliteClient({ inMemory: true });
  try {
    copyMigrations(dir, 32);
    await applyMigrations(db, dir);
    await fn({ db, dir });
  } finally {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('workspace ownership repair prefers the sole non-owner member over org-owner backfill for personal workspaces', async () => {
  await withLegacyMigrations(async ({ db, dir }) => {
    await seedLegacyPersonalWorkspace(db, { includeChangeLog: false });

    copyMigrations(dir, 34);
    await applyMigrations(db, dir);

    const workspace = await db.queryOne('SELECT owner_user_id FROM workspaces WHERE id = ? LIMIT 1', [PERSONAL_WORKSPACE_ID]);
    assert.equal(workspace.owner_user_id, PERSONAL_USER_ID);

    const ownerVisible = await listUserWorkspaces(db, OWNER_USER_ID);
    assert.deepEqual(ownerVisible.map((row) => row.id), []);

    const personalVisible = await listUserWorkspaces(db, PERSONAL_USER_ID);
    assert.deepEqual(personalVisible.map((row) => row.id), [PERSONAL_WORKSPACE_ID]);
  });
});

test('workspace ownership repair prefers explicit workspace change-log ownership signals', async () => {
  await withLegacyMigrations(async ({ db, dir }) => {
    await seedLegacyPersonalWorkspace(db, { includeChangeLog: true });

    copyMigrations(dir, 34);
    await applyMigrations(db, dir);

    const workspace = await db.queryOne('SELECT owner_user_id FROM workspaces WHERE id = ? LIMIT 1', [PERSONAL_WORKSPACE_ID]);
    assert.equal(workspace.owner_user_id, PERSONAL_USER_ID);
  });
});
