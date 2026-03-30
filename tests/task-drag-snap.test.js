import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('task drag logic exposes a dedicated reorder snap target', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /function resolveTaskInsertionReference\(targetContainer, clientY\)/);
  assert.match(script, /function previewTaskInsertion\(targetContainer, referenceNode = null\)/);
  assert.match(script, /function previewTaskDropOnItem\(item, clientY\)/);
  assert.match(script, /function previewTaskDropInContainer\(container, clientY = null\)/);
  assert.match(script, /const siblings = Array\.from\(container\.querySelectorAll\(':scope > \.task-item'\)\)/);
  assert.match(script, /return clientY < rect\.top \+ rect\.height \/ 2;/);
  assert.match(script, /if \(target\?\.type === 'item'\) \{\s*previewTaskDropOnItem\(target\.item, clientY\);/s);
  assert.match(script, /event\.preventDefault\(\);\s*previewTaskDropOnItem\(item, event\.clientY\);/s);
  assert.match(script, /previewTaskDropInContainer\(container, event\.clientY\);/);
  assert.match(script, /await dropTaskIntoContainer\(container, event\.clientY\);/);
  assert.doesNotMatch(script, /handleSubtaskDrop\(/);
  assert.doesNotMatch(script, /\.classList\.add\('drop-subtask'\)/);
  assert.doesNotMatch(script, /\.classList\.add\('drop-reorder'\)/);
});

test('task drag styling adds snap feedback for dragged items and targets', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(css, /\.task-item\.dragging,\s*\.kanban-card\.dragging \{/);
  assert.match(css, /\.task-root-dropzone\.drag-over \{[\s\S]*transform: scaleY\(1\.02\);/s);
  assert.match(css, /\.task-item\.dragging,[\s\S]*box-shadow:[\s\S]*0 0 24px rgba\(79, 174, 255, 0\.14\);/s);
  assert.doesNotMatch(css, /\.task-item\.drop-subtask \{/);
  assert.doesNotMatch(css, /\.task-item\.drop-reorder \{/);
  assert.match(css, /\.workspace-row\.is-drop-target \{[\s\S]*transform: translateX\(4px\) scale\(1\.01\);/s);
});
