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
  assert.match(script, /GET \/admin\/service-accounts\/:id\/activity/);
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

test('admin console exposes service-worker, token, and workspace-grant controls', () => {
  const html = readRepoFile('apps/web/index.html');
  assert.match(html, /<h3>Service workers<\/h3>/);
  assert.match(html, /id="admin-service-account-roger-preset"/);
  assert.match(html, /id="admin-service-summary-name"/);
  assert.match(html, /id="admin-service-summary-stats"/);
  assert.match(html, /id="admin-service-setup-note"/);
  assert.match(html, /id="admin-service-account-permissions"/);
  assert.match(html, /<h4>Worker identity &amp; baseline access<\/h4>/);
  assert.match(html, /<h4>Tokens<\/h4>/);
  assert.match(html, /id="admin-service-token-state"/);
  assert.match(html, /id="admin-service-token-editor-title"/);
  assert.match(html, /id="admin-service-token-inherit"/);
  assert.match(html, /id="admin-service-token-reveal"/);
  assert.match(html, /<h4>Workspace access<\/h4>/);
  assert.match(html, /id="admin-service-grant-workspace"/);
  assert.match(html, /id="admin-service-effective-workspaces"/);
  assert.match(html, /id="admin-service-grants-list"/);
  assert.match(html, /<h4>Activity<\/h4>/);
  assert.match(html, /id="admin-service-activity-refresh"/);
  assert.match(html, /id="admin-service-activity-list"/);
});

test('admin console wiring includes service-account API helpers and event handlers', () => {
  const apiScript = readRepoFile('apps/web/api.js');
  assert.match(apiScript, /export function listAdminServiceAccounts/);
  assert.match(apiScript, /export function createAdminServiceAccountToken/);
  assert.match(apiScript, /export function deleteAdminServiceAccountWorkspaceGrant/);
  assert.match(apiScript, /export function listAdminServiceAccountActivity/);

  const appScript = readRepoFile('apps/web/app.js');
  assert.match(appScript, /async function refreshAdminServiceAccounts/);
  assert.match(appScript, /async function createAdminServiceToken/);
  assert.match(appScript, /async function addAdminServiceWorkspaceGrant/);
  assert.match(appScript, /async function refreshAdminServiceAccountActivity/);
  assert.match(appScript, /function renderAdminServiceAccountSummary/);
  assert.match(appScript, /function renderAdminServiceActivityList/);
  assert.match(appScript, /function setAdminServiceTokenState/);
  assert.match(appScript, /function buildAdminServiceTokenPayload/);
  assert.match(appScript, /function presentAdminServiceToken\(rawToken, actionLabel = 'created'\)/);
  assert.match(appScript, /window\.prompt\(\s*`Copy this \$\{actionLabel\} token now\./);
  assert.match(appScript, /void refreshAdminServiceAccounts\(\);/);
  assert.match(appScript, /adminServiceAccountRogerPreset\?\.addEventListener\('click'/);
  assert.match(appScript, /adminServiceTokenRotate\?\.addEventListener\('click'/);
  assert.match(appScript, /adminServiceGrantAdd\?\.addEventListener\('click'/);
  assert.match(appScript, /adminServiceActivityRefresh\?\.addEventListener\('click'/);
});

test('admin console auto-selects existing service accounts and surfaces summary counts', () => {
  const appScript = readRepoFile('apps/web/app.js');
  assert.match(appScript, /function getAdminOrgId\(\)\s*\{\s*return getAuthState\(\)\.user\?\.org_id \?\? DEFAULT_ORG_ID;\s*\}/);
  assert.match(appScript, /function normalizeServiceAccountSummary\(/);
  assert.match(appScript, /function getVisibleAdminServiceAccounts\(\)/);
  assert.match(appScript, /created_by_user_id: account\.created_by_user_id \? String\(account\.created_by_user_id\)\.trim\(\) : ''/);
  assert.match(appScript, /return accounts\.filter\(\(account\) => String\(account\.created_by_user_id \?\? ''\)\.trim\(\) === selectedUser\.id\);/);
  assert.match(appScript, /function syncAdminServiceAccountSelectionForUser\(\)/);
  assert.match(appScript, /function resetAdminServiceAccountDetailState\(/);
  assert.match(appScript, /summary\.active_token_count/);
  assert.match(appScript, /summary\.effective_workspace_count/);
  assert.match(appScript, /visibleAccounts\.length\)\s*\{\s*adminState\.selectedServiceAccountId = visibleAccounts\[0\]\?\.id \?\? '';/);
  assert.match(appScript, /No service workers for \$\{selectedUser\.email \?\? selectedUser\.display_name \?\? 'this user'\} yet\./);
  assert.match(appScript, /refreshAdminServiceAccountActivity\(\)/);
  assert.match(appScript, /This worker has no tokens yet and cannot connect to BrianHub until you generate its first token\./);
});
