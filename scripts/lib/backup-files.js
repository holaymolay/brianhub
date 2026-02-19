import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const BACKUP_FILE_RE = /^([a-z0-9_-]+)-(\d{8}T\d{6}Z)\.sqlite\.gz(\.enc)?$/i;

function parseTimestampToken(token) {
  const match = String(token).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBackupTimestamp(date = new Date()) {
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

export function buildBackupBasename(prefix, date = new Date()) {
  return `${prefix}-${formatBackupTimestamp(date)}.sqlite.gz`;
}

export function parseBackupMetadataFromName(name) {
  const match = String(name).match(BACKUP_FILE_RE);
  if (!match) return null;
  const [, prefix, timestampToken, encryptedSuffix = ''] = match;
  const timestamp = parseTimestampToken(timestampToken);
  if (!timestamp) return null;
  return {
    name,
    prefix,
    timestampToken,
    timestamp,
    encrypted: encryptedSuffix === '.enc'
  };
}

export function listBackupSnapshots(directory, { prefix } = {}) {
  let names = [];
  try {
    names = readdirSync(directory);
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }

  return names
    .map(name => {
      const parsed = parseBackupMetadataFromName(name);
      if (!parsed) return null;
      if (prefix && parsed.prefix !== prefix) return null;
      return {
        ...parsed,
        path: join(directory, name)
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

