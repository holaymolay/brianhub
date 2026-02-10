import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskStatus, canTransition, applyCheckIn, applyWaitingFollowup } from '../packages/core/taskState.js';

const baseTask = {
  id: 't1',
  status: TaskStatus.INBOX,
  waiting_followup_at: null,
  next_checkin_at: null,
  completed_at: null
};

test('state machine allows expected transitions', () => {
  assert.equal(canTransition(TaskStatus.INBOX, TaskStatus.PLANNED), true);
  assert.equal(canTransition(TaskStatus.INBOX, TaskStatus.DONE), false);
  assert.equal(canTransition(TaskStatus.PLANNED, TaskStatus.IN_PROGRESS), true);
  assert.equal(canTransition(TaskStatus.DONE, TaskStatus.IN_PROGRESS), false);
});

test('check-in yes completes task', () => {
  const updated = applyCheckIn({ ...baseTask, status: TaskStatus.IN_PROGRESS }, 'yes', new Date('2026-01-30T00:00:00Z'));
  assert.equal(updated.status, TaskStatus.DONE);
  assert.ok(updated.completed_at);
  assert.equal(updated.next_checkin_at, null);
});

test('check-in no sets planned and next check-in', () => {
  const updated = applyCheckIn({ ...baseTask, status: TaskStatus.PLANNED }, 'no', new Date('2026-01-30T00:00:00Z'));
  assert.equal(updated.status, TaskStatus.PLANNED);
  assert.ok(updated.next_checkin_at);
});

test('waiting follow-up schedules next check-in', () => {
  const updated = applyWaitingFollowup({ ...baseTask, status: TaskStatus.WAITING }, new Date('2026-01-30T00:00:00Z'), 3);
  assert.ok(updated.next_checkin_at);
});

test('check-in rejects unsupported responses', () => {
  assert.throws(
    () => applyCheckIn({ ...baseTask, status: TaskStatus.IN_PROGRESS }, 'later', new Date('2026-01-30T00:00:00Z')),
    /Unsupported check-in response/
  );
});

test('waiting follow-up prefers explicit waiting_followup_at', () => {
  const updated = applyWaitingFollowup(
    {
      ...baseTask,
      status: TaskStatus.WAITING,
      waiting_followup_at: '2026-02-05T10:30:00.000Z'
    },
    new Date('2026-01-30T00:00:00Z'),
    3
  );
  assert.equal(updated.next_checkin_at, '2026-02-05T10:30:00.000Z');
});
