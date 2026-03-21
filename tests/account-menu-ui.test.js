import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readRepoFile(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

test('account menu closes on outside pointer interaction', () => {
  const script = readRepoFile('apps/web/app.js');
  assert.match(script, /function closeAccountMenu\(\) \{/);
  assert.match(script, /document\.addEventListener\('pointerdown', \(event\) => \{/);
  assert.match(script, /if \(!accountMenuWrapper \|\| !accountMenu \|\| accountMenu\.classList\.contains\('hidden'\)\) return;/);
  assert.match(script, /if \(target\.closest\('\.account-menu-wrapper'\)\) return;/);
  assert.match(script, /closeAccountMenu\(\);/);
});
