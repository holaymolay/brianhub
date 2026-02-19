import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptBuffer, encryptBuffer, resolveEncryptionKey } from '../scripts/lib/backup-crypto.js';

test('backup encryption roundtrip works with passphrase key', () => {
  const key = resolveEncryptionKey('local-dev-passphrase');
  const plaintext = Buffer.from('brianhub-backup-payload', 'utf8');
  const encrypted = encryptBuffer(plaintext, key);
  const decrypted = decryptBuffer(encrypted, key);
  assert.deepEqual(decrypted, plaintext);
});

test('backup key resolver accepts explicit hex input', () => {
  const key = resolveEncryptionKey('hex:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');
  assert.equal(Buffer.isBuffer(key), true);
  assert.equal(key.length, 32);
});

