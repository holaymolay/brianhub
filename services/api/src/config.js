import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VALID_NODE_ENVS = new Set(['development', 'test', 'production']);
const VALID_LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

let cachedConfig = null;

function parseBoolean(name, value, defaultValue = false, errors = []) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  errors.push(`${name} must be a boolean`);
  return defaultValue;
}

function parseInteger(name, value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, defaultValue = 0 } = {}, errors = []) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric)) {
    errors.push(`${name} must be an integer`);
    return defaultValue;
  }
  if (numeric < min || numeric > max) {
    errors.push(`${name} must be between ${min} and ${max}`);
    return defaultValue;
  }
  return numeric;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

function parseCorsOrigins(raw, errors) {
  const value = String(raw ?? '*').trim();
  if (!value || value === '*') return ['*'];
  const origins = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!origins.length) return ['*'];
  origins.forEach((origin) => {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push(`invalid CORS origin protocol: ${origin}`);
      }
    } catch {
      errors.push(`invalid CORS origin URL: ${origin}`);
    }
  });
  return origins;
}

function stripQuotes(value) {
  const text = String(value ?? '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function loadDotEnvForDev(env = process.env) {
  const nodeEnv = String(env.NODE_ENV ?? 'development').trim().toLowerCase() || 'development';
  if (nodeEnv === 'production') return;
  const dotEnvPath = resolve(process.cwd(), '.env');
  if (!existsSync(dotEnvPath)) return;
  const file = readFileSync(dotEnvPath, 'utf8');
  for (const line of file.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(env, key)) continue;
    const rawValue = trimmed.slice(equalsIndex + 1);
    env[key] = stripQuotes(rawValue);
  }
}

function buildApiConfig(env = process.env) {
  loadDotEnvForDev(env);
  const errors = [];
  const nodeEnv = String(env.NODE_ENV ?? 'development').trim().toLowerCase() || 'development';
  if (!VALID_NODE_ENVS.has(nodeEnv)) {
    errors.push(`NODE_ENV must be one of: ${Array.from(VALID_NODE_ENVS).join(', ')}`);
  }

  const host = String(env.HOST ?? '0.0.0.0').trim() || '0.0.0.0';
  const port = parseInteger('PORT', env.PORT, { min: 1, max: 65535, defaultValue: 3000 }, errors);
  const logLevel = String(env.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : 'debug')).trim().toLowerCase();
  if (!VALID_LOG_LEVELS.has(logLevel)) {
    errors.push(`LOG_LEVEL must be one of: ${Array.from(VALID_LOG_LEVELS).join(', ')}`);
  }

  const dbPath = String(env.BRIANHUB_DB ?? 'data/brianhub.sqlite').trim() || 'data/brianhub.sqlite';
  const migrationsDir = String(env.BRIANHUB_MIGRATIONS ?? 'services/api/db/migrations').trim() || 'services/api/db/migrations';
  const appOrigin = String(env.BRIANHUB_APP_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (appOrigin) {
    try {
      const originUrl = new URL(appOrigin);
      if (!['http:', 'https:'].includes(originUrl.protocol)) {
        errors.push('BRIANHUB_APP_ORIGIN must use http or https');
      }
    } catch {
      errors.push('BRIANHUB_APP_ORIGIN must be a valid URL');
    }
  }

  const corsOrigins = parseCorsOrigins(env.BRIANHUB_CORS_ORIGINS ?? env.CORS_ORIGINS ?? (appOrigin || '*'), errors);
  const ownerSuperAdminEmail = String(env.BRIANHUB_OWNER_EMAIL ?? 'brian@pipecaminc.com').trim().toLowerCase();
  if (!isValidEmail(ownerSuperAdminEmail)) {
    errors.push('BRIANHUB_OWNER_EMAIL must be a valid email');
  }

  const exposeInviteToken = parseBoolean('BRIANHUB_EXPOSE_INVITE_TOKEN', env.BRIANHUB_EXPOSE_INVITE_TOKEN, false, errors);
  const requireAuth = parseBoolean('BRIANHUB_REQUIRE_AUTH', env.BRIANHUB_REQUIRE_AUTH, false, errors);
  const allowHeaderActorAuth = parseBoolean(
    'BRIANHUB_ALLOW_HEADER_ACTOR_AUTH',
    env.BRIANHUB_ALLOW_HEADER_ACTOR_AUTH,
    true,
    errors
  );
  const sessionCookieName = String(env.BRIANHUB_SESSION_COOKIE_NAME ?? 'brianhub_session').trim() || 'brianhub_session';
  if (!/^[A-Za-z0-9_.-]{3,64}$/.test(sessionCookieName)) {
    errors.push('BRIANHUB_SESSION_COOKIE_NAME must be 3-64 chars (letters, digits, underscore, dot, dash)');
  }
  const sessionTtlDays = parseInteger(
    'BRIANHUB_SESSION_TTL_DAYS',
    env.BRIANHUB_SESSION_TTL_DAYS,
    { min: 1, max: 365, defaultValue: 30 },
    errors
  );
  const rateLimitWindowMs = parseInteger('BRIANHUB_RATE_LIMIT_WINDOW_MS', env.BRIANHUB_RATE_LIMIT_WINDOW_MS, { min: 1000, max: 3_600_000, defaultValue: 60_000 }, errors);
  const rateLimitMax = parseInteger('BRIANHUB_RATE_LIMIT_MAX', env.BRIANHUB_RATE_LIMIT_MAX, { min: 1, max: 50_000, defaultValue: 300 }, errors);

  if (errors.length) {
    const details = errors.map((error) => `- ${error}`).join('\n');
    throw new Error(`Invalid API configuration:\n${details}`);
  }

  return {
    nodeEnv,
    host,
    port,
    logLevel,
    dbPath,
    migrationsDir,
    appOrigin,
    corsOrigins,
    ownerSuperAdminEmail,
    exposeInviteToken,
    requireAuth,
    allowHeaderActorAuth,
    sessionCookieName,
    sessionTtlDays,
    rateLimits: {
      windowMs: rateLimitWindowMs,
      max: rateLimitMax
    }
  };
}

export function getApiConfig(env = process.env, { force = false } = {}) {
  if (!force && env === process.env && cachedConfig) {
    return cachedConfig;
  }
  const config = buildApiConfig(env);
  if (env === process.env && !force) {
    cachedConfig = config;
  }
  return config;
}
