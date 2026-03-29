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
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(html, /id="task-sort-select" class="task-view-select task-toolbar-select"/);
  assert.match(html, /id="task-group-select" class="task-view-select task-toolbar-select"/);
  assert.match(html, /id="task-view-select" class="task-view-select task-toolbar-select"/);
  assert.match(html, /id="task-columns-button"/);
  assert.doesNotMatch(html, /id="task-sort-button"/);
  assert.doesNotMatch(html, /id="task-group-button"/);
  assert.match(css, /#tasks-panel \.task-view-toggle \{[\s\S]*display: flex;[\s\S]*flex: 0 1 auto;[\s\S]*width: auto;/);
  assert.match(css, /\.task-view-toggle \{[\s\S]*display: flex;[\s\S]*flex-wrap: nowrap;[\s\S]*min-width: 0;[\s\S]*max-width: 100%;/);
  assert.match(css, /\.task-toolbar-field \{[\s\S]*flex: 1 1 0;/);
  assert.match(css, /#tasks-panel \.task-toolbar-field \{[\s\S]*flex: 0 0 auto;/);
  assert.match(css, /#tasks-panel \.task-sort \{[\s\S]*width: 10\.5rem;/);
  assert.match(css, /#tasks-panel \.task-group \{[\s\S]*width: 11rem;/);
  assert.match(css, /#tasks-panel \.task-view-toggle > \.task-toolbar-field:last-of-type \{[\s\S]*width: 10rem;/);
  assert.match(css, /\.task-view-select \{[\s\S]*min-width: 0;/);
  assert.match(css, /#task-columns-button \{[\s\S]*flex: 0 0 auto;[\s\S]*align-self: flex-end;/);
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

test('mobile task editor owns scroll and hides the footer nav while open', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(script, /function syncMobileBottomUiState\(\) \{\s*if \(typeof document === 'undefined'\) return;\s*const blockingSurfaceOpen = Boolean\([\s\S]*#task-editor\.is-open[\s\S]*\);\s*document\.body\.classList\.toggle\('mobile-bottom-ui-hidden', blockingSurfaceOpen\);\s*\}/s);
  assert.match(script, /function setTaskEditorOpen\(open\) \{\s*taskEditor\?\.classList\.toggle\('is-open', open\);\s*document\.body\.classList\.toggle\('task-editor-open', open\);\s*syncMobileBottomUiState\(\);\s*\}/s);
  assert.match(script, /function openTaskEditor\(taskId\) \{[\s\S]*setTaskEditorOpen\(true\);[\s\S]*updateTaskEditorScrollbar\(\);/s);
  assert.match(script, /function closeTaskEditor\(\) \{[\s\S]*setTaskEditorOpen\(false\);/s);
  assert.match(css, /body\.mobile-bottom-ui-hidden \.mobile-nav \{[\s\S]*display: none !important;/s);
  assert.match(css, /body\.task-editor-open\.mobile-tasks-view #task-tree \{[\s\S]*overflow: hidden;/s);
  assert.match(css, /\.task-editor-body \{[\s\S]*overflow-y: auto;[\s\S]*overscroll-behavior: contain;[\s\S]*-webkit-overflow-scrolling: touch;/s);
  assert.match(css, /body\.task-editor-open \.task-editor \{[\s\S]*height: 100dvh;/s);
  assert.match(css, /\.task-editor-actions \{[\s\S]*position: sticky;[\s\S]*bottom: 0;/s);
});

test('mobile bottom surfaces share one clearance contract', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(css, /:root \{[\s\S]*--mobile-safe-area-bottom: env\(safe-area-inset-bottom, 0px\);[\s\S]*--mobile-bottom-ui-clearance: calc\(var\(--mobile-bottom-ui-height\) \+ var\(--mobile-safe-area-bottom\)\);[\s\S]*--mobile-sheet-bottom-offset: calc\(var\(--mobile-bottom-ui-clearance\) \+ var\(--mobile-surface-gap\)\);/s);
  assert.match(css, /body\.mobile-bottom-ui-hidden \{[\s\S]*--mobile-bottom-ui-height: 0px;/s);
  assert.match(css, /\.mobile-create-sheet-card \{[\s\S]*bottom: var\(--mobile-sheet-bottom-offset\);/s);
  assert.match(css, /\.mobile-overlay \{[\s\S]*padding: max\(0\.8rem, env\(safe-area-inset-top, 0px\)\) 0\.65rem var\(--mobile-sheet-bottom-offset\);/s);
  assert.match(css, /\.mobile-overlay-card \{[\s\S]*max-height: min\(66dvh, calc\(100dvh - var\(--mobile-bottom-ui-clearance\) - 2rem\)\);/s);
  assert.match(css, /#tasks-panel #task-create-menu,[\s\S]*bottom: var\(--mobile-sheet-bottom-offset\);[\s\S]*max-height: min\(62dvh, calc\(100dvh - var\(--mobile-bottom-ui-clearance\) - 1\.5rem\)\);/s);
  assert.match(css, /body\.mobile-tasks-view #task-tree \{[\s\S]*scroll-padding-bottom: calc\(var\(--mobile-sheet-bottom-offset\) \+ 0\.35rem\);/s);
  assert.match(script, /function openMobileCreateSheet\(\{ mode = 'actions' \} = \{\}\) \{[\s\S]*document\.body\.classList\.add\('mobile-create-open'\);\s*syncMobileBottomUiState\(\);/s);
  assert.match(script, /function closeMobileCreateSheet\(\) \{[\s\S]*document\.body\.classList\.remove\('mobile-create-open'\);\s*syncMobileBottomUiState\(\);/s);
  assert.match(script, /function render\(\) \{[\s\S]*document\.body\.classList\.toggle\('mobile-scheduling-view', mobileSchedulingView\);[\s\S]*document\.body\.classList\.toggle\('mobile-tasks-view', mobileTasksView\);\s*syncMobileBottomUiState\(\);/s);
});

test('mobile task tools reuse the same task state controls as desktop', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /tasksMobileToolsBtn\?\.addEventListener\('click', \(\) => \{\s*openMobileTaskToolsModal\(\);/s);
  assert.match(script, /taskSortSelect\?\.addEventListener\('change', \(\) => \{\s*setTaskSortKey\(taskSortSelect\.value\);/s);
  assert.match(script, /taskGroupSelect\?\.addEventListener\('change', \(\) => \{\s*setTaskGroupMode\(taskGroupSelect\.value\);\s*queueUserSettingsSave\(\{ immediate: true \}\);/s);
  assert.match(script, /taskViewSelect\?\.addEventListener\('change', \(\) => \{\s*setTaskView\(taskViewSelect\.value\);\s*queueUserSettingsSave\(\{ immediate: true \}\);/s);
  assert.match(script, /mobileTaskToolsFilter\?\.addEventListener\('change', \(\) => \{\s*const selected = mobileTaskToolsFilter\.value \|\| 'all';\s*setActiveTaskFilter\(selected\);/s);
  assert.match(script, /mobileTaskToolsSort\?\.addEventListener\('change', \(\) => \{\s*const selected = mobileTaskToolsSort\.value \|\| 'default';\s*setTaskSortKey\(selected\);/s);
  assert.match(script, /mobileTaskToolsGroup\?\.addEventListener\('change', \(\) => \{\s*setTaskGroupMode\(mobileTaskToolsGroup\.value \|\| 'none'\);\s*queueUserSettingsSave\(\{ immediate: true \}\);/s);
  assert.match(script, /mobileTaskToolsView\?\.addEventListener\('change', \(\) => \{\s*setTaskView\(mobileTaskToolsView\.value \|\| 'list'\);\s*queueUserSettingsSave\(\{ immediate: true \}\);/s);
  assert.match(script, /function syncMobileTaskToolsInputs\(\) \{\s*if \(!mobileTaskToolsModal\) return;\s*const checklistViewActive = isWorkflowChecklistViewActive\(\);\s*syncTaskFilterOptionSelect\(mobileTaskToolsFilter, \{ allowFocusPreserve: true \}\);/s);
});

test('task list selection does not override the saved grouping preference', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.doesNotMatch(script, /selectBtn\.addEventListener\('click', \(\) => \{\s*setActiveTaskFilter\(list\.id\);\s*setTaskGroupMode\('section'\);/s);
  assert.doesNotMatch(script, /newTaskListBtn\?\.addEventListener\('click', async \(\) => \{[\s\S]*setActiveTaskFilter\(created\.id\);\s*setTaskGroupMode\('section'\);/s);
});

test('view and group changes flush auth settings immediately so refresh keeps them', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  const apiScript = readFileSync(resolve(process.cwd(), 'apps/web/api.js'), 'utf8');
  assert.match(script, /if \(action === 'section'\) \{\s*const name = prompt\('Section name'\);\s*if \(!name\) return;\s*setTaskGroupMode\('section'\);\s*queueUserSettingsSave\(\{ immediate: true \}\);/s);
  assert.match(script, /mobileTaskToolsAddSection\?\.addEventListener\('click', \(\) => \{\s*const name = prompt\('Section name'\);\s*if \(!name\) return;\s*setTaskGroupMode\('section'\);\s*queueUserSettingsSave\(\{ immediate: true \}\);/s);
  assert.match(apiScript, /export function updateAuthSettings\(data\) \{[\s\S]*return request\('\/auth\/settings', \{[\s\S]*keepalive: true,[\s\S]*\}\)\.catch\(\(error\) => \{/s);
});

test('mobile task tools replace the cramped toolbar on phones', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(css, /\.mobile-task-tools-card \{/);
  assert.match(css, /\.mobile-task-tools-actions \{/);
  assert.match(css, /\.mobile-task-tools-field \.setting-input,[\s\S]*width: 100%;/s);
  assert.match(css, /#tasks-panel \.tasks-toolbar \{\s*display: none;/s);
});

test('mobile tasks view keeps the task panel as the scroll owner', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(script, /const mobileTasksView = mobileViewport && getActiveView\(\) === 'tasks';/);
  assert.match(script, /document\.body\.classList\.toggle\('mobile-tasks-view', mobileTasksView\);/);
  assert.match(css, /body\.mobile-tasks-view \.app-main \{[\s\S]*overflow: hidden;[\s\S]*flex: 1 1 auto;/);
  assert.match(css, /body\.mobile-tasks-view \.app-layout \{[\s\S]*height: 100%;[\s\S]*min-height: 0;/);
  assert.match(css, /body\.mobile-tasks-view \.content-panel \{[\s\S]*height: 100%;[\s\S]*overflow: hidden;/);
  assert.match(css, /body\.mobile-tasks-view #tasks-panel \{[\s\S]*height: 100%;[\s\S]*overflow: hidden;/);
  assert.match(css, /body\.mobile-tasks-view #task-tree \{[\s\S]*overflow: auto;[\s\S]*scroll-padding-bottom: calc\(var\(--mobile-sheet-bottom-offset\) \+ 0\.35rem\);/);
});

test('mobile task rows reflow into a wrapped phone layout', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(css, /#tasks-panel \.task-row \{[\s\S]*display: grid;[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /#tasks-panel \.task-title-row \{[\s\S]*display: flex;[\s\S]*flex-wrap: wrap;/);
  assert.match(css, /#tasks-panel \.task-title \{[\s\S]*flex: 1 0 100%;[\s\S]*white-space: normal;[\s\S]*-webkit-line-clamp: 3;/);
  assert.match(css, /#tasks-panel \.task-meta \{[\s\S]*display: block !important;[\s\S]*white-space: normal;/);
});

test('task reorder supports row drag on desktop and pointer drag on touch devices', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /let taskPointerDragState = null;/);
  assert.match(script, /function beginTaskPointerGesture\(event, task, item\)/);
  assert.match(script, /function moveTaskPointerGesture\(event\)/);
  assert.match(script, /async function finishTaskPointerGesture\(event, commit = false\)/);
  assert.match(script, /const mobileViewport = isMobileViewport\(\);\s*item\.draggable = !mobileViewport;/s);
  assert.match(script, /if \(!mobileViewport\) \{\s*item\.addEventListener\('dragstart', \(event\) => beginTaskDrag\(event, task, item\)\);\s*item\.addEventListener\('dragend', endTaskDrag\);\s*\}/s);
  assert.match(script, /handle\.draggable = !mobileViewport;/);
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
  assert.match(css, /#tasks-panel #task-filter-menu,[\s\S]*#tasks-panel \.task-menu \{\s*position: fixed;[\s\S]*bottom: var\(--mobile-sheet-bottom-offset\);/s);
});

test('mobile workspace management is a simple workspace switcher', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /id="workspace-manage-title"/);
  assert.match(html, /id="workspace-manage-subtitle"/);

  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /if \(mobileViewport && currentView === 'workspaces-archived'\) \{\s*setActiveView\('workspaces-manage'\);/s);
  assert.match(script, /workspaceManageTitle\.textContent = isMobileViewport\(\) \? 'Switch Workspace' : 'Manage Workspaces';/);
  assert.match(script, /workspaceManageSubtitle\.textContent = isMobileViewport\(\)[\s\S]*'Choose the workspace you want to work in\.'/s);
  assert.match(script, /if \(isMobileViewport\(\)\) \{\s*workspaces\.forEach\(workspace => \{\s*workspaceManageList\.appendChild\(createWorkspaceMobileSwitchRow\(workspace\)\);/s);
  assert.match(script, /function createWorkspaceMobileSwitchRow\(workspace\)/);
  assert.match(script, /await selectWorkspace\(workspace\);/);

  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(css, /\.workspace-switch-button \{/);
});

test('mobile task title taps open the task editor instead of inline rename', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /titleEl\.addEventListener\('click', \(event\) => \{[\s\S]*if \(isMobileViewport\(\)\) \{\s*openTaskEditor\(task\.id\);\s*return;\s*\}[\s\S]*beginInlineTaskEdit\(task, item, titleEl\);/s);
});
