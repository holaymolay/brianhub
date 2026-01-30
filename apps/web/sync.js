import { applyRemoteChange, markSynced, createId } from './localStore.js';

const API_BASE = 'http://localhost:3000';
const CLIENT_ID = 'web-' + createId();

export async function syncNow(state) {
  const pending = state.changeLog.filter(change => change.seq > state.lastSyncedSeq);
  let serverCursor = state.serverCursor ?? 0;

  if (pending.length) {
    const pushRes = await fetch(`${API_BASE}/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': CLIENT_ID
      },
      body: JSON.stringify({
        workspace_id: state.workspace.id,
        client_id: CLIENT_ID,
        changes: pending
      })
    });
    if (!pushRes.ok) throw new Error('Push failed');
  }

  const pullRes = await fetch(`${API_BASE}/sync/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: state.workspace.id, cursor: serverCursor })
  });
  if (!pullRes.ok) throw new Error('Pull failed');
  const pull = await pullRes.json();

  pull.changes
    .filter(change => change.client_id !== CLIENT_ID)
    .forEach(change => applyRemoteChange(state, change));

  serverCursor = pull.next_cursor ?? serverCursor;
  markSynced(state, state.localSeq, serverCursor);
  return { serverCursor, pulled: pull.changes.length, pushed: pending.length };
}
