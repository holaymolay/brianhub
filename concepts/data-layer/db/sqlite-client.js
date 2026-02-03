import initSqlJs from 'sql.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let SQL;

async function loadSqlJs() {
  if (SQL) return SQL;
  const wasmPath = resolve(process.cwd(), 'node_modules/sql.js/dist');
  SQL = await initSqlJs({ locateFile: file => resolve(wasmPath, file) });
  return SQL;
}

function bindParams(stmt, params) {
  if (!params || params.length === 0) return;
  stmt.bind(params);
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
    mkdirSync(dirname(filename), { recursive: true });
    const exported = db.export();
    writeFileSync(filename, Buffer.from(exported));
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
