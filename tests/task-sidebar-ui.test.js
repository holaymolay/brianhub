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
  assert.match(html, /id="tasks-open"[\s\S]*data-sidebar-toggle="tasks"[\s\S]*aria-controls="sidebar-section-body-tasks"/);
  assert.match(html, /id="organizations-open"[\s\S]*data-sidebar-toggle="organizations"[\s\S]*aria-controls="sidebar-section-body-organizations"/);
  assert.match(html, /id="organizations-open"/);
  assert.match(html, /id="organization-list" class="workspace-list sidebar-section-list"/);
  assert.match(styles, /\.sidebar \{[\s\S]*overflow: hidden;/s);
  assert.match(styles, /\.sidebar-content \{[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*flex: 1 1 auto;[\s\S]*min-height: 0;/s);
  assert.match(styles, /\.sidebar-section\.is-collapsed \{[\s\S]*flex: 0 0 auto;/s);
  assert.match(styles, /\.sidebar-section-body \{[\s\S]*min-height: 0;[\s\S]*overflow: hidden;/s);
  assert.match(styles, /\.sidebar-section\.is-collapsed \.sidebar-section-body \{[\s\S]*display: none;/s);
  assert.match(styles, /\.sidebar-section-list \{[\s\S]*overflow-y: auto;[\s\S]*overflow-x: hidden;/s);
  assert.match(styles, /\.sidebar-section-button \{[\s\S]*justify-content: space-between;[\s\S]*padding: 0\.48rem 0\.65rem;[\s\S]*border-radius: 0\.75rem;/s);
  assert.match(styles, /\.sidebar-section-button::after \{[\s\S]*content: '▾';/s);
  assert.match(styles, /\.sidebar-section\.is-active \.sidebar-section-button \{/);
  assert.match(styles, /\.sidebar \.workspace-row \{[\s\S]*padding: 0\.12rem 0\.22rem;/s);
  assert.match(styles, /\.sidebar \.workspace-select \{[\s\S]*font-size: 0\.78rem;[\s\S]*line-height: 1\.1;[\s\S]*padding: 0\.22rem 0\.24rem;/s);
  assert.match(styles, /\.workspace-select \{[\s\S]*width: 100%;[\s\S]*min-width: 0;[\s\S]*white-space: nowrap;[\s\S]*text-overflow: ellipsis;/s);
  assert.match(script, /function renderOrganizationSidebarList\(\)/);
  assert.match(script, /function getSidebarFocusedSectionKey\(\)/);
  assert.match(script, /function openSidebarSection\(sectionKey\)/);
  assert.match(script, /function handleSidebarSectionButtonClick\(sectionKey\)/);
  assert.match(script, /function syncSidebarSectionExpansion\(\)/);
  assert.match(script, /sidebarSectionButtons\.forEach\(\(button\) => \{\s*button\.addEventListener\('click', \(event\) => \{\s*event\.preventDefault\(\);\s*void handleSidebarSectionButtonClick/s);
  assert.match(script, /selectBtn\.textContent = `\$\{org\.name\} · \$\{roleText\}`;/);
  assert.match(script, /setSidebarSectionExpanded\(key, true\);\s*openSidebarSection\(key\);/s);
  assert.match(script, /function renderWorkspaceList\(\) \{\s*workspaceListEl\.innerHTML = '';\s*const workspaceAnchor = getCurrentWorkspaceAnchor\(\);/s);
  assert.match(script, /const labelWorkspace = workspaceAnchor \?\? state\.workspace;/);
  assert.match(script, /const workspaces = getWorkspaceBackboneList\(\);/);
  assert.doesNotMatch(script, /const workspaces = \(state\.workspaces \?\? \[state\.workspace\]\)\.filter\(ws => !ws\.archived\);/);
});
