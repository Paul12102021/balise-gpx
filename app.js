/* Balise GPX — navigation guidée sur une trace GPX */
(() => {
'use strict';

// =====================================================================
// Utilitaires
// =====================================================================
// Un élément absent (page et code de versions différentes) ne doit jamais bloquer toute l'appli
const $ = id => document.getElementById(id) || (console.warn('Élément absent :', id), document.createElement('div'));
window.addEventListener('error', e => {
  const t = document.getElementById('toast');
  if (t) { t.textContent = 'Un problème est survenu. Recharge la page si un bouton ne répond plus.'; t.hidden = false; }
  console.error(e.error || e.message);
});
const R = 6371000, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
function hav(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function offsetPoint(p, brg, dist) {
  return { lat: p.lat + dist * Math.cos(rad(brg)) / 110540, lon: p.lon + dist * Math.sin(rad(brg)) / (111320 * Math.cos(rad(p.lat))) };
}
const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lc = s => s.charAt(0).toLowerCase() + s.slice(1);
const fmtDist = m => m == null || isNaN(m) ? '–' : (m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 1 : 2).replace('.', ',') + ' km' : (m >= 100 ? Math.round(m / 10) * 10 : Math.round(m)) + ' m');
const fmtM = m => m == null || isNaN(m) ? '–' : Math.round(m) + ' m';
const fmtDur = s => { const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
const fmtClock = s => new Date(Date.now() + s * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
function speakDist(d) {
  if (d < 100) return Math.max(10, Math.round(d / 10) * 10) + ' mètres';
  if (d < 1000) return Math.round(d / 50) * 50 + ' mètres';
  return (d / 1000).toFixed(1).replace('.', ',').replace(',0', '') + ' kilomètres';
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage plein ou bloqué */ } }
};
const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
let toastT;
function toast(msg, ms = 2800, action) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  if (action) {
    const b = document.createElement('button'); b.className = 'toast-btn'; b.textContent = action.label;
    b.onclick = () => { t.hidden = true; action.run(); }; t.appendChild(b);
  }
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms);
}

// =====================================================================
// Chemins (trace GPX ou itinéraire de retour) : distances, D+, virages
// =====================================================================
let pathSeq = 0;
function makePath(pts, name) {
  const n = pts.length, hasEle = pts.some(p => p.ele != null);
  // altitude lissée sur 5 points pour un D+ réaliste
  const ele = pts.map((p, i) => {
    if (!hasEle) return null;
    let s = 0, c = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (pts[k].ele != null) { s += pts[k].ele; c++; }
    return c ? s / c : null;
  });
  const cum = [0], up = [0];
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + hav(pts[i - 1], pts[i]);
    const d = ele[i] != null && ele[i - 1] != null ? ele[i] - ele[i - 1] : 0;
    up[i] = up[i - 1] + (d > 0 ? d : 0);
  }
  const p = { id: ++pathSeq, name, pts, ele, cum, up, hasEle, total: cum[n - 1] || 0, totalUp: up[n - 1] || 0, lastIdx: 0 };
  p.turns = computeTurns(p);
  return p;
}

function pointAt(p, d) {
  const C = p.cum, n = C.length, P = p.pts;
  if (d <= 0 || n < 2) return { lat: P[0].lat, lon: P[0].lon, i: 0 };
  if (d >= p.total) return { lat: P[n - 1].lat, lon: P[n - 1].lon, i: n - 2 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] <= d) lo = m; else hi = m; }
  const seg = C[hi] - C[lo], f = seg ? (d - C[lo]) / seg : 0;
  return { lat: P[lo].lat + (P[hi].lat - P[lo].lat) * f, lon: P[lo].lon + (P[hi].lon - P[lo].lon) * f, i: lo };
}

// Virages : on compare la direction 20 m avant et 20 m après chaque point,
// puis on ne garde que le virage le plus marqué dans chaque groupe de 30 m.
function computeTurns(p) {
  const W = 20, P = p.pts, n = P.length, cand = [];
  for (let i = 1; i < n - 1; i++) {
    const d = p.cum[i];
    if (d < W * 0.5 || p.total - d < W * 0.5 || p.cum[i] === p.cum[i - 1]) continue;
    const ang = angDiff(bearing(pointAt(p, d - W), P[i]), bearing(P[i], pointAt(p, d + W)));
    if (Math.abs(ang) >= 35) cand.push({ along: d, ang });
  }
  const turns = []; let g = null;
  for (const c of cand) {
    if (g && c.along - g.start <= 30) { if (Math.abs(c.ang) > Math.abs(g.best.ang)) g.best = c; }
    else { if (g) turns.push(g.best); g = { start: c.along, best: c }; }
  }
  if (g) turns.push(g.best);
  turns.push({ along: p.total, ang: 0, arrive: true });
  return turns;
}

function turnInfo(ang) {
  const a = Math.abs(ang), side = ang > 0 ? 'à droite' : 'à gauche';
  if (a >= 150) return { txt: 'Faites demi-tour', icon: 'uturn' };
  if (a >= 110) return { txt: `Tournez franchement ${side}`, icon: ang };
  if (a >= 60) return { txt: `Tournez ${side}`, icon: ang };
  return { txt: `Légèrement ${side}`, icon: ang };
}

// Projection d'une position sur un chemin (recherche locale, puis globale si on s'est éloigné)
function project(p, pos, global = false) {
  const P = p.pts, n = P.length; if (n < 2) return null;
  const kx = Math.cos(rad(pos.lat)) * 111320, ky = 110540;
  const scan = (from, to) => {
    let best = { d2: Infinity };
    for (let i = Math.max(0, from); i < Math.min(n - 1, to); i++) {
      const ax = (P[i].lon - pos.lon) * kx, ay = (P[i].lat - pos.lat) * ky;
      const bx = (P[i + 1].lon - pos.lon) * kx, by = (P[i + 1].lat - pos.lat) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const f = L2 ? clamp(-(ax * dx + ay * dy) / L2, 0, 1) : 0;
      const px = ax + f * dx, py = ay + f * dy, d2 = px * px + py * py;
      if (d2 < best.d2) best = { d2, idx: i, frac: f };
    }
    return best;
  };
  let b = global ? scan(0, n) : scan(p.lastIdx - 50, p.lastIdx + 400);
  if (!global && b.d2 > 150 * 150) { const g = scan(0, n); if (g.d2 < b.d2) b = g; }
  if (b.idx == null) return null;
  if (!global) p.lastIdx = b.idx;
  const along = p.cum[b.idx] + b.frac * (p.cum[b.idx + 1] - p.cum[b.idx]);
  const upDone = p.up[b.idx] + b.frac * (p.up[b.idx + 1] - p.up[b.idx]);
  return { dist: Math.sqrt(b.d2), along, idx: b.idx, upLeft: p.totalUp - upDone, remain: p.total - along };
}

// =====================================================================
// Carte (MapLibre : rotation et inclinaison pour le mode navigation)
// =====================================================================
// Plan IGN : données ouvertes, seul fond que l'on télécharge pour le hors ligne
const IGN_URL = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM_0_19&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png';
const LAYERS = [
  { id: 'topo', name: 'Topo', tiles: ['a', 'b', 'c'].map(s => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), max: 17,
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM · © <a href="https://opentopomap.org">OpenTopoMap</a>' },
  { id: 'cyclosm', name: 'CyclOSM (vélo)', tiles: ['a', 'b', 'c'].map(sd => `https://${sd}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`), max: 20,
    attr: '<a href="https://www.cyclosm.org">CyclOSM</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  { id: 'ign', name: 'IGN', tiles: [IGN_URL], max: 19, attr: '© <a href="https://www.ign.fr">IGN</a> · Plan IGN' },
  { id: 'osm', name: 'Plan OSM', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], max: 19,
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }
];
let layerIdx = Math.max(0, LAYERS.findIndex(l => l.id === store.get('layerId')));
const baseSource = l => ({ type: 'raster', tiles: l.tiles, tileSize: 256, maxzoom: l.max, attribution: l.attr });
const EMPTY = { type: 'FeatureCollection', features: [] };
const lineFeature = pts => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) } });
const pointFeature = p => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });

const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: { base: baseSource(LAYERS[layerIdx]) },
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e9ede7' } }, { id: 'base', type: 'raster', source: 'base' }] },
  center: [6.6, 45.9], zoom: 9, maxPitch: 70, attributionControl: false, fadeDuration: 0
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
map.touchZoomRotate.enableRotation();

const ready = new Promise(res => map.on('load', res));
const COL = { track: cssVar('--track') || '#c2187a', done: cssVar('--done') || '#8f9c96', me: cssVar('--me') || '#1e6fd9', rec: cssVar('--rec') || '#e0571b' };
function gradient(f) {
  return f <= 0.0005 ? ['step', ['line-progress'], COL.track, 1, COL.track] : ['step', ['line-progress'], COL.done, Math.min(f, 0.9999), COL.track];
}
map.on('load', () => {
  map.addSource('track', { type: 'geojson', data: EMPTY, lineMetrics: true });
  map.addSource('rejoin', { type: 'geojson', data: EMPTY });
  map.addSource('rec', { type: 'geojson', data: EMPTY });
  map.addSource('turn', { type: 'geojson', data: EMPTY });
  map.addSource('packs', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'packs-fill', type: 'fill', source: 'packs', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#2f8a4c', 'fill-opacity': .07 } });
  map.addLayer({ id: 'packs-line', type: 'line', source: 'packs', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': '#2f8a4c', 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': .8 } });
  map.addLayer({ id: 'packs-trace', type: 'line', source: 'packs', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#2f8a4c', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 8, 3, 16, 600], 'line-opacity': .1 } });
  const round = { 'line-join': 'round', 'line-cap': 'round' };
  const w = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, a, 18, b];
  map.addLayer({ id: 'track-casing', type: 'line', source: 'track', layout: round, paint: { 'line-color': '#fff', 'line-width': w(5, 14), 'line-opacity': .9 } });
  map.addLayer({ id: 'track', type: 'line', source: 'track', layout: round, paint: { 'line-width': w(3, 9), 'line-gradient': gradient(0) } });
  map.addLayer({ id: 'rec', type: 'line', source: 'rec', layout: round, paint: { 'line-color': COL.rec, 'line-width': w(2, 5) } });
  map.addLayer({ id: 'rejoin-casing', type: 'line', source: 'rejoin', layout: round, paint: { 'line-color': '#fff', 'line-width': w(5, 13) } });
  map.addLayer({ id: 'rejoin', type: 'line', source: 'rejoin', layout: round, paint: { 'line-color': COL.me, 'line-width': w(3, 8), 'line-dasharray': [1.2, 1] } });
  map.addLayer({ id: 'turn', type: 'circle', source: 'turn', paint: { 'circle-radius': 7, 'circle-color': '#fff', 'circle-stroke-color': '#17201c', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map' } });
});
async function setSrc(id, data) { await ready; const s = map.getSource(id); if (s) s.setData(data); }

async function setLayer(i, remember = true) {
  layerIdx = i; if (remember) store.set('layerId', LAYERS[i].id);
  await ready;
  map.removeLayer('base'); map.removeSource('base');
  map.addSource('base', baseSource(LAYERS[i]));
  map.addLayer({ id: 'base', type: 'raster', source: 'base' }, map.getLayer('packs-fill') ? 'packs-fill' : 'track-casing');
}
$('btnLayer').onclick = () => {
  offlineSwitched = null;
  const next = (layerIdx + 1) % LAYERS.length;
  setLayer(next); toast('Fond de carte : ' + LAYERS[next].name);
};

// Sans réseau, on bascule tout seul sur la carte IGN téléchargée, puis on revient au fond choisi
let offlineSwitched = null;
function onOffline() {
  const ign = LAYERS.findIndex(l => l.id === 'ign');
  if (layerIdx !== ign) { offlineSwitched = layerIdx; setLayer(ign, false); toast('Pas de réseau : carte IGN hors ligne'); }
}
window.addEventListener('offline', onOffline);
window.addEventListener('online', () => { if (offlineSwitched != null) { setLayer(offlineSwitched, false); offlineSwitched = null; toast('Réseau retrouvé'); } });
if (navigator.onLine === false) onOffline();

function el(cls, html = '') { const e = document.createElement('div'); e.className = cls; e.innerHTML = html; return e; }
const startMk = new maplibregl.Marker({ element: el('mk mk-start') });
const endMk = new maplibregl.Marker({ element: el('mk mk-end') });
const meEl = el('me nohead', '<div class="me-halo"></div><svg viewBox="0 0 44 44"><path d="M22 5 35 37 22 30 9 37Z"/></svg>');
const meMk = new maplibregl.Marker({ element: meEl, rotationAlignment: 'map', pitchAlignment: 'map' });
let meShown = false;

// =====================================================================
// Trace
// =====================================================================
let track = null, progress = null;

function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Fichier illisible : ce n\'est pas un GPX valide.');
  let nodes = [...doc.getElementsByTagName('trkpt')];
  if (!nodes.length) nodes = [...doc.getElementsByTagName('rtept')];
  if (!nodes.length) throw new Error('Aucun point de trace trouvé dans ce fichier.');
  const pts = nodes.map(n => {
    const e = n.getElementsByTagName('ele')[0];
    return { lat: +n.getAttribute('lat'), lon: +n.getAttribute('lon'), ele: e ? +e.textContent : null };
  }).filter(p => isFinite(p.lat) && isFinite(p.lon));
  if (pts.length < 2) throw new Error('La trace contient moins de deux points.');
  const nameEl = doc.querySelector('trk > name, rte > name, metadata > name');
  return { name: nameEl ? nameEl.textContent.trim() : 'Trace sans nom', pts };
}

function boundsOf(ptsList) {
  const b = new maplibregl.LngLatBounds();
  ptsList.forEach(pts => pts.forEach(p => b.extend([p.lon, p.lat])));
  return b;
}
function fitTo(ptsList) {
  const sheetH = document.body.classList.contains('nav') ? 110 : $('sheet').offsetHeight;
  const topH = document.body.classList.contains('nav') ? $('navTop').offsetHeight : 64;
  map.fitBounds(boundsOf(ptsList), { padding: { top: topH + 30, bottom: sheetH + 30, left: 40, right: 76 }, bearing: 0, pitch: 0, duration: 700, maxZoom: 16 });
}

async function showTrack(t, fit = true) {
  track = makePath(t.pts, t.name); progress = null; clearRejoin();
  // le texte et le profil s'affichent tout de suite, la carte suit dès qu'elle est prête
  $('trackName').textContent = `${t.name} · ${fmtDist(track.total)}${track.hasEle ? ' · D+ ' + fmtM(track.totalUp) : ''}`;
  $('btnClose').hidden = false;
  if (me) progress = project(track, me, true);
  drawProfile(); updateStats();
  const mine = track;
  await ready;
  if (track !== mine) return; // une autre trace a été ouverte entre-temps
  setSrc('track', lineFeature(track.pts)); setDone(0, true);
  startMk.setLngLat([t.pts[0].lon, t.pts[0].lat]).addTo(map);
  const last = t.pts[t.pts.length - 1];
  endMk.setLngLat([last.lon, last.lat]).addTo(map);
  if (fit) { map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); fitTo([track.pts]); }
  $('trackName').textContent = `${t.name} · ${fmtDist(track.total)}${track.hasEle ? ' · D+ ' + fmtM(track.totalUp) : ''}`;
  if (me) progress = project(track, me, true);
  $('btnClose').hidden = false;
  drawProfile(); updateStats(); updateOfflineInfo();
}

// Fermer la trace ouverte (avec possibilité d'annuler quelques secondes)
function closeTrack() {
  if (!track) return;
  const savedText = store.get('gpx');
  if (nav) stopNav();
  track = null; progress = null; clearRejoin();
  setSrc('track', EMPTY); setSrc('turn', EMPTY);
  startMk.remove(); endMk.remove();
  store.set('gpx', '');
  $('trackName').textContent = 'Aucune trace chargée'; $('btnClose').hidden = true;
  drawProfile(); updateStats(); updateOfflineInfo();
  toast('Trace fermée', 5000, savedText ? { label: 'Annuler', run: () => loadText(savedText) } : null);
}
$('btnClose').onclick = closeTrack;
function loadText(text, save = true) {
  try {
    const t = parseGPX(text);
    showTrack(t);
    $('offProg').hidden = true;
    if (save) { store.set('gpx', text.length < 4.5e6 ? text : ''); saveRecent(track, text); }
    toast(`Trace chargée : ${t.name}`);
  } catch (e) { toast(e.message, 4000); }
}

// ---------- Mes traces : les GPX déjà ouverts, gardés sur le téléphone ----------
let dbP = null;
function openDB() {
  return dbP || (dbP = new Promise((res, rej) => {
    const r = indexedDB.open('balise', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('packs')) d.createObjectStore('packs', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
async function idb(mode, fn, storeName = 'tracks') {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(storeName, mode), req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error);
  });
}
async function listRecent() {
  try { return ((await idb('readonly', st => st.getAll())) || []).sort((a, b) => b.date - a.date); } catch { return []; }
}
async function saveRecent(p, text) {
  try {
    const id = p.name + '|' + Math.round(p.total);
    await idb('readwrite', st => st.put({ id, name: p.name, dist: p.total, up: p.hasEle ? p.totalUp : null, date: Date.now(), text }));
    const all = await listRecent();
    for (const old of all.slice(30)) await idb('readwrite', st => st.delete(old.id)); // on garde les 30 dernières
  } catch { /* stockage indisponible */ }
}
const fmtDate = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
async function renderLib() {
  const list = $('libList'), items = await listRecent();
  list.innerHTML = '';
  $('libEmpty').hidden = items.length > 0;
  for (const it of items) {
    const li = document.createElement('li');
    const open = document.createElement('button'); open.className = 'lib-item';
    open.innerHTML = `<b></b><span>${fmtDist(it.dist)}${it.up != null ? ' · D+ ' + fmtM(it.up) : ''} · ouverte le ${fmtDate(it.date)}</span>`;
    open.querySelector('b').textContent = it.name;
    open.onclick = () => { closeLib(); loadText(it.text); };
    const del = document.createElement('button'); del.className = 'lib-del'; del.setAttribute('aria-label', 'Retirer ' + it.name);
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    del.onclick = async () => { await idb('readwrite', st => st.delete(it.id)).catch(() => {}); renderLib(); };
    li.append(open, del); list.appendChild(li);
  }
}
async function openLib() {
  const items = await listRecent();
  if (!items.length) { $('fileIn').click(); return; } // rien en mémoire : on va directement aux fichiers
  await renderLib(); $('lib').hidden = false;
}
function closeLib() { $('lib').hidden = true; }
$('btnOpen').onclick = openLib;
$('libClose').onclick = closeLib;
$('lib').onclick = e => { if (e.target === $('lib')) closeLib(); };
$('libBrowse').onclick = () => { closeLib(); $('fileIn').click(); };

// ---------- GPX partagé depuis une autre appli (gestionnaire de fichiers, mail…) ----------
async function checkShared() {
  if (!/[?&]shared=1/.test(location.search)) return;
  history.replaceState(null, '', location.pathname);
  try {
    const c = await caches.open('shared'), r = await c.match('shared.gpx');
    if (r) { loadText(await r.text()); await c.delete('shared.gpx'); }
    else toast('Le fichier partagé n\'a pas été reçu. Réessaie.', 4000);
  } catch { toast('Impossible de lire le fichier partagé.', 4000); }
}
$('fileIn').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader(); r.onload = () => loadText(r.result); r.readAsText(f); e.target.value = '';
};

let lastFrac = -1;
function setDone(f, force) {
  if (!force && Math.abs(f - lastFrac) < 0.002) return;
  lastFrac = f;
  ready.then(() => map.getLayer('track') && map.setPaintProperty('track', 'line-gradient', gradient(f)));
}

// =====================================================================
// GPS, boussole, cap
// =====================================================================
let watchId = null, me = null, prevFix = null, moveRef = null, moveBearing = null;
let speedEma = null, speedSamples = 0, heading = null, compass = null, wakeLock = null;

async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); } } catch { /* refusé */ }
}
document.addEventListener('visibilitychange', () => { if ((nav || recording) && document.visibilityState === 'visible') keepAwake(); });

function startGPS() {
  if (sim) return true;
  if (!('geolocation' in navigator)) { toast('Ce navigateur ne donne pas accès au GPS.', 4000); return false; }
  if (watchId != null) return true;
  watchId = navigator.geolocation.watchPosition(p => {
    const c = p.coords;
    onPos({ lat: c.latitude, lon: c.longitude, ele: c.altitude, acc: c.accuracy, speed: c.speed, heading: c.heading, t: p.timestamp });
  }, err => {
    const m = { 1: 'Accès à la position refusé. Autorise la localisation pour ce site dans les réglages du téléphone.',
                2: 'Position indisponible. Va à découvert pour capter le GPS.', 3: 'Le GPS met du temps à répondre…' };
    toast(m[err.code] || err.message, 4500);
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  keepAwake();
  return true;
}
function stopGPS() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

// Boussole : sert de cap quand on avance lentement (à pied, le cap GPS est instable)
let compassOn = false, lastCompassCam = 0;
function onOrient(e) {
  let h = null;
  if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
  if (h == null) return;
  h = (h + ((screen.orientation && screen.orientation.angle) || 0) + 360) % 360;
  compass = compass == null ? h : (compass + angDiff(compass, h) * 0.25 + 360) % 360;
  if (nav && follow && me && !(me.speed > 1.5) && Date.now() - lastCompassCam > 350) {
    updateHeading();
    if (Math.abs(angDiff(map.getBearing(), heading)) > 4) { lastCompassCam = Date.now(); navCamera(350); }
  }
}
async function enableCompass() {
  if (compassOn) return;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') return;
    }
  } catch { return; }
  compassOn = true;
  window.addEventListener('deviceorientationabsolute', onOrient);
  window.addEventListener('deviceorientation', onOrient);
}

function rawHeading() {
  if (me && me.speed > 1.5 && me.heading != null && !isNaN(me.heading)) return me.heading;
  if (compass != null) return compass;
  if (moveBearing != null) return moveBearing;
  if (nav && progress && track) return bearing(pointAt(track, progress.along), pointAt(track, progress.along + 25));
  return null;
}
function updateHeading() {
  const h = rawHeading(); if (h == null) return;
  heading = heading == null ? h : (heading + angDiff(heading, h) * 0.45 + 360) % 360;
  meMk.setRotation(heading); meEl.classList.remove('nohead');
}

// =====================================================================
// Réception d'une position
// =====================================================================
let pendingRejoin = false, arrived = false;
function onPos(pos) {
  if (sim && !pos.sim) return; // pendant la simulation on ignore le vrai GPS
  // vitesse et direction de déplacement
  if (prevFix && (pos.speed == null || isNaN(pos.speed))) {
    const dt = (pos.t - prevFix.t) / 1000;
    if (dt > 0.5) pos.speed = hav(prevFix, pos) / dt;
  }
  prevFix = pos;
  if (pos.speed > 0.4 && pos.speed < 45 && (pos.acc || 0) < 40) { speedEma = speedEma == null ? pos.speed : speedEma * 0.92 + pos.speed * 0.08; speedSamples++; }
  if (!moveRef) moveRef = pos;
  else if (hav(moveRef, pos) >= 8) { moveBearing = bearing(moveRef, pos); moveRef = pos; }

  me = pos;
  meMk.setLngLat([pos.lon, pos.lat]);
  if (!meShown) { meMk.addTo(map); meShown = true; if (!nav) map.easeTo({ center: [pos.lon, pos.lat], zoom: Math.max(map.getZoom(), 15), duration: 800 }); }

  if (recording) addRecPoint(pos);
  if (track) progress = project(track, pos);
  if (rejoin) {
    if (rejoin.straight) setRejoinPath([{ lat: pos.lat, lon: pos.lon }, rejoin.target], rejoin.target, true);
    rejoinProg = project(rejoin, pos);
  }
  updateHeading();

  if (pendingRejoin) { pendingRejoin = false; requestRejoin(true); }
  if (nav) {
    offTrackLogic();
    if (rejoin && progress && progress.dist < Math.min(threshold * 0.7, 30) && !isOff) clearRejoin();
    if (!rejoin && progress && progress.remain < 25 && !arrived) {
      arrived = true; say('Vous êtes arrivé'); vibrate([200, 100, 200]);
    }
    guidance();
    if (follow) navCamera(1000);
  } else {
    if (rejoin && progress && progress.dist < Math.min(threshold * 0.7, 30)) { clearRejoin(); toast('Tu es sur la trace'); }
    if (followOv) map.easeTo({ center: [pos.lon, pos.lat], duration: 800 });
  }
  if (progress) setDone(progress.along / track.total);
  updateStats(); drawProfileSoon();
}

// =====================================================================
// Mode navigation
// =====================================================================
let nav = false, follow = true, followOv = false;
function navZoom() { const s = speedEma || 1.2; return s > 7 ? 15.4 : s > 3.5 ? 16.2 : 17; }
function navCamera(dur) {
  if (!me) return;
  const h = map.getContainer().clientHeight;
  map.easeTo({
    center: [me.lon, me.lat], bearing: heading != null ? heading : map.getBearing(), pitch: 52, zoom: navZoom(),
    padding: { top: Math.round(h * 0.45), bottom: 100, left: 0, right: 0 }, duration: dur, easing: t => t, essential: true
  });
}
function setFollow(v) { follow = v; $('btnCenter').classList.toggle('on', nav ? v : followOv); }
['dragstart', 'rotatestart', 'pitchstart'].forEach(ev => map.on(ev, e => {
  if (!e.originalEvent) return;
  if (nav) setFollow(false); else { followOv = false; $('btnCenter').classList.remove('on'); }
}));

async function startNav() {
  if (!track) { toast('Ouvre d\'abord un fichier GPX.'); return; }
  if (!startGPS()) return;
  nav = true; arrived = false; isOff = false; offCount = 0;
  document.body.classList.add('nav'); toggleMore(false);
  setFollow(true);
  unlockAudio(); enableCompass(); keepAwake();
  say(me ? 'C\'est parti' : 'Navigation démarrée. Recherche du signal GPS.');
  if (me) { progress = project(track, me, true); guidance(); navCamera(800); }
  else setBanner('gps', '', 'Recherche du signal GPS…', 'gps');
  updateStats();
}
function stopNav() {
  nav = false; document.body.classList.remove('nav');
  stopSim(); clearRejoin(); isOff = false;
  try { speechSynthesis.cancel(); } catch {}
  setSrc('turn', EMPTY);
  map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
  if (!recording) stopGPS();
  setFollow(false);
}
$('btnNav').onclick = startNav;
$('btnExit').onclick = stopNav;
$('btnOverview').onclick = () => {
  if (!track) return;
  setFollow(false); map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  fitTo(rejoin ? [track.pts, rejoin.pts] : [track.pts]);
};
$('btnCenter').onclick = () => {
  if (nav) { setFollow(true); navCamera(600); return; }
  followOv = true; $('btnCenter').classList.add('on');
  if (me) map.easeTo({ center: [me.lon, me.lat], zoom: Math.max(map.getZoom(), 16), duration: 600 });
  else { startGPS(); toast('Recherche de ta position…'); }
};

// ---------- bandeau de guidage ----------
function arrowSVG(icon) {
  if (icon === 'flag') return '<svg viewBox="0 0 48 48"><path d="M12 44V6"/><path d="M12 8h22l-5 7 5 7H12" fill="#fff"/></svg>';
  if (icon === 'off') return '<svg viewBox="0 0 48 48"><path d="M24 6 44 42H4Z"/><path d="M24 19v10M24 35v1"/></svg>';
  if (icon === 'gps') return '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="7"/><path d="M24 4v8M24 36v8M4 24h8M36 24h8"/></svg>';
  if (icon === 'join') return '<svg viewBox="0 0 48 48"><path d="M24 44V20"/><path d="M14 22 24 10l10 12"/><path d="M6 10h36" stroke-dasharray="4 5"/></svg>';
  if (icon === 'uturn') return '<svg viewBox="0 0 48 48"><path d="M32 44V20a8 8 0 0 0-16 0v12"/><path d="M9 26l7 7 7-7"/></svg>';
  if (typeof icon === 'object') // flèche vers un point (retour à vol d'oiseau)
    return `<svg viewBox="0 0 48 48" style="transform:rotate(${icon.rot}deg)"><path d="M24 42V8"/><path d="M13 18 24 7l11 11"/></svg>`;
  const t = clamp(icon, -135, 135), r = rad(t), cy = 24, L = 15;
  const ex = 24 + L * Math.sin(r), ey = cy - L * Math.cos(r), H = 9;
  const h1 = rad(t + 145), h2 = rad(t - 145);
  const f = n => n.toFixed(1);
  return `<svg viewBox="0 0 48 48"><path d="M24 45V${cy}L${f(ex)} ${f(ey)}"/><path d="M${f(ex + H * Math.sin(h1))} ${f(ey - H * Math.cos(h1))}L${f(ex)} ${f(ey)}L${f(ex + H * Math.sin(h2))} ${f(ey - H * Math.cos(h2))}"/></svg>`;
}
let lastBannerKey = '';
function setBanner(tone, dist, txt, icon, sub = '') {
  $('navTop').dataset.tone = tone;
  $('ntDist').textContent = dist; $('ntTxt').textContent = txt; $('ntSub').textContent = sub;
  const key = JSON.stringify(icon);
  if (key !== lastBannerKey) { $('ntIcon').innerHTML = arrowSVG(icon); lastBannerKey = key; }
}

let lastTurnKey = '';
const spoken = new Map();
function guidance() {
  if (!nav) return;
  if (!me) { setBanner('gps', '', 'Recherche du signal GPS…', 'gps'); return; }
  if (!progress) return;
  if (arrived && !rejoin) { setBanner('done', '', 'Vous êtes arrivé', 'flag', `${track.name}`); setSrc('turn', EMPTY); return; }
  if (isOff && !rejoin) {
    setBanner('off', fmtDist(progress.dist), routing ? 'Hors trace · calcul du retour…' : 'Hors trace', 'off', 'Touchez ↩ pour un itinéraire de retour');
    return;
  }
  if (rejoin && rejoin.straight) {
    const b = bearing(me, rejoin.target), rel = Math.round(angDiff(heading || 0, b));
    setBanner('rejoin', fmtDist(hav(me, rejoin.target)), 'Rejoignez la trace', { rot: rel }, `À vol d'oiseau, cap ${Math.round(b)}° · pas de réseau pour le chemin`);
    return;
  }
  const path = rejoin || track, pr = rejoin ? rejoinProg : progress;
  if (!pr) return;
  const next = path.turns.find(t => t.along > pr.along + 3) || path.turns[path.turns.length - 1];
  const dTo = Math.max(0, next.along - pr.along);
  const info = next.arrive ? (rejoin ? { txt: 'Rejoignez la trace', icon: 'join' } : { txt: 'Arrivée', icon: 'flag' }) : turnInfo(next.ang);
  const tone = rejoin ? 'rejoin' : 'ok';
  const sub = rejoin ? `Retour à la trace · ${fmtDist(rejoinProg.remain)} par le chemin` : '';
  if (dTo > 1200) setBanner(tone, fmtDist(dTo), 'Continuez sur la trace', 0, (next.arrive ? '' : `puis ${lc(info.txt)}`) + (sub ? (next.arrive ? '' : ' · ') + sub : ''));
  else setBanner(tone, fmtDist(dTo), info.txt, info.icon, sub);

  const key = path.id + ':' + Math.round(next.along);
  if (key !== lastTurnKey) { lastTurnKey = key; setSrc('turn', next.arrive ? EMPTY : pointFeature(pointAt(path, next.along))); }

  // annonces vocales : une à l'approche, une au moment de tourner
  const s = Math.max(speedEma || 1.2, 1);
  const far = clamp(s * 30, 60, 400), near = clamp(s * 7, 15, 60);
  const lvl = spoken.get(key) || 0;
  const what = next.arrive ? (rejoin ? 'vous rejoindrez la trace' : 'vous serez arrivé') : lc(info.txt);
  if (lvl < 1 && dTo <= far && dTo > near * 1.6) { say(`Dans ${speakDist(dTo)}, ${what}`); spoken.set(key, 1); }
  else if (lvl < 2 && dTo <= near) { if (!next.arrive) say(info.txt); spoken.set(key, 2); }
}

// ---------- voix, son, vibration ----------
let voiceOn = store.get('voice') !== '0';
$('btnVoice').classList.toggle('muted', !voiceOn);
$('btnVoice').onclick = () => {
  voiceOn = !voiceOn; store.set('voice', voiceOn ? '1' : '0');
  $('btnVoice').classList.toggle('muted', !voiceOn);
  if (voiceOn) say('Guidage vocal activé'); else { try { speechSynthesis.cancel(); } catch {} toast('Guidage vocal coupé'); }
};
function say(text) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR'; u.rate = 1.05;
    const v = speechSynthesis.getVoices().find(v => /^fr/i.test(v.lang)); if (v) u.voice = v;
    if (speechSynthesis.speaking) speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* synthèse vocale indisponible */ }
}
let audioCtx;
function unlockAudio() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch {} }
function beep() {
  if (!voiceOn || !audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    [0, .25].forEach(dt => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square'; o.frequency.value = 880;
      g.gain.setValueAtTime(.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(.3, t0 + dt + .02);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + dt + .18);
      o.connect(g).connect(audioCtx.destination); o.start(t0 + dt); o.stop(t0 + dt + .2);
    });
  } catch {}
}
const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

// =====================================================================
// Hors trace et itinéraire de retour
// =====================================================================
let threshold = +(store.get('thr') || 50), offCount = 0, isOff = false, lastAlert = 0;
let rejoin = null, rejoinProg = null, routing = false, lastRoute = 0, rejoinOff = 0;
let profile = store.get('profile') || 'hiking-mountain';
$('thr').value = String(threshold);
$('thr').onchange = e => { threshold = +e.target.value; store.set('thr', threshold); };
$('prof').value = profile;
$('prof').onchange = e => { profile = e.target.value; store.set('profile', profile); };

function alertOff() { vibrate([400, 150, 400, 150, 400]); beep(); lastAlert = Date.now(); }

function offTrackLogic() {
  if (!progress || arrived) return;
  const acc = me.acc || 0, tol = threshold + Math.min(acc, 60) * 0.5, now = Date.now();
  if (progress.dist > tol && acc < 100) offCount++; else if (progress.dist <= tol) offCount = 0;
  if (!isOff && offCount >= 2) {
    isOff = true; alertOff();
    say('Vous avez quitté la trace. Calcul d\'un itinéraire de retour.');
    requestRejoin(false);
  } else if (isOff && progress.dist < threshold * 0.7) {
    isOff = false; offCount = 0; clearRejoin();
    vibrate(150); say('Vous avez rejoint la trace'); toast('De retour sur la trace');
  } else if (isOff) {
    // on s'écarte de l'itinéraire de retour : on recalcule
    if (rejoin && !rejoin.straight && rejoinProg && rejoinProg.dist > 40) {
      if (++rejoinOff >= 2 && now - lastRoute > 20000) { rejoinOff = 0; requestRejoin(false); }
    } else rejoinOff = 0;
    if (rejoin && rejoin.straight && now - lastRoute > 60000) requestRejoin(false); // le réseau est peut-être revenu
    if (!rejoin && !routing && now - lastRoute > 30000) requestRejoin(false);
    if (!rejoin && now - lastAlert > 60000) alertOff();
  }
}

// Candidats : les points de la trace les plus proches à vol d'oiseau (minima locaux),
// puis on garde celui qui est le plus court à rejoindre par les chemins.
function rejoinCandidates(p, pos) {
  const step = clamp(p.total / 2000, 25, 100), samples = [];
  for (let d = 0; d <= p.total; d += step) { const q = pointAt(p, d); samples.push({ lat: q.lat, lon: q.lon, along: d, dist: hav(pos, q) }); }
  const minima = samples.filter((s, i) => (i === 0 || s.dist <= samples[i - 1].dist) && (i === samples.length - 1 || s.dist <= samples[i + 1].dist))
    .sort((a, b) => a.dist - b.dist);
  const picked = [];
  for (const m of minima) {
    if (m.dist > minima[0].dist * 2.5 + 300) break;
    if (picked.every(x => Math.abs(x.along - m.along) > 300)) picked.push(m);
    if (picked.length === 3) break;
  }
  const pr = project(p, pos, true);
  if (pr && Math.abs(pr.along - picked[0].along) < step * 2) { const q = pointAt(p, pr.along); picked[0] = { lat: q.lat, lon: q.lon, along: pr.along, dist: pr.dist }; }
  return picked;
}
async function fetchRoute(a, b) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const ll = q => `${q.lon.toFixed(6)},${q.lat.toFixed(6)}`;
    const r = await fetch(`https://brouter.de/brouter?lonlats=${ll(a)}|${ll(b)}&profile=${profile}&alternativeidx=0&format=geojson`, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(), f = j.features && j.features[0];
    const pts = f.geometry.coordinates.map(c => ({ lon: c[0], lat: c[1], ele: c[2] != null ? c[2] : null }));
    return { pts, len: +f.properties['track-length'] || 0 };
  } finally { clearTimeout(timer); }
}
async function requestRejoin(manual) {
  if (!track) { toast('Ouvre d\'abord un fichier GPX.'); return; }
  if (!me) { pendingRejoin = true; startGPS(); toast('Recherche de ta position…'); return; }
  if (routing) return;
  routing = true; lastRoute = Date.now(); $('btnRejoin').classList.add('busy'); guidance();
  const cands = rejoinCandidates(track, me);
  let best = null;
  if (navigator.onLine !== false) {
    const res = await Promise.allSettled(cands.map(c => fetchRoute(me, c)));
    res.forEach((r, k) => {
      if (r.status !== 'fulfilled') return;
      const len = r.value.len || makePath(r.value.pts, '').total;
      if (!best || len < best.len) best = { pts: r.value.pts, len, target: cands[k] };
    });
  }
  routing = false; $('btnRejoin').classList.remove('busy');
  if (best) {
    // on termine l'itinéraire exactement sur la trace
    best.pts.push({ lat: best.target.lat, lon: best.target.lon, ele: null });
    setRejoinPath(best.pts, best.target, false);
    const msg = `Itinéraire de retour : ${fmtDist(rejoin.total)} par le chemin`;
    if (nav) say(`Itinéraire de retour calculé, ${speakDist(rejoin.total)}`); else { toast(msg, 4000); fitTo([rejoin.pts, [me]]); }
  } else {
    const c = cands[0];
    setRejoinPath([{ lat: me.lat, lon: me.lon }, c], c, true);
    const msg = `Pas de réseau : trace à ${fmtDist(c.dist)} à vol d'oiseau, cap ${Math.round(bearing(me, c))}°`;
    if (nav) say(`Pas de réseau. Rejoignez la trace à ${speakDist(c.dist)}, à vol d'oiseau.`); else { toast(msg, 5000); fitTo([rejoin.pts]); }
  }
  guidance();
}
function setRejoinPath(pts, target, straight) {
  rejoin = makePath(pts, 'Retour'); rejoin.target = target; rejoin.straight = straight;
  rejoinProg = me ? project(rejoin, me) : null;
  setSrc('rejoin', lineFeature(rejoin.pts));
  $('btnRejoin').classList.add('on');
}
function clearRejoin() {
  rejoin = null; rejoinProg = null; rejoinOff = 0;
  setSrc('rejoin', EMPTY);
  $('btnRejoin').classList.remove('on');
}
$('btnRejoin').onclick = () => {
  if (rejoin && !routing) { clearRejoin(); toast('Itinéraire de retour effacé'); guidance(); return; }
  unlockAudio();
  requestRejoin(true);
};

// =====================================================================
// Mesures affichées
// =====================================================================
function remainingInfo() {
  if (!track) return null;
  let rem = track.total, up = track.totalUp;
  if (progress) {
    if (rejoin && rejoinProg) {
      const pt = project(track, rejoin.target, true);
      rem = rejoinProg.remain + (pt ? pt.remain : 0); up = pt ? pt.upLeft : up;
    } else { rem = progress.remain; up = progress.upLeft; }
  }
  // temps : vitesse moyenne mesurée, sinon 4,5 km/h + 1 h par 600 m de D+
  const secs = speedEma && speedSamples > 15 ? rem / Math.max(speedEma, 0.5) : rem / 1.25 + (track.hasEle ? up / 600 * 3600 : 0);
  return { rem, up, secs };
}
function updateStats() {
  const info = remainingInfo();
  $('sDist').textContent = info ? fmtDist(info.rem) : '–';
  $('sUp').textContent = info && track.hasEle ? fmtM(info.up) : '–';
  const off = $('sOff');
  off.textContent = progress ? fmtDist(progress.dist) : '–';
  off.classList.toggle('bad', !!progress && progress.dist > threshold);
  $('sEle').textContent = me && me.ele != null ? fmtM(me.ele) : (progress && track.ele[progress.idx] != null ? '≈' + fmtM(track.ele[progress.idx]) : '–');
  if (nav && info) {
    $('nbEta').textContent = fmtClock(info.secs);
    $('nbDur').textContent = 'arrivée · ' + fmtDur(info.secs);
    $('nbRem').textContent = fmtDist(info.rem);
    $('nbUp').textContent = track.hasEle ? fmtM(info.up) : '–';
    $('nbBar').style.width = (progress ? clamp(progress.along / track.total, 0, 1) * 100 : 0) + '%';
    const sp = me && me.speed != null && !isNaN(me.speed) ? me.speed * 3.6 : null;
    $('spVal').textContent = sp == null ? '–' : (sp < 10 ? sp.toFixed(1).replace('.', ',') : Math.round(sp));
  }
}

// =====================================================================
// Profil altimétrique
// =====================================================================
const cv = $('profile');
let profT = 0;
function drawProfileSoon() { if (Date.now() - profT > 2000 && !nav) { profT = Date.now(); drawProfile(); } }
function drawProfile() {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = cssVar('--muted');
  if (!track) { ctx.fillText('Ouvre un fichier GPX : le profil altimétrique apparaîtra ici.', 0, H / 2); return; }
  if (!track.hasEle) { ctx.fillText('Ce GPX ne contient pas d\'altitudes.', 0, H / 2); return; }
  const E = track.ele, C = track.cum, n = E.length;
  let lo = Infinity, hi = -Infinity; E.forEach(e => { if (e != null) { lo = Math.min(lo, e); hi = Math.max(hi, e); } });
  const pad = Math.max(20, (hi - lo) * .08); lo -= pad; hi += pad;
  const L0 = 38, B = 16, w = W - L0 - 4, h = H - B - 4;
  const X = d => L0 + d / track.total * w, Y = e => 4 + (1 - (e - lo) / (hi - lo)) * h;
  const step = [10, 20, 50, 100, 200, 250, 500, 1000].find(s => (hi - lo) / s <= 4) || 1000;
  ctx.strokeStyle = cssVar('--line'); ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const y = Math.round(Y(v)) + .5; ctx.beginPath(); ctx.moveTo(L0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.fillText(v + '', L0 - 4, y);
  }
  ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'; ctx.fillText('0', L0, H);
  ctx.textAlign = 'right'; ctx.fillText(fmtDist(track.total), W, H);
  const stride = Math.max(1, Math.floor(n / (w * 2)));
  const path = new Path2D(); let first = true;
  for (let i = 0; i < n; i += stride) { if (E[i] == null) continue; const x = X(C[i]), y = Y(E[i]); first ? path.moveTo(x, y) : path.lineTo(x, y); first = false; }
  if (E[n - 1] != null) path.lineTo(X(C[n - 1]), Y(E[n - 1]));
  const area = new Path2D(path); area.lineTo(X(track.total), 4 + h); area.lineTo(L0, 4 + h); area.closePath();
  ctx.fillStyle = COL.track; ctx.globalAlpha = .14; ctx.fill(area); ctx.globalAlpha = 1;
  ctx.strokeStyle = COL.track; ctx.lineWidth = 2; ctx.stroke(path);
  if (progress && E[progress.idx] != null) {
    const x = X(progress.along), y = Y(E[progress.idx]);
    ctx.strokeStyle = COL.me; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, 4 + h); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COL.me; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
}
window.addEventListener('resize', drawProfile);

// =====================================================================
// Enregistrement de ma trace
// =====================================================================
let recording = false, rec = [];
try { rec = JSON.parse(store.get('rec') || '[]'); } catch { rec = []; }
function recDist() { let d = 0; for (let i = 1; i < rec.length; i++) d += hav(rec[i - 1], rec[i]); return d; }
function updRecInfo() { $('recInfo').textContent = rec.length ? `(${rec.length} pts · ${fmtDist(recDist())})` : '(vide)'; }
const drawRec = () => setSrc('rec', rec.length > 1 ? lineFeature(rec) : EMPTY);
function addRecPoint(p) {
  if (p.sim || p.acc > 50) return;
  const last = rec[rec.length - 1];
  if (last && hav(last, p) < 5) return; // évite d'accumuler des points à l'arrêt
  rec.push({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), ele: p.ele != null ? +p.ele.toFixed(1) : null, t: p.t });
  if (rec.length % 5 === 0) store.set('rec', JSON.stringify(rec));
  drawRec(); updRecInfo();
}
if (rec.length) { drawRec(); updRecInfo(); }
function toggleRec() {
  if (!recording) {
    if (!startGPS()) return;
    recording = true; toast(rec.length ? 'Enregistrement repris' : 'Enregistrement démarré');
  } else {
    recording = false; store.set('rec', JSON.stringify(rec));
    if (!nav) stopGPS();
    toast('Enregistrement en pause · ' + fmtDist(recDist()));
  }
  $('btnRec').classList.toggle('recording', recording);
  $('btnRec').querySelector('.t').textContent = recording ? 'Arrêter' : 'Enregistrer';
  $('btnRecFab').classList.toggle('recording', recording);
}
$('btnRec').onclick = toggleRec; $('btnRecFab').onclick = toggleRec;

function toGPX() {
  const esc = s => s.replace(/[<&>]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]));
  const name = 'Ma sortie ' + new Date(rec[0]?.t || Date.now()).toLocaleDateString('fr-FR');
  const pts = rec.map(p => `      <trkpt lat="${p.lat}" lon="${p.lon}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Balise GPX" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>${esc(name)}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n</gpx>\n`;
}
$('btnExport').onclick = async () => {
  if (!rec.length) { toast('Rien à exporter : lance d\'abord un enregistrement.'); return; }
  const fname = 'sortie-' + new Date(rec[0].t).toISOString().slice(0, 10) + '.gpx';
  const file = new File([toGPX()], fname, { type: 'application/gpx+xml' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: fname }); return; } }
  catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fname;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

// =====================================================================
// Cartes hors ligne : Plan IGN, le long d'une trace ou par département
// (OpenStreetMap et OpenTopoMap interdisent le téléchargement de zones)
// =====================================================================
const TILE_CACHE = 'tiles-v2';
// clé de cache partagée avec le service worker, indépendante du serveur
const tileKey = (prov, z, x, y) => `https://tiles.balise/${prov}/${z}/${x}/${y}`;
const ignTileUrl = (z, x, y) => IGN_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
let tileKB = clamp(+(store.get('tileKB') || 20), 8, 60); // poids moyen d'une tuile, affiné après chaque téléchargement

function tileXY(lat, lon, z) {
  const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2 * n);
  return [x, y];
}
const tile2lon = (x, z) => x / 2 ** z * 360 - 180;
const tile2lat = (y, z) => deg(Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y / 2 ** z)));
const fmtMo = kb => { const mb = kb / 1024; return mb < 10 ? mb.toFixed(1).replace('.', ',') + ' Mo' : mb < 1000 ? Math.round(mb) + ' Mo' : (mb / 1024).toFixed(1).replace('.', ',') + ' Go'; };

// Le long d'une trace : la tuile traversée et ses voisines, zooms 10 à 16 (bande d'environ 1 km)
function traceTiles(p, zmax = 16) {
  const set = new Set();
  for (let z = 10; z <= zmax; z++) {
    let last = '';
    for (const q of p.pts) {
      const [x, y] = tileXY(q.lat, q.lon, z), k = x + '/' + y;
      if (k === last) continue; last = k;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) set.add(`${z}/${x + dx}/${y + dy}`);
    }
  }
  return [...set];
}

// Département : toutes les tuiles qui touchent son contour
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolys = (lon, lat, polys) => polys.some(p => inRing(lon, lat, p[0]) && !p.slice(1).some(h => inRing(lon, lat, h)));
function polysBBox(polys) {
  let w = 180, s = 90, e = -180, n = -90;
  polys.forEach(p => p[0].forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }));
  return [w, s, e, n];
}
function polyTiles(polys, zmax) {
  const [w, s, e, n] = polysBBox(polys), out = [];
  for (let z = 8; z <= zmax; z++) {
    const [x0, y0] = tileXY(n, w, z), [x1, y1] = tileXY(s, e, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (z <= 11) { out.push(`${z}/${x}/${y}`); continue; }
      const L = tile2lon(x, z), Rr = tile2lon(x + 1, z), T = tile2lat(y, z), B = tile2lat(y + 1, z);
      const pts = [[(L + Rr) / 2, (T + B) / 2], [L, T], [Rr, T], [L, B], [Rr, B]];
      if (pts.some(([lo, la]) => inPolys(lo, la, polys))) out.push(`${z}/${x}/${y}`);
    }
  }
  return out;
}

// ---------- départements ----------
let deps = null;
async function loadDeps() {
  if (deps) return deps;
  const r = await fetch('departements.json');
  deps = await r.json();
  const sel = $('depSel'); sel.innerHTML = '';
  deps.forEach((d, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${d.code} · ${d.nom}`; sel.appendChild(o); });
  // présélection : le département où l'on se trouve, sinon celui au centre de la carte
  const c = me ? { lon: me.lon, lat: me.lat } : (() => { const m = map.getCenter(); return { lon: m.lng, lat: m.lat }; })();
  const here = deps.findIndex(d => inPolys(c.lon, c.lat, d.polys));
  const saved = store.get('depIdx');
  sel.value = String(here >= 0 ? here : saved != null ? saved : 0);
  return deps;
}

// ---------- panneau « Cartes hors ligne » ----------
let depTilesCache = { key: '', tiles: [] };
function currentDepTiles() {
  const d = deps[+$('depSel').value], z = +$('depDetail').value, key = d.code + ':' + z;
  if (depTilesCache.key !== key) depTilesCache = { key, tiles: polyTiles(d.polys, z) };
  return { d, z, tiles: depTilesCache.tiles };
}
function updateOfflineInfo() {
  if (track) {
    const n = traceTiles(track).length;
    $('dlTraceInfo').textContent = `${track.name} · ≈ ${n.toLocaleString('fr-FR')} tuiles · ~${fmtMo(n * tileKB)}`;
    $('dlTrace').disabled = false;
  } else { $('dlTraceInfo').textContent = 'Ouvre d\'abord une trace GPX.'; $('dlTrace').disabled = true; }
  if (deps) {
    const { tiles } = currentDepTiles();
    $('dlDepInfo').textContent = `≈ ${tiles.length.toLocaleString('fr-FR')} tuiles · ~${fmtMo(tiles.length * tileKB)}`;
  }
}
async function updateStorageInfo() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return;
    const e = await navigator.storage.estimate();
    const free = e.quota ? ` · ${fmtMo((e.quota - e.usage) / 1024)} encore disponibles` : '';
    $('storeInfo').textContent = `Espace utilisé : ${fmtMo((e.usage || 0) / 1024)}${free}`;
  } catch {}
}
async function openMaps() {
  toggleMore(false);
  $('maps').hidden = false;
  $('showPacks').checked = store.get('showPacks') !== '0';
  updateOfflineInfo(); updateStorageInfo(); renderPacks();
  try { await loadDeps(); updateOfflineInfo(); } catch { $('dlDepInfo').textContent = 'Liste des départements indisponible.'; }
}
$('btnMaps').onclick = openMaps;
$('mapsClose').onclick = () => $('maps').hidden = true;
$('maps').onclick = e => { if (e.target === $('maps')) $('maps').hidden = true; };
$('depSel').onchange = () => { store.set('depIdx', $('depSel').value); updateOfflineInfo(); };
$('depDetail').onchange = updateOfflineInfo;
$('showPacks').onchange = e => { store.set('showPacks', e.target.checked ? '1' : '0'); drawPacks(); };

// ---------- téléchargement ----------
let dl = null;
async function downloadPack(pack, tiles) {
  if (dl) { toast('Un téléchargement est déjà en cours.'); return; }
  if (!('caches' in window)) { toast('Ce navigateur ne permet pas le stockage hors ligne.', 4000); return; }
  if (navigator.onLine === false) { toast('Pas de réseau : connecte-toi pour télécharger.', 4000); return; }
  dl = { stop: false, reason: '' };
  keepAwake();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  $('offProg').hidden = false; $('dlStop').hidden = false; $('dlTrace').disabled = $('dlDep').disabled = true;
  const cache = await caches.open(TILE_CACHE), queue = tiles.slice(), total = tiles.length;
  let done = 0, fail = 0, bytes = 0, fetched = 0, fetchedBytes = 0, lastErr = '';
  const t0 = Date.now();
  // la carte apparaît tout de suite dans la liste : si l'appli est fermée en route, on pourra reprendre
  const save = async complete => {
    Object.assign(pack, { tiles, count: total, bytes, date: Date.now(), complete, missing: total - done + fail });
    try { await idb('readwrite', st => st.put(pack), 'packs'); } catch {}
  };
  await save(false); renderPacks();
  const show = () => {
    const secs = (Date.now() - t0) / 1000, rate = done / Math.max(secs, 1), left = (total - done) / Math.max(rate, 0.1);
    $('offBar').style.width = (done / total * 100) + '%';
    $('offTxt').textContent = `${done.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')}` +
      (done > 20 && done < total ? ` · reste ${left < 60 ? "moins d’1 min" : "~" + fmtDur(left)}` : '') + (fail ? ` · ${fail} erreurs` : '');
  };
  // une tuile : délai maximal de 20 s, un second essai, sans passer par les secours du service worker
  const getTile = async (z, x, y) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const r = await fetch(ignTileUrl(z, x, y), { mode: 'cors', cache: 'no-store', signal: ctrl.signal });
        if (r.ok) return await r.blob();
        lastErr = 'le serveur IGN répond ' + r.status;
        if (r.status >= 400 && r.status < 500 && r.status !== 429) return null; // demande refusée : inutile d'insister
      } catch (e) { lastErr = e.name === 'AbortError' ? 'le serveur IGN ne répond pas' : 'pas de connexion'; }
      finally { clearTimeout(timer); }
      await new Promise(r => setTimeout(r, 1500));
    }
    return null;
  };
  const worker = async () => {
    while (queue.length && !dl.stop) {
      const [z, x, y] = queue.shift().split('/'), key = tileKey('ign', z, x, y);
      try {
        const hit = await cache.match(key);
        if (hit) bytes += +(hit.headers.get('x-size') || tileKB * 1024);
        else {
          const b = await getTile(z, x, y);
          if (!b) fail++;
          else {
            await cache.put(key, new Response(b, { headers: { 'content-type': b.type || 'image/png', 'x-size': String(b.size) } }));
            bytes += b.size; fetched++; fetchedBytes += b.size;
          }
        }
      } catch { fail++; }
      done++;
      // tout échoue dès le début : on arrête et on dit pourquoi
      if (done >= 30 && fetched === 0 && fail >= 25 && !dl.stop) { dl.stop = true; dl.reason = lastErr; }
      if (done % 10 === 0 || !queue.length) show();
      if (done % 300 === 0) save(false);
    }
  };
  show();
  await Promise.all(Array.from({ length: 8 }, worker));
  const stopped = dl.stop, reason = dl.reason; dl = null;
  if (fetched > 50) { tileKB = clamp(Math.round(fetchedBytes / fetched / 1024 * 10) / 10 || tileKB, 8, 60); store.set('tileKB', tileKB); }
  await save(!stopped && fail === 0);
  $('dlStop').hidden = true; $('dlTrace').disabled = !track; $('dlDep').disabled = false;
  if (reason) $('offTxt').textContent = `Téléchargement impossible : ${reason}.`;
  else $('offTxt').textContent = pack.complete ? `${pack.name} : disponible hors ligne ✓` : `${pack.name} : ${pack.missing.toLocaleString('fr-FR')} tuiles manquantes · touche « Reprendre »`;
  toast(reason ? 'Téléchargement impossible : ' + reason : pack.complete ? 'Carte téléchargée ✓' : 'Téléchargement incomplet, tu peux le reprendre.', 5000);
  renderPacks(); updateStorageInfo(); updateOfflineInfo(); drawPacks();
}
// téléchargement en cours et appli remise au premier plan : on rallume la protection d'écran
document.addEventListener('visibilitychange', () => { if (dl && document.visibilityState === 'visible') keepAwake(); });
$('dlStop').onclick = () => { if (dl) { dl.stop = true; toast('Arrêt du téléchargement…'); } };

function simplifyLine(pts, step = 50) {
  const out = []; let last = null;
  for (const p of pts) if (!last || hav(last, p) >= step) { out.push([+p.lon.toFixed(5), +p.lat.toFixed(5)]); last = p; }
  const e = pts[pts.length - 1]; out.push([e.lon, e.lat]);
  return out;
}
$('dlTrace').onclick = () => {
  if (!track) return;
  const lons = track.pts.map(p => p.lon), lats = track.pts.map(p => p.lat);
  downloadPack({
    id: 'trace:' + track.name + '|' + Math.round(track.total), kind: 'trace', name: track.name, detail: 'trace',
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], line: simplifyLine(track.pts)
  }, traceTiles(track));
};
$('dlDep').onclick = async () => {
  await loadDeps();
  const { d, z, tiles } = currentDepTiles();
  if (tiles.length > 40000) { toast('Zone trop grande.', 4000); return; }
  try {
    const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    if (e && e.quota && tiles.length * tileKB * 1024 > (e.quota - e.usage) * 0.9) { toast('Pas assez de place sur le téléphone pour cette carte.', 5000); return; }
  } catch {}
  downloadPack({ id: `dep:${d.code}:${z}`, kind: 'dep', code: d.code, name: `${d.code} · ${d.nom}`, detail: z >= 15 ? 'détaillé' : 'standard', bbox: polysBBox(d.polys) }, tiles);
};

// ---------- liste des cartes téléchargées ----------
async function listPacks() { try { return ((await idb('readonly', st => st.getAll(), 'packs')) || []).sort((a, b) => b.date - a.date); } catch { return []; } }
async function renderPacks() {
  const list = $('packList'), packs = await listPacks();
  list.innerHTML = ''; $('packEmpty').hidden = packs.length > 0;
  for (const p of packs) {
    const li = document.createElement('li');
    const info = document.createElement('div'); info.className = 'lib-item';
    info.innerHTML = '<b></b><span></span>';
    info.querySelector('b').textContent = p.name;
    info.querySelector('span').textContent = `${p.kind === 'trace' ? 'Le long de la trace' : 'Département, ' + p.detail} · ${fmtMo(p.bytes / 1024)} · ${fmtDate(p.date)}` + (p.complete ? '' : ` · incomplet`);
    const acts = document.createElement('div'); acts.className = 'pack-acts';
    if (!p.complete) {
      const re = document.createElement('button'); re.className = 'btn small'; re.textContent = 'Reprendre';
      re.onclick = () => downloadPack(p, p.tiles); acts.appendChild(re);
    }
    const see = document.createElement('button'); see.className = 'btn small'; see.textContent = 'Voir';
    see.onclick = () => {
      $('maps').hidden = true;
      if (!$('showPacks').checked) { $('showPacks').checked = true; store.set('showPacks', '1'); drawPacks(); }
      const [w, s, e, n] = p.bbox;
      map.fitBounds([[w, s], [e, n]], { padding: { top: 90, bottom: $('sheet').offsetHeight + 20, left: 30, right: 76 }, bearing: 0, pitch: 0, duration: 700 });
    };
    const del = document.createElement('button'); del.className = 'lib-del'; del.setAttribute('aria-label', 'Supprimer ' + p.name);
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    del.onclick = () => deletePack(p);
    acts.append(see, del);
    li.append(info, acts); list.appendChild(li);
  }
}
async function deletePack(p) {
  if (dl) { toast('Attends la fin du téléchargement.'); return; }
  toast('Suppression…', 8000);
  try {
    const others = new Set(); (await listPacks()).filter(q => q.id !== p.id).forEach(q => (q.tiles || []).forEach(t => others.add(t)));
    const cache = await caches.open(TILE_CACHE);
    for (const t of p.tiles || []) if (!others.has(t)) { const [z, x, y] = t.split('/'); await cache.delete(tileKey('ign', z, x, y)); }
    await idb('readwrite', st => st.delete(p.id), 'packs');
    toast(`${p.name} supprimée`);
  } catch { toast('Suppression impossible.'); }
  renderPacks(); updateStorageInfo(); drawPacks();
}
$('btnClearTiles').onclick = async () => {
  if (dl) { toast('Attends la fin du téléchargement.'); return; }
  try {
    await caches.delete(TILE_CACHE);
    for (const p of await listPacks()) await idb('readwrite', st => st.delete(p.id), 'packs');
    toast('Toutes les cartes hors ligne sont supprimées');
  } catch {}
  renderPacks(); updateStorageInfo(); drawPacks();
};

// zones téléchargées dessinées sur la carte
async function drawPacks() {
  if (store.get('showPacks') === '0') { setSrc('packs', EMPTY); return; }
  const packs = await listPacks(), feats = [];
  for (const p of packs) {
    if (p.kind === 'trace' && p.line) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p.line } });
    if (p.kind === 'dep') {
      try { await loadDeps(); } catch { continue; }
      const d = deps.find(x => x.code === p.code);
      if (d) d.polys.forEach(poly => feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: poly } }));
    }
  }
  setSrc('packs', { type: 'FeatureCollection', features: feats });
}
drawPacks();

// =====================================================================
// Simulation : parcourt la trace avec un écart volontaire, pour tester à la maison
// =====================================================================
let sim = null;
function startSim() {
  if (!track) { toast('Ouvre d\'abord un fichier GPX.'); return; }
  stopGPS(); stopSim();
  let d = progress ? progress.along : 0;
  const v = 9, devStart = d + Math.min(track.total * 0.25, 1200), devLen = Math.min(500, track.total * 0.15);
  sim = setInterval(() => {
    d += v;
    if (d >= track.total) { stopSim(); return; }
    let p = pointAt(track, d);
    if (d > devStart && d < devStart + devLen) {
      const k = Math.sin((d - devStart) / devLen * Math.PI);
      p = offsetPoint(p, bearing(pointAt(track, d - 10), pointAt(track, d + 10)) + 90, 160 * k);
    }
    onPos({ lat: p.lat, lon: p.lon, ele: track.ele[p.i], acc: 5, speed: v, heading: null, t: Date.now(), sim: true });
  }, 1000);
  startNav();
  toast('Simulation : écart volontaire de la trace dans ' + fmtDist(devStart - d), 4000);
}
function stopSim() { if (sim) { clearInterval(sim); sim = null; } }
$('btnSim').onclick = startSim;

// =====================================================================
// Exemple, panneau, démarrage
// =====================================================================
$('btnDemo').onclick = () => {
  // boucle fictive au-dessus d'Annecy, altitudes synthétiques
  const pts = [], c = [45.82, 6.10], N = 400;
  for (let i = 0; i <= N; i++) {
    const a = i / N * 2 * Math.PI, r = .028 + .006 * Math.sin(3 * a) + .003 * Math.cos(7 * a);
    pts.push(`<trkpt lat="${(c[0] + r * Math.sin(a)).toFixed(6)}" lon="${(c[1] + r * 1.4 * Math.cos(a)).toFixed(6)}"><ele>${(900 + 520 * Math.sin(a / 2) ** 2 + 60 * Math.sin(9 * a)).toFixed(1)}</ele></trkpt>`);
  }
  loadText(`<gpx><trk><name>Exemple · boucle du Semnoz</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`);
};

function toggleMore(open) {
  const m = $('more'); m.hidden = open === undefined ? !m.hidden : !open;
  document.body.classList.toggle('sheet-open', !m.hidden);
  $('btnMore').textContent = m.hidden ? 'Réglages' : 'Fermer';
}
$('btnMore').onclick = () => toggleMore(); $('grip').onclick = () => toggleMore();

// Glisser le panneau du bas : vers le haut ouvre les réglages, vers le bas les ferme
(() => {
  const sheet = $('sheet');
  let y0 = null, dy = 0, startScroll = 0;
  const interactive = t => t.closest('button, select, input, label, a');
  sheet.addEventListener('touchstart', e => {
    if (interactive(e.target) || e.touches.length > 1) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; startScroll = sheet.scrollTop;
  }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    const open = !$('more').hidden;
    // on laisse défiler le contenu des réglages, sauf si on tire vers le bas depuis le haut
    if (open && (dy < 0 || startScroll > 0)) return;
    if (e.cancelable) e.preventDefault();
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${dy > 0 ? dy * 0.6 : dy * 0.25}px)`;
  }, { passive: false });
  const end = () => {
    if (y0 == null) return;
    sheet.style.transition = 'transform .2s ease-out'; sheet.style.transform = '';
    const open = !$('more').hidden;
    if (!open && dy < -35) toggleMore(true);
    else if (open && dy > 50 && startScroll <= 0) toggleMore(false);
    y0 = null; dy = 0;
  };
  sheet.addEventListener('touchend', end); sheet.addEventListener('touchcancel', end);
})();

// les boutons ronds se placent juste au-dessus du panneau du bas, quelle que soit sa hauteur
try {
  new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', $('sheet').offsetHeight + 'px')).observe($('sheet'));
} catch { /* navigateur ancien : position par défaut */ }

const saved = store.get('gpx');
if (saved) { try { showTrack(parseGPX(saved)); } catch { drawProfile(); } } else drawProfile();
checkShared();
const VERSION = '8 · 8 oct. 2026';
$('note').textContent = (window.isSecureContext ? '' : 'Attention : le GPS ne fonctionne qu\'en HTTPS. ') + 'Version ' + VERSION;
// Mises à jour : on vérifie à chaque ouverture et on recharge dès qu'une nouvelle version est prête
// (jamais pendant une navigation ou un enregistrement : on attend la fin)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloading = false, hadController = !!navigator.serviceWorker.controller;
  const tryReload = () => {
    if (reloading) return;
    if (nav || recording) { setTimeout(tryReload, 30000); return; }
    reloading = true; location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) tryReload(); hadController = true; });
}
window.__balise = { onPos, get state() { return { nav, isOff, rejoin: !!rejoin, straight: rejoin && rejoin.straight, progress }; } };
})();
