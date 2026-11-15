/* School Management System service worker.
 * - Precaches the complete application shell (list generated at build time) for offline start.
 * - Navigations: network first, falling back to the cached shell (SPA routing offline).
 * - Hashed assets: cache first.
 * - /uploads (logos, photos): stale-while-revalidate.
 * - /api is NEVER cached here: data offline is handled by IndexedDB in the app, which knows
 *   what is stale and what is pending synchronisation.
 */
const SHELL = 'sms-shell-';
const MEDIA = 'sms-media-v1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('/precache-manifest.json', { cache: 'no-store' });
    const { version, files } = await res.json();
    const cache = await caches.open(SHELL + version);
    await cache.addAll(files);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('/precache-manifest.json', { cache: 'no-store' }).catch(() => null);
    const current = res ? SHELL + (await res.json()).version : null;
    for (const key of await caches.keys()) {
      if (key.startsWith(SHELL) && current && key !== current) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

async function fromShell(request) {
  const keys = (await caches.keys()).filter((k) => k.startsWith(SHELL));
  for (const k of keys.reverse()) {
    const hit = await (await caches.open(k)).match(request, { ignoreSearch: true });
    if (hit) return hit;
  }
  return null;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(req); } catch { return (await fromShell('/index.html')) || Response.error(); }
    })());
    return;
  }
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA);
      const hit = await cache.match(req);
      const net = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }
  event.respondWith((async () => (await fromShell(req)) || fetch(req))());
});
