import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readRepoFile(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

test('task tree uses dark scrollbar styling', () => {
  const styles = readRepoFile('apps/web/styles.css');
  assert.match(styles, /#task-tree \{\s*flex: 1 1 auto;\s*min-height: 0;\s*overflow: auto;\s*scrollbar-width: thin;\s*scrollbar-color: #31445f #0f141c;/s);
  assert.match(styles, /#task-tree::\-webkit-scrollbar-thumb \{/);
  assert.match(styles, /#task-tree::\-webkit-scrollbar-thumb:hover \{/);
});

test('task sidebar renders project rows directly instead of an open-projects placeholder', () => {
  const script = readRepoFile('apps/web/app.js');
  assert.match(script, /const projects = getProjectsForWorkspace\(\)/);
  assert.match(script, /note\.textContent = 'No projects yet\.';/);
  assert.match(script, /selectBtn\.textContent = project\.name;/);
  assert.match(script, /selectBtn\.addEventListener\('click', \(\) => \{\s*setActiveTaskFilter\(project\.id\);\s*clearActiveWorkflowChecklistInstanceId\(\);\s*setActiveView\('tasks'\);\s*render\(\);\s*\}\);/s);
  assert.match(script, /badge\.textContent = 'Project';/);
  assert.doesNotMatch(script, /Open Projects/);
  assert.match(script, /newProjectBtn\?\.addEventListener\('click', async \(\) => \{[\s\S]*setActiveView\('projects'\);[\s\S]*render\(\);[\s\S]*\}\);/);
});

test('desktop sidebar uses per-section scrolling and exposes organizations', () => {
  const html = readRepoFile('apps/web/index.html');
  const styles = readRepoFile('apps/web/styles.css');
  const script = readRepoFile('apps/web/app.js');
  assert.match(html, /class="sidebar-section sidebar-section-organizations" data-sidebar-section="organizations"/);
  assert.match(html, /id="tasks-open"[\s\S]*data-sidebar-toggle="tasks"[\s\S]*data-sidebar-label="My Tasks"[\s\S]*aria-controls="sidebar-section-body-tasks"/);
  assert.match(html, /id="tasks-open"[\s\S]*<span class="sidebar-section-button-label">My Tasks<\/span>[\s\S]*<span class="sidebar-section-scope hidden"><\/span>/);
  assert.match(html, /id="projects-open"[\s\S]*data-sidebar-toggle="projects"[\s\S]*data-sidebar-label="Projects"[\s\S]*aria-controls="sidebar-section-body-projects"/);
  assert.match(html, /id="organizations-open"[\s\S]*data-sidebar-toggle="organizations"[\s\S]*data-sidebar-label="Organizations"[\s\S]*aria-controls="sidebar-section-body-organizations"/);
  assert.match(html, /id="workflows-open"[\s\S]*data-sidebar-toggle="workflows"[\s\S]*data-sidebar-label="Workflows"[\s\S]*aria-controls="sidebar-section-body-workflows"/);
  assert.match(html, /id="shopping-open"[\s\S]*data-sidebar-toggle="shopping"[\s\S]*data-sidebar-label="Shopping Lists"[\s\S]*aria-controls="sidebar-section-body-shopping"/);
  assert.match(html, /id="notices-open"[\s\S]*data-sidebar-toggle="notices"[\s\S]*data-sidebar-label="Notices"[\s\S]*aria-controls="sidebar-section-body-notices"/);
  assert.match(html, /id="organizations-open"/);
  assert.match(html, /id="organization-list" class="workspace-list sidebar-section-list"/);
  assert.match(styles, /\.sidebar \{[\s\S]*overflow: hidden;/s);
  assert.match(styles, /\.sidebar-content \{[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;/s);
  assert.match(styles, /\.sidebar-section \{[\s\S]*flex: 0\.95 1 0;[\s\S]*transition: flex-basis 180ms ease, flex-grow 180ms ease, border-color 140ms ease;/s);
  assert.match(styles, /\.sidebar-section\.is-expanded \{[\s\S]*flex: 1\.85 1 0;/s);
  assert.match(styles, /\.sidebar-section-body \{[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;[\s\S]*overflow: hidden;[\s\S]*transition: opacity 140ms ease;/s);
  assert.match(styles, /\.sidebar-section-list \{[\s\S]*overflow-y: auto;[\s\S]*overflow-x: hidden;/s);
  assert.match(styles, /\.sidebar-section-button \{[\s\S]*justify-content: space-between;[\s\S]*padding: 0\.42rem 0\.62rem;[\s\S]*border-radius: 0\.75rem;/s);
  assert.match(styles, /\.sidebar-section-button::after \{[\s\S]*content: '▾';/s);
  assert.match(styles, /\.sidebar-section:not\(\.is-expanded\) \.sidebar-section-button \{/);
  assert.match(styles, /\.sidebar-section:is-expanded \.sidebar-section-button|\.sidebar-section\.is-expanded \.sidebar-section-button \{/);
  assert.match(styles, /\.sidebar-section\.is-active \.sidebar-section-button \{/);
  assert.match(styles, /\.sidebar-section-scope \{[\s\S]*text-transform: uppercase;[\s\S]*text-overflow: ellipsis;/s);
  assert.match(styles, /\.sidebar \.workspace-row \{[\s\S]*padding: 0\.09rem 0\.18rem;/s);
  assert.match(styles, /\.sidebar \.workspace-select \{[\s\S]*font-size: 0\.75rem;[\s\S]*line-height: 1\.1;[\s\S]*padding: 0\.18rem 0\.22rem;/s);
  assert.match(styles, /\.workspace-select \{[\s\S]*width: 100%;[\s\S]*min-width: 0;[\s\S]*white-space: nowrap;[\s\S]*text-overflow: ellipsis;/s);
  assert.match(script, /function renderOrganizationSidebarList\(\)/);
  assert.match(script, /function getSidebarSectionCount\(sectionKey\)/);
  assert.match(script, /function getSidebarSectionScopeText\(sectionKey\)/);
  assert.match(script, /function syncSidebarSectionLabels\(\)/);
  assert.match(script, /function getSidebarFocusedSectionKey\(\)/);
  assert.match(script, /function openSidebarSection\(sectionKey\)/);
  assert.match(script, /function handleSidebarSectionButtonClick\(sectionKey\)/);
  assert.match(script, /function syncSidebarSectionExpansion\(\)/);
  assert.match(script, /const SIDEBAR_NO_EXPANDED_KEY = '__none__';/);
  assert.match(script, /sidebarSectionButtons\.forEach\(\(button\) => \{\s*button\.addEventListener\('click', \(event\) => \{\s*event\.preventDefault\(\);\s*void handleSidebarSectionButtonClick/s);
  assert.match(script, /selectBtn\.textContent = `\$\{org\.name\} · \$\{roleText\}`;/);
  assert.match(script, /sidebarState\.expandedKey = SIDEBAR_NO_EXPANDED_KEY;/);
  assert.match(script, /section\.classList\.toggle\('is-expanded', expanded\);/);
  assert.match(script, /setSidebarSectionExpanded\(key, !expanded\);\s*render\(\);/s);
  assert.match(script, /label\.textContent = !expanded && count > 0 \? `\$\{baseLabel\} \(\$\{count\}\)` : baseLabel;/);
  assert.match(script, /scope\.textContent = scopeText;/);
  assert.match(script, /function renderWorkspaceList\(\) \{\s*workspaceListEl\.innerHTML = '';\s*const workspaceAnchor = getCurrentWorkspaceAnchor\(\);/s);
  assert.match(script, /const labelWorkspace = workspaceAnchor \?\? state\.workspace;/);
  assert.match(script, /const workspaces = getWorkspaceBackboneList\(\);/);
  assert.doesNotMatch(script, /const workspaces = \(state\.workspaces \?\? \[state\.workspace\]\)\.filter\(ws => !ws\.archived\);/);
});

test('task rows expose due urgency states and completion feedback animation hooks', () => {
  const script = readRepoFile('apps/web/app.js');
  const styles = readRepoFile('apps/web/styles.css');
  assert.match(script, /function getTaskDueVisualState\(task, statusKey = normalizeTaskStatusValue\(task\?\.status\)\)/);
  assert.match(script, /rowMetaDue\.classList\.toggle\('is-overdue', dueVisualState === 'overdue'\);/);
  assert.match(script, /rowMetaDue\.classList\.toggle\('is-due-today', dueVisualState === 'due-today'\);/);
  assert.match(script, /rowMetaDue\.classList\.toggle\('is-upcoming', dueVisualState === 'upcoming'\);/);
  assert.match(script, /function markTaskJustCompleted\(taskId\)/);
  assert.match(script, /item\.classList\.toggle\('just-completed', isTaskJustCompleted\(task\.id\)\);/);
  assert.match(styles, /\.task-row-meta-item\.is-due-today \{/);
  assert.match(styles, /\.task-row-meta-item\.is-upcoming \{/);
  assert.match(styles, /@keyframes task-item-complete-flash/);
  assert.match(styles, /@keyframes task-complete-button-pop/);
  assert.match(styles, /\.task-item\.just-completed \{/);
});
