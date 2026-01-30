export const TaskStatus = {
  INBOX: 'inbox',
  PLANNED: 'planned',
  IN_PROGRESS: 'in-progress',
  WAITING: 'waiting',
  BLOCKED: 'blocked',
  DONE: 'done',
  CANCELED: 'canceled'
};

const transitions = new Map([
  [TaskStatus.INBOX, new Set([TaskStatus.PLANNED, TaskStatus.IN_PROGRESS, TaskStatus.CANCELED])],
  [TaskStatus.PLANNED, new Set([TaskStatus.IN_PROGRESS, TaskStatus.WAITING, TaskStatus.BLOCKED, TaskStatus.DONE, TaskStatus.CANCELED])],
  [TaskStatus.IN_PROGRESS, new Set([TaskStatus.WAITING, TaskStatus.BLOCKED, TaskStatus.DONE, TaskStatus.CANCELED])],
  [TaskStatus.WAITING, new Set([TaskStatus.PLANNED, TaskStatus.IN_PROGRESS, TaskStatus.CANCELED])],
  [TaskStatus.BLOCKED, new Set([TaskStatus.IN_PROGRESS, TaskStatus.PLANNED, TaskStatus.CANCELED])],
  [TaskStatus.DONE, new Set([])],
  [TaskStatus.CANCELED, new Set([])]
]);

export function canTransition(from, to) {
  const allowed = transitions.get(from);
  return allowed ? allowed.has(to) : false;
}

export function transitionStatus(task, nextStatus) {
  if (task.status === nextStatus) return task;
  if (!canTransition(task.status, nextStatus)) {
    throw new Error(`Invalid transition: ${task.status} -> ${nextStatus}`);
  }
  return { ...task, status: nextStatus };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  return new Date(date.getTime() + days * ONE_DAY_MS);
}

export function applyCheckIn(task, response, now = new Date()) {
  if (!['yes', 'no', 'in-progress'].includes(response)) {
    throw new Error(`Unsupported check-in response: ${response}`);
  }

  if (response === 'yes') {
    return {
      ...task,
      status: TaskStatus.DONE,
      completed_at: now.toISOString(),
      next_checkin_at: null
    };
  }

  if (response === 'in-progress') {
    return {
      ...task,
      status: TaskStatus.IN_PROGRESS,
      next_checkin_at: addDays(now, 1).toISOString()
    };
  }

  // response === 'no'
  const nextCheck = addDays(now, 1).toISOString();
  return {
    ...task,
    status: TaskStatus.PLANNED,
    next_checkin_at: nextCheck
  };
}

export function applyWaitingFollowup(task, now = new Date(), defaultDays = 3) {
  if (task.status !== TaskStatus.WAITING) return task;
  const followup = task.waiting_followup_at
    ? new Date(task.waiting_followup_at)
    : addDays(now, defaultDays);
  return { ...task, next_checkin_at: followup.toISOString() };
}
