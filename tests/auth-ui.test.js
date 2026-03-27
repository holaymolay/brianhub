import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readAppScript() {
  return readFileSync(resolve(process.cwd(), 'apps/web/app.js'), 'utf8');
}

test('auth resets clear persisted workspace domain state and pending local changes', () => {
  const script = readAppScript();
  assert.match(script, /function clearWorkspaceDomainData\(\{\s*preserveWorkspaces = false,\s*clearPendingChanges = true,\s*resetAdminState = true\s*\} = \{\}\)/s);
  assert.match(script, /const cleared = prepareLocalDataForStorage\(\{\s*localSeq: clearPendingChanges \? 0 : \(state\.local\?\.localSeq \?\? 0\),\s*pendingChanges: clearPendingChanges \? \[\] : \(state\.local\?\.pendingChanges \?\? \[\]\),/s);
  assert.match(script, /state\.local\.pendingChanges = cleared\.pendingChanges \?\? \[\];/);
  assert.match(script, /if \(resetAdminState\) \{\s*state\.ui\.admin = \{\};\s*\}/s);
  assert.match(script, /persistLocalData\(\);/);
});

test('workspace reload path drops stale data when auth or access is no longer valid', () => {
  const script = readAppScript();
  assert.match(script, /function isWorkspaceDataResetStatus\(status\) \{\s*const candidate = Number\(status\);\s*return candidate === 401 \|\| candidate === 403 \|\| candidate === 404;\s*\}/s);
  assert.match(script, /if \(isWorkspaceDataResetStatus\(err\?\.status\)\) \{\s*clearWorkspaceDomainData\(\{ clearPendingChanges: true, resetAdminState: true \}\);\s*return;\s*\}/s);
  assert.match(script, /if \(isWorkspaceDataResetStatus\(err\?\.status\)\) \{\s*const failedWorkspaceId = state\.workspace\?\.id \?\? null;[\s\S]*clearWorkspaceDomainData\(\{\s*preserveWorkspaces: errStatus !== 401,\s*clearPendingChanges: true,\s*resetAdminState: true\s*\}\);[\s\S]*if \(errStatus !== 401\) \{\s*await loadWorkspaces\(\);[\s\S]*if \(state\.workspace\?\.id && state\.workspace\.id !== failedWorkspaceId\) \{\s*await loadWorkspaceData\(\);\s*\}/s);
  assert.match(script, /async function reloadWorkspaceAfterAuthChange\(\) \{\s*clearWorkspaceDomainData\(\{ clearPendingChanges: true, resetAdminState: true \}\);/s);
});

test('sync loop treats access failures as state resets and preserves blocked queue messaging', () => {
  const script = readAppScript();
  assert.match(script, /async function handleSyncAccessFailure\(error\) \{\s*const status = Number\(error\?\.status \?\? error\?\.statusCode \?\? 0\);\s*if \(!isWorkspaceDataResetStatus\(status\)\) return false;/s);
  assert.match(script, /clearWorkspaceDomainData\(\{\s*preserveWorkspaces: status !== 401,\s*clearPendingChanges: true,\s*resetAdminState: true\s*\}\);/s);
  assert.match(script, /if \(blocked\) \{\s*if \(await handleSyncAccessFailure\(\{ status: blocked\.last_error_code \}\)\) \{\s*return;\s*\}\s*if \(syncStatus\) syncStatus\.textContent = 'Sync blocked · action required';/s);
  assert.match(script, /if \(pushResult\.error && await handleSyncAccessFailure\(pushResult\.error\)\) \{\s*return;\s*\}/s);
  assert.match(script, /catch \(error\) \{\s*if \(await handleSyncAccessFailure\(error\)\) \{\s*updateSyncOfflineNotice\(\);\s*return;\s*\}\s*registerSyncFailure\(\);/s);
});
