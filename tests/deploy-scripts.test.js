import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);

const shellScripts = [
  'scripts/deploy.sh',
  'scripts/provision-vps.sh',
  'scripts/rollback.sh',
  'scripts/ops/brianhub-admin.sh',
  'scripts/setup-roger-admin.sh',
  'scripts/sync-backups-from-host.sh'
];

for (const script of shellScripts) {
  test(`${script} has valid bash syntax`, async () => {
    await execFileAsync('bash', ['-n', resolve(process.cwd(), script)]);
    assert.ok(true);
  });
}

test('deploy script retries connection-refused health checks and restores current release state on failure', () => {
  const script = readFileSync(resolve(process.cwd(), 'scripts/deploy.sh'), 'utf8');
  assert.match(script, /--retry-connrefused/);
  assert.match(script, /current-release\.txt/);
  assert.match(script, /current-commit\.txt/);
});
