/* 家影 service worker: caches only the app's own static files. User data lives in IndexedDB. */
const VERSION = '__VERSION__';
const CACHE = 'jiaying-app-' + VERSION;
const PRECACHE = [/*__PRECACHE__*/];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('jiaying-app-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function checkComplete() {
  const cache = await caches.open(CACHE);
  for (const u of PRECACHE) if (!(await cache.match(u, { ignoreVary: true }))) return false;
  return true;
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'check-offline') {
    checkComplete().then((ok) => event.source && event.source.postMessage({ type: 'offline-status', ok, version: VERSION }));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Match on URL only: hosts often send `Vary` (Origin, Accept-Encoding), and module/CSS
    // requests carry an Origin header the precache requests did not.
    const opts = { ignoreSearch: true, ignoreVary: true };
    if (req.mode === 'navigate') {
      return (await cache.match('./', opts)) || (await cache.match('./index.html', opts)) || fetch(req);
    }
    const hit = await cache.match(url.href, opts);
    return hit || fetch(req);
  })());
});
