/* Pisteo — navigation guidée sur une trace GPX */
(() => {
'use strict';

// La page et le code doivent être de la même version. Sinon (page gardée en cache
// par le téléphone ou par GitHub), on recharge une page fraîche, au plus 3 fois.
const APP_VERSION = 35;
try {
  const meta = document.querySelector('meta[name="balise-version"]');
  const pageV = meta ? +meta.content : 0;
  if (pageV !== APP_VERSION) {
    const n = +(sessionStorage.getItem('fixVersion') || 0);
    if (n < 3) {
      sessionStorage.setItem('fixVersion', String(n + 1));
      const keep = /[?&]shared=1/.test(location.search) ? '&shared=1' : '';
      location.replace(location.pathname + '?fresh=' + Date.now() + keep);
      throw new Error('version');
    }
  } else sessionStorage.removeItem('fixVersion');
  if (/[?&]fresh=/.test(location.search)) history.replaceState(null, '', location.pathname + (/[?&]shared=1/.test(location.search) ? '?shared=1' : ''));
} catch (e) { if (e.message === 'version') return; }

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
  const cum = [0], up = [0], down = [0];
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + hav(pts[i - 1], pts[i]);
    const d = ele[i] != null && ele[i - 1] != null ? ele[i] - ele[i - 1] : 0;
    up[i] = up[i - 1] + (d > 0 ? d : 0);
    down[i] = down[i - 1] + (d < 0 ? -d : 0);
  }
  const p = { id: ++pathSeq, name, pts, ele, cum, up, down, hasEle, total: cum[n - 1] || 0, totalUp: up[n - 1] || 0, totalDown: down[n - 1] || 0, lastIdx: 0 };
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
  { id: 'monde', name: 'Monde (OpenFreeMap)', vector: true, max: 14 },
  { id: 'osm', name: 'Plan OSM', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], max: 19,
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }
];
// Carte mondiale OpenFreeMap : gratuite, sans limite, téléchargeable ; légère car vectorielle
const OFM_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet';
const OFM_ATTR = '<a href="https://openfreemap.org">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
let ofmStyle = null, ofmLayerIds = [];
async function getOfmStyle() {
  if (ofmStyle) return ofmStyle;
  try { ofmStyle = await (await fetch(OFM_STYLE)).json(); store.set('ofmStyle', JSON.stringify(ofmStyle)); }
  catch { try { ofmStyle = JSON.parse(store.get('ofmStyle')); } catch {} }
  return ofmStyle;
}
async function getOfmTiles() {
  try { const t = (await (await fetch(OFM_TILEJSON)).json()).tiles[0]; if (t) { store.set('ofmTiles', t); return t; } } catch {}
  return store.get('ofmTiles') || 'https://tiles.openfreemap.org/planet/20261004_113936_pt/{z}/{x}/{y}.pbf';
}
let layerIdx = Math.max(0, LAYERS.findIndex(l => l.id === store.get('layerId')));
const baseSource = l => ({ type: 'raster', tiles: l.tiles, tileSize: 256, maxzoom: l.max, attribution: l.attr });
const EMPTY = { type: 'FeatureCollection', features: [] };
const lineFeature = pts => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) } });
const pointFeature = p => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });

const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: { base: baseSource(LAYERS[layerIdx].vector ? LAYERS[0] : LAYERS[layerIdx]) },
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
  if (LAYERS[layerIdx].vector) setLayer(layerIdx, false);
});
async function setSrc(id, data) { await ready; const s = map.getSource(id); if (s) s.setData(data); }

const baseBefore = () => map.getLayer('packs-fill') ? 'packs-fill' : 'track-casing';
function removeBase() {
  if (map.getLayer('base')) map.removeLayer('base');
  if (map.getSource('base')) map.removeSource('base');
  for (const id of ofmLayerIds) if (map.getLayer(id)) map.removeLayer(id);
  ofmLayerIds = [];
  if (map.getSource('ofm')) map.removeSource('ofm');
}
async function addVectorBase() {
  const st = await getOfmStyle();
  if (!st) { toast('Carte Monde indisponible : elle n\'a encore jamais été chargée avec du réseau.', 5000); return false; }
  const tpl = await getOfmTiles();
  map.setGlyphs(st.glyphs); map.setSprite(st.sprite);
  map.addSource('ofm', { type: 'vector', tiles: [tpl], minzoom: 0, maxzoom: 14, attribution: OFM_ATTR });
  const before = baseBefore();
  for (const L of st.layers) {
    if (L.source && L.source !== 'openmaptiles') continue; // l'ombrage du relief mondial n'est pas repris
    const l2 = Object.assign({}, L, { id: 'ofm-' + L.id });
    if (L.source) l2.source = 'ofm';
    try { map.addLayer(l2, before); ofmLayerIds.push(l2.id); } catch { /* couche non gérée */ }
  }
  return true;
}
let layerSeq = 0;
async function setLayer(i, remember = true) {
  const seq = ++layerSeq;
  layerIdx = i; if (remember) store.set('layerId', LAYERS[i].id);
  await ready;
  if (LAYERS[i].vector) {
    const st = await getOfmStyle(); await getOfmTiles();
    if (seq !== layerSeq) return;
    removeBase();
    if (!st || !(await addVectorBase())) { layerIdx = 0; map.addSource('base', baseSource(LAYERS[0])); map.addLayer({ id: 'base', type: 'raster', source: 'base' }, baseBefore()); }
    return;
  }
  if (seq !== layerSeq) return;
  removeBase();
  map.addSource('base', baseSource(LAYERS[i]));
  map.addLayer({ id: 'base', type: 'raster', source: 'base' }, baseBefore());
}
$('btnLayer').onclick = () => {
  offlineSwitched = null;
  const next = (layerIdx + 1) % LAYERS.length;
  setLayer(next); toast('Fond de carte : ' + LAYERS[next].name);
};

// Sans réseau, on bascule tout seul sur la carte IGN téléchargée, puis on revient au fond choisi
let offlineSwitched = null;
async function onOffline() {
  let want = 'ign';
  try {
    const here = me || (() => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; })();
    const p = (await listPacks()).find(p => p.prov === 'ofm' && here.lon >= p.bbox[0] - 0.02 && here.lon <= p.bbox[2] + 0.02 && here.lat >= p.bbox[1] - 0.02 && here.lat <= p.bbox[3] + 0.02);
    if (p) want = 'monde';
  } catch {}
  const idx = LAYERS.findIndex(l => l.id === want);
  if (layerIdx !== idx) { offlineSwitched = layerIdx; setLayer(idx, false); toast(`Pas de réseau : carte ${want === 'ign' ? 'IGN' : 'Monde'} hors ligne`); }
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
    if (/v[ée]lo|cyclo|bike|vtt|gravel|bici/i.test(t.name) && profile !== 'trekking')
      toast(`Trace chargée : ${t.name}`, 6000, { label: 'Mode vélo', run: () => setProfile('trekking') });
    else toast(`Trace chargée : ${t.name}`);
  } catch (e) { toast(e.message, 4000); }
}

// ---------- Mes traces : les GPX déjà ouverts, gardés sur le téléphone ----------
let dbP = null;
function openDB() {
  return dbP || (dbP = new Promise((res, rej) => {
    // un autre onglet de l'appli (ancienne version) peut bloquer l'ouverture : on n'attend pas indéfiniment
    const timer = setTimeout(() => { dbP = null; rej(new Error('blocked')); }, 3000);
    const r = indexedDB.open('balise', 5);
    r.onblocked = () => { clearTimeout(timer); dbP = null; rej(new Error('blocked')); };
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('packs')) d.createObjectStore('packs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('graphs')) d.createObjectStore('graphs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('graphChunks')) d.createObjectStore('graphChunks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('places')) d.createObjectStore('places', { keyPath: 'code' });
    };
    r.onsuccess = () => {
      clearTimeout(timer);
      // si une version plus récente de l'appli s'ouvre ailleurs, on libère la base pour elle
      r.result.onversionchange = () => { r.result.close(); dbP = null; };
      res(r.result);
    };
    r.onerror = () => { clearTimeout(timer); dbP = null; rej(r.error); };
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
async function saveRecent(p, text, mustSucceed = false) {
  try {
    const id = p.name + '|' + Math.round(p.total);
    await idb('readwrite', st => st.put({ id, name: p.name, dist: p.total, up: p.hasEle ? p.totalUp : null, date: Date.now(), text }));
    const all = await listRecent();
    for (const old of all.slice(30)) await idb('readwrite', st => st.delete(old.id)); // on garde les 30 dernières
    return true;
  } catch (e) { if (mustSucceed) throw e; return false; }
}
const fmtDate = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
async function renderLib() {
  const list = $('libList'), items = await listRecent();
  list.innerHTML = '';
  $('libEmpty').hidden = items.length > 0;
  for (const it of items) {
    const li = document.createElement('li');
    const open = document.createElement('button'); open.className = 'lib-item';
    open.innerHTML = `<b></b><span>${fmtDist(it.dist)}${it.up != null ? ' · D+ ' + fmtM(it.up) : ''} · ${/^Sortie du /.test(it.name) ? 'enregistrée' : 'ouverte'} le ${fmtDate(it.date)}</span>`;
    open.querySelector('b').textContent = it.name;
    open.onclick = () => { closeLib(); loadText(it.text); };
    const share = document.createElement('button'); share.className = 'lib-del'; share.setAttribute('aria-label', 'Exporter ' + it.name);
    share.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/></svg>';
    share.onclick = () => shareGPX(it.text, it.name);
    const del = document.createElement('button'); del.className = 'lib-del'; del.setAttribute('aria-label', 'Retirer ' + it.name);
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    del.onclick = async () => { await idb('readwrite', st => st.delete(it.id)).catch(() => {}); renderLib(); };
    li.append(open, share, del); list.appendChild(li);
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
const fixWaiters = [];
function waitFix(ms) {
  if (me && Date.now() - me.t < 60000) return Promise.resolve(me);
  return new Promise(res => { fixWaiters.push(res); setTimeout(() => res(null), ms); });
}
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

  onActFix(pos);
  if (track) progress = project(track, pos);
  if (rejoin) {
    if (rejoin.straight) { const why = rejoin.why; setRejoinPath([{ lat: pos.lat, lon: pos.lon }, rejoin.target], rejoin.target, true); rejoin.why = why; }
    rejoinProg = project(rejoin, pos);
  }
  updateHeading();

  if (pendingRejoin) { pendingRejoin = false; requestRejoin(true); }
  if (fixWaiters.length && (pos.acc || 99) <= 100) { fixWaiters.splice(0).forEach(f => f(pos)); }
  if (nav && !pos.sim && (pos.acc || 0) <= 40) { // distance parcourue depuis le début de la navigation
    if (!freeRef) freeRef = pos;
    else { const d = hav(freeRef, pos); if (d >= 8) { if (d < 500) freeD += d; freeRef = pos; } }
  }
  if (nav) {
    offTrackLogic();
    if (rejoin && progress && progress.dist < Math.min(thrRef() * 0.7, 30) && !isOff) clearRejoin();
    if (!rejoin && progress && progress.remain < 25 && !arrived) {
      arrived = true; say('Vous êtes arrivé'); vibrate([200, 100, 200]);
    }
    guidance();
    if (follow) navCamera(1000);
  } else {
    if (rejoin && progress && progress.dist < Math.min(thrRef() * 0.7, 30)) { clearRejoin(); toast('Tu es sur la trace'); }
    if (followOv) map.easeTo({ center: [pos.lon, pos.lat], duration: 800 });
  }
  if (progress) setDone(progress.along / track.total);
  updateStats(); drawProfileSoon(); updateNavMore();
}

// =====================================================================
// Mode navigation
// =====================================================================
let nav = false, follow = true, followOv = false, navTrackId = null, navStartT = 0, freeD = 0, freeRef = null;
function navZoom() { const s = speedEma || 1.2; return s > 7 ? 15.4 : s > 3.5 ? 16.2 : 17; }
function navCamera(dur) {
  if (!me) return;
  const h = map.getContainer().clientHeight;
  map.easeTo({
    center: [me.lon, me.lat], bearing: heading != null ? heading : map.getBearing(), pitch: 52, zoom: navZoom(),
    padding: { top: Math.round(h * 0.45), bottom: Math.min($('navBottom').offsetHeight || 100, h * 0.45), left: 0, right: 0 }, duration: dur, easing: t => t, essential: true
  });
}
function setFollow(v) { follow = v; $('btnCenter').classList.toggle('on', nav ? v : followOv); }
map.on('rotate', () => { if (nav && (!track || (rejoin && rejoin.straight))) guidance(); });
['dragstart', 'rotatestart', 'pitchstart'].forEach(ev => map.on(ev, e => {
  if (!e.originalEvent) return;
  if (nav) setFollow(false); else { followOv = false; $('btnCenter').classList.remove('on'); }
}));

async function startNav(free = false) {
  if (!track && !free) { openDest(); return; }
  if (!startGPS()) return;
  nav = true; arrived = false; isOff = false; offCount = 0;
  navTrackId = track ? track.id : null;
  navStartT = Date.now(); freeD = 0; freeRef = null;
  document.body.classList.add('nav'); document.body.classList.toggle('free', !track); toggleMore(false);
  setFollow(true);
  unlockAudio(); enableCompass(); keepAwake();
  say(me ? 'C\'est parti' : 'Navigation démarrée. Recherche du signal GPS.');
  if (actState === 'idle') {
    if (store.get('autoRec') === '1') startActivity();
    else { const n = +(store.get('recHint') || 0); if (n < 3) { store.set('recHint', n + 1); setTimeout(() => toast('Touche ● pour enregistrer ta sortie', 4000), 1500); } }
  }
  if (me) { if (track) progress = project(track, me, true); guidance(); navCamera(800); }
  else setBanner('gps', '', 'Recherche du signal GPS…', 'gps');
  updateStats();
}
function stopNav() {
  nav = false; document.body.classList.remove('nav', 'free'); toggleNavMore(false);
  stopSim(); clearRejoin(); isOff = false;
  try { speechSynthesis.cancel(); } catch {}
  setSrc('turn', EMPTY);
  map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
  if (!recording) stopGPS();
  setFollow(false);
}
$('btnNav').onclick = () => track ? startNav() : openDest();
$('btnExit').onclick = () => {
  if (actState === 'waiting') { cancelWaiting(); stopNav(); return; }
  if (actState === 'on' || actState === 'paused') { finishThenExit = true; openFinish(); return; }
  stopNav();
};
$('btnOverview').onclick = () => {
  if (!track) { openDest(); return; } // balade libre : choisir une destination
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
  if (!track) {
    const h = heading, dir = h == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(h / 45) % 8];
    setBanner('gps', h == null ? '' : `${Math.round(h)}° ${dir}`, 'Balade libre', { rot: -Math.round(map.getBearing()) }, 'La flèche montre le nord · bouton en bas à droite pour choisir une destination');
    return;
  }
  if (!progress) return;
  if (arrived && !rejoin) { setBanner('done', '', 'Vous êtes arrivé', 'flag', `${track.name}`); setSrc('turn', EMPTY); return; }
  if (isOff && !rejoin) {
    setBanner('off', fmtDist(progress.dist), routing ? 'Hors trace · calcul du retour…' : 'Hors trace', 'off', 'Touchez ↩ pour un itinéraire de retour');
    return;
  }
  if (rejoin && rejoin.straight) {
    // la flèche est dessinée par rapport à l'écran : on retire l'orientation actuelle de la carte
    const b = bearing(me, rejoin.target), rel = Math.round(angDiff(map.getBearing(), b));
    setBanner('rejoin', fmtDist(hav(me, rejoin.target)), 'Rejoignez la trace', { rot: rel }, `À vol d'oiseau, cap ${Math.round(b)}° · ${rejoin.why || 'pas de réseau pour le chemin'}`);
    return;
  }
  const path = rejoin || track, pr = rejoin ? rejoinProg : progress;
  if (!pr) return;
  const next = path.turns.find(t => t.along > pr.along + 3) || path.turns[path.turns.length - 1];
  const dTo = Math.max(0, next.along - pr.along);
  const info = next.arrive ? (rejoin ? { txt: 'Rejoignez la trace', icon: 'join' } : { txt: 'Arrivée', icon: 'flag' }) : turnInfo(next.ang);
  const tone = rejoin ? 'rejoin' : 'ok';
  const sub = rejoin ? `Retour à la trace · ${fmtDist(rejoinProg.remain)} par le chemin` : '';
  if (dTo > 1200) setBanner(tone, fmtDist(dTo), track.route ? 'Continuez sur l\'itinéraire' : 'Continuez sur la trace', 0, (next.arrive ? '' : `puis ${lc(info.txt)}`) + (sub ? (next.arrive ? '' : ' · ') + sub : ''));
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
// Son (voix + bips) et vibrations : réglables séparément, dans les réglages et en navigation
let voiceOn = store.get('voice') !== '0', vibOn = store.get('vib') !== '0';
function syncAlertUI() {
  $('btnVoice').classList.toggle('muted', !voiceOn);
  $('btnVibFab').classList.toggle('muted', !vibOn);
  $('optVoice').checked = voiceOn; $('optVib').checked = vibOn;
  $('npVoice').classList.toggle('off', !voiceOn); $('npVoice').textContent = voiceOn ? 'Son activé' : 'Son coupé';
  $('npVib').classList.toggle('off', !vibOn); $('npVib').textContent = vibOn ? 'Vibrations activées' : 'Vibrations coupées';
}
function setVoice(on) {
  voiceOn = on; store.set('voice', on ? '1' : '0'); syncAlertUI();
  if (on) say('Guidage vocal activé'); else { try { speechSynthesis.cancel(); } catch {} toast('Son coupé'); }
}
function setVib(on) {
  vibOn = on; store.set('vib', on ? '1' : '0'); syncAlertUI();
  if (on) vibrate(120); toast(on ? 'Vibrations activées' : 'Vibrations coupées');
}
$('btnVoice').onclick = () => setVoice(!voiceOn);
$('btnVibFab').onclick = () => setVib(!vibOn);
$('optVoice').onchange = e => setVoice(e.target.checked);
$('optVib').onchange = e => setVib(e.target.checked);
$('npVoice').onclick = () => setVoice(!voiceOn);
$('npVib').onclick = () => setVib(!vibOn);
setTimeout(syncAlertUI, 0);
// ---------- voix du guidage : celles installées sur le téléphone ----------
// voix : celle du téléphone par défaut, en français (le choix de voix pourra revenir si besoin)
const voiceRate = 1.05;
const frVoices = () => { try { return speechSynthesis.getVoices().filter(v => /^fr/i.test(v.lang)); } catch { return []; } };
function pickVoice() {
  const vs = frVoices();
  return vs.find(v => /fr[-_]FR/i.test(v.lang) && v.localService) || vs.find(v => /fr[-_]FR/i.test(v.lang)) || vs[0] || null;
}
function say(text) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR'; u.rate = voiceRate;
    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; }
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
const vibrate = p => { if (!vibOn) return; try { navigator.vibrate && navigator.vibrate(p); } catch {} };

// =====================================================================
// Hors trace et itinéraire de retour
// =====================================================================
// 0 = aucune alerte (le retour à la trace reste possible avec le bouton ↩)
const savedThr = store.get('thr');
let threshold = savedThr == null ? 50 : +savedThr, offCount = 0, isOff = false, lastAlert = 0;
let rejoin = null, rejoinProg = null, routing = false, lastRoute = 0, rejoinOff = 0;
let profile = store.get('profile') || 'hiking-mountain';
$('thr').value = String(threshold);
$('thr').onchange = e => {
  threshold = +e.target.value; store.set('thr', threshold);
  if (!threshold && isOff) { isOff = false; offCount = 0; clearRejoin(); guidance(); }
  toast(threshold ? `Alerte au-delà de ${threshold} m de la trace` : 'Alerte hors trace désactivée');
};
const thrRef = () => threshold || 50; // distance « sur la trace » quand l'alerte est coupée
$('prof').value = profile;
$('autoRec').checked = store.get('autoRec') === '1';
$('autoRec').onchange = e => store.set('autoRec', e.target.checked ? '1' : '0');
function setProfile(p, quiet) {
  profile = p; store.set('profile', p);
  $('prof').value = p; $('destProf').value = p;
  $('npMode').textContent = p === 'trekking' ? 'À vélo' : 'À pied';
  if (!quiet) toast(p === 'trekking' ? 'Mode vélo : itinéraires et temps estimés pour le vélo' : 'Mode à pied : itinéraires et temps estimés pour la marche', 3500);
  updateStats();
}
$('prof').onchange = e => setProfile(e.target.value);
$('npMode').onclick = () => setProfile(profile === 'trekking' ? 'hiking-mountain' : 'trekking');
setTimeout(() => setProfile(profile, true), 0);

function alertOff() { vibrate([400, 150, 400, 150, 400]); beep(); lastAlert = Date.now(); }

function offTrackLogic() {
  if (!progress || arrived) return;
  // alerte coupée : rien sur une trace GPX ; vers une destination, on garde le recalcul (sans alerte)
  const thr = threshold || (track && track.route ? 50 : 0);
  if (!thr) return;
  const acc = me.acc || 0, tol = thr + Math.min(acc, 60) * 0.5, now = Date.now();
  if (progress.dist > tol && acc < 100) offCount++; else if (progress.dist <= tol) offCount = 0;
  if (!isOff && offCount >= 2) {
    isOff = true;
    if (threshold) { alertOff(); say('Vous avez quitté la trace. Calcul d\'un itinéraire de retour.'); }
    requestRejoin(false);
  } else if (isOff && progress.dist < thr * 0.7) {
    isOff = false; offCount = 0; clearRejoin();
    vibrate(150); say('Vous avez rejoint la trace'); toast('De retour sur la trace');
  } else if (isOff) {
    // on s'écarte de l'itinéraire de retour : on recalcule
    if (rejoin && !rejoin.straight && rejoinProg && rejoinProg.dist > 40) {
      if (++rejoinOff >= 2 && now - lastRoute > 20000) { rejoinOff = 0; requestRejoin(false); }
    } else rejoinOff = 0;
    if (rejoin && rejoin.straight && now - lastRoute > 60000) requestRejoin(false); // le réseau est peut-être revenu
    if (!rejoin && !routing && now - lastRoute > 30000) requestRejoin(false);
    if (!rejoin && threshold && now - lastAlert > 60000) alertOff();
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
async function fetchRoute(a, b, ms = 12000) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ms);
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
  if (track.route) { reroute(); return; }
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
  // pas de réseau (ou serveur muet) : calcul sur le téléphone avec les chemins téléchargés
  if (!best) { await loadGraphs(); const loc = localRejoin(track, me); if (loc) best = Object.assign(loc, { local: true }); }
  routing = false; $('btnRejoin').classList.remove('busy');
  if (best) {
    // on termine l'itinéraire exactement sur la trace
    best.pts.push({ lat: best.target.lat, lon: best.target.lon, ele: null });
    setRejoinPath(best.pts, best.target, false);
    const msg = `Itinéraire de retour : ${fmtDist(rejoin.total)} par le chemin`;
    if (nav) say(`Itinéraire de retour calculé${best.local ? ' hors connexion' : ''}, ${speakDist(rejoin.total)}`); else { toast(msg + (best.local ? ' (calculé hors connexion)' : ''), 4000); fitTo([rejoin.pts, [me]]); }
  } else {
    const c = cands[0];
    setRejoinPath([{ lat: me.lat, lon: me.lon }, c], c, true);
    rejoin.why = 'pas de réseau, ' + whyNoLocal(me);
    const msg = `Ligne droite : ${rejoin.why}. Trace à ${fmtDist(c.dist)}, cap ${Math.round(bearing(me, c))}°`;
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
// Aller à un lieu (sans GPX) : recherche d'adresse IGN, itinéraire BRouter
// =====================================================================
function openDest() {
  toggleMore(false);
  $('destProf').value = profile;
  $('dest').hidden = false;
  setTimeout(() => $('destQ').focus(), 50);
}
function closeDest() { $('dest').hidden = true; $('destQ').blur(); }
$('destClose').onclick = closeDest;
$('dest').onclick = e => { if (e.target === $('dest')) closeDest(); };
$('destProf').onchange = e => setProfile(e.target.value);
$('destFree').onclick = () => { closeDest(); startNav(true); };

let searchT = 0, searchSeq = 0;
$('destQ').oninput = () => {
  clearTimeout(searchT);
  const q = $('destQ').value.trim();
  if (q.length < 3) { $('destList').innerHTML = ''; return; }
  searchT = setTimeout(() => searchPlaces(q), 300);
};
async function searchPlaces(q) {
  const seq = ++searchSeq, list = $('destList');
  const c = me || (() => { const m = map.getCenter(); return { lat: m.lat, lon: m.lng }; })();
  try {
    if (navigator.onLine === false) throw new Error('hors ligne');
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=6&lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    const j = await r.json();
    if (seq !== searchSeq) return;
    list.innerHTML = '';
    if (!j.features || !j.features.length) { list.innerHTML = '<li class="note">Aucun résultat.</li>'; return; }
    for (const f of j.features) {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      const li = document.createElement('li'), b = document.createElement('button');
      b.className = 'lib-item'; b.innerHTML = '<b></b><span></span>';
      b.querySelector('b').textContent = p.label;
      b.querySelector('span').textContent = (p.context || '') + (me ? ` · ${fmtDist(hav(me, { lat, lon }))} à vol d'oiseau` : '');
      b.onclick = () => goTo({ lat, lon, label: p.name || p.label });
      li.appendChild(b); list.appendChild(li);
    }
  } catch {
    // pas de réseau : communes des départements téléchargés
    const res = await searchLocalPlaces(q, c);
    if (seq !== searchSeq) return;
    list.innerHTML = '';
    if (!res.length) {
      list.innerHTML = `<li class="note">${placesCount ? 'Aucune commune trouvée parmi celles téléchargées.' : 'Sans réseau, la recherche utilise les communes des cartes téléchargées : aucune pour l\'instant.'}</li>`;
      return;
    }
    for (const p of res) {
      const li = document.createElement('li'), b = document.createElement('button');
      b.className = 'lib-item'; b.innerHTML = '<b></b><span></span>';
      b.querySelector('b').textContent = p.nom;
      b.querySelector('span').textContent = `${p.cp ? p.cp + ' · commune' : 'localité'} · hors connexion` + (me ? ` · ${fmtDist(hav(me, p))} à vol d'oiseau` : '');
      b.onclick = () => goTo({ lat: p.lat, lon: p.lon, label: p.nom });
      li.appendChild(b); list.appendChild(li);
    }
  }
}

// ---------- communes enregistrées pour la recherche sans réseau ----------
let placesCache = null, placesCount = 0;
const normName = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-'’]/g, ' ').replace(/\bst\b/g, 'saint').replace(/\bste\b/g, 'sainte').replace(/\s+/g, ' ').trim();
async function loadPlaces() {
  if (placesCache) return placesCache;
  let all = [];
  try { all = (await idb('readonly', st => st.getAll(), 'places')) || []; } catch {}
  placesCache = all.flatMap(d => d.list.map(([nom, lat, lon, cp, pop]) => ({ nom, lat, lon, cp, pop, n: normName(nom) })));
  placesCount = placesCache.length;
  return placesCache;
}
async function searchLocalPlaces(q, near) {
  const all = await loadPlaces(), nq = normName(q);
  if (!nq) return [];
  const scored = [];
  for (const p of all) {
    let sc = -1;
    if (p.n.startsWith(nq)) sc = 0;
    else if (p.n.includes(' ' + nq)) sc = 1;
    else if (p.n.includes(nq)) sc = 2;
    if (sc >= 0) scored.push([sc, -(p.pop || 0), hav(near, p), p]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return scored.slice(0, 8).map(x => x[3]);
}
// liste des communes d'un département (geo.api.gouv.fr), quelques dizaines de Ko
async function downloadPlaces(codes) {
  let added = 0;
  for (const code of codes) {
    try {
      if (await idb('readonly', st => st.getKey(code), 'places')) continue;
      const r = await fetch(`https://geo.api.gouv.fr/communes?codeDepartement=${code}&fields=nom,centre,codesPostaux,population&format=json`);
      if (!r.ok) continue;
      const list = (await r.json()).filter(c => c.centre).map(c => [c.nom, +c.centre.coordinates[1].toFixed(5), +c.centre.coordinates[0].toFixed(5), (c.codesPostaux || [''])[0], c.population || 0]);
      await idb('readwrite', st => st.put({ code, list }), 'places');
      added += list.length;
    } catch { /* on réessaiera plus tard */ }
  }
  if (added) placesCache = null;
  return added;
}
// départements traversés par une trace
async function depsOfLine(coords) {
  await loadDeps();
  const codes = new Set();
  for (let i = 0; i < coords.length; i += Math.max(1, Math.floor(coords.length / 60))) {
    const [lon, lat] = coords[i], d = deps.find(x => inPolys(lon, lat, x.polys));
    if (d) codes.add(d.code);
  }
  return [...codes];
}
// pour toutes les cartes déjà téléchargées (rattrapage discret quand le réseau est là)
async function ensurePlaces() {
  if (navigator.onLine === false) return;
  try {
    const codes = new Set();
    for (const p of await listPacks()) {
      if (p.kind === 'dep') codes.add(p.code);
      else if (p.line) (await depsOfLine(p.line)).forEach(c => codes.add(c));
    }
    if (codes.size) await downloadPlaces([...codes]);
  } catch {}
}

// choisir l'arrivée en touchant la carte
let picking = false;
$('destPick').onclick = () => { closeDest(); picking = true; $('pickBanner').hidden = false; };
$('pickCancel').onclick = () => { picking = false; $('pickBanner').hidden = true; };
map.on('click', e => {
  if (!picking) return;
  picking = false; $('pickBanner').hidden = true;
  goTo({ lat: e.lngLat.lat, lon: e.lngLat.lng, label: 'le point choisi' });
});
// appui long sur la carte : y aller
map.on('contextmenu', e => {
  const d = { lat: e.lngLat.lat, lon: e.lngLat.lng, label: 'le point choisi' };
  toast(me ? `À ${fmtDist(hav(me, d))} à vol d'oiseau` : 'Point choisi', 6000, { label: 'Y aller', run: () => goTo(d) });
});

async function goTo(dest) {
  closeDest();
  if (!startGPS()) return;
  toast('Calcul de l\'itinéraire…', 20000);
  const pos = await waitFix(20000);
  if (!pos) { toast('Position GPS introuvable. Va à découvert et réessaie.', 5000); return; }
  let r;
  try { r = await fetchRoute(pos, dest, 25000); }
  catch {
    await loadGraphs(); r = localRouteTo(pos, dest);
    if (!r) { toast('Itinéraire impossible : pas de réseau, et cet endroit est hors des chemins téléchargés.', 5000); return; }
    toast('Pas de réseau : itinéraire calculé avec les chemins téléchargés', 4000);
  }
  r.pts.push({ lat: dest.lat, lon: dest.lon, ele: null });
  if (nav && !track) document.body.classList.remove('free');
  await showTrack({ name: 'Vers ' + dest.label, pts: r.pts }, !nav);
  track.route = dest;
  toast(`${fmtDist(track.total)} jusqu'à ${dest.label} ${profile === 'trekking' ? 'à vélo' : 'à pied'}`, 4000);
  if (nav) { arrived = false; guidance(); say(`Itinéraire calculé, ${speakDist(track.total)}`); }
  else startNav();
}
async function reroute() {
  if (routing || !me || !track || !track.route) return;
  routing = true; lastRoute = Date.now(); $('btnRejoin').classList.add('busy'); guidance();
  const dest = track.route;
  try {
    let r;
    try { r = await fetchRoute(me, dest, 20000); }
    catch (e) { await loadGraphs(); r = localRouteTo(me, dest); if (!r) throw e; }
    r.pts.push({ lat: dest.lat, lon: dest.lon, ele: null });
    await showTrack({ name: 'Vers ' + dest.label, pts: r.pts }, false);
    track.route = dest; isOff = false; offCount = 0; arrived = false;
    say('Itinéraire recalculé');
  } catch { /* pas de réseau : nouvel essai automatique dans 30 s */ }
  routing = false; $('btnRejoin').classList.remove('busy'); guidance();
}

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
  // temps : allure de base selon le mode (à pied 4,5 km/h + 1 h par 600 m de D+,
  // à vélo 16 km/h + 1 h par 800 m de D+), puis de plus en plus ta vitesse réelle
  // à mesure que tu avances (pleinement après ~3 km)
  const bike = profile === 'trekking';
  const base = (bike ? 16 : 4.5) / 3.6, climb = bike ? 800 : 600;
  const w = speedEma ? clamp(freeD / 3000, 0, 0.85) : 0;
  const v = w * clamp(speedEma || base, 0.5, 15) + (1 - w) * base;
  const secs = rem / v + (track.hasEle ? (1 - w) * up / climb * 3600 : 0);
  return { rem, up, secs };
}
function updateStats() {
  const info = remainingInfo();
  $('sDist').textContent = info ? fmtDist(info.rem) : '–';
  $('sUp').textContent = info && track.hasEle ? fmtM(info.up) : '–';
  const off = $('sOff');
  off.textContent = progress ? fmtDist(progress.dist) : '–';
  off.classList.toggle('bad', !!threshold && !!progress && progress.dist > threshold);
  $('sEle').textContent = me && me.ele != null ? fmtM(me.ele) : (progress && track.ele[progress.idx] != null ? '≈' + fmtM(track.ele[progress.idx]) : '–');
  if (nav && !track) {
    $('nbEta').textContent = me && me.ele != null ? fmtM(me.ele) : '–'; $('nbDur').textContent = 'altitude';
    $('nbRem').textContent = fmtDist(freeD); $('nbL2').textContent = 'parcourus';
    $('nbUp').textContent = fmtDur((Date.now() - navStartT) / 1000); $('nbL3').textContent = 'durée';
    $('nbBar').style.width = '0%';
    const sp = me && me.speed != null && !isNaN(me.speed) ? me.speed * 3.6 : null;
    $('spVal').textContent = sp == null ? '–' : (sp < 10 ? sp.toFixed(1).replace('.', ',') : Math.round(sp));
  }
  if (nav && info) {
    $('nbL2').textContent = 'restant'; $('nbL3').textContent = 'D+ restant';
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
function drawProfile() { drawProfileOn(cv); }
function drawProfileOn(cv) {
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
  if (progress) { // partie déjà parcourue
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, X(progress.along), H); ctx.clip();
    ctx.fillStyle = cssVar('--panel') || '#fff'; ctx.fill(area);
    ctx.fillStyle = COL.done; ctx.globalAlpha = .25; ctx.fill(area); ctx.globalAlpha = 1;
    ctx.strokeStyle = COL.done; ctx.lineWidth = 2; ctx.stroke(path); ctx.restore();
  }
  if (progress && E[progress.idx] != null) {
    const x = X(progress.along), y = Y(E[progress.idx]);
    ctx.strokeStyle = COL.me; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, 4 + h); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COL.me; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
}
window.addEventListener('resize', drawProfile);

// ---------- progression détaillée en navigation (glisser la barre du bas vers le haut) ----------
let navMoreT = 0;
function toggleNavMore(open) {
  const m = $('navMore'), was = !m.hidden;
  m.hidden = open === undefined ? was : !open;
  if (!m.hidden && !was) { navMoreT = 0; updateNavMore(); }
  if (nav && follow && was !== !m.hidden) setTimeout(() => navCamera(400), 50);
}
function updateNavMore() {
  if ($('navMore').hidden || !track) return;
  const pr = progress, done = pr ? pr.along : 0;
  const upLeft = pr ? pr.upLeft : track.totalUp;
  const downLeft = pr ? track.totalDown - (track.down[pr.idx] || 0) : track.totalDown;
  $('npDone').textContent = fmtDist(done);
  $('npLeft').textContent = fmtDist(track.total - done);
  $('npPct').textContent = Math.round(done / track.total * 100) + ' %';
  $('npUpDone').textContent = track.hasEle ? fmtM(track.totalUp - upLeft) : '–';
  $('npUpLeft').textContent = track.hasEle ? fmtM(upLeft) : '–';
  $('npDownLeft').textContent = track.hasEle ? fmtM(downLeft) : '–';
  // temps et vitesse de la sortie enregistrée (hors pauses)
  const el = actState === 'idle' ? 0 : actElapsed() / 1000;
  $('npTime').textContent = el > 0 ? fmtDur(el) : '–';
  $('npAvg').textContent = el > 60 ? (act.d / el * 3.6).toFixed(1).replace('.', ',') + ' km/h' : '–';
  $('npEle').textContent = me && me.ele != null ? fmtM(me.ele) : (pr && track.ele[pr.idx] != null ? '≈ ' + fmtM(track.ele[pr.idx]) : '–');
  if (Date.now() - navMoreT > 2000) { navMoreT = Date.now(); drawProfileOn($('navProfile')); }
}
$('nbGrip').onclick = () => toggleNavMore();
(() => {
  const bar = $('navBottom');
  attachSwipe(bar, () => !$('navMore').hidden, open => toggleNavMore(open));
  try {
    new ResizeObserver(() => { if (bar.offsetHeight) document.documentElement.style.setProperty('--nav-h', bar.offsetHeight + 'px'); }).observe(bar);
  } catch {}
})();
setInterval(() => { if (nav) updateNavMore(); }, 15000); // le temps écoulé avance même à l'arrêt

// =====================================================================
// Activité enregistrée : attente du GPS → en cours ⇄ en pause → terminer
// =====================================================================
let actState = store.get('actState') || 'idle'; // idle | waiting | on | paused
let act = { ms: 0, since: null, d: 0, start: null };
try { act = Object.assign(act, JSON.parse(store.get('act') || '{}')); } catch {}
let rec = [];
try { rec = JSON.parse(store.get('rec') || '[]'); } catch { rec = []; }
// ancienne version : une trace en mémoire sans état connu → on la propose en pause pour pouvoir la terminer
if (!store.get('actState') && rec.length) actState = 'paused';
if (actState === 'waiting') actState = 'idle';
let recording = actState !== 'idle';
let recSeg = rec.length ? (rec[rec.length - 1].s || 0) : 0;
let actRef = null;
const saveAct = () => store.set('act', JSON.stringify(act));
const saveRec = () => store.set('rec', JSON.stringify(rec));
const actElapsed = () => act.ms + (act.since ? Date.now() - act.since : 0);
function setActState(st) {
  actState = st; recording = st !== 'idle'; store.set('actState', st);
  updateActUI(); updateNavMore();
}

function startActivity() {
  if (actState !== 'idle') return;
  if (!startGPS()) return;
  rec = []; saveRec(); recSeg = 0; actRef = null;
  act = { ms: 0, since: null, d: 0, start: null }; saveAct();
  drawRec(); unlockAudio(); keepAwake();
  setActState('waiting');
  // si une position précise est déjà connue, on démarre tout de suite
  if (me && !me.sim && (me.acc || 99) <= 30 && Date.now() - me.t < 10000) beginRecording(me);
}
function beginRecording(pos) {
  act.since = Date.now(); act.start = act.start || Date.now(); saveAct();
  actRef = pos; addRecPoint(pos);
  setActState('on'); vibrate(120); say('Enregistrement démarré');
}
// appelée à chaque position GPS
function onActFix(pos) {
  if (pos.sim) return;
  if (actState === 'waiting' && (pos.acc || 99) <= 30) { beginRecording(pos); return; }
  if (actState !== 'on' || (pos.acc || 0) > 40) return;
  // distance comptée par pas de 8 m, pour ne pas additionner le flottement du GPS à l'arrêt
  if (!actRef) actRef = pos;
  const d = hav(actRef, pos);
  if (d >= 8) { if (d < 500) act.d += d; actRef = pos; saveAct(); }
  addRecPoint(pos);
}
function pauseActivity() {
  if (actState !== 'on') return;
  act.ms += Date.now() - act.since; act.since = null; actRef = null; saveAct(); saveRec();
  setActState('paused');
  if (!nav) stopGPS();
  say('Pause');
}
function resumeActivity() {
  if (actState !== 'paused') return;
  if (!startGPS()) return;
  act.since = Date.now(); actRef = null; recSeg++; saveAct();
  setActState('on'); say('C\'est reparti');
}
function cancelWaiting() { setActState('idle'); if (!nav) stopGPS(); toast('Enregistrement annulé'); }
function togglePause() { if (actState === 'on') pauseActivity(); else if (actState === 'paused') resumeActivity(); }

// ---------- points de la trace enregistrée ----------
function recDist() { let d = 0; for (let i = 1; i < rec.length; i++) if ((rec[i].s || 0) === (rec[i - 1].s || 0)) d += hav(rec[i - 1], rec[i]); return d; }
function recUp() {
  let up = 0, last = null;
  for (const p of rec) { if (p.ele == null) continue; if (last != null && p.ele - last > 3) { up += p.ele - last; last = p.ele; } else if (last == null || p.ele < last) last = p.ele; }
  return up;
}
function drawRec() {
  const segs = [];
  rec.forEach((p, i) => { if (!i || (p.s || 0) !== (rec[i - 1].s || 0)) segs.push([]); segs[segs.length - 1].push([p.lon, p.lat]); });
  setSrc('rec', { type: 'FeatureCollection', features: segs.filter(g => g.length > 1).map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })) });
}
function addRecPoint(p) {
  if (p.sim || p.acc > 50) return;
  const last = rec[rec.length - 1];
  if (last && (last.s || 0) === recSeg && hav(last, p) < 5) return; // évite d'accumuler des points à l'arrêt
  rec.push({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), ele: p.ele != null ? +p.ele.toFixed(1) : null, t: p.t, s: recSeg });
  if (rec.length % 5 === 0) saveRec();
  drawRec();
}
if (rec.length) drawRec();

function actName() { const d = new Date(act.start || (rec[0] && rec[0].t) || Date.now()); return 'Sortie du ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h'); }
function toGPX(name) {
  const esc = s => s.replace(/[<&>]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]));
  // chaque reprise après une pause devient un segment à part (trkseg) : la pause n'est pas comptée
  const segs = [];
  rec.forEach((p, i) => { if (!i || (p.s || 0) !== (rec[i - 1].s || 0)) segs.push([]); segs[segs.length - 1].push(p); });
  const body = segs.map(g => '    <trkseg>\n' + g.map(p => `      <trkpt lat="${p.lat}" lon="${p.lon}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time></trkpt>`).join('\n') + '\n    </trkseg>').join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Pisteo" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>${esc(name)}</name>\n${body}\n  </trk>\n</gpx>\n`;
}
async function shareGPX(text, name) {
  const fname = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.gpx';
  const file = new File([text], fname, { type: 'application/gpx+xml' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } }
  catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fname;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- terminer : bilan, puis garder, exporter ou supprimer ----------
function openFinish() {
  if (actState === 'waiting') { cancelWaiting(); return; }
  if (actState === 'idle') return;
  const el = actElapsed() / 1000;
  $('finDist').textContent = fmtDist(act.d);
  $('finTime').textContent = fmtDur(el);
  $('finAvg').textContent = el > 30 ? (act.d / el * 3.6).toFixed(1).replace('.', ',') + ' km/h' : '–';
  $('finUp').textContent = rec.some(p => p.ele != null) ? fmtM(recUp()) : '–';
  $('finTitle').textContent = actName();
  $('finDelete').textContent = 'Supprimer cette sortie'; $('finDelete').dataset.armed = '';
  $('finMsg').hidden = true;
  $('finish').hidden = false;
}
let finishThenExit = false;
async function endActivity(keep) {
  if (actState === 'on') { act.ms += Date.now() - act.since; act.since = null; }
  const name = actName();
  if (keep && rec.length > 1) {
    const btn = $('finSave'); btn.disabled = true; btn.textContent = 'Enregistrement…';
    try {
      await saveRecent({ name, total: recDist(), hasEle: rec.some(p => p.ele != null), totalUp: recUp() }, toGPX(name), true);
    } catch {
      // on ne perd rien : la sortie reste en cours (en pause) et peut être exportée
      if (actState === 'on') { act.since = Date.now(); }
      btn.disabled = false; btn.textContent = 'Terminer et garder dans Mes traces';
      $('finMsg').textContent = 'Impossible de ranger la sortie : un autre onglet de Pisteo est ouvert. Ferme les autres onglets puis réessaie, ou touche « Exporter le GPX ».';
      $('finMsg').hidden = false;
      return;
    }
    btn.disabled = false; btn.textContent = 'Terminer et garder dans Mes traces';
  }
  rec = []; saveRec(); drawRec(); recSeg = 0;
  act = { ms: 0, since: null, d: 0, start: null }; saveAct();
  setActState('idle');
  if (!nav) stopGPS();
  $('finish').hidden = true;
  toast(keep ? 'Sortie terminée · gardée dans Mes traces' : 'Sortie supprimée', 4000);
  if (finishThenExit) { finishThenExit = false; if (nav) stopNav(); }
}
$('finSave').onclick = () => endActivity(true);
$('finExport').onclick = () => { if (rec.length > 1) shareGPX(toGPX(actName()), actName()); else toast('Pas encore assez de points à exporter.'); };
$('finContinue').onclick = () => { $('finish').hidden = true; finishThenExit = false; };
$('finDelete').onclick = () => {
  const b = $('finDelete');
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Toucher encore pour supprimer définitivement'; return; }
  endActivity(false);
};
$('finish').onclick = e => { if (e.target === $('finish')) { $('finish').hidden = true; finishThenExit = false; } };

// ---------- boutons ----------
// écran principal : Enregistrer / Terminer ; bandeau d'activité avec Pause / Reprendre
$('actEnd').onclick = openFinish;
$('actPause').onclick = () => actState === 'waiting' ? cancelWaiting() : togglePause();
// navigation : bouton rond ● → ⏸ → ▶, et Pause / Terminer dans le panneau de progression
$('btnRecFab').onclick = () => actState === 'idle' ? startActivity() : actState === 'waiting' ? cancelWaiting() : togglePause();
$('npRec').onclick = () => actState === 'idle' ? startActivity() : actState === 'waiting' ? cancelWaiting() : togglePause();
$('npEnd').onclick = openFinish;
$('pauseResume').onclick = resumeActivity;

const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15L19.5 12Z"/></svg>';
function updateActUI() {
  const st = actState;
  // écran principal
  $('actEnd').hidden = st === 'waiting';
  $('actBar').hidden = st === 'idle';
  $('actBar').dataset.state = st;
  $('actLabel').textContent = st === 'waiting' ? 'Recherche du signal GPS…' : st === 'paused' ? 'En pause' : 'Enregistrement';
  $('actPause').innerHTML = st === 'waiting' ? 'Annuler' : st === 'paused' ? ICON_PLAY + 'Reprendre' : ICON_PAUSE + 'Pause';
  // navigation
  const f = $('btnRecFab');
  f.className = 'fab nav-only' + (st === 'on' ? ' recording' : st === 'paused' ? ' paused' : st === 'waiting' ? ' waiting' : '');
  f.innerHTML = st === 'on' ? ICON_PAUSE : st === 'paused' ? ICON_PLAY : '<span class="dot"></span>';
  f.setAttribute('aria-label', st === 'idle' ? 'Enregistrer ma sortie' : st === 'waiting' ? 'Annuler (recherche GPS)' : st === 'on' ? 'Mettre en pause' : 'Reprendre');
  $('npRec').innerHTML = st === 'idle' ? '<span class="dot"></span>Enregistrer ma sortie' : st === 'waiting' ? 'Recherche GPS… Annuler' : st === 'on' ? ICON_PAUSE + 'Pause' : ICON_PLAY + 'Reprendre';
  $('npEnd').hidden = st === 'idle' || st === 'waiting';
  $('pausePill').hidden = st !== 'paused';
  updateActStats();
}
function updateActStats() {
  if (actState === 'idle') return;
  const el = actElapsed() / 1000;
  $('actStats').textContent = actState === 'waiting' ? 'Le chrono démarrera dès que la position est précise'
    : `${fmtDist(act.d)} · ${fmtDur(el)}` + (el > 60 ? ` · ${(act.d / el * 3.6).toFixed(1).replace('.', ',')} km/h` : '');
}
setInterval(() => { if (actState === 'on') updateActStats(); }, 5000);
if (actState === 'on') { act.since = act.since || Date.now(); setTimeout(startGPS, 0); }
updateActUI();

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
    const { d, tiles } = currentDepTiles(), gMo = depGraphMo(d.polys);
    $('dlDepInfo').textContent = `Carte ≈ ${tiles.length.toLocaleString('fr-FR')} tuiles · ~${fmtMo(tiles.length * tileKB)}` + ($('depGraph').checked ? ` · chemins ~${gMo} Mo` : '');
    $('depGraphMo').textContent = `~${gMo} Mo`;
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
setTimeout(ensurePlaces, 4000);
window.addEventListener('online', () => setTimeout(ensurePlaces, 2000));
async function openMaps() {
  toggleMore(false);
  $('maps').hidden = false;
  $('showPacks').checked = store.get('showPacks') !== '0';
  updateOfflineInfo(); updateStorageInfo(); renderPacks();
  try { await loadDeps(); updateOfflineInfo(); } catch { $('dlDepInfo').textContent = 'Liste des départements indisponible.'; }
}
$('btnMaps').onclick = openMaps;
// Réparer : on oublie la copie de l'appli gardée sur le téléphone (pas les cartes ni les traces)
$('btnRepair').onclick = async () => {
  try {
    for (const k of await caches.keys()) if (k.startsWith('app-')) await caches.delete(k);
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  } catch {}
  location.replace(location.pathname + '?fresh=' + Date.now());
};
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
  dl = { stop: false, reason: '', packId: pack.id };
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
    const pct = Math.floor(done / total * 100), rest = done > 20 && done < total ? ` · reste ${left < 60 ? 'moins d’1 min' : '~' + fmtDur(left)}` : '';
    $('offBar').style.width = (done / total * 100) + '%';
    $('offTxt').textContent = `${pct} % · ${done.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')}` + rest + (fail ? ` · ${fail} erreurs` : '');
    // aussi visible hors de la fenêtre des cartes : dans les réglages et sur la ligne de la carte
    $('mapsStatus').textContent = `${pack.name} : ${pct} %${rest}`; $('mapsStatus').hidden = false;
    const row = document.querySelector(`[data-pack="${CSS.escape(pack.id)}"]`);
    if (row) row.textContent = `En cours : ${pct} %${rest}`;
  };
  // une tuile : délai maximal de 20 s, un second essai, sans passer par les secours du service worker
  const prov = pack.prov || 'ign';
  let tileUrl = ignTileUrl;
  if (prov === 'ofm') { const tpl = await getOfmTiles(); tileUrl = (z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y); await precacheOfm(); }
  const getTile = async (z, x, y) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const r = await fetch(tileUrl(z, x, y), { mode: 'cors', cache: 'no-store', signal: ctrl.signal });
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
      const [z, x, y] = queue.shift().split('/'), key = tileKey(prov, z, x, y);
      try {
        const hit = await cache.match(key);
        if (hit) bytes += +(hit.headers.get('x-size') || tileKB * 1024);
        else {
          const b = await getTile(z, x, y);
          if (!b) fail++;
          else {
            await cache.put(key, new Response(b, { headers: { 'content-type': b.type || (prov === 'ofm' ? 'application/x-protobuf' : 'image/png'), 'x-size': String(b.size) } }));
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
  if (fetched > 50 && prov === 'ign') { tileKB = clamp(Math.round(fetchedBytes / fetched / 1024 * 10) / 10 || tileKB, 8, 60); store.set('tileKB', tileKB); }
  await save(!stopped && fail === 0);
  $('dlStop').hidden = true; $('dlTrace').disabled = !track; $('dlDep').disabled = false; $('mapsStatus').hidden = true;
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
$('dlTrace').onclick = async () => {
  if (!track) return;
  const lons = track.pts.map(p => p.lon), lats = track.pts.map(p => p.lat), tr = track;
  const pack = {
    id: 'trace:' + tr.name + '|' + Math.round(tr.total), kind: 'trace', name: tr.name, detail: 'trace',
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], line: simplifyLine(tr.pts)
  };
  const codes = await depsOfLine(pack.line);
  if (!codes.length) pack.prov = 'ofm'; // trace à l'étranger : carte Monde
  await downloadPack(pack, pack.prov === 'ofm' ? traceTiles(tr, 14) : traceTiles(tr));
  // puis le réseau des chemins, pour calculer les itinéraires sans connexion
  if (navigator.onLine !== false) {
    if (codes.length) downloadPlaces(codes); else downloadOsmPlaces(pack, corridorBoxes(tr));
    await downloadGraph(pack, corridorBoxes(tr)); renderPacks();
  }
};
$('dlDep').onclick = async () => {
  await loadDeps();
  const { d, z, tiles } = currentDepTiles();
  if (tiles.length > 40000) { toast('Zone trop grande.', 4000); return; }
  try {
    const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    if (e && e.quota && tiles.length * tileKB * 1024 > (e.quota - e.usage) * 0.9) { toast('Pas assez de place sur le téléphone pour cette carte.', 5000); return; }
  } catch {}
  const pack = { id: `dep:${d.code}:${z}`, kind: 'dep', code: d.code, name: `${d.code} · ${d.nom}`, detail: z >= 15 ? 'détaillé' : 'standard', bbox: polysBBox(d.polys) };
  await downloadPack(pack, tiles);
  downloadPlaces([d.code]);
  if ($('depGraph').checked && navigator.onLine !== false) await downloadDepGraph(pack, d.polys);
};
$('depGraph').checked = store.get('depGraph') !== '0';
$('depGraph').onchange = e => { store.set('depGraph', e.target.checked ? '1' : '0'); updateOfflineInfo(); };

// ---------- zone affichée à l'écran (partout dans le monde) ----------
const bboxPolys = b => [[[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]]];
const bboxKm2 = b => (b[2] - b[0]) * 111.32 * Math.cos(rad((b[1] + b[3]) / 2)) * (b[3] - b[1]) * 110.54;
function zoneTiles(b, zmin, zmax) {
  const out = [];
  for (let z = zmin; z <= zmax; z++) {
    const [x0, y0] = tileXY(b[3], b[0], z), [x1, y1] = tileXY(b[1], b[2], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${z}/${x}/${y}`);
  }
  return out;
}
const OFM_KB = 25; // poids moyen d'une tuile vectorielle
let zoneMode = false;
function zoneBBox() {
  // le cadre en pointillés laisse une marge de 10 % autour de l'écran
  const el = map.getContainer(), w = el.clientWidth, h = el.clientHeight;
  const top = $('zoneBar').offsetHeight + 20, bottom = h - 20;
  const a = map.unproject([w * 0.08, top]), c = map.unproject([w * 0.92, bottom]);
  return [Math.min(a.lng, c.lng), Math.min(a.lat, c.lat), Math.max(a.lng, c.lng), Math.max(a.lat, c.lat)];
}
function zoneInFrance(b) {
  if (!deps) return false;
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  return deps.some(d => inPolys(cx, cy, d.polys));
}
function zonePlan() {
  const b = zoneBBox(), prov = $('zoneProv').value === 'auto' ? (zoneInFrance(b) ? 'ign' : 'ofm') : $('zoneProv').value;
  const tiles = prov === 'ofm' ? zoneTiles(b, 0, 14) : zoneTiles(b, 8, 14);
  const km2 = bboxKm2(b), mapKB = tiles.length * (prov === 'ofm' ? OFM_KB : tileKB), gKB = $('zoneGraph').checked ? km2 * 8 : 0;
  return { b, prov, tiles, km2, mapKB, gKB };
}
function updateZoneInfo() {
  if (!zoneMode) return;
  const z = zonePlan(), tooBig = z.tiles.length > 25000;
  $('zoneInfo').textContent = tooBig
    ? `Zone trop grande (${Math.round(z.km2).toLocaleString('fr-FR')} km²) : zoome un peu`
    : `${Math.round(z.km2).toLocaleString('fr-FR')} km² · carte ${z.prov === 'ofm' ? 'Monde' : 'IGN'} ~${fmtMo(z.mapKB)}` + (z.gKB ? ` · chemins ~${fmtMo(z.gKB)}` : '');
  $('zoneGo').disabled = tooBig;
}
$('zoneStart').onclick = async () => {
  try { await loadDeps(); } catch {}
  $('maps').hidden = true; zoneMode = true; document.body.classList.add('zone');
  setTimeout(() => document.documentElement.style.setProperty('--zone-top', ($('zoneBar').offsetHeight + 20) + 'px'), 0);
  map.easeTo({ bearing: 0, pitch: 0, duration: 300 });
  setTimeout(updateZoneInfo, 350);
};
map.on('moveend', updateZoneInfo);
$('zoneGraph').checked = store.get('zoneGraph') !== '0';
$('zoneGraph').onchange = e => { store.set('zoneGraph', e.target.checked ? '1' : '0'); updateZoneInfo(); };
$('zoneProv').onchange = updateZoneInfo;
$('zoneCancel').onclick = () => { zoneMode = false; document.body.classList.remove('zone'); };
$('zoneGo').onclick = async () => {
  const z = zonePlan();
  zoneMode = false; document.body.classList.remove('zone');
  $('maps').hidden = false;
  const id = 'zone:' + z.b.map(v => v.toFixed(3)).join(',');
  const pack = { id, kind: 'zone', prov: z.prov, name: 'Zone', detail: 'zone', bbox: z.b };
  // un nom parlant : la plus grande localité de la zone
  if (navigator.onLine !== false) { $('offProg').hidden = false; $('offTxt').textContent = 'Recherche des localités de la zone…'; await downloadOsmPlaces(pack, [[z.b[1], z.b[0], z.b[3], z.b[2]]]); }
  try {
    const pl = await idb('readonly', st => st.get(pack.id), 'places');
    if (pl && pl.list.length) { const big = pl.list.slice().sort((a, b) => b[4] - a[4])[0]; pack.name = 'Zone · ' + big[0]; }
    else pack.name = `Zone ${z.b[1].toFixed(2)}, ${z.b[0].toFixed(2)}`;
  } catch {}
  await downloadPack(pack, z.tiles);
  if ($('zoneGraph').checked && navigator.onLine !== false) await downloadDepGraph(pack, bboxPolys(z.b));
  map.fitBounds([[z.b[0], z.b[1]], [z.b[2], z.b[3]]], { padding: 30, duration: 0 });
};

// ---------- carte Monde : styles, polices et pictos gardés pour le hors connexion ----------
async function precacheOfm() {
  const st = await getOfmStyle(); if (!st) return;
  const urls = [OFM_STYLE, OFM_TILEJSON];
  for (const sfx of ['.json', '.png', '@2x.json', '@2x.png']) urls.push(st.sprite + sfx);
  for (const font of ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'])
    for (const r of ['0-255', '256-511', '512-767', '768-1023', '1024-1279', '8192-8447'])
      urls.push(st.glyphs.replace('{fontstack}', encodeURIComponent(font)).replace('{range}', r));
  await Promise.all(urls.map(u => fetch(u).catch(() => {})));
}

// ---------- localités d'une zone (OpenStreetMap), pour la recherche sans réseau ----------
async function downloadOsmPlaces(pack, boxes) {
  try {
    const q = `[out:json][timeout:90];(${boxes.map(b => `node["place"~"^(city|town|village|hamlet|suburb)$"]["name"](${b.map(v => v.toFixed(4)).join(',')});`).join('')});out qt;`;
    const j = await overpass(q, 2);
    const list = j.elements.filter(e => e.tags && e.tags.name).map(e => [e.tags['name:fr'] || e.tags.name, +e.lat.toFixed(5), +e.lon.toFixed(5), '', +(e.tags.population || 0) || ({ city: 50000, town: 5000, village: 500, suburb: 300, hamlet: 50 }[e.tags.place] || 0)]);
    if (list.length) { await idb('readwrite', st => st.put({ code: pack.id, list }), 'places'); placesCache = null; }
  } catch { /* la recherche hors connexion n'aura pas cette zone */ }
}

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
    info.querySelector('span').textContent = `${p.kind === 'trace' ? 'Le long de la trace' : p.kind === 'zone' ? `Zone de ${Math.round(bboxKm2(p.bbox)).toLocaleString('fr-FR')} km²` : 'Département, ' + p.detail} · carte ${p.prov === 'ofm' ? 'Monde' : 'IGN'} · ${fmtMo(p.bytes / 1024)} · ${fmtDate(p.date)}` + (p.complete ? '' : ` · incomplet`) + (p.graph ? (p.graph.partial ? ` · chemins incomplets (${p.graph.km} km)` : ` · itinéraires hors connexion ✓ (${p.graph.km} km de chemins)`) : '');
    if (dl && dl.packId === p.id) { const live = document.createElement('span'); live.className = 'dl-live'; live.dataset.pack = p.id; live.textContent = 'En cours…'; info.appendChild(live); }
    const acts = document.createElement('div'); acts.className = 'pack-acts';
    if (!p.complete) {
      const re = document.createElement('button'); re.className = 'btn small'; re.textContent = 'Reprendre';
      if (dl && dl.packId === p.id) re.hidden = true;
      re.onclick = () => downloadPack(p, p.tiles); acts.appendChild(re);
    }
    if (p.kind === 'zone' && (!p.graph || p.graph.partial) && !dl) {
      const gb = document.createElement('button'); gb.className = 'btn small'; gb.textContent = '+ Chemins';
      gb.onclick = async () => { gb.disabled = true; await downloadDepGraph(p, bboxPolys(p.bbox)); };
      acts.appendChild(gb);
    }
    if (p.kind === 'dep' && (!p.graph || p.graph.partial) && !dl) {
      const gb = document.createElement('button'); gb.className = 'btn small'; gb.textContent = '+ Chemins';
      gb.title = 'Télécharger les chemins du département pour les itinéraires hors connexion';
      gb.onclick = async () => {
        gb.disabled = true;
        await loadDeps(); const d = deps.find(x => x.code === p.code);
        if (d) await downloadDepGraph(p, d.polys);
      };
      acts.appendChild(gb);
    }
    if (p.kind === 'trace' && !p.graph && p.line && !dl) {
      const gb = document.createElement('button'); gb.className = 'btn small'; gb.textContent = '+ Chemins';
      gb.title = 'Télécharger le réseau de chemins pour les itinéraires hors connexion';
      gb.onclick = async () => {
        gb.disabled = true;
        const lp = makePath(p.line.map(([lon, lat]) => ({ lat, lon, ele: null })), p.name);
        await downloadGraph(p, corridorBoxes(lp)); renderPacks();
      };
      acts.appendChild(gb);
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
    const prov = p.prov || 'ign', others = new Set();
    (await listPacks()).filter(q => q.id !== p.id && (q.prov || 'ign') === prov).forEach(q => (q.tiles || []).forEach(t => others.add(t)));
    const cache = await caches.open(TILE_CACHE);
    for (const t of p.tiles || []) if (!others.has(t)) { const [z, x, y] = t.split('/'); await cache.delete(tileKey(prov, z, x, y)); }
    try { await idb('readwrite', st => st.delete(p.id), 'places'); placesCache = null; } catch {}
    await idb('readwrite', st => st.delete(p.id), 'packs');
    try { await idb('readwrite', st => st.delete(p.id), 'graphs'); graphs = null; } catch {}
    try { await idb('readwrite', st => st.delete(IDBKeyRange.bound(p.id + '#', p.id + '#\uffff')), 'graphChunks'); } catch {}
    toast(`${p.name} supprimée`);
  } catch { toast('Suppression impossible.'); }
  renderPacks(); updateStorageInfo(); drawPacks();
}
$('btnClearTiles').onclick = async () => {
  if (dl) { toast('Attends la fin du téléchargement.'); return; }
  try {
    await caches.delete(TILE_CACHE);
    for (const p of await listPacks()) await idb('readwrite', st => st.delete(p.id), 'packs');
    try { await idb('readwrite', st => st.clear(), 'graphs'); await idb('readwrite', st => st.clear(), 'graphChunks'); graphs = null; } catch {}
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
    if (p.kind === 'zone') feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: bboxPolys(p.bbox)[0] } });
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
// Itinéraires hors connexion : réseau des chemins (OpenStreetMap, via Overpass)
// téléchargé avec la carte, puis plus court chemin calculé sur le téléphone
// =====================================================================
const HW = ['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'living_street', 'service', 'pedestrian', 'track', 'path', 'footway', 'cycleway', 'bridleway', 'steps', 'road'];
// coût relatif de chaque type de voie (1 = idéal), à pied et à vélo
const COST = {
  foot: [6, 6, 2.2, 2.2, 1.6, 1.6, 1.3, 1.3, 1.05, 1.05, 1, 1.1, 1, 1, 1, 1, 1.2, 1.1, 1.3, 1.2],
  bike: [8, 8, 2.5, 2.5, 1.6, 1.6, 1.15, 1.15, 1, 1.05, 1.1, 1.15, 2.5, 1.4, 1.8, 3, 0.8, 2.2, 8, 1.3]
};
// drapeaux par voie : 1 interdit à pied, 2 interdit à vélo, 4 vélo autorisé, 8 accès privé,
// 16 sens unique, 32 sens unique inverse, 64 piétons autorisés
function wayFlags(t) {
  let f = 0;
  if (t.foot === 'no') f |= 1;
  if (t.bicycle === 'no') f |= 2;
  if (/^(yes|designated|permissive)$/.test(t.bicycle || '')) f |= 4;
  if (/^(private|no)$/.test(t.access || '')) f |= 8;
  if (t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout') f |= 16;
  if (t.oneway === '-1') f |= 32;
  if (t['oneway:bicycle'] === 'no' || t['cycleway'] === 'opposite' || /opposite/.test(t['cycleway:left'] || '')) f &= ~48;
  if (/^(yes|designated|permissive)$/.test(t.foot || '')) f |= 64;
  return f;
}

// le réseau peut arriver en plusieurs morceaux (département) : on accumule, puis on assemble
function newGraphAcc() { return { idx: new Map(), lat: [], lon: [], ways: new Set(), ea: [], eb: [], ec: [], ef: [] }; }
function addToGraph(acc, json) {
  for (const e of json.elements) if (e.type === 'node' && !acc.idx.has(e.id)) { acc.idx.set(e.id, acc.lat.length); acc.lat.push(e.lat); acc.lon.push(e.lon); }
  for (const e of json.elements) {
    if (e.type !== 'way' || !e.tags || acc.ways.has(e.id)) continue;
    const c = HW.indexOf(e.tags.highway); if (c < 0) continue;
    acc.ways.add(e.id);
    const f = wayFlags(e.tags);
    for (let i = 1; i < e.nodes.length; i++) {
      const a = acc.idx.get(e.nodes[i - 1]), b = acc.idx.get(e.nodes[i]);
      if (a == null || b == null || a === b) continue;
      acc.ea.push(a); acc.eb.push(b); acc.ec.push(c); acc.ef.push(f);
    }
  }
}
function finishGraph(acc) {
  const { lat, lon, ea, eb, ec, ef } = acc;
  const n = lat.length, m = ea.length, start = new Uint32Array(n + 1);
  for (let k = 0; k < m; k++) { start[ea[k] + 1]++; start[eb[k] + 1]++; }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const fill = start.slice(0, n), to = new Uint32Array(2 * m), len = new Float32Array(2 * m),
    hw = new Uint8Array(2 * m), fl = new Uint8Array(2 * m), fwd = new Uint8Array(2 * m);
  for (let k = 0; k < m; k++) {
    const a = ea[k], b = eb[k], d = hav({ lat: lat[a], lon: lon[a] }, { lat: lat[b], lon: lon[b] });
    let p = fill[a]++; to[p] = b; len[p] = d; hw[p] = ec[k]; fl[p] = ef[k]; fwd[p] = 1;
    p = fill[b]++; to[p] = a; len[p] = d; hw[p] = ec[k]; fl[p] = ef[k]; fwd[p] = 0;
  }
  let w = 180, s = 90, e = -180, nn = -90;
  for (let i = 0; i < n; i++) { w = Math.min(w, lon[i]); e = Math.max(e, lon[i]); s = Math.min(s, lat[i]); nn = Math.max(nn, lat[i]); }
  // coordonnées en simple précision (≈ 0,5 m) : deux fois moins de place
  return { n, lat: Float32Array.from(lat), lon: Float32Array.from(lon), start, to, len, hw, fl, fwd, bbox: [w, s, e, nn] };
}
function buildGraph(json) { const acc = newGraphAcc(); addToGraph(acc, json); return finishGraph(acc); }

// coût d'un tronçon selon le mode (Infinity = interdit)
function edgeCost(g, p, bike) {
  const f = g.fl[p];
  if (f & 8 && !(bike ? f & 4 : f & 64)) return Infinity;
  let c = (bike ? COST.bike : COST.foot)[g.hw[p]];
  if (bike) {
    if (f & 2) return Infinity;
    if (f & 4) c = Math.min(c, 1);
    if ((f & 16 && !g.fwd[p]) || (f & 32 && g.fwd[p])) c *= 4; // à contresens : on pousse le vélo
  } else if (f & 1) return Infinity;
  return g.len[p] * c;
}

// index spatial des nœuds (cases d'environ 50 m)
const CELL = 0.0005;
function gridOf(g) {
  if (g.grid) return g.grid;
  const grid = new Map();
  for (let i = 0; i < g.n; i++) {
    const k = Math.floor(g.lat[i] / CELL) + ':' + Math.floor(g.lon[i] / (CELL * 1.4));
    let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i);
  }
  return g.grid = grid;
}
function nodesNear(g, p, radius) {
  const grid = gridOf(g), r = Math.ceil(radius / 50) + 1, cy = Math.floor(p.lat / CELL), cx = Math.floor(p.lon / (CELL * 1.4)), out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const a = grid.get((cy + dy) + ':' + (cx + dx)); if (!a) continue;
    for (const i of a) { const d = hav(p, { lat: g.lat[i], lon: g.lon[i] }); if (d <= radius) out.push([i, d]); }
  }
  return out.sort((x, y) => x[1] - y[1]);
}
const nodePt = (g, i) => ({ lat: g.lat[i], lon: g.lon[i], ele: null });

// plus court chemin (Dijkstra / A*) vers le premier nœud cible atteint
function shortestPath(g, from, isTarget, bike, goal) {
  const n = g.n, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const hk = [], hv = []; // tas binaire (priorité, nœud)
  const push = (k, v) => { hk.push(k); hv.push(v); let i = hk.length - 1; while (i > 0) { const pi = (i - 1) >> 1; if (hk[pi] <= hk[i]) break; [hk[pi], hk[i]] = [hk[i], hk[pi]]; [hv[pi], hv[i]] = [hv[i], hv[pi]]; i = pi; } };
  const pop = () => {
    const v = hv[0], lk = hk.pop(), lv = hv.pop();
    if (hk.length) { hk[0] = lk; hv[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < hk.length && hk[l] < hk[s]) s = l; if (r < hk.length && hk[r] < hk[s]) s = r; if (s === i) break; [hk[s], hk[i]] = [hk[i], hk[s]]; [hv[s], hv[i]] = [hv[i], hv[s]]; i = s; } }
    return v;
  };
  const h = goal ? i => hav(goal, { lat: g.lat[i], lon: g.lon[i] }) * 0.8 : () => 0;
  dist[from] = 0; push(h(from), from);
  let steps = 0;
  while (hk.length) {
    const u = pop();
    if (done[u]) continue; done[u] = 1;
    if (isTarget(u)) {
      const path = []; for (let v = u; v !== -1; v = prev[v]) path.push(v);
      return { nodes: path.reverse(), cost: dist[u] };
    }
    if (++steps > 400000) break;
    for (let p = g.start[u]; p < g.start[u + 1]; p++) {
      const v = g.to[p]; if (done[v]) continue;
      const c = edgeCost(g, p, bike); if (c === Infinity) continue;
      const nd = dist[u] + c;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd + h(v), v); }
    }
  }
  return null;
}
const pathLength = pts => { let d = 0; for (let i = 1; i < pts.length; i++) d += hav(pts[i - 1], pts[i]); return d; };

// ---------- graphes en mémoire ----------
let graphs = null;
async function loadGraphs() {
  if (graphs) return graphs;
  try { graphs = (await idb('readonly', st => st.getAll(), 'graphs')) || []; } catch { graphs = []; }
  return graphs;
}
function graphFor(points) {
  if (!graphs) return null;
  const inside = (b, p) => p.lon >= b[0] - 0.01 && p.lon <= b[2] + 0.01 && p.lat >= b[1] - 0.01 && p.lat <= b[3] + 0.01;
  return graphs.find(g => points.every(p => inside(g.bbox, p) && nodesNear(g, p, 400).length)) || null;
}
// pourquoi le calcul hors connexion n'est pas possible ici (affiché dans le bandeau)
function whyNoLocal(pos) {
  if (!graphs || !graphs.length) return 'aucun chemin téléchargé (Réglages › Mes cartes)';
  if (!graphs.some(g => pos.lon >= g.bbox[0] - 0.01 && pos.lon <= g.bbox[2] + 0.01 && pos.lat >= g.bbox[1] - 0.01 && pos.lat <= g.bbox[3] + 0.01))
    return 'tu es hors de la zone des chemins téléchargés';
  return 'trop loin des chemins téléchargés';
}

// retour à la trace hors connexion : vers le point de la trace le plus proche PAR LES CHEMINS
function localRejoin(tr, pos) {
  const g = graphFor([pos]); if (!g) return null;
  const startN = nodesNear(g, pos, 400)[0]; if (!startN) return null;
  // nœuds du réseau situés sur la trace (à moins de 25 m)
  const key = tr.id + ':' + g.id;
  if (!g.targets || g.targetsKey !== key) {
    const mask = new Uint8Array(g.n);
    for (let d = 0; d <= tr.total; d += 10) for (const [i] of nodesNear(g, pointAt(tr, d), 25)) mask[i] = 1;
    g.targets = mask; g.targetsKey = key;
  }
  const r = shortestPath(g, startN[0], i => g.targets[i] === 1, profile === 'trekking');
  if (!r) return null;
  const last = nodePt(g, r.nodes[r.nodes.length - 1]), pr = project(tr, last, true), tp = pointAt(tr, pr.along);
  const pts = [{ lat: pos.lat, lon: pos.lon, ele: null }, ...r.nodes.map(i => nodePt(g, i)), { lat: tp.lat, lon: tp.lon, ele: null }];
  return { pts, len: pathLength(pts), target: { lat: tp.lat, lon: tp.lon, along: pr.along, dist: hav(pos, tp) } };
}
// itinéraire vers un lieu hors connexion (dans une zone dont les chemins sont téléchargés)
function localRouteTo(pos, dest) {
  const g = graphFor([pos, dest]); if (!g) return null;
  const a = nodesNear(g, pos, 300)[0], b = nodesNear(g, dest, 300)[0];
  if (!a || !b) return null;
  const r = shortestPath(g, a[0], i => i === b[0], profile === 'trekking', dest);
  if (!r) return null;
  const pts = [{ lat: pos.lat, lon: pos.lon, ele: null }, ...r.nodes.map(i => nodePt(g, i))];
  return { pts, len: pathLength(pts) };
}

// ---------- téléchargement du réseau de chemins ----------
function corridorBoxes(p) {
  const boxes = []; let cur = null, from = 0;
  const flush = () => { if (cur) { const m = 0.0135, ml = m / Math.cos(rad((cur[1] + cur[3]) / 2)); boxes.push([cur[1] - m, cur[0] - ml, cur[3] + m, cur[2] + ml]); } };
  p.pts.forEach((q, i) => {
    if (!cur) cur = [q.lon, q.lat, q.lon, q.lat];
    cur[0] = Math.min(cur[0], q.lon); cur[1] = Math.min(cur[1], q.lat); cur[2] = Math.max(cur[2], q.lon); cur[3] = Math.max(cur[3], q.lat);
    if (p.cum[i] - from > 3000) { flush(); cur = [q.lon, q.lat, q.lon, q.lat]; from = p.cum[i]; }
  });
  flush();
  return boxes; // [sud, ouest, nord, est]
}
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const HW_RE = '^(' + HW.join('|') + ')$';
// département : sans les trottoirs, allées privées et parkings, inutiles pour un itinéraire
const HW_DEP_RE = '^(' + HW.filter(h => h !== 'service' && h !== 'footway').join('|') + ')$';
function overpassQuery(box, light) {
  const b = box.map(v => v.toFixed(5)).join(',');
  const parts = light
    ? `way["highway"~"${HW_DEP_RE}"](${b});way["highway"="service"]["service"!~"driveway|parking_aisle|drive-through|emergency_access"](${b});way["highway"="footway"]["footway"!~"sidewalk|crossing"](${b});`
    : `way["highway"~"${HW_RE}"](${b});`;
  return `[out:json][timeout:180];(${parts});out body qt;>;out skel qt;`;
}
// Overpass limite chaque appareil à quelques demandes à la fois : on lui demande quand revenir
async function overpassWait(onWait) {
  for (let i = 0; i < 10; i++) {
    let secs = 0;
    try {
      const txt = await (await fetch('https://overpass-api.de/api/status', { cache: 'no-store' })).text();
      if (/\d+ slots? available now/.test(txt)) return;
      const ws = [...txt.matchAll(/in (\d+) seconds/g)].map(m => +m[1]);
      secs = ws.length ? Math.min(...ws) + 1 : 15;
    } catch { return; } // statut illisible : on tente quand même
    if (onWait) onWait(secs);
    await new Promise(r => setTimeout(r, Math.min(secs, 120) * 1000));
  }
}
async function overpass(q, tries = 2, onWait) {
  let last;
  for (let t = 0; t < tries; t++) {
    await overpassWait(onWait);
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 190000);
    try {
      const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
      if (r.ok) return await r.json();
      last = new Error(r.status === 429 || r.status === 504 ? 'serveur OpenStreetMap saturé, réessaie dans quelques minutes' : 'erreur ' + r.status);
    } catch (e) { last = e.name === 'AbortError' ? new Error('délai dépassé') : new Error('pas de connexion'); }
    finally { clearTimeout(timer); }
    // serveur saturé : on patiente de plus en plus longtemps avant de réessayer
    const pause = 15 * (t + 1);
    if (onWait) onWait(pause);
    await new Promise(r => setTimeout(r, pause * 1000));
  }
  throw last;
}
async function saveGraph(pack, g, partial) {
  g.id = pack.id;
  await idb('readwrite', st => st.put(g), 'graphs');
  graphs = null;
  let total = 0; for (let i = 0; i < g.len.length; i++) total += g.len[i];
  pack.graph = { nodes: g.n, km: Math.round(total / 2000), partial: !!partial };
  await idb('readwrite', st => st.put(pack), 'packs');
}
// le long d'une trace : une seule demande
async function downloadGraph(pack, boxes) {
  $('offTxt').textContent = 'Réseau de chemins : téléchargement…'; $('offProg').hidden = false;
  try {
    const acc = newGraphAcc();
    // les grandes traces sont découpées en lots de 8 cadres
    for (let i = 0; i < boxes.length; i += 8) {
      const q = `[out:json][timeout:180];(${boxes.slice(i, i + 8).map(b => `way["highway"~"${HW_RE}"](${b.map(v => v.toFixed(5)).join(',')});`).join('')});out body qt;>;out skel qt;`;
      addToGraph(acc, await overpass(q));
    }
    if (!acc.lat.length) throw new Error('aucun chemin trouvé');
    $('offTxt').textContent = 'Réseau de chemins : préparation…';
    await saveGraph(pack, finishGraph(acc));
    $('offTxt').textContent = `Réseau de chemins : ${pack.graph.km} km de chemins enregistrés ✓`;
    return true;
  } catch (e) {
    $('offTxt').textContent = 'Réseau de chemins non téléchargé : ' + e.message;
    return false;
  }
}
// département : découpé en carrés d'environ 15 km, téléchargés un par un
function depChunks(polys, step = 0.15) {
  const [w, s, e, n] = polysBBox(polys), out = [];
  for (let la = s; la < n; la += step) for (let lo = w; lo < e; lo += step * 1.4) {
    const box = [la, lo, Math.min(la + step, n), Math.min(lo + step * 1.4, e)];
    const pts = [];
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) pts.push([box[1] + (box[3] - box[1]) * j / 4, box[0] + (box[2] - box[0]) * i / 4]);
    const vertexInside = polys.some(p => p[0].some(([x, y]) => x >= box[1] && x <= box[3] && y >= box[0] && y <= box[2]));
    if (vertexInside || pts.some(([x, y]) => inPolys(x, y, polys))) out.push(box);
  }
  return out;
}
function polysAreaKm2(polys) {
  let a = 0;
  for (const p of polys) {
    const r = p[0], k = Math.cos(rad(r[0][1])) * 111.32;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * k) * (r[i][1] * 110.54) - (r[i][0] * k) * (r[j][1] * 110.54);
  }
  return Math.abs(a / 2);
}
const depGraphMo = polys => Math.round(polysAreaKm2(polys) * 8 / 1024); // ≈ 8 Ko par km²
// un morceau réussi est gardé en mémoire du téléphone sous forme compacte
function packChunk(json) {
  const nodes = json.elements.filter(e => e.type === 'node'), ways = json.elements.filter(e => e.type === 'way' && e.tags && HW.includes(e.tags.highway));
  const wn = []; ways.forEach(w => wn.push(...w.nodes));
  return {
    nid: Float64Array.from(nodes, n => n.id), nlat: Float32Array.from(nodes, n => n.lat), nlon: Float32Array.from(nodes, n => n.lon),
    wid: Float64Array.from(ways, w => w.id), whw: Uint8Array.from(ways, w => HW.indexOf(w.tags.highway)), wfl: Uint8Array.from(ways, w => wayFlags(w.tags)),
    wcount: Uint32Array.from(ways, w => w.nodes.length), wnodes: Float64Array.from(wn)
  };
}
function addChunkToGraph(acc, c) {
  for (let i = 0; i < c.nid.length; i++) if (!acc.idx.has(c.nid[i])) { acc.idx.set(c.nid[i], acc.lat.length); acc.lat.push(c.nlat[i]); acc.lon.push(c.nlon[i]); }
  let off = 0;
  for (let w = 0; w < c.wid.length; w++) {
    const cnt = c.wcount[w];
    if (!acc.ways.has(c.wid[w])) {
      acc.ways.add(c.wid[w]);
      for (let i = 1; i < cnt; i++) {
        const a = acc.idx.get(c.wnodes[off + i - 1]), b = acc.idx.get(c.wnodes[off + i]);
        if (a == null || b == null || a === b) continue;
        acc.ea.push(a); acc.eb.push(b); acc.ec.push(c.whw[w]); acc.ef.push(c.wfl[w]);
      }
    }
    off += cnt;
  }
}
async function downloadDepGraph(pack, polys) {
  if (dl) { toast('Un téléchargement est déjà en cours.'); return false; }
  const chunks = depChunks(polys);
  dl = { stop: false, packId: pack.id }; keepAwake();
  $('offProg').hidden = false; $('dlStop').hidden = false; $('dlTrace').disabled = $('dlDep').disabled = true;
  const key = k => pack.id + '#' + k;
  // morceaux déjà récupérés lors d'un essai précédent
  const have = new Set();
  for (let k = 0; k < chunks.length; k++) { try { if (await idb('readonly', st => st.getKey(key(k)), 'graphChunks')) have.add(k); } catch {} }
  let fail = 0, lastErr = '', done = have.size;
  const status = extra => {
    const txt = `Chemins : ${done} / ${chunks.length} morceaux` + (fail ? ` · ${fail} en échec` : '') + (extra ? ` · ${extra}` : '');
    $('offTxt').textContent = txt; $('offBar').style.width = (done / chunks.length * 100) + '%';
    $('mapsStatus').textContent = `${pack.name} · ${txt}`; $('mapsStatus').hidden = false;
  };
  status();
  for (let k = 0; k < chunks.length && !dl.stop; k++) {
    if (have.has(k)) continue;
    status('téléchargement…');
    try {
      const json = await overpass(overpassQuery(chunks[k], true), 3, secs => status(`le serveur OpenStreetMap demande d'attendre ${secs} s`));
      await idb('readwrite', st => st.put(Object.assign(packChunk(json), { id: key(k) })), 'graphChunks');
      have.add(k); done++;
    } catch (e) { fail++; lastErr = e.message; }
    status();
  }
  const stopped = dl.stop; dl = null;
  $('dlStop').hidden = true; $('dlTrace').disabled = !track; $('dlDep').disabled = false; $('mapsStatus').hidden = true;
  if (!have.size) { $('offTxt').textContent = 'Chemins non téléchargés : ' + (lastErr || 'arrêté'); renderPacks(); return false; }
  // assemblage du réseau à partir de tous les morceaux disponibles
  $('offTxt').textContent = 'Chemins : assemblage sur le téléphone…'; $('offBar').style.width = '100%';
  await new Promise(r => setTimeout(r, 50));
  const acc = newGraphAcc();
  for (const k of have) { const c = await idb('readonly', st => st.get(key(k)), 'graphChunks'); if (c) addChunkToGraph(acc, c); }
  const complete = have.size === chunks.length;
  await saveGraph(pack, finishGraph(acc), !complete);
  // complet : les morceaux ne servent plus
  if (complete) for (let k = 0; k < chunks.length; k++) { try { await idb('readwrite', st => st.delete(key(k)), 'graphChunks'); } catch {} }
  $('offTxt').textContent = complete
    ? `Chemins : ${pack.graph.km} km enregistrés ✓ · itinéraires hors connexion dans tout le département`
    : `Chemins : ${have.size} / ${chunks.length} morceaux (${pack.graph.km} km). ${stopped ? 'Arrêté.' : lastErr + '.'} Touche « + Chemins » plus tard : seuls les morceaux manquants seront téléchargés.`;
  renderPacks(); updateStorageInfo();
  return true;
}



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
  $('sheet').scrollTop = 0;
  document.body.classList.toggle('sheet-open', !m.hidden);
  $('btnMore').textContent = m.hidden ? 'Réglages' : 'Réduire';
}
$('btnMore').onclick = () => toggleMore(); $('grip').onclick = () => toggleMore();

// Glisser un panneau du bas : vers le haut il s'ouvre, vers le bas il se réduit.
// Le geste part de n'importe où, boutons compris : un toucher reste un clic,
// un mouvement vertical devient un glissement (et le clic est alors annulé).
function attachSwipe(panel, isOpen, setOpen) {
  let x0 = null, y0 = 0, dx = 0, dy = 0, startScroll = 0, decided = false, swiping = false;
  const scrollable = () => panel.scrollHeight > panel.clientHeight + 2;
  panel.addEventListener('touchstart', e => {
    if (e.touches.length > 1 || e.target.closest('select, textarea, input[type=search], input[type=text]')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = dy = 0;
    startScroll = panel.scrollTop; decided = swiping = false;
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (x0 == null) return;
    dx = e.touches[0].clientX - x0; dy = e.touches[0].clientY - y0;
    if (!decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      decided = true;
      swiping = Math.abs(dy) > Math.abs(dx) * 1.2;
      // contenu qui défile : on le laisse défiler, sauf tirer vers le bas depuis tout en haut
      if (swiping && isOpen() && scrollable() && dy < 0) swiping = false;
    }
    if (!swiping) return;
    if (e.cancelable) e.preventDefault();
    panel.style.transition = 'none';
    panel.style.transform = `translateY(${dy > 0 ? dy * 0.6 : dy * 0.25}px)`;
  }, { passive: false });
  const end = () => {
    if (x0 == null) return;
    x0 = null;
    if (!swiping) return;
    panel.style.transition = 'transform .2s ease-out'; panel.style.transform = '';
    if (!isOpen() && dy < -30) setOpen(true);
    else if (isOpen() && dy > 40) setOpen(false);
    // le doigt s'est levé sur un bouton : ce n'était pas un clic
    const block = ev => { ev.stopPropagation(); ev.preventDefault(); };
    panel.addEventListener('click', block, true);
    setTimeout(() => panel.removeEventListener('click', block, true), 400);
    swiping = false;
  };
  panel.addEventListener('touchend', end); panel.addEventListener('touchcancel', end);
}
attachSwipe($('sheet'), () => !$('more').hidden, open => toggleMore(open));

// les boutons ronds se placent juste au-dessus du panneau du bas, quelle que soit sa hauteur
try {
  new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', $('sheet').offsetHeight + 'px')).observe($('sheet'));
} catch { /* navigateur ancien : position par défaut */ }

const saved = store.get('gpx');
if (saved) { try { showTrack(parseGPX(saved)); } catch { drawProfile(); } } else drawProfile();
checkShared();
const VERSION = APP_VERSION + ' · 8 oct. 2026';
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
window.__balise = { onPos, get state() { return { nav, isOff, rejoin: !!rejoin, straight: rejoin && rejoin.straight, progress, act: Object.assign({ elapsed: actElapsed(), state: actState, points: rec.length }, act) }; } };
})();
