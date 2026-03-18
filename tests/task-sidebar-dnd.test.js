import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('sidebar task lists accept dropped tasks and sections', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /function clearTaskSidebarListDropTargets\(\)/);
  assert.match(script, /row\.addEventListener\('dragover', \(event\) => \{\s*if \(\(!draggingTaskId && !draggingSectionEl\) \|\| draggingColumnKey\) return;\s*event\.preventDefault\(\);\s*row\.classList\.add\('is-drop-target'\);/s);
  assert.match(script, /const result = draggingSectionEl\s*\?\s*await moveDraggedSectionToSidebarList\(list\.id\)\s*:\s*await moveDraggedTasksToSidebarList\(list\.id\);/s);
});

test('sidebar list drop moves whole task subtrees into the destination list', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /async function moveTaskRootsToSidebarList\(rootTaskIds, targetListId\)/);
  assert.match(script, /if \(\(rootTask\.parent_id \?\? null\) !== null\) \{\s*const reparented = await reparentTaskRecord\(rootId, null\);/s);
  assert.match(script, /if \(\(descendant\.project_id \?\? null\) === targetListId\) continue;\s*await updateTaskRecord\(descendant\.id, \{ project_id: targetListId \}\);/s);
});

test('section drag supports moving grouped task sections into sidebar lists', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /async function moveDraggedSectionToSidebarList\(targetListId\)/);
  assert.match(script, /function moveTaskSectionRecordToSidebarList\(sectionInfo, targetListId\)/);
  assert.match(script, /dragHandle\.draggable = true;\s*dragHandle\.addEventListener\('dragstart', \(event\) => beginSectionDrag\(event, sectionInfo, section\)\);/s);
  assert.match(script, /sectionHeader\.appendChild\(dragHandle\);/);
});
