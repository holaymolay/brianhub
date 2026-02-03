import { createSqliteClient } from '../../../concepts/data-layer/db/sqlite-client.js';
import { applyMigrations } from '../../../concepts/data-layer/migrations/runner.js';

const DB_PATH = process.env.BRIANHUB_DB ?? 'data/brianhub.sqlite';
const MIGRATIONS_DIR = process.env.BRIANHUB_MIGRATIONS ?? 'services/api/db/migrations';

export async function openDb(options = {}) {
  const { filename = DB_PATH, inMemory = false } = options;
  return createSqliteClient({ filename, inMemory });
}

export async function migrate(db, migrationsDir = MIGRATIONS_DIR) {
  await applyMigrations(db, migrationsDir);
}

export const dbConfig = { DB_PATH, MIGRATIONS_DIR };
