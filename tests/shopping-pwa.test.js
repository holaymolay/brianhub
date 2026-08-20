import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  NEEDS_LIST_NAME,
  applyRemoteChange,
  canBuyAt,
  canonicalKey,
  describeCadence,
  estimateFrequency,
  findNeedsList,
  getDueItems,
  getNeedsForStore,
  recordPurchase,
  setItemStores,
  syncPurchasesFromItems,
  canonicalNameFor,
  computeCheckoffOrder,
  computeReorder,
  emptyState,
  enqueue,
  findNameCleanups,
  forgetCatalogueEntry,
  getUsualItems,
  mergeCatalogueEntries,
  standardizeNames,
  getVisibleLists,
  groupItemsByProgress,
  isListComplete,
  itemOutcomeLabel,
  loadState,
  parseItemNames,
  pendingCount,
  recordCatalogueUse,
  removeList,
  saveState,
  syncCatalogueFromItems,
  upsertItem,
  upsertList,
  STORAGE_KEY
} from '../apps/shopping/store.js';
import { getReplayBackoffMs, replayPending } from '../apps/shopping/queue.js';

function readSource(relPath) {
  return readFileSync(resolve(process.cwd(), relPath), 'utf8');
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    get size() {
      return data.size;
    }
  };
}

function apiError(status) {
  const error = new Error(`status ${status}`);
  error.status = status;
  return error;
}

// --- pasted input --------------------------------------------------------

test('pasted text becomes one item per line, with bullets and numbering stripped', () => {
  const names = parseItemNames('- milk\n2. Bread \n\n• eggs\n');
  assert.deepEqual(names, ['milk', 'Bread', 'eggs']);
});

test('pasted input splits on commas and drops case-insensitive duplicates', () => {
  const names = parseItemNames('milk, bread, MILK\nbread');
  assert.deepEqual(names, ['milk', 'bread']);
});

test('empty or whitespace-only input adds nothing', () => {
  assert.deepEqual(parseItemNames('   \n\n'), []);
  assert.deepEqual(parseItemNames(null), []);
});

test('item names are collapsed and capped at the API limit of 512 characters', () => {
  const [name] = parseItemNames(`  two   spaces  `);
  assert.equal(name, 'two spaces');
  const [long] = parseItemNames('x'.repeat(600));
  assert.equal(long.length, 512);
});

// --- reordering (this is what trains aisle order) ------------------------

test('reordering into a gap emits a single sort_order patch', () => {
  const items = [
    { id: 'a', sort_order: 100 },
    { id: 'b', sort_order: 200 },
    { id: 'c', sort_order: 300 }
  ];
  const { patches } = computeReorder(items, 'c', 0);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, 'c');
  assert.ok(patches[0].sort_order < 100, 'moved item sorts ahead of the first row');
});

test('reordering with no gap between neighbours resequences the whole list', () => {
  const items = [
    { id: 'a', sort_order: 1 },
    { id: 'b', sort_order: 2 },
    { id: 'c', sort_order: 3 }
  ];
  const { patches } = computeReorder(items, 'a', 1);
  assert.equal(patches.length, 3);
  assert.deepEqual(patches.map((patch) => patch.id), ['b', 'a', 'c']);
  assert.deepEqual(patches.map((patch) => patch.sort_order), [100, 200, 300]);
});

test('dropping an item back where it started patches nothing', () => {
  const items = [
    { id: 'a', sort_order: 100 },
    { id: 'b', sort_order: 200 }
  ];
  assert.deepEqual(computeReorder(items, 'a', 0).patches, []);
  assert.deepEqual(computeReorder(items, 'missing', 1).patches, []);
});

// --- offline queue -------------------------------------------------------

test('a 4xx rejection halts the queue and flags the change for attention', async () => {
  const pending = [
    { client_mutation_id: 'one', entity_id: 'a' },
    { client_mutation_id: 'two', entity_id: 'b' }
  ];
  const result = await replayPending(pending, async (change) => {
    if (change.client_mutation_id === 'one') throw apiError(409);
  });
  assert.deepEqual(result.applied, []);
  assert.equal(result.remaining.length, 2, 'later changes stay queued behind the failure');
  assert.equal(result.remaining[0].needs_attention, true);
  assert.equal(result.remaining[0].last_error_code, 409);
});

test('a 5xx or network failure schedules a backoff retry instead of blocking', async () => {
  const pending = [{ client_mutation_id: 'one', entity_id: 'a' }];
  const nowMs = Date.parse('2026-08-19T00:00:00.000Z');
  const result = await replayPending(pending, async () => {
    throw apiError(0);
  }, { nowMs });
  const [change] = result.remaining;
  assert.equal(change.needs_attention, false);
  assert.equal(change.retry_count, 1);
  assert.equal(Date.parse(change.next_retry_at), nowMs + getReplayBackoffMs(1));
});

test('a change waiting on its backoff window is not retried early', async () => {
  const nowMs = Date.parse('2026-08-19T00:00:00.000Z');
  const pending = [{
    client_mutation_id: 'one',
    next_retry_at: new Date(nowMs + 5000).toISOString()
  }];
  let calls = 0;
  const result = await replayPending(pending, async () => { calls += 1; }, { nowMs });
  assert.equal(calls, 0);
  assert.equal(result.remaining.length, 1);
});

test('changes replay in order and drain on success', async () => {
  const seen = [];
  const pending = [
    { client_mutation_id: 'one' },
    { client_mutation_id: 'two' },
    { client_mutation_id: 'three' }
  ];
  const result = await replayPending(pending, async (change) => {
    seen.push(change.client_mutation_id);
  });
  assert.deepEqual(seen, ['one', 'two', 'three']);
  assert.equal(result.remaining.length, 0);
  assert.equal(result.applied.length, 3);
});

// --- remote changes vs local edits ---------------------------------------

test('a remote change is ignored while the same entity has an unsent local edit', () => {
  const state = emptyState();
  upsertItem(state, { id: 'item-1', list_id: 'list-1', name: 'milk', item_state: 'pending' });
  enqueue(state, {
    entity_type: 'shopping_item',
    entity_id: 'item-1',
    action: 'update',
    payload: { item_state: 'bought' }
  });

  const applied = applyRemoteChange(state, {
    entity_type: 'shopping_item',
    entity_id: 'item-1',
    action: 'update',
    payload: { name: 'server name' }
  });

  assert.equal(applied, false);
  assert.equal(state.items['item-1'].name, 'milk');
  assert.equal(pendingCount(state), 1);
});

test('a remote update merges onto the cached item rather than replacing it', () => {
  const state = emptyState();
  upsertItem(state, { id: 'item-1', list_id: 'list-1', name: 'milk', sort_order: 100 });
  applyRemoteChange(state, {
    entity_type: 'shopping_item',
    entity_id: 'item-1',
    action: 'update',
    payload: { item_state: 'bought' }
  });
  assert.equal(state.items['item-1'].name, 'milk', 'columns absent from the change survive');
  assert.equal(state.items['item-1'].item_state, 'bought');
});

test('a remote delete drops the list and its items from the cache', () => {
  const state = emptyState();
  upsertList(state, { id: 'list-1', name: 'Countdown' });
  upsertItem(state, { id: 'item-1', list_id: 'list-1', name: 'milk' });
  applyRemoteChange(state, {
    entity_type: 'shopping_list',
    entity_id: 'list-1',
    action: 'delete',
    payload: {}
  });
  assert.equal(state.lists.length, 0);
  assert.deepEqual(Object.keys(state.items), []);
});

// --- list state ----------------------------------------------------------

test('a list counts as complete only once it has items and none are pending', () => {
  const state = emptyState();
  upsertList(state, { id: 'list-1', name: 'Countdown' });
  assert.equal(isListComplete(state, state.lists[0]), false, 'an empty list is a new list');

  upsertItem(state, { id: 'a', list_id: 'list-1', item_state: 'pending' });
  assert.equal(isListComplete(state, state.lists[0]), false);

  upsertItem(state, { id: 'a', list_id: 'list-1', item_state: 'bought' });
  assert.equal(isListComplete(state, state.lists[0]), true);
});

test('unavailable and substituted items count as dealt with, not outstanding', () => {
  const state = emptyState();
  upsertList(state, { id: 'list-1', name: 'Countdown' });
  upsertItem(state, { id: 'a', list_id: 'list-1', item_state: 'unavailable' });
  upsertItem(state, { id: 'b', list_id: 'list-1', item_state: 'substituted', substitute_name: 'oat milk' });
  assert.equal(isListComplete(state, state.lists[0]), true);
  assert.equal(itemOutcomeLabel(state.items.b), 'Substituted → oat milk');
});

test('the open filter hides completed lists and sorts by shopping day', () => {
  const state = emptyState();
  upsertList(state, { id: 'later', name: 'Later', scheduled_for: '2026-09-02' });
  upsertList(state, { id: 'sooner', name: 'Sooner', scheduled_for: '2026-08-20' });
  upsertList(state, { id: 'archived', name: 'Done', archived: 1 });

  const open = getVisibleLists(state, 'open');
  assert.deepEqual(open.map((list) => list.id), ['sooner', 'later']);
  assert.deepEqual(getVisibleLists(state, 'done').map((list) => list.id), ['archived']);
  assert.equal(getVisibleLists(state, 'all').length, 3);
});

// --- learning the aisle order from an ordinary shop -----------------------

test('the order items were ticked off becomes the aisle order', () => {
  const items = [
    { id: 'milk', sort_order: 100 },
    { id: 'bread', sort_order: 200 },
    { id: 'bananas', sort_order: 300 }
  ];
  // Walked the shop: bananas first, then milk, then bread.
  const ticks = {
    bananas: '2026-08-19T10:00:00.000Z',
    milk: '2026-08-19T10:04:00.000Z',
    bread: '2026-08-19T10:09:00.000Z'
  };
  const { patches } = computeCheckoffOrder(items, ticks);
  assert.deepEqual(patches.map((patch) => patch.id), ['bananas', 'milk', 'bread']);
  assert.deepEqual(patches.map((patch) => patch.sort_order), [100, 200, 300]);
});

test('items never ticked keep their order and follow the ones that were', () => {
  const items = [
    { id: 'milk', sort_order: 100 },
    { id: 'bread', sort_order: 200 },
    { id: 'bananas', sort_order: 300 }
  ];
  const ticks = { bananas: '2026-08-19T10:00:00.000Z', bread: '2026-08-19T10:02:00.000Z' };
  const { patches } = computeCheckoffOrder(items, ticks);

  // Only changed rows are patched, so check the resulting order, not the patch list.
  const bySortOrder = new Map(items.map((item) => [item.id, Number(item.sort_order)]));
  for (const patch of patches) bySortOrder.set(patch.id, patch.sort_order);
  const order = [...bySortOrder.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  assert.deepEqual(order, ['bananas', 'bread', 'milk']);
  assert.equal(patches.some((patch) => patch.id === 'bread'), false, 'unchanged rows are not patched');
});

test('one tick teaches nothing, so no order is written', () => {
  const items = [{ id: 'milk', sort_order: 100 }, { id: 'bread', sort_order: 200 }];
  assert.deepEqual(computeCheckoffOrder(items, { milk: '2026-08-19T10:00:00.000Z' }).patches, []);
  assert.deepEqual(computeCheckoffOrder(items, {}).patches, []);
});

test('learning only fires for a list with a store name, and defaults are set up so it does', () => {
  const app = readSource('apps/shopping/app.js');
  // The server keys aisle hints on the store name; without one it learns nothing.
  assert.match(app, /function learnOrderFromCheckoff\(list\) \{\s*\n\s*if \(!list \|\| !storeKey\(list\)\) return 0;/);
  assert.match(app, /learnOrderFromCheckoff\(list\)/);
  // A new list inherits the last store used, so the gate is not left closed.
  assert.match(app, /state\.lastStoreName/);
});

// --- checked items get out of the way ------------------------------------

test('ticked items are split out of the working list, newest tick first', () => {
  const items = [
    { id: 'a', item_state: 'bought' },
    { id: 'b', item_state: 'pending' },
    { id: 'c', item_state: 'unavailable' },
    { id: 'd', item_state: 'pending' }
  ];
  const ticks = { a: '2026-08-19T10:00:00.000Z', c: '2026-08-19T10:06:00.000Z' };
  const { pending, done } = groupItemsByProgress(items, ticks);
  assert.deepEqual(pending.map((item) => item.id), ['b', 'd']);
  // Most recently ticked at the top of the done group: that is the one you are
  // most likely to have hit by accident.
  assert.deepEqual(done.map((item) => item.id), ['c', 'a']);
});

test('the done group renders below the pending items and collapses by default', () => {
  const app = readSource('apps/shopping/app.js');
  assert.match(app, /const \{ pending, done \} = groupItemsByProgress\(items, state\.tickOrder\)/);
  assert.match(app, /In the trolley \(\$\{done\.length\}\)/);
  const store = readSource('apps/shopping/store.js');
  assert.match(store, /collapseDone: true/);
});

// --- the usual-items catalogue -------------------------------------------

test('items build a catalogue that outlives the list they came from', () => {
  const state = emptyState();
  upsertList(state, { id: 'list-1', name: 'Weekly', store_name: 'Countdown' });
  upsertItem(state, { id: 'i1', list_id: 'list-1', name: 'Milk', created_at: '2026-08-01T00:00:00.000Z' });
  syncCatalogueFromItems(state);

  removeList(state, 'list-1');
  assert.equal(state.lists.length, 0);
  const usual = getUsualItems(state);
  assert.deepEqual(usual.map((entry) => entry.name), ['Milk']);
});

test('re-hydrating does not inflate the catalogue counts', () => {
  const state = emptyState();
  upsertList(state, { id: 'list-1', name: 'Weekly', store_name: 'Countdown' });
  upsertItem(state, { id: 'i1', list_id: 'list-1', name: 'Milk' });
  assert.equal(syncCatalogueFromItems(state), 1);
  assert.equal(syncCatalogueFromItems(state), 0, 'the same item is only counted once');
  assert.equal(getUsualItems(state)[0].count, 1);
});

test('what you buy at this store outranks what you buy elsewhere', () => {
  const state = emptyState();
  const now = new Date().toISOString();
  recordCatalogueUse(state, 'Bananas', 'countdown', now);
  recordCatalogueUse(state, 'Screws', 'bunnings', now);
  recordCatalogueUse(state, 'Screws', 'bunnings', now);

  const atCountdown = getUsualItems(state, { store: 'countdown' });
  assert.equal(atCountdown[0].name, 'Bananas', 'store matches are weighted above raw frequency');
  const atBunnings = getUsualItems(state, { store: 'bunnings' });
  assert.equal(atBunnings[0].name, 'Screws');
});

test('the catalogue filters by search, excludes what is already on the list, and can forget', () => {
  const state = emptyState();
  const now = new Date().toISOString();
  recordCatalogueUse(state, 'Milk', null, now);
  recordCatalogueUse(state, 'Muesli', null, now);
  recordCatalogueUse(state, 'Bread', null, now);

  assert.deepEqual(getUsualItems(state, { query: 'mu' }).map((e) => e.name), ['Muesli']);
  assert.deepEqual(
    getUsualItems(state, { exclude: ['milk'] }).map((e) => e.name).sort(),
    ['Bread', 'Muesli']
  );

  forgetCatalogueEntry(state, 'Bread');
  assert.equal(getUsualItems(state).some((e) => e.name === 'Bread'), false);
});

test('the same item spelled differently stays one catalogue entry', () => {
  const state = emptyState();
  const now = new Date().toISOString();
  recordCatalogueUse(state, 'Coffee Beans', null, now);
  recordCatalogueUse(state, 'coffee   beans', null, now);
  const usual = getUsualItems(state);
  assert.equal(usual.length, 1);
  assert.equal(usual[0].name, 'Coffee Beans', 'the first spelling is kept');
  assert.equal(usual[0].count, 2);
});

// --- standardising item names --------------------------------------------

test('formatting differences resolve to one item', () => {
  const pairs = [
    ['Milk', 'milk'],
    ['Milk 2L', '2L milk'],
    ['Milk 2L', 'Milk, 2 L'],
    ['Coffee Beans', 'coffee-beans'],
    ['Egg', 'Eggs'],
    ['Pipe Couplings (2in)', 'pipe couplings 2in'],
    ['Créme fraiche', 'creme fraiche'],
    ['  Olive   Oil ', 'olive oil']
  ];
  for (const [a, b] of pairs) {
    assert.equal(canonicalKey(a), canonicalKey(b), `${a} should match ${b}`);
  }
});

test('a different quantity or a different word is a different item', () => {
  // The whole safety property: only formatting is ignored, never meaning.
  assert.notEqual(canonicalKey('Milk 2L'), canonicalKey('Milk 3L'));
  assert.notEqual(canonicalKey('Chicken'), canonicalKey('Chicken stock'));
  assert.notEqual(canonicalKey('Apple juice'), canonicalKey('Apple cider'));
});

test('the spelling used most often becomes the one new entries are standardised to', () => {
  const state = emptyState();
  const now = new Date().toISOString();
  recordCatalogueUse(state, 'coffee beans', null, now);
  recordCatalogueUse(state, 'Coffee Beans', null, now);
  recordCatalogueUse(state, 'Coffee Beans', null, now);

  assert.equal(canonicalNameFor(state, 'COFFEE  BEANS'), 'Coffee Beans');
  const { names, changes } = standardizeNames(state, ['beans coffee', 'Milk']);
  assert.deepEqual(names, ['Coffee Beans', 'Milk']);
  assert.deepEqual(changes, [{ from: 'beans coffee', to: 'Coffee Beans' }]);
});

test('an item never bought before is left exactly as typed', () => {
  const state = emptyState();
  recordCatalogueUse(state, 'Milk', null, new Date().toISOString());
  const { names, changes } = standardizeNames(state, ['Sourdough Loaf']);
  assert.deepEqual(names, ['Sourdough Loaf']);
  assert.deepEqual(changes, []);
});

test('differently formatted entries collapse into one catalogue row', () => {
  const state = emptyState();
  const now = new Date().toISOString();
  recordCatalogueUse(state, '2L Milk', 'countdown', now);
  recordCatalogueUse(state, 'milk 2 l', 'countdown', now);
  const usual = getUsualItems(state);
  assert.equal(usual.length, 1);
  assert.equal(usual[0].count, 2);
});

test('the tidy-up screen suggests quantity and typo variants, not different items', () => {
  const state = emptyState();
  const now = new Date().toISOString();
  for (const name of ['Milk', 'Milk', 'Milk 2L', 'Yoghurt', 'Yogurt', 'Chicken', 'Chicken Stock']) {
    recordCatalogueUse(state, name, null, now);
  }
  const groups = findNameCleanups(state);
  const grouped = groups.map((group) => group.entries.map((entry) => entry.name).sort());

  assert.ok(
    grouped.some((names) => names.join('|') === 'Milk|Milk 2L'),
    'a quantity-only difference is offered'
  );
  assert.ok(
    grouped.some((names) => names.join('|') === 'Yoghurt|Yogurt'),
    'a near-typo is offered'
  );
  assert.equal(
    grouped.some((names) => names.includes('Chicken Stock')),
    false,
    'an extra word that is not a quantity means a different item'
  );
  const milkGroup = groups.find((group) => group.entries.some((entry) => entry.name === 'Milk'));
  assert.equal(milkGroup.suggestedName, 'Milk', 'the most-used spelling is proposed');
});

test('merging rewrites the catalogue onto the chosen spelling and keeps the totals', () => {
  const state = emptyState();
  const now = new Date().toISOString();
  recordCatalogueUse(state, 'Yogurt', 'countdown', now);
  recordCatalogueUse(state, 'Yoghurt', 'countdown', now);
  recordCatalogueUse(state, 'Yoghurt', 'countdown', now);

  const [group] = findNameCleanups(state);
  mergeCatalogueEntries(state, group.keys, 'Yoghurt');

  const usual = getUsualItems(state);
  assert.equal(usual.length, 1);
  assert.equal(usual[0].name, 'Yoghurt');
  assert.equal(usual[0].count, 3, 'the merged entry keeps every use');
  // And a future add of the old spelling now standardises to the merged name,
  // rather than quietly recreating the entry that was just tidied away.
  assert.equal(canonicalNameFor(state, 'yogurt'), 'Yoghurt');
  recordCatalogueUse(state, 'yogurt', null, new Date().toISOString());
  assert.equal(getUsualItems(state).length, 1, 'the old spelling does not come back');
  assert.equal(getUsualItems(state)[0].count, 4);
});

test('an item already waiting on the list is not added twice', () => {
  // Standardising names makes re-adds land on the same spelling, which would
  // otherwise show up as two identical rows.
  const app = readSource('apps/shopping/app.js');
  assert.match(app, /const alreadyWanted = new Set\(/);
  assert.match(app, /\.filter\(\(item\) => !isCompletedItemState\(item\.item_state\)\)/);
  assert.match(app, /already on the list/);
});

test('merging renames the item everywhere it is still on a list', () => {
  const app = readSource('apps/shopping/app.js');
  assert.match(app, /function renameItemsForKeys\(keys, canonicalName\)/);
  assert.match(app, /targetKeys\.has\(canonicalKey\(item\.name\)\)/);
  assert.match(app, /action: 'update',\s*\n\s*payload: \{ name: canonicalName \}/);
});

test('an older stored catalogue is rebuilt rather than read under the new key scheme', () => {
  const storage = memoryStorage({
    [STORAGE_KEY]: JSON.stringify({
      version: 1,
      workspaceId: 'w1',
      lists: [{ id: 'list-1', name: 'Weekly', store_name: 'Countdown' }],
      items: { i1: { id: 'i1', list_id: 'list-1', name: 'Milk' } },
      pending: [{ client_mutation_id: 'keep-me' }],
      catalogue: { 'stale key': { name: 'Stale', count: 99 } },
      catalogued: { i1: 1 }
    })
  });
  const state = loadState(storage);
  assert.equal(state.version, 2);
  assert.deepEqual(
    getUsualItems(state).map((entry) => entry.name),
    ['Milk'],
    'the catalogue is rebuilt from the items'
  );
  // Only the derived catalogue is discarded; unsent writes must survive.
  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].client_mutation_id, 'keep-me');
  assert.equal(state.lists.length, 1);
});

// --- the needs queue -----------------------------------------------------

function needsFixture() {
  const state = emptyState();
  upsertList(state, { id: 'needs', name: NEEDS_LIST_NAME });
  upsertList(state, { id: 'grocery', name: 'Weekly', store_name: 'Countdown' });
  upsertList(state, { id: 'hardware', name: 'Hardware', store_name: 'Bunnings' });
  state.needsListId = 'needs';
  const now = new Date().toISOString();
  for (const [id, name, store] of [
    ['i1', 'K-Cups', 'costco'],
    ['i2', 'Milk', 'countdown'],
    ['i3', 'Timber screws', 'bunnings']
  ]) {
    upsertItem(state, { id, list_id: 'needs', name, item_state: 'pending', sort_order: 1 });
    recordCatalogueUse(state, name, store, now);
  }
  setItemStores(state, 'K-Cups', ['costco']);
  setItemStores(state, 'Timber screws', ['bunnings']);
  return state;
}

test('the needs queue is a real list but never shows up as a shopping trip', () => {
  const state = needsFixture();
  assert.equal(findNeedsList(state).id, 'needs');
  const trips = getVisibleLists(state, 'all').map((list) => list.name);
  assert.deepEqual(trips.sort(), ['Hardware', 'Weekly']);
  assert.equal(trips.includes(NEEDS_LIST_NAME), false);
});

test('the queue is found by name when the remembered id is gone', () => {
  // Survives a reinstall: the queue is re-adopted rather than duplicated.
  const state = needsFixture();
  state.needsListId = null;
  assert.equal(findNeedsList(state).id, 'needs');
});

test('a trip only offers queue items that store actually sells', () => {
  const state = needsFixture();
  assert.deepEqual(
    getNeedsForStore(state, 'countdown').map((item) => item.name),
    ['K-Cups', 'Milk', 'Timber screws'].filter((name) => name === 'Milk')
  );
  assert.deepEqual(
    getNeedsForStore(state, 'bunnings').map((item) => item.name).sort(),
    ['Milk', 'Timber screws']
  );
  assert.deepEqual(
    getNeedsForStore(state, 'costco').map((item) => item.name).sort(),
    ['K-Cups', 'Milk']
  );
});

test('an item with no store restriction can be bought anywhere', () => {
  const state = needsFixture();
  assert.equal(canBuyAt(state, 'Milk', 'countdown'), true);
  assert.equal(canBuyAt(state, 'Milk', 'bunnings'), true);
  assert.equal(canBuyAt(state, 'K-Cups', 'countdown'), false);
  assert.equal(canBuyAt(state, 'K-Cups', 'costco'), true);
  // A trip with no store set cannot promise a restricted item is available.
  assert.equal(canBuyAt(state, 'K-Cups', null), false);
  assert.equal(canBuyAt(state, 'Milk', null), true);
});

test('a restriction still applies to a spelling that was merged away', () => {
  const state = needsFixture();
  // "K-Cups 24 pack" is a separate entry until it is merged: the extra tokens
  // are a quantity, so the tidy-up screen offers it.
  recordCatalogueUse(state, 'K-Cups 24 pack', 'costco', new Date().toISOString());
  assert.equal(canBuyAt(state, 'K-Cups 24 pack', 'countdown'), true, 'unmerged, it has no restriction yet');

  const group = findNameCleanups(state).find((entry) =>
    entry.entries.some((row) => row.name === 'K-Cups'));
  mergeCatalogueEntries(state, group.keys, 'K-Cups');
  setItemStores(state, 'K-Cups', ['costco']);

  // The merged-away spelling resolves through the alias to the restricted entry.
  assert.equal(canBuyAt(state, 'K-Cups 24 pack', 'countdown'), false);
  assert.equal(canBuyAt(state, 'K-Cups 24 pack', 'costco'), true);
});

test('pulling from the queue removes it there and adds it to the trip', () => {
  const app = readSource('apps/shopping/app.js');
  assert.match(app, /function pullNeedsOntoTrip\(needsItemIds\)/);
  assert.match(app, /action: 'delete'/);
  // Added fresh rather than moved, so the server applies the learned aisle spot.
  assert.match(app, /persist\(\);\s*\n\s*addItems\(names\);/);
});

// --- how often things get bought -----------------------------------------

function purchasedEvery(state, name, days, count, endingDaysAgo = 0, now = Date.now()) {
  recordCatalogueUse(state, name, null, new Date(now).toISOString());
  for (let i = count - 1; i >= 0; i -= 1) {
    const at = now - (endingDaysAgo + i * days) * 86400000;
    recordPurchase(state, name, new Date(at).toISOString());
  }
  return state;
}

test('a weekly item is recognised as weekly and a periodic one is not', () => {
  const now = new Date();
  const state = emptyState();
  purchasedEvery(state, 'Mince', 7, 6, 2, now.getTime());
  purchasedEvery(state, 'Olive oil', 70, 4, 10, now.getTime());

  const mince = estimateFrequency(state, 'Mince', now);
  assert.equal(mince.known, true);
  assert.equal(mince.everyDays, 7);
  assert.equal(mince.label, 'about weekly');
  assert.equal(mince.confidence, 'good');

  const oil = estimateFrequency(state, 'Olive oil', now);
  assert.equal(oil.everyDays, 70);
  assert.equal(oil.label, 'every couple of months');
});

test('one purchase is not a pattern', () => {
  const now = new Date();
  const state = emptyState();
  purchasedEvery(state, 'Turkey', 0, 1, 5, now.getTime());
  const estimate = estimateFrequency(state, 'Turkey', now);
  assert.equal(estimate.known, false);
  assert.equal(estimate.everyDays, null);
  assert.equal(estimate.label, '');
});

test('one long gap does not turn a weekly item into a monthly one', () => {
  // Median, not mean: a holiday should not rewrite the cadence.
  const now = Date.now();
  const state = emptyState();
  recordCatalogueUse(state, 'Bread', null, new Date(now).toISOString());
  for (const daysAgo of [90, 83, 76, 20, 13, 6]) {
    recordPurchase(state, 'Bread', new Date(now - daysAgo * 86400000).toISOString());
  }
  assert.equal(estimateFrequency(state, 'Bread', new Date(now)).everyDays, 7);
});

test('ticking an item off twice in one shop counts once', () => {
  const state = emptyState();
  const now = Date.now();
  recordCatalogueUse(state, 'Milk', null, new Date(now).toISOString());
  recordPurchase(state, 'Milk', new Date(now).toISOString());
  recordPurchase(state, 'Milk', new Date(now + 60000).toISOString());
  const key = Object.keys(state.catalogue)[0];
  assert.equal(state.catalogue[key].purchases.length, 1);
});

test('items past their usual interval are flagged as due, respecting store', () => {
  const now = new Date();
  const state = emptyState();
  purchasedEvery(state, 'Mince', 7, 5, 9, now.getTime());   // 9 days since, due
  purchasedEvery(state, 'K-Cups', 30, 5, 2, now.getTime()); // 2 days since, not due
  setItemStores(state, 'K-Cups', ['costco']);

  const due = getDueItems(state, { now });
  assert.deepEqual(due.map((entry) => entry.name), ['Mince']);
  assert.deepEqual(
    getDueItems(state, { now, store: 'countdown' }).map((entry) => entry.name),
    ['Mince'],
    'a Costco-only item is not suggested for a Countdown trip'
  );
  assert.deepEqual(
    getDueItems(state, { now, exclude: ['mince'] }).map((entry) => entry.name),
    [],
    'something already on the list is not suggested again'
  );
});

test('a two-purchase guess must be clearly overdue before it nags', () => {
  const now = new Date();
  const state = emptyState();
  purchasedEvery(state, 'Craisins', 40, 2, 41, now.getTime());
  const barelyOver = estimateFrequency(state, 'Craisins', now);
  assert.equal(barelyOver.confidence, 'low');
  assert.deepEqual(getDueItems(state, { now }).map((entry) => entry.name), []);

  const muchLater = new Date(now.getTime() + 20 * 86400000);
  assert.deepEqual(getDueItems(state, { now: muchLater }).map((entry) => entry.name), ['Craisins']);
});

test('purchase history rebuilds from the server so a new device is not blind', () => {
  const state = emptyState();
  upsertList(state, { id: 'l1', name: 'Weekly', store_name: 'Countdown' });
  upsertItem(state, {
    id: 'i1', list_id: 'l1', name: 'Milk', item_state: 'bought', updated_at: '2026-07-01T10:00:00.000Z'
  });
  upsertItem(state, {
    id: 'i2', list_id: 'l1', name: 'Milk', item_state: 'bought', updated_at: '2026-07-08T10:00:00.000Z'
  });
  upsertItem(state, {
    id: 'i3', list_id: 'l1', name: 'Milk', item_state: 'pending', updated_at: '2026-07-15T10:00:00.000Z'
  });
  syncCatalogueFromItems(state);
  assert.equal(syncPurchasesFromItems(state), 2, 'only bought items count as purchases');
  assert.equal(syncPurchasesFromItems(state), 0, 'and they are not counted twice');
  assert.equal(estimateFrequency(state, 'Milk', new Date('2026-07-15T10:00:00.000Z')).everyDays, 7);
});

test('cadence wording covers the range without gaps', () => {
  assert.equal(describeCadence(7), 'about weekly');
  assert.equal(describeCadence(14), 'about fortnightly');
  assert.equal(describeCadence(30), 'about monthly');
  assert.equal(describeCadence(70), 'every couple of months');
  assert.equal(describeCadence(200), 'now and then');
});

// --- persistence ---------------------------------------------------------

test('state round-trips through storage and survives corrupt data', () => {
  const storage = memoryStorage();
  const state = emptyState();
  state.workspaceId = 'workspace-1';
  upsertList(state, { id: 'list-1', name: 'Countdown' });
  saveState(state, storage);

  const reloaded = loadState(storage);
  assert.equal(reloaded.workspaceId, 'workspace-1');
  assert.equal(reloaded.lists.length, 1);

  const corrupt = memoryStorage({ [STORAGE_KEY]: '{not json' });
  assert.deepEqual(loadState(corrupt), emptyState());
});

// --- wiring that only source text can prove ------------------------------

test('queued item creates never send sort_order, so the server applies learned aisle order', () => {
  const sync = readSource('apps/shopping/sync.js');
  const createBlock = sync.slice(sync.indexOf("if (entityType === 'shopping_item')"));
  const createCall = createBlock.slice(createBlock.indexOf('api.createItems'), createBlock.indexOf('await refreshListItems'));
  assert.doesNotMatch(createCall, /sort_order/, 'an explicit sort_order disables hint-aware placement');
  assert.match(createBlock, /refreshListItems\(listId\)/, 'the server order is pulled back after a create');
});

test('multi-line pastes are read from the clipboard, not the input value', () => {
  // A single-line <input> strips newlines during value sanitisation, so reading
  // the input after a paste would collapse a whole list into one item.
  const app = readSource('apps/shopping/app.js');
  assert.match(app, /addEventListener\('paste'/);
  assert.match(app, /event\.clipboardData\?\.getData\('text'\)/);
  assert.match(app, /if \(!\/\[\\n\\r\]\/\.test\(text\)\) return;/);
});

test('the shopping app carries its own client id, separate from the web app', () => {
  const api = readSource('apps/shopping/api.js');
  assert.match(api, /brianhub_shopping_client_id/);
  assert.doesNotMatch(api, /'brianhub_client_id'/, 'sharing the web id would hide each app from the other on /sync/pull');
});

test('the app shell is self-contained under /apps/shopping', () => {
  for (const file of ['app.js', 'sync.js', 'store.js', 'api.js', 'config.js', 'queue.js']) {
    const source = readSource(`apps/shopping/${file}`);
    assert.doesNotMatch(source, /from '\.\.\/web\//, `${file} must not import the web monolith`);
  }
});

test('the service worker caches only its own scope and never API responses', () => {
  const sw = readSource('apps/shopping/sw.js');
  assert.match(sw, /const SHELL_PATH = '\/apps\/shopping\/'/);
  assert.match(sw, /if \(url\.origin !== self\.location\.origin\) return;/);
  assert.match(sw, /url\.pathname\.startsWith\(SHELL_PATH\)/);
  assert.match(sw, /if \(request\.method !== 'GET'\) return;/);
  // Shell assets must be network-first: stale-while-revalidate would run the
  // previous release's app.js on the first load after every deploy.
  assert.match(sw, /event\.respondWith\(networkFirst\(request\)\)/);
  assert.doesNotMatch(sw, /staleWhileRevalidate\(request\)/);
  for (const asset of ['app.js', 'store.js', 'queue.js', 'sync.js', 'styles.css', 'index.html']) {
    assert.match(sw, new RegExp(`/apps/shopping/${asset.replace('.', '\\.')}`));
  }
});

test('the manifest is installable: scope, start_url and 192/512 icons', () => {
  const manifest = JSON.parse(readSource('apps/shopping/manifest.webmanifest'));
  assert.equal(manifest.scope, '/apps/shopping/');
  assert.equal(manifest.start_url, '/apps/shopping/');
  assert.equal(manifest.display, 'standalone');
  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes('192x192'), 'Android install needs a 192px icon');
  assert.ok(sizes.includes('512x512'), 'Android install needs a 512px icon');
  assert.ok(
    manifest.icons.some((icon) => icon.purpose === 'maskable'),
    'a maskable icon keeps the launcher shape clean'
  );
});

test('the page registers the service worker and links the manifest', () => {
  const html = readSource('apps/shopping/index.html');
  assert.match(html, /<link rel="manifest" href="\/apps\/shopping\/manifest\.webmanifest" \/>/);
  assert.match(html, /name="viewport"[^>]*viewport-fit=cover/);
  const app = readSource('apps/shopping/app.js');
  assert.match(app, /navigator\.serviceWorker\s*\n?\s*\.register\('\/apps\/shopping\/sw\.js', \{ scope: '\/apps\/shopping\/' \}\)/);
});

test('both dev and production serve /shoppinglist and the app directory', () => {
  const dev = readSource('scripts/dev.js');
  assert.match(dev, /'\/shoppinglist'/);
  assert.match(dev, /\.webmanifest/);
  const caddy = readSource('scripts/caddy/Caddyfile');
  assert.match(caddy, /redir \/shoppinglist \/apps\/shopping\/ 302/);
  assert.match(caddy, /handle \/apps\/shopping\/\*/);
});
