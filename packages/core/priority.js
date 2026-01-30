export const Priority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

const priorityRank = {
  [Priority.LOW]: 1,
  [Priority.MEDIUM]: 2,
  [Priority.HIGH]: 3,
  [Priority.CRITICAL]: 4
};

export function getPriorityRank(priority) {
  return priorityRank[priority] ?? priorityRank[Priority.MEDIUM];
}

export function compareTasksByPriority(a, b) {
  const rankDiff = getPriorityRank(b.priority) - getPriorityRank(a.priority);
  if (rankDiff !== 0) return rankDiff;
  const urgencyDiff = (b.urgency ? 1 : 0) - (a.urgency ? 1 : 0);
  if (urgencyDiff !== 0) return urgencyDiff;
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}
