import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetentionPlan } from '../scripts/lib/backup-retention.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeSnapshot(id, date) {
  return {
    id,
    name: `brianhub-${id}.sqlite.gz`,
    path: `/tmp/${id}.sqlite.gz`,
    timestamp: new Date(date)
  };
}

function quarterKey(date) {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${quarter}`;
}

test('retention keeps 7 daily, 52 weekly, then quarterly', () => {
  const now = new Date('2026-02-09T12:00:00.000Z');
  const snapshots = [];

  for (let day = 0; day < 800; day += 1) {
    const ts = new Date(now.getTime() - (day * DAY_MS));
    ts.setUTCHours(9, 0, 0, 0);
    snapshots.push(makeSnapshot(`d${String(day).padStart(4, '0')}`, ts));
  }

  snapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const plan = buildRetentionPlan(snapshots, {
    now,
    dailyKeepDays: 7,
    weeklyKeepWeeks: 52
  });

  const threshold = 7 + (52 * 7);
  const daily = plan.keep.filter(item => item.ageDays < 7);
  const weekly = plan.keep.filter(item => item.ageDays >= 7 && item.ageDays < threshold);
  const quarterly = plan.keep.filter(item => item.ageDays >= threshold);

  const expectedQuarterly = new Set(
    snapshots
      .filter(item => Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(item.timestamp.getUTCFullYear(), item.timestamp.getUTCMonth(), item.timestamp.getUTCDate())) / DAY_MS) >= threshold)
      .map(item => quarterKey(item.timestamp))
  );

  assert.equal(daily.length, 7);
  assert.equal(weekly.length, 52);
  assert.equal(quarterly.length, expectedQuarterly.size);
  assert.equal(plan.keep.length, 7 + 52 + expectedQuarterly.size);
  assert.ok(plan.purge.length > 0);
});

test('retention keeps newest backup inside each daily bucket', () => {
  const now = new Date('2026-02-09T18:00:00.000Z');
  const snapshots = [
    makeSnapshot('newest-same-day', '2026-02-09T16:30:00.000Z'),
    makeSnapshot('older-same-day', '2026-02-09T08:15:00.000Z'),
    makeSnapshot('previous-day', '2026-02-08T11:00:00.000Z')
  ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const plan = buildRetentionPlan(snapshots, { now, dailyKeepDays: 7, weeklyKeepWeeks: 52 });
  const keptIds = new Set(plan.keep.map(item => item.id));

  assert.equal(plan.keep.length, 2);
  assert.ok(keptIds.has('newest-same-day'));
  assert.ok(keptIds.has('previous-day'));
  assert.ok(!keptIds.has('older-same-day'));
});

