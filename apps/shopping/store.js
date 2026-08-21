// Local state for the shopping PWA: the offline snapshot plus the queue of
// writes that have not reached the server yet.
//
// Everything here is pure or takes its storage as an argument, so the module
// imports cleanly under `node --test` with no DOM.

export const STORAGE_KEY = 'brianhub_shopping_v1';
// 2: catalogue re-keyed on canonicalKey (word order, plurals, punctuation) and
//    entries gained a `variants` map. Older catalogues are rebuilt from items.
export const STATE_VERSION = 2;

export const ITEM_STATES = Object.freeze(['pending', 'bought', 'substituted', 'unavailable']);
export const COMPLETED_ITEM_STATES = Object.freeze(['bought', 'substituted', 'unavailable']);

// The API validates ids against a strict UUID v4 pattern, so both branches must
// produce v4. randomUUID needs a secure context; getRandomValues does not, which
// is the case the fallback exists for.
export function createUuid() {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function emptyState() {
  return {
    version: STATE_VERSION,
    workspaceId: null,
    cursor: 0,
    lists: [],
    items: {},
    pending: [],
    // Everything you have ever put on a list, keyed by normalized name. This is
    // the "usual items" catalogue; it deliberately outlives the lists it came
    // from, so deleting a finished list never costs you the shortcut.
    catalogue: {},
    // Item ids already folded into the catalogue, so a re-hydrate cannot
    // double-count them.
    catalogued: {},
    // Old canonical key -> the key it was merged into. Without this, typing a
    // spelling you merged away would simply recreate the entry you just tidied.
    aliases: {},
    // Item ids whose purchase has already been counted, so re-hydrating does
    // not record the same shop twice.
    purchaseSeen: {},
    // The server list acting as the "stuff we need" queue.
    needsListId: null,
    // Workspaces this account can see, so the switcher works offline too.
    workspaces: [],
    // itemId -> ISO timestamp of when it was ticked off. Kept out of `items`
    // because a server hydrate replaces that map wholesale, and this is the
    // signal the aisle order is learned from.
    tickOrder: {},
    lastStoreName: null,
    ui: {
      filter: 'open',
      activeListId: null,
      hideCompletedItems: false,
      collapseDone: true
    }
  };
}

function normalizeState(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  // A catalogue written under an older key scheme cannot be re-keyed reliably,
  // so drop it and let syncCatalogueFromItems rebuild it from the items. Only
  // the derived catalogue is discarded — lists, items and the pending queue,
  // which are the things that cannot be recovered, are untouched.
  const staleCatalogue = Number(raw.version) !== STATE_VERSION;
  const next = {
    ...base,
    ...raw,
    version: STATE_VERSION,
    lists: Array.isArray(raw.lists) ? raw.lists : [],
    items: raw.items && typeof raw.items === 'object' ? raw.items : {},
    pending: Array.isArray(raw.pending) ? raw.pending : [],
    workspaces: Array.isArray(raw.workspaces) ? raw.workspaces : [],
    catalogue: !staleCatalogue && raw.catalogue && typeof raw.catalogue === 'object' ? raw.catalogue : {},
    catalogued: !staleCatalogue && raw.catalogued && typeof raw.catalogued === 'object' ? raw.catalogued : {},
    aliases: !staleCatalogue && raw.aliases && typeof raw.aliases === 'object' ? raw.aliases : {},
    purchaseSeen: !staleCatalogue && raw.purchaseSeen && typeof raw.purchaseSeen === 'object' ? raw.purchaseSeen : {},
    tickOrder: raw.tickOrder && typeof raw.tickOrder === 'object' ? raw.tickOrder : {},
    ui: { ...base.ui, ...(raw.ui && typeof raw.ui === 'object' ? raw.ui : {}) }
  };
  if (staleCatalogue) syncCatalogueFromItems(next);
  return next;
}

export function loadState(storage = globalThis.localStorage) {
  if (!storage) return emptyState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // Quota exceeded or storage disabled. The in-memory state stays usable.
    return false;
  }
}

// --- parsing -------------------------------------------------------------

const BULLET_PREFIX = /^\s*(?:[-*•·–—]|\d+[.)])\s+/;

// Turn pasted text into item names. Splits on newlines and commas, strips
// bullet/number prefixes, drops blanks and case-insensitive duplicates.
export function parseItemNames(input) {
  const text = String(input ?? '');
  if (!text.trim()) return [];
  const seen = new Set();
  const names = [];
  for (const rawLine of text.split(/[\n\r,]+/)) {
    const name = rawLine.replace(BULLET_PREFIX, '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const trimmed = name.slice(0, 512);
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(trimmed);
  }
  return names;
}

export function normalizeItemState(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return ITEM_STATES.includes(text) ? text : 'pending';
}

export function isCompletedItemState(value) {
  return COMPLETED_ITEM_STATES.includes(normalizeItemState(value));
}

export function itemOutcomeLabel(item) {
  const state = normalizeItemState(item?.item_state);
  if (state === 'substituted') {
    const substitute = String(item?.substitute_name ?? '').trim();
    return substitute ? `Substituted → ${substitute}` : 'Substituted';
  }
  if (state === 'unavailable') return 'Unavailable';
  if (state === 'bought') return 'Bought';
  return '';
}

// --- selectors -----------------------------------------------------------

export function getList(state, listId) {
  return (state.lists ?? []).find((list) => list.id === listId) ?? null;
}

export function getItemsForList(state, listId) {
  return Object.values(state.items ?? {})
    .filter((item) => item && item.list_id === listId)
    .sort((a, b) => {
      const orderA = Number(a.sort_order) || 0;
      const orderB = Number(b.sort_order) || 0;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
    });
}

export function getListProgress(state, listId) {
  const items = getItemsForList(state, listId);
  const done = items.filter((item) => isCompletedItemState(item.item_state)).length;
  return { total: items.length, done, remaining: items.length - done };
}

// A list is "complete" when it is archived, or when it has items and none are
// still pending. Empty lists are never complete — an empty list is a new list.
export function isListComplete(state, list) {
  if (!list) return false;
  if (list.archived) return true;
  const { total, remaining } = getListProgress(state, list.id);
  return total > 0 && remaining === 0;
}

// Local calendar day, not UTC — toISOString() would roll over the date for
// anyone west of Greenwich for part of the evening.
export function todayIso(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// A shopping trip is identified by where and when, so that is what a new list
// is called. The date is absolute rather than "Today" — the name is stored and
// outlives the day it was written on.
export function listNameFor(storeName, scheduledFor, locale = undefined) {
  const parts = [];
  const store = String(storeName ?? '').trim();
  if (store) parts.push(store);

  const date = String(scheduledFor ?? '').trim();
  if (date) {
    const parsed = new Date(`${date}T00:00:00`);
    parts.push(
      Number.isNaN(parsed.getTime())
        ? date
        : parsed.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
    );
  }

  return parts.join(' - ');
}

export const NEEDS_LIST_NAME = 'Stuff we need';

// The needs queue is an ordinary server-backed list, which is what gives it
// sync and offline for free. It is identified by id, falling back to name so a
// reinstall re-adopts the existing queue instead of starting a second one.
export function findNeedsList(state) {
  const byId = (state.lists ?? []).find((list) => list.id === state.needsListId);
  if (byId) return byId;
  return (state.lists ?? []).find(
    (list) => String(list.name ?? '').trim().toLowerCase() === NEEDS_LIST_NAME.toLowerCase()
  ) ?? null;
}

export function getNeedsItems(state) {
  const list = findNeedsList(state);
  if (!list) return [];
  return getItemsForList(state, list.id)
    .filter((item) => !isCompletedItemState(item.item_state));
}

// What is worth putting in the trolley on a trip to this store: things that can
// be bought anywhere, plus things only this store stocks.
export function getNeedsForStore(state, store = null) {
  return getNeedsItems(state).filter((item) => canBuyAt(state, item.name, store));
}

export function getVisibleLists(state, filter = state.ui?.filter ?? 'open') {
  const needs = findNeedsList(state);
  const lists = (state.lists ?? [])
    // The queue is not a shopping trip, so it never appears among them.
    .filter((list) => list && !list.deleted && list.id !== needs?.id);
  const filtered = lists.filter((list) => {
    const complete = isListComplete(state, list);
    if (filter === 'open') return !complete;
    if (filter === 'done') return complete;
    return true;
  });
  return filtered.sort((a, b) => {
    const dateA = a.scheduled_for ?? '';
    const dateB = b.scheduled_for ?? '';
    if (dateA !== dateB) {
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA.localeCompare(dateB);
    }
    return String(a.name ?? '').localeCompare(String(b.name ?? ''));
  });
}

// --- local mutations -----------------------------------------------------

export function upsertList(state, list) {
  if (!list?.id) return state;
  const index = (state.lists ?? []).findIndex((entry) => entry.id === list.id);
  if (index === -1) {
    state.lists = [...(state.lists ?? []), list];
  } else {
    state.lists = state.lists.map((entry, i) => (i === index ? { ...entry, ...list } : entry));
  }
  return state;
}

export function removeList(state, listId) {
  state.lists = (state.lists ?? []).filter((entry) => entry.id !== listId);
  for (const [id, item] of Object.entries(state.items ?? {})) {
    if (item?.list_id === listId) delete state.items[id];
  }
  return state;
}

export function upsertItem(state, item) {
  if (!item?.id) return state;
  state.items = { ...(state.items ?? {}) };
  state.items[item.id] = { ...(state.items[item.id] ?? {}), ...item };
  return state;
}

export function removeItem(state, itemId) {
  if (!state.items) return state;
  state.items = { ...state.items };
  delete state.items[itemId];
  return state;
}

// --- pending write queue -------------------------------------------------

export function enqueue(state, change) {
  const entry = {
    client_mutation_id: createUuid(),
    queued_at: new Date().toISOString(),
    retry_count: 0,
    next_retry_at: null,
    needs_attention: false,
    last_error: null,
    last_error_code: null,
    ...change
  };
  state.pending = [...(state.pending ?? []), entry];
  return entry;
}

export function hasPendingFor(state, entityId) {
  return (state.pending ?? []).some((change) => change?.entity_id === entityId);
}

export function pendingCount(state) {
  return (state.pending ?? []).length;
}

// --- remote change application ------------------------------------------

// Apply one /sync/pull change_log row. Skips entities with local pending edits
// so an in-flight offline change is not clobbered by an older server value.
export function applyRemoteChange(state, change) {
  const entityId = change?.entity_id;
  if (!entityId) return false;
  if (hasPendingFor(state, entityId)) return false;
  const payload = change?.payload ?? {};

  if (change.entity_type === 'shopping_list') {
    if (change.action === 'delete') {
      removeList(state, entityId);
      return true;
    }
    upsertList(state, { ...payload, id: entityId });
    return true;
  }

  if (change.entity_type === 'shopping_item') {
    if (change.action === 'delete') {
      removeItem(state, entityId);
      return true;
    }
    const existing = state.items?.[entityId];
    // Updates carry only the changed columns, so they must merge, not replace.
    if (change.action === 'update' && !existing) return false;
    upsertItem(state, { ...payload, id: entityId });
    return true;
  }

  return false;
}

export function applyRemoteChanges(state, changes = [], clientId = null) {
  let applied = 0;
  for (const change of changes) {
    if (clientId && change?.client_id === clientId) continue;
    if (applyRemoteChange(state, change)) applied += 1;
  }
  return applied;
}

// --- reordering ----------------------------------------------------------

const SORT_STEP = 100;

// Work out the sort_order to PATCH so `movedId` lands at `targetIndex`.
// Patching sort_order is also what trains the per-store aisle order server-side,
// so this is the single most valuable write the app makes.
//
// Returns { patches: [{id, sort_order}] } — usually one patch, but a full
// resequence when neighbouring sort_orders leave no gap to slot into.
export function computeReorder(items, movedId, targetIndex) {
  const ordered = items.filter((item) => item?.id);
  const fromIndex = ordered.findIndex((item) => item.id === movedId);
  if (fromIndex === -1) return { patches: [] };

  const bounded = Math.max(0, Math.min(targetIndex, ordered.length - 1));
  if (bounded === fromIndex) return { patches: [] };

  const without = ordered.filter((item) => item.id !== movedId);
  const before = without[bounded - 1] ?? null;
  const after = without[bounded] ?? null;

  const beforeOrder = before ? Number(before.sort_order) || 0 : null;
  const afterOrder = after ? Number(after.sort_order) || 0 : null;

  let nextOrder = null;
  if (beforeOrder === null && afterOrder === null) {
    nextOrder = SORT_STEP;
  } else if (beforeOrder === null) {
    nextOrder = afterOrder - SORT_STEP;
  } else if (afterOrder === null) {
    nextOrder = beforeOrder + SORT_STEP;
  } else if (afterOrder - beforeOrder > 1) {
    nextOrder = Math.floor((beforeOrder + afterOrder) / 2);
  }

  if (nextOrder !== null && Number.isFinite(nextOrder)
    && (beforeOrder === null || nextOrder > beforeOrder)
    && (afterOrder === null || nextOrder < afterOrder)) {
    return { patches: [{ id: movedId, sort_order: nextOrder }] };
  }

  // No usable gap: rewrite the whole list onto a clean ladder.
  const resequenced = [...without];
  resequenced.splice(bounded, 0, ordered[fromIndex]);
  return {
    patches: resequenced.map((item, index) => ({
      id: item.id,
      sort_order: (index + 1) * SORT_STEP
    }))
  };
}

// --- the usual-items catalogue -------------------------------------------

// Words that describe how much of something, not what it is. Dropped when
// deciding whether two entries are the *same* item, kept when deciding whether
// they are the same *variant* — "milk 2L" and "milk 3L" must stay apart.
const UNIT_TOKENS = new Set([
  'l', 'ml', 'litre', 'liter', 'g', 'kg', 'mg', 'oz', 'lb', 'lbs',
  'pk', 'pack', 'packet', 'bottle', 'box', 'can', 'tin', 'jar', 'bag',
  'punnet', 'loaf', 'bunch', 'dozen', 'doz', 'ct', 'count'
]);

const NOISE_TOKENS = new Set(['a', 'an', 'the', 'of', 'some', 'x']);

function stripDiacritics(text) {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

// Crude but consistent. This only ever feeds a lookup key, never anything
// displayed, so "chips" -> "chip" being wrong English does not matter — it
// matters only that it is wrong the same way every time.
function singularize(token) {
  if (token.length <= 3) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (/(ses|shes|ches|xes|zes)$/.test(token)) return token.slice(0, -2);
  if (/(ss|us|is)$/.test(token)) return token;
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

export function nameTokens(name) {
  const text = stripDiacritics(String(name ?? '').toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .trim();
  if (!text) return [];
  return text
    .split(/\s+/)
    .map(singularize)
    .filter((token) => token && !NOISE_TOKENS.has(token));
}

// Formatting-insensitive identity for an item name. Case, punctuation, accents,
// plurals, filler words and word ORDER are all discarded, so "2L Milk",
// "milk 2l" and "Milk, 2 L" are one item. Quantities are kept, so "milk 2l" and
// "milk 3l" remain two.
export function canonicalKey(name) {
  const tokens = nameTokens(name);
  if (!tokens.length) return null;
  return [...tokens].sort().join(' ');
}

export function isQuantityToken(token) {
  return /^\d+(?:\.\d+)?$/.test(token) || UNIT_TOKENS.has(token);
}

// The tokens that say what the item *is*, ignoring how much of it.
export function coreKey(key) {
  const core = String(key ?? '').split(' ').filter((token) => token && !isQuantityToken(token));
  return core.length ? core.join(' ') : String(key ?? '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function pickCanonicalName(variants) {
  let best = null;
  let bestCount = -1;
  // Insertion order breaks ties, so the spelling used first wins a draw.
  for (const [spelling, count] of Object.entries(variants ?? {})) {
    if (Number(count) > bestCount) {
      best = spelling;
      bestCount = Number(count);
    }
  }
  return best;
}

export function storeKey(list) {
  const name = String(list?.store_name ?? '').trim().toLowerCase();
  return name || null;
}

// Called every time an item is added or seen. Counts per store as well as
// overall, so the picker can lead with what you actually buy at *this* shop.
// Follow any merges that have happened, so a spelling you tidied away still
// lands on the entry you tidied it into.
export function resolveCatalogueKey(state, key) {
  let current = key;
  for (let hops = 0; current && state.aliases?.[current] && hops < 8; hops += 1) {
    current = state.aliases[current];
  }
  return current;
}

export function recordCatalogueUse(state, name, store = null, at = new Date().toISOString()) {
  const key = resolveCatalogueKey(state, canonicalKey(name));
  if (!key) return state;
  const spelling = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!spelling) return state;

  const catalogue = { ...(state.catalogue ?? {}) };
  const existing = catalogue[key] ?? { name: spelling, count: 0, stores: {}, variants: {}, lastUsedAt: null };
  const stores = { ...(existing.stores ?? {}) };
  if (store) stores[store] = (Number(stores[store]) || 0) + 1;
  // Every spelling ever used is kept and counted; the one used most often
  // becomes the canonical name that later entries are standardised to.
  const variants = { ...(existing.variants ?? {}) };
  variants[spelling] = (Number(variants[spelling]) || 0) + 1;

  catalogue[key] = {
    ...existing,
    name: pickCanonicalName(variants) ?? spelling,
    count: (Number(existing.count) || 0) + 1,
    stores,
    variants,
    lastUsedAt: at
  };
  state.catalogue = catalogue;
  return state;
}

// The agreed spelling for something already in the catalogue, or null if this
// is a new item. Matching is formatting-only: a different quantity or a
// different word is a different item and is never silently rewritten.
export function canonicalNameFor(state, name) {
  const key = resolveCatalogueKey(state, canonicalKey(name));
  if (!key) return null;
  return state.catalogue?.[key]?.name ?? null;
}

// Rewrite a batch of typed names to their agreed spellings.
export function standardizeNames(state, names = []) {
  const changes = [];
  const standardized = names.map((name) => {
    const canonical = canonicalNameFor(state, name);
    const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (canonical && canonical !== trimmed) {
      changes.push({ from: trimmed, to: canonical });
      return canonical;
    }
    return trimmed;
  });
  return { names: standardized, changes };
}

export function renameCatalogueEntry(state, key, nextName) {
  const entry = state.catalogue?.[key];
  const spelling = String(nextName ?? '').trim().replace(/\s+/g, ' ');
  if (!entry || !spelling) return state;
  const nextKey = canonicalKey(spelling);
  if (!nextKey) return state;

  const catalogue = { ...state.catalogue };
  delete catalogue[key];
  const target = catalogue[nextKey];
  catalogue[nextKey] = target
    ? mergeEntryInto(target, entry, spelling)
    : { ...entry, name: spelling, variants: { ...(entry.variants ?? {}), [spelling]: (entry.count || 1) } };
  catalogue[nextKey].name = spelling;
  state.catalogue = catalogue;
  return state;
}

function mergeEntryInto(target, source, name) {
  const stores = { ...(target.stores ?? {}) };
  for (const [store, count] of Object.entries(source.stores ?? {})) {
    stores[store] = (Number(stores[store]) || 0) + Number(count);
  }
  const variants = { ...(target.variants ?? {}) };
  for (const [spelling, count] of Object.entries(source.variants ?? {})) {
    variants[spelling] = (Number(variants[spelling]) || 0) + Number(count);
  }
  const lastUsedAt = [target.lastUsedAt, source.lastUsedAt]
    .filter(Boolean)
    .sort()
    .pop() ?? null;
  return {
    name: name ?? target.name,
    count: (Number(target.count) || 0) + (Number(source.count) || 0),
    stores,
    variants,
    lastUsedAt
  };
}

// Fold several catalogue entries into one agreed name. Manual only — nothing
// here runs without the user choosing it, because merging across different
// canonical keys means deciding two differently-worded things are the same.
export function mergeCatalogueEntries(state, keys = [], canonicalName) {
  const name = String(canonicalName ?? '').trim().replace(/\s+/g, ' ');
  const targetKey = canonicalKey(name);
  if (!targetKey || keys.length < 1) return state;

  const catalogue = { ...(state.catalogue ?? {}) };
  const aliases = { ...(state.aliases ?? {}) };
  let merged = { name, count: 0, stores: {}, variants: {}, lastUsedAt: null };

  for (const key of new Set([...keys, targetKey])) {
    const entry = catalogue[key];
    if (entry) {
      merged = mergeEntryInto(merged, entry, name);
      delete catalogue[key];
    }
    // Point the old spelling at the merged entry rather than dropping it, so
    // typing it again lands here instead of recreating what was just tidied.
    if (key !== targetKey) aliases[key] = targetKey;
  }
  // Anything that already pointed at a key we just absorbed follows it across.
  for (const [from, to] of Object.entries(aliases)) {
    if (keys.includes(to) && from !== targetKey) aliases[from] = targetKey;
  }
  delete aliases[targetKey];

  merged.variants[name] = Number(merged.variants[name]) || 1;
  merged.name = name;
  catalogue[targetKey] = merged;
  state.catalogue = catalogue;
  state.aliases = aliases;
  return state;
}

// Entries that look like the same thing spelled differently. Two rules, both
// deliberately narrow so the suggestions stay trustworthy:
//   - identical once quantities and units are dropped ("milk" / "milk 2L")
//   - within two edits of each other ("yoghurt" / "yogurt")
// Notably this does NOT suggest merging "chicken" with "chicken stock": the
// extra word is not a quantity, so they are treated as different items.
export function findNameCleanups(state, { limit = 25 } = {}) {
  const entries = Object.entries(state.catalogue ?? {})
    .map(([key, entry]) => ({ key, name: entry.name, count: Number(entry.count) || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 200);

  const parent = new Map(entries.map((entry) => [entry.key, entry.key]));
  const find = (key) => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      const sameCore = coreKey(a.key) === coreKey(b.key);
      const nearTypo = Math.min(a.key.length, b.key.length) >= 5
        && levenshtein(a.key, b.key) <= 2;
      if (sameCore || nearTypo) union(a.key, b.key);
    }
  }

  const groups = new Map();
  for (const entry of entries) {
    const root = find(entry.key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(entry);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const sorted = [...group].sort((a, b) => b.count - a.count);
      return {
        keys: sorted.map((entry) => entry.key),
        entries: sorted,
        // Default to the spelling used most often.
        suggestedName: sorted[0].name,
        total: sorted.reduce((sum, entry) => sum + entry.count, 0)
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

// Fold every item the app knows about into the catalogue, including ones added
// on another device or before this app existed. Idempotent: each item id is
// counted once, so repeated hydrates do not inflate the counts.
export function syncCatalogueFromItems(state) {
  const counted = { ...(state.catalogued ?? {}) };
  const listStores = new Map((state.lists ?? []).map((list) => [list.id, storeKey(list)]));
  let added = 0;
  for (const item of Object.values(state.items ?? {})) {
    if (!item?.id || counted[item.id]) continue;
    counted[item.id] = 1;
    recordCatalogueUse(state, item.name, listStores.get(item.list_id) ?? null, item.created_at ?? undefined);
    added += 1;
  }
  state.catalogued = counted;
  return added;
}

export function forgetCatalogueEntry(state, name) {
  const key = resolveCatalogueKey(state, canonicalKey(name));
  if (!key || !state.catalogue?.[key]) return state;
  const catalogue = { ...state.catalogue };
  delete catalogue[key];
  state.catalogue = catalogue;
  // Drop aliases that pointed here; leaving them would resolve to nothing.
  const aliases = { ...(state.aliases ?? {}) };
  for (const [from, to] of Object.entries(aliases)) {
    if (to === key) delete aliases[from];
  }
  state.aliases = aliases;
  return state;
}

// Ranked "usual items". Bought-here-before beats bought-anywhere-before, and
// both beat something you last bought a year ago.
export function getUsualItems(state, { store = null, exclude = [], limit = 60, query = '' } = {}) {
  const excluded = new Set(exclude.map((name) => canonicalKey(name)).filter(Boolean));
  // Search matches the typed text against the name as well as the key, so
  // "co" finds "Coffee Beans" without the searcher knowing about tokenisation.
  const search = String(query ?? '').trim().toLowerCase();
  const nowMs = Date.now();

  return Object.entries(state.catalogue ?? {})
    .filter(([key]) => !excluded.has(key))
    .filter(([key, entry]) => !search
      || key.includes(search)
      || String(entry.name ?? '').toLowerCase().includes(search))
    .map(([key, entry]) => {
      const total = Number(entry.count) || 0;
      const atStore = store ? Number(entry.stores?.[store]) || 0 : 0;
      const lastUsedMs = entry.lastUsedAt ? Date.parse(entry.lastUsedAt) : NaN;
      const ageDays = Number.isFinite(lastUsedMs)
        ? Math.max(0, (nowMs - lastUsedMs) / 86400000)
        : 3650;
      // Recency halves the weight roughly every 60 days; store matches count double.
      const recency = 1 / (1 + ageDays / 60);
      return { key, name: entry.name, count: total, atStore, score: (total + atStore * 2) * (0.4 + recency) };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// --- where an item can be bought -----------------------------------------

// Empty / absent means "anywhere". Otherwise it is the set of stores that
// actually stock it, so a Bunnings-only thing never clutters a grocery trip.
export function getItemStores(state, name) {
  const key = resolveCatalogueKey(state, canonicalKey(name));
  const onlyAt = state.catalogue?.[key]?.onlyAt;
  return Array.isArray(onlyAt) ? onlyAt.filter(Boolean) : [];
}

export function setItemStores(state, name, stores = []) {
  const key = resolveCatalogueKey(state, canonicalKey(name));
  if (!key || !state.catalogue?.[key]) return state;
  const cleaned = [...new Set(stores.map((store) => String(store ?? '').trim().toLowerCase()).filter(Boolean))];
  const catalogue = { ...state.catalogue };
  catalogue[key] = { ...catalogue[key], onlyAt: cleaned };
  state.catalogue = catalogue;
  return state;
}

export function canBuyAt(state, name, store) {
  const stores = getItemStores(state, name);
  if (!stores.length) return true;
  if (!store) return false;
  return stores.includes(store);
}

// --- how often something is bought ---------------------------------------

const MAX_PURCHASE_HISTORY = 12;
// Ticking an item off, changing your mind, and ticking it again is one shop.
const PURCHASE_DEDUPE_MS = 12 * 60 * 60 * 1000;

export function recordPurchase(state, name, at = new Date().toISOString()) {
  const key = resolveCatalogueKey(state, canonicalKey(name));
  if (!key || !state.catalogue?.[key]) return state;
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) return state;

  const entry = state.catalogue[key];
  const purchases = [...(entry.purchases ?? [])];
  if (purchases.some((stamp) => Math.abs(Date.parse(stamp) - atMs) < PURCHASE_DEDUPE_MS)) {
    return state;
  }
  purchases.push(at);
  purchases.sort();

  const catalogue = { ...state.catalogue };
  catalogue[key] = { ...entry, purchases: purchases.slice(-MAX_PURCHASE_HISTORY) };
  state.catalogue = catalogue;
  return state;
}

// Rebuild purchase history from whatever the server knows. Bought items carry
// the time they were ticked in updated_at, so a fresh install recovers its
// frequency estimates instead of starting blind.
export function syncPurchasesFromItems(state) {
  const seen = { ...(state.purchaseSeen ?? {}) };
  let added = 0;
  for (const item of Object.values(state.items ?? {})) {
    if (!item?.id || seen[item.id]) continue;
    if (!isCompletedItemState(item.item_state)) continue;
    seen[item.id] = 1;
    if (item.updated_at) {
      recordPurchase(state, item.name, item.updated_at);
      added += 1;
    }
  }
  state.purchaseSeen = seen;
  return added;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function describeCadence(everyDays) {
  if (!Number.isFinite(everyDays)) return '';
  if (everyDays <= 10) return 'about weekly';
  if (everyDays <= 18) return 'about fortnightly';
  if (everyDays <= 45) return 'about monthly';
  if (everyDays <= 110) return 'every couple of months';
  return 'now and then';
}

// Estimate how often something gets bought, from the gaps between purchases.
// Median rather than mean: one holiday-sized gap should not turn a weekly item
// into a monthly one. Two purchases give one interval, which is a guess and is
// reported as such.
export function estimateFrequency(state, name, now = new Date()) {
  const key = resolveCatalogueKey(state, canonicalKey(name));
  const entry = state.catalogue?.[key];
  const purchases = (entry?.purchases ?? [])
    .map((stamp) => Date.parse(stamp))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (purchases.length < 2) {
    return {
      known: false,
      purchases: purchases.length,
      everyDays: null,
      confidence: 'none',
      lastPurchasedAt: purchases.length ? new Date(purchases[0]).toISOString() : null,
      dueInDays: null,
      label: ''
    };
  }

  const intervals = [];
  for (let i = 1; i < purchases.length; i += 1) {
    const days = (purchases[i] - purchases[i - 1]) / 86400000;
    // Two ticks the same day are one shop, not a zero-day cadence.
    if (days >= 0.5) intervals.push(days);
  }
  if (!intervals.length) {
    return {
      known: false,
      purchases: purchases.length,
      everyDays: null,
      confidence: 'none',
      lastPurchasedAt: new Date(purchases[purchases.length - 1]).toISOString(),
      dueInDays: null,
      label: ''
    };
  }

  const everyDays = Math.round(median(intervals));
  const lastMs = purchases[purchases.length - 1];
  const daysSince = (now.getTime() - lastMs) / 86400000;
  const confidence = purchases.length >= 4 ? 'good' : (purchases.length === 3 ? 'fair' : 'low');

  return {
    known: true,
    purchases: purchases.length,
    everyDays,
    confidence,
    lastPurchasedAt: new Date(lastMs).toISOString(),
    dueInDays: Math.round(everyDays - daysSince),
    label: describeCadence(everyDays)
  };
}

// Items you are at or past due for. Anything with only two purchases behind it
// needs to be clearly overdue before it is suggested, so a single coincidence
// does not start nagging.
export function getDueItems(state, { now = new Date(), store = null, exclude = [], limit = 20 } = {}) {
  const excluded = new Set(exclude.map((name) => resolveCatalogueKey(state, canonicalKey(name))).filter(Boolean));
  const due = [];

  for (const [key, entry] of Object.entries(state.catalogue ?? {})) {
    if (excluded.has(key)) continue;
    if (store && !canBuyAt(state, entry.name, store)) continue;
    const estimate = estimateFrequency(state, entry.name, now);
    if (!estimate.known) continue;
    const threshold = estimate.confidence === 'low' ? -Math.ceil(estimate.everyDays * 0.25) : 0;
    if (estimate.dueInDays > threshold) continue;
    due.push({ key, name: entry.name, ...estimate });
  }

  return due
    .sort((a, b) => a.dueInDays - b.dueInDays || b.purchases - a.purchases)
    .slice(0, limit);
}

// --- checked-off items ----------------------------------------------------

// Split a list into what is still to get and what is dealt with. Done items are
// ordered by when they were ticked, most recent first, so an accidental tick is
// right at the top of the done group where you can undo it.
export function groupItemsByProgress(items, tickOrder = {}) {
  const pending = [];
  const done = [];
  for (const item of items) {
    if (isCompletedItemState(item.item_state)) done.push(item);
    else pending.push(item);
  }
  done.sort((a, b) => {
    const tickedA = Date.parse(tickOrder[a.id] ?? '') || 0;
    const tickedB = Date.parse(tickOrder[b.id] ?? '') || 0;
    return tickedB - tickedA;
  });
  return { pending, done };
}

// The order you ticked items off IS the order they sit in the shop. Turn that
// into sort_order patches — the server learns per-store aisle order from a
// sort_order change, so this makes an ordinary shop teach it, with no dragging.
//
// Items you never ticked keep their relative order and follow the ticked ones.
export function computeCheckoffOrder(items, tickOrder = {}) {
  const ticked = items
    .filter((item) => tickOrder[item.id])
    .sort((a, b) => Date.parse(tickOrder[a.id]) - Date.parse(tickOrder[b.id]));
  // One tick tells you nothing about order.
  if (ticked.length < 2) return { patches: [] };

  const tickedIds = new Set(ticked.map((item) => item.id));
  const rest = items.filter((item) => !tickedIds.has(item.id));
  const ordered = [...ticked, ...rest];

  const patches = [];
  ordered.forEach((item, index) => {
    const nextOrder = (index + 1) * 100;
    if ((Number(item.sort_order) || 0) !== nextOrder) {
      patches.push({ id: item.id, sort_order: nextOrder });
    }
  });
  return { patches };
}

export function recordTick(state, itemId, at = new Date().toISOString()) {
  state.tickOrder = { ...(state.tickOrder ?? {}), [itemId]: at };
  return state;
}

export function clearTick(state, itemId) {
  if (!state.tickOrder?.[itemId]) return state;
  const next = { ...state.tickOrder };
  delete next[itemId];
  state.tickOrder = next;
  return state;
}

export function nextSortOrder(items) {
  const highest = items.reduce((max, item) => Math.max(max, Number(item?.sort_order) || 0), 0);
  return highest + SORT_STEP;
}
