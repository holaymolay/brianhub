import initSqlJs from 'sql.js';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

let SQL;
const require = createRequire(import.meta.url);

async function loadSqlJs() {
  if (SQL) return SQL;
  const wasmPath = dirname(require.resolve('sql.js/dist/sql-wasm.wasm'));
  SQL = await initSqlJs({ locateFile: file => resolve(wasmPath, file) });
  return SQL;
}

function bindParams(stmt, params) {
  if (!params || params.length === 0) return;
  stmt.bind(params);
}

function writeFileAtomic(filePath, data) {
  const dirPath = dirname(filePath);
  mkdirSync(dirPath, { recursive: true });

  const suffix = `${process.pid}-${Date.now()}-${randomUUID()}`;
  const tmpPath = `${filePath}.tmp-${suffix}`;
  const fd = openSync(tmpPath, 'w', 0o600);
  try {
    let written = 0;
    while (written < data.length) {
      written += writeSync(fd, data, written, data.length - written);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  renameSync(tmpPath, filePath);

  // Best-effort directory fsync for durability on abrupt power loss.
  try {
    const dirFd = openSync(dirPath, 'r');
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Ignore when unsupported by platform/filesystem.
  }
}

export async function createSqliteClient(options = {}) {
  const { filename, inMemory = false } = options;
  const sql = await loadSqlJs();
  const data = !inMemory && filename && existsSync(filename) ? readFileSync(filename) : null;
  const db = data ? new sql.Database(data) : new sql.Database();
  db.exec('PRAGMA foreign_keys = ON;');

  let inTransaction = false;

  const persist = () => {
    if (inMemory || !filename) return;
    const exported = db.export();
    writeFileAtomic(filename, Buffer.from(exported));
  };

  const client = {
    async query(sqlText, params = []) {
      const stmt = db.prepare(sqlText);
      bindParams(stmt, params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    },
    async queryOne(sqlText, params = []) {
      const rows = await client.query(sqlText, params);
      return rows[0] ?? null;
    },
    async exec(sqlText, params = []) {
      if (!params || params.length === 0) {
        db.exec(sqlText);
      } else {
        const stmt = db.prepare(sqlText);
        bindParams(stmt, params);
        stmt.step();
        stmt.free();
      }
      if (!inTransaction) persist();
    },
    async transaction(fn) {
      if (inTransaction) {
        return fn(client);
      }
      inTransaction = true;
      db.exec('BEGIN');
      try {
        const result = await fn(client);
        db.exec('COMMIT');
        inTransaction = false;
        persist();
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        inTransaction = false;
        throw err;
      }
    },
    async close() {
      db.close();
    }
  };

  return client;
}
