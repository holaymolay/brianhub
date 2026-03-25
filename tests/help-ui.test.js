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
  assert.match(script, /scheduled_for/);
  assert.match(script, /POST \/tasks\/:id\/convert-to-shopping-item/);
  assert.match(script, /GET \/agent-events\?workspace_id=<uuid>/);
  assert.match(script, /PATCH \/agent-events\/:id/);
  assert.match(script, /service_account_auth: available-v1/);
  assert.match(script, /Authorization: Bearer <token>/);
  assert.match(script, /GET \/admin\/service-accounts/);
  assert.match(script, /POST \/admin\/service-accounts\/:id\/tokens/);
  assert.match(script, /telegram_group/);
  assert.match(script, /tasks\.delete/);
  assert.match(script, /GET \/projects\?workspace_id=<uuid>/);
  assert.match(script, /GET \/notice-types\?workspace_id=<uuid>/);
  assert.match(script, /POST \/sync\/pull/);
  assert.match(script, /principal_type/);
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

test('admin console exposes service-account, token, and workspace-grant controls', () => {
  const html = readRepoFile('apps/web/index.html');
  assert.match(html, /<h3>Service accounts<\/h3>/);
  assert.match(html, /id="admin-service-account-roger-preset"/);
  assert.match(html, /id="admin-service-account-permissions"/);
  assert.match(html, /<h3>Token access<\/h3>/);
  assert.match(html, /id="admin-service-token-inherit"/);
  assert.match(html, /id="admin-service-token-reveal"/);
  assert.match(html, /<h3>Workspace grants<\/h3>/);
  assert.match(html, /id="admin-service-grant-workspace"/);
  assert.match(html, /id="admin-service-grants-list"/);
});

test('admin console wiring includes service-account API helpers and event handlers', () => {
  const apiScript = readRepoFile('apps/web/api.js');
  assert.match(apiScript, /export function listAdminServiceAccounts/);
  assert.match(apiScript, /export function createAdminServiceAccountToken/);
  assert.match(apiScript, /export function deleteAdminServiceAccountWorkspaceGrant/);

  const appScript = readRepoFile('apps/web/app.js');
  assert.match(appScript, /async function refreshAdminServiceAccounts/);
  assert.match(appScript, /async function createAdminServiceToken/);
  assert.match(appScript, /async function addAdminServiceWorkspaceGrant/);
  assert.match(appScript, /void refreshAdminServiceAccounts\(\);/);
  assert.match(appScript, /adminServiceAccountRogerPreset\?\.addEventListener\('click'/);
  assert.match(appScript, /adminServiceTokenRotate\?\.addEventListener\('click'/);
  assert.match(appScript, /adminServiceGrantAdd\?\.addEventListener\('click'/);
});
