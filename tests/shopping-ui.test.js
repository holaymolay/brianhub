import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(relPath) {
  return readFileSync(resolve(process.cwd(), relPath), 'utf8');
}

test('shopping UI retains list and item modal surfaces', () => {
  const html = read('apps/web/index.html');
  assert.ok(html.includes('shopping-list-modal'));
  assert.ok(html.includes('shopping-item-modal'));
  assert.ok(html.includes('shopping-item-form'));
  assert.ok(html.includes('shopping-item-parse'));
  assert.ok(html.includes('shopping-item-editor-outcome'));
  assert.ok(html.includes('shopping-item-editor-substitute'));
  assert.ok(html.includes('shopping-item-actions-modal'));
});

test('shopping item first-slice controls exist in app layer', () => {
  const script = read('apps/web/app.js');
  assert.ok(script.includes('Delete shopping item'));
  assert.ok(script.includes('function confirmDeleteShoppingItem(itemId)'));
  assert.ok(script.includes('function openShoppingItemActionsModal(itemId)'));
  assert.ok(script.includes("moveBtn.textContent = 'Move'"));
  assert.ok(script.includes("dragHandle.textContent = '⋮⋮'"));
  assert.ok(!script.includes("upBtn.textContent = '↑'"));
  assert.ok(!script.includes("downBtn.textContent = '↓'"));
  assert.ok(script.includes('const SHOPPING_ITEM_REORDER_HOLD_MS = 500;'));
  assert.ok(script.includes('shopping-item-editor-modal'));
  assert.ok(script.includes('shopping-item-actions-edit'));
  assert.ok(script.includes("const SHOPPING_ITEM_MOVE_NEW_VALUE = '__new__';"));
  assert.ok(script.includes("const SHOPPING_ITEM_STATE_SUBSTITUTED = 'substituted';"));
  assert.ok(script.includes("const SHOPPING_ITEM_STATE_UNAVAILABLE = 'unavailable';"));
  assert.ok(script.includes('function getShoppingItemOutcomeLabel(item)'));
  assert.ok(script.includes("shoppingItemEditorOutcome?.addEventListener('change', syncShoppingItemEditorOutcomeInputs);"));
  assert.ok(script.includes('patch.item_state = nextItemState'));
  assert.ok(script.includes('patch.substitute_name = nextSubstituteName ?? null;'));
  assert.ok(script.includes("await updateShoppingItemRecord(item.id, { item_state: SHOPPING_ITEM_STATE_BOUGHT });"));
  assert.ok(script.includes("meta.className = 'shopping-item-meta';"));
  assert.ok(script.includes("function openShoppingItemEditorModal(itemId, { mode = 'edit' } = {})"));
  assert.ok(script.includes("shoppingItemEditorForm?.addEventListener('submit'"));
  assert.ok(script.includes('createShoppingListRecord({ name: newListName })'));
  assert.ok(script.includes('patch.list_id = targetListId'));
  assert.ok(script.includes('function attachShoppingItemReorderHandlers(row, handle, item)'));
  assert.ok(script.includes('handle.draggable = !isMobileViewport();'));
  assert.ok(script.includes('function armShoppingItemPointerGesture(clientY) {'));
  assert.ok(script.includes('holdTimerId: window.setTimeout(() => {'));
  assert.ok(script.includes('}, SHOPPING_ITEM_REORDER_HOLD_MS),'));
  assert.ok(script.includes('if (isMobileViewport()) {'));
  assert.ok(script.includes("document.addEventListener('pointermove', handleShoppingItemPointerMove)"));
  assert.ok(!script.includes("handle.addEventListener('lostpointercapture'"));
  assert.ok(script.includes('shoppingItemDragPreviewState = {'));
  assert.ok(script.includes("function createShoppingListItemPlaceholder(row)"));
  assert.ok(script.includes('function captureShoppingListPreviewRects(container)'));
  assert.ok(script.includes('function animateShoppingListPreviewShift(container, beforeRects)'));
  assert.ok(script.includes('pulseShoppingListPlaceholder(placeholder);'));
  assert.ok(script.includes("placeholder.classList.add('shopping-item-drag-placeholder');"));
  assert.ok(script.includes("row.style.position = 'fixed';"));
  assert.ok(script.includes("function moveShoppingListItemPlaceholder(clientY, direction = 0)"));
  assert.ok(script.includes('const hoveredRow = rows.find((candidate) => {'));
  assert.ok(script.includes('const movingUp = direction < 0;'));
  assert.ok(script.includes('referenceNode = insertAfter ? (rows[hoveredIndex + 1] ?? null) : hoveredRow;'));
  assert.ok(script.includes('shoppingItemPointerDragState.lastDirection = Math.sign(incrementalDeltaY);'));
  assert.ok(script.includes('if (deltaX >= SHOPPING_ITEM_DRAG_THRESHOLD_PX || deltaY >= SHOPPING_ITEM_DRAG_THRESHOLD_PX) {'));
  assert.ok(script.includes('cleanupShoppingItemPointerGesture();'));
  assert.ok(script.includes('preview.container.appendChild(preview.placeholderEl);'));
  assert.ok(script.includes('Array.from(previewContainer.children)'));
  assert.ok(script.includes('if (child === preview.placeholderEl) {'));
  assert.ok(script.includes('element.animate('));
  assert.ok(script.includes('function getPreviewOrderedShoppingItems(listId)'));
});

test('shopping item dragging relies on live movement rather than target borders', () => {
  const styles = read('apps/web/styles.css');
  assert.ok(styles.includes('.shopping-item.is-dragging'));
  assert.ok(styles.includes('background: #17263a;'));
  assert.ok(styles.includes('border-color: rgba(132, 173, 255, 0.48);'));
  assert.ok(styles.includes('.shopping-item-drag-placeholder'));
  assert.ok(styles.includes('background: rgba(64, 96, 142, 0.28);'));
  assert.ok(styles.includes('.shopping-item-drag-placeholder.is-snap-target'));
  assert.ok(styles.includes('@keyframes shopping-item-placeholder-snap'));
  assert.ok(styles.includes('min-width: 2.6rem;'));
  assert.ok(styles.includes('min-height: 2.6rem;'));
  assert.ok(styles.includes('-webkit-user-drag: none;'));
});

test('shopping item list reassignment is supported in service and schema layers', () => {
  const taskService = read('services/api/src/taskService.js');
  const schemas = read('services/api/src/routeSchemas.js');
  const migration = read('services/api/db/migrations/026_shopping_item_outcomes_and_order_hints.sql');
  assert.ok(taskService.includes('const outcome = resolveShoppingItemOutcome(existing, patch);'));
  assert.ok(taskService.includes('let { sort_order } = patch;'));
  assert.ok(taskService.includes('SET list_id = COALESCE(?, list_id),'));
  assert.ok(taskService.includes('item_state = ?,'));
  assert.ok(taskService.includes('substitute_name = ?,'));
  assert.ok(taskService.includes('function buildHintAwareShoppingOrder(existingItems, newRecords, hints)'));
  assert.ok(taskService.includes('await learnShoppingItemOrderHints(db, targetList);'));
  assert.ok(taskService.includes("'SELECT MAX(sort_order) AS max_sort FROM shopping_list_items WHERE list_id = ?'"));
  assert.ok(taskService.includes('list_id ?? null,'));
  assert.ok(taskService.includes('sort_order ?? null,'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS shopping_item_order_hints'));
  assert.ok(schemas.includes("list_id: { type: 'string', format: 'uuid' }"));
  assert.ok(schemas.includes("item_state: shoppingItemStateSchema"));
  assert.ok(schemas.includes("substitute_name: nullableString(512)"));
});

test('web app links out to the beta shopping PWA without disturbing its own shopping surface', () => {
  const html = read('apps/web/index.html');
  const css = read('apps/web/styles.css');

  // Both entry points are plain anchors to /shoppinglist — the redirect both the
  // dev server and the production Caddy config already serve.
  assert.match(html, /id="module-nav-shopping-beta"[\s\S]*?href="\/shoppinglist"/);
  assert.match(html, /id="shopping-open-beta"[\s\S]*?href="\/shoppinglist"/);
  assert.ok(html.includes('module-nav-badge'));

  // The module navbar is display:none below the mobile breakpoint, so the link in
  // the shopping panel header is the only way a phone reaches the beta app.
  assert.ok(css.includes('.beta-app-link'));
  assert.ok(css.includes('.module-nav-item-link'));

  // The in-app shopping surface has to keep working until the PWA replaces it.
  for (const id of ['shopping-page', 'shopping-list-items', 'shopping-add-item', 'shopping-complete-btn']) {
    assert.ok(html.includes(`id="${id}"`), `${id} disappeared from the web shopping surface`);
  }
  assert.match(html, /id="mobile-nav-shopping"[\s\S]*?data-view="shopping"/);
});
