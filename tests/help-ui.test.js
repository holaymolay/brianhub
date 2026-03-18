import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readRepoFile(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

test('settings expose a Help launcher', () => {
  const html = readRepoFile('apps/web/index.html');
  assert.match(html, /id="settings-open-help"/);
  assert.match(html, />Help</);
  assert.match(html, /Browse BrianHub documentation, including the API reference/i);
});

test('in-app help page is a documentation hub with API navigation', () => {
  const html = readRepoFile('apps/web/index.html');
  assert.match(html, /id="help-page"/);
  assert.match(html, /<h2>Help &amp; Documentation<\/h2>/);
  assert.match(html, /Documentation home/);
  assert.match(html, /API documentation/);
  assert.match(html, /id="help-open-url"/);
  assert.match(html, /id="help-api-url"/);
});

test('dedicated API help page exists at its own URL path and is plain-text oriented', () => {
  const html = readRepoFile('apps/web/help/api/index.html');
  assert.match(html, /<title>BrianHub API Help<\/title>/);
  assert.match(html, /id="api-help-copy"/);
  assert.match(html, /<pre id="api-help-doc" class="api-help-doc"/);
  assert.match(html, /\/apps\/web\/help\/api\//);
  assert.match(html, /Single-column markdown reference for implementing the BrianHub product API/i);
  assert.doesNotMatch(html, /api-help-meta/);
});

test('shared BrianHub API docs module documents the current resource model', () => {
  const script = readRepoFile('apps/web/help/api-docs.js');
  assert.match(script, /export const BRIANHUB_API_HELP_PATH = '\/apps\/web\/help\/api\/';/);
  assert.match(script, /group_label/);
  assert.match(script, /Do not model sections as parent tasks or subtasks/);
  assert.match(script, /GET \/shopping-lists\?workspace_id=<uuid>/);
  assert.match(script, /GET \/projects\?workspace_id=<uuid>/);
  assert.match(script, /GET \/notice-types\?workspace_id=<uuid>/);
  assert.match(script, /POST \/sync\/pull/);
  assert.match(script, /GET \/admin\/info/);
});

test('app wiring opens the in-app help hub and the dedicated API help url', () => {
  const script = readRepoFile('apps/web/app.js');
  assert.match(script, /import \{ buildBrianhubApiHelpUrl \} from '\.\/help\/api-docs\.js';/);
  assert.match(script, /function openBrianhubApiHelpPage\(\)/);
  assert.match(script, /window\.location\.assign\(buildBrianhubApiHelpUrl\(window\.location\.origin\)\);/);
  assert.match(script, /settingsOpenHelp\?\.addEventListener\('click', \(\) => \{\s*openSettingsLinkedPage\('help'\);/);
  assert.match(script, /helpOpenUrl\?\.addEventListener\('click', openBrianhubApiHelpPage\);/);
  assert.match(script, /helpApiUrl\.textContent = helpUrl;/);
});
