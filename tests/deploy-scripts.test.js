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

test('production Caddy serves every directory the web app imports out of its own tree', () => {
  // The dev server roots at the repo, so a `../../packages/core/x.js` import
  // just works locally. In production only the paths with a `handle` block are
  // static; everything else is proxied to the API, which answers 401 for an
  // unauthenticated module fetch. The page still renders — the module graph
  // silently fails to resolve and no handler in the app ever binds.
  const caddy = readFileSync(resolve(process.cwd(), 'scripts/caddy/brianhub.caddy'), 'utf8');
  const served = [...caddy.matchAll(/handle (\/[^\s*]+)\*/g)].map((match) => match[1]);

  const sources = ['apps/web/app.js', 'apps/web/syncState.js', 'apps/web/api.js', 'apps/web/localData.js'];
  const escapes = new Set();
  for (const source of sources) {
    const text = readFileSync(resolve(process.cwd(), source), 'utf8');
    for (const match of text.matchAll(/from '((?:\.\.\/)+[^']+)'/g)) {
      // apps/web/x.js + ../../packages/core/tree.js -> /packages/core/tree.js
      escapes.add(new URL(match[1], `https://x/${source}`).pathname);
    }
  }
  assert.ok(escapes.size > 0, 'expected the web app to import outside its own directory');

  for (const path of escapes) {
    assert.ok(
      served.some((prefix) => path.startsWith(prefix)),
      `${path} is imported by the web app but no Caddy handle block serves it — production returns 401`
    );
  }
});
