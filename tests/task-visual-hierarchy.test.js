import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('task renderer marks nested tasks with depth-aware subtask styling hooks', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /const depth = Number\.isFinite\(options\.depth\) \? options\.depth : 0;/);
  assert.match(script, /item\.dataset\.depth = String\(depth\);/);
  assert.match(script, /item\.classList\.toggle\('is-subtask', depth > 0\);/);
  assert.match(script, /const childNode = renderTask\(child, \{\s*completedVisibility,\s*futureVisibilityDays,\s*depth: depth \+ 1\s*\}\);/s);
});

test('subtasks have distinct visual contrast from root tasks', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(css, /\.task-item:hover \{/);
  assert.match(css, /\.task-item\.is-subtask \{/);
  assert.match(css, /\.task-item\.is-subtask:hover \{/);
  assert.match(css, /\.task-item\.is-subtask \.task-title \{/);
  assert.match(css, /\.task-item\.is-subtask \.task-meta \{/);
  assert.match(css, /\.task-item\.is-subtask\.is-selected \{/);
});
