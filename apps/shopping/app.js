// BrianHub Shopping — standalone offline-first PWA.
//
// Offline-first means every write lands in local state and the pending queue
// first, then drains to the API. There is no "try the server, fall back to
// local" path: the local snapshot is what you see, always, and the network is
// a background detail.
import { api, ApiError } from './api.js';
import { shoppingConfig } from './config.js';
import { createSyncEngine } from './sync.js';
import {
  NEEDS_LIST_NAME,
  canonicalKey,
  clearTick,
  estimateFrequency,
  findNeedsList,
  getDueItems,
  getItemStores,
  getNeedsForStore,
  getNeedsItems,
  recordPurchase,
  setItemStores,
  computeCheckoffOrder,
  computeReorder,
  createUuid,
  enqueue,
  findNameCleanups,
  forgetCatalogueEntry,
  mergeCatalogueEntries,
  getItemsForList,
  getList,
  getListProgress,
  getUsualItems,
  getVisibleLists,
  groupItemsByProgress,
  isCompletedItemState,
  isListComplete,
  itemOutcomeLabel,
  loadState,
  normalizeItemState,
  parseItemNames,
  pendingCount,
  recordCatalogueUse,
  recordTick,
  removeItem,
  removeList,
  saveState,
  standardizeNames,
  storeKey,
  upsertItem,
  upsertList
} from './store.js';

const state = loadState();
let deferredInstallPrompt = null;
let pollTimer = null;
let activeItemId = null;
let serverReachable = true;
let listEditorMode = 'create';
let promptHandler = null;

const el = (id) => document.getElementById(id);

const dom = {
  backButton: el('back-button'),
  title: el('app-title'),
  subtitle: el('app-subtitle'),
  installButton: el('install-button'),
  menuButton: el('menu-button'),
  menu: el('app-menu'),
  menuRefresh: el('menu-refresh'),
  menuToggleCompleted: el('menu-toggle-completed'),
  menuTidyNames: el('menu-tidy-names'),
  menuWorkspace: el('menu-workspace'),
  tidySheet: el('tidy-sheet'),
  tidyList: el('tidy-list'),
  tidyEmpty: el('tidy-empty'),
  tidyClose: el('tidy-close'),
  menuEditList: el('menu-edit-list'),
  menuDeleteList: el('menu-delete-list'),
  menuLogout: el('menu-logout'),
  statusBanner: el('status-banner'),
  authGate: el('auth-gate'),
  authForm: el('auth-form'),
  authEmail: el('auth-email'),
  authPassword: el('auth-password'),
  authError: el('auth-error'),
  listsView: el('lists-view'),
  listsContainer: el('lists-container'),
  newListButton: el('new-list-button'),
  needsCard: el('needs-card'),
  needsCardMeta: el('needs-card-meta'),
  needsPullButton: el('needs-pull-button'),
  needsSheet: el('needs-sheet'),
  needsSheetNote: el('needs-sheet-note'),
  needsSheetList: el('needs-sheet-list'),
  needsSheetEmpty: el('needs-sheet-empty'),
  needsSheetAdd: el('needs-sheet-add'),
  needsSheetCancel: el('needs-sheet-cancel'),
  dueStrip: el('due-strip'),
  dueStripText: el('due-strip-text'),
  dueStripAdd: el('due-strip-add'),
  listView: el('list-view'),
  addItemForm: el('add-item-form'),
  addItemInput: el('add-item-input'),
  itemSuggestions: el('item-suggestions'),
  usualItemsButton: el('usual-items-button'),
  usualSheet: el('usual-sheet'),
  usualSearch: el('usual-search'),
  usualList: el('usual-list'),
  usualEmpty: el('usual-empty'),
  usualAdd: el('usual-add'),
  usualCancel: el('usual-cancel'),
  itemsContainer: el('items-container'),
  listEmpty: el('list-empty'),
  completeListButton: el('complete-list-button'),
  backdrop: el('sheet-backdrop'),
  listEditor: el('list-editor'),
  listEditorTitle: el('list-editor-title'),
  listEditorForm: el('list-editor-form'),
  listEditorName: el('list-editor-name'),
  listEditorStore: el('list-editor-store'),
  listEditorDate: el('list-editor-date'),
  listEditorCancel: el('list-editor-cancel'),
  storeSuggestions: el('store-suggestions'),
  itemSheet: el('item-sheet'),
  itemSheetTitle: el('item-sheet-title'),
  promptSheet: el('prompt-sheet'),
  promptTitle: el('prompt-title'),
  promptLabel: el('prompt-label'),
  promptForm: el('prompt-form'),
  promptInput: el('prompt-input'),
  promptSuggestions: el('prompt-suggestions'),
  promptSelect: el('prompt-select'),
  promptCancel: el('prompt-cancel'),
  toast: el('toast')
};

const persist = () => saveState(state);

const sync = createSyncEngine({
  state,
  persist,
  onData: () => render(),
  onStatus: (status) => renderStatus(status)
});

// --- small helpers -------------------------------------------------------

let toastTimer = null;
function showToast(message) {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.add('hidden'), 2600);
}

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function formatDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const parsed = new Date(`${text}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return text;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((parsed - today) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return parsed.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// Every mutation goes through here: change local state, queue the write,
// re-render immediately, then drain in the background.
function mutate(apply, change) {
  apply();
  if (change) enqueue(state, change);
  persist();
  render();
  void sync.flush();
}

// --- rendering -----------------------------------------------------------

function renderStatus(status = null) {
  const banner = dom.statusBanner;
  if (!banner) return;
  if (status?.kind === 'ok') serverReachable = true;
  if (status?.kind === 'unreachable') serverReachable = false;
  const queued = pendingCount(state);

  if (status?.kind === 'blocked') {
    banner.textContent = `Sync blocked — ${status.message}. Your changes are saved on this device.`;
    banner.className = 'status-banner error';
    return;
  }
  if (!isOnline()) {
    banner.textContent = queued
      ? `Offline — ${queued} change${queued === 1 ? '' : 's'} saved on this device.`
      : 'Offline — your lists still work.';
    banner.className = 'status-banner warn';
    return;
  }
  if (!serverReachable) {
    banner.textContent = queued
      ? `Can't reach the server — ${queued} change${queued === 1 ? '' : 's'} saved on this device.`
      : "Can't reach the server — showing your saved lists.";
    banner.className = 'status-banner warn';
    return;
  }
  if (queued) {
    banner.textContent = `Syncing ${queued} change${queued === 1 ? '' : 's'}…`;
    banner.className = 'status-banner';
    return;
  }
  banner.className = 'status-banner hidden';
}

function renderLists() {
  const container = dom.listsContainer;
  if (!container) return;
  container.replaceChildren();

  const filter = state.ui.filter ?? 'open';
  for (const chip of document.querySelectorAll('.chip[data-filter]')) {
    chip.classList.toggle('active', chip.dataset.filter === filter);
    chip.setAttribute('aria-selected', String(chip.dataset.filter === filter));
  }

  const lists = getVisibleLists(state, filter);
  if (!lists.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = filter === 'done'
      ? 'No completed lists yet.'
      : 'No lists yet. Tap ＋ to start one.';
    container.appendChild(empty);
    // An empty app when the account has other workspaces almost always means
    // the lists are in one of the others, not that there are none.
    if (filter !== 'done' && (state.workspaces ?? []).length > 1) {
      const hint = document.createElement('p');
      hint.className = 'empty';
      hint.textContent = 'Lists somewhere else? Try “Switch workspace” in the menu.';
      container.appendChild(hint);
    }
    return;
  }

  for (const list of lists) {
    const { total, remaining } = getListProgress(state, list.id);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'list-card';
    card.dataset.listId = list.id;
    if (isListComplete(state, list)) card.classList.add('complete');

    const name = document.createElement('span');
    name.className = 'list-card-name';
    name.textContent = list.name ?? 'Untitled list';
    card.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'list-card-meta';
    const parts = [];
    if (list.store_name) parts.push(list.store_name);
    const dateLabel = formatDate(list.scheduled_for);
    if (dateLabel) parts.push(dateLabel);
    parts.push(total ? `${remaining} of ${total} left` : 'empty');
    meta.textContent = parts.join(' · ');
    card.appendChild(meta);

    if (total) {
      const bar = document.createElement('span');
      bar.className = 'list-card-bar';
      const fill = document.createElement('span');
      fill.style.width = `${Math.round(((total - remaining) / total) * 100)}%`;
      bar.appendChild(fill);
      card.appendChild(bar);
    }

    card.addEventListener('click', () => openList(list.id));
    container.appendChild(card);
  }
}

function renderItemRow(item) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.dataset.itemId = item.id;
  const itemState = normalizeItemState(item.item_state);
  if (isCompletedItemState(itemState)) row.classList.add('done');
  row.dataset.state = itemState;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'item-check';
  check.setAttribute('aria-pressed', String(isCompletedItemState(itemState)));
  check.setAttribute('aria-label', `Mark ${item.name} as bought`);
  check.textContent = itemState === 'unavailable' ? '✕' : '✓';
  check.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleItemBought(item.id);
  });
  row.appendChild(check);

  const main = document.createElement('div');
  main.className = 'item-main';
  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = item.name ?? '';
  main.appendChild(name);
  const note = itemOutcomeLabel(item);
  if (note && itemState !== 'bought') {
    const noteEl = document.createElement('span');
    noteEl.className = 'item-note';
    noteEl.textContent = note;
    main.appendChild(noteEl);
  }
  main.addEventListener('click', () => toggleItemBought(item.id));
  row.appendChild(main);

  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'item-menu';
  menu.setAttribute('aria-label', `Actions for ${item.name}`);
  menu.textContent = '⋯';
  menu.addEventListener('click', (event) => {
    event.stopPropagation();
    openItemSheet(item.id);
  });
  row.appendChild(menu);

  // Only still-to-get items are draggable: reordering something already in the
  // trolley says nothing about where it sits in the shop.
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.setAttribute('aria-hidden', 'true');
  if (isCompletedItemState(itemState)) {
    handle.classList.add('inert');
  } else {
    handle.textContent = '⠿';
    handle.addEventListener('pointerdown', (event) => beginDrag(event, row));
  }
  row.appendChild(handle);

  return row;
}

function renderItemSuggestions(list) {
  if (!dom.itemSuggestions) return;
  const onList = getItemsForList(state, list.id).map((item) => item.name);
  const suggestions = getUsualItems(state, { store: storeKey(list), exclude: onList, limit: 40 });
  dom.itemSuggestions.replaceChildren();
  for (const entry of suggestions) {
    const option = document.createElement('option');
    option.value = entry.name;
    dom.itemSuggestions.appendChild(option);
  }
}

function renderListDetail() {
  const list = getList(state, state.ui.activeListId);
  if (!list) {
    showListsView();
    return;
  }

  const { total, remaining } = getListProgress(state, list.id);
  const needsView = isNeedsList(list);
  dom.title.textContent = list.name ?? 'List';

  const parts = [];
  if (needsView) {
    parts.push(remaining ? `${remaining} waiting` : 'nothing waiting');
    parts.push('add these to a trip when you shop');
  } else {
    if (list.store_name) parts.push(list.store_name);
    const dateLabel = formatDate(list.scheduled_for);
    if (dateLabel) parts.push(dateLabel);
    parts.push(total ? `${remaining} left of ${total}` : 'no items yet');
  }
  dom.subtitle.textContent = parts.join(' · ');

  // The queue is a backlog, not a trip: it is never "completed", and it pulls
  // from nothing. A trip does the opposite.
  dom.completeListButton.classList.toggle('hidden', needsView);
  dom.needsPullButton.classList.toggle('hidden', needsView || !getNeedsItems(state).length);
  renderDueStrip(list);

  const container = dom.itemsContainer;
  container.replaceChildren();
  const items = getItemsForList(state, list.id);
  const { pending, done } = groupItemsByProgress(items, state.tickOrder);

  // Still-to-get always sits at the top. Ticked items drop out of the way into
  // their own group, so the list you are working from keeps shrinking towards
  // your thumb instead of you scrolling past everything already in the trolley.
  for (const item of pending) {
    container.appendChild(renderItemRow(item));
  }

  if (done.length && !state.ui.hideCompletedItems) {
    const collapsed = Boolean(state.ui.collapseDone);
    const divider = document.createElement('button');
    divider.type = 'button';
    divider.className = 'done-divider';
    divider.id = 'done-divider';
    divider.setAttribute('aria-expanded', String(!collapsed));
    divider.textContent = `${collapsed ? '▸' : '▾'} In the trolley (${done.length})`;
    divider.addEventListener('click', () => {
      state.ui.collapseDone = !state.ui.collapseDone;
      persist();
      render();
    });
    container.appendChild(divider);

    if (!collapsed) {
      for (const item of done) {
        container.appendChild(renderItemRow(item));
      }
    }
  }

  const nothingToShow = !pending.length && (!done.length || state.ui.hideCompletedItems);
  dom.listEmpty.classList.toggle('hidden', !nothingToShow);
  dom.listEmpty.textContent = items.length ? 'Everything here is done.' : 'Nothing on this list yet.';
  dom.completeListButton.textContent = list.archived ? 'Reopen list' : 'Complete list';
  renderItemSuggestions(list);
}

function render() {
  const inListView = Boolean(state.ui.activeListId && getList(state, state.ui.activeListId));
  dom.listsView.classList.toggle('hidden', inListView);
  dom.listView.classList.toggle('hidden', !inListView);
  dom.backButton.classList.toggle('hidden', !inListView);
  dom.menuEditList.classList.toggle('hidden', !inListView);
  dom.menuDeleteList.classList.toggle('hidden', !inListView);
  dom.menuToggleCompleted.textContent = state.ui.hideCompletedItems
    ? 'Show bought items'
    : 'Hide bought items';
  dom.menuWorkspace.classList.toggle('hidden', (state.workspaces ?? []).length < 2);

  if (inListView) {
    renderListDetail();
  } else {
    dom.title.textContent = 'Shopping';
    const open = getVisibleLists(state, 'open').length;
    dom.subtitle.textContent = open ? `${open} open list${open === 1 ? '' : 's'}` : 'No open lists';
    renderLists();
    renderNeedsCard();
  }
  renderStoreSuggestions();
  renderStatus();
}

function renderStoreSuggestions() {
  if (!dom.storeSuggestions) return;
  const stores = [...new Set(
    (state.lists ?? [])
      .map((list) => String(list.store_name ?? '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
  dom.storeSuggestions.replaceChildren();
  for (const store of stores) {
    const option = document.createElement('option');
    option.value = store;
    dom.storeSuggestions.appendChild(option);
  }
}

// --- the needs queue -----------------------------------------------------

function isNeedsList(list) {
  const needs = findNeedsList(state);
  return Boolean(list && needs && list.id === needs.id);
}

// The queue is a real list on the server, so it syncs and works offline like
// everything else. Created on first use, then remembered by id.
function ensureNeedsList() {
  const existing = findNeedsList(state);
  if (existing) {
    if (state.needsListId !== existing.id) {
      state.needsListId = existing.id;
      persist();
    }
    return existing;
  }
  const id = createUuid();
  const now = new Date().toISOString();
  const list = {
    id,
    workspace_id: state.workspaceId,
    name: NEEDS_LIST_NAME,
    store_name: null,
    scheduled_for: null,
    archived: 0,
    created_at: now,
    updated_at: now
  };
  mutate(() => {
    upsertList(state, list);
    state.needsListId = id;
  }, {
    entity_type: 'shopping_list',
    entity_id: id,
    action: 'create',
    payload: list
  });
  return getList(state, id);
}

function openNeeds() {
  const list = ensureNeedsList();
  if (!list) return;
  state.ui.activeListId = list.id;
  persist();
  render();
  dom.addItemInput?.focus();
}

function renderNeedsCard() {
  const items = getNeedsItems(state);
  const due = getDueItems(state, { exclude: items.map((item) => item.name), limit: 5 });
  const parts = [];
  parts.push(items.length ? `${items.length} waiting` : 'nothing waiting');
  if (due.length) parts.push(`${due.length} due`);
  dom.needsCardMeta.textContent = parts.join(' · ');
}

// Move things from the queue onto the trip: added fresh so they land in the
// learned aisle position, and removed from the queue so it stays a backlog.
function pullNeedsOntoTrip(needsItemIds) {
  const list = getList(state, state.ui.activeListId);
  if (!list || !needsItemIds.length) return;
  const names = needsItemIds
    .map((id) => state.items?.[id]?.name)
    .filter(Boolean);
  if (!names.length) return;

  for (const id of needsItemIds) {
    const item = state.items?.[id];
    if (!item) continue;
    removeItem(state, id);
    enqueue(state, {
      entity_type: 'shopping_item',
      entity_id: id,
      action: 'delete',
      payload: { list_id: item.list_id }
    });
  }
  persist();
  addItems(names);
}

const needsSelection = new Set();

function renderNeedsSheet() {
  const list = getList(state, state.ui.activeListId);
  if (!list) return;
  const store = storeKey(list);
  const onList = new Set(
    getItemsForList(state, list.id).map((item) => canonicalKey(item.name))
  );
  const candidates = getNeedsForStore(state, store)
    .filter((item) => !onList.has(canonicalKey(item.name)));

  dom.needsSheetNote.textContent = store
    ? `Things that can be bought at ${list.store_name}.`
    : 'Set a store on this list to also see things only that store stocks.';
  dom.needsSheetList.replaceChildren();
  dom.needsSheetEmpty.classList.toggle('hidden', candidates.length > 0);

  for (const item of candidates) {
    const row = document.createElement('div');
    row.className = 'usual-row';

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'usual-pick';
    if (needsSelection.has(item.id)) pick.classList.add('selected');
    pick.setAttribute('aria-pressed', String(needsSelection.has(item.id)));

    const name = document.createElement('span');
    name.className = 'usual-name';
    name.textContent = item.name;
    pick.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'usual-meta';
    const stores = getItemStores(state, item.name);
    meta.textContent = stores.length ? 'only here' : '';
    pick.appendChild(meta);

    pick.addEventListener('click', () => {
      if (needsSelection.has(item.id)) needsSelection.delete(item.id);
      else needsSelection.add(item.id);
      pick.classList.toggle('selected');
      pick.setAttribute('aria-pressed', String(needsSelection.has(item.id)));
      dom.needsSheetAdd.textContent = needsSelection.size ? `Add ${needsSelection.size}` : 'Add selected';
      dom.needsSheetAdd.disabled = needsSelection.size === 0;
    });
    row.appendChild(pick);
    dom.needsSheetList.appendChild(row);
  }

  dom.needsSheetAdd.textContent = needsSelection.size ? `Add ${needsSelection.size}` : 'Add selected';
  dom.needsSheetAdd.disabled = needsSelection.size === 0;
}

function openNeedsSheet() {
  needsSelection.clear();
  renderNeedsSheet();
  openSheet(dom.needsSheet);
}

// --- what you are due for ------------------------------------------------

let dueStripNames = [];

function renderDueStrip(list) {
  const onList = getItemsForList(state, list.id).map((item) => item.name);
  const store = isNeedsList(list) ? null : storeKey(list);
  const due = getDueItems(state, { store, exclude: onList, limit: 4 });

  if (!due.length) {
    dom.dueStrip.classList.add('hidden');
    dueStripNames = [];
    return;
  }
  dueStripNames = due.map((entry) => entry.name);
  const label = due
    .map((entry) => (entry.dueInDays < 0 ? `${entry.name} (${Math.abs(entry.dueInDays)}d over)` : entry.name))
    .join(', ');
  dom.dueStripText.textContent = `Probably due: ${label}`;
  dom.dueStrip.classList.remove('hidden');
}

// --- navigation ----------------------------------------------------------

function openList(listId) {
  state.ui.activeListId = listId;
  persist();
  render();
  dom.addItemInput?.focus();
}

function showListsView() {
  state.ui.activeListId = null;
  persist();
  render();
}

// --- list actions --------------------------------------------------------

function openListEditor(mode) {
  listEditorMode = mode;
  const list = mode === 'edit' ? getList(state, state.ui.activeListId) : null;
  dom.listEditorTitle.textContent = mode === 'edit' ? 'List details' : 'New list';
  dom.listEditorName.value = list?.name ?? '';
  // A new list defaults to the last store used. The store name is the key the
  // aisle order is learned against, so a blank one silently disables learning.
  dom.listEditorStore.value = list?.store_name ?? (mode === 'create' ? state.lastStoreName ?? '' : '');
  dom.listEditorDate.value = list?.scheduled_for ?? '';
  openSheet(dom.listEditor);
  dom.listEditorName.focus();
}

function submitListEditor(event) {
  event.preventDefault();
  const name = dom.listEditorName.value.trim();
  if (!name) return;
  const storeName = dom.listEditorStore.value.trim() || null;
  const scheduledFor = dom.listEditorDate.value || null;

  if (listEditorMode === 'create') {
    const id = createUuid();
    const now = new Date().toISOString();
    const list = {
      id,
      workspace_id: state.workspaceId,
      name,
      store_name: storeName,
      scheduled_for: scheduledFor,
      archived: 0,
      created_at: now,
      updated_at: now
    };
    mutate(() => {
      upsertList(state, list);
      state.ui.activeListId = id;
      if (storeName) state.lastStoreName = storeName;
    }, {
      entity_type: 'shopping_list',
      entity_id: id,
      action: 'create',
      payload: list
    });
  } else {
    const list = getList(state, state.ui.activeListId);
    if (!list) return;
    const patch = { name, store_name: storeName, scheduled_for: scheduledFor };
    if (storeName) state.lastStoreName = storeName;
    mutate(() => upsertList(state, { id: list.id, ...patch }), {
      entity_type: 'shopping_list',
      entity_id: list.id,
      action: 'update',
      payload: patch
    });
  }
  closeSheets();
}

function toggleCompleteList() {
  const list = getList(state, state.ui.activeListId);
  if (!list) return;
  const archived = list.archived ? 0 : 1;
  const learned = archived ? learnOrderFromCheckoff(list) : 0;
  mutate(() => upsertList(state, { id: list.id, archived }), {
    entity_type: 'shopping_list',
    entity_id: list.id,
    action: 'update',
    payload: { archived }
  });
  if (archived && learned) {
    showToast(`List completed · learned the order for ${list.store_name}`);
  } else if (archived && !storeKey(list)) {
    showToast('List completed · set a store to have it learn the order');
  } else {
    showToast(archived ? 'List completed' : 'List reopened');
  }
  if (archived) showListsView();
}

function deleteActiveList() {
  const list = getList(state, state.ui.activeListId);
  if (!list) return;
  if (!confirm(`Delete "${list.name}" and everything on it?`)) return;
  mutate(() => {
    removeList(state, list.id);
    state.ui.activeListId = null;
  }, {
    entity_type: 'shopping_list',
    entity_id: list.id,
    action: 'delete',
    payload: {}
  });
  showToast('List deleted');
}

// --- item actions --------------------------------------------------------

function addItemsFromInput(event) {
  event?.preventDefault();
  const names = parseItemNames(dom.addItemInput.value);
  if (!addItems(names)) return;
  dom.addItemInput.value = '';
  dom.addItemInput.focus();
}

function addItems(rawNames) {
  const list = getList(state, state.ui.activeListId);
  if (!list || !rawNames.length) return false;

  // Anything you have bought before comes in under the spelling you normally
  // use, so the same item does not end up as three different entries — and,
  // just as importantly, does not train three different aisle positions.
  const { names: standardized, changes } = standardizeNames(state, rawNames);
  const existing = getItemsForList(state, list.id);

  // Anything still to get on this list is not worth adding twice. Items already
  // ticked off are fair game — asking for them again means you want more.
  const alreadyWanted = new Set(
    existing
      .filter((item) => !isCompletedItemState(item.item_state))
      .map((item) => canonicalKey(item.name))
      .filter(Boolean)
  );
  const names = standardized.filter((name) => !alreadyWanted.has(canonicalKey(name)));
  const skipped = standardized.length - names.length;
  if (!names.length) {
    showToast(skipped === 1 ? 'Already on this list' : 'Already on this list');
    return false;
  }
  // Optimistic placement is end-of-list; the server may slot each item into its
  // learned aisle position and the corrected order arrives with the sync.
  let nextOrder = existing.reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), 0);
  const now = new Date().toISOString();

  const store = storeKey(list);
  for (const name of names) {
    nextOrder += 100;
    const id = createUuid();
    recordCatalogueUse(state, name, store, now);
    upsertItem(state, {
      id,
      list_id: list.id,
      name,
      item_state: 'pending',
      substitute_name: null,
      is_checked: 0,
      sort_order: nextOrder,
      created_at: now,
      updated_at: now
    });
    enqueue(state, {
      entity_type: 'shopping_item',
      entity_id: id,
      action: 'create',
      payload: { list_id: list.id, name }
    });
  }
  persist();
  render();
  void sync.flush();

  const skippedNote = skipped ? ` · ${skipped} already on the list` : '';
  if (changes.length === 1 && names.length === 1) {
    showToast(`Added as "${names[0]}"${skippedNote}`);
  } else if (changes.length) {
    showToast(`Added ${names.length} · ${changes.length} matched your usual names${skippedNote}`);
  } else if (names.length > 1 || skipped) {
    showToast(`Added ${names.length} item${names.length === 1 ? '' : 's'}${skippedNote}`);
  }
  return true;
}

function setItemState(itemId, nextState, substituteName = null) {
  const item = state.items?.[itemId];
  if (!item) return;
  const patch = { item_state: nextState };
  if (nextState === 'substituted') {
    patch.substitute_name = substituteName;
  } else if (item.substitute_name) {
    patch.substitute_name = null;
  }
  mutate(() => {
    // Remember when it was ticked; that sequence becomes the aisle order when
    // the list is completed.
    if (nextState === 'pending') {
      clearTick(state, itemId);
    } else {
      recordTick(state, itemId);
      // Ticking something off is the purchase event the frequency estimate is
      // built from. Substituted counts — you still bought the thing.
      if (nextState !== 'unavailable') recordPurchase(state, item.name);
    }
    upsertItem(state, {
      id: itemId,
      ...patch,
      is_checked: nextState === 'pending' ? 0 : 1
    });
  }, {
    entity_type: 'shopping_item',
    entity_id: itemId,
    action: 'update',
    payload: patch
  });
}

function toggleItemBought(itemId) {
  const item = state.items?.[itemId];
  if (!item) return;
  const done = isCompletedItemState(item.item_state);
  setItemState(itemId, done ? 'pending' : 'bought');
}

// Teach the server the aisle order from the order the items were actually
// ticked off. This is what makes the app learn without anyone dragging
// anything: walking the shop once is the training signal.
//
// Patching sort_order is what triggers the server's per-store hint learning, so
// this only does anything for a list that has a store name — which is why a new
// list defaults to the last store used.
function learnOrderFromCheckoff(list) {
  if (!list || !storeKey(list)) return 0;
  const items = getItemsForList(state, list.id);
  const { patches } = computeCheckoffOrder(items, state.tickOrder);
  if (!patches.length) return 0;
  for (const patch of patches) {
    upsertItem(state, { id: patch.id, sort_order: patch.sort_order });
    enqueue(state, {
      entity_type: 'shopping_item',
      entity_id: patch.id,
      action: 'update',
      payload: { sort_order: patch.sort_order }
    });
  }
  return patches.length;
}

function renameItem(itemId, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return;
  mutate(() => upsertItem(state, { id: itemId, name: trimmed }), {
    entity_type: 'shopping_item',
    entity_id: itemId,
    action: 'update',
    payload: { name: trimmed }
  });
}

function moveItem(itemId, targetListId) {
  const item = state.items?.[itemId];
  if (!item || !targetListId || targetListId === item.list_id) return;
  mutate(() => upsertItem(state, { id: itemId, list_id: targetListId }), {
    entity_type: 'shopping_item',
    entity_id: itemId,
    action: 'update',
    payload: { list_id: targetListId }
  });
  showToast('Item moved');
}

function deleteItem(itemId) {
  const item = state.items?.[itemId];
  if (!item) return;
  mutate(() => removeItem(state, itemId), {
    entity_type: 'shopping_item',
    entity_id: itemId,
    action: 'delete',
    payload: { list_id: item.list_id }
  });
  showToast('Item deleted');
}

function applyReorder(movedId, targetIndex) {
  const list = getList(state, state.ui.activeListId);
  if (!list) return;
  // Reorder within the still-to-get items; the done group is not part of the
  // arrangement the user is expressing.
  const { pending } = groupItemsByProgress(getItemsForList(state, list.id), state.tickOrder);
  const { patches } = computeReorder(pending, movedId, targetIndex);
  if (!patches.length) {
    render();
    return;
  }
  for (const patch of patches) {
    upsertItem(state, { id: patch.id, sort_order: patch.sort_order });
    enqueue(state, {
      entity_type: 'shopping_item',
      entity_id: patch.id,
      action: 'update',
      payload: { sort_order: patch.sort_order }
    });
  }
  persist();
  render();
  void sync.flush();
}

// --- drag to reorder -----------------------------------------------------

let drag = null;

function beginDrag(event, row) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  drag = {
    id: row.dataset.itemId,
    row,
    pointerId: event.pointerId,
    startY: event.clientY
  };
  row.classList.add('dragging');
  try {
    row.setPointerCapture?.(event.pointerId);
  } catch {
    // Pointer capture is an optimisation, not a requirement.
  }
  row.addEventListener('pointermove', onDragMove);
  row.addEventListener('pointerup', endDrag);
  row.addEventListener('pointercancel', endDrag);
}

function onDragMove(event) {
  if (!drag) return;
  event.preventDefault();
  const container = dom.itemsContainer;
  const y = event.clientY;
  drag.row.style.transform = `translateY(${y - drag.startY}px)`;

  // Swap with whichever neighbour the pointer has moved past, then rebase the
  // drag offset so the row snaps back under the finger in its new slot.
  const previous = drag.row.previousElementSibling;
  const next = drag.row.nextElementSibling;

  if (previous) {
    const rect = previous.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) {
      container.insertBefore(drag.row, previous);
      drag.startY = y;
      drag.row.style.transform = '';
      return;
    }
  }
  if (next) {
    const rect = next.getBoundingClientRect();
    if (y > rect.top + rect.height / 2) {
      container.insertBefore(drag.row, next.nextSibling);
      drag.startY = y;
      drag.row.style.transform = '';
    }
  }
}

function endDrag() {
  if (!drag) return;
  const { row, id } = drag;
  row.classList.remove('dragging');
  row.style.transform = '';
  row.removeEventListener('pointermove', onDragMove);
  row.removeEventListener('pointerup', endDrag);
  row.removeEventListener('pointercancel', endDrag);
  // Index among the pending rows only — the done group sits below a divider and
  // must not shift what the drop position means.
  const rows = [...dom.itemsContainer.querySelectorAll('.item-row')]
    .filter((entry) => !entry.classList.contains('done'));
  const targetIndex = rows.findIndex((entry) => entry.dataset.itemId === id);
  drag = null;
  if (targetIndex >= 0) applyReorder(id, targetIndex);
}

// --- sheets --------------------------------------------------------------

function openSheet(sheet) {
  closeSheets();
  dom.backdrop.classList.remove('hidden');
  sheet.classList.remove('hidden');
}

function closeSheets() {
  dom.backdrop.classList.add('hidden');
  dom.listEditor.classList.add('hidden');
  dom.itemSheet.classList.add('hidden');
  dom.usualSheet.classList.add('hidden');
  dom.needsSheet.classList.add('hidden');
  dom.tidySheet.classList.add('hidden');
  dom.promptSheet.classList.add('hidden');
  dom.menu.classList.add('hidden');
  dom.menuButton.setAttribute('aria-expanded', 'false');
}

// --- usual items ---------------------------------------------------------

const usualSelection = new Set();

function renderUsualList() {
  const list = getList(state, state.ui.activeListId);
  if (!list) return;
  const onList = getItemsForList(state, list.id).map((item) => item.name);
  const entries = getUsualItems(state, {
    store: storeKey(list),
    exclude: onList,
    query: dom.usualSearch.value
  });

  dom.usualList.replaceChildren();
  dom.usualEmpty.classList.toggle('hidden', entries.length > 0);
  if (!entries.length) {
    dom.usualEmpty.textContent = dom.usualSearch.value.trim()
      ? 'Nothing matches that.'
      : 'Nothing here yet — items you add build this list automatically.';
  }

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'usual-row';

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'usual-pick';
    pick.dataset.name = entry.name;
    if (usualSelection.has(entry.name)) pick.classList.add('selected');
    pick.setAttribute('aria-pressed', String(usualSelection.has(entry.name)));

    const name = document.createElement('span');
    name.className = 'usual-name';
    name.textContent = entry.name;
    pick.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'usual-meta';
    const frequency = estimateFrequency(state, entry.name);
    if (frequency.known && frequency.dueInDays <= 0) {
      meta.textContent = `due · ${frequency.label}`;
      meta.classList.add('due');
    } else if (frequency.known) {
      meta.textContent = `${frequency.label} · in ${frequency.dueInDays}d`;
    } else {
      meta.textContent = entry.atStore ? `${entry.atStore}× here` : `${entry.count}× before`;
    }
    pick.appendChild(meta);

    pick.addEventListener('click', () => {
      if (usualSelection.has(entry.name)) usualSelection.delete(entry.name);
      else usualSelection.add(entry.name);
      pick.classList.toggle('selected');
      pick.setAttribute('aria-pressed', String(usualSelection.has(entry.name)));
      updateUsualAddButton();
    });
    row.appendChild(pick);

    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'usual-forget';
    forget.setAttribute('aria-label', `Stop suggesting ${entry.name}`);
    forget.textContent = '×';
    forget.addEventListener('click', () => {
      usualSelection.delete(entry.name);
      forgetCatalogueEntry(state, entry.name);
      persist();
      renderUsualList();
      updateUsualAddButton();
    });
    row.appendChild(forget);

    dom.usualList.appendChild(row);
  }
}

function updateUsualAddButton() {
  const count = usualSelection.size;
  dom.usualAdd.textContent = count ? `Add ${count}` : 'Add selected';
  dom.usualAdd.disabled = count === 0;
}

function openUsualSheet() {
  usualSelection.clear();
  dom.usualSearch.value = '';
  updateUsualAddButton();
  renderUsualList();
  openSheet(dom.usualSheet);
}

// --- tidying up item names ------------------------------------------------

// Rename every item still sitting on a list whose name canonicalises to one of
// the merged keys. Without this the merge only affects future shops, and the
// list in your hand keeps showing the old spelling.
function renameItemsForKeys(keys, canonicalName) {
  const targetKeys = new Set(keys);
  let renamed = 0;
  for (const item of Object.values(state.items ?? {})) {
    if (!item?.id || item.name === canonicalName) continue;
    if (!targetKeys.has(canonicalKey(item.name))) continue;
    upsertItem(state, { id: item.id, name: canonicalName });
    enqueue(state, {
      entity_type: 'shopping_item',
      entity_id: item.id,
      action: 'update',
      payload: { name: canonicalName }
    });
    renamed += 1;
  }
  return renamed;
}

function applyNameMerge(group, canonicalName) {
  const name = String(canonicalName ?? '').trim();
  if (!name) return;
  const keys = [...group.keys];
  mergeCatalogueEntries(state, keys, name);
  const renamed = renameItemsForKeys(keys, name);
  persist();
  render();
  renderTidyList();
  void sync.flush();
  showToast(renamed ? `Merged as "${name}" · renamed ${renamed}` : `Merged as "${name}"`);
}

function renderTidyList() {
  const groups = findNameCleanups(state);
  dom.tidyList.replaceChildren();
  dom.tidyEmpty.classList.toggle('hidden', groups.length > 0);

  for (const group of groups) {
    const card = document.createElement('div');
    card.className = 'tidy-group';

    const variants = document.createElement('div');
    variants.className = 'tidy-variants';
    variants.textContent = group.entries
      .map((entry) => `${entry.name} (${entry.count}×)`)
      .join('  ·  ');
    card.appendChild(variants);

    const row = document.createElement('div');
    row.className = 'tidy-row';

    const select = document.createElement('select');
    select.className = 'tidy-select';
    select.setAttribute('aria-label', 'Keep which spelling');
    for (const entry of group.entries) {
      const option = document.createElement('option');
      option.value = entry.name;
      option.textContent = entry.name;
      select.appendChild(option);
    }
    select.value = group.suggestedName;
    row.appendChild(select);

    const merge = document.createElement('button');
    merge.type = 'button';
    merge.className = 'primary-button tidy-merge';
    merge.textContent = 'Merge';
    merge.addEventListener('click', () => applyNameMerge(group, select.value));
    row.appendChild(merge);

    card.appendChild(row);
    dom.tidyList.appendChild(card);
  }
}

function openTidySheet() {
  renderTidyList();
  openSheet(dom.tidySheet);
}

function openItemSheet(itemId) {
  const item = state.items?.[itemId];
  if (!item) return;
  activeItemId = itemId;
  dom.itemSheetTitle.textContent = item.name ?? 'Item';
  openSheet(dom.itemSheet);
}

// A sheet-based replacement for window.prompt, which installed PWAs on iOS
// handle badly. `onSubmit` receives the entered text or selected value.
// `options` renders a select (pick one of these and nothing else).
// `suggestions` renders a text box with a datalist (pick one of these OR type
// something new) — which is what you want for a store you have not shopped yet.
function openPrompt({ title, label, value = '', options = null, suggestions = null, selected = null, onSubmit }) {
  dom.promptTitle.textContent = title;
  dom.promptLabel.textContent = label;
  promptHandler = onSubmit;

  dom.promptSuggestions.replaceChildren();
  if (suggestions) {
    for (const suggestion of suggestions) {
      const option = document.createElement('option');
      option.value = suggestion;
      dom.promptSuggestions.appendChild(option);
    }
    dom.promptInput.setAttribute('list', 'prompt-suggestions');
  } else {
    dom.promptInput.removeAttribute('list');
  }

  if (options) {
    dom.promptInput.classList.add('hidden');
    dom.promptSelect.classList.remove('hidden');
    dom.promptSelect.replaceChildren();
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      dom.promptSelect.appendChild(node);
    }
    if (selected !== null) dom.promptSelect.value = selected;
    dom.promptLabel.setAttribute('for', 'prompt-select');
  } else {
    dom.promptSelect.classList.add('hidden');
    dom.promptInput.classList.remove('hidden');
    dom.promptInput.value = value;
    dom.promptLabel.setAttribute('for', 'prompt-input');
  }

  openSheet(dom.promptSheet);
  (options ? dom.promptSelect : dom.promptInput).focus();
}

function submitPrompt(event) {
  event.preventDefault();
  const usingSelect = !dom.promptSelect.classList.contains('hidden');
  const value = usingSelect ? dom.promptSelect.value : dom.promptInput.value;
  const handler = promptHandler;
  promptHandler = null;
  closeSheets();
  if (handler) handler(value);
}

// --- auth + boot ---------------------------------------------------------

function showAuthGate(show) {
  dom.authGate.classList.toggle('hidden', !show);
  dom.listsView.classList.toggle('hidden', show);
  dom.listView.classList.add('hidden');
  if (show) dom.authEmail.focus();
}

async function submitLogin(event) {
  event.preventDefault();
  dom.authError.classList.add('hidden');
  try {
    const result = await api.login(dom.authEmail.value.trim(), dom.authPassword.value);
    dom.authPassword.value = '';
    showAuthGate(false);
    await adoptSession(result);
  } catch (error) {
    dom.authError.textContent = error?.status === 401
      ? 'Wrong email or password.'
      : (error?.message ?? 'Sign in failed.');
    dom.authError.classList.remove('hidden');
  }
}

async function resolveWorkspace(session) {
  let workspaces = Array.isArray(session?.workspaces) ? session.workspaces : [];
  if (!workspaces.length) {
    try {
      workspaces = await api.listWorkspaces();
    } catch {
      workspaces = [];
    }
  }
  if (!Array.isArray(workspaces) || !workspaces.length) return null;
  // Remembered so the menu can offer a switch without another round trip.
  state.workspaces = workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name }));
  const stored = workspaces.find((workspace) => workspace.id === state.workspaceId);
  return stored ?? workspaces[0];
}

// An account with more than one workspace lands on whichever came first, which
// is a dead end if the lists live in another one. Let it be changed.
async function switchWorkspace(workspaceId) {
  const target = (state.workspaces ?? []).find((workspace) => workspace.id === workspaceId);
  if (!target || target.id === state.workspaceId) return;

  await sync.flush();
  if (pendingCount(state)) {
    showToast('Finish syncing before switching workspace');
    return;
  }

  state.workspaceId = target.id;
  state.lists = [];
  state.items = {};
  state.cursor = 0;
  state.needsListId = null;
  state.ui.activeListId = null;
  persist();
  render();
  try {
    await sync.hydrate();
    showToast(`Switched to ${target.name}`);
  } catch {
    showToast('Could not load that workspace');
  }
}

async function adoptSession(session) {
  const workspace = await resolveWorkspace(session);
  if (!workspace) {
    dom.subtitle.textContent = 'No workspace available';
    return;
  }
  if (workspace.id !== state.workspaceId) {
    // Different workspace than the cached snapshot: start clean.
    state.workspaceId = workspace.id;
    state.lists = [];
    state.items = {};
    state.cursor = 0;
    state.ui.activeListId = null;
  }
  persist();
  render();
  await sync.flush();
  try {
    await sync.hydrate();
    renderStatus({ kind: 'ok' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showAuthGate(true);
      return;
    }
    renderStatus({ kind: 'unreachable' });
    showToast('Could not refresh from the server — showing your saved lists.');
  }
  startPolling();
}

async function boot() {
  render();
  registerServiceWorker();

  let session = null;
  try {
    session = await api.me();
  } catch {
    // Offline boot is a first-class path: keep serving the cached snapshot and
    // retry in the background rather than showing an error page.
    renderStatus({ kind: 'unreachable' });
    if (!state.workspaceId) {
      dom.subtitle.textContent = 'Offline — no cached lists yet';
    }
    startPolling();
    return;
  }

  if (!session?.authenticated && session?.require_auth) {
    showAuthGate(true);
    return;
  }
  showAuthGate(false);
  await adoptSession(session);
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (document.hidden || !isOnline()) return;
    try {
      // A boot that started with no server never resolved a workspace; pick the
      // session up here once the server comes back.
      if (!state.workspaceId) {
        const session = await api.me();
        if (!session?.authenticated && session?.require_auth) {
          showAuthGate(true);
          return;
        }
        await adoptSession(session);
        return;
      }
      await sync.flush();
      await sync.pull();
      renderStatus({ kind: 'ok' });
    } catch {
      renderStatus({ kind: 'unreachable' });
    }
  }, shoppingConfig.syncPollIntervalMs);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('/apps/shopping/sw.js', { scope: '/apps/shopping/' })
    .catch(() => {
      // An unavailable service worker only costs offline shell caching.
    });
}

// --- wiring --------------------------------------------------------------

dom.backButton.addEventListener('click', showListsView);
dom.newListButton.addEventListener('click', () => openListEditor('create'));
dom.listEditorForm.addEventListener('submit', submitListEditor);
dom.listEditorCancel.addEventListener('click', closeSheets);
dom.addItemForm.addEventListener('submit', addItemsFromInput);

dom.needsCard.addEventListener('click', openNeeds);
dom.needsPullButton.addEventListener('click', openNeedsSheet);
dom.needsSheetCancel.addEventListener('click', closeSheets);
dom.needsSheetAdd.addEventListener('click', () => {
  const ids = [...needsSelection];
  needsSelection.clear();
  closeSheets();
  pullNeedsOntoTrip(ids);
});
dom.dueStripAdd.addEventListener('click', () => {
  const names = [...dueStripNames];
  if (names.length) addItems(names);
});

dom.usualItemsButton.addEventListener('click', openUsualSheet);
dom.usualCancel.addEventListener('click', closeSheets);
dom.usualSearch.addEventListener('input', renderUsualList);
dom.usualAdd.addEventListener('click', () => {
  const names = [...usualSelection];
  usualSelection.clear();
  closeSheets();
  addItems(names);
});

// A single-line <input> silently strips newlines out of pasted text, so a
// pasted list would collapse into one item. Take the raw clipboard text first.
dom.addItemInput.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text') ?? '';
  if (!/[\n\r]/.test(text)) return;
  event.preventDefault();
  if (addItems(parseItemNames(text))) {
    dom.addItemInput.value = '';
  }
});
dom.completeListButton.addEventListener('click', toggleCompleteList);
dom.authForm.addEventListener('submit', submitLogin);
dom.promptForm.addEventListener('submit', submitPrompt);
dom.promptCancel.addEventListener('click', () => {
  promptHandler = null;
  closeSheets();
});
dom.backdrop.addEventListener('click', () => {
  promptHandler = null;
  closeSheets();
});

for (const chip of document.querySelectorAll('.chip[data-filter]')) {
  chip.addEventListener('click', () => {
    state.ui.filter = chip.dataset.filter;
    persist();
    render();
  });
}

dom.menuButton.addEventListener('click', (event) => {
  event.stopPropagation();
  const willShow = dom.menu.classList.contains('hidden');
  closeSheets();
  dom.menu.classList.toggle('hidden', !willShow);
  dom.menuButton.setAttribute('aria-expanded', String(willShow));
});

document.addEventListener('click', (event) => {
  if (!dom.menu.classList.contains('hidden') && !dom.menu.contains(event.target)) {
    dom.menu.classList.add('hidden');
    dom.menuButton.setAttribute('aria-expanded', 'false');
  }
});

dom.menuRefresh.addEventListener('click', async () => {
  closeSheets();
  clearRetryBackoff();
  try {
    await sync.flush();
    await sync.hydrate();
    showToast('Refreshed');
  } catch {
    showToast('Refresh failed — still offline?');
  }
});

dom.menuToggleCompleted.addEventListener('click', () => {
  state.ui.hideCompletedItems = !state.ui.hideCompletedItems;
  closeSheets();
  persist();
  render();
});

dom.menuTidyNames.addEventListener('click', openTidySheet);

dom.menuWorkspace.addEventListener('click', () => {
  const workspaces = state.workspaces ?? [];
  closeSheets();
  if (workspaces.length < 2) return;
  openPrompt({
    title: 'Switch workspace',
    label: 'Show lists from',
    options: workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
    selected: state.workspaceId,
    onSubmit: (value) => { void switchWorkspace(value); }
  });
});
dom.tidyClose.addEventListener('click', closeSheets);

dom.menuEditList.addEventListener('click', () => openListEditor('edit'));
dom.menuDeleteList.addEventListener('click', () => {
  closeSheets();
  deleteActiveList();
});

dom.menuLogout.addEventListener('click', async () => {
  closeSheets();
  try {
    await api.logout();
  } catch {
    // Signing out locally is still the right outcome.
  }
  clearInterval(pollTimer);
  showAuthGate(true);
});

el('item-action-bought').addEventListener('click', () => {
  closeSheets();
  setItemState(activeItemId, 'bought');
});
el('item-action-unavailable').addEventListener('click', () => {
  closeSheets();
  setItemState(activeItemId, 'unavailable');
});
el('item-action-pending').addEventListener('click', () => {
  closeSheets();
  setItemState(activeItemId, 'pending');
});
el('item-action-substituted').addEventListener('click', () => {
  const itemId = activeItemId;
  const item = state.items?.[itemId];
  closeSheets();
  openPrompt({
    title: 'Substituted with',
    label: 'What did you get instead?',
    value: item?.substitute_name ?? '',
    onSubmit: (value) => {
      const substitute = String(value ?? '').trim();
      // The API rejects a substituted item without a substitute name.
      if (!substitute) {
        showToast('Substitute name required');
        return;
      }
      setItemState(itemId, 'substituted', substitute);
    }
  });
});
el('item-action-rename').addEventListener('click', () => {
  const itemId = activeItemId;
  const item = state.items?.[itemId];
  closeSheets();
  openPrompt({
    title: 'Rename item',
    label: 'Item name',
    value: item?.name ?? '',
    onSubmit: (value) => renameItem(itemId, value)
  });
});
function getKnownStores() {
  const stores = new Map();
  for (const list of state.lists ?? []) {
    const name = String(list.store_name ?? '').trim();
    if (name) stores.set(name.toLowerCase(), name);
  }
  for (const entry of Object.values(state.catalogue ?? {})) {
    for (const key of entry.onlyAt ?? []) {
      if (!stores.has(key)) stores.set(key, key);
    }
  }
  return [...stores.entries()].map(([key, label]) => ({ key, label }));
}

el('item-action-stores').addEventListener('click', () => {
  const itemId = activeItemId;
  const item = state.items?.[itemId];
  closeSheets();
  if (!item) return;
  const current = getItemStores(state, item.name);
  const known = getKnownStores();
  openPrompt({
    title: `Where to buy ${item.name}`,
    label: 'Only at this store — leave blank if you can get it anywhere',
    value: known.find((store) => store.key === current[0])?.label ?? current[0] ?? '',
    // A store you have not shopped yet can be typed in; the queue is exactly
    // where you note "only at Bunnings" before there is any Bunnings list.
    suggestions: known.map((store) => store.label),
    onSubmit: (value) => {
      const store = String(value ?? '').trim();
      setItemStores(state, item.name, store ? [store.toLowerCase()] : []);
      persist();
      render();
      showToast(store ? `${item.name}: only at ${store}` : `${item.name}: available anywhere`);
    }
  });
});

el('item-action-move').addEventListener('click', () => {
  const itemId = activeItemId;
  const item = state.items?.[itemId];
  closeSheets();
  const options = (state.lists ?? [])
    .filter((list) => list.id !== item?.list_id && !list.archived)
    .map((list) => ({ value: list.id, label: list.name ?? 'Untitled list' }));
  if (!options.length) {
    showToast('No other list to move it to');
    return;
  }
  openPrompt({
    title: 'Move item',
    label: 'Move to',
    options,
    onSubmit: (value) => moveItem(itemId, value)
  });
});
el('item-action-delete').addEventListener('click', () => {
  const itemId = activeItemId;
  closeSheets();
  deleteItem(itemId);
});
el('item-action-cancel').addEventListener('click', closeSheets);

// "The network came back" and "the user opened the app" are both better signals
// than a backoff timer, so retry immediately instead of waiting one out.
function clearRetryBackoff() {
  let changed = false;
  for (const change of state.pending ?? []) {
    if (change.needs_attention) continue;
    if (change.next_retry_at || change.retry_count) {
      change.next_retry_at = null;
      change.retry_count = 0;
      changed = true;
    }
  }
  if (changed) persist();
}

window.addEventListener('online', () => {
  clearRetryBackoff();
  renderStatus();
  void sync.flush();
});
window.addEventListener('offline', () => renderStatus());

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !isOnline()) return;
  clearRetryBackoff();
  void sync.flush().then(() => sync.pull()).catch(() => {});
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  dom.installButton.classList.remove('hidden');
});

dom.installButton.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  dom.installButton.classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  dom.installButton.classList.add('hidden');
});

boot();
