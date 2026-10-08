/* Service worker : appli disponible hors ligne + tuiles de carte en cache */
const APP = 'app-v1', TILES = 'tiles-v1';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'vendor/leaflet.js', 'vendor/leaflet.css',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const TILE_HOSTS = /(^|\.)(tile\.opentopomap\.org|tile\.openstreetmap\.org)$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP && k !== TILES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Tuiles : cache d'abord, sinon réseau puis mise en cache (les zones vues restent dispo hors ligne)
  if (TILE_HOSTS.test(url.hostname)) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req.url);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok) c.put(req.url, r.clone());
        return r;
      } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }

  // Fichiers de l'appli : réseau d'abord (mises à jour), cache si hors ligne
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(APP).then(c => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
