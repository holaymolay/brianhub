import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { createSqliteClient } from '../concepts/data-layer/db/sqlite-client.js';

const execFileAsync = promisify(execFile);

async function withClient(fn) {
  const client = await createSqliteClient({ inMemory: true });
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

test('DbClient.transaction commits on success', async () => {
  await withClient(async (db) => {
    await db.exec('CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    await db.transaction(async (tx) => {
      await tx.exec('INSERT INTO items (id, name) VALUES (?, ?)', ['1', 'alpha']);
    });
    const rows = await db.query('SELECT * FROM items');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'alpha');
  });
});

test('DbClient.transaction rolls back on error', async () => {
  await withClient(async (db) => {
    await db.exec('CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    await assert.rejects(
      () => db.transaction(async (tx) => {
        await tx.exec('INSERT INTO items (id, name) VALUES (?, ?)', ['1', 'alpha']);
        throw new Error('boom');
      }),
      /boom/
    );
    const rows = await db.query('SELECT * FROM items');
    assert.equal(rows.length, 0);
  });
});

test('file-backed sqlite client persists via atomic file replace', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'brianhub-db-client-'));
  const dbPath = join(tempDir, 'brianhub.sqlite');

  try {
    const db = await createSqliteClient({ filename: dbPath });
    await db.exec('CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    await db.exec('INSERT INTO items (id, name) VALUES (?, ?)', ['1', 'atomic']);
    await db.close();

    const files = readdirSync(tempDir);
    const leftovers = files.filter(name => name.includes('.tmp-'));
    assert.equal(leftovers.length, 0, 'temp files should not remain after atomic persist');

    const reopened = await createSqliteClient({ filename: dbPath });
    const row = await reopened.queryOne('SELECT name FROM items WHERE id = ?', ['1']);
    await reopened.close();
    assert.equal(row?.name, 'atomic');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('sqlite client resolves sql.js wasm independent of current working directory', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'brianhub-db-cwd-'));
  const script = `
    import { createSqliteClient } from '${new URL('../concepts/data-layer/db/sqlite-client.js', import.meta.url).href}';
    process.chdir(${JSON.stringify(tempDir)});
    const db = await createSqliteClient({ inMemory: true });
    await db.exec('CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    await db.exec('INSERT INTO items (id, name) VALUES (?, ?)', ['1', 'cwd-safe']);
    const row = await db.queryOne('SELECT name FROM items WHERE id = ?', ['1']);
    await db.close();
    if (row?.name !== 'cwd-safe') {
      throw new Error('unexpected query result');
    }
    console.log('ok');
  `;

  try {
    const { stdout } = await execFileAsync('node', ['--input-type=module', '-e', script], {
      cwd: '/'
    });
    assert.match(stdout, /ok/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
