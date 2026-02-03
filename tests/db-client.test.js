import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteClient } from '../concepts/data-layer/db/sqlite-client.js';

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
