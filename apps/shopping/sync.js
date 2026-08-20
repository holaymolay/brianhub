// Sync engine: drains the offline write queue to the REST API, then pulls the
// server's change_log to pick up edits made on other devices.
//
// Note on the server contract: /sync/push only appends to change_log, it does
// NOT write domain tables, so queued writes replay as ordinary REST calls.
// /sync/pull is used purely as a change feed.
import { api, ApiError, getClientId } from './api.js';
import { replayPending } from './queue.js';
import {
  applyRemoteChanges,
  getItemsForList,
  removeItem,
  removeList,
  syncCatalogueFromItems,
  syncPurchasesFromItems,
  upsertItem,
  upsertList
} from './store.js';

const LIST_PATCH_FIELDS = ['name', 'store_name', 'scheduled_for', 'archived'];
const ITEM_PATCH_FIELDS = ['name', 'list_id', 'item_state', 'substitute_name', 'sort_order'];

function pick(source, fields) {
  const out = {};
  for (const field of fields) {
    if (source?.[field] !== undefined) out[field] = source[field];
  }
  return out;
}

export function createSyncEngine({ state, persist, onData, onStatus }) {
  let flushing = false;
  let pulling = false;

  const emitStatus = (status) => {
    if (typeof onStatus === 'function') onStatus(status);
  };
  const emitData = () => {
    if (typeof onData === 'function') onData();
  };

  // Refresh one list's items from the server. Creating items can resequence
  // *existing* rows (hint-aware placement), so the whole list has to come back.
  async function refreshListItems(listId) {
    if (!listId) return;
    let items;
    try {
      items = await api.listItemsForList(listId);
    } catch (error) {
      if (error?.status === 404) return;
      throw error;
    }
    if (!Array.isArray(items)) return;
    for (const item of getItemsForList(state, listId)) {
      removeItem(state, item.id);
    }
    for (const item of items) {
      upsertItem(state, item);
    }
  }

  async function applyChange(change) {
    if (!change) return;
    const { entity_type: entityType, action, entity_id: entityId, payload = {} } = change;

    if (entityType === 'shopping_list') {
      if (action === 'create') {
        // POST /shopping-lists is idempotent on a client-supplied id: it returns
        // the existing row instead of failing, so a replayed create is safe.
        const created = await api.createList({
          id: entityId,
          workspace_id: payload.workspace_id ?? state.workspaceId,
          name: payload.name,
          ...pick(payload, ['store_name', 'scheduled_for'])
        });
        if (created) upsertList(state, created);
        return;
      }
      if (action === 'update') {
        const updated = await api.updateList(entityId, pick(payload, LIST_PATCH_FIELDS));
        if (updated) upsertList(state, updated);
        return;
      }
      if (action === 'delete') {
        try {
          await api.deleteList(entityId);
        } catch (error) {
          if (error?.status !== 404) throw error;
        }
        removeList(state, entityId);
        return;
      }
      return;
    }

    if (entityType === 'shopping_item') {
      if (action === 'create') {
        const listId = payload.list_id;
        try {
          // No sort_order on purpose — that is what lets the server drop the
          // item into its learned aisle position for this store.
          await api.createItems(listId, [{ id: entityId, name: payload.name }]);
        } catch (error) {
          // A create whose response was lost would fail on the id's primary key.
          // Treat "already there" as success rather than wedging the queue.
          const exists = await itemExistsOnServer(listId, entityId);
          if (!exists) throw error;
        }
        await refreshListItems(listId);
        return;
      }
      if (action === 'update') {
        const updated = await api.updateItem(entityId, pick(payload, ITEM_PATCH_FIELDS));
        if (updated) upsertItem(state, updated);
        return;
      }
      if (action === 'delete') {
        try {
          await api.deleteItem(entityId);
        } catch (error) {
          if (error?.status !== 404) throw error;
        }
        removeItem(state, entityId);
        return;
      }
    }
  }

  async function itemExistsOnServer(listId, itemId) {
    if (!listId || !itemId) return false;
    try {
      const items = await api.listItemsForList(listId);
      return Array.isArray(items) && items.some((item) => item?.id === itemId);
    } catch {
      return false;
    }
  }

  async function flush() {
    if (flushing) return { applied: [], remaining: state.pending ?? [], error: null };
    if (!(state.pending ?? []).length) return { applied: [], remaining: [], error: null };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { applied: [], remaining: state.pending, error: null };
    }
    flushing = true;
    emitStatus({ kind: 'syncing' });
    try {
      const result = await replayPending(state.pending, applyChange);
      state.pending = result.remaining;
      persist();
      emitData();
      const blocked = result.remaining.find((change) => change?.needs_attention);
      if (blocked) {
        emitStatus({
          kind: 'blocked',
          message: blocked.last_error ?? 'A queued change was rejected',
          status: blocked.last_error_code ?? null
        });
      } else if (Number(result.error?.status ?? -1) === 0) {
        // Status 0 = the request never reached the server. The device can be
        // "online" and the server still be unreachable; say so rather than
        // showing a sync that silently never completes.
        emitStatus({ kind: 'unreachable' });
      } else if (result.remaining.length) {
        emitStatus({ kind: 'retrying', queued: result.remaining.length });
      } else {
        emitStatus({ kind: 'ok' });
      }
      return result;
    } finally {
      flushing = false;
    }
  }

  async function pull() {
    if (pulling || !state.workspaceId) return 0;
    if ((state.pending ?? []).length) return 0;
    pulling = true;
    try {
      const result = await api.pull(state.workspaceId, state.cursor ?? 0);
      const changes = Array.isArray(result?.changes) ? result.changes : [];
      const applied = applyRemoteChanges(state, changes, getClientId());
      if (applied) {
        syncCatalogueFromItems(state);
        syncPurchasesFromItems(state);
      }
      if (result?.next_cursor !== undefined) state.cursor = result.next_cursor;
      if (applied || result?.next_cursor !== undefined) {
        persist();
        if (applied) emitData();
      }
      return applied;
    } finally {
      pulling = false;
    }
  }

  // Full refresh from the server. Only safe once the queue has drained, so
  // callers must flush first — otherwise offline edits get overwritten.
  async function hydrate() {
    if (!state.workspaceId) return false;
    if ((state.pending ?? []).length) return false;
    const [lists, items] = await Promise.all([
      api.listLists(state.workspaceId),
      api.listItems(state.workspaceId)
    ]);
    if (Array.isArray(lists)) state.lists = lists;
    if (Array.isArray(items)) {
      state.items = {};
      for (const item of items) {
        if (item?.id) state.items[item.id] = item;
      }
    }
    // Everything the server knows about feeds the usual-items catalogue, so the
    // picker is useful on the very first run against an existing account. Bought
    // items also carry when they were ticked, which rebuilds the frequency
    // estimates on a fresh install.
    syncCatalogueFromItems(state);
    syncPurchasesFromItems(state);
    // Move the cursor to "now" so the next pull only sees genuinely new rows.
    try {
      const result = await api.pull(state.workspaceId, state.cursor ?? 0);
      if (result?.next_cursor !== undefined) state.cursor = result.next_cursor;
    } catch {
      // A failed cursor prime just means the next pull replays a few changes.
    }
    persist();
    emitData();
    return true;
  }

  return { flush, pull, hydrate, applyChange, ApiError };
}
