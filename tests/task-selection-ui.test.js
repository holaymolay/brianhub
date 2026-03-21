import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readRepoFile(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

test('task row template includes separate bulk-select and importance controls', () => {
  const html = readRepoFile('apps/web/index.html');
  assert.match(html, /class="task-select-toggle"/);
  assert.match(html, /class="task-star-button"/);
  assert.match(html, /aria-label="Select task"/);
  assert.match(html, /aria-label="Mark important"/);
  assert.match(html, />☐<\/button>/);
  assert.match(html, />☆<\/button>/);
});

test('task renderer wires checkbox selection separately from the importance star', () => {
  const script = readRepoFile('apps/web/app.js');
  assert.match(script, /const selectToggle = node\.querySelector\('\.task-select-toggle'\);/);
  assert.match(script, /const starButton = node\.querySelector\('\.task-star-button'\);/);
  assert.match(script, /selectToggle\.textContent = selected \? '☑' : '☐';/);
  assert.match(script, /selectToggle\.classList\.toggle\('is-active', selected\);/);
  assert.match(script, /setSelectedTaskIds\(\[\.\.\.selectedIds, task\.id\]\);/);
  assert.match(script, /setSelectedTaskIds\(selectedIds\.filter\(id => id !== task\.id\)\);/);
  assert.match(script, /const isImportant = task\.priority === 'high' \|\| task\.priority === 'critical';/);
  assert.match(script, /const nextPriority = isImportant \? 'medium' : 'high';/);
  assert.match(script, /await updateTaskRecord\(task\.id, \{ priority: nextPriority \}\);/);
});

test('task selection checkbox and importance star have distinct visual styling', () => {
  const css = readRepoFile('apps/web/styles.css');
  assert.match(css, /\.task-select-toggle,/);
  assert.match(css, /\.task-select-toggle:hover,/);
  assert.match(css, /\.task-star-button \{/);
  assert.match(css, /\.task-star-button:hover,/);
  assert.match(css, /\.task-item\.is-important \.task-star-button \{/);
});
