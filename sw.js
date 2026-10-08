/* Service worker : appli disponible hors ligne + tuiles de carte en cache */
const APP = 'app-v6', TILES = 'tiles-v1';
const SHELL = ['./', 'index.html', 'app.css?v=6', 'app.js?v=6', 'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const TILE_HOSTS = /(^|\.)(tile\.opentopomap\.org|tile\.openstreetmap\.org)$/;
// a/b/c.tile.opentopomap.org servent les mêmes tuiles : une seule clé de cache
const tileKey = u => u.replace(/^https:\/\/[abc]\.tile\.opentopomap\.org/, 'https://tile.opentopomap.org');

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP && k !== TILES && k !== 'shared').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);

  // GPX partagé depuis une autre appli : on le garde de côté puis on ouvre l'appli
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      try {
        const f = (await req.formData()).get('gpx');
        if (f && typeof f !== 'string') await (await caches.open('shared')).put('shared.gpx', new Response(await f.text()));
      } catch { /* fichier illisible : l'appli le signalera */ }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;

  // Tuiles : cache d'abord, sinon réseau puis mise en cache
  if (TILE_HOSTS.test(url.hostname)) {
    const key = tileKey(req.url);
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(key);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok) c.put(key, r.clone());
        return r;
      } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }

  // Fichiers de l'appli : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
  if (url.origin === location.origin) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(APP).then(c => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
