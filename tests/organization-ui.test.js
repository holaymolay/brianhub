import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('settings expose a workspace collaboration section and a separate organizations placeholder', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  assert.match(html, /<span class="settings-accordion-title">Workspaces<\/span>/);
  assert.match(html, /This section is workspace-scoped\. It does not create or manage organizations\./);
  assert.match(html, /id="organization-workspace-name"/);
  assert.match(html, /id="organization-workspace-type"/);
  assert.match(html, /id="organization-member-count"/);
  assert.match(html, /id="organization-create-personal"/);
  assert.match(html, /id="organization-create-shared"/);
  assert.match(html, /<span class="settings-accordion-title">Organizations<\/span>/);
  assert.match(html, /Organization creation, membership, and org settings are being rebuilt as a separate surface\./);
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

test('organization member flow supports invites by email and local placeholders by name', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /setOrganizationInviteToken\(inviteToken\);/);
  assert.match(script, /await api\.createAdminInvite\(\{\s*workspace_id: state\.workspace\.id,\s*email,\s*role\s*\}\);/s);
  assert.match(script, /await copyInviteLinkToClipboard\(inviteToken, \{\s*setStatus: setOrganizationInviteStatus\s*\}\);/s);
  assert.match(script, /user = await createUserRecord\(\{ display_name: name, email: email \|\| null \}\);/);
});

test('workspace management shows type-aware metadata and conversion controls', () => {
  const script = readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
  assert.match(script, /metaParts = \[getWorkspaceTypeLabelForWorkspace\(workspace\)\];/);
  assert.match(script, /const typeSelect = document\.createElement\('select'\);/);
  assert.match(script, /typeSelect\.className = 'setting-input workspace-manage-type';/);
  assert.match(script, /await api\.updateWorkspace\(workspace\.id, \{ type: typeSelect\.value \}\);/);
});
