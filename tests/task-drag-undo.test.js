import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('task drag undo registers a dedicated last-action snapshot and shortcut', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /let lastTaskDragUndo = null;/);
  assert.match(script, /const TASK_DRAG_UNDO_FIELDS = \[/);
  assert.match(script, /function isEditableShortcutTarget\(target\) \{/);
  assert.match(script, /const isUndoShortcut = \(event\.ctrlKey \|\| event\.metaKey\)/);
  assert.match(script, /if \(isUndoShortcut && lastTaskDragUndo && !isEditableShortcutTarget\(event\.target\)\) \{/);
  assert.match(script, /void undoLastTaskDrag\(\);/);
});

test('task drag undo restores snapshots through the shared patch restore helper', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /async function restoreTaskSnapshotPatches\(snapshots\) \{/);
  assert.match(script, /async function undoLastTaskDrag\(entryId = null\) \{/);
  assert.match(script, /await restoreTaskSnapshotPatches\(entry\.tasks\);/);
  assert.match(script, /function collectTaskDragUndoSnapshots\(\{ taskIds = \[\], includeDescendantsFor = \[\], containers = \[\] \} = \{\}\) \{/);
  assert.match(script, /function registerTaskDragUndo\(message, snapshots\) \{/);
});

test('task drop paths register undo snapshots before drag mutations', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /const undoSnapshots = collectTaskDragUndoSnapshots\(\{\s*taskIds: selectedIds,\s*containers: \[originContainer, targetContainer\]\.filter\(Boolean\)/s);
  assert.match(script, /registerTaskDragUndo\(\s*selectedIds\.length === 1 \? 'Task move undone\.' : `\$\{selectedIds\.length\} task moves undone\.`/s);
  assert.match(script, /const undoSnapshots = collectTaskDragUndoSnapshots\(\{\s*taskIds: rootIds,\s*includeDescendantsFor: rootIds/s);
  assert.match(script, /const undoSnapshots = collectTaskDragUndoSnapshots\(\{\s*taskIds: selectedIds,\s*containers: \[container\]/s);
});
