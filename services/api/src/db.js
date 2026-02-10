import { createSqliteClient } from '../../../concepts/data-layer/db/sqlite-client.js';
import { applyMigrations } from '../../../concepts/data-layer/migrations/runner.js';
import { getApiConfig } from './config.js';

export async function openDb(options = {}) {
  const config = getApiConfig();
  const { filename = config.dbPath, inMemory = false } = options;
  return createSqliteClient({ filename, inMemory });
}

export async function migrate(db, migrationsDir = null) {
  const config = getApiConfig();
  const targetDir = migrationsDir ?? config.migrationsDir;
  await applyMigrations(db, targetDir);
}

export function getDbConfig() {
  const config = getApiConfig();
  return {
    DB_PATH: config.dbPath,
    MIGRATIONS_DIR: config.migrationsDir
  };
}

// Backward compatibility for existing imports.
export const dbConfig = getDbConfig();
