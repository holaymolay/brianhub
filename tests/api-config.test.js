import test from 'node:test';
import assert from 'node:assert/strict';
import { getApiConfig } from '../services/api/src/config.js';

test('API config validates and returns normalized settings', () => {
  const env = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3200',
    LOG_LEVEL: 'info',
    BRIANHUB_DB: 'data/test.sqlite',
    BRIANHUB_MIGRATIONS: 'services/api/db/migrations',
    BRIANHUB_APP_ORIGIN: 'https://brianhub.com/',
    BRIANHUB_CORS_ORIGINS: 'https://brianhub.com,https://api.brianhub.com',
    BRIANHUB_OWNER_EMAIL: 'brian@pipecaminc.com',
    BRIANHUB_EXPOSE_INVITE_TOKEN: 'false'
  };
  const config = getApiConfig(env, { force: true });
  assert.equal(config.nodeEnv, 'test');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3200);
  assert.equal(config.dbPath, 'data/test.sqlite');
  assert.equal(config.appOrigin, 'https://brianhub.com');
  assert.deepEqual(config.corsOrigins, ['https://brianhub.com', 'https://api.brianhub.com']);
  assert.equal(config.ownerSuperAdminEmail, 'brian@pipecaminc.com');
  assert.equal(config.exposeInviteToken, false);
});

test('API config fails fast on invalid values', () => {
  const env = {
    NODE_ENV: 'invalid-env',
    PORT: '-1',
    LOG_LEVEL: 'verbose',
    BRIANHUB_OWNER_EMAIL: 'not-an-email',
    BRIANHUB_CORS_ORIGINS: 'notaurl'
  };
  assert.throws(
    () => getApiConfig(env, { force: true }),
    /Invalid API configuration/
  );
});

