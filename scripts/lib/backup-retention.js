import { unlinkSync } from 'node:fs';
import { listBackupSnapshots } from './backup-files.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getIsoWeekKey(date) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / DAY_MS) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getQuarterKey(date) {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${quarter}`;
}

function getAgeDays(now, timestamp) {
  const nowDay = startOfUtcDay(now);
  const snapshotDay = startOfUtcDay(timestamp);
  return Math.floor((nowDay - snapshotDay) / DAY_MS);
}

export function buildRetentionPlan(snapshots, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const dailyKeepDays = Number.isFinite(options.dailyKeepDays) ? options.dailyKeepDays : 7;
  const weeklyKeepWeeks = Number.isFinite(options.weeklyKeepWeeks) ? options.weeklyKeepWeeks : 52;
  const weeklyWindowDays = dailyKeepDays + (weeklyKeepWeeks * 7);

  const keep = [];
  const purge = [];
  const dailyBuckets = new Set();
  const weeklyBuckets = new Set();
  const quarterlyBuckets = new Set();

  for (const snapshot of snapshots) {
    const ageDays = getAgeDays(now, snapshot.timestamp);
    const metadata = { ...snapshot, ageDays };

    if (ageDays < dailyKeepDays) {
      const dayKey = snapshot.timestamp.toISOString().slice(0, 10);
      if (!dailyBuckets.has(dayKey)) {
        dailyBuckets.add(dayKey);
        keep.push(metadata);
      } else {
        purge.push(metadata);
      }
      continue;
    }

    if (ageDays < weeklyWindowDays) {
      const weekKey = getIsoWeekKey(snapshot.timestamp);
      if (!weeklyBuckets.has(weekKey) && weeklyBuckets.size < weeklyKeepWeeks) {
        weeklyBuckets.add(weekKey);
        keep.push(metadata);
      } else {
        purge.push(metadata);
      }
      continue;
    }

    const quarterKey = getQuarterKey(snapshot.timestamp);
    if (!quarterlyBuckets.has(quarterKey)) {
      quarterlyBuckets.add(quarterKey);
      keep.push(metadata);
    } else {
      purge.push(metadata);
    }
  }

  return {
    keep,
    purge,
    stats: {
      total: snapshots.length,
      keptDailyBuckets: dailyBuckets.size,
      keptWeeklyBuckets: weeklyBuckets.size,
      keptQuarterlyBuckets: quarterlyBuckets.size
    }
  };
}

export function applyRetentionToDirectory(directory, options = {}) {
  const snapshots = listBackupSnapshots(directory, { prefix: options.prefix });
  const plan = buildRetentionPlan(snapshots, options);
  if (!options.dryRun) {
    for (const item of plan.purge) {
      unlinkSync(item.path);
    }
  }
  return {
    directory,
    ...plan,
    deleted: options.dryRun ? [] : plan.purge.map(item => item.path)
  };
}
