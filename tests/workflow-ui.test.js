import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('workflows page renders an explicit empty placeholder when no workflows exist', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(
    script,
    /if \(!workflow\) \{\s*const emptyState = document\.createElement\('div'\);\s*emptyState\.className = 'workflow-section';\s*const empty = document\.createElement\('div'\);\s*empty\.className = 'sidebar-note';\s*empty\.textContent = 'No workflows yet\.';\s*emptyState\.appendChild\(empty\);\s*workflowDetailEl\.appendChild\(emptyState\);\s*return;\s*\}/s
  );
});
