import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createSqliteClient } from '../concepts/data-layer/db/sqlite-client.js';
import { decryptBuffer, resolveEncryptionKey } from './lib/backup-crypto.js';
import { listBackupSnapshots } from './lib/backup-files.js';

function parseCliArgs(argv) {
  const output = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') {
      output.filePath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--backup-dir') {
      output.backupDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--prefix') {
      output.prefix = argv[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return output;
}

function getConfig(overrides = {}) {
  return {
    backupDir: resolve(overrides.backupDir ?? process.env.BRIANHUB_BACKUP_DIR ?? 'data/backups'),
    prefix: String(overrides.prefix ?? process.env.BRIANHUB_BACKUP_PREFIX ?? 'brianhub').trim() || 'brianhub',
    filePath: overrides.filePath ? resolve(overrides.filePath) : null,
    encryptionKey: resolveEncryptionKey(process.env.BRIANHUB_BACKUP_ENCRYPTION_KEY ?? null)
  };
}

function pickBackupFile(config) {
  if (config.filePath) {
    if (!existsSync(config.filePath)) throw new Error(`Backup file not found: ${config.filePath}`);
    return {
      path: config.filePath,
      name: basename(config.filePath)
    };
  }
  const snapshots = listBackupSnapshots(config.backupDir, { prefix: config.prefix });
  if (!snapshots.length) {
    throw new Error(`No backup snapshots found in ${config.backupDir}.`);
  }
  return {
    path: snapshots[0].path,
    name: snapshots[0].name
  };
}

function decodeBackupToSqliteBuffer(filePath, encryptionKey) {
  const raw = readFileSync(filePath);
  const encrypted = filePath.endsWith('.enc');
  const compressed = filePath.endsWith('.gz') || filePath.endsWith('.gz.enc');

  const decrypted = encrypted
    ? (() => {
      if (!encryptionKey) {
        throw new Error('Backup is encrypted. Set BRIANHUB_BACKUP_ENCRYPTION_KEY before restore check.');
      }
      return decryptBuffer(raw, encryptionKey);
    })()
    : raw;

  return compressed ? gunzipSync(decrypted) : decrypted;
}

async function verifySqliteIntegrity(sqliteBuffer) {
  const tempDir = mkdtempSync(join(tmpdir(), 'brianhub-restore-check-'));
  const tempPath = join(tempDir, 'restore-check.sqlite');
  writeFileSync(tempPath, sqliteBuffer);

  const db = await createSqliteClient({ filename: tempPath });
  try {
    const quickCheck = await db.queryOne('PRAGMA quick_check;');
    const quickCheckValue = quickCheck ? Object.values(quickCheck)[0] : null;
    if (String(quickCheckValue ?? '').toLowerCase() !== 'ok') {
      throw new Error(`SQLite quick_check failed: ${quickCheckValue ?? 'unknown'}`);
    }
    const version = await db.queryOne('PRAGMA user_version;');
    return {
      quickCheck: quickCheckValue,
      userVersion: version ? Object.values(version)[0] : null
    };
  } finally {
    await db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const config = getConfig(cli);
  const selected = pickBackupFile(config);
  const sqliteBuffer = decodeBackupToSqliteBuffer(selected.path, config.encryptionKey);
  const integrity = await verifySqliteIntegrity(sqliteBuffer);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ok: true,
    file: selected.path,
    bytes: sqliteBuffer.length,
    integrity
  }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.message ?? err);
  process.exitCode = 1;
});

