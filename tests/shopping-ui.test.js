import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readRepoFile(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

test('shopping list modal captures a title and scheduled date', () => {
  const html = readRepoFile('apps/web/index.html');
  assert.match(html, /id="shopping-list-name"/);
  assert.match(html, /id="shopping-list-date"/);
  assert.match(html, /\bTitle\b/);
  assert.match(html, /\bDate\b/);
});

test('shopping list creation persists scheduled_for metadata', () => {
  const script = readRepoFile('apps/web/app.js');
  assert.match(script, /normalizeShoppingListDateValue/);
  assert.match(script, /scheduled_for: dateValue \|\| null/);
  assert.match(script, /formatShoppingListScheduledForLabel/);
});

test('task editor exposes shopping conversion controls backed by the conversion API', () => {
  const html = readRepoFile('apps/web/index.html');
  const script = readRepoFile('apps/web/app.js');
  assert.match(html, /id="editor-shopping-list"/);
  assert.match(html, /id="editor-convert-shopping"/);
  assert.match(script, /const editorShoppingList = document\.getElementById\('editor-shopping-list'\);/);
  assert.match(script, /const editorConvertShopping = document\.getElementById\('editor-convert-shopping'\);/);
  assert.match(script, /populateShoppingListSelect\(editorShoppingList/);
  assert.match(script, /await convertTaskToShoppingItemRecord\(task\.id, targetListId\);/);
  assert.match(script, /api\.convertTaskToShoppingItem\(taskId, \{ list_id: listId \}\)/);
});
