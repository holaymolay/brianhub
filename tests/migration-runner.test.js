import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteClient } from '../concepts/data-layer/db/sqlite-client.js';
import { applyMigrations } from '../concepts/data-layer/migrations/runner.js';

function createTempMigrations() {
  const dir = mkdtempSync(join(tmpdir(), 'bh-migrations-'));
  writeFileSync(join(dir, '001_init.sql'), 'CREATE TABLE demo (id TEXT PRIMARY KEY);');
  writeFileSync(join(dir, '002_add.sql'), 'ALTER TABLE demo ADD COLUMN name TEXT;');
  return dir;
}

test('migration runner applies pending migrations in order once', async () => {
  const dir = createTempMigrations();
  const db = await createSqliteClient({ inMemory: true });
  try {
    await applyMigrations(db, dir);
    const rows = await db.query('SELECT id FROM migrations ORDER BY id');
    assert.deepEqual(rows.map(r => r.id), ['001_init.sql', '002_add.sql']);

    await applyMigrations(db, dir);
    const rowsAfter = await db.query('SELECT id FROM migrations ORDER BY id');
    assert.deepEqual(rowsAfter.map(r => r.id), ['001_init.sql', '002_add.sql']);
  } finally {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
