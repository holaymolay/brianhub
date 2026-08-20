// API base resolution for the standalone shopping PWA.
//
// This is deliberately a copy of the apps/web logic rather than an import. The
// shopping app has to keep working once shopping is removed from the web
// monolith, and a service worker precache is much simpler when every module it
// caches lives under /apps/shopping/.
function readRuntimeConfig() {
  if (typeof window === 'undefined') return {};
  const runtime = window.__BRIANHUB_SHOPPING_CONFIG__ ?? window.__BRIANHUB_CONFIG__;
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

export function normalizeApiBase(value) {
  const text = String(value ?? '').trim();
  if (!text) return defaultApiBaseFromLocation();
  return text.replace(/\/+$/, '');
}

export function getShoppingConfig() {
  const runtime = readRuntimeConfig();
  return {
    apiBase: normalizeApiBase(runtime.apiBase ?? runtime.API_BASE),
    // How often to poll /sync/pull while the app is visible and online.
    syncPollIntervalMs: Number(runtime.syncPollIntervalMs ?? 15000)
  };
}

export const shoppingConfig = getShoppingConfig();
