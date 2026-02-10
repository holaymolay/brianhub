const RETRY_BACKOFF_STEPS_MS = [1500, 3000, 7000, 15000, 30000, 60000];

export function getReplayBackoffMs(retryCount) {
  const safeCount = Math.max(1, Number(retryCount) || 1);
  const index = Math.min(RETRY_BACKOFF_STEPS_MS.length - 1, safeCount - 1);
  return RETRY_BACKOFF_STEPS_MS[index];
}

function isRetriableError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  if (!status) return true;
  if (status >= 500) return true;
  return false;
}

export async function replayPendingChanges(pendingChanges = [], applyChange, options = {}) {
  const applied = [];
  const remaining = [];
  let error = null;
  const nowMs = Number(options.nowMs ?? Date.now());

  if (!Array.isArray(pendingChanges) || pendingChanges.length === 0) {
    return { applied, remaining, error };
  }

  for (let index = 0; index < pendingChanges.length; index += 1) {
    const change = { ...(pendingChanges[index] ?? {}) };
    if (change.needs_attention) {
      remaining.push(change, ...pendingChanges.slice(index + 1));
      break;
    }
    const nextRetryAtMs = change.next_retry_at ? Date.parse(change.next_retry_at) : NaN;
    if (Number.isFinite(nextRetryAtMs) && nextRetryAtMs > nowMs) {
      remaining.push(change, ...pendingChanges.slice(index + 1));
      break;
    }
    try {
      await applyChange(change);
      applied.push(change);
    } catch (err) {
      error = err;
      const status = Number(err?.status ?? err?.statusCode ?? 0);
      if (status === 409) {
        change.needs_attention = true;
        change.last_error = err?.message ?? 'Sync conflict';
        change.last_error_code = 409;
        if (err?.conflict) {
          change.conflict = err.conflict;
        }
      } else if (status >= 400 && status < 500) {
        change.needs_attention = true;
        change.last_error = err?.message ?? 'Request rejected';
        change.last_error_code = status;
      } else if (isRetriableError(err)) {
        const retryCount = Math.max(0, Number(change.retry_count) || 0) + 1;
        const backoffMs = getReplayBackoffMs(retryCount);
        change.retry_count = retryCount;
        change.next_retry_at = new Date(nowMs + backoffMs).toISOString();
        change.last_error = err?.message ?? 'Temporary sync failure';
        change.last_error_code = status || null;
      }
      remaining.push(change, ...pendingChanges.slice(index + 1));
      break;
    }
  }

  return { applied, remaining, error };
}
