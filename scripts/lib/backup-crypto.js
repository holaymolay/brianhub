import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const ENCRYPTION_HEADER_VERSION = 1;

function parseAsHex(text) {
  if (!/^[a-f0-9]+$/i.test(text)) return null;
  if (text.length % 2 !== 0) return null;
  const output = Buffer.from(text, 'hex');
  return output.length ? output : null;
}

function parseAsBase64(text) {
  try {
    const output = Buffer.from(text, 'base64');
    return output.length ? output : null;
  } catch {
    return null;
  }
}

export function resolveEncryptionKey(rawKey) {
  if (!rawKey) return null;
  const text = String(rawKey).trim();
  if (!text) return null;

  if (text.startsWith('hex:')) {
    const parsed = parseAsHex(text.slice(4));
    if (!parsed) throw new Error('Invalid hex key in BRIANHUB_BACKUP_ENCRYPTION_KEY.');
    return createHash('sha256').update(parsed).digest();
  }

  if (text.startsWith('base64:')) {
    const parsed = parseAsBase64(text.slice(7));
    if (!parsed) throw new Error('Invalid base64 key in BRIANHUB_BACKUP_ENCRYPTION_KEY.');
    return createHash('sha256').update(parsed).digest();
  }

  const hex = parseAsHex(text);
  if (hex && (hex.length === 16 || hex.length === 24 || hex.length === 32)) {
    return createHash('sha256').update(hex).digest();
  }

  const b64 = parseAsBase64(text);
  if (b64 && (b64.length === 16 || b64.length === 24 || b64.length === 32)) {
    return createHash('sha256').update(b64).digest();
  }

  // Treat any other value as a passphrase.
  return createHash('sha256').update(text, 'utf8').digest();
}

export function encryptBuffer(buffer, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  const header = {
    v: ENCRYPTION_HEADER_VERSION,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64')
  };
  return Buffer.concat([
    Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'),
    encrypted
  ]);
}

export function decryptBuffer(buffer, key) {
  const separator = buffer.indexOf(10); // newline
  if (separator <= 0) {
    throw new Error('Invalid encrypted backup format: missing header.');
  }
  const headerText = buffer.subarray(0, separator).toString('utf8');
  const payload = buffer.subarray(separator + 1);
  let header;
  try {
    header = JSON.parse(headerText);
  } catch {
    throw new Error('Invalid encrypted backup format: malformed header.');
  }
  if (header?.alg !== 'aes-256-gcm') {
    throw new Error(`Unsupported backup encryption algorithm: ${header?.alg ?? 'unknown'}.`);
  }

  const iv = Buffer.from(header.iv, 'base64');
  const tag = Buffer.from(header.tag, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload), decipher.final()]);
}

export function encryptFile(inputPath, outputPath, key) {
  const plaintext = readFileSync(inputPath);
  const encrypted = encryptBuffer(plaintext, key);
  writeFileSync(outputPath, encrypted);
}

export function decryptFile(inputPath, key) {
  const encrypted = readFileSync(inputPath);
  return decryptBuffer(encrypted, key);
}

