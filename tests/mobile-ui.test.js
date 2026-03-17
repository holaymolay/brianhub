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
