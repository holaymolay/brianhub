import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('task drag logic exposes a dedicated reorder snap target', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /document\.querySelectorAll\('\.task-item\.drop-reorder'\)\.forEach\(item => item\.classList\.remove\('drop-reorder'\)\);/);
  assert.match(script, /else if \(target\?\.type === 'item'\) \{\s*target\.item\.classList\.add\('drop-reorder'\);/s);
  assert.match(script, /item\.classList\.remove\('drop-subtask'\);\s*const container = item\.parentElement;/s);
  assert.match(script, /event\.preventDefault\(\);\s*item\.classList\.add\('drop-reorder'\);/s);
  assert.match(script, /item\.addEventListener\('dragleave', \(\) => \{\s*item\.classList\.remove\('drop-subtask'\);\s*item\.classList\.remove\('drop-reorder'\);/s);
});

test('task drag styling adds snap feedback for dragged items and targets', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(css, /\.task-item\.dragging,\s*\.kanban-card\.dragging \{/);
  assert.match(css, /\.task-root-dropzone\.drag-over \{[\s\S]*transform: scaleY\(1\.02\);/s);
  assert.match(css, /\.task-item\.drop-subtask \{[\s\S]*transform: translateX\(8px\) scale\(1\.01\);/s);
  assert.match(css, /\.task-item\.drop-reorder \{[\s\S]*transform: scale\(1\.01\);/s);
  assert.match(css, /\.workspace-row\.is-drop-target \{[\s\S]*transform: translateX\(4px\) scale\(1\.01\);/s);
});
