// Service worker for the shopping PWA.
//
// Scope is /apps/shopping/ and ONLY assets under that path are ever cached.
// API responses are deliberately never cached — the offline data story is
// localStorage plus the pending write queue, and a stale cached JSON response
// would silently contradict it.
const CACHE_VERSION = 'brianhub-shopping-v2';
const SHELL_PATH = '/apps/shopping/';
const SHELL_URL = '/apps/shopping/index.html';

const PRECACHE_URLS = [
  SHELL_URL,
  '/apps/shopping/app.js',
  '/apps/shopping/api.js',
  '/apps/shopping/config.js',
  '/apps/shopping/store.js',
  '/apps/shopping/queue.js',
  '/apps/shopping/sync.js',
  '/apps/shopping/styles.css',
  '/apps/shopping/manifest.webmanifest',
  '/apps/shopping/icon.svg',
  '/apps/shopping/icon-192.png',
  '/apps/shopping/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // addAll is all-or-nothing; cache entries individually so one missing
      // optional asset cannot block the whole install.
      .then((cache) => Promise.all(
        PRECACHE_URLS.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Network-first, cache as fallback.
//
// Deliberately NOT stale-while-revalidate. SWR serves the previous version of
// app.js on the first load after a deploy, so an online user runs one-release-old
// code against a current API — and the bug only disappears on the next reload.
// These files are a few KB; correctness is worth the round trip. The cache is
// what makes the app work with no signal, not what makes it fast.
async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('offline and uncached');
  }
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(SHELL_URL);
    if (cached) return cached;
    return new Response('Offline and no cached app shell yet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && url.pathname.startsWith(SHELL_PATH)) {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.pathname.startsWith(SHELL_PATH)) {
    event.respondWith(networkFirst(request));
  }
});
