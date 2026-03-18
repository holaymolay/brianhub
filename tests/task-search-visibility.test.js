import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('task filtering derives effective project scope from ancestor tasks', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /function getTaskEffectiveProjectId\(taskOrId\) \{/);
  assert.match(script, /function taskMatchesActiveProjectFilter\(task, activeFilter = getActiveTaskFilter\(\)\) \{/);
  assert.match(script, /const directProjectId = normalizeSectionScopeProjectId\(task\?\.project_id\);/);
  assert.match(script, /const effectiveProjectId = getTaskEffectiveProjectId\(task\);/);
  assert.match(script, /return !directProjectId;/);
  assert.match(script, /return effectiveProjectId === activeFilter;/);
});

test('task search expands matching descendants with their ancestor chain', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /function expandTaskIdsWithAncestors\(taskIds\) \{/);
  assert.match(script, /getTaskAncestorIds\(taskId\)\.forEach\(\(ancestorId\) => expanded\.add\(ancestorId\)\);/);
  assert.match(script, /const workspaceSearchBase = nonWorkflowTasks\.filter\(task =>/);
  assert.match(script, /const expandedIds = expandTaskIdsWithAncestors\(matchedIds\);/);
  assert.match(script, /return nonWorkflowTasks\.filter\(task => expandedIds\.has\(task\.id\)\);/);
});

test('active search forces nested matches open instead of honoring collapsed ancestors', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /function isTaskSearchActive\(\) \{/);
  assert.match(script, /const isCollapsed = isTaskSearchActive\(\) \? false : Boolean\(collapsedMap\[task\.id\]\);/);
});
