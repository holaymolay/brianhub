export async function replayPendingChanges(pendingChanges = [], applyChange) {
  const applied = [];
  const remaining = [];
  let error = null;

  if (!Array.isArray(pendingChanges) || pendingChanges.length === 0) {
    return { applied, remaining, error };
  }

  for (let index = 0; index < pendingChanges.length; index += 1) {
    const change = pendingChanges[index];
    try {
      await applyChange(change);
      applied.push(change);
    } catch (err) {
      error = err;
      remaining.push(change, ...pendingChanges.slice(index + 1));
      break;
    }
  }

  return { applied, remaining, error };
}
