function readRuntimeConfig() {
  if (typeof window === 'undefined') return {};
  const runtime = window.__BRIANHUB_CONFIG__;
  if (!runtime || typeof runtime !== 'object') return {};
  return runtime;
}

function defaultApiBaseFromLocation() {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  const { protocol, hostname, port, origin } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal && port === '5173') {
    return `${protocol}//${hostname}:3000`;
  }
  return origin;
}

function normalizeApiBase(value) {
  const text = String(value ?? '').trim();
  if (!text) return defaultApiBaseFromLocation();
  return text.replace(/\/+$/, '');
}

export function getWebConfig() {
  const runtime = readRuntimeConfig();
  const apiBase = normalizeApiBase(runtime.apiBase ?? runtime.API_BASE);
  const logLevel = String(runtime.logLevel ?? runtime.LOG_LEVEL ?? 'info').trim().toLowerCase() || 'info';
  return {
    apiBase,
    logLevel,
    featureFlags: runtime.featureFlags && typeof runtime.featureFlags === 'object'
      ? runtime.featureFlags
      : {}
  };
}

export const webConfig = getWebConfig();

