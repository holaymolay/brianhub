import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('tasks page exposes a dedicated mobile add button', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /id="tasks-mobile-add-btn"/);
  assert.match(html, /class="panel-header tasks-mobile-header"/);
});

test('mobile quick add opens task creation directly from tasks view', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /tasksMobileAddBtn\?\.addEventListener\('click'/);
  assert.match(script, /if \(getActiveView\(\) === 'tasks'\) \{\s*runMobileCreateAction\('task'\);/s);
});

test('task modal keeps the action row reachable on mobile', () => {
  const css = readFileSync(resolve(process.cwd(), 'apps/web/styles.css'), 'utf8');
  assert.match(css, /\.modal \{[\s\S]*z-index: 220;/);
  assert.match(css, /#task-modal \.modal-card \{[\s\S]*max-height: calc\(100dvh - 2rem\);/);
  assert.match(css, /#task-modal-form \{[\s\S]*overflow-y: auto;/);
  assert.match(css, /#task-modal-form \.modal-actions \{[\s\S]*position: sticky;[\s\S]*bottom: 0;/);
});
