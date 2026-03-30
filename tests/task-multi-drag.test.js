import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('task drag groups selected siblings from the active container', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /function getSelectedDragTaskIds\(originParentId\) \{/);
  assert.match(script, /const ordered = Array\.from\(originContainer\.querySelectorAll\(':scope > \.task-item, :scope > \.kanban-card'\)\)/);
  assert.match(script, /return ordered\.length > 1 \? ordered : \[draggingTaskId\];/);
  assert.match(script, /getTaskElementsByIds\(getSelectedDragTaskIds\(task\.parent_id \?\? null\)\)\s*\.forEach\(\(element\) => element\.classList\.add\('dragging'\)\);/s);
});

test('task multi-drag reorders the full selection together without creating subtasks', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /const selectedIds = getSelectedDragTaskIds\(draggingTaskOrigin\?\.parentId \?\? null\);/);
  assert.match(script, /for \(const taskId of selectedIds\) \{\s*const task = state\.tasks\?\.\[taskId\];\s*if \(!task \|\| \(task\.parent_id \?\? null\) === null\) continue;\s*await reparentTaskRecord\(taskId, null\);/s);
  assert.match(script, /function previewTaskInsertion\(targetContainer, referenceNode = null\) \{[\s\S]*const elements = getTaskElementsByIds\(getSelectedDragTaskIds\(draggingTaskOrigin\?\.parentId \?\? null\)\);[\s\S]*elements\.forEach\(\(element\) => \{\s*container\.insertBefore\(element, normalizedReference\);/s);
  assert.match(script, /const movingSet = new Set\(elements\);[\s\S]*\.filter\(\(candidate\) => !movingSet\.has\(candidate\)\)/s);
  assert.match(script, /if \(selectedIds\.length > 1\) \{\s*const elements = getTaskElementsByIds\(selectedIds\);/s);
  assert.doesNotMatch(script, /reparentTaskRecord\(taskId, targetId\)/);
});

test('kanban drops also move selected tasks together', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /container\.addEventListener\('drop', async \(event\) => \{\s*if \(!draggingTaskId \|\| draggingColumnKey\) return;[\s\S]*const selectedIds = getSelectedDragTaskIds\(draggingTaskOrigin\?\.parentId \?\? null\);[\s\S]*elements\.forEach\(\(element\) => container\.appendChild\(element\)\);/s);
  assert.match(script, /if \(selectedIds\.length > 1\) \{\s*const elements = getTaskElementsByIds\(selectedIds\);[\s\S]*elements\.forEach\(\(element\) => container\.insertBefore\(element, referenceNode\)\);/s);
});
