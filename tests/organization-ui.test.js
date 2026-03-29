import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('settings expose workspace collaboration controls and in-settings organization management', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /<span class="settings-accordion-title">Workspaces<\/span>/);
  assert.match(html, /This section is workspace-scoped\. It does not create or manage organizations\./);
  assert.match(html, /id="organization-workspace-name"/);
  assert.match(html, /id="organization-workspace-type"/);
  assert.match(html, /id="organization-member-count"/);
  assert.match(html, /id="organization-create-personal"/);
  assert.match(html, /id="organization-create-shared"/);
  assert.match(html, /<span class="settings-accordion-title">Organizations<\/span>/);
  assert.match(html, /id="settings-open-organizations"/);
  assert.match(html, /id="settings-org-create-name"/);
  assert.match(html, /id="settings-org-create-button"/);
  assert.match(html, /id="settings-org-list"/);
  assert.match(html, /id="settings-org-detail"/);
  assert.match(html, /id="settings-org-edit-name"/);
  assert.match(html, /id="settings-org-member-email"/);
  assert.match(html, /id="settings-org-member-role"/);
  assert.match(html, /id="settings-org-member-add"/);
  assert.match(html, /id="settings-org-member-list"/);
  assert.match(html, /id="settings-org-transfer-owner"/);
  assert.match(html, /id="settings-org-transfer-button"/);
  assert.match(html, /id="organizations-page"/);
  assert.match(html, /id="organizations-page-manage"/);
  assert.match(html, /id="organizations-page-back"/);
  assert.match(html, /id="organizations-page-list"/);
});

test('workspace creation uses a dedicated modal with personal and shared types', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /id="workspace-create-modal"/);
  assert.match(html, /id="workspace-create-form"/);
  assert.match(html, /id="workspace-create-name"/);
  assert.match(html, /id="workspace-create-type"/);
  assert.match(html, /<option value="personal">Personal workspace<\/option>/);
  assert.match(html, /<option value="shared">Shared workspace<\/option>/);
});

test('workspace creation flow normalizes shared workspaces and enrolls the creator as a member', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /function normalizeWorkspaceType\(value\)/);
  assert.match(script, /async function ensureWorkspaceCreatorMembership\(workspace, role = null\)/);
  assert.match(script, /async function createWorkspaceRecord\(name, type = 'personal'\)/);
  assert.match(script, /await ensureWorkspaceCreatorMembership\(workspace\);/);
  assert.match(script, /newWorkspaceBtn\.addEventListener\('click', async \(\) => \{\s*workspaceMenu\?\.classList\.add\('hidden'\);[\s\S]*openWorkspaceCreateModal\(\);/s);
});

test('workspace member flow still supports invites by email and local placeholders by name', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /setOrganizationInviteToken\(inviteToken\);/);
  assert.match(script, /await api\.createAdminInvite\(\{\s*workspace_id: state\.workspace\.id,\s*email,\s*role\s*\}\);/s);
  assert.match(script, /await copyInviteLinkToClipboard\(inviteToken, \{\s*setStatus: setOrganizationInviteStatus\s*\}\);/s);
  assert.match(script, /user = await createUserRecord\(\{ display_name: name, email: email \|\| null \}\);/);
});

test('organization settings script supports create, membership management, ownership transfer, and opening org surfaces', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /function normalizeWorkspace\(workspace\) \{\s*if \(!workspace\) return null;/s);
  assert.match(script, /function getOrganizationSettingsState\(\)/);
  assert.match(script, /function getCurrentWorkspaceAnchorId\(\)/);
  assert.match(script, /function getCurrentWorkspaceAnchor\(\)/);
  assert.match(script, /function rememberWorkspaceAnchor\(workspace\)/);
  assert.match(script, /async function refreshOrganizations\(\{ preserveSelection = true \} = \{\}\)/);
  assert.match(script, /async function refreshSelectedOrganizationMembers\(orgId = getSelectedSettingsOrganization\(\)\?\.id \?\? ''\)/);
  assert.match(script, /function renderOrganizationsPage\(\)/);
  assert.match(script, /async function openOrganizationSurface\(orgInput\)/);
  assert.match(script, /async function closeOrganizationSurface\(\)/);
  assert.match(script, /function openOrganizationsPage\(\)/);
  assert.match(script, /async function openOrganizationsEntry\(\{ autoOpenSingle = false \} = \{\}\)/);
  assert.match(script, /function closeOrganizationsPage\(\)/);
  assert.match(script, /function renderOrganizationSidebarList\(\)/);
  assert.match(script, /async function createOrganizationFromSettings\(\)/);
  assert.match(script, /await api\.createOrg\(\{ name \}\)/);
  assert.match(script, /async function saveSelectedOrganizationFromSettings\(\)/);
  assert.match(script, /await api\.updateOrg\(selected\.id, \{ name \}\)/);
  assert.match(script, /async function addOrganizationMemberFromSettings\(\)/);
  assert.match(script, /await api\.addOrgMember\(selected\.id, \{ email, role \}\)/);
  assert.match(script, /await api\.updateOrgMember\(selected\.id, member\.user_id, \{ role: roleSelect\.value \}\)/);
  assert.match(script, /await api\.deleteOrgMember\(selected\.id, member\.user_id\)/);
  assert.match(script, /async function transferSelectedOrganizationOwnership\(\)/);
  assert.match(script, /await api\.transferOrgOwnership\(selected\.id, \{ target_user_id: targetUserId \}\)/);
  assert.match(script, /function handleSidebarSectionButtonClick\(sectionKey\)/);
  assert.match(script, /case 'organizations':\s*openOrganizationsPage\(\);/s);
  assert.match(script, /selectBtn\.addEventListener\('click', \(\) => \{\s*if \(activeOrganizationId === org\.id\) \{\s*void closeOrganizationSurface\(\);[\s\S]*void openOrganizationSurface\(org\);/s);
  assert.match(script, /rememberWorkspaceAnchor\(state\.workspace\);/);
  assert.match(script, /await selectWorkspace\(workspace, \{ preserveView: true \}\);/);
  assert.match(script, /if \(visibleOrganizations\.length === 1\) \{\s*const \[singleOrganization\] = visibleOrganizations;[\s\S]*await openOrganizationSurface\(singleOrganization\);/s);
  assert.match(script, /organizationsPageManage\?\.addEventListener\('click', \(\) => \{\s*openSettings\(\);/s);
  assert.match(script, /settingsOpenOrganizations\?\.addEventListener\('click', \(\) => \{\s*openOrganizationsPage\(\);/s);
});

test('workspace management shows type-aware metadata and conversion controls', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /metaParts = \[getWorkspaceTypeLabelForWorkspace\(workspace\)\];/);
  assert.match(script, /const typeSelect = document\.createElement\('select'\);/);
  assert.match(script, /typeSelect\.className = 'setting-input workspace-manage-type';/);
  assert.match(script, /await api\.updateWorkspace\(workspace\.id, \{ type: typeSelect\.value \}\);/);
});
