// Ordered replay of queued offline writes.
//
// Same contract as the web app's syncQueue: the queue is strictly ordered and
// STOPS at the first change that cannot be applied, so a failed create never
// gets overtaken by the update that depends on it.
//
// - 4xx (including 409)  -> needs_attention, queue halts, no automatic retry
// - 5xx / network        -> backoff retry, queue halts until next_retry_at
export const RETRY_BACKOFF_STEPS_MS = [1500, 3000, 7000, 15000, 30000, 60000];

export function getReplayBackoffMs(retryCount) {
  const safeCount = Math.max(1, Number(retryCount) || 1);
  const index = Math.min(RETRY_BACKOFF_STEPS_MS.length - 1, safeCount - 1);
  return RETRY_BACKOFF_STEPS_MS[index];
}

function isRetriableStatus(status) {
  if (!status) return true; // status 0 = never reached the server
  return status >= 500;
}

export async function replayPending(pending = [], applyChange, options = {}) {
  const applied = [];
  const remaining = [];
  let error = null;
  const nowMs = Number(options.nowMs ?? Date.now());

  if (!Array.isArray(pending) || pending.length === 0) {
    return { applied, remaining, error };
  }

  for (let index = 0; index < pending.length; index += 1) {
    const change = { ...(pending[index] ?? {}) };

    if (change.needs_attention) {
      remaining.push(change, ...pending.slice(index + 1));
      break;
    }

    const nextRetryAtMs = change.next_retry_at ? Date.parse(change.next_retry_at) : NaN;
    if (Number.isFinite(nextRetryAtMs) && nextRetryAtMs > nowMs) {
      remaining.push(change, ...pending.slice(index + 1));
      break;
    }

    try {
      await applyChange(change);
      applied.push(change);
    } catch (err) {
      error = err;
      const status = Number(err?.status ?? err?.statusCode ?? 0);
      if (status >= 400 && status < 500) {
        change.needs_attention = true;
        change.last_error = err?.message ?? 'Request rejected';
        change.last_error_code = status;
      } else if (isRetriableStatus(status)) {
        change.needs_attention = false;
        const retryCount = Math.max(0, Number(change.retry_count) || 0) + 1;
        change.retry_count = retryCount;
        change.next_retry_at = new Date(nowMs + getReplayBackoffMs(retryCount)).toISOString();
        change.last_error = err?.message ?? 'Temporary sync failure';
        change.last_error_code = status || null;
      }
      remaining.push(change, ...pending.slice(index + 1));
      break;
    }
  }

  return { applied, remaining, error };
}
