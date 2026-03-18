import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('settings expose a help launcher and a dedicated help page', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /id="settings-open-help"/);
  assert.match(html, /id="help-page"/);
  assert.match(html, /<h2>Help<\/h2>/);
});

test('help page documents sections through group labels instead of parent tasks', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /group_label/);
  assert.match(html, /Do not model sections as parent tasks with subtasks\./);
});

test('help page is wired into settings linked-page navigation', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /const helpPage = document\.getElementById\('help-page'\);/);
  assert.match(script, /const settingsOpenHelp = document\.getElementById\('settings-open-help'\);/);
  assert.match(script, /settingsOpenHelp\?\.addEventListener\('click', \(\) => \{\s*openSettingsLinkedPage\('help'\);/s);
  assert.match(script, /helpBack\?\.addEventListener\('click', returnFromSettingsLinkedPage\);/);
  assert.match(script, /const NAVIGABLE_VIEWS = new Set\(\[[\s\S]*'help'/s);
  assert.match(script, /const showHelp = view === 'help';/);
  assert.match(script, /helpPage\?\.classList\.toggle\('hidden', !showHelp\);/);
});
