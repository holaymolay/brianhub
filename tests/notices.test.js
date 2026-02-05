import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'brianhub-test-'));
const dbPath = join(tmpDir, 'brianhub.sqlite');
process.env.BRIANHUB_DB = dbPath;
process.env.BRIANHUB_MIGRATIONS = new URL('../services/api/db/migrations', import.meta.url).pathname;

const dbUrl = new URL('../services/api/src/db.js', import.meta.url);
dbUrl.search = `v=${Date.now()}-${Math.random()}`;
const { openDb, migrate } = await import(dbUrl);
const {
  createWorkspace,
  listNoticeTypes,
  createNoticeType,
  createNotice,
  listNotices,
  updateNotice,
  deleteNotice
} = await import(new URL('../services/api/src/taskService.js', import.meta.url));

const db = await openDb();
await migrate(db);

test.after(async () => {
  await db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

test('notice types are seeded for a new workspace', async () => {
  const workspace = await createWorkspace(db, { name: 'Test', type: 'personal' });
  const types = await listNoticeTypes(db, workspace.id);
  const keys = types.map(type => type.key);
  assert.ok(keys.includes('general'));
  assert.ok(keys.includes('bill'));
  assert.ok(keys.includes('auto-payment'));
});

test('creating a notice type with the same label returns existing', async () => {
  const workspace = await createWorkspace(db, { name: 'Test Types', type: 'personal' });
  const created = await createNoticeType(db, { workspace_id: workspace.id, label: 'Chore' });
  const existing = await createNoticeType(db, { workspace_id: workspace.id, label: 'Chore' });
  assert.equal(created.id, existing.id);
});

test('notice CRUD works and list is ordered by notify_at', async () => {
  const workspace = await createWorkspace(db, { name: 'Test Notices', type: 'personal' });
  await assert.rejects(() => createNotice(db, { workspace_id: workspace.id, title: '', notify_at: null }));

  const early = await createNotice(db, {
    workspace_id: workspace.id,
    title: 'Early notice',
    notify_at: '2026-02-01T08:00:00Z',
    notice_type: 'general'
  });
  const late = await createNotice(db, {
    workspace_id: workspace.id,
    title: 'Late notice',
    notify_at: '2026-02-02T08:00:00Z',
    notice_type: 'general'
  });
  const recurring = await createNotice(db, {
    workspace_id: workspace.id,
    title: 'Recurring notice',
    notify_at: '2026-02-03T08:00:00Z',
    notice_type: 'general',
    recurrence_interval: 2,
    recurrence_unit: 'week'
  });
  assert.equal(recurring.recurrence_interval, 2);
  assert.equal(recurring.recurrence_unit, 'week');

  const notices = await listNotices(db, workspace.id);
  assert.equal(notices[0].id, early.id);
  assert.equal(notices[1].id, late.id);
  assert.equal(notices[2].id, recurring.id);

  const dismissedAt = '2026-02-01T12:00:00Z';
  const updated = await updateNotice(db, early.id, { dismissed_at: dismissedAt });
  assert.equal(updated.dismissed_at, dismissedAt);

  const cleared = await updateNotice(db, recurring.id, { recurrence_interval: null });
  assert.equal(cleared.recurrence_interval, null);
  assert.equal(cleared.recurrence_unit, null);

  const deleted = await deleteNotice(db, late.id);
  assert.equal(deleted.deleted, 1);
  const remaining = await listNotices(db, workspace.id);
  assert.equal(remaining.length, 2);
  assert.equal(remaining[0].id, early.id);
  assert.equal(remaining[1].id, recurring.id);
});
