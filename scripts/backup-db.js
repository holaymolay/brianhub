import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { encryptFile, resolveEncryptionKey } from './lib/backup-crypto.js';
import { applyRetentionToDirectory } from './lib/backup-retention.js';
import { buildBackupBasename } from './lib/backup-files.js';

function parseCliArgs(argv) {
  const output = {
    dryRun: false,
    retentionOnly: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      output.dryRun = true;
      continue;
    }
    if (arg === '--retention-only') {
      output.retentionOnly = true;
      continue;
    }
    if (arg === '--db') {
      output.dbPath = argv[i + 1];
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
    if (arg === '--upload-dir') {
      output.uploadDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--s3-uri') {
      output.s3Uri = argv[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return output;
}

function getConfig(overrides = {}) {
  return {
    dbPath: resolve(overrides.dbPath ?? process.env.BRIANHUB_DB ?? 'data/brianhub.sqlite'),
    backupDir: resolve(overrides.backupDir ?? process.env.BRIANHUB_BACKUP_DIR ?? 'data/backups'),
    prefix: String(overrides.prefix ?? process.env.BRIANHUB_BACKUP_PREFIX ?? 'brianhub').trim() || 'brianhub',
    uploadDir: overrides.uploadDir ?? process.env.BRIANHUB_BACKUP_UPLOAD_DIR ?? null,
    s3Uri: overrides.s3Uri ?? process.env.BRIANHUB_BACKUP_S3_URI ?? null,
    dryRun: Boolean(overrides.dryRun),
    retentionOnly: Boolean(overrides.retentionOnly),
    dailyKeepDays: Number(process.env.BRIANHUB_BACKUP_DAILY_KEEP_DAYS ?? 7),
    weeklyKeepWeeks: Number(process.env.BRIANHUB_BACKUP_WEEKLY_KEEP_WEEKS ?? 52),
    encryptionKey: resolveEncryptionKey(process.env.BRIANHUB_BACKUP_ENCRYPTION_KEY ?? null)
  };
}

async function gzipFile(sourcePath, outputPath) {
  await pipeline(
    createReadStream(sourcePath),
    createGzip({ level: 9 }),
    createWriteStream(outputPath)
  );
}

function checksumSha256(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  return new Promise((resolvePromise, rejectPromise) => {
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', rejectPromise);
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}

async function createBackup(config) {
  if (!existsSync(config.dbPath)) {
    throw new Error(`Database file not found: ${config.dbPath}`);
  }
  mkdirSync(config.backupDir, { recursive: true });

  const startedAt = new Date();
  const baseGzName = buildBackupBasename(config.prefix, startedAt);
  const snapshotPath = join(config.backupDir, baseGzName.replace(/\.gz$/i, ''));
  const gzipPath = join(config.backupDir, baseGzName);
  let finalPath = gzipPath;

  copyFileSync(config.dbPath, snapshotPath);
  try {
    await gzipFile(snapshotPath, gzipPath);
  } finally {
    if (existsSync(snapshotPath)) unlinkSync(snapshotPath);
  }

  if (config.encryptionKey) {
    const encryptedPath = `${gzipPath}.enc`;
    encryptFile(gzipPath, encryptedPath, config.encryptionKey);
    unlinkSync(gzipPath);
    finalPath = encryptedPath;
  }

  const stats = statSync(finalPath);
  return {
    createdAt: startedAt.toISOString(),
    path: finalPath,
    filename: basename(finalPath),
    sizeBytes: stats.size,
    encrypted: Boolean(config.encryptionKey),
    sha256: await checksumSha256(finalPath)
  };
}

function uploadToDirectory(filePath, uploadDir) {
  if (!uploadDir) return null;
  const resolvedDir = resolve(uploadDir);
  mkdirSync(resolvedDir, { recursive: true });
  const destination = join(resolvedDir, basename(filePath));
  copyFileSync(filePath, destination);
  return { kind: 'directory', destination };
}

function uploadToS3(filePath, s3Uri) {
  if (!s3Uri) return null;
  const target = s3Uri.endsWith('/') ? `${s3Uri}${basename(filePath)}` : `${s3Uri}/${basename(filePath)}`;
  const result = spawnSync('aws', ['s3', 'cp', filePath, target], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('S3 upload failed. Ensure AWS CLI is installed and credentials are valid.');
  }
  return { kind: 's3', destination: target };
}

function runRetention(config, directory) {
  return applyRetentionToDirectory(directory, {
    prefix: config.prefix,
    dryRun: config.dryRun,
    dailyKeepDays: config.dailyKeepDays,
    weeklyKeepWeeks: config.weeklyKeepWeeks
  });
}

function summarizeRetention(result) {
  return {
    directory: result.directory,
    total: result.stats.total,
    kept: result.keep.length,
    purged: result.purge.length,
    dailyBuckets: result.stats.keptDailyBuckets,
    weeklyBuckets: result.stats.keptWeeklyBuckets,
    quarterlyBuckets: result.stats.keptQuarterlyBuckets
  };
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const config = getConfig(cli);
  const output = {
    created: null,
    uploads: [],
    retention: []
  };

  if (!config.retentionOnly) {
    const created = await createBackup(config);
    output.created = created;

    const directoryUpload = uploadToDirectory(created.path, config.uploadDir);
    if (directoryUpload) output.uploads.push(directoryUpload);

    const s3Upload = uploadToS3(created.path, config.s3Uri);
    if (s3Upload) output.uploads.push(s3Upload);
  }

  const localRetention = runRetention(config, config.backupDir);
  output.retention.push(summarizeRetention(localRetention));

  if (config.uploadDir) {
    const resolvedUploadDir = resolve(config.uploadDir);
    if (resolvedUploadDir !== config.backupDir) {
      const remoteRetention = runRetention(config, resolvedUploadDir);
      output.retention.push(summarizeRetention(remoteRetention));
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.message ?? err);
  process.exitCode = 1;
});

