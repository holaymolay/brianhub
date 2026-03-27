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
