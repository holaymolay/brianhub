import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

export async function applyMigrations(db, migrationsDir) {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
  );
  const appliedRows = await db.query('SELECT id FROM migrations');
  const applied = new Set(appliedRows.map(row => row.id));
  const files = readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.exec(
        'INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)',
        [file, file, nowIso()]
      );
    });
  }
}
