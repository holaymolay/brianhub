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
  assert.ok(html.includes('shopping-item-actions-modal'));
});

test('shopping item first-slice controls exist in app layer', () => {
  const script = read('apps/web/app.js');
  const shoppingDropIndicatorBody = script.match(/function updateShoppingListItemDropIndicator\(row, clientY\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(script.includes('Delete shopping item'));
  assert.ok(script.includes('function confirmDeleteShoppingItem(itemId)'));
  assert.ok(script.includes('function openShoppingItemActionsModal(itemId)'));
  assert.ok(script.includes("moveBtn.textContent = 'Move'"));
  assert.ok(script.includes("dragHandle.textContent = '⋮⋮'"));
  assert.ok(!script.includes("upBtn.textContent = '↑'"));
  assert.ok(!script.includes("downBtn.textContent = '↓'"));
  assert.ok(script.includes('shopping-item-editor-modal'));
  assert.ok(script.includes('shopping-item-actions-edit'));
  assert.ok(script.includes("const SHOPPING_ITEM_MOVE_NEW_VALUE = '__new__';"));
  assert.ok(script.includes("function openShoppingItemEditorModal(itemId, { mode = 'edit' } = {})"));
  assert.ok(script.includes("shoppingItemEditorForm?.addEventListener('submit'"));
  assert.ok(script.includes('createShoppingListRecord({ name: newListName })'));
  assert.ok(script.includes('patch.list_id = targetListId'));
  assert.ok(script.includes('function attachShoppingItemReorderHandlers(row, handle, item)'));
  assert.ok(script.includes('handle.draggable = !isMobileViewport();'));
  assert.ok(script.includes('if (isMobileViewport()) {'));
  assert.ok(script.includes("document.addEventListener('pointermove', handleShoppingItemPointerMove)"));
  assert.ok(script.includes("handle.addEventListener('lostpointercapture'"));
  assert.ok(script.includes('shoppingItemDragPreviewState = {'));
  assert.ok(script.includes("row.style.pointerEvents = 'none';"));
  assert.ok(script.includes('container.insertBefore(draggingRow, referenceNode);'));
  assert.ok(script.includes('function getPreviewOrderedShoppingItems(listId)'));
  assert.ok(!shoppingDropIndicatorBody.includes("row.classList.add('is-drop-target');"));
});

test('shopping item dragging relies on live movement rather than target borders', () => {
  const styles = read('apps/web/styles.css');
  assert.ok(styles.includes('.shopping-item.is-dragging'));
  assert.ok(styles.includes('background: #17263a;'));
  assert.ok(styles.includes('border-color: rgba(132, 173, 255, 0.48);'));
  assert.ok(styles.includes('min-width: 2.6rem;'));
  assert.ok(styles.includes('min-height: 2.6rem;'));
  assert.ok(styles.includes('-webkit-user-drag: none;'));
  assert.ok(!styles.includes('.shopping-item.is-drop-target'));
});

test('shopping item list reassignment is supported in service and schema layers', () => {
  const taskService = read('services/api/src/taskService.js');
  const schemas = read('services/api/src/routeSchemas.js');
  assert.ok(taskService.includes('const { list_id, name, is_checked } = patch;'));
  assert.ok(taskService.includes('let { sort_order } = patch;'));
  assert.ok(taskService.includes('SET list_id = COALESCE(?, list_id),'));
  assert.ok(taskService.includes("'SELECT MAX(sort_order) AS max_sort FROM shopping_list_items WHERE list_id = ?'"));
  assert.ok(taskService.includes('list_id ?? null,'));
  assert.ok(taskService.includes('sort_order ?? null,'));
  assert.ok(schemas.includes("list_id: { type: 'string', format: 'uuid' }"));
});
