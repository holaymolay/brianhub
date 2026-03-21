import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('bulk edit modal includes a parent-task control', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /id="bulk-edit-apply-parent"/);
  assert.match(html, /id="bulk-edit-parent"/);
});

test('task editor and bulk edit expose section assignment controls', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /id="editor-section"/);
  assert.match(html, /id="bulk-edit-apply-section"/);
  assert.match(html, /id="bulk-edit-section"/);
});

test('bulk edit populates parent candidates from selected root tasks only', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /const bulkEditApplyParent = document\.getElementById\('bulk-edit-apply-parent'\);/);
  assert.match(script, /const bulkEditParent = document\.getElementById\('bulk-edit-parent'\);/);
  assert.match(script, /function populateBulkEditParentSelect\(selectEl, selectedTaskIds = getSelectedTaskIds\(\), selectedParentId = null\) \{/);
  assert.match(script, /const rootIds = getRootTaskIds\(selectedTaskIds\);/);
  assert.match(script, /const scopeProjectIds = new Set\(rootTasks\.map\(task => normalizeSectionScopeProjectId\(task\.project_id\)\)\);/);
  assert.match(script, /bulk parent assignment only works within one project or list at a time/i);
});

test('task editor and bulk edit use section-aware assignment via group_label', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /const editorSection = document\.getElementById\('editor-section'\);/);
  assert.match(script, /const bulkEditApplySection = document\.getElementById\('bulk-edit-apply-section'\);/);
  assert.match(script, /const bulkEditSection = document\.getElementById\('bulk-edit-section'\);/);
  assert.match(script, /function populateSectionSelect\(/);
  assert.match(script, /function populateBulkEditSectionSelect\(selectEl, selectedTaskIds = getSelectedTaskIds\(\), selectedLabel = null\)/);
  assert.match(script, /bulk section assignment only works within one project or list at a time/i);
  assert.match(script, /patch\.group_label = nextGroupLabel;/);
  assert.match(script, /template\.group_label = bulkEditSection\.value \? normalizeTitleInput\(bulkEditSection\.value\) : null;/);
});

test('bulk edit reparents only selected roots and records parent-aware undo', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /const \{ template, fields, applyParent, nextParentId \} = buildBulkEditTemplate\(\);/);
  assert.match(script, /const rootSet = new Set\(applyParent \? getRootTaskIds\(selected\) : \[\]\);/);
  assert.match(script, /if \(applyParent && rootSet\.has\(task\.id\) && \(task\.parent_id \?\? null\) !== \(nextParentId \?\? null\)\) \{\s*snapshotFields\.add\('parent_id'\);\s*snapshotFields\.add\('sort_order'\);/s);
  assert.match(script, /await reparentTaskRecord\(task\.id, nextParentId\);/);
  assert.match(script, /if \(Object\.prototype\.hasOwnProperty\.call\(before, 'parent_id'\)\) \{\s*const previousParentId = before\.parent_id \?\? null;\s*delete before\.parent_id;\s*await reparentTaskRecord\(snapshot\.id, previousParentId\);/s);
});
