import initSqlJs from 'sql.js';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DB_PATH = process.env.BRIANHUB_DB ?? 'services/api/db/brianhub.sqlite';
const MIGRATIONS_DIR = process.env.BRIANHUB_MIGRATIONS ?? 'services/api/db/migrations';

let SQL;

async function loadSqlJs() {
  if (SQL) return SQL;
  const wasmPath = resolve(process.cwd(), 'node_modules/sql.js/dist');
  SQL = await initSqlJs({
    locateFile: file => resolve(wasmPath, file)
  });
  return SQL;
}

function wrapDb(db) {
  let inTransaction = false;

  const wrapper = {
    exec(sql) {
      db.exec(sql);
      if (!inTransaction) wrapper.persist();
    },
    pragma(sql) {
      db.exec(`PRAGMA ${sql}`);
      if (!inTransaction) wrapper.persist();
    },
    prepare(sql) {
      return {
        run(...args) {
          const stmt = db.prepare(sql);
          bindParams(stmt, args);
          stmt.step();
          stmt.free();
          if (!inTransaction) wrapper.persist();
        },
        get(...args) {
          const stmt = db.prepare(sql);
          bindParams(stmt, args);
          const row = stmt.step() ? stmt.getAsObject() : undefined;
          stmt.free();
          return row;
        },
        all(...args) {
          const stmt = db.prepare(sql);
          bindParams(stmt, args);
          const rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
          return rows;
        }
      };
    },
    transaction(fn) {
      return (...args) => {
        inTransaction = true;
        db.exec('BEGIN');
        try {
          const result = fn(...args);
          db.exec('COMMIT');
          inTransaction = false;
          wrapper.persist();
          return result;
        } catch (err) {
          db.exec('ROLLBACK');
          inTransaction = false;
          throw err;
        }
      };
    },
    persist() {
      const data = db.export();
      writeFileSync(DB_PATH, Buffer.from(data));
    },
    close() {
      db.close();
    }
  };

  return wrapper;
}

function bindParams(stmt, args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    stmt.bind(args[0]);
    return;
  }
  if (args.length === 1 && Array.isArray(args[0])) {
    stmt.bind(args[0]);
    return;
  }
  stmt.bind(args);
}

export async function openDb() {
  const sql = await loadSqlJs();
  const data = existsSync(DB_PATH) ? readFileSync(DB_PATH) : null;
  const db = data ? new sql.Database(data) : new sql.Database();
  db.exec('PRAGMA foreign_keys = ON;');
  return wrapDb(db);
}

export function migrate(db) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.sql'))
    .sort();

  db.exec('CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    db.prepare('SELECT id FROM migrations').all().map(row => row.id)
  );

  const now = new Date().toISOString();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)').run(file, now);
    });
    tx();
  }
}
