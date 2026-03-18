import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readRepoFile(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

test('task row template includes a dedicated selection star button', () => {
  const html = readRepoFile('apps/web/index.html');
  assert.match(html, /class="task-select-button icon-button"/);
  assert.match(html, /aria-label="Select task"/);
  assert.match(html, />☆<\/button>/);
});

test('task renderer wires the selection star to bulk task selection state', () => {
  const script = readRepoFile('apps/web/app.js');
  assert.match(script, /const selectButton = node\.querySelector\('\.task-select-button'\);/);
  assert.match(script, /selectButton\.textContent = selected \? '★' : '☆';/);
  assert.match(script, /selectButton\.classList\.toggle\('is-active', selected\);/);
  assert.match(script, /setSelectedTaskIds\(\[\.\.\.selectedIds, task\.id\]\);/);
  assert.match(script, /setSelectedTaskIds\(selectedIds\.filter\(id => id !== task\.id\)\);/);
});

test('task selection star has dedicated visual styling', () => {
  const css = readRepoFile('apps/web/styles.css');
  assert.match(css, /\.task-select-button \{/);
  assert.match(css, /\.task-select-button\.is-active \{/);
  assert.match(css, /\.task-item\.is-selected \.task-select-button \{/);
});
