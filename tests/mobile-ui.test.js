import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('tasks page exposes a dedicated mobile add button', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /id="tasks-mobile-add-btn"/);
  assert.match(html, /class="panel-header tasks-mobile-header"/);
});

test('tasks page exposes a dedicated mobile tools sheet', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /id="tasks-mobile-tools-btn"/);
  assert.match(html, /id="tasks-mobile-context"/);
  assert.match(html, /id="mobile-task-tools-modal"/);
  assert.match(html, /id="mobile-task-tools-filter"/);
  assert.match(html, /id="mobile-task-tools-sort"/);
  assert.match(html, /id="mobile-task-tools-group"/);
  assert.match(html, /id="mobile-task-tools-view"/);
  assert.match(html, /id="mobile-task-tools-add-section"/);
  assert.match(html, /id="mobile-task-tools-add-column"/);
});

test('desktop task toolbar uses the same select controls for sort, group by, and view', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /id="task-sort-select" class="task-view-select task-toolbar-select"/);
  assert.match(html, /id="task-group-select" class="task-view-select task-toolbar-select"/);
  assert.match(html, /id="task-view-select" class="task-view-select task-toolbar-select"/);
  assert.doesNotMatch(html, /id="task-sort-button"/);
  assert.doesNotMatch(html, /id="task-group-button"/);
});

test('mobile create sheet exposes a task quick-add form', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /id="mobile-task-quick-add-form"/);
  assert.match(html, /id="mobile-task-quick-add-input"/);
});

test('mobile quick add opens the task quick-add form directly from tasks view', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /tasksMobileAddBtn\?\.addEventListener\('click'/);
  assert.match(script, /if \(getActiveView\(\) === 'tasks'\) \{\s*runMobileCreateAction\('task'\);/s);
  assert.match(script, /function runMobileCreateAction\(action\) \{\s*if \(action === 'task'\) \{\s*openMobileTaskQuickAdd\(\);/s);
  assert.match(script, /mobileCreateTask\?\.addEventListener\('click', \(\) => \{\s*openMobileTaskQuickAdd\(\);/s);
  assert.match(script, /mobileTaskQuickAddForm\?\.addEventListener\('submit', async \(event\) => \{/);
});

test('task modal keeps the action row reachable on mobile', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(css, /\.modal \{[\s\S]*z-index: 220;/);
  assert.match(css, /#task-modal \.modal-card \{[\s\S]*max-height: calc\(100dvh - 2rem\);/);
  assert.match(css, /#task-modal-form \{[\s\S]*overflow-y: auto;/);
  assert.match(css, /#task-modal-form \.modal-actions \{[\s\S]*position: sticky;[\s\S]*bottom: 0;/);
});

test('mobile task tools reuse the same task state controls as desktop', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /tasksMobileToolsBtn\?\.addEventListener\('click', \(\) => \{\s*openMobileTaskToolsModal\(\);/s);
  assert.match(script, /taskSortSelect\?\.addEventListener\('change', \(\) => \{\s*setTaskSortKey\(taskSortSelect\.value\);/s);
  assert.match(script, /taskGroupSelect\?\.addEventListener\('change', \(\) => \{\s*setTaskGroupMode\(taskGroupSelect\.value\);/s);
  assert.match(script, /taskViewSelect\?\.addEventListener\('change', \(\) => \{\s*setTaskView\(taskViewSelect\.value\);/s);
  assert.match(script, /mobileTaskToolsFilter\?\.addEventListener\('change', \(\) => \{\s*const selected = mobileTaskToolsFilter\.value \|\| 'all';\s*setActiveTaskFilter\(selected\);/s);
  assert.match(script, /mobileTaskToolsSort\?\.addEventListener\('change', \(\) => \{\s*const selected = mobileTaskToolsSort\.value \|\| 'default';\s*setTaskSortKey\(selected\);/s);
  assert.match(script, /mobileTaskToolsGroup\?\.addEventListener\('change', \(\) => \{\s*setTaskGroupMode\(mobileTaskToolsGroup\.value \|\| 'none'\);/s);
  assert.match(script, /mobileTaskToolsView\?\.addEventListener\('change', \(\) => \{\s*setTaskView\(mobileTaskToolsView\.value \|\| 'list'\);/s);
  assert.match(script, /function syncMobileTaskToolsInputs\(\) \{\s*if \(!mobileTaskToolsModal\) return;\s*const checklistViewActive = isWorkflowChecklistViewActive\(\);\s*syncTaskFilterOptionSelect\(mobileTaskToolsFilter, \{ allowFocusPreserve: true \}\);/s);
});

test('mobile task tools replace the cramped toolbar on phones', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(css, /\.mobile-task-tools-card \{/);
  assert.match(css, /\.mobile-task-tools-actions \{/);
  assert.match(css, /\.mobile-task-tools-field \.setting-input,[\s\S]*width: 100%;/s);
  assert.match(css, /#tasks-panel \.tasks-toolbar \{\s*display: none;/s);
});

test('task reorder supports row drag on desktop and pointer drag on touch devices', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /let taskPointerDragState = null;/);
  assert.match(script, /function beginTaskPointerGesture\(event, task, item\)/);
  assert.match(script, /function moveTaskPointerGesture\(event\)/);
  assert.match(script, /async function finishTaskPointerGesture\(event, commit = false\)/);
  assert.match(script, /item\.draggable = true;/);
  assert.match(script, /handle\.addEventListener\('pointerdown', \(event\) => beginTaskPointerGesture\(event, task, item\)\);/);
  assert.match(script, /async function dropTaskIntoContainer\(container\)/);
  assert.match(script, /async function dropTaskOnItem\(item, clientY\)/);
});

test('task drag handle stays usable on touch devices', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(css, /\.task-drag-handle \{[\s\S]*touch-action: none;/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\) \{[\s\S]*\.task-drag-handle \{[\s\S]*opacity: 1;[\s\S]*pointer-events: auto;/s);
});

test('responsive tasks menus render as mobile sheets and keep the task menu button visible', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(css, /#tasks-panel \.task-menu-button \{\s*opacity: 1;\s*pointer-events: auto;/s);
  assert.match(css, /#tasks-panel #task-filter-menu,[\s\S]*#tasks-panel \.task-menu \{\s*position: fixed;[\s\S]*bottom: calc\(var\(--mobile-nav-safe-clearance\) \+ 0\.65rem\);/s);
});
