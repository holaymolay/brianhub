import { createSqliteClient } from '../concepts/data-layer/db/sqlite-client.js';
import { applyMigrations } from '../concepts/data-layer/migrations/runner.js';

const dbPath = process.env.BRIANHUB_DATA_DB ?? 'data/brianhub.sqlite';
const migrationsDir = process.env.BRIANHUB_DATA_MIGRATIONS ?? 'concepts/data-layer/migrations';

const client = await createSqliteClient({ filename: dbPath });
try {
  await applyMigrations(client, migrationsDir);
  // eslint-disable-next-line no-console
  console.log('Data-layer migrations applied.');
} finally {
  await client.close();
}
