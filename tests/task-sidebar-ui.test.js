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

test('task sidebar points projects to the dedicated Projects view', () => {
  const script = readRepoFile('apps/web/app.js');
  assert.match(script, /note\.textContent = 'Projects live in the Projects page\.'/);
  assert.match(script, /openButton\.textContent = 'Open Projects';/);
  assert.match(script, /openButton\.addEventListener\('click', \(\) => \{\s*setActiveView\('projects'\);\s*render\(\);\s*\}\);/s);
  assert.match(script, /newProjectBtn\?\.addEventListener\('click', async \(\) => \{[\s\S]*setActiveView\('projects'\);[\s\S]*render\(\);[\s\S]*\}\);/);
});
