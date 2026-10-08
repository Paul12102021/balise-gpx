/* Service worker : appli disponible hors ligne + tuiles de carte en cache */
const APP = 'app-v18', TILES = 'tiles-v2';
const SHELL = ['./', 'index.html', 'app.css?v=18', 'app.js?v=18', 'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css',
  'departements.json', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

// Clé de cache commune avec la page : https://tiles.balise/<fond>/<z>/<x>/<y>
const tileKey = (prov, z, x, y) => `https://tiles.balise/${prov}/${z}/${x}/${y}`;
function parseTile(url) {
  let m;
  if (/(^|\.)tile\.opentopomap\.org$/.test(url.hostname) && (m = url.pathname.match(/^\/(\d+)\/(\d+)\/(\d+)\.png$/)))
    return { prov: 'topo', z: +m[1], x: +m[2], y: +m[3] };
  if (/(^|\.)tile-cyclosm\.openstreetmap\.fr$/.test(url.hostname) && (m = url.pathname.match(/^\/cyclosm\/(\d+)\/(\d+)\/(\d+)\.png$/)))
    return { prov: 'cyclosm', z: +m[1], x: +m[2], y: +m[3] };
  if (url.hostname === 'tile.openstreetmap.org' && (m = url.pathname.match(/^\/(\d+)\/(\d+)\/(\d+)\.png$/)))
    return { prov: 'osm', z: +m[1], x: +m[2], y: +m[3] };
  if (url.hostname === 'data.geopf.fr' && /GetTile/i.test(url.searchParams.get('REQUEST') || ''))
    return { prov: 'ign', z: +url.searchParams.get('TILEMATRIX'), x: +url.searchParams.get('TILECOL'), y: +url.searchParams.get('TILEROW') };
  return null;
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP && k !== TILES && k !== 'shared').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function fetchWithTimeout(req, ms) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(req, { signal: ctrl.signal }); } finally { clearTimeout(t); }
}

// Sans tuile à ce zoom : on agrandit une tuile moins détaillée déjà en mémoire (un peu floue, mais lisible)
async function overzoom(cache, t) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  const provs = t.prov === 'ign' ? ['ign'] : [t.prov, 'ign'];
  for (let d = 1; d <= 5 && t.z - d >= 0; d++) {
    const pz = t.z - d, px = t.x >> d, py = t.y >> d;
    for (const prov of provs) {
      const hit = await cache.match(tileKey(prov, pz, px, py));
      if (!hit) continue;
      try {
        const bmp = await createImageBitmap(await hit.blob());
        const size = bmp.width / 2 ** d, sx = (t.x - (px << d)) * size, sy = (t.y - (py << d)) * size;
        const cv = new OffscreenCanvas(256, 256), ctx = cv.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, sx, sy, size, size, 0, 0, 256, 256);
        return new Response(await cv.convertToBlob({ type: 'image/png' }), { headers: { 'content-type': 'image/png' } });
      } catch { /* image illisible : on essaie la suivante */ }
    }
  }
  return null;
}

async function serveTile(req, t) {
  const cache = await caches.open(TILES), key = tileKey(t.prov, t.z, t.x, t.y);
  const own = await cache.match(key);
  if (own) return own;
  try {
    const r = await fetchWithTimeout(req, 8000);
    if (r.ok) { cache.put(key, r.clone()); return r; }
  } catch { /* pas de réseau */ }
  // hors ligne : la même tuile en version IGN téléchargée, sinon une tuile moins détaillée agrandie
  if (t.prov !== 'ign') { const alt = await cache.match(tileKey('ign', t.z, t.x, t.y)); if (alt) return alt; }
  return (await overzoom(cache, t)) || new Response('', { status: 504 });
}

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

  const t = parseTile(url);
  // téléchargement de cartes par l'appli (cache: no-store) : on laisse passer tel quel, sans secours
  if (t && req.cache === 'no-store') return;
  if (t) { e.respondWith(serveTile(req, t)); return; }

  // Fichiers de l'appli : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
  if (url.origin === location.origin) {
    // une page ouverte (navigation) est redemandée par son adresse : certains navigateurs refusent
    // de modifier directement une requête de navigation
    const fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' });
    e.respondWith(fetch(fresh).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(APP).then(c => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});
