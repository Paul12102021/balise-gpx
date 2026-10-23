/* Pisteo — navigation guidée sur une trace GPX
   © 2026 Pisteo. Tous droits réservés — toute copie ou réutilisation est interdite sans autorisation (voir LICENSE). */
(() => {
'use strict';

// La page et le code doivent être de la même version. Sinon (page gardée en cache
// par le téléphone ou par GitHub), on recharge une page fraîche, au plus 3 fois.
const APP_VERSION = 188;
try {
  const meta = document.querySelector('meta[name="balise-version"]');
  const pageV = meta ? +meta.content : 0;
  if (pageV !== APP_VERSION) {
    const n = +(sessionStorage.getItem('fixVersion') || 0);
    if (n < 3) {
      sessionStorage.setItem('fixVersion', String(n + 1));
      const keep = (/[?&]shared=1/.test(location.search) ? '&shared=1' : '') + (/[?&]migrate=1/.test(location.search) ? '&migrate=1' : '');
      location.replace(location.pathname + '?fresh=' + Date.now() + keep + location.hash); // le « # » d'un lien de parcours est gardé
      throw new Error('version');
    }
  } else sessionStorage.removeItem('fixVersion');
  if (/[?&]fresh=/.test(location.search)) history.replaceState(null, '', location.pathname + (/[?&]shared=1/.test(location.search) ? '?shared=1' : /[?&]migrate=1/.test(location.search) ? '?migrate=1' : ''));
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
// unités : métriques, ou miles / pieds (réglage, ou automatique pour les téléphones réglés en anglais américain)
const IMP = (() => { let u = null; try { u = localStorage.getItem('units'); } catch {}
  return u ? u === 'imperial' : /^en-(US|LR)|^my\b/i.test(navigator.language || ''); })();
const FT = 3.28084, MI = 1609.344;
const fmtDist = m => m == null || isNaN(m) ? '–' : IMP ? fmtDistImp(m) : (m >= 99950 ? Math.round(m / 1000) + ' km' : m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 1 : 2).replace('.', ',') + ' km' : (m >= 100 ? Math.round(m / 10) * 10 : Math.round(m)) + ' m');
function fmtDistImp(m) {
  const mi = m / MI;
  if (mi < 0.1) { const f = m * FT; return (f >= 100 ? Math.round(f / 10) * 10 : Math.round(f)) + ' ft'; }
  return (mi >= 99.95 ? Math.round(mi) : mi.toFixed(mi >= 10 ? 1 : 2).replace('.', ',')) + ' mi';
}
const fmtM = m => m == null || isNaN(m) ? '–' : IMP ? Math.round(m * FT) + ' ft' : Math.round(m) + ' m';
// graduations d'altitude (en mètres) avec leur étiquette dans l'unité choisie
function eleTicks(lo, hi, steps) {
  const k = IMP ? FT : 1, st = (IMP ? steps.map(x => x * 5) : steps).find(s => (hi - lo) * k / s <= 4) || 5000, out = [];
  for (let v = Math.ceil(lo * k / st) * st; v <= hi * k; v += st) out.push([v / k, v + '']);
  return out;
}
const fmtDur = s => { const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
const fmtClock = s => new Date(Date.now() + s * 1000).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
function speakDist(d) {
  if (IMP) {
    const f = d * FT;
    if (f < 300) return Math.max(30, Math.round(f / 10) * 10) + ' pieds';
    if (d < 0.2 * MI) return Math.round(f / 50) * 50 + ' pieds';
    if (d < 0.375 * MI) return 'un quart de mile';
    const half = d < 10 * MI ? Math.round(d / MI * 2) / 2 : Math.round(d / MI), n = Math.floor(half);
    if (!n) return 'un demi-mile';
    return n + (n > 1 ? ' miles' : ' mile') + (half % 1 ? ' et demi' : '');
  }
  if (d < 100) return Math.max(10, Math.round(d / 10) * 10) + ' mètres';
  if (d < 950) return Math.round(d / 50) * 50 + ' mètres';
  // au-delà : demi-kilomètres, dits comme on les dit (« 1 kilomètre et demi »)
  const half = d < 10000 ? Math.round(d / 500) / 2 : Math.round(d / 1000), n = Math.floor(half);
  const km = n + (n > 1 ? ' kilomètres' : ' kilomètre');
  return half % 1 ? (n ? km + ' et demi' : '500 mètres') : km;
}
// consigne affichée (« Tournez à gauche ») → consigne parlée, tutoyée comme le reste de l'appli
function spokenTurn(txt) {
  return txt.replace(/^Faites demi-tour/, 'fais demi-tour').replace(/^Tournez/, 'tourne')
    .replace(/^Légèrement/, 'prends légèrement').replace(/^Rejoignez la trace/, 'rejoins la trace');
}
const pick = a => a[Math.floor(Math.random() * a.length)];
// Appli Android (WebView) : le téléphone fournit la voix, l'écran allumé, les fichiers et le partage
const AND = window.PisteoAndroid || null;
if (AND) document.documentElement.classList.add('and');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage plein ou bloqué */ } }
};
// =====================================================================
// Langues : l'appli est écrite en français ; les autres langues traduisent les textes affichés et parlés
// (dictionnaires dans i18n/<langue>.js : textes exacts, gabarits avec variables, morceaux de phrases)
// =====================================================================
const LANGS = { fr: 'Français', en: 'English', es: 'Español' };
const LANG = (() => {
  const want = store.get('lang');
  if (want && LANGS[want]) return want;
  const nav = (navigator.languages || [navigator.language || 'fr']).map(l => l.slice(0, 2).toLowerCase());
  return nav.find(l => LANGS[l]) || (nav[0] === 'fr' ? 'fr' : 'en');
})();
const NAVL = navigator.language || '';
const LOC = LANG === 'fr' ? 'fr-FR' : NAVL.slice(0, 2).toLowerCase() === LANG && NAVL.length > 2 ? NAVL : { en: 'en-GB', es: 'es-ES' }[LANG] || 'fr-FR';
const US = /^en-US/i.test(LOC); // orthographe américaine (meter, color…)
const DICT = LANG !== 'fr' && window.I18N && window.I18N[LANG] || null;
const trCache = new Map(), trMiss = new Set();
function tr(s) {
  if (!DICT || s == null) return s;
  s = String(s);
  const core = s.trim(); if (!core || !/\p{L}/u.test(core)) return s;
  if (trCache.has(s)) return trCache.get(s);
  const lead = s.slice(0, s.indexOf(core)), tail = s.slice(s.indexOf(core) + core.length);
  let out = trCore(core);
  if (out == null) {
    // morceaux connus remplacés dans la phrase, sinon texte laissé tel quel (et noté pour le compléter)
    out = core; let hit = false;
    for (const [fr, en] of DICT.bits) if (out.includes(fr)) { out = out.split(fr).join(en); hit = true; }
    if (/[àâçéèêëîïôûùüœ]|\b(le|la|les|des|du|une?|et|pour|sur|avec|sans|dans|ton|ta|tes)\b/i.test(out)) trMiss.add(core);
    else if (!hit && /[a-z]{3}/i.test(core)) trMiss.add(core);
  }
  if (DICT.decimal !== ',') out = out.replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2');
  if (US) out = out.replace(/metre/g, 'meter').replace(/Metre/g, 'Meter').replace(/colour/g, 'color').replace(/centre/g, 'center').replace(/Licence/g, 'License').replace(/licence/g, 'license');
  out = lead + out + tail;
  if (trCache.size > 3000) trCache.clear();
  trCache.set(s, out); return out;
}
function trCore(core) {
  const ex = DICT.exact[core];
  if (ex != null) return ex;
  for (const [re, rep] of DICT.patterns) {
    const m = core.match(re);
    if (m) return typeof rep === 'function' ? rep(m, tr) : rep.replace(/\$(\d)/g, (_, i) => tr(m[+i] || ''));
  }
  return null;
}
// tout texte qui apparaît à l'écran (ou change) est traduit au vol
function trNode(n) {
  if (n.nodeType === 3) {
    if (n.__tr === n.data) return;
    const p = n.parentNode; if (p && /^(SCRIPT|STYLE|TEXTAREA)$/.test(p.nodeName)) return;
    const t = tr(n.data); n.__tr = t; if (t !== n.data) n.data = t;
  } else if (n.nodeType === 1) {
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
      const v = n.getAttribute && n.getAttribute(a);
      if (v && n['__tr_' + a] !== v) { const t = tr(v); n['__tr_' + a] = t; if (t !== v) n.setAttribute(a, t); }
    }
    if (n.nodeName === 'OPTION' || n.childNodes.length) n.childNodes.forEach(trNode);
  }
}
if (DICT) {
  document.documentElement.lang = LANG;
  trNode(document.body);
  new MutationObserver(ms => { for (const m of ms) {
    if (m.type === 'characterData') trNode(m.target);
    else if (m.type === 'attributes') trNode(m.target);
    else m.addedNodes.forEach(trNode);
  } }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label', 'alt'] });
  window.__trMiss = trMiss; // pour compléter les dictionnaires
}
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

// ---------- Progression sur la trace ----------
// Elle n'avance que lorsqu'on est vraiment sur la trace : loin d'elle, le point le plus proche
// ne dit rien de ce qui a été parcouru. Elle est gardée en mémoire pour la trace ouverte.
let done = null; // { along, pos, miss }
// joinNear : trace pas encore commencée, on rejoint son point le plus proche plutôt que son départ
let joinNear = false;
const doneKey = () => track ? track.name + '|' + Math.round(track.total) : '';
function loadDone() {
  done = null;
  try { const s = JSON.parse(store.get('done') || 'null'); if (s && s.k === doneKey()) done = { along: s.a, pos: null, miss: 0 }; } catch {}
}
function saveDone() { store.set('done', done ? JSON.stringify({ k: doneKey(), a: Math.round(done.along) }) : ''); }
function resetDone() { done = null; saveDone(); }
function onTrackTol(pos) { return clamp(threshold || 50, 40, 100) + Math.min(pos && pos.acc || 0, 40); }
function updateDone(pos) {
  if (!track || !progress) return;
  const tol = onTrackTol(pos);
  if (progress.dist > tol || !rightPart()) return; // croiser la trace en allant au point visé ne compte pas
  if (!done) {
    // premier passage sur la trace : sur une boucle (départ = arrivée), on part du début
    const P = track.pts;
    for (let i = 0; i < P.length; i++) if (hav(P[i], pos) <= tol) {
      if (track.cum[i] < progress.along - 300) {
        track.lastIdx = i + 50;
        const q = project(track, pos);
        if (q && q.dist <= tol) progress = q;
      }
      break;
    }
    done = { along: progress.along, pos, miss: 0 }; saveDone(); return;
  }
  // un saut le long de la trace sans rapport avec le chemin réellement fait (trace qui repasse
  // au même endroit…) n'est accepté que s'il se confirme sur plusieurs positions
  const jump = Math.abs(progress.along - done.along), allowed = (done.pos ? hav(done.pos, pos) * 3 : 0) + 300;
  if (jump > allowed && ++done.miss < 5) return;
  const save = Math.abs(progress.along - done.along) >= 25;
  done.miss = 0; done.along = progress.along; done.pos = pos;
  if (save) saveDone();
}
function doneInfo() { return track ? Object.assign(infoAt(done ? done.along : 0), { started: !!done }) : null; }
function infoAt(along) {
  const a = clamp(along, 0, track.total), n = track.cum.length;
  const i = Math.min(pointAt(track, a).i, n - 2), C = track.cum, U = track.up;
  const seg = C[i + 1] - C[i], f = seg > 0 ? clamp((a - C[i]) / seg, 0, 1) : 0;
  const upDone = U[i] + f * (U[i + 1] - U[i]), downDone = track.down[i] + f * (track.down[i + 1] - track.down[i]);
  return { along: a, idx: f > 0.5 ? i + 1 : i, remain: track.total - a, upLeft: track.totalUp - upDone, downLeft: track.totalDown - downDone };
}

// =====================================================================
// Carte (MapLibre : rotation et inclinaison pour le mode navigation)
// =====================================================================
// Plan IGN : données ouvertes, seul fond que l'on télécharge pour le hors ligne
const IGN_URL = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM_0_19&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png';
// IGN et Monde : libres de diffusion, utilisables hors ligne.
// Topo et CyclOSM : serveurs de bénévoles, affichage en ligne seulement, sans garantie de service.
// Cartes officielles libres et téléchargeables, chacune dans son pays : le premier fond prend celle du pays affiché
const NAT = {
  ign: { name: 'IGN', url: IGN_URL, max: 19, kb: 20, attr: '© <a href="https://www.ign.fr">IGN</a> · Plan IGN' },
  es: { name: 'IGN España', max: 17, kb: 18, attr: 'MTN CC BY 4.0 <a href="https://www.ign.es">ign.es</a>',
    url: 'https://www.ign.es/wmts/mapa-raster?layer=MTN&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}' },
  at: { name: 'basemap.at', max: 19, kb: 60, attr: 'Grundkarte <a href="https://basemap.at">basemap.at</a> (CC BY 4.0)',
    url: 'https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png' },
  be: { name: 'IGN Belgique', max: 17, kb: 17, attr: '© <a href="https://www.ngi.be">IGN-NGI</a> · CartoWeb',
    url: 'https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png' },
  // Toporama : carte topo officielle canadienne, servie image par image (WMS), libellés en français ou en anglais
  // serveur lent : un niveau de détail de moins au téléchargement
  ca: { name: 'Toporama', max: 16, kb: 10, zoff: -1, par: 6, attr: '© <a href="https://natural-resources.canada.ca">Ressources naturelles Canada</a> · Toporama',
    url: `https://maps.geogratis.gc.ca/wms/toporama_${LANG === 'fr' ? 'fr' : 'en'}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${LANG === 'fr' ? 'SCW' : 'WMS'}-Toporama&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg` },
  us: { name: 'USGS Topo', max: 16, kb: 22, attr: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}' },
  // swisstopo : carte nationale suisse (données ouvertes, usage libre avec la mention « © swisstopo »)
  ch: { name: 'swisstopo', max: 18, kb: 35, par: 4, attr: '© <a href="https://www.swisstopo.admin.ch">swisstopo</a>',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg' },
  // Ordnance Survey (Grande-Bretagne) : carte Outdoor, gratuite jusqu'au niveau 16 (OS OpenData), téléchargement permis ;
  // limite de 600 tuiles par minute pour toute l'appli → téléchargements cadencés (rate)
  gb: { name: 'Ordnance Survey', max: 16, kb: 25, par: 2, rate: 450, attr: 'Contains OS data © Crown copyright and database rights 2026',
    url: 'https://api.os.uk/maps/raster/v1/zxy/Outdoor_3857/{z}/{x}/{y}.png?key=nrlrimaly1yk6su7XFpdMCAtA5r6DQPs' },
  // TopPlusOpen (BKG) : carte topo officielle allemande, libre (dl-de/by-2-0), détaillée jusqu'au niveau 18 en Allemagne
  de: { name: 'TopPlusOpen', max: 18, kb: 30, par: 4, attr: '© <a href="https://www.bkg.bund.de">BKG</a> (2026) <a href="https://www.govdata.de/dl-de/by-2-0">dl-de/by-2-0</a> · <a href="https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_topplusopen.html">Datenquellen</a>',
    url: 'https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png' },
};
let natCur = NAT[store.get('natCur')] ? store.get('natCur') : 'ign', natShapes = null; // dernier pays affiché : bon fond dès l'ouverture
const natAt = (lon, lat) => { if (!natShapes) return null; for (const k in natShapes) if (inPolys(lon, lat, natShapes[k])) return k; return null; };
const mercBBox = (z, x, y) => { const o = Math.PI * 6378137, s = 2 * o / 2 ** z; return [-o + x * s, o - (y + 1) * s, -o + (x + 1) * s, o - y * s].join(','); };
const natTileUrl = prov => (z, x, y) => NAT[prov].url.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{bbox-epsg-3857}', mercBBox(+z, +x, +y));
const LAYERS = [
  { id: 'ign', get name() { return NAT[natCur].name; }, get tiles() { return [NAT[natCur].url]; }, get max() { return NAT[natCur].max; }, get attr() { return NAT[natCur].attr; } },
  { id: 'monde', name: 'Monde (OpenFreeMap)', vector: true, max: 14 },
  { id: 'topo', name: 'Topo', tiles: ['a', 'b', 'c'].map(s => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), max: 17, volunteer: true,
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM · © <a href="https://opentopomap.org">OpenTopoMap</a>' },
  { id: 'cyclosm', name: 'CyclOSM (vélo)', tiles: ['a', 'b', 'c'].map(sd => `https://${sd}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`), max: 20, volunteer: true,
    attr: '<a href="https://www.cyclosm.org">CyclOSM</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }
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
// « Plan OSM » a été retiré (serveur réservé aux usages non commerciaux) : remplacé par Monde, mêmes données
if (store.get('layerId') === 'osm') store.set('layerId', 'monde');
let layerIdx = Math.max(0, LAYERS.findIndex(l => l.id === store.get('layerId')));
const baseSource = l => ({ type: 'raster', tiles: l.tiles, tileSize: 256, maxzoom: l.max, attribution: l.attr });
const EMPTY = { type: 'FeatureCollection', features: [] };
const lineFeature = pts => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) } });
const pointFeature = p => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });

// vue de départ : la dernière vue de la carte, sinon la dernière position connue, sinon les Alpes
function startView() {
  try {
    const v = JSON.parse(store.get('view') || 'null');
    if (v && isFinite(v.lat) && isFinite(v.lon)) return { center: [v.lon, v.lat], zoom: clamp(v.z || 14, 3, 18) };
    const p = JSON.parse(store.get('lastPos') || 'null');
    if (p && isFinite(p.lat)) return { center: [p.lon, p.lat], zoom: 14 };
  } catch {}
  return { center: [6.6, 45.9], zoom: 9 };
}
const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: { base: baseSource(LAYERS[layerIdx].vector ? LAYERS[0] : LAYERS[layerIdx]) },
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': cssVar('--mapbg') || '#E4E9DC' } }, { id: 'base', type: 'raster', source: 'base' }] },
  ...startView(), maxPitch: 70, attributionControl: false, fadeDuration: 0
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
map.on('moveend', () => { const c = map.getCenter(); store.set('view', JSON.stringify({ lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5), z: +map.getZoom().toFixed(1) })); });
map.touchZoomRotate.enableRotation();
// fond officiel : on suit le pays au centre de la carte (IGN en France, IGN España en Espagne…)
function natFollow() {
  const c = map.getCenter(), k = natAt(c.lng, c.lat) || (natShapes ? 'ign' : natCur);
  if (k === natCur) return;
  const prev = natCur; natCur = k;
  try {
    if (layerIdx === 0 && map.getSource('base')) { removeBase(); map.addSource('base', baseSource(LAYERS[0])); map.addLayer({ id: 'base', type: 'raster', source: 'base' }, map.getLayer(baseBefore()) ? baseBefore() : undefined); }
  } catch (e) { natCur = prev; if (!map.getSource('base')) try { map.addSource('base', baseSource(LAYERS[0])); map.addLayer({ id: 'base', type: 'raster', source: 'base' }); } catch {} throw e; }
  store.set('natCur', k);
}
// sans attendre la fin du chargement des tuiles (l'évènement « load » peut tarder)
const natTry = (n = 0) => { try { natFollow(); } catch { if (n < 50) setTimeout(() => natTry(n + 1), 200); } };
fetch('regions/countries.json').then(r => r.json()).then(j => { natShapes = j; natTry(); }).catch(() => {});
map.on('moveend', () => { if (natShapes) natFollow(); });

const ready = new Promise(res => map.on('load', res));
const COL = { track: cssVar('--track') || '#E85A0C', done: cssVar('--done') || '#A9B3A5', me: cssVar('--me') || '#1E6FD9', rec: cssVar('--rec') || '#C2410C' };
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
  // sens du parcours : petits chevrons blancs discrets le long de la trace
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const c = cv.getContext('2d');
    c.strokeStyle = '#fff'; c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(11, 7); c.lineTo(21, 16); c.lineTo(11, 25); c.stroke();
    map.addImage('chev', c.getImageData(0, 0, 32, 32), { pixelRatio: 2 });
    map.addLayer({ id: 'track-dir', type: 'symbol', source: 'track', minzoom: 11,
      layout: { 'symbol-placement': 'line', 'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 11, 70, 17, 130], 'icon-image': 'chev',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 18, 0.95], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map' },
      paint: { 'icon-opacity': 0.8 } });
  } catch { /* sans les chevrons, la trace reste affichée */ }
  map.addLayer({ id: 'rec', type: 'line', source: 'rec', layout: round, paint: { 'line-color': COL.rec, 'line-width': w(2, 5) } });
  map.addLayer({ id: 'rejoin-casing', type: 'line', source: 'rejoin', layout: round, paint: { 'line-color': '#fff', 'line-width': w(5, 13) } });
  map.addLayer({ id: 'rejoin', type: 'line', source: 'rejoin', layout: round, paint: { 'line-color': COL.me, 'line-width': w(3, 8), 'line-dasharray': [1.2, 1] } });
  map.addLayer({ id: 'turn', type: 'circle', source: 'turn', paint: { 'circle-radius': 7, 'circle-color': '#fff', 'circle-stroke-color': '#17201c', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map' } });
  map.addSource('plan', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'plan-alt-casing', type: 'line', source: 'plan', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['has', 'alt']], layout: round, paint: { 'line-color': '#fff', 'line-width': w(7, 14) } });
  map.addLayer({ id: 'plan-alt', type: 'line', source: 'plan', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['has', 'alt']], layout: round, paint: { 'line-color': '#6b7079', 'line-width': w(4, 9) } });
  map.addLayer({ id: 'plan-casing', type: 'line', source: 'plan', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', ['has', 'alt']]], layout: round, paint: { 'line-color': '#fff', 'line-width': w(6, 13) } });
  map.addLayer({ id: 'plan-line', type: 'line', source: 'plan', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', ['has', 'alt']], ['!', ['get', 'pending']]], layout: round, paint: { 'line-color': '#7B3FE4', 'line-width': w(3, 8) } });
  map.addLayer({ id: 'plan-pending', type: 'line', source: 'plan', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', ['has', 'alt']], ['get', 'pending']], layout: round, paint: { 'line-color': '#7B3FE4', 'line-width': w(3, 8), 'line-dasharray': [1, 1.5] } });
  map.addLayer({ id: 'plan-pts', type: 'circle', source: 'plan', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': ['case', ['get', 'end'], 8, 6], 'circle-color': ['case', ['get', 'start'], '#2F5E45', ['get', 'end'], '#C62828', '#fff'], 'circle-stroke-color': '#7B3FE4', 'circle-stroke-width': 3 } });
  if (LAYERS[layerIdx].vector) setLayer(layerIdx, false);
});
async function setSrc(id, data) { await ready; const s = map.getSource(id); if (s) s.setData(data); }

const baseBefore = () => map.getLayer('wmt-0') ? 'wmt-0' : map.getLayer('packs-fill') ? 'packs-fill' : 'track-casing';
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
  setLayer(next); toast('Fond de carte : ' + LAYERS[next].name + (LAYERS[next].volunteer ? ' · service bénévole, parfois lent ou indisponible' : ''), LAYERS[next].volunteer ? 4000 : 2800);
};
// Fond bénévole qui ne répond plus : on passe sur IGN (France) ou Monde, sans changer le choix enregistré
let baseErrs = [];
map.on('error', e => {
  const L = LAYERS[layerIdx];
  if (!L || !L.volunteer || e.sourceId !== 'base' || navigator.onLine === false) return;
  const now = Date.now(); baseErrs = baseErrs.filter(t => now - t < 20000); baseErrs.push(now);
  if (baseErrs.length < 8) return;
  baseErrs = [];
  const c = map.getCenter(), inFr = c.lng > -5.5 && c.lng < 9.8 && c.lat > 41.2 && c.lat < 51.2;
  const to = LAYERS.findIndex(l => l.id === (inFr ? 'ign' : 'monde'));
  setLayer(to, false);
  toast(`${L.name} ne répond pas : carte ${LAYERS[to].name} à la place`, 4500);
});

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
// l'appli montre un autre endroit (trace, carte téléchargée) : on arrête de suivre ma position en aperçu
function stopFollowOv() { try { if (!nav && followOv) { followOv = false; $('btnCenter').classList.remove('on'); } } catch { /* pas encore initialisé */ } }
function fitTo(ptsList) {
  stopFollowOv();
  const sheetH = document.body.classList.contains('nav') ? 110 : $('sheet').offsetHeight;
  const topH = document.body.classList.contains('nav') ? $('navTop').offsetHeight : 64;
  map.fitBounds(boundsOf(ptsList), { padding: { top: topH + 30, bottom: sheetH + 30, left: 40, right: 76 }, bearing: 0, pitch: 0, duration: 700, maxZoom: 16 });
}

async function showTrack(t, fit = true) {
  joinNear = false;
  track = makePath(t.pts, t.name); progress = null; clearRejoin(); loadDone();
  // carrefours à feux de l'itinéraire (position le long du tracé), pour le temps estimé
  track.sig = (t.signals || []).map(s => { const pr = project(track, s, true); return pr && pr.dist < 60 ? pr.along : null; }).filter(v => v != null).sort((x, y) => x - y);
  // le texte et le profil s'affichent tout de suite, la carte suit dès qu'elle est prête
  $('trackName').textContent = `${t.name} · ${fmtDist(track.total)}${track.hasEle ? ' · D+ ' + fmtM(track.totalUp) : ''}`;
  $('btnClose').hidden = false; $('btnReverse').hidden = false; $('btnWatch').hidden = false; $('btnSaveTr').hidden = false; refreshSaveBtn(); $('btnNew').hidden = false; $('btnNew').parentElement.classList.add('has-new');
  if (me) progress = project(track, me, true);
  drawProfile(); updateStats();
  const mine = track;
  await ready;
  if (track !== mine) return; // une autre trace a été ouverte entre-temps
  setSrc('track', lineFeature(track.pts)); setDone(doneInfo().along / (track.total || 1), true);
  startMk.setLngLat([t.pts[0].lon, t.pts[0].lat]).addTo(map);
  const last = t.pts[t.pts.length - 1];
  endMk.setLngLat([last.lon, last.lat]).addTo(map);
  if (fit) { map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); fitTo([track.pts]); }
  $('trackName').textContent = `${t.name} · ${fmtDist(track.total)}${track.hasEle ? ' · D+ ' + fmtM(track.totalUp) : ''}`;
  if (me) progress = project(track, me, true);
  $('btnClose').hidden = false; $('btnReverse').hidden = false; $('btnWatch').hidden = false; $('btnSaveTr').hidden = false; refreshSaveBtn(); $('btnNew').hidden = false; $('btnNew').parentElement.classList.add('has-new');
  drawProfile(); updateStats(); updateOfflineInfo();
}

// Fermer la trace ouverte (avec possibilité d'annuler quelques secondes)
function closeTrack(quiet) {
  if (!track) return;
  const savedText = store.get('gpx');
  if (nav) stopNav();
  track = null; progress = null; done = null; clearRejoin(); $('loopBar').hidden = true; $('rtBar').hidden = true;
  // parcours balisés : on quitte leur affichage avec la trace (sauf si leur panneau est ouvert)
  if (rtMapOn && $('routes').hidden) rtHideMap();
  setSrc('track', EMPTY); setSrc('turn', EMPTY);
  startMk.remove(); endMk.remove();
  store.set('gpx', '');
  $('trackName').textContent = 'Aucune trace chargée'; $('btnClose').hidden = true; $('btnReverse').hidden = true; $('btnWatch').hidden = true; $('btnSaveTr').hidden = true; $('btnNew').hidden = true; $('btnNew').parentElement.classList.remove('has-new');
  drawProfile(); updateStats(); updateOfflineInfo();
  if (!quiet) toast('Trace fermée', 5000, savedText ? { label: 'Annuler', run: () => loadText(savedText) } : null);
}
// fermer l'aperçu d'un trajet en cours de préparation : on revient au placement des points
$('btnClose').onclick = () => {
  const back = track && !nav && track.planBack;
  closeTrack(!!back);
  if (back) openPlan(back.go, null, back);
};
// Exporter la trace ouverte en fichier GPX (à garder, envoyer, mettre sur un GPS…)
function exportTrack() {
  if (!track) return;
  const name = track.name || 'Trace';
  const saved = store.get('gpx');
  shareGPX(saved && saved.includes('<trkpt') ? saved : loopGPX(track.pts, name), name);
}
// Enregistrer la trace affichée dans « Mes traces » (boucle, tracé, parcours balisé, trace inversée…)
const ICON_SAVE = '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4Z"/></svg>';
const ICON_OK = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';
async function refreshSaveBtn() {
  const b = $('btnSaveTr'); if (!track) return;
  const id = track.name + '|' + Math.round(track.total), mine = track;
  const saved = (await listRecent()).some(it => it.id === id);
  if (track !== mine) return;
  b.classList.toggle('done', saved);
  b.innerHTML = saved ? ICON_OK + 'Enregistrée' : ICON_SAVE + 'Enregistrer';
  b.setAttribute('aria-label', saved ? 'Trace enregistrée dans Mes traces' : 'Enregistrer la trace dans Mes traces');
}
$('btnSaveTr').onclick = async () => {
  if (!track) return;
  if ($('btnSaveTr').classList.contains('done')) { toast('Déjà dans « Mes traces »', 3000, { label: 'Voir', run: openLib }); return; }
  const saved = store.get('gpx'), text = saved && saved.includes('<trkpt') ? saved : loopGPX(track.pts, track.name);
  await saveRecent(track, text);
  refreshSaveBtn();
  toast('Enregistrée dans « Mes traces »', 3500, { label: 'Voir', run: openLib });
};
// Inverser le sens : la même trace, parcourue de l'arrivée vers le départ
$('btnReverse').onclick = () => {
  if (!track) return;
  if (nav) { toast('Quitte d\'abord la navigation pour inverser la trace.'); return; }
  const rev = track.name.endsWith(' (sens inverse)');
  const name = rev ? track.name.replace(/ \(sens inverse\)$/, '') : track.name + ' (sens inverse)';
  const text = loopGPX(track.pts.slice().reverse(), name);
  loadText(text, false); store.set('gpx', text.length < 4.5e6 ? text : '');
  toast(rev ? 'Trace remise dans son sens d\'origine' : 'Trace inversée : départ et arrivée échangés', 3000);
};
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
// une sortie enregistrée (kind 'rec') est gardée sans limite ; les traces ouvertes : les 30 dernières
const isRec = it => it.kind === 'rec' || (!it.kind && /^Sortie du /.test(it.name));
async function saveRecent(p, text, mustSucceed = false, extra = null) {
  try {
    const id = p.name + '|' + Math.round(p.total);
    await idb('readwrite', st => st.put(Object.assign({ id, name: p.name, dist: p.total, up: p.hasEle ? p.totalUp : null, date: Date.now(), text }, extra || {})));
    const all = (await listRecent()).filter(it => !isRec(it));
    for (const old of all.slice(30)) await idb('readwrite', st => st.delete(old.id));
    return true;
  } catch (e) { if (mustSucceed) throw e; return false; }
}
const fmtDate = t => new Date(t).toLocaleDateString(LOC, { day: 'numeric', month: 'short' });
// durée en mouvement d'une ancienne sortie (sans durée enregistrée) : d'après les heures du GPX, pauses exclues
function recDuration(text) {
  let ms = 0;
  for (const seg of text.split(/<trkseg>/).slice(1)) {
    const t = [...seg.matchAll(/<time>([^<]+)<\/time>/g)].map(m => Date.parse(m[1])).filter(x => !isNaN(x));
    if (t.length > 1) ms += t[t.length - 1] - t[0];
  }
  return ms;
}
const ICON_SHARE = '<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
// Mes traces : les GPX ouverts (les sorties enregistrées ont leur propre écran)
async function renderLib() {
  const list = $('libList'), items = (await listRecent()).filter(it => !isRec(it));
  list.innerHTML = '';
  $('libEmpty').hidden = items.length > 0;
  for (const it of items) {
    const li = document.createElement('li');
    const open = document.createElement('button'); open.className = 'lib-item';
    open.innerHTML = '<b></b><span></span>';
    open.querySelector('b').textContent = it.name;
    open.querySelector('span').textContent = `${fmtDist(it.dist)}${it.up != null ? ' · D+ ' + fmtM(it.up) : ''} · ouverte le ${fmtDate(it.date)}`;
    open.onclick = () => { closeLib(); loadText(it.text); };
    const share = document.createElement('button'); share.className = 'lib-del'; share.setAttribute('aria-label', 'Envoyer ' + it.name);
    share.innerHTML = ICON_SHARE; share.onclick = () => { try { const t = parseGPX(it.text); openSend({ name: it.name, pts: t.pts }); } catch { shareGPX(it.text, it.name); } };
    const del = document.createElement('button'); del.className = 'lib-del'; del.setAttribute('aria-label', 'Retirer ' + it.name);
    del.innerHTML = ICON_DEL; del.onclick = async () => { await idb('readwrite', st => st.delete(it.id)).catch(() => {}); renderLib(); };
    li.append(open, share, del); list.appendChild(li);
  }
}
async function openLib() {
  await renderLib(); $('lib').hidden = false;
}

// =====================================================================
// Mes sorties : les sorties déjà faites, avec le détail de chacune
// =====================================================================
// lecture d'une sortie : points avec heure et segment (une reprise après pause = nouveau segment)
function parseRec(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const segs = [...doc.getElementsByTagName('trkseg')], out = [];
  (segs.length ? segs : [doc]).forEach((sg, si) => {
    for (const n of sg.getElementsByTagName('trkpt')) {
      const e = n.getElementsByTagName('ele')[0], t = n.getElementsByTagName('time')[0];
      const p = { lat: +n.getAttribute('lat'), lon: +n.getAttribute('lon'), ele: e ? +e.textContent : null, t: t ? Date.parse(t.textContent) : NaN, s: si };
      if (isFinite(p.lat) && isFinite(p.lon)) out.push(p);
    }
  });
  return out;
}
function recGaps(pts) {
  let n = 0, ms = 0, dist = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.s || 0) !== (b.s || 0) || !isFinite(a.t) || !isFinite(b.t)) continue; // pause volontaire : pas une coupure
    const dt = b.t - a.t, d = hav(a, b);
    if (dt > 45000 && d > 100) { n++; ms += dt; dist += d; }
  }
  return { n, ms, dist };
}
// altitude GPS : ±10 m de bruit d'un point à l'autre → moyenne glissante avant de compter le dénivelé
function smoothEle(pts) {
  const e = pts.map(p => p.ele == null || isNaN(p.ele) ? null : +p.ele), out = [];
  for (let i = 0; i < e.length; i++) {
    if (e[i] == null) { out.push(null); continue; }
    let s = 0, n = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(e.length - 1, i + 3); k++) if (e[k] != null) { s += e[k]; n++; }
    out.push(s / n);
  }
  return out;
}
function recStats(pts) {
  let dist = 0, move = 0, up = 0, down = 0, lo = Infinity, hi = -Infinity, vmax = 0, last = null;
  const segs = [];
  pts.forEach((p, i) => { if (!i || p.s !== pts[i - 1].s) segs.push([]); segs[segs.length - 1].push(p); });
  for (const g of segs) {
    for (let i = 1; i < g.length; i++) dist += hav(g[i - 1], g[i]);
    if (g.length > 1 && isFinite(g[0].t) && isFinite(g[g.length - 1].t)) move += g[g.length - 1].t - g[0].t;
    // vitesse max : sur au moins 60 m et 15 s, pour ne pas compter les sauts du GPS
    let j = 0, d = 0;
    for (let i = 1; i < g.length; i++) {
      d += hav(g[i - 1], g[i]);
      while (j < i - 1 && (d - hav(g[j], g[j + 1]) >= 60) && g[i].t - g[j + 1].t >= 15000) { d -= hav(g[j], g[j + 1]); j++; }
      const dt = (g[i].t - g[j].t) / 1000;
      if (d >= 60 && dt >= 15) vmax = Math.max(vmax, d / dt);
    }
  }
  for (const ele of smoothEle(pts)) {
    if (ele == null) continue;
    lo = Math.min(lo, ele); hi = Math.max(hi, ele);
    if (last == null) { last = ele; continue; }
    if (ele - last > 3) { up += ele - last; last = ele; } else if (last - ele > 3) { down += last - ele; last = ele; }
  }
  const ts = pts.map(p => p.t).filter(isFinite);
  return { dist, move, total: ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0, up, down, lo: isFinite(lo) ? lo : null, hi: isFinite(hi) ? hi : null, vmax, start: ts[0] || null };
}
const kmh = v => (IMP ? v / 1.609344 : v).toFixed(1).replace('.', ',') + (IMP ? ' mph' : ' km/h');
// vélo ou à pied : gardé à l'enregistrement ; pour les anciennes sorties, deviné d'après la vitesse
const ICON_BIKE = '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h6l3.5 7.5M9 9 12 16.5h1.5L15 9M8 6h3"/></svg>';
const ICON_FOOT = '<svg viewBox="0 0 24 24"><circle cx="13" cy="4" r="2"/><path d="M8 21l3-7 3 3v4M11 14l1-5-3 2-1 3M12 9l3 3h3"/></svg>';
function recMode(it) {
  if (it.mode) return it.mode;
  return it.ms > 60000 && it.dist / (it.ms / 1000) * 3.6 > 9 ? 'bike' : 'foot';
}
const modeLabel = m => m === 'bike' ? 'À vélo' : 'À pied';
const modeIcon = m => m === 'bike' ? ICON_BIKE : ICON_FOOT;

async function openSorties() { $('sorties').hidden = false; showSoList(); }
function closeSorties() { $('sorties').hidden = true; previewRedraw = null; }
$('btnSorties').onclick = openSorties;
$('soClose').onclick = $('soClose2').onclick = closeSorties;
$('sorties').onclick = e => { if (e.target === $('sorties')) closeSorties(); };
$('soBack').onclick = () => showSoList();

async function showSoList() {
  previewRedraw = null;
  $('soDetail').hidden = true; $('soList').hidden = false;
  const items = (await listRecent()).filter(isRec).sort((a, b) => (b.start || b.date) - (a.start || a.date));
  for (const it of items) if (it.ms == null && it.text) { it.ms = recDuration(it.text); idb('readwrite', st => st.put(it)).catch(() => {}); }
  const list = $('soItems'); list.innerHTML = '';
  $('soEmpty').hidden = items.length > 0;
  const d = items.reduce((a, it) => a + (it.dist || 0), 0), ms = items.reduce((a, it) => a + (it.ms || 0), 0), up = items.reduce((a, it) => a + (it.up || 0), 0);
  $('soSum').hidden = !items.length;
  const byMode = m => { const g = items.filter(it => recMode(it) === m); return g.length ? `<span class="so-mode">${modeIcon(m)}<b>${fmtDist(g.reduce((a, it) => a + (it.dist || 0), 0))}</b> ${m === 'bike' ? 'à vélo' : 'à pied'} (${g.length})</span>` : ''; };
  $('soSum').innerHTML = `<b>${items.length}</b> sortie${items.length > 1 ? 's' : ''} · <b>${fmtDist(d)}</b> · ${fmtDur(ms / 1000)}${up ? ' · D+ ' + fmtM(up) : ''}<br>${byMode('bike')}${byMode('foot')}`;
  let month = '';
  for (const it of items) {
    const when = it.start || it.date;
    const m = new Date(when).toLocaleDateString(LOC, { month: 'long', year: 'numeric' });
    if (m !== month) { month = m; const h = document.createElement('li'); h.className = 'lib-month'; h.textContent = m; list.appendChild(h); }
    const li = document.createElement('li');
    const open = document.createElement('button'); open.className = 'lib-item';
    const md = recMode(it);
    li.classList.add('so-li');
    const ic = document.createElement('span'); ic.className = 'so-ic ' + md; ic.innerHTML = modeIcon(md); ic.title = modeLabel(md);
    open.innerHTML = '<b></b><span></span>';
    open.querySelector('b').textContent = it.title || new Date(when).toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + new Date(when).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }).replace(':', LANG === 'fr' ? 'h' : ':');
    const sp = it.ms > 60000 ? ' · ' + kmh(it.dist / (it.ms / 1000) * 3.6) : '';
    open.querySelector('span').textContent = `${fmtDist(it.dist)}${it.ms ? ' · ' + fmtDur(it.ms / 1000) : ''}${it.up != null ? ' · D+ ' + fmtM(it.up) : ''}${sp}`;
    open.onclick = () => showSoDetail(it);
    const chev = document.createElement('span'); chev.className = 'lib-del'; chev.innerHTML = '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>';
    li.append(ic, open, chev); li.onclick = e => { if (e.target === li || e.target.closest('.lib-del')) showSoDetail(it); };
    list.appendChild(li);
  }
}

let previewRedraw = null;
function showSoDetail(it) {
  $('soList').hidden = true; $('soDetail').hidden = false;
  $('sorties').querySelector('.lib-panel').scrollTop = 0;
  const pts = parseRec(it.text), st = recStats(pts), when = st.start || it.start || it.date;
  $('sdName').textContent = recTitle(it);
  const setMode = m => { $('sdMode').innerHTML = modeIcon(m) + modeLabel(m); $('sdMode').className = 'chip so-chip ' + m; };
  setMode(recMode(it));
  // si l'appli s'est trompée (ancienne sortie), on corrige d'un toucher
  $('sdMode').onclick = async () => { it.mode = recMode(it) === 'bike' ? 'foot' : 'bike'; setMode(it.mode); await idb('readwrite', s => s.put(it)).catch(() => {}); };
  $('sdDate').textContent = new Date(when).toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + tr(' · départ ') + new Date(when).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  const move = st.move || it.ms, hasE = st.lo != null;
  $('sdDist').textContent = fmtDist(st.dist);
  $('sdMove').textContent = move ? fmtDur(move / 1000) : '–';
  $('sdAvg').textContent = move > 60000 ? kmh(st.dist / (move / 1000) * 3.6) : '–';
  $('sdUp').textContent = hasE ? fmtM(st.up) : '–';
  $('sdDown').textContent = hasE ? fmtM(st.down) : '–';
  $('sdMax').textContent = st.vmax ? kmh(st.vmax * 3.6) : '–';
  $('sdTotal').textContent = st.total ? fmtDur(st.total / 1000) : '–';
  $('sdMin').textContent = hasE ? fmtM(st.lo) : '–';
  $('sdMaxE').textContent = hasE ? fmtM(st.hi) : '–';
  $('sdProfile').hidden = !hasE;
  // continuité du GPS : un long silence suivi d'un saut = le téléphone a mis l'appli en pause (écran éteint)
  const gaps = recGaps(pts);
  $('sdGps').hidden = false;
  $('sdGps').className = 'so-gps' + (gaps.n ? ' warn' : '');
  $('sdGps').textContent = gaps.n
    ? `⚠️ Enregistrement interrompu ${gaps.n} fois (${fmtDur(gaps.ms / 1000)} sans position, ${fmtDist(gaps.dist)} tracés en ligne droite). Le téléphone a sans doute mis l'appli en pause écran éteint.`
    : '✓ Enregistrement continu, sans coupure du GPS';
  previewRedraw = () => { drawRecMap($('sdMap'), pts); };
  requestAnimationFrame(() => { previewRedraw && previewRedraw(); if (hasE) drawRecProfile($('sdProfile'), pts); });
  $('sdFollow').onclick = () => { closeSorties(); loadText(it.text, false); store.set('gpx', it.text.length < 4.5e6 ? it.text : ''); setTimeout(() => startNav(), 300); };
  $('sdExport').onclick = () => shareGPX(it.text, it.title || it.name);
  stvButton(it);
  $('sdRename').onclick = async () => {
    const t = prompt(tr('Nom de la sortie'), it.title || '');
    if (t == null) return;
    it.title = t.trim() || undefined; await idb('readwrite', s => s.put(it)).catch(() => {});
    $('sdName').textContent = recTitle(it);
  };
  const del = $('sdDelete'); del.textContent = 'Supprimer'; delete del.dataset.armed;
  del.onclick = async () => {
    if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Toucher encore pour supprimer'; return; }
    await idb('readwrite', s => s.delete(it.id)).catch(() => {});
    toast('Sortie supprimée'); showSoList();
  };
}
// =====================================================================
// Strava : envoi des sorties (automatique ou à la demande)
// Strava demande une « appli API » par utilisateur : Client ID et Secret restent sur le téléphone.
// =====================================================================
// Connexion via le relais Pisteo (Cloudflare Worker, voir strava-relay/worker.js) : il garde le secret
// de l'appli Strava hors du code public et transmet les envois.
const STRAVA_CLIENT_ID = '109821';
const STRAVA_RELAY = 'https://api.pisteo.app'; // relais Cloudflare (strava-relay/worker.js), sur le compte pisteo.app
const stvTok = () => { try { return JSON.parse(store.get('stvTok') || 'null'); } catch { return null; } };
const stvOn = () => !!(stvTok() && STRAVA_RELAY);
const stvBack = () => location.origin + location.pathname;
function stvUI() {
  const t = stvTok(), on = stvOn();
  $('stvSetup').hidden = on; $('stvConnect').hidden = on || !STRAVA_RELAY; $('stvOn').hidden = !on;
  $('stvNotReady').hidden = !!STRAVA_RELAY;
  $('stvWho').textContent = t && t.who ? t.who : 'ton compte';
  $('stvAuto').checked = store.get('stvAuto') === '1';
  const bl = on && stvBlocked();
  $('stvBlockedMsg').hidden = !bl; $('stvRetryBtn').hidden = !bl;
  $('stvAutoL').textContent = bl ? 'Proposer de mettre sur Strava chaque sortie gardée' : 'Envoyer automatiquement chaque sortie gardée';
  $('stvAutoS').textContent = bl ? 'Un message « Strava » apparaît à la fin de la sortie' : 'Sinon : bouton « Mettre sur Strava » dans la fiche de la sortie';
  $('stvStatus').textContent = !on ? 'Non connecté' : bl ? 'Import manuel' : store.get('stvAuto') === '1' ? 'Envoi automatique' : 'Connecté';
}
// ---------- Sauvegarde : sorties, traces et réglages dans un fichier, et restauration ----------
// réglages choisis par l'utilisateur (pas l'état en cours, ni les caches, ni la connexion Strava)
const BK_KEYS = ['thr', 'voice', 'vib', 'autoRec', 'eco', 'ecoSeen', 'banner', 'theme', 'profile', 'layerId', 'soLayer',
  'rtFilt', 'npProfOnly', 'showPacks', 'stvAuto', 'recHint'];
const bkCount = items => {
  const r = items.filter(isRec).length;
  const plural = (n, w) => n + ' ' + w + (n > 1 ? 's' : '');
  return plural(r, 'sortie') + ' et ' + plural(items.length - r, 'trace');
};
const bkMaps = n => n + ' carte' + (n > 1 ? 's' : '');
function bkSay(msg) { const m = $('bkMsg'); m.textContent = msg || ''; m.hidden = !msg; }
async function bkRefresh() {
  const items = await listRecent();
  $('bkSum').textContent = items.length ? 'Sur ce téléphone : ' + bkCount(items) : 'Aucune sortie ni trace sur ce téléphone pour l\'instant.';
}
function openBackup() { $('backup').hidden = false; $('bkSum').textContent = '…'; bkSay(''); bkRefresh(); }
$('btnBackup').onclick = openBackup;
$('bkClose').onclick = () => { $('backup').hidden = true; };
$('backup').onclick = e => { if (e.target === $('backup')) $('backup').hidden = true; };
$('bkSave').onclick = async () => {
  const items = await listRecent();
  // les cartes : seulement leur description (pas les images), pour pouvoir les retélécharger
  const packs = (await listPacks()).filter(p => Array.isArray(p.tiles) && p.tiles.length).map(p => ({
    id: p.id, kind: p.kind, name: p.name, detail: p.detail, code: p.code, cc: p.cc, prov: p.prov, bbox: p.bbox, line: p.line,
    tiles: p.tiles, count: p.tiles.length, graphWanted: !!(p.graph || p.graphWanted) }));
  if (!items.length && !packs.length) { toast('Rien à sauvegarder pour l\'instant'); return; }
  const settings = {};
  for (const k of BK_KEYS) { const v = store.get(k); if (v != null && v !== '') settings[k] = v; }
  const data = { app: 'pisteo', format: 1, version: APP_VERSION, date: new Date().toISOString(), settings, tracks: items, packs };
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const fname = `pisteo-sauvegarde-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  if (AND) { try { AND.shareFile(fname, 'application/json', JSON.stringify(data)); store.set('bkDate', String(Date.now())); } catch {} return; }
  const file = new File([JSON.stringify(data)], fname, { type: 'application/json' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Sauvegarde Pisteo' }); store.set('bkDate', String(Date.now())); return; } }
  catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fname;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  store.set('bkDate', String(Date.now()));
  toast('Sauvegarde créée : ' + [items.length && bkCount(items), packs.length && 'liste de ' + bkMaps(packs.length)].filter(Boolean).join(' + '), 3500);
};
$('bkLoad').onclick = () => { $('bkIn').value = ''; $('bkIn').click(); };
$('bkIn').onchange = async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  bkSay('Lecture du fichier…');
  let data;
  try { data = JSON.parse(await f.text()); } catch { data = null; }
  if (!data || data.app !== 'pisteo' || !Array.isArray(data.tracks)) { bkSay('Ce fichier n\'est pas une sauvegarde Pisteo.'); return; }
  const ok = data.tracks.filter(it => it && typeof it.id === 'string' && typeof it.text === 'string' && /<gpx/i.test(it.text));
  const have = new Set((await listRecent()).map(it => it.id));
  const fresh = ok.filter(it => !have.has(it.id));
  const havePacks = new Set((await listPacks()).map(p => p.id));
  const freshPacks = (Array.isArray(data.packs) ? data.packs : []).filter(p => p && typeof p.id === 'string' && Array.isArray(p.tiles)
    && p.tiles.length && p.tiles.every(t => typeof t === 'string') && Array.isArray(p.bbox) && !havePacks.has(p.id));
  // tout est déjà là : on ne touche à rien
  if (!fresh.length && !freshPacks.length) {
    bkSay('Cette sauvegarde est déjà sur l\'appli : rien à restaurer.');
    // déjà restaurée, mais des cartes restent à retélécharger : on y emmène
    if ((await listPacks()).some(p => p.restored && !p.complete)) setTimeout(() => { $('backup').hidden = true; openMaps(); }, 1800);
    return;
  }
  try {
    for (const it of fresh) await idb('readwrite', st => st.put(it));
    for (const p of freshPacks) await idb('readwrite', st => st.put(Object.assign({}, p, { count: p.tiles.length, bytes: 0, date: Date.now(), complete: false, missing: p.tiles.length, restored: true })), 'packs');
  } catch { bkSay('Restauration impossible : le stockage du téléphone est plein ou bloqué.'); return; }
  if (freshPacks.length) drawPacks();
  let setChanged = false;
  if (data.settings && typeof data.settings === 'object')
    for (const k of BK_KEYS) if (typeof data.settings[k] === 'string' && store.get(k) !== data.settings[k]) { store.set(k, data.settings[k]); setChanged = true; }
  const parts = [];
  if (fresh.length) parts.push(bkCount(fresh));
  if (freshPacks.length) parts.push('la liste de ' + bkMaps(freshPacks.length));
  const msg = 'Restauré : ' + parts.join(', et ') + '.';
  await bkRefresh();
  if (setChanged) {
    bkSay(msg + ' Réglages appliqués, l\'appli redémarre…');
    try { sessionStorage.setItem('bkDone', msg); if (freshPacks.length) sessionStorage.setItem('bkMaps', '1'); } catch {}
    setTimeout(() => location.reload(), 2500);
  } else {
    bkSay(msg);
    // les cartes ne sont pas dans le fichier : on ouvre « Mes cartes », où « Tout retélécharger » attend
    if (freshPacks.length) setTimeout(() => { $('backup').hidden = true; openMaps(); }, 1800);
  }
};
try { const m = sessionStorage.getItem('bkDone'), mp = sessionStorage.getItem('bkMaps'); sessionStorage.removeItem('bkMaps');
  if (m) { sessionStorage.removeItem('bkDone'); setTimeout(() => toast(m + ' Réglages appliqués.', 4000), 800); }
  if (mp) setTimeout(() => openMaps(), 1500); } catch {}

// ---------- écouter la voix, et comment en avoir une plus naturelle ----------
function voiceSample() {
  if (!voiceOn) { toast('Active d\'abord le guidage vocal'); return; }
  unlockAudio(); say('Dans 200 mètres, tourne à gauche, puis tout de suite à droite.');
}
$('voiceTest').onclick = e => { e.preventDefault(); voiceSample(); };
$('optVStyle').onchange = e => { store.set('vstyle', e.target.value); $('voiceHelpRow').hidden = e.target.value === 'pisteo'; $('voiceCredit').hidden = e.target.value !== 'pisteo'; voiceSample(); };
if (LANG !== 'fr') { const o = $('optVStyle').querySelector('[value="pisteo"]'); if (o) o.remove(); } // la voix enregistrée n'existe qu'en français
setTimeout(() => { $('optVStyle').value = LANG === 'fr' ? voiceStyle() : 'system'; $('voiceHelpRow').hidden = voiceStyle() === 'pisteo'; $('voiceCredit').hidden = voiceStyle() !== 'pisteo'; }, 0); // après l'initialisation de la voix
$('voiceHelp').onclick = e => { e.preventDefault(); $('voiceInfo').hidden = false; };
$('viClose').onclick = () => { $('voiceInfo').hidden = true; };
$('voiceInfo').onclick = e => { if (e.target === $('voiceInfo')) $('voiceInfo').hidden = true; };
$('viTest').onclick = voiceSample;

// ---------- Donner mon avis : un e-mail prérempli (pas de serveur) ----------
const FB_MAIL = 'pisteo.app@gmail.com';
let fbKind = 'Problème';
$('btnFeedback').onclick = () => { $('feedback').hidden = false; setTimeout(() => $('fbText').focus(), 200); };
$('fbClose').onclick = () => { $('feedback').hidden = true; };
$('feedback').onclick = e => { if (e.target === $('feedback')) $('feedback').hidden = true; };
$('fbKind').querySelectorAll('button').forEach(b => b.onclick = () => {
  fbKind = b.dataset.k; $('fbKind').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  $('fbText').placeholder = fbKind === 'Problème' ? "Raconte ce qui s'est passé : ce que tu faisais, ce que tu attendais, ce que l'appli a fait…"
    : fbKind === 'Idée' ? 'Quelle fonction te manque ? Dans quelle situation te servirait-elle ?' : "Qu'est-ce qui te plaît, ou te déplaît ?";
});
$('fbSend').onclick = () => {
  const txt = $('fbText').value.trim();
  if (!txt) { toast('Écris quelques mots avant d\'envoyer'); return; }
  const ua = navigator.userAgent, m = ua.match(/Android [\d.]+;\s*([^;)]+)/), installed = matchMedia('(display-mode: standalone)').matches;
  const info = [`Version : ${VERSION}`, `Appareil : ${m ? m[1].replace(/ Build.*/, '') : (/iPhone|iPad/.test(ua) ? 'iPhone / iPad' : 'ordinateur')}`,
    `Système : ${(ua.match(/Android [\d.]+|OS [\d_]+/) || ['?'])[0].replace(/_/g, '.')}`, `Navigateur : ${(ua.match(/Chrome\/[\d]+/) || ['?'])[0]}`,
    `Mode : ${installed ? 'appli installée' : 'navigateur'}`, `Écran : ${screen.width}×${screen.height}`];
  const body = `${txt}\n\n—\n${info.join('\n')}`;
  location.href = `mailto:${FB_MAIL}?subject=${encodeURIComponent('Pisteo · ' + fbKind)}&body=${encodeURIComponent(body)}`;
  setTimeout(() => { $('feedback').hidden = true; $('fbText').value = ''; toast('Merci pour ton retour !', 3500); }, 800);
};

function openStrava() { stvUI(); $('strava').hidden = false; }
$('btnStrava').onclick = openStrava;
$('stvClose').onclick = () => { $('strava').hidden = true; };
$('strava').onclick = e => { if (e.target === $('strava')) $('strava').hidden = true; };
$('stvAuto').onchange = e => { store.set('stvAuto', e.target.checked ? '1' : '0'); stvUI(); };
$('stvRetryBtn').onclick = () => { store.set('stvInactive', ''); stvUI(); toast('Envoi direct réactivé : essaie « Mettre sur Strava » sur une sortie', 4000); };
$('stvOff').onclick = () => { store.set('stvTok', ''); stvUI(); toast('Strava déconnecté'); };
$('stvConnect').onclick = () => {
  if (!STRAVA_RELAY) return;
  const q = `client_id=${STRAVA_CLIENT_ID}&response_type=code&approval_prompt=auto&scope=read,activity:write`;
  // appli Android : connexion dans l'appli Strava ou le navigateur (Google refuse les WebView), puis le lien de retour rouvre Pisteo
  if (AND && AND.openExternal) {
    const u = `https://www.strava.com/oauth/authorize?${q}&redirect_uri=${encodeURIComponent(stvBack() + 'retour-strava/?strava=1')}`;
    try { AND.openExternal(u, true); } catch { AND.openExternal(u); } // appli 2.0.1 : pas encore le choix « navigateur »
    return;
  }
  location.href = `https://www.strava.com/oauth/authorize?${q}&redirect_uri=${encodeURIComponent(stvBack() + '?strava=1')}`;
};
async function stvTokenReq(params) {
  const r = await fetch(STRAVA_RELAY + '/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.message || 'HTTP ' + r.status);
  return j;
}
// retour de la page d'autorisation Strava
async function stvReturn() {
  const q = new URLSearchParams(location.search);
  if (!q.has('strava')) return;
  history.replaceState(null, '', location.pathname);
  if (q.get('error') || !q.get('code')) { toast('Connexion à Strava annulée.', 4000); return; }
  if (!/activity:write/.test(q.get('scope') || '')) { toast('Il faut laisser cochée l\'autorisation d\'envoyer des activités sur la page Strava. Réessaie.', 6000); openStrava(); return; }
  try {
    const j = await stvTokenReq({ code: q.get('code') });
    store.set('stvTok', JSON.stringify({ a: j.access_token, r: j.refresh_token, exp: j.expires_at, who: j.athlete ? `${j.athlete.firstname || ''} ${j.athlete.lastname || ''}`.trim() : '' }));
    toast('Connecté à Strava 🎉', 4000); openStrava(); stvRetry();
  } catch (e) { toast('Connexion à Strava impossible : ' + e.message, 6000); openStrava(); }
}
async function stvAccess() {
  const t = stvTok(); if (!t) throw new Error('non connecté');
  if (t.exp * 1000 - 120000 > Date.now()) return t.a;
  const j = await stvTokenReq({ refresh_token: t.r });
  Object.assign(t, { a: j.access_token, r: j.refresh_token || t.r, exp: j.expires_at }); store.set('stvTok', JSON.stringify(t));
  return t.a;
}
// message d'erreur Strava lisible (ex. abonnement requis, autorisation manquante)
function stvErr(u, status) {
  const det = (u.errors || []).map(e => [e.resource, e.field, e.code].filter(Boolean).join(' ')).join(', ');
  const base = (u.message || 'erreur') + (det ? ' (' + det + ')' : '') + ' · code ' + status;
  if (status === 401) return 'Strava refuse l\'accès : ' + base + '. Déconnecte puis reconnecte Strava dans les Réglages';
  if (status === 403) return 'Strava refuse l\'accès : ' + base + '. L\'accès à l\'API Strava demande peut-être un abonnement';
  if (status === 429) return 'Trop de demandes à Strava, réessaie dans 15 minutes';
  return base;
}
function recTitle(it) {
  if (it.title) return it.title;
  const d = new Date(it.start || it.date), h = d.getHours();
  return (h < 11 ? 'Sortie matinale' : h < 14 ? 'Sortie du midi' : h < 18 ? 'Sortie de l\'après-midi' : 'Sortie du soir') + (recMode(it) === 'bike' ? ' à vélo' : ' à pied');
}
// envoi : dépôt du GPX, attente du traitement par Strava, puis type d'activité (vélo / marche)
const stvBusy = new Set(); // une même sortie n'est jamais envoyée deux fois en parallèle
async function stvUpload(it, onStep) {
  if (stvBusy.has(it.id)) throw new Error('envoi déjà en cours');
  stvBusy.add(it.id);
  try { return await stvUploadNow(it, onStep); } finally { stvBusy.delete(it.id); }
}
async function stvUploadNow(it, onStep) {
  const tok = await stvAccess(), H = { Authorization: 'Bearer ' + tok };
  const f = new FormData();
  f.append('file', new Blob([it.text], { type: 'application/gpx+xml' }), 'sortie.gpx');
  f.append('data_type', 'gpx'); f.append('name', recTitle(it)); f.append('description', 'Enregistrée avec Pisteo');
  f.append('external_id', 'pisteo-' + String(it.start || it.date));
  onStep && onStep('Envoi…');
  let r = await fetch(STRAVA_RELAY + '/upload', { method: 'POST', headers: H, body: f });
  let u = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(stvErr(u, r.status));
  for (let k = 0; k < 30 && !u.activity_id && !u.error; k++) {
    onStep && onStep('Traitement par Strava…');
    await new Promise(z => setTimeout(z, 2000));
    r = await fetch(STRAVA_RELAY + '/upload/' + u.id, { headers: H }); u = await r.json().catch(() => u);
  }
  let aid = u.activity_id;
  if (!aid && u.error) { const m = /activities\/(\d+)/.exec(u.error); if (m && /duplicate/i.test(u.error)) aid = +m[1]; else throw new Error(u.error.replace(/<[^>]+>/g, '')); }
  if (!aid) throw new Error('Strava met du temps à traiter la sortie, elle apparaîtra bientôt');
  await fetch(STRAVA_RELAY + '/activity/' + aid, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, H),
    body: JSON.stringify({ sport_type: recMode(it) === 'bike' ? 'Ride' : 'Walk' }) }).catch(() => {});
  it.strava = aid; delete it.stvPending;
  await idb('readwrite', st => st.put(it)).catch(() => {});
  return aid;
}
// ---------- import manuel (Strava refuse l'envoi direct sans abonnement) ----------
// le GPX porte le type d'activité, que Strava reconnaît à l'import (vélo / marche)
function gpxForStrava(it) {
  const type = recMode(it) === 'bike' ? 'cycling' : 'walking';
  let t = it.text.replace(/<trk>\s*<name>([\s\S]*?)<\/name>/, (m, n) => `<trk><name>${recTitle(it).replace(/[<&>]/g, '')}</name><type>${type}</type>`);
  if (!/<type>/.test(t)) t = t.replace('<trk>', `<trk><type>${type}</type>`);
  return t;
}
function saveFile(text, fname) {
  // l'appli renvoie le nom réellement enregistré (2.2+) ; les versions plus anciennes renvoient true/false
  if (AND) { let r = ''; try { r = AND.saveDownload(fname, 'application/gpx+xml', text); } catch {} return typeof r === 'string' ? r : r ? fname : ''; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/gpx+xml' })); a.download = fname;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
// un seul bouton : enregistre le GPX et ouvre l'import Strava ; au retour dans Pisteo, on demande si c'est publié
// page d'import Strava dans l'appli (Android 2.3+) : en pause (23 oct.) — la connexion Google y est refusée par Google,
// l'import par Chrome reste plus simple pour la plupart. Passer à true pour la réactiver.
const STV_INAPP = false;
let smAway = false, smChrome = false, smIt = null, smManual = null;
// retour de la page d'import dans l'appli : identifiant de l'activité créée, « chrome » ou rien
window.pisteoStravaDone = async id => {
  const it = smIt; if (!it) return;
  if (id === 'chrome') { smChrome = true; openStvManual(it); if (smManual) smManual(); return; }
  if (id && /^\d+$/.test(id)) {
    it.strava = id; delete it.stvPending; delete it.stravaManual;
    await idb('readwrite', st => st.put(it)).catch(() => {});
    $('stvMan').hidden = true; toast('Sortie publiée sur Strava', 4000, { label: 'Voir', run: () => window.open('https://www.strava.com/activities/' + id, '_blank') });
    if (!$('soDetail').hidden) stvButton(it);
    return;
  }
  $('smGo').hidden = true; $('smBack').hidden = false; // fermée sans fin détectée : on demande
};
function openStvManual(it, why) {
  const d = new Date(it.start || it.date), pad = n => String(n).padStart(2, '0');
  const fname = `pisteo-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}h${pad(d.getMinutes())}.gpx`;
  const strava = () => { smAway = true; window.open('https://www.strava.com/upload/select', '_blank'); };
  // appli 2.3+ : la page d'import s'ouvre dans l'appli et reçoit directement le fichier
  const inApp = STV_INAPP && !!(AND && AND.stravaImport) && !smChrome;
  $('smIn').hidden = $('smInNote').hidden = !inApp; $('smOut').hidden = $('smOutNote').hidden = inApp;
  $('smOpen').textContent = tr(inApp ? 'Ouvrir l\'import Strava' : 'Enregistrer et ouvrir Strava');
  const manual = () => { const got = saveFile(gpxForStrava(it), fname); if (got) $('smFile').textContent = $('smFile2').textContent = got; strava(); };
  smIt = it;
  $('smWhy').textContent = why || 'Strava bloque l\'envoi direct sans abonnement : on passe par sa page d\'import.';
  $('smFile').textContent = $('smFile2').textContent = fname;
  $('smGo').hidden = false; $('smBack').hidden = true; smAway = false;
  $('smOpen').onclick = () => {
    if (!inApp) { manual(); return; }
    const L = { title: tr('Mettre sur Strava'), close: tr('Fermer'), chrome: 'Chrome',
      hint: tr('Touche « Sélect. fichiers » : ta sortie est choisie toute seule. Puis « Enregistrer et afficher ».'),
      sent: tr('Ta sortie est choisie. Vérifie le titre et le type, puis « Enregistrer et afficher ».'), done: tr('Sortie publiée sur Strava'),
      google: tr('Google refuse la connexion dans une appli. Connecte-toi avec ton e-mail Strava (« Mot de passe oublié » pour t\'en créer un), ou touche « Chrome » en haut.') };
    let ok = false; try { ok = AND.stravaImport(fname, gpxForStrava(it), JSON.stringify(L)); } catch {}
    if (!ok) manual();
  };
  smManual = manual;
  $('smAgain').onclick = () => $('smOpen').onclick();
  $('smLater').onclick = () => { $('stvMan').hidden = true; };
  $('smDone').onclick = async () => {
    it.stravaManual = Date.now(); delete it.stvPending;
    await idb('readwrite', st => st.put(it)).catch(() => {});
    $('stvMan').hidden = true; toast('Sortie notée comme publiée sur Strava', 3000);
    if (!$('soDetail').hidden) stvButton(it);
  };
  $('stvMan').hidden = false;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !smAway || $('stvMan').hidden) return;
  smAway = false; $('smGo').hidden = true; $('smBack').hidden = false;
});
$('smClose').onclick = () => { $('stvMan').hidden = true; };
$('stvMan').onclick = e => { if (e.target === $('stvMan')) $('stvMan').hidden = true; };
// Strava a refusé l'appli (pas d'abonnement) : on retient pour une semaine et on passe à l'import manuel
const stvBlocked = () => Date.now() - +(store.get('stvInactive') || 0) < 7 * 864e5;
const isInactive = e => e && /inactive|subscription|abonnement/i.test(e.message || '');
function stvFail(it, e) {
  if (isInactive(e)) { store.set('stvInactive', String(Date.now())); openStvManual(it); return; }
  const net = e instanceof TypeError; // pas de réseau, ou Strava refuse l'appel depuis le navigateur
  toast('Envoi sur Strava impossible' + (net ? (navigator.onLine === false ? ' : pas de réseau, nouvel essai plus tard' : '') : ' : ' + e.message) + '.', 6000,
    { label: 'Import manuel', run: () => openStvManual(it) });
}
// sorties en attente (envoi automatique sans réseau) : nouvel essai au démarrage et au retour du réseau
async function stvRetry() {
  if (!stvOn() || navigator.onLine === false || stvBlocked()) return;
  for (const it of (await listRecent()).filter(x => x.stvPending && !x.strava && !stvBusy.has(x.id))) {
    try { await stvUpload(it); toast('Sortie envoyée sur Strava', 3000); } catch { break; }
  }
}
window.addEventListener('online', () => setTimeout(stvRetry, 3000));
async function stvAuto(id) {
  if (!stvOn() || store.get('stvAuto') !== '1') return;
  if (stvBlocked()) { setTimeout(() => toast('Sortie gardée · la mettre sur Strava ?', 6000, { label: 'Strava', run: async () => { const x = (await listRecent()).find(y => y.id === id); if (x) openStvManual(x); } }), 5200); return; }
  const it = (await listRecent()).find(x => x.id === id); if (!it) return;
  it.stvPending = true; await idb('readwrite', st => st.put(it)).catch(() => {});
  try { await stvUpload(it); toast('Sortie envoyée sur Strava', 4000, { label: 'Voir', run: () => window.open('https://www.strava.com/activities/' + it.strava, '_blank') }); }
  catch (e) {
    if (e instanceof TypeError && navigator.onLine === false) return;
    if (isInactive(e)) { store.set('stvInactive', String(Date.now())); delete it.stvPending; idb('readwrite', st => st.put(it)).catch(() => {});
      toast('Strava refuse l\'envoi direct sans abonnement', 6000, { label: 'Mettre sur Strava', run: () => openStvManual(it) }); return; }
    stvFail(it, e);
  }
}
function stvButton(it, keepMsg) {
  const b = $('sdStrava'), msg = $('sdStvMsg');
  if (!keepMsg) msg.hidden = true;
  const done = it.strava || it.stravaManual;
  b.disabled = false;
  b.classList.toggle('sent', !!done);
  b.textContent = it.strava ? 'Voir sur Strava ✓' : it.stravaManual ? 'Sur Strava ✓ · remettre' : 'Mettre sur Strava';
  b.onclick = async () => {
    if (it.strava) { window.open('https://www.strava.com/activities/' + it.strava, '_blank'); return; }
    // envoi direct seulement si Strava l'accepte (compte connecté et appli active), sinon import manuel
    if (!stvOn() || stvBlocked() || it.stravaManual) { openStvManual(it); return; }
    b.disabled = true; msg.hidden = true;
    try { await stvUpload(it, t => { b.textContent = t; }); toast('Sortie envoyée sur Strava', 3000); }
    catch (e) {
      stvFail(it, e);
      if (!isInactive(e)) {
        msg.hidden = false; msg.className = 'so-msg err';
        msg.textContent = 'Envoi impossible : ' + (e instanceof TypeError ? 'le relais ou Strava ne répond pas (' + e.message + ')' : e.message);
      }
    }
    stvButton(it, true);
  };
}

// aperçu de la sortie sur un fond de carte (tuiles du fond choisi)
// fond de la carte des sorties : choisi à part (fonds en images seulement), sinon celui de la carte
const SO_LAYERS = () => LAYERS.filter(l => !l.vector);
function soLayer() {
  const id = store.get('soLayer'), list = SO_LAYERS();
  return list.find(l => l.id === id) || (LAYERS[layerIdx].vector ? LAYERS[0] : LAYERS[layerIdx]);
}
$('sdLayer').onclick = () => {
  const list = SO_LAYERS(), k = list.indexOf(soLayer()), n = list[(k + 1) % list.length];
  store.set('soLayer', n.id); previewRedraw && previewRedraw();
};
function drawRecMap(cv, pts) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cssVar('--mapbg') || '#E4E9DC'; ctx.fillRect(0, 0, W, H);
  if (pts.length < 2) return;
  const L = soLayer();
  $('sdLayer').textContent = L.name.replace(/ \(.*\)/, '') + ' ▾';
  let z = Math.min(L.max, 17);
  const bb = (zz) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const p of pts) { const x = wx(p.lon, zz), y = wy(p.lat, zz); a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); } return [a, b, c, d]; };
  let B = bb(z);
  while (z > 3 && (B[1] - B[0] > W - 40 || B[3] - B[2] > H - 40)) { z--; B = bb(z); }
  const ox = (B[0] + B[1]) / 2 - W / 2, oy = (B[2] + B[3]) / 2 - H / 2;
  for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++)
    for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++) {
      const im = pipTile(z, tx, ty, L); if (im) ctx.drawImage(im, tx * 256 - ox, ty * 256 - oy, 256.5, 256.5);
    }
  const P = pts.map(p => [wx(p.lon, z) - ox, wy(p.lat, z) - oy, p.s]);
  const stroke = (col, w) => {
    ctx.beginPath();
    P.forEach(([x, y, s], i) => (i && s === P[i - 1][2]) ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke();
  };
  stroke('#fff', 7); stroke(COL.rec, 4);
  const dot = ([x, y], col) => { ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke(); };
  dot(P[0], cssVar('--go') || '#2F5E45'); dot(P[P.length - 1], '#C62828');
}
function drawRecProfile(cv, pts) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const D = [0]; for (let i = 1; i < pts.length; i++) D.push(D[i - 1] + (pts[i].s === pts[i - 1].s ? hav(pts[i - 1], pts[i]) : 0));
  const E = pts.map(p => p.ele), tot = D[D.length - 1] || 1;
  let lo = Infinity, hi = -Infinity; E.forEach(e => { if (e != null) { lo = Math.min(lo, e); hi = Math.max(hi, e); } });
  const pad = Math.max(10, (hi - lo) * .1); lo -= pad; hi += pad;
  const L0 = 36, h = H - 20, w = W - L0 - 4, X = d => L0 + d / tot * w, Y = e => 4 + (1 - (e - lo) / (hi - lo)) * (h - 4);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = cssVar('--muted'); ctx.strokeStyle = cssVar('--line'); ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const [v, lab] of eleTicks(lo, hi, [10, 20, 50, 100, 200, 500, 1000])) { const y = Math.round(Y(v)) + .5; ctx.beginPath(); ctx.moveTo(L0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.fillText(lab, L0 - 4, y); }
  ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'; ctx.fillText('0', L0, H); ctx.textAlign = 'right'; ctx.fillText(fmtDist(tot), W, H);
  const path = new Path2D(); let first = true;
  pts.forEach((p, i) => { if (p.ele == null) return; const x = X(D[i]), y = Y(p.ele); first ? path.moveTo(x, y) : path.lineTo(x, y); first = false; });
  const area = new Path2D(path); area.lineTo(X(tot), h); area.lineTo(L0, h); area.closePath();
  ctx.fillStyle = COL.rec; ctx.globalAlpha = .15; ctx.fill(area); ctx.globalAlpha = 1;
  ctx.strokeStyle = COL.rec; ctx.lineWidth = 2; ctx.stroke(path);
}
function closeLib() { $('lib').hidden = true; }
$('btnOpen').onclick = openLib;
$('libClose').onclick = closeLib;
$('lib').onclick = e => { if (e.target === $('lib')) closeLib(); };
$('libBrowse').onclick = () => { closeLib(); $('fileIn').click(); };

// ---------- GPX partagé depuis une autre appli (gestionnaire de fichiers, mail…) ----------
async function checkShared() {
  if (AND) { try { const t = AND.takeShared(); if (t) loadText(t); } catch {} return; }
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
  if (AND) { try { AND.keepAwake(true); } catch {} return; }
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); } } catch { /* refusé */ }
}
document.addEventListener('visibilitychange', () => { if ((nav || recording) && document.visibilityState === 'visible') keepAwake(); });

// appli Android : pendant la navigation ou l'enregistrement, un service garde le GPS actif écran verrouillé
// et envoie les positions ici (le navigateur intégré, lui, est mis en veille par Android)
let nativeT = 0, bgOn = false;
window.pisteoPos = (lat, lon, ele, acc, speed, heading, t) => { nativeT = Date.now(); onPos({ lat, lon, ele, acc, speed, heading, t }); };
function bgTrack() {
  if (!AND || !AND.tracking) return;
  const want = !!(nav || actState === 'on');
  const text = nav && actState === 'on' ? 'Navigation et enregistrement en cours' : nav ? 'Navigation en cours' : 'Enregistrement de la sortie en cours';
  if (want === bgOn && !want) return;
  bgOn = want;
  try { AND.tracking(want, tr(text)); } catch {}
}
function startGPS() {
  if (sim) return true;
  if (!('geolocation' in navigator)) { toast('Ce navigateur ne donne pas accès au GPS.', 4000); return false; }
  if (watchId != null) return true;
  watchId = navigator.geolocation.watchPosition(p => {
    if (Date.now() - nativeT < 5000) return; // le service de l'appli Android donne déjà les positions
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
  if (AND) try { AND.keepAwake(false); } catch {}
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
let fullT = 0;
function onPos(pos) {
  if (sim && !pos.sim) return; // pendant la simulation on ignore le vrai GPS
  // économie : loin des virages, une position sur deux secondes est traitée en entier ;
  // les autres servent seulement à l'enregistrement et au point bleu
  if (nav && eco !== 'off' && !pos.sim && pos.t - fullT < 2000 && !ecoNear()) {
    me = Object.assign(pos, { speed: pos.speed != null && !isNaN(pos.speed) ? pos.speed : (me && me.speed) });
    meMk.setLngLat([pos.lon, pos.lat]); onActFix(pos); return;
  }
  fullT = pos.t;
  if (!pos.sim && (!onPos.saved || pos.t - onPos.saved > 60000)) { onPos.saved = pos.t; store.set('lastPos', JSON.stringify({ lat: pos.lat, lon: pos.lon, t: Date.now() })); }
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
  if (track) { progress = project(track, pos); updateDone(pos); }
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
    if (rejoin && progress && progress.dist < Math.min(thrRef() * 0.7, 30) && !isOff && rightPart()) clearRejoin();
    if (!rejoin && progress && done && progress.remain < 25 && track.total - done.along < 25 && !arrived) {
      arrived = true; say(pick(['Tu es arrivé. Bravo, belle sortie !', 'Et voilà, tu es arrivé ! Bien joué.'])); vibrate([200, 100, 200]);
    }
    guidance();
    if (follow) navCamera(1000);
  } else {
    if (rejoin && progress && progress.dist < Math.min(thrRef() * 0.7, 30) && rightPart()) { clearRejoin(); toast('Tu es sur la trace'); }
    if (followOv) map.easeTo({ center: [pos.lon, pos.lat], duration: 800 });
  }
  if (track) setDone(doneInfo().along / track.total);
  updateStats(); drawProfileSoon(); updateNavMore();
}

// =====================================================================
// Mode navigation
// =====================================================================
let nav = false, follow = true, followOv = false, navTrackId = null, navStartT = 0, freeD = 0, freeRef = null;
function navZoom() { const s = speedEma || 1.2; return s > 7 ? 15.4 : s > 3.5 ? 16.2 : 17; }
let camT = 0;
function navCamera(dur) {
  if (!me) return;
  const h = map.getContainer().clientHeight;
  if (nav && eco !== 'off') {
    // économie : carte à plat, sans animation, recentrée toutes les 3 s (à chaque position près d'un virage)
    const now = Date.now();
    if (dur > 0 && now - camT < 3000 && !ecoNear()) return;
    camT = now;
    map.jumpTo({ center: [me.lon, me.lat], bearing: heading != null ? heading : map.getBearing(), pitch: 0, zoom: navZoom(),
      padding: { top: Math.round(h * 0.4), bottom: Math.min($('navBottom').offsetHeight || 100, h * 0.45), left: 0, right: 0 } });
    return;
  }
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
  // en navigation, la carte ne montre que ta trace : les parcours balisés sont retirés
  if (rtMapOn) { rtHideMap(); closeRoutes(); }
  if (!startGPS()) return;
  nav = true; arrived = false; isOff = false; offCount = 0; milestones = {};
  navTrackId = track ? track.id : null;
  navStartT = Date.now(); freeD = 0; freeRef = null;
  if (track && done && track.total - done.along < 25) { resetDone(); setDone(0, true); } // trace déjà finie : on repart de zéro
  document.body.classList.add('nav'); document.body.classList.toggle('free', !track); toggleMore(false, true);
  setFollow(true);
  unlockAudio(); enableCompass(); keepAwake();
  say(me ? (profile === 'trekking' ? pick(['C\'est parti, bonne route !', 'En route, bonne balade à vélo !']) : pick(['C\'est parti, bonne balade !', 'En route, bonne rando !'])) : 'C\'est parti. Je cherche le signal GPS.');
  if (actState === 'idle') {
    if (store.get('autoRec') === '1') startActivity();
    else { const n = +(store.get('recHint') || 0); if (n < 3) { store.set('recHint', n + 1); setTimeout(() => toast('Touche ● pour enregistrer ta sortie', 4000), 1500); } }
  }
  applyEco(); ecoWake(10000);
  if (me) { if (track) { progress = project(track, me, true); updateDone(me); } guidance(); navCamera(800); }
  else setBanner('gps', '', 'Recherche du signal GPS…', 'gps');
  updateStats(); bgTrack();
}
function stopNav() {
  stopPip(); nav = false; document.body.classList.remove('nav', 'free'); applyEco(); toggleNavMore(false, true);
  stopSim(); clearRejoin(); isOff = false;
  ttsCancel();
  setSrc('turn', EMPTY);
  map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
  if (!recording) stopGPS();
  setFollow(false); bgTrack();
}
$('btnNav').onclick = () => track ? startNav() : openDest();
// trace ouverte : accès aux autres façons de partir (lieu, boucle, tracé, parcours balisés)
$('btnNew').onclick = openDest;
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
  bannerIcon = icon; pipSoon();
  if (typeof ecoCheck === 'function' && eco === 'max') ecoCheck();
}

// =====================================================================
// Fenêtre réduite (image dans l'image) : comme une vidéo YouTube, le guidage reste visible
// dans un petit cadre pendant qu'on utilise une autre appli. Le cadre est une vidéo
// fabriquée à partir d'un dessin, mis à jour à chaque position.
// =====================================================================
var bannerIcon = 'gps';
var pip = { cv: null, video: null, on: false, imgs: new Map(), t: 0, timer: 0 };
const pipOK = !!(document.pictureInPictureEnabled && window.HTMLCanvasElement && HTMLCanvasElement.prototype.captureStream);
if (!pipOK) document.body.classList.add('nopip');
function pipIcon(icon) { // image de la flèche (sans rotation : elle est faite au dessin)
  const base = typeof icon === 'object' ? { rot: 0 } : icon, key = JSON.stringify(base);
  let im = pip.imgs.get(key);
  if (!im) {
    const svg = arrowSVG(base).replace(/ style="[^"]*"/, '').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" ');
    im = new Image(); im.onload = () => pipSoon(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    pip.imgs.set(key, im);
  }
  return im;
}
function wrapText(ctx, txt, maxW, maxLines) {
  const words = txt.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
  return lines;
}
// La carte de la fenêtre réduite est dessinée à la main à partir des tuiles (la carte principale
// ne se redessine plus quand l'appli est en arrière-plan) : centrée sur toi, sens de la marche vers le haut.
const pipTiles = new Map();
function pipTile(z, x, y, layer) {
  const L = layer || (LAYERS[layerIdx].vector ? LAYERS[0] : LAYERS[layerIdx]);
  const n = 2 ** z; x = ((x % n) + n) % n;
  const key = L.id + '/' + z + '/' + x + '/' + y;
  let im = pipTiles.get(key);
  if (!im) {
    const tpl = L.tiles[(x + y) % L.tiles.length];
    im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { pipSoon(); if (previewRedraw) { clearTimeout(pipTile.t); pipTile.t = setTimeout(() => previewRedraw && previewRedraw(), 60); } }; im.onerror = () => { im.bad = true; };
    im.src = tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    pipTiles.set(key, im);
    if (pipTiles.size > 300) pipTiles.delete(pipTiles.keys().next().value);
  }
  return im.complete && im.naturalWidth && !im.bad ? im : null;
}
const wx = (lon, z) => (lon + 180) / 360 * 256 * 2 ** z;
const wy = (lat, z) => { const r = rad(lat); return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 256 * 2 ** z; };
// Fond épuré (style « Positron » d'OpenFreeMap, sans les noms de rues) rendu par une petite carte
// cachée : on la redessine à la demande, ce qui marche aussi quand l'appli est en arrière-plan.
// Sans elle (hors connexion jamais chargée), on retombe sur les tuiles du fond choisi.
const PIP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
let pipMap = null, pipMapOk = false, pipMapH = 0;
async function ensurePipMap(W, H) {
  if (pipMap) return;
  pipMapH = H;
  const div = document.createElement('div');
  div.style.cssText = `position:fixed;left:-10000px;top:0;width:${W}px;height:${H}px;pointer-events:none;`;
  document.body.appendChild(div);
  let style = null;
  try { style = await (await fetch(PIP_STYLE)).json(); store.set('pipStyle', JSON.stringify(style)); }
  catch { try { style = JSON.parse(store.get('pipStyle')); } catch {} }
  if (!style) return;
  delete style.sources.ne2_shaded;
  style.layers = style.layers.filter(l => l.source !== 'ne2_shaded' && !/^boundary/.test(l.id) &&
    (l.type !== 'symbol' || /^label_(village|town|city)/.test(l.id)));
  // chemins et petites routes un peu plus visibles : c'est ce qu'on suit à pied ou à vélo
  for (const l of style.layers) {
    if (l.id === 'highway_path') l.paint = Object.assign({}, l.paint, { 'line-color': '#B9B2A6', 'line-width': 2.2, 'line-dasharray': [2, 1.2] });
    if (l.id === 'highway_minor') l.paint = Object.assign({}, l.paint, { 'line-color': '#FFFFFF' });
  }
  try {
    pipMap = new maplibregl.Map({ container: div, style, interactive: false, attributionControl: false, preserveDrawingBuffer: true, pixelRatio: 1, fadeDuration: 0, center: me ? [me.lon, me.lat] : map.getCenter(), zoom: 15 });
    pipMap.on('load', () => { pipMapOk = true; pipSoon(); });
    pipMap.on('data', () => pipSoon());
    pipMap.on('error', () => {});
  } catch { pipMap = null; }
}
function drawPipMap(ctx, W, top, H) {
  if (pipMapOk && me) return drawPipVector(ctx, W, top, H);
  const L = LAYERS[layerIdx].vector ? LAYERS[0] : LAYERS[layerIdx];
  const sp = speedEma || 1.2, z = Math.min(L.max, sp > 7 ? 15 : 16);
  const cx = W / 2, cy = top + H * 0.68; // ta position, un peu en bas pour voir devant
  ctx.save();
  ctx.beginPath(); ctx.rect(0, top, W, H); ctx.clip();
  ctx.fillStyle = cssVar('--mapbg') || '#E4E9DC'; ctx.fillRect(0, top, W, H);
  if (!me) { ctx.restore(); return; }
  const mx = wx(me.lon, z), my = wy(me.lat, z), R = Math.hypot(W, H) * 0.8;
  const h = heading != null ? heading : 0;
  ctx.translate(cx, cy); ctx.rotate(-rad(h));
  // tuiles autour de toi
  const t0x = Math.floor((mx - R) / 256), t1x = Math.floor((mx + R) / 256), t0y = Math.floor((my - R) / 256), t1y = Math.floor((my + R) / 256);
  for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) {
    const im = pipTile(z, tx, ty);
    if (im) ctx.drawImage(im, tx * 256 - mx, ty * 256 - my, 256.5, 256.5);
  }
  ctx.restore();
  pipOverlay(ctx, W, top, H, z, cx, cy);
}
function pipOverlay(ctx, W, top, H, z, cx, cy) { // trace, retour et flèche par-dessus le fond
  const mx = wx(me.lon, z), my = wy(me.lat, z), R = Math.hypot(W, H) * 0.8, h = heading != null ? heading : 0;
  ctx.save(); ctx.beginPath(); ctx.rect(0, top, W, H); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(-rad(h));
  const line = (pts, color, width, dash, from = 0, to = pts.length) => {
    ctx.beginPath(); let started = false;
    for (let k = from; k < to; k++) {
      const x = wx(pts[k].lon, z) - mx, y = wy(pts[k].lat, z) - my;
      if (Math.abs(x) > R * 2 || Math.abs(y) > R * 2) { started = false; continue; }
      started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true;
    }
    ctx.setLineDash(dash || []); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
  };
  if (track) {
    const cut = done ? Math.min(track.pts.length, pointAt(track, done.along).i + 2) : 0;
    if (cut > 1) line(track.pts, COL.done, 6, null, 0, cut);
    line(track.pts, '#fff', 10, null, Math.max(0, cut - 1)); line(track.pts, COL.track, 6, null, Math.max(0, cut - 1));
  }
  if (rejoin) { line(rejoin.pts, '#fff', 8, null); line(rejoin.pts, COL.me, 5, [2, 10]); }
  ctx.restore();
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(30,111,217,.18)'; ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(12, 13); ctx.lineTo(0, 6); ctx.lineTo(-12, 13); ctx.closePath();
  ctx.fillStyle = COL.me; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawPipVector(ctx, W, top, H) {
  const sp = speedEma || 1.2, z = sp > 7 ? 15 : 16; // même échelle que les tuiles de 256 px
  const cy = top + H * 0.68, mh = pipMapH;
  pipMap.jumpTo({ center: [me.lon, me.lat], zoom: z - 1, bearing: heading != null ? heading : 0 });
  pipMap.redraw(); // dessin immédiat, sans attendre l'écran
  ctx.save(); ctx.beginPath(); ctx.rect(0, top, W, H); ctx.clip();
  ctx.fillStyle = '#F2F2EF'; ctx.fillRect(0, top, W, H);
  try { ctx.drawImage(pipMap.getCanvas(), 0, cy - mh / 2, W, mh); } catch {}
  ctx.restore();
  pipOverlay(ctx, W, top, H, z, W / 2, cy);
}
function drawPip() {
  const c = pip.cv; if (!c) return;
  const ctx = c.getContext('2d'), W = c.width, H = c.height, TOP = 92, BOT = 58;
  drawPipMap(ctx, W, TOP, H - TOP - BOT);
  // bandeau du haut : flèche, distance et consigne
  const tone = $('navTop').dataset.tone;
  ctx.fillStyle = cssVar({ off: '--warn', rejoin: '--me', gps: '--hud', done: '--ok' }[tone] || '--go') || '#2F5E45';
  ctx.fillRect(0, 0, W, TOP);
  const im = pipIcon(bannerIcon), S = 66;
  if (im.complete && im.naturalWidth) {
    ctx.save(); ctx.translate(14 + S / 2, TOP / 2);
    if (typeof bannerIcon === 'object') ctx.rotate(rad(bannerIcon.rot || 0));
    ctx.drawImage(im, -S / 2, -S / 2, S, S); ctx.restore();
  }
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
  const dist = $('ntDist').textContent, txt = $('ntTxt').textContent, X = 92, TW = W - X - 10;
  if (dist) {
    ctx.font = '700 38px system-ui, sans-serif'; ctx.fillText(dist, X, 44);
    ctx.font = '600 21px system-ui, sans-serif'; ctx.fillText(wrapText(ctx, txt, TW, 1)[0] || '', X, 74);
  } else {
    ctx.font = '600 24px system-ui, sans-serif';
    wrapText(ctx, txt, TW, 2).forEach((l, k, a) => ctx.fillText(l, X, (a.length > 1 ? 40 : 54) + k * 30));
  }
  // bandeau du bas : arrivée et distance restante (ou distance / durée en balade libre)
  ctx.fillStyle = cssVar('--hud') || '#1F2B25'; ctx.fillRect(0, H - BOT, W, BOT);
  ctx.fillStyle = '#fff'; ctx.font = '700 25px system-ui, sans-serif'; ctx.textAlign = 'center';
  const a = $('nbEta').textContent, b = $('nbRem').textContent, l2 = $('nbL2').textContent;
  ctx.fillText(track ? `${tr('Arrivée')} ${a}  ·  ${b}` : `${b} ${l2}  ·  ${$('nbUp').textContent}`, W / 2, H - 20);
  ctx.textAlign = 'left';
}
// dessin groupé (au plus 4 fois par seconde), après la mise à jour des chiffres
function pipSoon() {
  if (!pip || !pip.on || pip.timer) return;
  pip.timer = setTimeout(() => { pip.timer = 0; pip.t = Date.now(); drawPip(); }, Math.max(0, 250 - (Date.now() - pip.t)));
}
async function startPip() {
  if (!pipOK) { toast('La fenêtre réduite n\'est pas disponible sur ce navigateur.'); return; }
  try {
    if (!pip.cv) {
      pip.cv = document.createElement('canvas'); pip.cv.width = 360; pip.cv.height = 480;
      const v = pip.video = document.createElement('video');
      v.id = 'pipVideo'; v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
      v.srcObject = pip.cv.captureStream(4);
      v.addEventListener('leavepictureinpicture', () => { pip.on = false; clearInterval(pip.tick); });
      document.body.appendChild(v);
    }
    ensurePipMap(360, 460);
    pip.on = true; drawPip();
    await pip.video.play();
    await pip.video.requestPictureInPicture();
    clearInterval(pip.tick);
    pip.tick = setInterval(() => { updateStats(); pipSoon(); }, 1000); // le flux doit recevoir des images régulièrement
  } catch (e) {
    pip.on = false;
    toast('Impossible d\'ouvrir la fenêtre réduite' + (e && e.message ? ' : ' + e.message : ''), 4000);
  }
}
function stopPip() {
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  pip.on = false; clearInterval(pip.tick);
}
$('btnPip').onclick = () => document.pictureInPictureElement ? stopPip() : startPip();

let milestones = {};
let lastTurnKey = '';
const spoken = new Map();
var nextDist = Infinity; // distance jusqu'au prochain virage (pour l'économie de batterie)
function guidance() {
  joinPickUI();
  if (!nav) return;
  nextDist = Infinity;
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
  nextDist = next.arrive ? Infinity : dTo;
  const info = next.arrive ? (rejoin ? { txt: 'Rejoignez la trace', icon: 'join' } : { txt: 'Arrivée', icon: 'flag' }) : turnInfo(next.ang);
  const tone = rejoin ? 'rejoin' : 'ok';
  const sub = rejoin ? `Retour à la trace · ${fmtDist(rejoinProg.remain)} par le chemin` : '';
  if (dTo > 1200) setBanner(tone, fmtDist(dTo), track.route ? 'Continuez sur l\'itinéraire' : 'Continuez sur la trace', 0, (next.arrive ? '' : `puis ${lc(info.txt)}`) + (sub ? (next.arrive ? '' : ' · ') + sub : ''));
  else setBanner(tone, fmtDist(dTo), info.txt, info.icon, sub);

  const key = path.id + ':' + Math.round(next.along);
  if (key !== lastTurnKey) {
    // virage passé : la carte reste encore 20 s, le temps de vérifier qu'on part dans la bonne direction
    if (lastTurnKey && nav && eco === 'max') ecoWake(20000);
    // longue ligne droite après un virage : on rassure (« Continue tout droit pendant 2 kilomètres »)
    if (lastTurnKey && nav && !next.arrive && dTo > 700 && spoken.get(lastTurnKey) === 2) {
      const d = speakDist(dTo);
      setTimeout(() => say(pick(rejoin ? [`Continue vers la trace pendant ${d}.`] : track.route
        ? [`Continue tout droit pendant ${d}.`, `Ensuite, tout droit pendant ${d}.`]
        : [`Suis la trace pendant ${d}.`, `Ensuite, tout droit sur la trace pendant ${d}.`]), true), 1800);
    }
    lastTurnKey = key; setSrc('turn', next.arrive ? EMPTY : pointFeature(pointAt(path, next.along))); }

  // annonces vocales : une à l'approche, une au moment de tourner
  const s = Math.max(speedEma || 1.2, 1);
  const far = clamp(s * 30, 60, 400), near = clamp(s * 7, 15, 60);
  const lvl = spoken.get(key) || 0;
  const what = next.arrive ? (rejoin ? 'tu rejoindras la trace' : 'tu seras arrivé') : spokenTurn(info.txt);
  // virage suivant tout proche : on annonce les deux d'un coup, comme un copilote
  const after = !next.arrive && path.turns.find(t => t.along > next.along + 3);
  // (seulement un vrai virage, pas une courbe, et vraiment proche : sinon ça devient bavard dans les lacets)
  const chain = after && !after.arrive && Math.abs(after.ang) >= 60 && after.along - next.along < Math.max(near * 2.5, 40);
  const then = chain ? `, puis tout de suite ${spokenTurn(turnInfo(after.ang).txt).replace(/^tourne |^prends /, '')}` : '';
  const afterKey = chain ? path.id + ':' + Math.round(after.along) : null;
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  if (lvl < 1 && dTo <= far && dTo > near * 1.6) { say(`Dans ${speakDist(dTo)}, ${what}${then}.`); spoken.set(key, 1); }
  else if (lvl === 3 && dTo <= near) { if (!next.arrive) say(cap(spokenTurn(info.txt).replace(/^tourne |^prends /, '')) + '.', true); spoken.set(key, 2); }
  else if (lvl < 2 && dTo <= near) {
    if (!next.arrive) { const t = spokenTurn(info.txt); say((lvl === 1 && Math.random() < .35 ? pick(['Maintenant, ', 'C\'est ici, ']) + t : cap(t)) + then + '.'); }
    spoken.set(key, 2);
    // le virage enchaîné a déjà été annoncé : au moment de le prendre, juste « À droite. »
    if (afterKey && !spoken.get(afterKey)) spoken.set(afterKey, 3);
  }
  // repères de progression sur une trace : mi-parcours et dernier kilomètre
  if (!rejoin && !track.route && progress && track.total > 4000) {
    const ratio = 1 - progress.remain / track.total;
    if (!milestones.half && ratio >= .5 && ratio < .6) { milestones.half = 1; say(pick(['Mi-parcours, bravo !', 'Tu as fait la moitié du parcours !']) + ` Encore ${speakDist(progress.remain)}.`, true); }
    if (!milestones.last && progress.remain < 1000 && progress.remain > 600) { milestones.last = 1; say(pick(['Plus qu\'un kilomètre !', 'Dernier kilomètre, courage !']), true); }
  }
}

// ---------- voix, son, vibration ----------
// Son (voix + bips) et vibrations : réglables séparément, dans les réglages et en navigation
let voiceOn = store.get('voice') !== '0', vibOn = store.get('vib') !== '0';
function syncAlertUI() {
  $('btnVoice').classList.toggle('muted', !voiceOn);
  $('btnVibFab').classList.toggle('muted', !vibOn);
  $('optVoice').checked = voiceOn; $('optVib').checked = vibOn;
  $('rowVStyle').hidden = !voiceOn;
  $('npVoice').classList.toggle('off', !voiceOn); $('npVoice').textContent = voiceOn ? 'Son activé' : 'Son coupé';
  $('npVib').classList.toggle('off', !vibOn); $('npVib').textContent = vibOn ? 'Vibrations activées' : 'Vibrations coupées';
}
function setVoice(on) {
  voiceOn = on; store.set('voice', on ? '1' : '0'); syncAlertUI();
  if (on) say('Guidage vocal activé'); else { ttsCancel(); toast('Son coupé'); }
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
const voiceRate = 1, voicePitch = 1.02;
const frVoices = () => { try { return speechSynthesis.getVoices().filter(v => v.lang.slice(0, 2).toLowerCase() === LANG); } catch { return []; } };
// la plus naturelle d'abord (voix « neurales » quand le téléphone en a), en France, et toujours utilisable hors ligne
function pickVoice() {
  const vs = frVoices(), main = { fr: /fr[-_]FR/i, en: US ? /en[-_]US/i : /en[-_]GB/i, es: /es[-_]ES/i }[LANG] || /./, fr = vs.filter(v => main.test(v.lang));
  const nice = v => /neural|natural|enhanced|premium|wavenet|studio|amélior|naturel/i.test(v.name);
  return fr.find(v => nice(v) && v.localService) || fr.find(v => v.localService && v.default) || fr.find(v => v.localService)
    || fr.find(nice) || fr[0] || vs[0] || null;
}
// Plusieurs Pisteo ouverts (onglet Chrome + appli installée) : seul celui qu'on regarde a le droit de parler.
// Une copie oubliée en navigation dans un autre onglet se tait, et sa navigation est arrêtée.
let otherActive = false;
try {
  const bc = new BroadcastChannel('pisteo');
  const hello = () => { if (document.visibilityState === 'visible') { otherActive = false; bc.postMessage('active'); } };
  bc.onmessage = e => {
    if (e.data !== 'active' || document.visibilityState === 'visible') return;
    otherActive = true;
    ttsCancel();
    if (nav && actState !== 'on' && actState !== 'paused') stopNav(); // pas de sortie enregistrée en cours : on arrête tout
  };
  document.addEventListener('visibilitychange', hello); window.addEventListener('focus', hello); hello();
} catch { /* navigateur sans BroadcastChannel */ }
// ---------- voix enregistrée « Jessica » : les phrases sont assemblées à partir de fragments audio ----------
// (dossier voice/ : index.json associe chaque fragment de texte à un petit mp3 ; voix de synthèse du téléphone en secours)
let voiceLib = null;
const voiceStyle = () => LANG === 'fr' && store.get('vstyle') || 'system'; // voix du téléphone par défaut, Jessica en option
const vNorm = t => t.normalize('NFC').toLowerCase().replace(/[’]/g, "'").replace(/[^\p{L}\p{N}' -]+/gu, ' ').trim().split(/\s+/).join(' ');
fetch('voice/index.json?v=' + APP_VERSION).then(r => r.ok ? r.json() : null).then(j => {
  voiceLib = j;
  // tous les fragments en cache pour le hors ligne, sans gêner le démarrage
  if (j && 'caches' in window && voiceStyle() === 'pisteo') setTimeout(() => caches.open('voice-v1').then(c => c.addAll([...new Set(Object.values(j))].map(n => `voice/${n}.mp3`))).catch(() => {}), 8000);
}).catch(() => {});
function voiceParts(text) {
  if (!voiceLib) return null;
  const n = vNorm(text); if (!n) return null;
  if (voiceLib['short ' + n]) return [voiceLib['short ' + n]]; // « À droite. » seul : intonation de fin de phrase
  const parts = [], w = n.split(' ');
  for (let i = 0; i < w.length;) {
    let j = Math.min(w.length, i + 24), hit = null;
    for (; j > i; j--) { const k = w.slice(i, j).join(' '); if (voiceLib[k]) { hit = voiceLib[k]; break; } }
    if (!hit) return null; // un morceau inconnu : la voix du téléphone prendra le relais
    parts.push(hit); i = j;
  }
  return parts;
}
const voiceBuf = new Map();
let voiceSrc = [], voiceEnd = 0, voiceSeq = 0;
async function voiceBuffer(n) {
  if (voiceBuf.has(n)) return voiceBuf.get(n);
  const b = await audioCtx.decodeAudioData(await (await fetch(`voice/${n}.mp3`)).arrayBuffer());
  voiceBuf.set(n, b); return b;
}
async function playParts(parts, queue) {
  unlockAudio(); if (!audioCtx) throw new Error('audio');
  const seq = ++voiceSeq;
  if (!queue) { voiceSrc.forEach(s => { try { s.stop(); } catch {} }); voiceSrc = []; voiceEnd = 0; ttsCancel(); }
  const bufs = await Promise.all(parts.map(voiceBuffer));
  if (!queue && seq !== voiceSeq) return; // une phrase plus récente a pris la place
  let t = Math.max(audioCtx.currentTime + 0.05, queue ? voiceEnd + 0.25 : 0);
  bufs.forEach((b, i) => {
    const s = audioCtx.createBufferSource(); s.buffer = b; s.connect(audioCtx.destination); s.start(t);
    s.onended = () => { voiceSrc = voiceSrc.filter(x => x !== s); };
    voiceSrc.push(s); t += b.duration + (i < bufs.length - 1 ? 0.07 : 0);
  });
  voiceEnd = t;
}
// queue : la phrase attend la fin de celle en cours au lieu de la couper (pour enchaîner sans hachage)
function say(text, queue = false) {
  if (!voiceOn || otherActive) return;
  if (LANG !== 'fr') { sayTTS(tr(text), queue); return; } // voix enregistrée : en français seulement
  if (voiceStyle() === 'pisteo') {
    const parts = voiceParts(text);
    if (parts) { playParts(parts, queue).catch(() => sayTTS(text, queue)); return; }
  }
  sayTTS(text, queue);
}
function ttsCancel() { try { if (AND) AND.stopSpeaking(); else speechSynthesis.cancel(); } catch {} }
function sayTTS(text, queue = false) {
  if (AND) { try { AND.speak(String(text), LOC, voiceRate, voicePitch, !!queue); } catch {} return; }
  if (!('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LOC; u.rate = voiceRate; u.pitch = voicePitch;
    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; }
    if (!queue && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* synthèse vocale indisponible */ }
}
let audioCtx;
function unlockAudio() { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch {} }
function beep() {
  if (!voiceOn || otherActive || !audioCtx) return;
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
// à vélo, deux façons de calculer : rapide (profil BRouter trekking, proposé en premier)
// et balade (bords de l'eau : profil personnalisé balade.brf, envoyé à BRouter),
// proposée seulement quand elle passe vraiment ailleurs
const BIKE = {
  fast: { name: 'Rapide', col: '#e8742a' },
  river: { name: 'Balade', col: '#1e7fd6' },
};
const bikeStyle = 'fast';
const styleName = s => BIKE[s] ? BIKE[s].name.toLowerCase() : '';
let riverId = null, riverP = null;
function riverProfile(renew) {
  if (renew) { riverId = null; riverP = null; }
  if (riverId) return Promise.resolve(riverId);
  riverP = riverP || (async () => {
    const t = await fetch('balade.brf?v=' + APP_VERSION).then(r => { if (!r.ok) throw new Error('profil'); return r.text(); });
    const j = await fetch('https://brouter.de/brouter/profile', { method: 'POST', body: t }).then(r => r.json());
    if (!j.profileid) { const e = new Error(j.error || 'profil refusé'); e.server = true; throw e; }
    return (riverId = j.profileid);
  })().catch(e => { riverP = null; throw e; });
  return riverP;
}
async function brProf(style) {
  if (profile !== 'trekking') return profile;
  return style === 'river' ? riverProfile() : 'trekking';
}
// requête BRouter ; un profil personnalisé expiré sur le serveur est renvoyé une fois
async function brFetch(lonlats, style, signal) {
  for (let k = 0; ; k++) {
    const prof = await brProf(style);
    const r = await fetch(`https://brouter.de/brouter?lonlats=${lonlats}&profile=${prof}&alternativeidx=0&format=geojson`, { signal });
    if (r.ok) return r.json();
    const m = (await r.text().catch(() => '')).slice(0, 200);
    if (k === 0 && /^custom_/.test(prof)) { await riverProfile(true); continue; }
    const e = new Error(m || 'HTTP ' + r.status); e.server = true; throw e;
  }
}
// calcule les variantes vélo (la préférée d'abord) et ne garde que celles vraiment différentes
async function bikeVariants(fn) {
  const order = [bikeStyle, ...Object.keys(BIKE).filter(s => s !== bikeStyle)], jobs = [];
  for (const s of order) { jobs.push(fn(s).then(v => ({ v }), e => ({ e }))); await new Promise(r => setTimeout(r, 250)); }
  const res = await Promise.all(jobs), kept = {}, P = x => x.pts || x;
  let err = null;
  res.forEach((r, i) => {
    if (r.e) { err = err || r.e; return; }
    if (Object.values(kept).every(k => routesDiffer(P(k), P(r.v)))) kept[order[i]] = r.v;
  });
  return { kept, err };
}
// deux tracés sont-ils vraiment différents ? (longueur, ou une bonne part de l'un loin de l'autre)
function routesDiffer(a, b) {
  const pa = makePath(a, ''), pb = makePath(b, '');
  // proches = même longueur à 12 % près et presque tout le tracé à moins de 250 m de l'autre (dans les deux sens)
  if (Math.abs(pa.total - pb.total) > Math.max(800, 0.12 * Math.min(pa.total, pb.total))) return true;
  const far = (x, py) => {
    const step = Math.max(1, Math.floor(x.length / 150)); let off = 0, n = 0;
    for (let i = 0; i < x.length; i += step) { const pr = project(py, x[i], true); n++; if (!pr || pr.dist > 250) off++; }
    return n ? off / n : 0;
  };
  return Math.max(far(a, pb), far(b, pa)) > 0.25;
}
// point du tracé a le plus éloigné du tracé b : là où poser son étiquette
function farPoint(a, b) {
  if (!b) return a[a.length >> 1];
  const pb = makePath(b, ''), step = Math.max(1, Math.floor(a.length / 200));
  let best = a[a.length >> 1], bd = -1;
  for (let i = 0; i < a.length; i += step) { const pr = project(pb, a[i], true); if (pr && pr.dist > bd) { bd = pr.dist; best = a[i]; } }
  return best;
}
// étiquettes « Tranquille · 9,1 km » posées sur la carte, à toucher pour choisir
let rcMks = [];
function routeLabels(list) {
  rcMks.forEach(m => m.remove()); rcMks = [];
  for (const l of list) {
    const el = document.createElement('button');
    el.className = 'rc-lbl' + (l.on ? ' on' : ''); el.style.setProperty('--c', l.col); el.textContent = l.text;
    el.onclick = ev => { ev.stopPropagation(); l.run && l.run(); };
    rcMks.push(new maplibregl.Marker({ element: el }).setLngLat([l.pt.lon, l.pt.lat]).addTo(map));
  }
}
function fitBoth(list, bottom) {
  setTimeout(() => { try { map.fitBounds(boundsOf(list), { padding: { top: 90, bottom: bottom() + 30, left: 40, right: 70 }, bearing: 0, pitch: 0, duration: 600 }); } catch {} }, 80);
}
$('thr').value = String(threshold);
$('thr').onchange = e => {
  threshold = +e.target.value; store.set('thr', threshold);
  if (!threshold && isOff) { isOff = false; offCount = 0; clearRejoin(); guidance(); }
  toast(threshold ? `Alerte au-delà de ${fmtM(threshold)} de la trace` : 'Alerte hors trace désactivée');
};
const thrRef = () => threshold || 50; // distance « sur la trace » quand l'alerte est coupée
$('prof').value = profile;

// ---------- thème clair / sombre / automatique ----------
function refreshColors() {
  Object.assign(COL, { track: cssVar('--track'), done: cssVar('--done'), me: cssVar('--me'), rec: cssVar('--rec') });
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = cssVar('--hud');
  ready.then(() => {
    if (map.getLayer('bg')) map.setPaintProperty('bg', 'background-color', cssVar('--mapbg'));
    if (map.getLayer('rec')) map.setPaintProperty('rec', 'line-color', COL.rec);
    if (map.getLayer('rejoin')) map.setPaintProperty('rejoin', 'line-color', COL.me);
    setDone(lastFrac < 0 ? 0 : lastFrac, true);
  });
  drawProfile(); navMoreT = 0; updateNavMore();
}
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  refreshColors();
}
$('optTheme').value = store.get('theme') || 'auto';
$('optLang').value = store.get('lang') || '';
$('optLang').onchange = e => { store.set('lang', e.target.value); location.reload(); };
$('optUnits').value = store.get('units') || '';
$('optUnits').onchange = e => { store.set('units', e.target.value); location.reload(); };
if (IMP) { // libellés en pieds / mph
  document.querySelector('#speed span').textContent = 'mph';
  $('thr').querySelectorAll('option').forEach(o => { if (+o.value) o.textContent = Math.round(o.value * FT / 10) * 10 + ' ft'; });
}
$('optTheme').onchange = e => { store.set('theme', e.target.value); applyTheme(e.target.value); };
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshColors); } catch {}
$('autoRec').checked = store.get('autoRec') === '1';
$('autoRec').onchange = e => store.set('autoRec', e.target.checked ? '1' : '0');
function setProfile(p, quiet) {
  profile = p; store.set('profile', p);
  $('prof').value = p; $('destProf').value = p;
  $('npMode').textContent = p === 'trekking' ? 'À vélo' : 'À pied';
  if (!quiet) toast(p === 'trekking' ? 'Mode vélo : itinéraires et temps estimés pour le vélo' : 'Mode à pied : itinéraires et temps estimés pour la marche', 3500);
  // un retour à la trace (ou un trajet vers un lieu) déjà calculé est refait pour le nouveau mode
  if (!quiet && nav && track && me && (rejoin || track.route)) requestRejoin(true);
  updateStats();
}
$('prof').onchange = e => setProfile(e.target.value);
// ---------- taille du bandeau d'indications en navigation ----------
const BANNER_LBL = { normal: 'Indications : grandes', compact: 'Indications : réduites', hidden: 'Indications : masquées' };
function setBannerSize(v, quiet) {
  if (!BANNER_LBL[v]) v = 'normal';
  store.set('banner', v); document.body.dataset.banner = v;
  $('optBanner').value = v; $('npBanner').textContent = BANNER_LBL[v];
  if (!quiet && v === 'hidden') toast('Indications masquées · elles reviennent hors trace', 3500);
  if (nav && follow) setTimeout(() => navCamera(400), 50);
}
$('optBanner').onchange = e => setBannerSize(e.target.value);

// ---------- économie de batterie (écran noir entre les virages + carte allégée) ----------
var eco = store.get('eco') === 'max' ? 'max' : 'off', ecoWakeUntil = 0, ecoThemeSet = false;
// carte visible : à l'approche d'un virage, dès qu'on s'écarte de la trace (avant même l'alerte), hors trace,
// pendant un retour calculé, à l'arrivée
function ecoNear() {
  if (nextDist < 220 || arrived || routing) return true;
  if (rejoin) return !!rejoin.straight; // retour calculé : écran noir entre ses virages ; ligne droite : carte visible
  return isOff || !!(track && progress && progress.dist > 25);
}
function setEco(v, quiet) {
  eco = v === 'max' ? 'max' : 'off'; store.set('eco', eco);
  const on = eco === 'max';
  $('optEco').checked = on;
  $('npEco').textContent = on ? 'Économie de batterie' : 'Économie de batterie'; $('npEco').classList.toggle('off', !on);
  $('btnEcoFab').classList.toggle('on', on);
  if (!quiet) toast(on ? 'Économie de batterie activée : écran noir entre les virages' : 'Économie de batterie désactivée', 3000);
  applyEco();
}
// activer : on explique d'abord ce que ça fait (sauf si déjà vu)
function askEco() {
  if (eco === 'max') { setEco('off'); return; }
  if (store.get('ecoSeen') === '1') { setEco('max'); return; }
  $('ecoInfo').hidden = false;
}
$('eiOn').onclick = () => { store.set('ecoSeen', '1'); $('ecoInfo').hidden = true; setEco('max'); };
$('eiOff').onclick = $('eiClose').onclick = () => { $('ecoInfo').hidden = true; setEco(eco, true); };
$('ecoInfo').onclick = e => { if (e.target === $('ecoInfo')) { $('ecoInfo').hidden = true; setEco(eco, true); } };
$('ecoInfoLink').onclick = e => { e.preventDefault(); e.stopPropagation(); $('ecoInfo').hidden = false; };
function applyEco() {
  const on = nav && eco !== 'off';
  try { map.setPixelRatio(on ? Math.min(window.devicePixelRatio || 1, 1.5) : null); } catch {}
  ready.then(() => { for (const id of ofmLayerIds) { const l = map.getLayer(id); if (l && l.type === 'fill-extrusion') map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible'); } });
  // thème sombre pendant la navigation (moins gourmand sur écran OLED)
  if (on && !ecoThemeSet && document.documentElement.dataset.theme !== 'dark') { ecoThemeSet = true; document.documentElement.dataset.theme = 'dark'; refreshColors(); }
  else if (!on && ecoThemeSet) { ecoThemeSet = false; applyTheme(store.get('theme') || 'auto'); }
  camT = 0; if (nav && follow) navCamera(0);
  ecoCheck();
}
// écran noir : affiché en mode maximum, sauf à l'approche d'un virage, hors trace, ou juste après un toucher
function ecoCheck() {
  const show = nav && eco === 'max' && Date.now() > ecoWakeUntil && !ecoNear() && $('navMore').hidden && $('finish').hidden;
  const el = $('ecoBlack'), was = !el.hidden;
  el.hidden = !show;
  if (show) {
    const m = Math.floor(Date.now() / 60000); // léger décalage chaque minute, pour ne pas marquer l'écran
    el.firstElementChild.style.transform = `translate(${(m % 5 - 2) * 6}px, ${(Math.floor(m / 5) % 5 - 2) * 10}px)`;
    $('ebIcon').innerHTML = $('ntIcon').innerHTML; $('ebDist').textContent = $('ntDist').textContent; $('ebTxt').textContent = $('ntTxt').textContent;
    $('ebRem').textContent = track ? `${$('nbRem').textContent} restant · arrivée ${$('nbEta').textContent}` : `${$('nbRem').textContent} ${$('nbL2').textContent} · ${$('nbUp').textContent}`;
  } else if (was && nav && follow) { camT = 0; navCamera(0); }
}
function ecoWake(ms) { ecoWakeUntil = Date.now() + ms; ecoCheck(); setTimeout(ecoCheck, ms + 100); }
$('ecoBlack').onclick = () => ecoWake(15000);
$('optEco').onchange = e => { if (e.target.checked) { e.target.checked = false; askEco(); } else setEco('off'); };
$('npEco').onclick = askEco;
$('btnEcoFab').onclick = askEco;
setEco(eco, true);
setInterval(() => { if (nav && eco === 'max') ecoCheck(); }, 2000);
$('npBanner').onclick = () => setBannerSize({ normal: 'compact', compact: 'hidden', hidden: 'normal' }[store.get('banner') || 'normal']);
$('navTop').onclick = () => { if (nav) setBannerSize((store.get('banner') || 'normal') === 'normal' ? 'compact' : 'normal'); };
setBannerSize(store.get('banner') || 'normal', true);
try {
  new ResizeObserver(() => { const h = $('navTop').offsetHeight; document.documentElement.style.setProperty('--nt-h', h ? h + 'px' : 'env(safe-area-inset-top, 0px)'); }).observe($('navTop'));
} catch {}

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
    if (threshold) { alertOff(); say(pick(['Oups, tu sors de la trace. Je cherche le chemin pour la rejoindre.', 'Attention, tu t\'éloignes de la trace. Je calcule le retour.'])); }
    requestRejoin(false);
  } else if (isOff && progress.dist < thr * 0.7 && rightPart()) {
    isOff = false; offCount = 0; clearRejoin();
    vibrate(150); say(pick(['Te revoilà sur la trace !', 'Parfait, tu es de nouveau sur la trace.'])); toast('De retour sur la trace');
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
// Où rejoindre la trace : devant ce qui a déjà été parcouru (jamais en arrière), en évitant de
// sauter une grosse partie du parcours — chaque mètre de trace sauté compte pour 20 cm de détour (on rejoint plutôt devant que là où on est sorti).
// Si la trace n'est pas commencée, on vise son début (sauter du parcours y coûte bien plus cher).
const skipW = () => done ? 0.2 : joinNear ? 0 : 2;
// choix « Départ / Plus proche », affiché tant qu'on rejoint une trace pas encore commencée
function joinPickUI() {
  const show = !!(nav && track && !track.route && !done && (rejoin || routing) && track.total > 1000);
  $('joinPick').hidden = !show;
  if (show) { $('jpStart').classList.toggle('on', !joinNear); $('jpNear').classList.toggle('on', joinNear); }
}
$('jpStart').onclick = () => { if (!joinNear) return; joinNear = false; joinPickUI(); toast('Direction le départ de la trace', 2500); requestRejoin(true); };
$('jpNear').onclick = () => { if (joinNear) return; joinNear = true; joinPickUI(); toast('Direction le point le plus proche de la trace', 2500); requestRejoin(true); };
// croiser la trace sur une partie qu'on n'a pas à faire (avant le point visé) ne compte pas comme un retour
function rightPart() {
  if (!rejoin || !rejoin.target || rejoin.target.along == null || !progress) return true;
  return progress.along >= rejoinFrom(track) - 100 && progress.along <= rejoin.target.along + 300;
}
function rejoinFrom(p) { return p === track && done ? Math.max(0, done.along - 50) : 0; }
function rejoinCandidates(p, pos) {
  const from = rejoinFrom(p), step = clamp((p.total - from) / 2000, 25, 100), samples = [];
  for (let d = from; d <= p.total; d += step) { const q = pointAt(p, d); const dist = hav(pos, q); samples.push({ lat: q.lat, lon: q.lon, along: d, dist, score: dist + skipW() * (d - from) }); }
  const minima = samples.filter((s, i) => (i === 0 || s.score <= samples[i - 1].score) && (i === samples.length - 1 || s.score <= samples[i + 1].score))
    .sort((a, b) => a.score - b.score);
  const picked = [];
  for (const m of minima) {
    if (m.score > minima[0].score * 1.5 + 300) break;
    if (picked.every(x => Math.abs(x.along - m.along) > 300)) picked.push(m);
    if (picked.length === 3) break;
  }
  const pr = project(p, pos, true);
  if (pr && pr.along >= from && Math.abs(pr.along - picked[0].along) < step * 2) { const q = pointAt(p, pr.along); picked[0] = { lat: q.lat, lon: q.lon, along: pr.along, dist: pr.dist, score: pr.dist + skipW() * (pr.along - from) }; }
  return picked;
}
// carrefours à feux d'un itinéraire BRouter : sur la carte, chaque passage piéton à feux est noté à part,
// donc les points « feu » à moins de 60 m les uns des autres comptent pour un seul carrefour
function brSignals(f) {
  try {
    const m = f.properties.messages, iN = m[0].indexOf('NodeTags'), out = [];
    if (iN < 0) return out;
    for (const r of m.slice(1)) {
      if (!/traffic_signals/.test(r[iN] || '')) continue;
      const p = { lon: r[0] / 1e6, lat: r[1] / 1e6 };
      if (!out.some(q => hav(q, p) < 60)) out.push(p);
    }
    return out;
  } catch { return []; }
}
async function fetchRoute(a, b, ms = 12000, style) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const ll = q => `${q.lon.toFixed(6)},${q.lat.toFixed(6)}`;
    const j = await brFetch(`${ll(a)}|${ll(b)}`, style, ctrl.signal), f = j.features && j.features[0];
    const pts = f.geometry.coordinates.map(c => ({ lon: c[0], lat: c[1], ele: c[2] != null ? c[2] : null }));
    return { pts, len: +f.properties['track-length'] || 0, signals: brSignals(f) };
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
      const len = r.value.len || makePath(r.value.pts, '').total, from = rejoinFrom(track);
      const score = len + skipW() * (cands[k].along - from);
      if (!best || score < best.score) best = { pts: r.value.pts, len, score, target: cands[k] };
    });
  }
  // pas de réseau (ou serveur muet) : calcul sur le téléphone avec les chemins téléchargés
  if (!best) { await loadGraphs(); const loc = localRejoin(track, me, cands); if (loc) best = Object.assign(loc, { local: true }); }
  routing = false; $('btnRejoin').classList.remove('busy');
  if (best) {
    // on termine l'itinéraire exactement sur la trace
    best.pts.push({ lat: best.target.lat, lon: best.target.lon, ele: null });
    setRejoinPath(best.pts, best.target, false);
    const msg = `Itinéraire de retour : ${fmtDist(rejoin.total)} par le chemin`;
    if (nav) say(rejoin.total < 40 ? 'La trace est juste à côté.' : `C'est bon : la trace est à ${speakDist(rejoin.total)} par le chemin${best.local ? ', calculé sans réseau' : ''}.`, true); else { toast(msg + (best.local ? ' (calculé hors connexion)' : ''), 4000); fitTo([rejoin.pts, [me]]); }
  } else {
    const c = cands[0];
    setRejoinPath([{ lat: me.lat, lon: me.lon }, c], c, true);
    rejoin.why = 'pas de réseau, ' + whyNoLocal(me);
    const msg = `Ligne droite : ${rejoin.why}. Trace à ${fmtDist(c.dist)}, cap ${Math.round(bearing(me, c))}°`;
    if (nav) say(`Pas de réseau pour calculer le chemin. La trace est à ${speakDist(c.dist)}, à vol d'oiseau.`, true); else { toast(msg, 5000); fitTo([rejoin.pts]); }
  }
  guidance();
}
function setRejoinPath(pts, target, straight) {
  if (nav && eco === 'max') setTimeout(() => ecoWake(20000), 0); // nouveau chemin de retour : on le montre
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
}
function closeDest() { $('dest').hidden = true; $('destQ').blur(); }
$('destClose').onclick = closeDest;
$('dest').onclick = e => { if (e.target === $('dest')) closeDest(); };
$('destProf').onchange = e => setProfile(e.target.value);
// balade libre : l'ancienne trace (ou l'ancien trajet) est fermée, elle reste dans Mes traces
$('destFree').onclick = () => { closeDest(); if (track) { closeTrack(true); toast('Trace fermée · elle reste dans Mes traces', 3500); } startNav(true); };

let searchT = 0, searchSeq = 0;
$('destQ').oninput = () => {
  clearTimeout(searchT);
  const q = $('destQ').value.trim();
  if (q.length < 3) { $('destList').innerHTML = ''; return; }
  searchT = setTimeout(() => searchPlaces(q), 300);
};
// Recherche : adresses (IGN), lieux par nom (Photon, OpenStreetMap : « Decathlon »…)
// et lieux par type autour de soi (OpenStreetMap : « piscine », « boulangerie »…)
const POI_TYPES = [
  [/piscines?|baignade|nager/, 'Piscine', 'nwr["leisure"="sports_centre"]["sport"~"swimming"];nwr["leisure"="water_park"];nwr["leisure"="swimming_pool"]["access"~"yes|public|customers"];'],
  [/boulangeries?|pain/, 'Boulangerie', 'nwr["shop"="bakery"];'],
  [/supermarches?|supermarkets?|courses|epicerie|alimentation/, 'Magasin d\'alimentation', 'nwr["shop"~"^(supermarket|convenience)$"];'],
  [/pharmacies?/, 'Pharmacie', 'nwr["amenity"="pharmacy"];'],
  [/gares?|train/, 'Gare', 'nwr["railway"~"^(station|halt)$"];'],
  [/toilettes?|wc/, 'Toilettes', 'nwr["amenity"="toilets"];'],
  [/eau|fontaines?/, 'Point d\'eau', 'nwr["amenity"="drinking_water"];'],
  [/velo|velos|cycles?|reparation/, 'Magasin vélo', 'nwr["shop"="bicycle"];nwr["amenity"="bicycle_repair_station"];'],
  [/cafes?|bars?/, 'Café, bar', 'nwr["amenity"~"^(cafe|bar|pub)$"];'],
  [/restaurants?|manger|resto/, 'Restaurant', 'nwr["amenity"~"^(restaurant|fast_food)$"];'],
  [/hopital|hopitaux|urgences/, 'Hôpital', 'nwr["amenity"="hospital"];'],
  [/medecins?|docteur/, 'Médecin', 'nwr["amenity"="doctors"];'],
  [/campings?/, 'Camping', 'nwr["tourism"="camp_site"];'],
  [/hotels?/, 'Hôtel', 'nwr["tourism"~"^(hotel|guest_house)$"];'],
  [/musees?/, 'Musée', 'nwr["tourism"="museum"];'],
  [/parcs?|jardins?/, 'Parc', 'nwr["leisure"~"^(park|garden)$"]["name"];'],
  [/essence|carburant|station service/, 'Station-service', 'nwr["amenity"="fuel"];'],
  [/distributeurs?|dab|banques?|retrait/, 'Distributeur, banque', 'nwr["amenity"~"^(atm|bank)$"];'],
  [/poste/, 'Bureau de poste', 'nwr["amenity"="post_office"];'],
  [/cinemas?/, 'Cinéma', 'nwr["amenity"="cinema"];'],
  [/mairies?/, 'Mairie', 'nwr["amenity"="townhall"];'],
  [/police|gendarmerie/, 'Police, gendarmerie', 'nwr["amenity"="police"];'],
  [/stades?/, 'Stade', 'nwr["leisure"="stadium"];'],
  [/bibliotheques?|mediatheques?/, 'Bibliothèque', 'nwr["amenity"="library"];'],
  [/eglises?/, 'Église', 'nwr["amenity"="place_of_worship"];'],
  [/plages?/, 'Plage', 'nwr["natural"="beach"];'],
  [/aires? de jeux|jeux/, 'Aire de jeux', 'nwr["leisure"="playground"];'],
  [/recharge|borne/, 'Borne de recharge', 'nwr["amenity"="charging_station"];'],
  [/pique nique/, 'Pique-nique', 'nwr["tourism"="picnic_site"];nwr["leisure"="picnic_table"];'],
  [/salles? de sport|fitness|muscu/, 'Salle de sport', 'nwr["leisure"="fitness_centre"];'],
  [/parkings?/, 'Parking', 'nwr["amenity"="parking"]["access"!~"private"];'],
];
function poiType(q) {
  const n = ' ' + normName(q) + ' ';
  return POI_TYPES.find(([re]) => new RegExp(' (' + re.source + ') ').test(n));
}
async function searchNearbyType(t, c, signal) {
  const [, label, sel] = t, R = 12000, around = `(around:${R},${c.lat.toFixed(5)},${c.lon.toFixed(5)})`;
  const q = `[out:json][timeout:15];(${sel.split(';').filter(Boolean).map(x => x + around + ';').join('')});out center tags 80;`;
  const j = await overpassFast(q, null, true, signal, true);
  return (j.elements || []).map(el => {
    const lat = el.lat != null ? el.lat : el.center && el.center.lat, lon = el.lon != null ? el.lon : el.center && el.center.lon, tg = el.tags || {};
    return { lat, lon, name: tg.name || tg.brand || label, sub: [tg.name ? label : '', tg['addr:city'] || ''].filter(Boolean).join(' · ') };
  }).filter(p => p.lat != null).sort((x, y) => hav(c, x) - hav(c, y)).slice(0, 8);
}
async function searchPhoton(q, c, signal) {
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}&limit=10&lang=fr`, { signal });
  const j = await r.json();
  return (j.features || []).filter(f => f.properties.osm_key !== 'place' && f.properties.osm_key !== 'boundary' && (f.properties.name)).map(f => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    return { lat, lon, name: p.name, sub: [p.street ? (p.housenumber ? p.housenumber + ' ' : '') + p.street : '', p.city || p.county || ''].filter(Boolean).join(', ') };
  }).filter(p => hav(c, p) < 100000).sort((x, y) => hav(c, x) - hav(c, y)).slice(0, 6);
}
async function searchPlaces(q) {
  const seq = ++searchSeq, list = $('destList');
  const c = me || (() => { const m = map.getCenter(); return { lat: m.lat, lon: m.lng }; })();
  try {
    if (navigator.onLine === false) throw new Error('hors ligne');
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 20000);
    const groups = { type: null, name: null, addr: null }, t = poiType(q);
    let ignErr = false;
    const item = (name, sub, p, label) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.className = 'lib-item'; b.innerHTML = '<b></b><span></span>';
      b.querySelector('b').textContent = name;
      b.querySelector('span').textContent = [sub, me ? `${fmtDist(hav(me, p))} à vol d'oiseau` : ''].filter(Boolean).join(' · ');
      b.onclick = () => goTo({ lat: p.lat, lon: p.lon, label });
      li.appendChild(b); return li;
    };
    const head = txt => { const li = document.createElement('li'); li.className = 'note dest-h'; li.textContent = txt; return li; };
    const draw = () => {
      if (seq !== searchSeq) return;
      list.innerHTML = '';
      let shown = 0, waiting = 0;
      const sec = (g, title) => {
        if (g === null) { waiting++; return; }
        if (!g.length) return;
        list.appendChild(head(title)); g.forEach(x => { list.appendChild(x); shown++; });
      };
      if (t) sec(groups.type, `${t[1]} autour de toi`);
      sec(groups.name, 'Lieux');
      sec(groups.addr, 'Adresses');
      if (waiting) list.appendChild(head('Recherche…'));
      else if (!shown) list.innerHTML = '<li class="note">Aucun résultat.</li>';
    };
    draw();
    const jobs = [
      fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=6&lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}`, { signal: ctrl.signal }).then(r => r.json())
        .then(j => (j.features || []).map(f => { const p = f.properties, [lon, lat] = f.geometry.coordinates; return item(p.label, p.context || '', { lat, lon }, p.name || p.label); }))
        .catch(() => { ignErr = true; return []; }).then(v => { groups.addr = v; draw(); return v; }),
      searchPhoton(q, c, ctrl.signal).then(v => v.map(p => item(p.name, p.sub, p, p.name))).catch(() => [])
        .then(v => { groups.name = v; draw(); return v; }),
    ];
    if (t) jobs.push(searchNearbyType(t, c, ctrl.signal).then(v => v.map(p => item(p.name, p.sub, p, p.name))).catch(() => [])
      .then(v => { groups.type = v; draw(); return v; }));
    const res = await Promise.all(jobs);
    clearTimeout(timer);
    if (seq !== searchSeq) return;
    // rien trouvé et le serveur d'adresses injoignable : on passe à la recherche hors connexion
    if (!res.some(v => v.length) && (navigator.onLine === false || ignErr)) throw new Error('hors ligne');
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
let picking = false; // false, ou la fonction à appeler avec le point touché
function startPick(txt, cb) { picking = cb; $('pickTxt').textContent = txt; $('pickBanner').hidden = false; }
// choisir sur la carte : écran d'itinéraire, départ = ma position, le prochain toucher place l'arrivée
$('destPick').onclick = async () => {
  closeDest();
  if (nav) { startPick('Touche la carte à l\'endroit où tu veux aller', p => goTo(Object.assign(p, { label: 'le point choisi' }))); return; }
  if (!startGPS()) return;
  toast('Recherche de ta position…', 20000);
  const pos = await waitFix(20000);
  if (!pos) { toast('Position GPS introuvable. Va à découvert et réessaie.', 5000); return; }
  clearTimeout(toastT); $('toast').hidden = true;
  openPlan({ label: 'le point choisi' }, pos);
};
$('pickCancel').onclick = () => { const cb = picking; picking = false; $('pickBanner').hidden = true; if (cb && cb.cancel) cb.cancel(); };
map.on('click', e => {
  if (planning) {
    const hit = map.queryRenderedFeatures([[e.point.x - 14, e.point.y - 14], [e.point.x + 14, e.point.y + 14]], { layers: ['plan-alt'] })[0];
    if (hit) { planSwap(plan.segs[hit.properties.alt], hit.properties.s); return; }
    planAdd({ lat: e.lngLat.lat, lon: e.lngLat.lng }); return;
  }
  // parcours balisés affichés : toucher une ligne ouvre le parcours
  if (!picking && !nav && !$('routes').hidden && !rtSheet.collapsed) { rtSetCollapsed(true); return; }
  if (!picking && rtMapOn && !nav && ($('routes').hidden || rtSheet.collapsed)) {
    if (!rt.list) { toast('Recherche des parcours en cours…', 2000); return; }
    const hits = map.getLayer('rtv') ? map.queryRenderedFeatures([[e.point.x - 14, e.point.y - 14], [e.point.x + 14, e.point.y + 14]], { layers: ['rtv'] }) : [];
    const ids = [...new Set(hits.map(f => f.properties.id))], items = (rt.list || []).filter(it => ids.includes(it.id));
    if (items.length === 1) { rtSelect(items[0]); return; }
    if (items.length > 1) { rtChoose(items); return; }
    if (rt.sel || !$('rtPick').hidden) { rtUnselect(); return; } // toucher à côté : on ferme l'aperçu
    if (!rtFiltOn()) rtTap({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    else toast('Touche une des lignes affichées.', 2500);
    return;
  }
  if (!picking) return;
  const cb = picking; picking = false; $('pickBanner').hidden = true;
  cb({ lat: e.lngLat.lat, lon: e.lngLat.lng });
});

// =====================================================================
// Boucle proposée : à partir d'un point, une distance ou une durée → un itinéraire qui revient au départ
// =====================================================================
const loopCfg = { from: null, byTime: false, val: null, seed: Math.random() * 360 };
let loopRes = null;
function lpSpeed() { return profile === 'trekking' ? { v: 16, climb: 800 } : { v: 4.5, climb: 600 }; }
function lpUI() {
  const bike = profile === 'trekking';
  $('lpFoot').classList.toggle('on', !bike); $('lpBike').classList.toggle('on', bike);
  $('lpFromMe').classList.toggle('on', !loopCfg.from); $('lpFromMap').classList.toggle('on', !!loopCfg.from);
  $('lpFromTxt').textContent = loopCfg.from ? `Point choisi (${loopCfg.from.lat.toFixed(4)}, ${loopCfg.from.lon.toFixed(4)}) · touche « Un point sur la carte » pour en changer` : (me ? 'Position GPS actuelle' : 'La position GPS sera recherchée');
  $('lpByKm').classList.toggle('on', !loopCfg.byTime); $('lpByTime').classList.toggle('on', loopCfg.byTime);
  $('lpUnit').textContent = loopCfg.byTime ? 'min' : IMP ? 'mi' : 'km';
  const def = loopCfg.byTime ? (bike ? 90 : 60) : IMP ? (bike ? 20 : 5) : (bike ? 30 : 8);
  if (loopCfg.val == null) $('lpVal').value = def;
  const q = loopCfg.byTime ? [[30, '30 min'], [60, '1 h'], [90, '1 h 30'], [120, '2 h'], [180, '3 h']] : IMP ? (bike ? [[10, '10 mi'], [20, '20 mi'], [30, '30 mi'], [50, '50 mi']] : [[3, '3 mi'], [5, '5 mi'], [8, '8 mi'], [12, '12 mi']])
    : (bike ? [[15, '15 km'], [30, '30 km'], [50, '50 km'], [80, '80 km']] : [[5, '5 km'], [8, '8 km'], [12, '12 km'], [20, '20 km']]);
  $('lpQuick').innerHTML = '';
  for (const [v, l] of q) {
    const b = document.createElement('button'); b.textContent = l; b.dataset.v = v;
    b.onclick = () => {
      $('lpVal').value = v; loopCfg.val = v; lpMark();
    };
    $('lpQuick').appendChild(b);
  }
  lpMark();
}
// la distance (ou durée) proposée qui correspond à la valeur saisie reste surlignée
function lpMark() { const v = +$('lpVal').value; $('lpQuick').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === v)); }
function openLoop() { closeDest(); closeLib(); toggleMore(false); $('loopBar').hidden = true; lpUI(); $('loop').hidden = false; }
$('destLoop').onclick = openLoop;
$('loopClose').onclick = () => { $('loop').hidden = true; };
$('loop').onclick = e => { if (e.target === $('loop')) $('loop').hidden = true; };
$('lpFoot').onclick = () => { setProfile('hiking-mountain', true); loopCfg.val = null; lpUI(); };
$('lpBike').onclick = () => { setProfile('trekking', true); loopCfg.val = null; lpUI(); };
$('lpByKm').onclick = () => { loopCfg.byTime = false; loopCfg.val = null; lpUI(); };
$('lpByTime').onclick = () => { loopCfg.byTime = true; loopCfg.val = null; lpUI(); };
$('lpVal').oninput = e => { loopCfg.val = +e.target.value || null; lpMark(); };
$('lpFromMe').onclick = () => { loopCfg.from = null; lpUI(); };
$('lpFromMap').onclick = () => {
  $('loop').hidden = true;
  const cb = p => { loopCfg.from = p; lpUI(); $('loop').hidden = false; };
  cb.cancel = () => { $('loop').hidden = false; };
  startPick('Touche la carte au point de départ de la boucle', cb);
};
$('lpGo').onclick = () => { const v = +$('lpVal').value; if (!(v > 0)) { toast('Indique une distance ou une durée.'); return; } loopCfg.val = v; $('loop').hidden = true; makeLoop(); };

// itinéraire passant par plusieurs points : BRouter, sinon chemins téléchargés
async function routeVia(pts, ms, style) {
  const ll = q => `${q.lon.toFixed(6)},${q.lat.toFixed(6)}`;
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const f = (await brFetch(pts.map(ll).join('|'), style, ctrl.signal)).features[0];
    const out = f.geometry.coordinates.map(c => ({ lon: c[0], lat: c[1], ele: c[2] != null ? c[2] : null }));
    out.signals = brSignals(f);
    return out;
  } catch (e) {
    if (e.server || e.name === 'AbortError') throw e;
    // pas de réseau : enchaînement d'itinéraires sur les chemins téléchargés
    await loadGraphs();
    const out = [];
    for (let k = 1; k < pts.length; k++) { const r = localRouteTo(pts[k - 1], pts[k]); if (!r) throw e; out.push(...r.pts); }
    return out;
  } finally { clearTimeout(timer); }
}
// Retire les culs-de-sac (aller-retour sur le même bout de chemin, créés quand un point de passage
// tombe au bout d'une impasse). Quand le tracé repasse là où il était peu avant, et que ce morceau
// est un simple aller-retour (sa longueur ≈ 2 × sa portée), on le coupe. Une vraie petite boucle
// (longueur bien plus grande que 2 × sa portée) est gardée.
function removeSpurs(pts) {
  const total = pts.reduce((a, p, i) => a + (i ? hav(pts[i - 1], p) : 0), 0);
  const maxSpur = Math.min(3000, Math.max(400, total * 0.2));
  const out = [], cum = [];
  for (const p of pts) {
    const n = out.length;
    if (n >= 2) {
      const lastC = cum[n - 1] + hav(out[n - 1], p);
      for (let j = n - 2; j >= 0 && lastC - cum[j] <= maxSpur; j--) {
        if (hav(out[j], p) > 12) continue;
        const seg = lastC - cum[j];
        let reach = 0; for (let k = j + 1; k < n; k++) reach = Math.max(reach, hav(out[j], out[k]));
        if (seg > 15 && seg <= 2.4 * reach + 20) { out.length = j + 1; cum.length = j + 1; }
        break;
      }
      if (hav(out[out.length - 1], p) < 1) continue;
    }
    cum.push(out.length ? cum[out.length - 1] + hav(out[out.length - 1], p) : 0);
    out.push(p);
  }
  return out.length > 1 ? out : pts;
}
// estimation du temps (même règle que la navigation : allure + montée)
function loopEst(p) { const s = lpSpeed(); return p.total / (s.v / 3.6) + (p.hasEle ? p.totalUp / s.climb * 3600 : 0); }
// points de passage : un cercle qui passe par le départ, orienté au hasard, parcouru par 3 points
function loopPoints(c, r, ang) {
  const R = 6371000, dLat = d => d / R * 180 / Math.PI, dLon = d => d / (R * Math.cos(rad(c.lat))) * 180 / Math.PI;
  const off = (p, a, d) => ({ lat: p.lat + dLat(d * Math.cos(rad(a))), lon: p.lon + dLon(d * Math.sin(rad(a))) });
  const ctr = off(c, ang, r), pts = [c];
  for (const k of [1, 2, 3]) pts.push(off(ctr, ang + 180 + k * 90 + (Math.random() - .5) * 30, r * (0.85 + Math.random() * 0.3)));
  pts.push(c);
  return pts;
}
async function makeLoop() {
  if (nav) { toast('Quitte d\'abord la navigation.'); return; }
  let start = loopCfg.from;
  if (!start) {
    if (!startGPS()) return;
    toast('Recherche de ta position…', 15000);
    const pos = await waitFix(20000);
    if (!pos) { toast('Position GPS introuvable : choisis un point de départ sur la carte.', 5000); openLoop(); return; }
    start = { lat: pos.lat, lon: pos.lon };
  }
  const sp = lpSpeed(), target = loopCfg.byTime ? loopCfg.val * 60 : loopCfg.val * (IMP ? MI : 1000); // secondes ou mètres
  const measure = p => loopCfg.byTime ? loopEst(p) : p.total;
  // première estimation du rayon : une boucle routée fait environ 7 fois le rayon
  let dist0 = loopCfg.byTime ? loopCfg.val / 60 * sp.v * 1000 * 0.85 : target;
  let r = dist0 / 7, best = null, ang = loopCfg.seed;
  loopCfg.seed = (loopCfg.seed + 137.5) % 360; // la prochaine proposition partira dans une autre direction
  const t0 = Date.now(), tick = setInterval(() => toast(`Recherche d'une boucle… ${Math.round((Date.now() - t0) / 1000)} s`, 3000), 1000);
  try {
    for (let tryN = 0; tryN < 4; tryN++) {
      let pts;
      try { pts = removeSpurs(await routeVia(loopPoints(start, r, ang), 45000)); }
      catch (e) {
        if (!e.server) throw e;
        ang = (ang + 60) % 360; continue; // point dans la mer, sans chemin… : autre direction
      }
      const p = makePath(pts, ''), m = measure(p), err = Math.abs(m - target) / target;
      if (!best || err < best.err) best = { pts, err, m };
      if (err < 0.08) break;
      r *= clamp(target / m, 0.5, 2); // on agrandit ou on réduit la boucle
    }
  } catch (e) {
    clearInterval(tick);
    toast(navigator.onLine === false ? 'Pas de réseau : boucle possible seulement dans une zone dont les chemins sont téléchargés.' : 'Le serveur d\'itinéraires ne répond pas. Réessaie dans un instant.', 6000);
    return;
  }
  clearInterval(tick);
  if (!best) { toast('Aucune boucle trouvée ici. Essaie un autre point de départ.', 5000); return; }
  showLoop(best.pts);
}
function loopGPX(pts, name) {
  const esc = s => s.replace(/[<&>]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Pisteo" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>${esc(name)}</name><trkseg>\n` +
    pts.map(p => `    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.ele != null ? `<ele>${(+p.ele).toFixed(1)}</ele>` : ''}</trkpt>`).join('\n') + '\n  </trkseg></trk>\n</gpx>\n';
}
function showLoop(pts) {
  const p = makePath(pts, ''), bike = profile === 'trekking';
  const name = `Boucle ${bike ? 'à vélo' : 'à pied'} de ${fmtDist(p.total)}`;
  const text = loopGPX(pts, name);
  loopRes = { text, name };
  loadText(text, false); store.set('gpx', text);
  const est = loopEst(p);
  $('lbTitle').textContent = name;
  $('lbSub').textContent = `${p.hasEle ? 'D+ ' + fmtM(p.totalUp) + ' · ' : ''}environ ${fmtDur(est)}` + (loopCfg.byTime ? ` (demandé : ${fmtDur(loopCfg.val * 60)})` : ` (demandé : ${loopCfg.val} ${IMP ? 'mi' : 'km'})`);
  $('lbKeep').textContent = 'Garder'; $('lbKeep').disabled = false;
  $('loopBar').hidden = false;
  // toute la boucle visible au-dessus du panneau et de la barre de proposition
  setTimeout(() => { try { map.fitBounds(boundsOf([pts]), { padding: { top: 80, bottom: $('sheet').offsetHeight + $('loopBar').offsetHeight + 30, left: 30, right: 70 }, bearing: 0, pitch: 0, duration: 600 }); } catch {} }, 350);
}
$('lbAgain').onclick = () => { $('loopBar').hidden = true; makeLoop(); };
$('lbEdit').onclick = () => { $('loopBar').hidden = true; openLoop(); };
$('lbKeep').onclick = async () => { if (!loopRes || !track) return; await saveRecent(track, loopRes.text); $('lbKeep').textContent = 'Gardée ✓'; $('lbKeep').disabled = true; refreshSaveBtn(); toast('Boucle gardée dans « Mes traces »', 3000); };
$('lbGo').onclick = () => { $('loopBar').hidden = true; startNav(); };

// =====================================================================
// Parcours balisés autour de moi : sentiers (GR, GRP, PR) et véloroutes (EuroVelo, nationales,
// régionales, boucles, VTT) recensés par OpenStreetMap. Pour un grand itinéraire, on ne charge
// que la portion autour du point choisi.
// =====================================================================
const RT_CAT = {
  gr:  { rank: 0, badge: 'GR', label: 'Grande randonnée' },
  grp: { rank: 1, badge: 'GRP', label: 'Randonnée régionale' },
  pr:  { rank: 2, badge: 'PR', label: 'Randonnée locale' },
  ev:  { rank: 0, badge: 'EuroVelo', label: 'Véloroute européenne' },
  vn:  { rank: 1, badge: 'Véloroute', label: 'Véloroute nationale' },
  vr:  { rank: 2, badge: 'Véloroute', label: 'Véloroute régionale' },
  vl:  { rank: 3, badge: 'Boucle vélo', label: 'Circuit vélo local' },
  vtt: { rank: 4, badge: 'VTT', label: 'Circuit VTT' },
};
function rtCat(t) {
  const n = t.network || '';
  if (t.route === 'mtb') return 'vtt';
  if (t.route === 'bicycle') return n === 'icn' ? 'ev' : n === 'ncn' ? 'vn' : n === 'rcn' ? 'vr' : 'vl';
  return n === 'iwn' || n === 'nwn' ? 'gr' : n === 'rwn' ? 'grp' : 'pr';
}
function rtName(t) {
  const name = t['name:fr'] || t.name || '', ref = t.ref || '';
  if (!name) return ref || 'Itinéraire sans nom';
  return ref && !name.replace(/\s/g, '').toLowerCase().includes(ref.replace(/\s/g, '').toLowerCase()) ? `${ref} · ${name}` : name;
}
// distance annoncée par OSM (« 12 km », « 12.5 », « 8 mi »), en mètres
function rtTagDist(t) {
  const m = String(t.distance || '').replace(',', '.').match(/^\s*([\d.]+)\s*(km|mi|m)?\s*$/i);
  if (!m) return null;
  const v = +m[1], u = (m[2] || 'km').toLowerCase();
  return u === 'mi' ? v * 1609 : u === 'm' ? v : v * 1000;
}
// relations OSM → liste triée (grands itinéraires d'abord, puis du plus proche au plus loin)
const RT_BIG_NET = /^(icn|ncn|rcn|iwn|nwn|rwn)$/;
function rtListFrom(json, at) {
  const out = [], seen = new Set();
  for (const e of (json && json.elements) || []) {
    if (e.type !== 'relation' || !e.tags || seen.has(e.id)) continue;
    seen.add(e.id);
    const t = e.tags, cat = rtCat(t), b = e.bounds;
    if (t.state === 'proposed' || t.disused || t.abandoned) continue;
    // grands réseaux (EuroVelo, véloroutes, GR, GRP) : le serveur ne calcule pas leur emprise, trop coûteuse
    let near = null, big = !b && RT_BIG_NET.test(t.network || '');
    if (big) near = 0;
    if (b) {
      const diag = hav({ lat: b.minlat, lon: b.minlon }, { lat: b.maxlat, lon: b.maxlon });
      big = diag > 40000;
      const inside = at.lat >= b.minlat && at.lat <= b.maxlat && at.lon >= b.minlon && at.lon <= b.maxlon;
      near = big || inside ? 0 : hav(at, { lat: (b.minlat + b.maxlat) / 2, lon: (b.minlon + b.maxlon) / 2 });
    }
    out.push({ id: e.id, tags: t, cat, name: rtName(t), dist: rtTagDist(t), near, big, bounds: b, at });
  }
  out.sort((a, b) => RT_CAT[a.cat].rank - RT_CAT[b.cat].rank || (a.near ?? 1e9) - (b.near ?? 1e9) || a.name.localeCompare(b.name, LANG));
  return out;
}
// Les chemins d'une relation (dans le désordre, parfois coupés au bord de la zone) → une trace continue.
// On part du plus long morceau et on raccroche à chaque bout le morceau le plus proche
// (d'abord bout à bout, puis avec un petit trou), jusqu'à ne plus rien trouver. On garde la plus longue chaîne.
const RT_SKIP_ROLES = /^(alternative|excursion|approach|connection|link|backward|platform|stop|guidepost)$/;
function rtSegments(rel) {
  const segs = [];
  for (const m of rel.members || []) {
    if (m.type !== 'way' || !m.geometry || RT_SKIP_ROLES.test(m.role || '')) continue;
    let cur = [];
    for (const g of m.geometry) {
      if (!g || g.lat == null) { if (cur.length > 1) segs.push(cur); cur = []; continue; }
      cur.push({ lat: g.lat, lon: g.lon });
    }
    if (cur.length > 1) segs.push(cur);
  }
  return segs;
}
function rtLen(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += hav(pts[i - 1], pts[i]); return d; }
function rtChain(segs) {
  const left = segs.map(s => ({ pts: s, len: rtLen(s), used: false }));
  const chains = [];
  const nearest = (end, tol) => {
    let best = null;
    for (const s of left) {
      if (s.used) continue;
      const a = hav(end, s.pts[0]), b = hav(end, s.pts[s.pts.length - 1]), d = Math.min(a, b);
      if (d <= tol && (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && s.len > best.s.len))) best = { s, d, rev: b < a };
    }
    return best;
  };
  for (;;) {
    let seed = null;
    for (const s of left) if (!s.used && (!seed || s.len > seed.len)) seed = s;
    if (!seed) break;
    seed.used = true;
    let chain = seed.pts.slice(), len = seed.len;
    for (const atEnd of [true, false]) {
      for (;;) {
        const end = atEnd ? chain[chain.length - 1] : chain[0];
        const f = nearest(end, 25) || nearest(end, 150);
        if (!f) break;
        f.s.used = true; len += f.s.len + f.d;
        let p = f.rev ? f.s.pts.slice().reverse() : f.s.pts.slice(); // p commence près de « end »
        if (atEnd) chain = chain.concat(f.d < 1 ? p.slice(1) : p);
        else { p = p.reverse(); chain = (f.d < 1 ? p.slice(0, -1) : p).concat(chain); }
      }
    }
    chains.push({ pts: chain, len });
  }
  chains.sort((a, b) => b.len - a.len);
  return chains.length ? chains[0] : null;
}
// un itinéraire linéaire part du bout le plus proche du point de départ
function rtOrient(pts, at) {
  if (!at || pts.length < 2) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  if (hav(a, b) < 300) return pts; // boucle
  return hav(at, b) < hav(at, a) ? pts.slice().reverse() : pts;
}
// altitudes IGN (service public, France précise, reste du monde approximatif) : on interroge
// au plus ~500 points régulièrement espacés, puis on interpole. En cas d'échec : trace sans altitude.
async function rtElevate(pts) {
  const n = pts.length, step = Math.max(1, Math.ceil(n / 400)), idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  const z = new Array(n).fill(null);
  // toutes les demandes partent en même temps
  const one = async part => {
    const url = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?resource=ign_rge_alti_wld&delimiter=%7C&zonly=true&indent=false'
      + '&lon=' + part.map(i => pts[i].lon.toFixed(6)).join('%7C') + '&lat=' + part.map(i => pts[i].lat.toFixed(6)).join('%7C');
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctrl.signal }); if (!r.ok) throw new Error('alti');
      const els = ((await r.json()) || {}).elevations || [];
      if (els.length !== part.length) throw new Error('alti');
      part.forEach((i, q) => { const v = typeof els[q] === 'object' && els[q] ? els[q].z : els[q]; z[i] = typeof v === 'number' && v > -1000 ? v : null; });
    } finally { clearTimeout(timer); }
  };
  try {
    const parts = []; for (let k = 0; k < idx.length; k += 100) parts.push(idx.slice(k, k + 100));
    await Promise.all(parts.map(one));
  } catch { return pts; }
  // interpolation à la distance entre deux points connus
  const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (z[i] == null) continue;
    if (prev >= 0) for (let k = prev + 1; k < i; k++) { const f = cum[i] > cum[prev] ? (cum[k] - cum[prev]) / (cum[i] - cum[prev]) : 0; z[k] = z[prev] + (z[i] - z[prev]) * f; }
    prev = i;
  }
  if (z.filter(v => v != null).length < n * 0.8) return pts;
  return pts.map((p, i) => ({ lat: p.lat, lon: p.lon, ele: z[i] != null ? Math.round(z[i] * 10) / 10 : null }));
}

// Le serveur principal d'OpenStreetMap fait souvent patienter : pour ces petites demandes,
// on essaie d'abord un serveur libre tout de suite, sinon des serveurs miroirs, et en dernier recours on patiente.
const OVERPASS_MIRRORS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function overpassFast(q, onWait, mirrorFirst, signal, fast) {
  // demandes « en relais » : un serveur, puis le suivant s'il échoue ou tarde 3 s ; la première réponse
  // gagne et les autres sont annulées. fast : pas d'attente longue, échec franc au bout de ~20 s
  const servers = mirrorFirst ? [OVERPASS_MIRRORS[0], OVERPASS, OVERPASS_MIRRORS[1]] : [OVERPASS, OVERPASS_MIRRORS[0], OVERPASS_MIRRORS[1]];
  const ctrls = [];
  const j = await new Promise(resolve => {
    let next = 0, running = 0, done = false, relay = 0;
    const end = v => { if (done) return; done = true; clearTimeout(relay); clearTimeout(deadline); resolve(v); };
    const deadline = fast ? setTimeout(() => end(null), 20000) : 0;
    if (signal) signal.addEventListener('abort', () => end(null));
    const start = () => {
      if (done || next >= servers.length) { if (!running) end(null); return; }
      const url = servers[next++]; running++;
      clearTimeout(relay); relay = setTimeout(start, 3000);
      const ctrl = new AbortController(); ctrls.push(ctrl);
      const timer = setTimeout(() => ctrl.abort(), fast ? 20000 : 60000);
      fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal })
        .then(r => r.ok ? r.json() : null).catch(() => null)
        .then(v => { clearTimeout(timer); running--; if (v) end(v); else start(); }); // échec : serveur suivant tout de suite
    };
    start();
  });
  ctrls.forEach(c => c.abort());
  if (signal && signal.aborted) { const err = new Error('annulé'); err.cancel = true; throw err; }
  if (j) return j;
  if (fast) throw new Error('serveurs OpenStreetMap saturés, réessaie dans un moment');
  return overpass(q, 2, onWait);
}
// ---------- Parcours balisés préparés à l'avance (dépôt pisteo-data, mis à jour chaque mois) ----------
// Tuiles de 0,25° publiées sur GitHub Pages : en France, la recherche et les tracés ne passent plus
// par les serveurs OpenStreetMap. Les tuiles lues sont gardées sur le téléphone (hors ligne ensuite).
const RT_DATA = 'https://paul12102021.github.io/pisteo-data/';
const rtd = { man: null, manP: null, deps: null, tiles: new Map() };
async function rtdCache() { try { return await caches.open('rt-tiles'); } catch { return null; } }
async function rtdGet(path, maxAge) {
  const c = await rtdCache(), key = 'https://rt.tiles/' + path;
  const old = c && await c.match(key).catch(() => null);
  if (old && (!maxAge || Date.now() - (+old.headers.get('x-t') || 0) < maxAge)) return old.json();
  try {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(RT_DATA + path, { cache: 'no-cache', signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text();
    if (c) c.put(key, new Response(txt, { headers: { 'content-type': 'application/json', 'x-t': String(Date.now()) } })).catch(() => {});
    return JSON.parse(txt);
  } catch (e) { if (old) return old.json(); throw e; }
}
// le manifeste (liste des tuiles et date des données) est relu au plus une fois par jour
function rtdManifest() {
  if (!rtd.manP) rtd.manP = rtdGet('manifest.json', 864e5).then(m => {
    if (!m || m.v !== 1) throw new Error('format');
    rtd.man = Object.assign(m, { set: new Set(m.tiles) });
    return rtd.man;
  }).catch(() => { rtd.manP = null; return null; });
  return rtd.manP;
}
async function rtdInFrance(p) {
  if (!rtd.deps) { try { rtd.deps = await (await fetch('departements.json')).json(); } catch { return false; } }
  return rtd.deps.some(d => inPolys(p.lon, p.lat, d.polys));
}
const rtdTileName = (lat, lon, g) => `${Math.floor((lon + 180) / g)}_${Math.floor((lat + 90) / g)}`;
function rtdTilesIn(box) { // box = [sud, ouest, nord, est]
  const g = rtd.man.grid, out = [];
  for (let x = Math.floor((box[1] + 180) / g); x <= Math.floor((box[3] + 180) / g); x++)
    for (let y = Math.floor((box[0] + 90) / g); y <= Math.floor((box[2] + 90) / g); y++)
      if (rtd.man.set.has(`${x}_${y}`)) out.push(`${x}_${y}`);
  return out;
}
function rtdBoxAround(c, r) { const dLat = r / 111320, dLon = r / (111320 * Math.cos(rad(c.lat))); return [c.lat - dLat, c.lon - dLon, c.lat + dLat, c.lon + dLon]; }
function rtdTile(name) {
  const k = rtd.man.date + '/' + name;
  if (!rtd.tiles.has(k)) {
    const p = rtdGet(`t/${name}.json?d=${rtd.man.date}`, 0);
    p.catch(() => rtd.tiles.delete(k));
    rtd.tiles.set(k, p);
  }
  return rtd.tiles.get(k);
}
function rtdDecode(s) {
  const pts = []; let i = 0, lat = 0, lon = 0;
  while (i < s.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0, res = 0, b;
      do { b = s.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const v = res & 1 ? ~(res >> 1) : res >> 1;
      if (k) lon += v; else lat += v;
    }
    pts.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }
  return pts;
}
// tuiles → parcours : { id → { meta, ways: Map(wayId → points) } }
async function rtdRoutes(names, kinds) {
  const tiles = await Promise.all(names.map(rtdTile));
  const out = new Map();
  for (const T of tiles) {
    for (const [id, kind, tags, len, bb, idx] of T.r) {
      if (!kinds.includes(kind)) continue;
      let R = out.get(id);
      if (!R) out.set(id, R = { id, kind, tags, len, bb, ways: new Map() });
      for (const i of idx) { const [wid, enc] = T.w[i]; if (!R.ways.has(wid)) R.ways.set(wid, enc); }
    }
  }
  return out;
}
const rtdKinds = () => rtBike() ? ['b', 'm'] : ['h', 'f'];
// liste des parcours autour d'un point, depuis les tuiles ; null si la zone n'est pas couverte
async function rtdList(at) {
  const man = await rtdManifest();
  if (!man || !(await rtdInFrance(at))) return null;
  const R = rtRadius(), routes = await rtdRoutes(rtdTilesIn(rtdBoxAround(at, R)), rtdKinds());
  const out = [];
  for (const r of routes.values()) {
    const t = Object.assign({ route: { b: 'bicycle', m: 'mtb', h: 'hiking', f: 'foot' }[r.kind] }, r.tags);
    // distance réelle : point du parcours le plus proche
    let near = Infinity;
    for (const enc of r.ways.values()) for (const p of rtdDecode(enc)) { const d = hav(at, p); if (d < near) near = d; }
    if (near > R) continue;
    const b = { minlat: r.bb[0], minlon: r.bb[1], maxlat: r.bb[2], maxlon: r.bb[3] };
    const big = hav({ lat: b.minlat, lon: b.minlon }, { lat: b.maxlat, lon: b.maxlon }) > 40000;
    out.push({ id: r.id, tags: t, cat: rtCat(t), name: rtName(t), dist: r.len, near: near < 300 ? 0 : near, big, bounds: b, at, src: 'd' });
  }
  out.sort((a, b) => RT_CAT[a.cat].rank - RT_CAT[b.cat].rank || a.near - b.near || a.name.localeCompare(b.name, LANG));
  return out;
}
// tracé d'un parcours depuis les tuiles : tout le parcours s'il est petit, la portion autour du point sinon
async function rtdSegments(it) {
  const man = await rtdManifest(); if (!man) return null;
  const box = it.big ? rtdBoxAround(it.at, rtCut()) : [it.bounds.minlat, it.bounds.minlon, it.bounds.maxlat, it.bounds.maxlon];
  const r = (await rtdRoutes(rtdTilesIn(box), [it.tags.route === 'mtb' ? 'm' : it.tags.route === 'bicycle' ? 'b' : it.tags.route === 'foot' ? 'f' : 'h'])).get(it.id);
  if (!r) return null;
  return [...r.ways.values()].map(rtdDecode).filter(s => s.length > 1);
}

const rtCache = new Map(); // recherches déjà faites (mode + lieu) : pas de nouvelle demande en changeant de mode
const rt = { at: null, fromMap: false, list: null, key: '', res: null, busy: false };
const rtBike = () => profile === 'trekking';
const rtRadius = () => rtBike() ? 20000 : 12000; // zone de recherche
const rtCut = () => rtBike() ? 25000 : 12000; // portion chargée d'un grand itinéraire (rayon)
function rtBox(c, r) {
  const dLat = r / 111320, dLon = r / (111320 * Math.cos(rad(c.lat)));
  return [c.lat - dLat, c.lon - dLon, c.lat + dLat, c.lon + dLon].map(v => v.toFixed(5)).join(',');
}
function rtLastPos() { try { const p = JSON.parse(store.get('lastPos') || 'null'); return p && Date.now() - p.t < 30 * 864e5 ? p : null; } catch { return null; } }
function rtHere() {
  if (!rt.fromMap && me) return { lat: me.lat, lon: me.lon };
  if (!rt.fromMap && rt.prov) return { lat: rt.prov.lat, lon: rt.prov.lon };
  const c = map.getCenter(); return { lat: c.lat, lon: c.lng };
}
function rtUI() {
  const bike = rtBike();
  $('rtFoot').classList.toggle('on', !bike); $('rtBike').classList.toggle('on', bike);
}
// ---------- Panneau des parcours : glisser vers le bas pour voir la carte, vers le haut pour la liste ----------
const rtSheet = { collapsed: false };
function rtPeek() { const g = $('rtGrab'); return g.offsetTop + g.offsetHeight + 12; }
function rtSetCollapsed(c) {
  rtSheet.collapsed = c;
  $('routes').classList.toggle('collapsed', c);
  $('rtToggle').textContent = c ? 'Liste ▴' : 'Carte ▾';
  if (c) $('rtPanel').scrollTop = 0; // réduit : on montre toujours le titre, jamais le milieu de la liste
  requestAnimationFrame(() => {
    const pnl = $('rtPanel'), peek = rtPeek();
    document.documentElement.style.setProperty('--rt-peek', peek + 'px');
    pnl.style.setProperty('--rt-y', (c ? Math.max(0, pnl.offsetHeight - peek) : 0) + 'px');
  });
}
function rtSheetOpen(collapsed) {
  closeDest(); closeLib(); toggleMore(false); $('loopBar').hidden = true; $('rtBar').hidden = true;
  $('routes').hidden = false; document.body.classList.add('rtmode');
  rtUI(); rtFiltUI(); rtSetCollapsed(collapsed);
}
(() => {
  // le geste peut partir de n'importe où dans l'en-tête, boutons compris :
  // un toucher reste un clic, un glissement vertical déplace le panneau (et le clic est alors annulé)
  const grab = $('rtGrab'), pnl = $('rtPanel');
  let y0 = null, x0 = 0, t0 = 0, base = 0, last = 0, drag = false, onBtn = false, pid = null;
  grab.addEventListener('pointerdown', e => {
    y0 = e.clientY; x0 = e.clientX; t0 = Date.now(); drag = false; pid = e.pointerId;
    onBtn = !!e.target.closest('button');
    base = rtSheet.collapsed ? Math.max(0, pnl.offsetHeight - rtPeek()) : 0; last = base;
  });
  grab.addEventListener('pointermove', e => {
    if (y0 == null || e.pointerId !== pid) return;
    const dy = e.clientY - y0, dx = e.clientX - x0;
    if (!drag) {
      if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx)) return;
      drag = true; $('routes').classList.add('dragging');
      try { grab.setPointerCapture(pid); } catch {}
    }
    last = clamp(base + dy, 0, Math.max(0, pnl.offsetHeight - rtPeek()));
    pnl.style.setProperty('--rt-y', last + 'px');
  });
  const end = e => {
    if (y0 == null) return;
    const dy = e.clientY - y0, v = dy / Math.max(1, Date.now() - t0); y0 = null;
    $('routes').classList.remove('dragging');
    if (!drag) { if (!onBtn && e.type === 'pointerup') rtSetCollapsed(!rtSheet.collapsed); return; } // simple toucher hors bouton : ouvre ou réduit
    const block = ev => { ev.stopPropagation(); ev.preventDefault(); };
    grab.addEventListener('click', block, true); setTimeout(() => grab.removeEventListener('click', block, true), 350);
    const max = Math.max(1, pnl.offsetHeight - rtPeek());
    rtSetCollapsed(v > 0.4 ? true : v < -0.4 ? false : last > max / 2);
  };
  grab.addEventListener('pointerup', end); grab.addEventListener('pointercancel', end);
})();
function openRoutes() {
  if (nav) { toast('Quitte d\'abord la navigation.'); return; }
  rtSheetOpen(false);
  if (!me && !rt.fromMap && startGPS()) {
    // on laisse quelques secondes au GPS ; sans position, on cherche dans la zone affichée
    $('rtList').innerHTML = ''; $('rtStatus').textContent = 'Recherche de ta position…';
    waitFix(10000).then(() => { if (!$('routes').hidden) rtSearch(); });
    return;
  }
  const at = rtHere(), key = profile + ':' + at.lat.toFixed(2) + ',' + at.lon.toFixed(2);
  if (rt.list && rt.key === key) { rt.tapped = false; rtRender(); } else rtSearch();
}
function closeRoutes(keepMap) {
  if (rt.sel || !$('rtPick').hidden) { rt.sel = null; rtSelDraw([]); rtCardMode(null); }
  $('routes').hidden = true; rtQClear(); document.body.classList.remove('rtmode');
  if (!keepMap && rtMapOn) rtHideMap();
}
function rtListReady() { rtRender(); rtDraw(); rtBarText(); rtEnrich(); }
async function rtSearch() {
  if (rt.busy) { rt.again = true; return; }
  rt.tapped = false;
  const at = rtHere(), bike = rtBike();
  rt.at = at; rt.key = profile + ':' + at.lat.toFixed(2) + ',' + at.lon.toFixed(2); rt.list = null; rt.gen++;
  $('rtList').innerHTML = ''; rtDraw(); rtBarText();
  $('rtStatus').textContent = `Recherche des parcours ${bike ? 'vélo' : 'à pied'} dans un rayon de ${rtRadius() / 1000} km${rt.fromMap || !me ? ' dans cette zone' : ' autour de toi'}…`;
  const sel = bike ? '["route"~"^(bicycle|mtb)$"]' : '["route"~"^(hiking|foot)$"]';
  // l'emprise (bb) n'est demandée que pour les petits parcours : pour une EuroVelo ou un GR,
  // le serveur devrait reconstituer tout l'itinéraire à travers l'Europe, ce qui prend très longtemps
  const q = `[out:json][timeout:25];relation["type"="route"]${sel}(${rtBox(at, rtRadius())})->.a;`
    + `relation.a["network"~"^(icn|ncn|rcn|iwn|nwn|rwn)$"]->.g;(.a; - .g;)->.p;.g out tags;.p out tags bb;`;
  rt.busy = true;
  try {
    if (rtCache.has(rt.key)) { rt.list = rtCache.get(rt.key); rtListReady(); return; }
    // en France : données préparées à l'avance, sans serveur OpenStreetMap
    const local = await rtdList(at).catch(() => null);
    if (local) { rt.list = local; rtCache.set(rt.key, local); rtListReady(); return; }
    // recherche déjà faite ici il y a moins d'une semaine : affichage immédiat
    try { const s = JSON.parse(store.get('rt:' + rt.key) || 'null'); if (s && Date.now() - s.t < 7 * 864e5) { rt.list = rtListFrom(s.j, at); rtCache.set(rt.key, rt.list); rtListReady(); return; } } catch {}
    const json = await overpassFast(q, null, true, null, true);
    rt.list = rtListFrom(json, at); rtCache.set(rt.key, rt.list);
    store.set('rt:' + rt.key, JSON.stringify({ t: Date.now(), j: { elements: (json.elements || []).map(e => ({ type: e.type, id: e.id, tags: e.tags, bounds: e.bounds })) } }));
    rtListReady();
  } catch (e) {
    $('rtStatus').textContent = navigator.onLine === false ? 'Pas de réseau : la recherche de parcours balisés a besoin d\'une connexion.' : `Recherche impossible (${e.message}). Réessaie dans un instant.`;
  } finally { rt.busy = false; if (rt.again) { rt.again = false; rtSearch(); } }
}
// La liste est mise à jour sur place (les lignes déjà affichées sont gardées) : pendant le chargement
// en arrière-plan, le défilement n'est plus interrompu ni ramené en haut.
function rtRender() {
  const list = $('rtList'), all = (rt.tapped ? rt.tapList : rt.list) || [];
  const pnl = $('rtPanel'), keepTop = pnl.scrollTop;
  const old = new Map(); for (const li of [...list.children]) old.set(li.dataset.k, li);
  const order = [];
  const items = rt.tapped ? all : all.filter(it => rtPass(it) === true), pr = rtProgress();
  const where = rt.fromMap ? 'dans cette zone' : me ? 'autour de toi' : rt.prov ? 'autour de ta dernière position connue' : 'dans cette zone';
  let st;
  if (rt.tapped) st = `${all.length} parcours passent à l'endroit touché. Lequel veux-tu voir ?`;
  else if (!all.length) st = `Aucun parcours ${rtBike() ? 'vélo' : 'à pied'} balisé recensé ici. Essaie l'autre mode, déplace la carte ou cherche un lieu.`;
  else if (rtFiltOn()) st = `${items.length} parcours sur ${all.length} ${where} correspondent au filtre.` + (pr.done < pr.n ? ` Calcul des distances et dénivelés : ${pr.done}/${pr.n}…` : '');
  else st = `${all.length} parcours balisé${all.length > 1 ? 's' : ''} ${where}. Touche une ligne sur la carte, ou glisse vers le haut pour la liste.` + (pr.done < pr.n ? ` (calcul ${pr.done}/${pr.n})` : '');
  $('rtStatus').textContent = st;
  if (rtSheet.collapsed && !$('routes').hidden) rtSetCollapsed(true);
  for (const it of items.slice(0, 80)) {
    const k = rtKey(it);
    let li = old.get(k), b;
    if (li) { old.delete(k); b = li.firstChild; }
    else {
      li = document.createElement('li'); li.dataset.k = k;
      b = document.createElement('button'); b.className = 'lib-item';
      b.innerHTML = '<b></b><span></span>'; li.appendChild(b);
    }
    order.push(li);
    const c = RT_CAT[it.cat], g = rt.geo.get(k);
    if (b.querySelector('b').textContent !== it.name) b.querySelector('b').textContent = it.name;
    const bits = [c.badge === 'Véloroute' || c.badge === 'Boucle vélo' ? c.label : `${c.badge} · ${c.label}`];
    if (g) { bits.push(fmtDist(g.len) + (g.partial ? ' (portion)' : '')); if (g.hasEle) bits.push('D+ ' + fmtM(g.up)); }
    else if (it.dist) bits.push(fmtDist(it.dist));
    if (!g || !g.partial) bits.push(it.big ? 'portion autour de toi' : it.near ? 'à ' + fmtDist(it.near) : 'passe tout près');
    const txt = bits.join(' · ');
    if (b.querySelector('span').textContent !== txt) b.querySelector('span').textContent = txt;
    b.onclick = () => rtSelect(it);
  }
  for (const li of old.values()) li.remove();
  // on ne déplace les lignes que si l'ordre a vraiment changé
  const cur = [...list.children];
  if (cur.length !== order.length || order.some((li, i) => cur[i] !== li)) order.forEach(li => list.appendChild(li));
  if (!rtSheet.collapsed && pnl.scrollTop !== keepTop) pnl.scrollTop = keepTop;
}
// Tracé déjà mis en ordre par Waymarked Trails (le site qui dessine le calque) : une simple
// demande de fichier, rapide, sans passer par les serveurs OpenStreetMap souvent saturés.
// Pas pour les très grands itinéraires (EuroVelo, GR nationaux) : fichier trop lourd.
function rtWmtOk(it) { return !/^(icn|iwn|nwn)$/.test(it.tags.network || ''); }
async function rtFromWmt(it, signal) {
  const fl = it.tags.route === 'mtb' ? 'mtb' : it.tags.route === 'bicycle' ? 'cycling' : 'hiking';
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 12000);
  const onAbort = () => ctrl.abort(); if (signal) signal.addEventListener('abort', onAbort);
  try {
    const r = await fetch(`https://${fl}.waymarkedtrails.org/api/v1/details/relation/${it.id}/geometry/gpx`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const doc = new DOMParser().parseFromString(await r.text(), 'application/xml'), segs = [];
    const groups = [...doc.getElementsByTagName('trkseg'), ...doc.getElementsByTagName('rte')];
    for (const g of groups) {
      const pts = [...g.getElementsByTagName('trkpt'), ...g.getElementsByTagName('rtept')].map(n => ({ lat: +n.getAttribute('lat'), lon: +n.getAttribute('lon') })).filter(q => isFinite(q.lat) && isFinite(q.lon));
      if (pts.length > 1) segs.push(pts);
    }
    return segs.length ? segs : null;
  } catch { return null; } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
}
// portion d'un tracé dans la zone autour du point : le morceau continu qui passe le plus près du point
function rtClip(pts, at, r) {
  const dLat = r / 111320, dLon = r / (111320 * Math.cos(rad(at.lat)));
  const inBox = q => Math.abs(q.lat - at.lat) <= dLat && Math.abs(q.lon - at.lon) <= dLon;
  const runs = []; let cur = [];
  for (const q of pts) { if (inBox(q)) cur.push(q); else if (cur.length) { runs.push(cur); cur = []; } }
  if (cur.length) runs.push(cur);
  let best = null, bd = Infinity;
  for (const run of runs) { if (run.length < 2) continue; for (const q of run) { const d = hav(q, at); if (d < bd) { bd = d; best = run; } } }
  return best || pts;
}
// ---------- Tracés des parcours : chargés une fois, gardés sur le téléphone ----------
// Chaque parcours de la liste est chargé en arrière-plan (tracé, longueur, D+) : on peut ainsi
// filtrer par distance et dénivelé, les dessiner sur la carte et les ouvrir instantanément.
rt.geo = new Map(); rt.inflight = new Map(); rt.gen = 0; rt.wmtDown = false;
const rtKey = it => it.big ? `${it.id}@${it.at.lat.toFixed(2)},${it.at.lon.toFixed(2)}:${rtBike() ? 'b' : 'f'}` : String(it.id);
async function rtGeoCache() { try { return await caches.open('rt-geo'); } catch { return null; } }
async function rtSaveGeo(g) {
  const c = await rtGeoCache(); if (!c) return;
  const pts = g.pts.map(p => [+p.lat.toFixed(5), +p.lon.toFixed(5), p.ele != null ? Math.round(p.ele * 10) / 10 : null]);
  try { await c.put(new Request('https://rt.geo/' + encodeURIComponent(g.key)), new Response(JSON.stringify({ t: Date.now(), pts, len: g.len, partial: g.partial, up: g.up, hasEle: g.hasEle }))); } catch {}
}
async function rtLoadGeo(key) {
  const c = await rtGeoCache(); if (!c) return null;
  try {
    const r = await c.match('https://rt.geo/' + encodeURIComponent(key)); if (!r) return null;
    const j = await r.json(); if (Date.now() - j.t > 30 * 864e5) return null;
    const g = { key, pts: j.pts.map(a => ({ lat: a[0], lon: a[1], ele: a[2] })), len: j.len, partial: j.partial, up: j.up, hasEle: j.hasEle };
    if (g.hasEle) g.elevP = Promise.resolve(g);
    return g;
  } catch { return null; }
}
// tracé (sans altitude) : mémoire → téléphone → Waymarked Trails → OpenStreetMap
function rtGeom(it) {
  const key = rtKey(it);
  if (rt.geo.has(key)) return Promise.resolve(rt.geo.get(key));
  if (rt.inflight.has(key)) return rt.inflight.get(key);
  const at = it.at;
  const p = (async () => {
    let g = await rtLoadGeo(key);
    if (!g) g = await Promise.race([rtFetchGeo(it, key, at), new Promise((_, rej) => setTimeout(() => rej(new Error('serveurs OpenStreetMap saturés, réessaie dans un moment')), 30000))]);
    rt.geo.set(key, g);
    return g;
  })();
  rt.inflight.set(key, p);
  p.finally(() => rt.inflight.delete(key)).catch(() => {});
  return p;
}
async function rtFetchGeo(it, key, at) {
  if (it.src === 'd') {
    const segs = await rtdSegments(it).catch(() => null);
    const ch = segs && segs.length && rtChain(segs);
    if (ch && it.big) { ch.pts = rtClip(ch.pts, at, rtCut()); ch.len = rtLen(ch.pts); }
    if (ch && ch.pts.length > 1 && ch.len >= 100) return { key, pts: ch.pts, len: ch.len, partial: !!it.big, up: null, hasEle: false };
    // tuile introuvable : on passe par les serveurs comme avant
  }
  {
    let g = null;
    if (!g) {
      // Waymarked Trails et OpenStreetMap en course : OSM part si Waymarked échoue ou tarde
      // (2,5 s, ou 6 s quand Waymarked a déjà répondu vite ce jour-là) ; la première réponse gagne
      let netFail = false; // OpenStreetMap n'a pas répondu (≠ réponse sans tracé)
      const segs = await new Promise(resolve => {
        let left = 0, done = false, osmGo = false;
        const fin = s => { if (done) return; if (s) { done = true; resolve(s); } else if (--left === 0) { done = true; resolve(null); } };
        const osm = () => {
          if (osmGo || done) return; osmGo = true; left++;
          // grand itinéraire : on ne demande que ses chemins situés dans la zone (index spatial du serveur,
          // très rapide), au lieu de reconstituer tout l'itinéraire puis de le découper
          const b = rtBox(at, rtCut());
          const q = it.big
            ? `[out:json][timeout:25];rel(${it.id})->.r;(way(r.r:"")(${b});way(r.r:"main")(${b});way(r.r:"forward")(${b});way(r.r:"route")(${b}););out geom;`
            : `[out:json][timeout:25];relation(${it.id});out geom;`;
          overpassFast(q, null, true, null, true).then(json => {
            const els = (json && json.elements) || [];
            if (it.big) { const segs = els.filter(e => e.type === 'way' && e.geometry).map(e => e.geometry.filter(Boolean).map(g => ({ lat: g.lat, lon: g.lon }))).filter(s => s.length > 1); fin(segs.length ? segs : null); }
            else { const rel = els.find(e => e.type === 'relation'); fin(rel ? rtSegments(rel) : null); }
          }, () => { netFail = true; fin(null); });
        };
        if (!it.big && rtWmtOk(it) && !rt.wmtDown) {
          left++; const t0 = Date.now(), timer = setTimeout(osm, rt.wmtGood ? 6000 : 2500);
          rtFromWmt(it).then(s => {
            if (s) { rt.wmtFails = 0; if (Date.now() - t0 < 3000) rt.wmtGood = true; clearTimeout(timer); }
            else { rt.wmtFails = (rt.wmtFails || 0) + 1; if (rt.wmtFails >= 2) rt.wmtDown = true; osm(); }
            fin(s);
          });
        } else osm();
      });
      const ch = segs && rtChain(segs);
      if (ch && it.big) { ch.pts = rtClip(ch.pts, at, rtCut()); ch.len = rtLen(ch.pts); }
      if (!segs && netFail) throw new Error('serveurs OpenStreetMap saturés, réessaie dans un moment');
      if (!ch || ch.pts.length < 2 || ch.len < 100) throw new Error('pas de tracé');
      g = { key, pts: ch.pts, len: ch.len, partial: !!(it.big || (it.dist && ch.len < it.dist * 0.8)), up: null, hasEle: false };
    }
    return g;
  }
}
// altitudes du tracé (D+), une seule fois par parcours
function rtElev(g) {
  if (!g.elevP) g.elevP = rtElevate(g.pts).then(e => {
    if (e !== g.pts) { g.pts = e; g.hasEle = true; g.up = makePath(e, '').totalUp; }
    rtSaveGeo(g); return g;
  });
  return g.elevP;
}
// chargement en arrière-plan de toute la liste : petits parcours proches d'abord, 3 à la fois
async function rtEnrich() {
  const gen = ++rt.gen, items = (rt.list || []).slice();
  items.sort((a, b) => (a.big - b.big) || ((a.near ?? 1e9) - (b.near ?? 1e9)));
  let i = 0;
  const worker = async () => {
    while (gen === rt.gen && i < items.length) {
      while (rtLoad && gen === rt.gen) await new Promise(res => setTimeout(res, 300)); // ton choix passe d'abord
      const it = items[i++];
      try { const g = await rtGeom(it); if (gen !== rt.gen) return; rtChanged(); await rtElev(g); } catch { it.fail = true; }
      if (gen === rt.gen) rtChanged();
    }
  };
  await Promise.all([worker()]);
}
let rtChT = 0, rtTouchT = 0, rtTouching = false;
// doigt posé sur le panneau ou défilement en cours : la mise à jour attend un peu
$('rtPanel').addEventListener('touchstart', () => { rtTouching = true; }, { passive: true });
$('rtPanel').addEventListener('touchend', () => { rtTouching = false; rtTouchT = Date.now(); }, { passive: true });
$('rtPanel').addEventListener('touchcancel', () => { rtTouching = false; rtTouchT = Date.now(); }, { passive: true });
$('rtPanel').addEventListener('scroll', () => { rtTouchT = Date.now(); }, { passive: true });
function rtChanged() {
  if (rtChT) return;
  const run = () => {
    if (rtTouching || Date.now() - rtTouchT < 700) { rtChT = setTimeout(run, 400); return; }
    rtChT = 0; if (!$('routes').hidden) rtRender(); rtDraw(); rtBarText();
  };
  rtChT = setTimeout(run, 400);
}

// ---------- Filtres : distance et dénivelé positif ----------
const RT_DF = [['', 'Toutes'], ['0-10', '< 10 km'], ['10-30', '10–30 km'], ['30-60', '30–60 km'], ['60-', '> 60 km']];
const RT_UF = [['', 'Tout'], ['0-200', '< 200 m'], ['200-500', '200–500 m'], ['500-', '> 500 m']];
rt.filt = (() => { try { return JSON.parse(store.get('rtFilt') || '') || { d: '', u: '' }; } catch { return { d: '', u: '' }; } })();
const rtFiltOn = () => !!(rt.filt.d || rt.filt.u);
const rtIn = (v, spec) => { const [a, b] = spec.split('-'); return v >= +a && (b === '' || v < +b); };
// true : correspond, false : écarté, null : pas encore calculé
function rtPass(it) {
  if (!rtFiltOn()) return true;
  const g = rt.geo.get(rtKey(it));
  if (!g) return it.fail ? false : null;
  if (rt.filt.d && !rtIn(g.len / 1000, rt.filt.d)) return false;
  if (rt.filt.u) { if (!g.hasEle) return g.elevP ? null : null; if (!rtIn(g.up, rt.filt.u)) return false; }
  return true;
}
function rtFiltLabel() {
  const d = RT_DF.find(x => x[0] === rt.filt.d), u = RT_UF.find(x => x[0] === rt.filt.u);
  return [rt.filt.d ? d[1] : '', rt.filt.u ? 'D+ ' + u[1] : ''].filter(Boolean).join(' · ');
}
function rtFiltUI() {
  const row = (el, opts, k) => {
    el.innerHTML = '';
    for (const [v, l] of opts) {
      const b = document.createElement('button'); b.textContent = l; b.classList.toggle('on', rt.filt[k] === v);
      b.onclick = () => { rt.filt[k] = v; store.set('rtFilt', JSON.stringify(rt.filt)); rtFiltUI(); rtRender(); rtOverlayMode(); rtDraw(); rtBarText(); };
      el.appendChild(b);
    }
  };
  row($('rtFiltD'), RT_DF, 'd'); row($('rtFiltU'), RT_UF, 'u');
}
function rtProgress() {
  const items = rt.list || [], done = items.filter(it => it.fail || (rt.geo.get(rtKey(it)) || {}).hasEle).length;
  return { done, n: items.length };
}

// ---------- Parcours dessinés par Pisteo (instantanés au toucher, filtrables) ----------
const RT_COL = { gr: '#d7263d', grp: '#e8890c', pr: '#e4b800', ev: '#1f5fd6', vn: '#2f7de1', vr: '#7b3fe4', vl: '#a46be8', vtt: '#7a5230' };
async function rtDraw() {
  await ready;
  const feats = [];
  if (rtMapOn) for (const it of rt.list || []) {
    if (rtPass(it) !== true) continue;
    const g = rt.geo.get(rtKey(it)); if (!g) continue;
    feats.push({ type: 'Feature', properties: { id: it.id, cat: it.cat }, geometry: { type: 'LineString', coordinates: g.pts.map(p => [p.lon, p.lat]) } });
  }
  const data = { type: 'FeatureCollection', features: feats };
  if (!map.getSource('rtv')) {
    map.addSource('rtv', { type: 'geojson', data });
    const col = ['match', ['get', 'cat'], ...Object.entries(RT_COL).flat(), '#7b3fe4'];
    const w = (a, b) => ['interpolate', ['linear'], ['zoom'], 9, a, 16, b];
    map.addLayer({ id: 'rtv-casing', type: 'line', source: 'rtv', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': w(3, 9), 'line-opacity': .8 } }, 'track-casing');
    map.addLayer({ id: 'rtv', type: 'line', source: 'rtv', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': col, 'line-width': w(2, 6) } }, 'track-casing');
  } else map.getSource('rtv').setData(data);
}
// calque Waymarked Trails : complet, mais pas filtrable → affiché seulement sans filtre
function rtOverlayMode() { if (rtMapOn) rtOverlay(true); }
function rtBarText() {
  if ($('rtMapBar').hidden) return;
  const items = rt.list, pr = rtProgress();
  let s;
  if (!items) s = 'Recherche des parcours autour…';
  else if (!items.length) s = `Aucun parcours ${rtBike() ? 'vélo' : 'à pied'} balisé ici.`;
  else {
    const ok = items.filter(it => rtPass(it) === true).length;
    s = rtFiltOn() ? `${ok} parcours sur ${items.length} · ${rtFiltLabel()}` : `${items.length} parcours · touche une ligne pour l'ouvrir`;
    if (pr.done < pr.n) s += ` · calcul ${pr.done}/${pr.n}`;
  }
  $('rtmSub').textContent = s;
}

// ---------- Ouvrir un parcours ----------
let rtLoad = null; // chargement en cours : un nouveau choix l'annule
async function rtOpen(it) {
  if (rtLoad) rtLoad.abort();
  const ctrl = new AbortController(); rtLoad = ctrl;
  closeRoutes(true);
  const cached = rt.geo.get(rtKey(it));
  let tick = 0;
  const stop = () => { clearInterval(tick); if (rtLoad === ctrl) rtLoad = null; };
  if (!cached) {
    const t0 = Date.now(), cancel = { label: 'Annuler', run: () => ctrl.abort() };
    const msg = () => { const s = Math.round((Date.now() - t0) / 1000); return `Chargement de « ${it.name} »… ${s} s${s >= 20 ? ' · serveur lent' : ''}`; };
    toast(msg(), 3000, cancel);
    // on ne change que le texte, pour que le bouton « Annuler » reste touchable
    tick = setInterval(() => {
      if (ctrl.signal.aborted) return;
      const t = $('toast'), txt = t.firstChild;
      if (!t.hidden && txt && txt.nodeType === 3 && t.querySelector('.toast-btn')) { txt.textContent = msg(); clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3000); }
      else toast(msg(), 3000, cancel);
    }, 1000);
  }
  const aborted = new Promise(r => ctrl.signal.addEventListener('abort', () => r('abort')));
  try {
    const g = await Promise.race([rtGeom(it), aborted]);
    if (g === 'abort') throw Object.assign(new Error('annulé'), { cancel: true });
    // altitudes : on les attend au plus 3 s, sinon le parcours s'affiche tout de suite et le D+ arrive ensuite
    const elevP = rtElev(g);
    const r = g.hasEle ? g : await Promise.race([elevP, aborted, new Promise(res => setTimeout(() => res(null), 3000))]);
    if (r === 'abort') throw Object.assign(new Error('annulé'), { cancel: true });
    stop(); if (!cached) $('toast').hidden = true;
    const show = (pts, upd) => rtShow(it, rtOrient(pts, me || it.at), g.partial, upd);
    show(g.pts);
    if (!g.hasEle) { const shown = rt.res; elevP.then(e => { if (e.hasEle && rt.res === shown && !nav) show(e.pts, true); }); }
  } catch (e) {
    stop();
    if (e.cancel) { if (!rtLoad) { toast('Chargement annulé', 2000); if (rtMapOn) rtSheetOpen(true); } return; }
    it.fail = true; if (rtMapOn) rtSheetOpen(true);
    toast(navigator.onLine === false ? 'Pas de réseau : impossible de charger le parcours.' : e.message === 'pas de tracé' ? 'Ce parcours n\'a pas de tracé exploitable dans OpenStreetMap.' : `Chargement impossible (${e.message}).`, 5000);
  }
}

function rtShow(it, pts, partial, update) {
  const name = it.name + (partial ? ' (portion)' : '');
  const text = loopGPX(pts, name);
  if (update) { try { showTrack(parseGPX(text)); } catch { return; } } else loadText(text, false);
  store.set('gpx', text);
  const p = makePath(pts, ''), est = loopEst(p);
  rt.res = { text, name };
  $('rtbTitle').textContent = name;
  $('rtbSub').textContent = `${RT_CAT[it.cat].label} · ${fmtDist(p.total)}${p.hasEle ? ' · D+ ' + fmtM(p.totalUp) : ''} · environ ${fmtDur(est)}` + (partial ? ` · portion autour ${rt.fromMap || !me ? 'du point choisi' : 'de toi'}` : '');
  if (!update) { $('rtbKeep').textContent = 'Garder'; $('rtbKeep').disabled = false; }
  $('rtBar').hidden = false;
  if (update) return;
  setTimeout(() => { try { map.fitBounds(boundsOf([pts]), { padding: { top: 80, bottom: $('sheet').offsetHeight + $('rtBar').offsetHeight + 30, left: 30, right: 70 }, bearing: 0, pitch: 0, duration: 600 }); } catch {} }, 350);
}
$('destRoutes').onclick = rtShowOnMap;
$('rtClose').onclick = () => { rtHideMap(); closeRoutes(); };
$('routes').onclick = e => { if (e.target === $('routes')) closeRoutes(); };
// sécurité : menu principal ouvert (Réglages, Ouvrir un GPX…) sans parcours affiché → on quitte les parcours balisés
setInterval(() => { if (rtMapOn && $('routes').hidden && $('rtBar').hidden && !rtLoad && !rt.tapBusy) rtHideMap(); }, 1000);
$('rtFoot').onclick = () => { if (!rtBike()) return; setProfile('hiking-mountain', true); rtUI(); rtSearch(); if (rtMapOn) rtOverlay(true); };
$('rtBike').onclick = () => { if (rtBike()) return; setProfile('trekking', true); rtUI(); rtSearch(); if (rtMapOn) rtOverlay(true); };
// ---------- La recherche suit la carte ----------
// Quand la carte s'arrête assez loin de la zone déjà cherchée (plus de la moitié du rayon :
// 6 km à pied, 10 km à vélo), les parcours de la nouvelle zone sont cherchés tout seuls.
let rtMoveT = 0;
function rtCheckMoved() {
  clearTimeout(rtMoveT);
  rtMoveT = setTimeout(() => {
    if ($('routes').hidden || nav || !rt.at || map.getZoom() < 8.5) return;
    if (rt.sel || !$('rtPick').hidden || rt.tapped) return; // aperçu ouvert : on ne change rien
    const c = map.getCenter();
    if (hav({ lat: c.lat, lon: c.lng }, rt.at) <= rtRadius() * 0.5) return;
    rt.fromMap = true; rtSearch();
  }, 700);
}
map.on('moveend', rtCheckMoved);
// ---------- Chercher un lieu : la carte s'y déplace et les parcours de là-bas s'affichent ----------
let rtQT = 0, rtQSeq = 0;
function rtQClear() { $('rtQList').innerHTML = ''; $('rtQList').hidden = true; }
$('rtQ').oninput = () => {
  clearTimeout(rtQT);
  const q = $('rtQ').value.trim();
  if (q.length < 3) { rtQClear(); return; }
  rtQT = setTimeout(() => rtQSearch(q), 300);
};
$('rtQ').onkeydown = e => { if (e.key === 'Enter') { const b = $('rtQList').querySelector('button'); if (b) b.click(); } };
async function rtQSearch(q) {
  const seq = ++rtQSeq, c = (() => { const m = map.getCenter(); return { lat: m.lat, lon: m.lng }; })();
  let res = [];
  try {
    if (navigator.onLine === false) throw new Error('hors ligne');
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 8000);
    const [ign, ph] = await Promise.all([
      fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=5&lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}`, { signal: ctrl.signal }).then(r => r.json())
        .then(j => (j.features || []).map(f => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: f.properties.label, sub: f.properties.context || '' }))).catch(() => []),
      searchPhoton(q, c, ctrl.signal).catch(() => []),
    ]);
    clearTimeout(timer);
    res = [...ign, ...ph.slice(0, 3)];
    if (!res.length) throw new Error('rien');
  } catch {
    res = (await searchLocalPlaces(q, c)).map(p => ({ lat: p.lat, lon: p.lon, name: p.nom, sub: p.cp ? p.cp + ' · commune' : 'localité' }));
  }
  if (seq !== rtQSeq) return;
  const list = $('rtQList'); list.innerHTML = '';
  if (!res.length) { list.innerHTML = '<li class="note">Aucun lieu trouvé.</li>'; list.hidden = false; return; }
  for (const p of res.slice(0, 7)) {
    const li = document.createElement('li'), b = document.createElement('button');
    b.className = 'lib-item'; b.innerHTML = '<b></b><span></span>';
    b.querySelector('b').textContent = p.name; b.querySelector('span').textContent = p.sub;
    b.onclick = () => {
      rtQClear(); $('rtQ').value = p.name; $('rtQ').blur();
      rt.fromMap = true; rt.at = null;
      map.jumpTo({ center: [p.lon, p.lat], zoom: rtBike() ? 11.5 : 12.5, pitch: 0, bearing: 0 });
      rtSetCollapsed(true); rtSearch();
    };
    li.appendChild(b); list.appendChild(li);
  }
  list.hidden = false;
}
// « Autres parcours » : le parcours regardé est retiré de la carte (il reste dans « Mes traces » s'il a été gardé)
$('rtbBack').onclick = () => {
  $('rtBar').hidden = true;
  if (rtMapOn) { rtSheetOpen(true); rtRender(); } else openRoutes();
  if (track && rt.res && track.name.startsWith(rt.res.name)) closeTrack(true);
};
$('rtbKeep').onclick = async () => { if (!rt.res || !track) return; await saveRecent(track, rt.res.text); $('rtbKeep').textContent = 'Gardé ✓'; $('rtbKeep').disabled = true; refreshSaveBtn(); toast('Parcours gardé dans « Mes traces »', 3000); };
$('rtbGo').onclick = () => { $('rtBar').hidden = true; startNav(); };

// ---------- Aperçu d'un parcours sans quitter la recherche ----------
// Toucher un parcours (sur la carte ou dans la liste) le met en évidence et affiche, en bas,
// son nom, sa longueur, son D+ et son profil. Toucher une autre ligne change d'aperçu directement.
rt.sel = null;
const rtColor = it => RT_COL[it.cat] || '#7b3fe4';
async function rtSelDraw(feats) {
  await ready;
  const data = { type: 'FeatureCollection', features: feats || [] };
  if (!map.getSource('rtsel')) {
    map.addSource('rtsel', { type: 'geojson', data });
    const w = (a, b) => ['interpolate', ['linear'], ['zoom'], 9, a, 16, b];
    map.addLayer({ id: 'rtsel-casing', type: 'line', source: 'rtsel', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': w(7, 16) } }, 'track-casing');
    map.addLayer({ id: 'rtsel', type: 'line', source: 'rtsel', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'col'], 'line-width': w(4, 10) } }, 'track-casing');
  } else map.getSource('rtsel').setData(data);
}
const rtFeat = (it, pts) => ({ type: 'Feature', properties: { col: rtColor(it) }, geometry: { type: 'LineString', coordinates: pts.map(p => [p.lon, p.lat]) } });
function rtCardMode(mode) { // null | 'pick' | 'prev'
  $('rtPick').hidden = mode !== 'pick'; $('rtPrev').hidden = mode !== 'prev';
  $('routes').classList.toggle('has-card', !!mode);
  if (!$('routes').hidden) rtSetCollapsed(true);
}
function rtUnselect() { rt.sel = null; rt.selPts = null; rtSelDraw([]); rtCardMode(null); rtRender(); }
function rtMiniProfile(cv, p) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = cssVar('--muted'); ctx.textBaseline = 'middle';
  if (!p || !p.hasEle) { ctx.fillText(p ? tr('Calcul du profil…') : '', 0, H / 2); return; }
  const E = p.ele, C = p.cum, n = E.length;
  let lo = Infinity, hi = -Infinity; E.forEach(e => { if (e != null) { lo = Math.min(lo, e); hi = Math.max(hi, e); } });
  const pad = Math.max(10, (hi - lo) * .1, (40 - (hi - lo)) / 2); const lo2 = lo - pad, hi2 = hi + pad; // au moins 40 m d'échelle
  const L0 = 34, B = 14, w = W - L0 - 2, h = H - B - 2;
  const X = d => L0 + d / p.total * w, Y = e => 2 + (1 - (e - lo2) / (hi2 - lo2)) * h;
  ctx.textAlign = 'right'; ctx.fillText(fmtM(hi), L0 - 4, Y(hi)); if (Y(lo) - Y(hi) > 14) ctx.fillText(fmtM(lo), L0 - 4, Y(lo));
  ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'; ctx.fillText('0', L0, H); ctx.textAlign = 'right'; ctx.fillText(fmtDist(p.total), W, H);
  const col = cssVar('--go') || '#2f6b4f', path = new Path2D(); let first = true;
  const stride = Math.max(1, Math.floor(n / (w * 2)));
  for (let i = 0; i < n; i += stride) { if (E[i] == null) continue; first ? path.moveTo(X(C[i]), Y(E[i])) : path.lineTo(X(C[i]), Y(E[i])); first = false; }
  const area = new Path2D(path); area.lineTo(X(p.total), 2 + h); area.lineTo(L0, 2 + h); area.closePath();
  ctx.fillStyle = col; ctx.globalAlpha = .18; ctx.fill(area); ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(path);
}
function rtPrevFill(it, pts, partial) {
  const p = makePath(pts, it.name);
  rt.selPts = pts; rt.selPartial = partial;
  $('rtpDot').style.background = rtColor(it);
  $('rtpTitle').textContent = it.name + (partial ? ' (portion)' : '');
  $('rtpSub').textContent = `${RT_CAT[it.cat].label} · ${fmtDist(p.total)}${p.hasEle ? ' · D+ ' + fmtM(p.totalUp) : ''} · ${fmtDur(loopEst(p))}`;
  rtMiniProfile($('rtpProf'), p);
}
async function rtSelect(it) {
  rt.sel = it; rt.selPts = null;
  if ($('routes').hidden) rtSheetOpen(true);
  $('rtpDot').style.background = rtColor(it); $('rtpTitle').textContent = it.name;
  $('rtpSub').textContent = 'Chargement du tracé…'; rtMiniProfile($('rtpProf'), null);
  $('rtpGo').disabled = $('rtpKeep').disabled = true; $('rtpKeep').textContent = 'Garder';
  rtCardMode('prev');
  let g;
  try { g = await rtGeom(it); }
  catch (e) {
    if (rt.sel !== it) return;
    $('rtpSub').textContent = e.message === 'pas de tracé' ? 'Pas de tracé exploitable pour ce parcours.' : navigator.onLine === false ? 'Pas de réseau.' : `Chargement impossible (${e.message}).`;
    return;
  }
  if (rt.sel !== it) return; // un autre parcours a été choisi entre-temps
  const pts = rtOrient(g.pts, me || it.at);
  rtSelDraw([rtFeat(it, pts)]);
  rtPrevFill(it, pts, g.partial);
  $('rtpGo').disabled = $('rtpKeep').disabled = false;
  // toute la ligne visible au-dessus du panneau
  setTimeout(() => { try { map.fitBounds(boundsOf([pts]), { padding: { top: 90, bottom: rtPeek() + 30, left: 30, right: 70 }, bearing: 0, pitch: 0, duration: 600, maxZoom: 15 }); } catch {} }, 80);
  rtRender();
  if (!g.hasEle) rtElev(g).then(e => { if (rt.sel === it && e.hasEle) rtPrevFill(it, rtOrient(e.pts, me || it.at), g.partial); });
}
// plusieurs parcours au même endroit : petite liste claire, chaque parcours mis en évidence sur la carte
function rtChoose(items) {
  rt.sel = null; rt.selPts = null;
  if ($('routes').hidden) rtSheetOpen(true);
  const list = $('rtPickList'); list.innerHTML = '';
  const feats = [];
  for (const it of items) {
    const g = rt.geo.get(rtKey(it));
    if (g) feats.push(rtFeat(it, g.pts));
    const b = document.createElement('button');
    b.innerHTML = '<span class="rt-dot"></span><span class="t"><b></b><small></small></span>';
    b.querySelector('.rt-dot').style.background = rtColor(it);
    b.querySelector('b').textContent = it.name;
    b.querySelector('small').textContent = [RT_CAT[it.cat].label, g ? fmtDist(g.len) + (g.partial ? ' (portion)' : '') : it.dist ? fmtDist(it.dist) : '', g && g.hasEle ? 'D+ ' + fmtM(g.up) : ''].filter(Boolean).join(' · ');
    b.onclick = () => rtSelect(it);
    list.appendChild(b);
  }
  rtSelDraw(feats);
  rtCardMode('pick');
}
$('rtpClose').onclick = rtUnselect;
$('rtPickClose').onclick = rtUnselect;
$('rtpGo').onclick = () => {
  if (!rt.sel || !rt.selPts) return;
  const it = rt.sel, name = it.name + (rt.selPartial ? ' (portion)' : ''), text = loopGPX(rt.selPts, name);
  rt.res = { text, name };
  rtUnselect(); closeRoutes();
  loadText(text, false); store.set('gpx', text);
  startNav();
};
$('rtpKeep').onclick = async () => {
  if (!rt.sel || !rt.selPts) return;
  const name = rt.sel.name + (rt.selPartial ? ' (portion)' : ''), text = loopGPX(rt.selPts, name);
  await saveRecent(makePath(rt.selPts, name), text);
  $('rtpKeep').textContent = 'Gardé ✓'; $('rtpKeep').disabled = true;
  toast('Parcours gardé dans « Mes traces »', 3000);
};
$('rtToggle').onclick = () => rtSetCollapsed(!rtSheet.collapsed);

// ---------- Nord en haut : la boussole apparaît dès que la carte est tournée ou inclinée ----------
function northUI() {
  const b = map.getBearing(), tilt = map.getPitch();
  $('btnNorth').hidden = Math.abs(b) < 1 && tilt < 1;
  $('northNeedle').style.transform = `rotate(${-b}deg)`;
}
map.on('rotate', northUI); map.on('pitch', northUI);
$('btnNorth').onclick = () => {
  if (nav) setFollow(false); // en navigation, la carte arrête de tourner avec toi
  map.easeTo({ bearing: 0, pitch: 0, duration: 400 });
};

// ---------- Parcours balisés dessinés sur la carte (calque Waymarked Trails, données OpenStreetMap) ----------
// Un calque d'images transparent : aussi rapide que le fond de carte, rien à calculer.
// Toucher une ligne cherche quels parcours passent là (petite demande) et les propose.
var rtMapOn = false; // var : lu aussi par du code placé plus haut
const WMT_ATTR = 'Parcours <a href="https://waymarkedtrails.org" target="_blank">© waymarkedtrails.org</a> (CC BY-SA)';
async function rtOverlay(on) {
  await ready;
  for (const k of [0, 1]) { if (map.getLayer('wmt-' + k)) map.removeLayer('wmt-' + k); if (map.getSource('wmt-' + k)) map.removeSource('wmt-' + k); }
  rtMapOn = on;
  $('rtmMode').textContent = rtBike() ? 'Voir à pied' : 'Voir à vélo';
  rtDraw();
  if (!on || rtFiltOn()) return;
  const kinds = rtBike() ? ['cycling', 'mtb'] : ['hiking'];
  // juste au-dessus du fond de carte, sous les zones téléchargées et la trace
  const before = map.getLayer('packs-fill') ? 'packs-fill' : 'track-casing';
  kinds.forEach((kd, k) => {
    map.addSource('wmt-' + k, { type: 'raster', tiles: [`https://tile.waymarkedtrails.org/${kd}/{z}/{x}/{y}.png`], tileSize: 256, minzoom: 0, maxzoom: 18, attribution: WMT_ATTR });
    // le calque VTT passe sous les véloroutes ; tout disparaît en vue très éloignée pour rester lisible
    map.addLayer({ id: 'wmt-' + k, type: 'raster', source: 'wmt-' + k, minzoom: 8, paint: { 'raster-opacity': .9 } }, k ? 'wmt-0' : before);
  });
}
function rtShowOnMap() {
  if (nav) { toast('Quitte d\'abord la navigation.'); return; }
  rtOverlay(true);
  rt.tapped = false; rtSheetOpen(true);
  const go = (moveMap = true) => {
    const c = rtHere();
    if (moveMap) map.easeTo({ center: [c.lon, c.lat], zoom: Math.max(Math.min(map.getZoom(), 14), rtBike() ? 11.5 : 12.5), pitch: 0, bearing: 0, duration: 700 });
    const key = profile + ':' + c.lat.toFixed(2) + ',' + c.lon.toFixed(2);
    if (rt.list && rt.key === key) { rtRender(); rtDraw(); } else rtSearch();
  };
  if (!me && !rt.fromMap && startGPS()) {
    // GPS pas encore prêt : on part tout de suite de ta dernière position connue, puis on corrige si besoin
    rt.prov = rtLastPos();
    if (rt.prov) go(); else { $('rtStatus').textContent = 'Recherche de ta position…'; rtSetCollapsed(true); }
    const prov = rt.prov;
    waitFix(20000).then(pos => {
      rt.prov = null;
      if ($('routes').hidden || rt.fromMap) return;
      if (!pos) { if (!prov) { $('rtStatus').textContent = 'Position GPS introuvable : déplace la carte ou cherche un lieu.'; } return; }
      if (!prov || hav(pos, prov) > 1500) go();
    });
  } else go();
}
function rtHideMap() { rtOverlay(false); }
async function rtTap(p) {
  if (rt.tapBusy) return;
  const sel = rtBike() ? '["route"~"^(bicycle|mtb)$"]' : '["route"~"^(hiking|foot)$"]';
  // rayon de toucher : environ 25 pixels à l'écran
  const r = Math.round(clamp(25 * 156543 * Math.cos(rad(p.lat)) / Math.pow(2, map.getZoom()), 15, 400));
  const q = `[out:json][timeout:25];way(around:${r},${p.lat.toFixed(6)},${p.lon.toFixed(6)})->.w;rel(bw.w)["type"="route"]${sel}->.a;`
    + `relation.a["network"~"^(icn|ncn|rcn|iwn|nwn|rwn)$"]->.g;(.a; - .g;)->.p;.g out tags;.p out tags bb;`;
  rt.tapBusy = true; toast('Recherche du parcours touché…', 8000);
  let json;
  try { json = await overpassFast(q, null, true, null, true); }
  catch (e) { toast(navigator.onLine === false ? 'Pas de réseau.' : `Recherche impossible (${e.message}).`, 4000); return; }
  finally { rt.tapBusy = false; }
  const items = rtListFrom(json, p);
  if (!items.length) { toast('Aucun parcours balisé à cet endroit : touche une ligne de couleur.', 3500); return; }
  if (items.length === 1) { $('toast').hidden = true; rtSelect(items[0]); return; }
  $('toast').hidden = true;
  rtChoose(items);
}
$('rtShowMap').onclick = () => { if (!rtMapOn) rtOverlay(true); rt.tapped = false; rtRender(); rtDraw(); rtSetCollapsed(true); };
$('rtmList').onclick = () => { $('rtMapBar').hidden = true; openRoutes(); };
$('rtmHide').onclick = rtHideMap;
$('rtmMode').onclick = () => { setProfile(rtBike() ? 'hiking-mountain' : 'trekking', true); rtUI(); rtOverlay(true); rtSearch(); toast(rtBike() ? 'Parcours vélo et VTT' : 'Parcours à pied', 2000); };

// =====================================================================
// Tracer un itinéraire point par point : chaque toucher sur la carte ajoute un point,
// relié au précédent par les chemins (BRouter, ou chemins téléchargés), ou en ligne droite
// =====================================================================
var planning = false;
const plan = { wps: [], segs: [], straight: false, queue: Promise.resolve(), busy: 0, mks: [], dragging: -1 };
// points déplaçables : un marqueur par point (glisser pour déplacer, toucher pour supprimer)
function planMarkers() {
  while (plan.mks.length > plan.wps.length) plan.mks.pop().remove();
  while (plan.mks.length < plan.wps.length) {
    const el = document.createElement('div'); el.className = 'plan-wp';
    const mk = new maplibregl.Marker({ element: el, draggable: true });
    mk.on('dragstart', () => { plan.dragging = plan.mks.indexOf(mk); el.classList.add('drag'); });
    mk.on('dragend', () => {
      const k = plan.mks.indexOf(mk); el.classList.remove('drag'); plan.dragging = -1;
      if (k < 0) return;
      const ll = mk.getLngLat(); plan.wps[k] = { lat: ll.lat, lon: ll.lng };
      el.dataset.moved = '1'; setTimeout(() => { delete el.dataset.moved; }, 300);
      if (k > 0) planSeg(k - 1);
      if (k < plan.wps.length - 1) planSeg(k);
      planDraw();
    });
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      if (el.dataset.moved) return;
      const k = plan.mks.indexOf(mk); if (k < 0) return;
      toast(k === 0 ? 'Point de départ' : k === plan.wps.length - 1 ? 'Dernier point' : `Point ${k + 1}`, 4000, { label: 'Supprimer', run: () => planRemove(k) });
    });
    mk.setLngLat([0, 0]).addTo(map);
    plan.mks.push(mk);
  }
  plan.mks.forEach((mk, k) => {
    const w = plan.wps[k], el = mk.getElement();
    if (k !== plan.dragging) mk.setLngLat([w.lon, w.lat]);
    el.classList.toggle('start', k === 0); el.classList.toggle('end', k > 0 && k === plan.wps.length - 1);
  });
}
// (re)calcul du segment i, entre les points i et i+1
function planSeg(i, straight) {
  const a = plan.wps[i], b = plan.wps[i + 1], old = plan.segs[i];
  const st = straight != null ? straight : old ? !!old.straight : plan.straight;
  const seg = { pts: [a, b], pending: true, straight: st, style: old && old.style };
  plan.segs[i] = seg; plan.busy++;
  plan.queue = plan.queue.then(async () => {
    if (plan.segs.includes(seg)) await planSegment(a, b, st, seg);
    plan.busy--; if (planning) planDraw();
  });
}
function planRemove(k) {
  if (plan.go && k === 0) { toast('Le départ, c\'est ta position', 2500); return; } // aller vers un lieu : le départ reste
  const n = plan.wps.length;
  plan.wps.splice(k, 1);
  if (n <= 1) { plan.segs = []; }
  else if (k === 0) plan.segs.shift();
  else if (k === n - 1) plan.segs.pop();
  else { plan.segs.splice(k - 1, 2, null); planSeg(k - 1); }
  planDraw();
}
// go : aller vers un lieu (départ = ma position, arrivée = le lieu), avec « Naviguer » au lieu d'« Enregistrer »
// pendant qu'on prépare un autre trajet, la trace ouverte est masquée (une seule trace à l'écran) ;
// « Quitter » la fait réapparaître, « Naviguer » / « Aperçu » / « Enregistrer » la remplacent par le nouveau trajet
function trackShown(on) {
  for (const id of ['track', 'track-casing']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  if (!on) { startMk.remove(); endMk.remove(); }
  else if (track) { startMk.addTo(map); endMk.addTo(map); }
}
function openPlan(go, from, restore) {
  if (nav) { toast('Quitte d\'abord la navigation.'); return; }
  closeDest(); closeLib(); toggleMore(false, true); $('loopBar').hidden = true;
  planning = true; document.body.classList.add('plan'); planModeUI();
  trackShown(false);
  plan.go = go && go.label ? go : null;
  $('ptDoneL').textContent = plan.go ? 'Naviguer' : 'Enregistrer';
  $('ptView').hidden = false; // aperçu aussi pour le tracé point par point
  plan.wps = []; plan.segs = [];
  if (restore) { // retour depuis l'aperçu : les points et le tracé tels qu'on les avait laissés
    plan.wps = restore.wps; plan.segs = restore.segs; plan.straight = restore.straight; planDraw();
    fitBoth([planAll()], () => $('planTools').offsetHeight + 10); return;
  }
  if (plan.go && go.lat == null) plan.wps = [{ lat: from.lat, lon: from.lon }]; // arrivée à placer
  else if (plan.go) {
    plan.wps = [{ lat: from.lat, lon: from.lon }, { lat: plan.go.lat, lon: plan.go.lon }];
    planSeg(0, false); plan.segs[0].fit = true;
    fitBoth([plan.wps], () => $('planTools').offsetHeight + 10);
  }
  planDraw();
  if ((!plan.go || plan.wps.length < 2) && me) map.easeTo({ center: [me.lon, me.lat], zoom: Math.max(map.getZoom(), 14), pitch: 0, bearing: 0, duration: 600 });
}
function closePlan() { trackShown(true); routeLabels([]); planning = false; plan.go = null; document.body.classList.remove('plan'); plan.wps = []; plan.segs = []; planMarkers(); setSrc('plan', EMPTY); }
$('destPlan').onclick = () => openPlan();
$('pbClose').onclick = () => {
  closePlan();
};
// calcule le segment ; à vélo, les versions tranquille et rapide sont calculées ensemble,
// et si elles diffèrent vraiment, l'autre reste affichée en gris : la toucher la choisit
async function planSegment(a, b, straight, seg) {
  seg.alt = null; seg.pending = false;
  if (straight) { seg.pts = [a, b]; return; }
  if (profile !== 'trekking') {
    try { seg.pts = await routeVia([a, b], 25000); }
    catch { toast('Pas de chemin trouvé ici : segment en ligne droite', 2500); seg.pts = [a, b]; }
    return;
  }
  const { kept } = await bikeVariants(s => routeVia([a, b], 25000, s)), keys = Object.keys(kept);
  if (!keys.length) { toast('Pas de chemin trouvé ici : segment en ligne droite', 2500); seg.pts = [a, b]; return; }
  if (keys.length > 1) {
    seg.alt = kept; seg.fit = true;
    if (!keys.includes(seg.style)) seg.style = keys[0];
    seg.pts = kept[seg.style];
    toast(`${keys.length} itinéraires possibles : touche une étiquette grise pour changer`, 5000);
  } else { seg.style = keys[0]; seg.pts = kept[keys[0]]; }
}
function planSwap(seg, s) {
  if (!seg || !seg.alt || !seg.alt[s] || !plan.segs.includes(seg)) return;
  seg.style = s; seg.pts = seg.alt[s];
  planDraw();
  toast(`Itinéraire ${styleName(seg.style)} choisi`, 2000);
}
// parcours bouclé : le dernier point est le départ
const planLooped = () => { const w = plan.wps, n = w.length; return n > 2 && w[0].lat === w[n - 1].lat && w[0].lon === w[n - 1].lon; };
function planAdd(p, closing) {
  // bouclé : le nouveau point s'insère avant le retour au départ, la boucle reste fermée
  if (!closing && !plan.go && planLooped()) { plan.wps.pop(); plan.segs.pop(); planAdd(p, true); planAdd(Object.assign({}, plan.wps[0]), true); return; }
  const prev = plan.wps[plan.wps.length - 1];
  plan.wps.push(p);
  if (!prev) { planDraw(); return; }
  const st = plan.straight, seg = { pts: [prev, p], pending: true, straight: st };
  plan.segs.push(seg);
  planDraw();
  plan.busy++;
  plan.queue = plan.queue.then(async () => {
    // segment annulé entre-temps : on ne calcule rien
    if (plan.segs.includes(seg)) await planSegment(prev, p, st, seg);
    plan.busy--; if (planning) planDraw();
  });
}
function planAll() { const out = []; plan.segs.forEach((sg, k) => out.push(...(k ? sg.pts.slice(1) : sg.pts))); return out; }
function planDraw() {
  const feats = plan.segs.map(sg => ({ type: 'Feature', properties: { pending: !!sg.pending }, geometry: { type: 'LineString', coordinates: sg.pts.map(q => [q.lon, q.lat]) } }));
  // l'autre version (tranquille / rapide), en gris sous le tracé choisi
  const lbls = [];
  plan.segs.forEach((sg, k) => {
    if (sg.fit && !sg.pending && !sg.alt) { delete sg.fit; fitBoth([sg.pts], () => $('planTools').offsetHeight + 10); }
    if (!sg.alt) return;
    const keys = Object.keys(sg.alt), lab = s => `${BIKE[s].name} · ${fmtDist(makePath(sg.alt[s], '').total)}`;
    const other = s => sg.alt[s === sg.style ? keys.find(x => x !== s) : sg.style];
    for (const s of keys) {
      if (s === sg.style) lbls.push({ pt: farPoint(sg.alt[s], other(s)), text: lab(s), col: '#7B3FE4', on: true });
      else {
        lbls.push({ pt: farPoint(sg.alt[s], other(s)), text: lab(s), col: '#6b7079', run: () => planSwap(sg, s) });
        feats.unshift({ type: 'Feature', properties: { alt: k, s }, geometry: { type: 'LineString', coordinates: sg.alt[s].map(q => [q.lon, q.lat]) } });
      }
    }
    if (sg.fit) { delete sg.fit; fitBoth(Object.values(sg.alt), () => $('planTools').offsetHeight + 10); }
  });
  routeLabels(lbls);
  setSrc('plan', { type: 'FeatureCollection', features: feats });
  planMarkers();
  const n = plan.wps.length, all = planAll();
  if (!n) { $('pbStats').textContent = 'Touche la carte pour placer le départ'; }
  else if (n === 1) { $('pbStats').textContent = plan.go ? 'Touche la carte à l\'endroit où tu veux aller' : 'Départ placé · touche le point suivant'; }
  else {
    const pth = makePath(all, '');
    $('pbStats').textContent = (plan.go ? `Vers ${plan.go.label} · ` : '') + `${fmtDist(pth.total)}${pth.hasEle ? ' · D+ ' + fmtM(pth.totalUp) : ''}` + (plan.go ? '' : ` · ${n} points`) + (plan.busy ? ' · calcul…' : '');
  }
  $('pbHint').textContent = plan.go ? (n < 2 ? 'Départ : ta position · l\'itinéraire suit les chemins' : 'Touche la carte pour ajouter un passage · Naviguer pour partir') : (plan.straight ? 'Ligne droite' : 'Suit les chemins') + (n > 1 ? ' · glisse un point pour le déplacer, touche-le pour le supprimer' : ' · chaque toucher ajoute un point');
  $('ptUndo').disabled = plan.go ? n < 2 : !n; $('ptClear').disabled = plan.go ? n < 2 : !n; $('ptLoop').disabled = n < 2 && !planLooped(); $('ptDone').disabled = n < 2; $('ptView').disabled = n < 2;
  $('ptLoop').classList.toggle('on', planLooped()); $('ptLoopL').textContent = planLooped() ? 'Bouclé' : 'Boucler';
  $('ptModeL').textContent = plan.straight ? 'Ligne droite' : 'Chemins';
}
// à pied / à vélo : les segments qui suivent les chemins sont recalculés pour le nouveau mode
function planMode(p) {
  if (profile === p) return;
  setProfile(p, true); planModeUI();
  plan.segs.forEach((sg, i) => { if (sg && !sg.straight) planSeg(i); });
  planDraw();
  toast(p === 'trekking' ? 'Itinéraire recalculé pour le vélo' : 'Itinéraire recalculé à pied', 2500);
}
function planModeUI() { $('pbFoot').classList.toggle('on', profile !== 'trekking'); $('pbBike').classList.toggle('on', profile === 'trekking'); }
$('pbFoot').onclick = () => planMode('hiking-mountain');
$('pbBike').onclick = () => planMode('trekking');
$('ptUndo').onclick = () => { if (plan.go && plan.wps.length <= 1) return; plan.wps.pop(); plan.segs.length = Math.max(0, plan.wps.length - 1); planDraw(); };
$('ptClear').onclick = () => { plan.wps = plan.go ? plan.wps.slice(0, 1) : []; plan.segs = []; planDraw(); }; // aller vers un lieu : on garde le départ (ma position)
$('ptMode').onclick = () => { plan.straight = !plan.straight; planDraw(); toast(plan.straight ? 'Les prochains points seront reliés en ligne droite' : 'Les prochains points suivront les chemins', 2500); };
// Boucler : retour au départ ajouté (et gardé si on ajoute des points) ; toucher encore pour l'enlever
$('ptLoop').onclick = () => {
  if (planLooped()) { plan.wps.pop(); plan.segs.pop(); planDraw(); toast('Retour au départ enlevé', 2000); return; }
  if (plan.wps.length > 1) { planAdd(Object.assign({}, plan.wps[0]), true); toast('Boucle fermée : les points ajoutés se placeront avant le retour au départ', 3500); }
};
$('ptDone').onclick = async () => {
  if (plan.wps.length < 2) return;
  $('ptDone').disabled = true;
  await plan.queue;
  if (plan.go) { planGo(); return; }
  const pts = removeSpurs(planAll()), pth = makePath(pts, '');
  const def = `Itinéraire ${profile === 'trekking' ? 'à vélo' : 'à pied'} de ${fmtDist(pth.total)}`;
  const name = (prompt(tr('Nom de l\'itinéraire'), def) || def).trim();
  const text = loopGPX(pts, name);
  closePlan();
  loadText(text); // affiché, et gardé dans « Mes traces »
  toast(`Itinéraire enregistré dans « Mes traces »`, 4000, { label: 'Voir', run: openLib });
};
// appui long sur la carte : y aller
map.on('contextmenu', e => {
  if (planning) return;
  const d = { lat: e.lngLat.lat, lon: e.lngLat.lng, label: 'le point choisi' };
  toast(me ? `À ${fmtDist(hav(me, d))} à vol d'oiseau` : 'Point choisi', 6000, { label: 'Y aller', run: () => goTo(d) });
});

// lancer la navigation vers le lieu tracé dans l'écran d'itinéraire
// go = false : le parcours s'affiche dans l'aperçu (enregistrer, inverser, montre…), « Naviguer » pour partir
async function planGo(go = true) {
  const last = plan.wps[plan.wps.length - 1], dest = { lat: last.lat, lon: last.lon, label: plan.go.label };
  const sg = plan.segs[0], simple = plan.wps.length === 2 && sg && !sg.straight;
  const style = simple && profile === 'trekking' ? sg.style || null : null;
  const pts = removeSpurs(planAll()), signals = plan.segs.flatMap(s => (s && s.pts.signals) || []);
  const back = go ? null : { go: plan.go, wps: plan.wps.map(w => Object.assign({}, w)), segs: plan.segs, straight: plan.straight };
  closePlan();
  await showTrack({ name: 'Vers ' + dest.label, pts, signals }, true);
  // trajet direct : recalculé tout seul si on s'en écarte
  if (simple) { track.route = dest; track.style = style; }
  if (!go) { track.planBack = back; toast('Parcours prêt : « Naviguer » pour partir', 3500); return; }
  toast(`${fmtDist(track.total)} jusqu'à ${dest.label} ${profile === 'trekking' ? 'à vélo' + (style ? ', itinéraire ' + styleName(style) : '') : 'à pied'}`, 4000);
  startNav();
}
$('ptView').onclick = async () => {
  if (plan.wps.length < 2) return;
  $('ptView').disabled = true; await plan.queue;
  if (plan.go) { planGo(false); return; }
  // tracé point par point : affiché dans l'aperçu (pas encore dans « Mes traces » : bouton Enregistrer) ;
  // fermer l'aperçu ramène au placement des points
  const pts = removeSpurs(planAll());
  const name = `Itinéraire ${profile === 'trekking' ? 'à vélo' : 'à pied'}`; // la distance s'affiche déjà à côté
  const back = { go: null, wps: plan.wps.map(w => Object.assign({}, w)), segs: plan.segs, straight: plan.straight };
  closePlan();
  loadText(loopGPX(pts, name), false);
  if (track) track.planBack = back;
  toast('Aperçu : « Enregistrer » pour le garder, ✕ pour revenir au tracé', 4000);
};
async function goTo(dest) {
  closeDest();
  if (!startGPS()) return;
  toast('Recherche de ta position…', 20000);
  const pos = await waitFix(20000);
  if (!pos) { toast('Position GPS introuvable. Va à découvert et réessaie.', 5000); return; }
  clearTimeout(toastT); $('toast').hidden = true;
  if (!nav) { openPlan(dest, pos); return; }
  // en pleine navigation : itinéraire direct (type préféré), sans quitter le guidage
  toast('Calcul de l\'itinéraire…', 20000);
  const wait = Math.round(clamp(25 + hav(pos, dest) / 1000 * 0.4, 25, 120));
  let r = null;
  try { r = await fetchRoute(pos, dest, wait * 1000); }
  catch { await loadGraphs(); r = localRouteTo(pos, dest); }
  if (!r) { toast('Itinéraire impossible pour l\'instant, réessaie dans un instant.', 5000); return; }
  r.pts.push({ lat: dest.lat, lon: dest.lon, ele: null });
  if (!track) document.body.classList.remove('free');
  await showTrack({ name: 'Vers ' + dest.label, pts: r.pts, signals: r.signals }, false);
  track.route = dest; track.style = profile === 'trekking' ? bikeStyle : null;
  arrived = false; guidance(); say(`Itinéraire prêt : ${speakDist(track.total)}. Allons-y !`);
}
async function reroute() {
  if (routing || !me || !track || !track.route) return;
  routing = true; lastRoute = Date.now(); $('btnRejoin').classList.add('busy'); guidance();
  const dest = track.route, style = track.style;
  try {
    let r;
    try { r = await fetchRoute(me, dest, Math.round(clamp(25 + hav(me, dest) / 1000 * 0.4, 25, 120)) * 1000, style); }
    catch (e) { await loadGraphs(); r = localRouteTo(me, dest); if (!r) throw e; }
    r.pts.push({ lat: dest.lat, lon: dest.lon, ele: null });
    await showTrack({ name: 'Vers ' + dest.label, pts: r.pts, signals: r.signals }, false);
    track.route = dest; track.style = style; isOff = false; offCount = 0; arrived = false;
    say('J\'ai recalculé l\'itinéraire.');
  } catch { /* pas de réseau : nouvel essai automatique dans 30 s */ }
  routing = false; $('btnRejoin').classList.remove('busy'); guidance();
}

// =====================================================================
// Mesures affichées
// =====================================================================
function remainingInfo() {
  if (!track) return null;
  const di = doneInfo();
  let rem = di.remain, up = di.upLeft;
  if (progress && rejoin && rejoinProg) {
    const pt = rejoin.target.along != null ? infoAt(rejoin.target.along) : project(track, rejoin.target, true);
    rem = rejoinProg.remain + (pt ? pt.remain : 0);
    up = (pt ? pt.upLeft : up) + (rejoin.hasEle ? rejoinProg.upLeft : 0);
  }
  // temps : allure de base selon le mode (à pied 4,5 km/h + 1 h par 600 m de D+,
  // à vélo 16 km/h + 1 h par 800 m de D+), puis de plus en plus ta vitesse réelle
  // à mesure que tu avances (pleinement après ~3 km)
  const bike = profile === 'trekking';
  const base = (bike ? 16 : 4.5) / 3.6, climb = bike ? 800 : 600;
  const w = speedEma ? clamp(freeD / 3000, 0, 0.85) : 0;
  const v = w * clamp(speedEma || base, 0.5, 15) + (1 - w) * base;
  // + environ 20 s d'attente par carrefour à feux restant
  const sigLeft = track.sig ? track.sig.filter(s => s > di.along + 20).length : 0;
  const secs = rem / v + (track.hasEle ? (1 - w) * up / climb * 3600 : 0) + sigLeft * 20;
  return { rem, up, secs };
}
// un chiffre trop long pour sa colonne est rapetissé plutôt que de déborder sur le voisin
function fitStat(id) {
  const el = $(id); el.style.fontSize = '';
  for (let fs = 21; el.scrollWidth > el.clientWidth + 1 && fs > 13; fs--) el.style.fontSize = (fs - 1) + 'px';
}
function updateStats() {
  pipSoon();
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
    const sp = me && me.speed != null && !isNaN(me.speed) ? me.speed * (IMP ? 2.23694 : 3.6) : null;
    $('spVal').textContent = sp == null ? '–' : (sp < 10 ? sp.toFixed(1).replace('.', ',') : Math.round(sp));
  }
  if (nav && info) {
    $('nbL2').textContent = 'restant'; $('nbL3').textContent = 'D+ restant';
    $('nbEta').textContent = fmtClock(info.secs);
    $('nbDur').textContent = 'arrivée · ' + fmtDur(info.secs);
    $('nbRem').textContent = fmtDist(info.rem);
    $('nbUp').textContent = track.hasEle ? fmtM(info.up) : '–';
    ['nbEta', 'nbRem', 'nbUp'].forEach(fitStat);
    $('nbBar').style.width = clamp(doneInfo().along / track.total, 0, 1) * 100 + '%';
    const sp = me && me.speed != null && !isNaN(me.speed) ? me.speed * (IMP ? 2.23694 : 3.6) : null;
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
  if (!track) { ctx.fillText(tr('Ouvre un fichier GPX : le profil altimétrique apparaîtra ici.'), 0, H / 2); return; }
  if (!track.hasEle) { ctx.fillText(tr('Ce GPX ne contient pas d\'altitudes.'), 0, H / 2); return; }
  const E = track.ele, C = track.cum, n = E.length;
  let lo = Infinity, hi = -Infinity; E.forEach(e => { if (e != null) { lo = Math.min(lo, e); hi = Math.max(hi, e); } });
  const pad = Math.max(20, (hi - lo) * .08); lo -= pad; hi += pad;
  const L0 = 38, B = 16, w = W - L0 - 4, h = H - B - 4;
  const X = d => L0 + d / track.total * w, Y = e => 4 + (1 - (e - lo) / (hi - lo)) * h;
  ctx.strokeStyle = cssVar('--line'); ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const [v, lab] of eleTicks(lo, hi, [10, 20, 50, 100, 200, 250, 500, 1000])) {
    const y = Math.round(Y(v)) + .5; ctx.beginPath(); ctx.moveTo(L0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.fillText(lab, L0 - 4, y);
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
  const di = doneInfo();
  if (di.started && di.along > 0) { // partie déjà parcourue
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, X(di.along), H); ctx.clip();
    ctx.fillStyle = cssVar('--panel') || '#fff'; ctx.fill(area);
    ctx.fillStyle = COL.done; ctx.globalAlpha = .25; ctx.fill(area); ctx.globalAlpha = 1;
    ctx.strokeStyle = COL.done; ctx.lineWidth = 2; ctx.stroke(path); ctx.restore();
  }
  if (di.started && E[di.idx] != null) {
    const x = X(di.along), y = Y(E[di.idx]);
    ctx.strokeStyle = COL.me; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, 4 + h); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COL.me; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
}
window.addEventListener('resize', drawProfile);

// ---------- progression détaillée en navigation (glisser la barre du bas vers le haut) ----------
let navMoreT = 0;
function applyNavMore(open) {
  $('navMore').hidden = !open;
  if (open) { navMoreT = 0; updateNavMore(); }
}
function navMotion() {
  return navMotion.m || (navMotion.m = sheetMotion($('navBottom'), $('navMore'), applyNavMore,
    h => {
      if (!h) return;
      document.documentElement.style.setProperty('--nav-h', h + 'px');
      // boutons ronds : ils suivent le panneau, et s'effacent sous le bandeau de direction s'il n'y a plus de place
      const col = document.querySelector('.fab-col'), top = document.querySelector('.navtop');
      const room = innerHeight - h - (top ? top.offsetHeight : 0) - 24;
      document.body.classList.toggle('fab-hide-nav', !!col && !$('navMore').hidden && !$('navMore').classList.contains('prof-only') && room < col.offsetHeight);
    },
    () => { if (nav && follow) navCamera(400); },
    { reduced: () => $('navMore').classList.contains('prof-only'), set: v => setProfOnly(v) }));
}
function toggleNavMore(open, instant) {
  const want = open === undefined ? $('navMore').hidden : !!open;
  want ? navMotion().open(instant) : navMotion().close(instant);
}
function updateNavMore() {
  if ($('navMore').hidden) return;
  if (!track) { // balade libre : distance, durée et vitesse depuis le départ
    const navS = (Date.now() - navStartT) / 1000, rec = actState !== 'idle';
    const el = rec ? actElapsed() / 1000 : navS, d = rec ? act.d : freeD;
    $('npDone').textContent = fmtDist(d);
    $('npTimeL').textContent = rec ? 'Temps (sortie)' : 'Durée';
    $('npTime').textContent = el > 0 ? fmtDur(el) : '–';
    $('npAvg').textContent = el > 60 ? kmh(d / el * 3.6) : '–';
    $('npEle').textContent = me && me.ele != null ? fmtM(me.ele) : '–';
    return;
  }
  $('npTimeL').textContent = 'Temps (sortie)';
  const pr = progress, di = doneInfo(), upLeft = di.upLeft, downLeft = di.downLeft;
  $('npDone').textContent = fmtDist(di.along);
  $('npLeft').textContent = fmtDist(di.remain);
  $('npPct').textContent = Math.floor(di.along / track.total * 100) + ' %';
  $('npProfInfo').textContent = `${fmtDist(di.remain)} restants${track.hasEle ? ' · D+ ' + fmtM(di.upLeft) + ' · D− ' + fmtM(di.downLeft) : ''}`;
  // retour à la trace : par le chemin si un itinéraire est calculé, sinon l'écart à vol d'oiseau
  const off = pr && (rejoin || pr.dist > onTrackTol(me));
  $('npBack').hidden = !off;
  if (off) {
    const road = rejoin && rejoinProg && !rejoin.straight;
    $('npBackVal').textContent = fmtDist(rejoin && rejoinProg ? rejoinProg.remain : pr.dist);
    $('npBackSub').textContent = road ? 'par le chemin' : rejoin ? 'en ligne droite' : routing ? 'calcul du chemin…' : 'à vol d\'oiseau';
  }
  $('npUpDone').textContent = track.hasEle ? fmtM(track.totalUp - upLeft) : '–';
  $('npUpLeft').textContent = track.hasEle ? fmtM(upLeft) : '–';
  $('npDownLeft').textContent = track.hasEle ? fmtM(downLeft) : '–';
  // temps et vitesse de la sortie enregistrée (hors pauses)
  const el = actState === 'idle' ? 0 : actElapsed() / 1000;
  $('npTime').textContent = el > 0 ? fmtDur(el) : '–';
  $('npAvg').textContent = el > 60 ? kmh(act.d / el * 3.6) : '–';
  $('npEle').textContent = me && me.ele != null ? fmtM(me.ele) : (pr && track.ele[pr.idx] != null ? '≈ ' + fmtM(track.ele[pr.idx]) : '–');
  if (Date.now() - navMoreT > 2000) { navMoreT = Date.now(); drawProfileOn($('navProfile')); }
}
$('nbGrip').onclick = () => toggleNavMore();
// « Profil seul » : le panneau ne montre que la topographie (choix gardé en mémoire)
function setProfOnly(v) {
  store.set('npProfOnly', v ? '1' : '0');
  $('navMore').classList.toggle('prof-only', v);
  $('npProfOnly').textContent = v ? 'Afficher les détails' : 'Profil seul';
  navMoreT = 0; updateNavMore();
}
$('npProfOnly').onclick = () => setProfOnly(!$('navMore').classList.contains('prof-only'));
setProfOnly(store.get('npProfOnly') === '1');
(() => {
  attachSwipe($('navBottom'), navMotion());
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
  updateActUI(); updateNavMore(); bgTrack();
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
  setActState('on'); vibrate(120); say(pick(['Enregistrement lancé, bonne sortie !', 'C\'est enregistré, profite bien !']));
}
// appelée à chaque position GPS
function onActFix(pos) {
  if (pos.sim) return;
  if (actState === 'waiting' && (pos.acc || 99) <= 30) { beginRecording(pos); return; }
  if (actState !== 'on' || (pos.acc || 0) > 40) return;
  // distance comptée par pas de 8 m, pour ne pas additionner le flottement du GPS à l'arrêt
  if (!actRef) actRef = pos;
  const d = hav(actRef, pos);
  if (d >= Math.max(8, 0.6 * (pos.acc || 0))) { if (d < 500) act.d += d; actRef = pos; saveAct(); }
  addRecPoint(pos);
}
function pauseActivity() {
  if (actState !== 'on') return;
  act.ms += Date.now() - act.since; act.since = null; actRef = null; saveAct(); saveRec();
  setActState('paused');
  if (!nav) stopGPS();
  say('Pause. Prends ton temps.');
}
function resumeActivity() {
  if (actState !== 'paused') return;
  if (!startGPS()) return;
  act.since = Date.now(); actRef = null; recSeg++; saveAct();
  setActState('on'); say(pick(['C\'est reparti !', 'On repart !']));
}
function cancelWaiting() { setActState('idle'); if (!nav) stopGPS(); toast('Enregistrement annulé'); }
function togglePause() { if (actState === 'on') pauseActivity(); else if (actState === 'paused') resumeActivity(); }

// ---------- points de la trace enregistrée ----------
function recDist() { let d = 0; for (let i = 1; i < rec.length; i++) if ((rec[i].s || 0) === (rec[i - 1].s || 0)) d += hav(rec[i - 1], rec[i]); return d; }
function recUp() {
  let up = 0, last = null;
  for (const e of smoothEle(rec)) { if (e == null) continue; if (last != null && e - last > 3) { up += e - last; last = e; } else if (last == null || e < last) last = e; }
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
  if (last && (last.s || 0) === recSeg) {
    const d = hav(last, p), dt = Math.max(1, (p.t - last.t) / 1000);
    // à l'arrêt ou dans un bâtiment, la position flotte dans son rayon de précision : on ne la suit pas
    if (d < Math.max(5, 0.6 * (p.acc || 0))) return;
    if (d / dt > 30) return; // saut impossible (> 108 km/h) : position aberrante
  }
  // altitude gardée seulement pour les positions GPS précises (les positions réseau n'en ont pas de fiable)
  const ele = p.ele != null && (p.acc || 99) <= 20 ? +p.ele.toFixed(1) : null;
  rec.push({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), ele, t: p.t, s: recSeg });
  if (rec.length % 5 === 0) saveRec();
  drawRec();
}
if (rec.length) drawRec();

function actName() { const d = new Date(act.start || (rec[0] && rec[0].t) || Date.now()); const day = d.toLocaleDateString(LOC, { day: 'numeric', month: 'long' }), hm = d.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
  return LANG === 'fr' ? `Sortie du ${day} à ${hm.replace(':', 'h')}` : LANG === 'es' ? `Salida del ${day} a las ${hm}` : `Outing on ${day} at ${hm}`; }
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
  if (AND) { try { AND.shareFile(fname, 'application/gpx+xml', text); } catch {} return; }
  const file = new File([text], fname, { type: 'application/gpx+xml' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } }
  catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fname;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- envoyer un parcours : lien à partager, appli de la montre (Garmin, Wahoo…), fichier GPX ----------
// le parcours envoyé : la trace ouverte, ou une trace de « Mes traces »
let wtSrc = null;
function wtFile() {
  const name = (wtSrc.name || 'Parcours Pisteo').replace(/\.gpx$/i, '').trim().slice(0, 60);
  const fname = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '.gpx';
  return { name, fname: fname === '.gpx' ? 'parcours-pisteo.gpx' : fname, text: loopGPX(wtSrc.pts, name) };
}
function wtSay(m) { $('wtMsg').textContent = m || ''; $('wtMsg').hidden = !m; }
function openSend(src) {
  wtSrc = src; const p = makePath(src.pts, '');
  $('wtName').textContent = `${src.name || 'Parcours'} · ${fmtDist(p.total)}${p.hasEle ? ' · D+ ' + fmtM(p.totalUp) : ''}`; wtSay('');
  $('watch').hidden = false;
}
$('btnWatch').onclick = () => { if (track) openSend({ name: track.name, pts: track.pts }); };
$('wtClose').onclick = () => { $('watch').hidden = true; };
$('watch').onclick = e => { if (e.target === $('watch')) $('watch').hidden = true; };
$('wtOpen').onclick = () => {
  if (!wtSrc) return;
  const f = wtFile();
  if (AND && AND.openWith) { try { AND.openWith(f.fname, 'application/gpx+xml', f.text, tr('Ouvrir le parcours avec')); return; } catch {} }
  shareGPX(f.text, f.name); // navigateur ou ancienne version de l'appli : partage du fichier
};
$('wtSave').onclick = () => {
  if (!wtSrc) return;
  const f = wtFile();
  if (AND) { const got = saveFile(f.text, f.fname); wtSay(got ? `Enregistré dans Téléchargements : ${got}` : 'Enregistrement impossible.'); return; }
  saveFile(f.text, f.fname); wtSay(`Fichier téléchargé : ${f.fname}`);
};

// Le lien porte le parcours lui-même (simplifié puis compressé) : rien n'est stocké sur un serveur,
// et ce qui suit le « # » d'une adresse n'est jamais envoyé au site.
// https://paul12102021.github.io/balise-gpx/p/#<données>~<nom>  (p/ = la page qui ouvre l'appli Android si elle est installée)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const b64enc = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 3) { const n = (u8[i] << 16) | ((u8[i + 1] || 0) << 8) | (u8[i + 2] || 0); s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < u8.length ? B64[n >> 6 & 63] : '') + (i + 2 < u8.length ? B64[n & 63] : ''); } return s; };
const b64dec = s => { const out = []; for (let i = 0; i < s.length; i += 4) { const n = [0, 1, 2, 3].map(k => B64.indexOf(s[i + k] || 'A')); const v = (n[0] << 18) | (n[1] << 12) | (n[2] << 6) | n[3]; out.push(v >> 16 & 255); if (i + 2 < s.length) out.push(v >> 8 & 255); if (i + 3 < s.length) out.push(v & 255); } return new Uint8Array(out); };
async function zip(u8, how) {
  if (typeof CompressionStream === 'undefined') return null;
  const s = new Blob([u8]).stream().pipeThrough(how === 'in' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
// tracé simplifié (Douglas-Peucker, tolérance augmentée jusqu'à ~600 points) : invisible sur la carte, lien plus court
function simplifyDP(pts, max = 600) {
  if (pts.length <= max) return pts;
  const lat0 = rad(pts[0].lat), xy = pts.map(p => [p.lon * 111320 * Math.cos(lat0), p.lat * 110540]);
  const run = tol => {
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let dm = 0, im = -1; const [ax, ay] = xy[a], [bx, by] = xy[b], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
      for (let i = a + 1; i < b; i++) { const t = clamp(((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / L, 0, 1), ex = ax + t * dx - xy[i][0], ey = ay + t * dy - xy[i][1], d = ex * ex + ey * ey; if (d > dm) { dm = d; im = i; } }
      if (im > 0 && dm > tol * tol) { keep[im] = 1; st.push([a, im], [im, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  let tol = 3, out = run(tol);
  while (out.length > max && tol < 200) { tol *= 1.5; out = run(tol); }
  return out;
}
async function routeLink(name, pts) {
  const sp = simplifyDP(pts), hasE = sp.some(p => p.ele != null), bytes = [1, hasE ? 1 : 0];
  const put = v => { v = v < 0 ? -2 * v - 1 : 2 * v; while (v > 127) { bytes.push((v & 127) | 128); v = Math.floor(v / 128); } bytes.push(v); };
  let pa = 0, po = 0, pe = 0;
  for (const p of sp) {
    const a = Math.round(p.lat * 1e5), o = Math.round(p.lon * 1e5); put(a - pa); put(o - po); pa = a; po = o;
    if (hasE) { const e = Math.round(p.ele != null ? p.ele : pe); put(e - pe); pe = e; }
  }
  const raw = new Uint8Array(bytes), z = await zip(raw, 'in').catch(() => null);
  const data = z && z.length < raw.length ? 'z' + b64enc(z) : 'r' + b64enc(raw);
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}p/#${data}~${encodeURIComponent((name || '').slice(0, 60))}`;
}
async function readRouteLink(hash) {
  const m = /^#?([zr])([A-Za-z0-9_-]+)(?:~(.*))?$/.exec(hash || ''); if (!m) return null;
  let u8 = b64dec(m[2]); if (m[1] === 'z') u8 = await zip(u8, 'out');
  if (!u8 || u8[0] !== 1) return null;
  const hasE = u8[1] === 1, pts = []; let i = 2;
  const get = () => { let v = 0, f = 1, b; do { b = u8[i++]; v += (b & 127) * f; f *= 128; } while (b & 128 && i < u8.length); return v & 1 ? -(v + 1) / 2 : v / 2; };
  let a = 0, o = 0, e = 0;
  while (i < u8.length) { a += get(); o += get(); if (hasE) e += get(); pts.push({ lat: a / 1e5, lon: o / 1e5, ele: hasE ? e : null }); }
  let name = ''; try { name = decodeURIComponent(m[3] || ''); } catch {}
  return pts.length > 1 ? { name: name || 'Parcours partagé', pts } : null;
}
function copyText(t) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t); return true; } } catch {}
  const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); return ok;
}
$('wtLink').onclick = async () => {
  if (!wtSrc) return;
  const p = makePath(wtSrc.pts, ''), url = await routeLink(wtSrc.name, wtSrc.pts);
  const info = `${wtSrc.name || 'Parcours'} · ${fmtDist(p.total)}${p.hasEle ? ' · D+ ' + fmtM(p.totalUp) : ''}`;
  const text = tr(`${info} — ouvre-le dans Pisteo :`) + ' ' + url;
  if (AND && AND.shareText) { try { AND.shareText(text, info); return; } catch {} }
  if (!AND && navigator.share) { try { await navigator.share({ title: info, text: tr(`${info} — ouvre-le dans Pisteo :`), url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  wtSay(copyText(text) ? 'Lien copié : colle-le dans un message (WhatsApp, SMS, mail…).' : url);
};
// à l'ouverture d'un lien de parcours : on l'affiche, avec « Naviguer » et « Enregistrer »
async function openRouteLink() {
  const h = location.hash; if (!/^#[zr][A-Za-z0-9_-]{8,}/.test(h)) return;
  history.replaceState(null, '', location.pathname + location.search);
  let r = null; try { r = await readRouteLink(h); } catch {}
  if (!r) { toast('Lien de parcours illisible.', 4000); return; }
  loadText(loopGPX(r.pts, r.name), false);
  toast(`Parcours reçu : ${r.name} · « Enregistrer » pour le garder`, 5000);
  // reçu dans le navigateur d'un téléphone Android : proposer l'appli (une fois Pisteo public sur le Play Store)
  if (PLAY_PUBLIC && !AND && /Android/i.test(navigator.userAgent) && !store.get('playHint'))
    setTimeout(() => { store.set('playHint', '1'); toast('Pisteo existe aussi en appli Android', 9000, { label: 'Installer', run: () => window.open('https://play.google.com/store/apps/details?id=fr.pisteo.app', '_blank') }); }, 5500);
}
// passer à true quand l'appli sera publique (production) : avant, le lien du Play Store ne marche que pour les testeurs
const PLAY_PUBLIC = false;
window.addEventListener('hashchange', openRouteLink);

// ---------- terminer : bilan, puis garder, exporter ou supprimer ----------
function openFinish() {
  if (actState === 'waiting') { cancelWaiting(); return; }
  if (actState === 'idle') return;
  const el = actElapsed() / 1000;
  $('finDist').textContent = fmtDist(act.d);
  $('finTime').textContent = fmtDur(el);
  $('finAvg').textContent = el > 30 ? kmh(act.d / el * 3.6) : '–';
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
  let savedId = null;
  if (keep && rec.length > 1) {
    const btn = $('finSave'); btn.disabled = true; btn.textContent = 'Enregistrement…';
    try {
      await saveRecent({ name, total: recDist(), hasEle: rec.some(p => p.ele != null), totalUp: recUp() }, toGPX(name), true,
        { kind: 'rec', ms: act.ms, start: act.start || (rec[0] && rec[0].t) || Date.now(), mode: profile === 'trekking' ? 'bike' : 'foot' });
      savedId = name + '|' + Math.round(recDist());
    } catch {
      // on ne perd rien : la sortie reste en cours (en pause) et peut être exportée
      if (actState === 'on') { act.since = Date.now(); }
      btn.disabled = false; btn.textContent = 'Terminer et garder dans Mes sorties';
      $('finMsg').textContent = 'Impossible de ranger la sortie : un autre onglet de Pisteo est ouvert. Ferme les autres onglets puis réessaie, ou touche « Exporter le GPX ».';
      $('finMsg').hidden = false;
      return;
    }
    btn.disabled = false; btn.textContent = 'Terminer et garder dans Mes sorties';
  }
  rec = []; saveRec(); drawRec(); recSeg = 0;
  act = { ms: 0, since: null, d: 0, start: null }; saveAct();
  setActState('idle');
  if (!nav) stopGPS();
  $('finish').hidden = true;
  if (keep) { toast('Sortie gardée dans Mes sorties', 5000, { label: 'Voir', run: openSorties }); if (savedId) setTimeout(() => stvAuto(savedId), 1500); }
  else toast('Sortie supprimée', 4000);
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
    : `${fmtDist(act.d)} · ${fmtDur(el)}` + (el > 60 ? ` · ${kmh(act.d / el * 3.6)}` : '');
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
const [MO, GO] = LANG === 'fr' ? [' Mo', ' Go'] : [' MB', ' GB'];
const fmtMo = kb => { const mb = kb / 1024; return mb < 10 ? mb.toFixed(1).replace('.', ',') + MO : mb < 1000 ? Math.round(mb) + MO : (mb / 1024).toFixed(1).replace('.', ',') + GO; };

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

// ---------- départements et régions des pays qui ont une carte officielle libre ----------
// pour ajouter un pays : sa carte dans NAT, ses régions (code, nom, names, polys) dans regions/<pays>.json
const COUNTRIES = [
  { id: 'fr', nat: 'ign', name: 'France', file: 'departements.json' },
  // Allemagne (TopPlusOpen, BKG) : en pause, le serveur ne répond plus (23 oct.). Pour la remettre : cette ligne
  // + le contour regions/de-outline.json sous la clé "de" dans regions/countries.json
  // { id: 'de', nat: 'de', name: 'Allemagne', file: 'regions/de.json' }, // Länder
  { id: 'es', nat: 'es', name: 'Espagne', file: 'regions/es.json' },
  { id: 'at', nat: 'at', name: 'Autriche', file: 'regions/at.json' },
  { id: 'be', nat: 'be', name: 'Belgique', file: 'regions/be.json' },
  { id: 'ca', nat: 'ca', name: 'Canada', file: 'regions/ca.json' }, // parcs nationaux, comme aux États-Unis
  { id: 'gb', nat: 'gb', name: 'Royaume-Uni', file: 'regions/gb.json' }, // parcs nationaux et grands massifs (sans l'Irlande du Nord)
  { id: 'ch', nat: 'ch', name: 'Suisse', file: 'regions/ch.json' }, // cantons
  { id: 'us', nat: 'us', name: 'États-Unis', file: 'regions/us.json' }, // parcs nationaux : un État entier serait trop lourd
];
const ccOf = id => COUNTRIES.find(c => c.id === id) || COUNTRIES[0];
const regCache = {};
async function loadRegs(cc) {
  if (!regCache[cc]) regCache[cc] = fetch(ccOf(cc).file).then(r => r.json()).catch(e => { delete regCache[cc]; throw e; });
  return regCache[cc];
}
const regName = d => d.names ? (d.names[LANG] || d.nom) : `${d.code} · ${d.nom}`;
async function packRegion(p) { try { return (await loadRegs(p.cc || 'fr')).find(x => x.code === p.code) || null; } catch { return null; } }
let deps = null, regs = null, regCc = 'fr';
async function loadDeps() {
  if (!deps) deps = await loadRegs('fr');
  if (!$('depCountry').options.length) {
    // par ordre alphabétique, dans la langue de l'appli
    COUNTRIES.map(c => [c.id, tr(c.name)]).sort((a, b) => a[1].localeCompare(b[1], LANG)).forEach(([id, name]) => { const o = document.createElement('option'); o.value = id; o.textContent = name; $('depCountry').appendChild(o); });
    // présélection : le pays où l'on se trouve (ou au centre de la carte), sinon le dernier choisi
    const c = me ? { lon: me.lon, lat: me.lat } : (() => { const m = map.getCenter(); return { lon: m.lng, lat: m.lat }; })();
    const nat = natAt(c.lon, c.lat), here = COUNTRIES.find(x => x.nat === nat);
    regCc = here ? here.id : ccOf(store.get('depCc') || 'fr').id;
    $('depCountry').value = regCc;
    await fillRegs(c);
  }
  return deps;
}
async function fillRegs(c) {
  regs = await loadRegs(regCc);
  const sel = $('depSel'); sel.innerHTML = '';
  const order = regs.map((d, i) => i);
  if (regCc !== 'fr') order.sort((a, b) => regs[a].nom.localeCompare(regs[b].nom, LOC));
  order.forEach(i => { const o = document.createElement('option'); o.value = i; o.textContent = regName(regs[i]); sel.appendChild(o); });
  c = c || (me ? { lon: me.lon, lat: me.lat } : (() => { const m = map.getCenter(); return { lon: m.lng, lat: m.lat }; })());
  const here = regs.findIndex(d => inPolys(c.lon, c.lat, d.polys));
  const saved = store.get('depIdx:' + regCc) ?? (regCc === 'fr' ? store.get('depIdx') : null);
  sel.value = String(here >= 0 ? here : saved != null && regs[+saved] ? saved : order[0]);
}

// ---------- panneau « Cartes hors ligne » ----------
let depTilesCache = { key: '', tiles: [] };
const provKB = prov => prov === 'ofm' ? OFM_KB : prov === 'ign' || !NAT[prov] ? tileKB : NAT[prov].kb;
const provName = prov => prov === 'ofm' ? 'Monde' : NAT[prov] ? NAT[prov].name : 'IGN';
function currentDepTiles() {
  const N = NAT[ccOf(regCc).nat], d = regs[+$('depSel').value], z = Math.min(+$('depDetail').value + (N.zoff || 0), N.max), key = regCc + ':' + d.code + ':' + z;
  if (depTilesCache.key !== key) depTilesCache = { key, tiles: polyTiles(d.polys, z) };
  return { d, z, tiles: depTilesCache.tiles };
}
function updateOfflineInfo() {
  if (track) {
    const n = traceTiles(track).length;
    $('dlTraceInfo').textContent = `${track.name} · ≈ ${n.toLocaleString(LOC)} tuiles · ~${fmtMo(n * tileKB)}`;
    $('dlTrace').disabled = false;
  } else { $('dlTraceInfo').textContent = 'Ouvre d\'abord une trace GPX.'; $('dlTrace').disabled = true; }
  if (regs) {
    const { d, tiles } = currentDepTiles(), gMo = depGraphMo(d.polys);
    $('dlDepInfo').textContent = `Carte ≈ ${tiles.length.toLocaleString(LOC)} tuiles · ~${fmtMo(tiles.length * provKB(ccOf(regCc).nat))}` + ($('depGraph').checked ? ` · chemins ~${gMo}${MO}` : '');
    $('depGraphMo').textContent = `~${gMo}${MO}`;
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
$('depSel').onchange = () => { store.set('depIdx:' + regCc, $('depSel').value); updateOfflineInfo(); };
$('depCountry').onchange = async () => {
  regCc = $('depCountry').value; store.set('depCc', regCc); $('dlDepInfo').textContent = 'Chargement…';
  try { await fillRegs(); updateOfflineInfo(); } catch { $('dlDepInfo').textContent = 'Liste des départements indisponible.'; }
};
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
    $('offTxt').textContent = `${pct} % · ${done.toLocaleString(LOC)} / ${total.toLocaleString(LOC)}` + rest + (fail ? ` · ${fail} erreurs` : '');
    // aussi visible hors de la fenêtre des cartes : dans les réglages et sur la ligne de la carte
    $('mapsStatus').textContent = `${pack.name} : ${pct} %${rest}`; $('mapsStatus').hidden = false;
    const row = document.querySelector(`[data-pack="${CSS.escape(pack.id)}"]`);
    if (row) row.textContent = `En cours : ${pct} %${rest}`;
  };
  // une tuile : délai maximal de 20 s, un second essai, sans passer par les secours du service worker
  const prov = pack.prov || 'ign';
  let tileUrl = NAT[prov] ? natTileUrl(prov) : ignTileUrl;
  if (prov === 'ofm') { const tpl = await getOfmTiles(); tileUrl = (z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y); await precacheOfm(); }
  const gap = NAT[prov] && NAT[prov].rate ? 60000 / NAT[prov].rate : 0; let nextAt = 0; // serveur à débit limité
  const getTile = async (z, x, y) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (gap) { const now = Date.now(), at = Math.max(now, nextAt); nextAt = at + gap; if (at > now) await new Promise(r => setTimeout(r, at - now)); }
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const r = await fetch(tileUrl(z, x, y), { mode: 'cors', cache: 'no-store', signal: ctrl.signal });
        if (r.ok) return await r.blob();
        lastErr = 'le serveur de la carte répond ' + r.status;
        if (r.status >= 400 && r.status < 500 && r.status !== 429) return null; // demande refusée : inutile d'insister
      } catch (e) { lastErr = e.name === 'AbortError' ? 'le serveur de la carte ne répond pas' : 'pas de connexion'; }
      finally { clearTimeout(timer); }
      await new Promise(r => setTimeout(r, lastErr === 'le serveur de la carte répond 429' ? 10000 : 1500));
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
            await cache.put(key, new Response(b, { headers: { 'content-type': b.type || (prov === 'ofm' ? 'application/x-protobuf' : prov === 'es' ? 'image/jpeg' : 'image/png'), 'x-size': String(b.size) } }));
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
  // OpenFreeMap demande 4 requêtes simultanées au plus pour le hors ligne
  await Promise.all(Array.from({ length: prov === 'ofm' ? 4 : (NAT[prov] && NAT[prov].par) || 8 }, worker));
  const stopped = dl.stop, reason = dl.reason; dl = null;
  if (fetched > 50 && prov === 'ign') { tileKB = clamp(Math.round(fetchedBytes / fetched / 1024 * 10) / 10 || tileKB, 8, 60); store.set('tileKB', tileKB); }
  await save(!stopped && fail === 0);
  $('dlStop').hidden = true; $('dlTrace').disabled = !track; $('dlDep').disabled = false; $('mapsStatus').hidden = true;
  if (reason) $('offTxt').textContent = `Téléchargement impossible : ${reason}.`;
  else $('offTxt').textContent = pack.complete ? `${pack.name} : disponible hors ligne ✓` : `${pack.name} : ${pack.missing.toLocaleString(LOC)} tuiles manquantes · touche « Reprendre »`;
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
  if (!codes.length) { // trace à l'étranger : carte officielle du pays si elle y est entière, sinon carte Monde
    const ks = new Set(pack.line.filter((_, i) => i % Math.max(1, Math.floor(pack.line.length / 40)) === 0).map(([lon, lat]) => natAt(lon, lat)));
    pack.prov = ks.size === 1 && [...ks][0] && [...ks][0] !== 'ign' ? [...ks][0] : 'ofm';
  }
  let tiles = pack.prov === 'ofm' ? traceTiles(tr, 14) : traceTiles(tr, NAT[pack.prov] && NAT[pack.prov].zoff ? 15 : 16);
  if (pack.prov === 'ofm' && tiles.length > OFM_MAX) tiles = traceTiles(tr, 13);
  if (pack.prov === 'ofm' && tiles.length > OFM_MAX) { toast('Trace trop longue pour la carte Monde hors ligne : utilise plutôt « Une zone de la carte », en plusieurs morceaux.', 6000); return; }
  await downloadPack(pack, tiles);
  // puis le réseau des chemins, pour calculer les itinéraires sans connexion
  if (navigator.onLine !== false) {
    if (codes.length) downloadPlaces(codes); else downloadOsmPlaces(pack, corridorBoxes(tr));
    await downloadGraph(pack, corridorBoxes(tr)); renderPacks();
  }
};
$('dlDep').onclick = async () => {
  await loadDeps();
  const { d, z, tiles } = currentDepTiles(), cc = regCc, prov = ccOf(cc).nat;
  if (tiles.length > 40000) { toast('Zone trop grande.', 4000); return; }
  try {
    const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    if (e && e.quota && tiles.length * provKB(prov) * 1024 > (e.quota - e.usage) * 0.9) { toast('Pas assez de place sur le téléphone pour cette carte.', 5000); return; }
  } catch {}
  const pack = cc === 'fr'
    ? { id: `dep:${d.code}:${z}`, kind: 'dep', code: d.code, name: `${d.code} · ${d.nom}`, detail: z >= 15 ? 'détaillé' : 'standard', bbox: polysBBox(d.polys) }
    : { id: `dep:${cc}:${d.code}:${z}`, kind: 'dep', cc, prov, code: d.code, name: regName(d), detail: z - (NAT[prov].zoff || 0) >= 15 ? 'détaillé' : 'standard', bbox: polysBBox(d.polys) };
  await downloadPack(pack, tiles);
  if (cc === 'fr') downloadPlaces([d.code]); else if (navigator.onLine !== false) downloadOsmPlaces(pack, [(b => [b[1], b[0], b[3], b[2]])(pack.bbox)]);
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
// règles d'OpenFreeMap pour le hors ligne : 3 000 tuiles ou 50 Mo au plus par téléchargement
const OFM_MAX = 3000;
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
// carte officielle de la zone : la mer et les points hors des pays couverts ne comptent pas (zone sur la côte) ;
// si la zone touche deux pays, carte Monde
function zoneNat(b) {
  const ks = new Set();
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) { const k = natAt(b[0] + (b[2] - b[0]) * i / 6, b[1] + (b[3] - b[1]) * j / 6); if (k) ks.add(k); }
  return ks.size === 1 ? [...ks][0] : 'ofm';
}
function zonePlan() {
  const b = zoneBBox(), prov = $('zoneProv').value === 'auto' ? zoneNat(b) : $('zoneProv').value;
  const tiles = prov === 'ofm' ? zoneTiles(b, 0, 14) : zoneTiles(b, 8, 14);
  const km2 = bboxKm2(b), mapKB = tiles.length * provKB(prov), gKB = $('zoneGraph').checked ? km2 * 8 : 0;
  return { b, prov, tiles, km2, mapKB, gKB };
}
function updateZoneInfo() {
  if (!zoneMode) return;
  const z = zonePlan(), tooBig = z.tiles.length > (z.prov === 'ofm' ? OFM_MAX : 25000) || (z.prov === 'ofm' && z.mapKB > 50 * 1024);
  $('zoneInfo').textContent = tooBig
    ? `Zone trop grande (${Math.round(z.km2).toLocaleString(LOC)} km²) : zoome un peu`
    : `${Math.round(z.km2).toLocaleString(LOC)} km² · carte ${provName(z.prov)} ~${fmtMo(z.mapKB)}` + (z.gKB ? ` · chemins ~${fmtMo(z.gKB)}` : '');
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
  stopFollowOv();
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
// cartes venues d'une sauvegarde : on les retélécharge l'une après l'autre (carte, localités, chemins)
let restoreRun = false;
$('packRestoreBtn').onclick = async () => {
  if (dl || restoreRun) { toast('Un téléchargement est déjà en cours.'); return; }
  if (navigator.onLine === false) { toast('Pas de réseau : connecte-toi pour télécharger.', 4000); return; }
  restoreRun = true; $('packRestore').hidden = true;
  try {
    for (const p of (await listPacks()).filter(q => q.restored && !q.complete)) {
      await downloadPack(p, p.tiles);
      const now = await idb('readonly', st => st.get(p.id), 'packs').catch(() => null);
      if (!now || !now.complete) break; // arrêté ou incomplet : « Reprendre » ou « Tout retélécharger » plus tard
      // la carte est là : elle redevient une carte normale, puis on ajoute localités et chemins en plus
      const wantGraph = !!now.graphWanted;
      delete now.restored; delete now.graphWanted; delete p.restored; delete p.graphWanted;
      await idb('readwrite', st => st.put(now), 'packs').catch(() => {}); renderPacks();
      if (navigator.onLine !== false) {
        try {
          if (p.kind === 'dep') { if (p.cc && p.cc !== 'fr') await downloadOsmPlaces(p, [[p.bbox[1], p.bbox[0], p.bbox[3], p.bbox[2]]]); else downloadPlaces([p.code]); if (wantGraph) { const d = await packRegion(p); if (d) await downloadDepGraph(p, d.polys); } }
          else if (p.kind === 'zone') { await downloadOsmPlaces(p, [[p.bbox[1], p.bbox[0], p.bbox[3], p.bbox[2]]]); if (wantGraph) await downloadDepGraph(p, bboxPolys(p.bbox)); }
          else if (p.kind === 'trace' && p.line) {
            const lp = makePath(p.line.map(([lon, lat]) => ({ lat, lon, ele: null })), p.name), codes = await depsOfLine(p.line);
            if (codes.length) downloadPlaces(codes); else downloadOsmPlaces(p, corridorBoxes(lp));
            if (wantGraph) await downloadGraph(p, corridorBoxes(lp));
          }
        } catch {}
      }
    }
  } finally { restoreRun = false; renderPacks(); }
};
async function renderPacks() {
  const list = $('packList'), packs = await listPacks();
  list.innerHTML = ''; $('packEmpty').hidden = packs.length > 0;
  const todo = packs.filter(p => p.restored && !p.complete);
  $('packRestore').hidden = !todo.length || !!restoreRun;
  if (todo.length) {
    const kb = todo.reduce((s, p) => s + (p.missing || p.count || 0) * provKB(p.prov || 'ign'), 0);
    $('packRestoreTxt').textContent = `${bkMaps(todo.length)} de ta sauvegarde ${todo.length > 1 ? 'sont' : 'est'} à retélécharger (~${fmtMo(kb)}). Mieux vaut être en Wi-Fi.`;
  }
  for (const p of packs) {
    const li = document.createElement('li');
    const info = document.createElement('div'); info.className = 'lib-item';
    info.innerHTML = '<b></b><span></span>';
    info.querySelector('b').textContent = p.name;
    info.querySelector('span').textContent = `${p.kind === 'trace' ? 'Le long de la trace' : p.kind === 'zone' ? `Zone de ${Math.round(bboxKm2(p.bbox)).toLocaleString(LOC)} km²` : (p.cc && p.cc !== 'fr' ? ccOf(p.cc).name : 'Département') + ', ' + p.detail} · carte ${provName(p.prov || 'ign')} · ${fmtMo(p.bytes / 1024)} · ${fmtDate(p.date)}` + (p.complete ? '' : p.restored ? ' · à retélécharger' : ` · incomplet`) + (p.graph ? (p.graph.partial ? ` · chemins incomplets (${p.graph.km} km)` : ` · itinéraires hors connexion ✓ (${p.graph.km} km de chemins)`) : '');
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
        const d = await packRegion(p);
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
      $('maps').hidden = true; toggleMore(false, true); // on replie le menu pour voir la carte
      stopFollowOv();
      if (!$('showPacks').checked) { $('showPacks').checked = true; store.set('showPacks', '1'); drawPacks(); }
      const [w, s, e, n] = p.bbox;
      setTimeout(() => map.fitBounds([[w, s], [e, n]], { padding: { top: 90, bottom: $('sheet').offsetHeight + 20, left: 30, right: 76 }, bearing: 0, pitch: 0, duration: 700 }), 60);
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
      const d = await packRegion(p);
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
function localRejoin(tr, pos, cands) {
  const g = graphFor([pos]); if (!g) return null;
  const startN = nodesNear(g, pos, 400)[0]; if (!startN) return null;
  // nœuds du réseau situés sur la trace (à moins de 25 m), seulement dans la partie devant soi
  const from = rejoinFrom(tr), to = Math.min(tr.total, Math.max(from + 1000, ...(cands || []).map(c => c.along + 1000)));
  const key = tr.id + ':' + g.id + ':' + Math.round(from / 100) + ':' + Math.round(to / 100);
  if (!g.targets || g.targetsKey !== key) {
    const mask = new Uint8Array(g.n);
    for (let d = from; d <= to; d += 10) for (const [i] of nodesNear(g, pointAt(tr, d), 25)) mask[i] = 1;
    g.targets = mask; g.targetsKey = key;
  }
  const r = shortestPath(g, startN[0], i => g.targets[i] === 1, profile === 'trekking');
  if (!r) return null;
  const last = nodePt(g, r.nodes[r.nodes.length - 1]);
  // point de la trace le plus proche de l'arrivée, dans la fenêtre [from, to]
  let pr = { along: from, d: Infinity };
  for (let d = from; d <= to; d += 5) { const q = pointAt(tr, d), dd = hav(q, last); if (dd < pr.d) pr = { along: d, d: dd }; }
  const tp = pointAt(tr, pr.along);
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
// Écran d'accueil : une seule fois, au tout premier lancement (pas pour ceux qui ont déjà des traces)
// =====================================================================
let onbI = 0;
function onbShow(i) {
  onbI = i;
  $('onb').querySelectorAll('.onb-s').forEach((x, k) => x.classList.toggle('on', k === i));
  $('onb').querySelectorAll('.onb-dots i').forEach((x, k) => x.classList.toggle('on', k === i));
  const last = i === 3;
  $('onbNext').textContent = last ? 'C\'est parti' : 'Suivant'; $('onbSkip').hidden = last;
}
function onbClose() { $('onb').hidden = true; store.set('onb', '1'); }
$('onbNext').onclick = () => onbI < 3 ? onbShow(onbI + 1) : onbClose();
$('onbSkip').onclick = onbClose;
// glisser à gauche / à droite pour changer d'écran
(() => { let x0 = null;
  $('onb').addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  $('onb').addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (dx < -50 && onbI < 3) onbShow(onbI + 1); else if (dx > 50 && onbI > 0) onbShow(onbI - 1); });
})();
(async () => {
  if (store.get('onb') === '1' || /[?&]shared=1/.test(location.search)) return;
  const had = (await listRecent()).length > 0 || store.get('gpx');
  if (had) { store.set('onb', '1'); return; }
  onbShow(0); $('onb').hidden = false;
})();

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

function applyMore(open) {
  $('more').hidden = !open;
  if (!open) $('sheet').scrollTop = 0;
  try { const h = document.querySelector('.hud').offsetHeight; if (h) document.documentElement.style.setProperty('--hud-h', h + 'px'); } catch {}
  document.body.classList.toggle('sheet-open', open);
  $('btnMore').textContent = open ? 'Réduire' : 'Réglages';
}
function moreMotion() {
  return moreMotion.m || (moreMotion.m = sheetMotion($('sheet'), $('more'), applyMore,
    h => {
      document.documentElement.style.setProperty('--sheet-h', h + 'px');
      // assez de place entre le bandeau du haut et le panneau pour la colonne de boutons ?
      const col = document.querySelector('.fab-col'), hud = document.querySelector('.hud');
      const room = innerHeight - h - (hud ? hud.offsetHeight : 0) - 24;
      document.body.classList.toggle('fab-hide', !!col && !$('more').hidden && room < col.offsetHeight);
    }));
}
function toggleMore(open, instant) {
  const want = open === undefined ? $('more').hidden : !!open;
  want ? moreMotion().open(instant) : moreMotion().close(instant);
}
$('btnMore').onclick = () => toggleMore(); $('grip').onclick = () => toggleMore();

// Ouvrir / réduire un panneau du bas en douceur : le panneau glisse (il suit le doigt pendant le geste),
// puis le contenu est ajouté ou retiré une fois le mouvement fini.
function sheetMotion(panel, content, apply, report, after, steps) {
  let y = 0, raf = 0;
  const vis = () => Math.max(0, panel.offsetHeight - Math.max(0, y));
  const setY = v => { y = v; panel.style.transform = v ? `translateY(${v}px)` : ''; report(vis()); };
  // écart de hauteur entre ouvert et réduit (contenu affiché au moment de la mesure)
  const gap = () => { const hOpen = panel.offsetHeight; content.hidden = true; const hClosed = panel.offsetHeight; content.hidden = false; return Math.max(0, hOpen - hClosed); };
  const ease = t => 1 - Math.pow(1 - t, 3);
  function animate(to, done) {
    cancelAnimationFrame(raf);
    const from = y, t0 = performance.now(), dur = clamp(Math.abs(to - from) * 0.9, 160, 320);
    const step = now => {
      const t = Math.min(1, (now - t0) / dur);
      setY(from + (to - from) * ease(t));
      if (t < 1) raf = requestAnimationFrame(step); else { raf = 0; done && done(); after && after(); }
    };
    raf = requestAnimationFrame(step);
  }
  const m = {
    isOpen: () => !content.hidden,
    open(instant) {
      if (content.hidden) { apply(true); if (instant) { setY(0); after && after(); return; } setY(gap()); }
      animate(0);
    },
    close(instant) {
      if (content.hidden) { if (y) animate(0); return; }
      if (instant) { cancelAnimationFrame(raf); setY(0); apply(false); report(vis()); after && after(); return; }
      animate(gap(), () => { setY(0); apply(false); report(vis()); });
    },
    // pendant le geste : base = position de départ, G = course totale
    drag: { start() { cancelAnimationFrame(raf); const was = !content.hidden; if (!was) apply(true); const G = gap(); const base = was ? y : G; setY(base); return { was, G, base }; },
            move(st, dy) { let v = st.base + dy; if (v < 0) v *= 0.3; else if (v > st.G) v = st.G + (v - st.G) * 0.3; setY(v); },
            end(st, dy, vy) {
              // un petit glissé rapide (doigt qui bouge en touchant un bouton) ne compte pas : il faut au moins ~24 px
              const goOpen = st.was ? !(dy > 50 || (vy > 0.5 && dy > 24)) : (dy < -40 || (vy < -0.5 && dy < -24));
              // panneau à étages : glisser vers le bas passe d'abord à la vue réduite, vers le haut revient à la vue complète
              if (st.was && steps) {
                const reduced = steps.reduced();
                if (!goOpen && !reduced) { // tout → vue réduite : le haut du panneau descend en douceur, puis on retire le reste
                  const h0 = panel.offsetHeight; steps.set(true); const d = h0 - panel.offsetHeight; steps.set(false);
                  animate(Math.max(0, d), () => { steps.set(true); setY(0); }); return;
                }
                if (goOpen && reduced && (dy < -40 || (vy < -0.5 && dy < -24))) { // vue réduite → tout : le reste apparaît en glissant vers le haut
                  const h0 = panel.offsetHeight; steps.set(false); setY(y + panel.offsetHeight - h0); animate(0); return;
                }
              }
              goOpen ? animate(0) : animate(st.G, () => { setY(0); apply(false); report(vis()); });
            } }
  };
  try { new ResizeObserver(() => report(vis())).observe(panel); } catch {}
  return m;
}

// Glisser un panneau du bas : vers le haut il s'ouvre, vers le bas il se réduit.
// Le geste part de n'importe où, boutons compris : un toucher reste un clic,
// un mouvement vertical devient un glissement (et le clic est alors annulé).
function attachSwipe(panel, motion) {
  let x0 = null, y0 = 0, dy = 0, decided = false, swiping = false, st = null, lastY = 0, lastT = 0, vy = 0, top0 = 0;
  const scrollable = () => panel.scrollHeight > panel.clientHeight + 2;
  panel.addEventListener('touchstart', e => {
    if (e.touches.length > 1 || e.target.closest('select, textarea, input[type=search], input[type=text]')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = lastY = e.touches[0].clientY; lastT = performance.now(); dy = vy = 0;
    decided = swiping = false; top0 = panel.scrollTop;
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (x0 == null) return;
    const cx = e.touches[0].clientX, cy = e.touches[0].clientY, dx = cx - x0;
    dy = cy - y0;
    const now = performance.now(); if (now > lastT) { vy = vy * 0.6 + (cy - lastY) / (now - lastT) * 0.4; lastY = cy; lastT = now; }
    if (!decided && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      decided = true;
      swiping = Math.abs(dy) > Math.abs(dx) * 1.2;
      // contenu qui défile : on le laisse défiler, dans les deux sens ; le panneau ne se réduit
      // en glissant vers le bas que si la liste était déjà tout en haut au début du geste
      if (swiping && motion.isOpen() && scrollable() && (dy < 0 || top0 > 2 || panel.scrollTop > 2)) swiping = false;
      if (swiping) { st = motion.drag.start(); y0 = cy; dy = 0; }
    }
    if (!swiping) return;
    if (e.cancelable) e.preventDefault();
    motion.drag.move(st, dy);
  }, { passive: false });
  const end = () => {
    if (x0 == null) return;
    x0 = null;
    if (!swiping) return;
    swiping = false;
    if (performance.now() - lastT > 120) vy = 0; // doigt immobile avant de lâcher
    motion.drag.end(st, dy, vy);
    // le doigt s'est levé sur un bouton : ce n'était pas un clic
    const block = ev => { ev.stopPropagation(); ev.preventDefault(); };
    panel.addEventListener('click', block, true);
    setTimeout(() => panel.removeEventListener('click', block, true), 400);
  };
  panel.addEventListener('touchend', end); panel.addEventListener('touchcancel', end);
}
// ---------- listes de choix (select) : fenêtre du bas aux couleurs de l'appli ----------
// les <select> restent dans la page (valeur, événement « change ») mais ne s'ouvrent plus eux-mêmes :
// un toucher sur l'un d'eux ouvre cette fenêtre (les selects sont rendus « transparents » au toucher en CSS)
const FLAG = cc => /^[a-z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map(ch => 0x1F1A5 + ch.charCodeAt(0))) : '';
let pkSel = null;
function pkLabel(sel) {
  if (sel.id === 'depSel') return tr(regCc === 'fr' ? 'Département' : 'Région');
  const l = sel.id && document.querySelector(`label[for="${sel.id}"]`);
  const t = l ? (l.childNodes[0] && l.childNodes[0].textContent || l.textContent) : sel.getAttribute('aria-label') || sel.title || '';
  return t.trim() || tr('Choisir');
}
function pkRender(q = '') {
  const list = $('pkList'); list.innerHTML = '';
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let lastGroup = null;
  for (const o of pkSel.options) {
    if (o.hidden || (q && !norm(o.textContent).includes(norm(q)))) continue;
    const g = o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : null;
    if (g && g !== lastGroup) { const h = document.createElement('div'); h.className = 'pk-group'; h.textContent = g; list.appendChild(h); lastGroup = g; }
    const b = document.createElement('button'); b.className = 'pk-opt' + (o.selected ? ' on' : ''); b.disabled = o.disabled;
    b.setAttribute('role', 'option'); b.setAttribute('aria-selected', o.selected ? 'true' : 'false');
    const flag = pkSel.id === 'depCountry' ? FLAG(o.value) : '';
    b.innerHTML = (flag ? '<span class="pk-flag"></span>' : '') + '<span class="pk-txt"></span><span class="pk-check"></span>';
    if (flag) b.querySelector('.pk-flag').textContent = flag;
    b.querySelector('.pk-txt').textContent = o.textContent;
    b.onclick = () => {
      const sel = pkSel; closePicker();
      if (sel.value !== o.value) { sel.value = o.value; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    };
    list.appendChild(b);
  }
}
function openPicker(sel) {
  pkSel = sel; $('pkTitle').textContent = pkLabel(sel);
  const many = sel.options.length > 12; $('pkSearch').hidden = !many; $('pkSearch').value = '';
  pkRender(); $('picker').hidden = false;
  const on = $('pkList').querySelector('.on'); if (on) on.scrollIntoView({ block: 'center' });
}
function closePicker() { $('picker').hidden = true; pkSel = null; }
$('pkClose').onclick = closePicker;
$('picker').onclick = e => { if (e.target === $('picker')) closePicker(); };
$('pkSearch').oninput = e => pkRender(e.target.value);
// un toucher qui tombe sur une liste de choix visible (elle-même ne reçoit plus les touchers)
document.addEventListener('click', e => {
  if (!$('picker').hidden) return;
  for (const sel of document.querySelectorAll('select')) {
    if (sel.disabled || !sel.offsetParent) continue;
    const r = sel.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { e.preventDefault(); e.stopPropagation(); openPicker(sel); return; }
  }
}, true);

attachSwipe($('sheet'), moreMotion());

// Fenêtres du bas (Mes cartes, Mes traces, Sauvegarde…) : glisser vers le bas pour fermer, quand la liste est tout en haut
function closeSheetPanel(lib) {
  const btn = [...lib.querySelectorAll('.closebtn[id*="Close"]')].find(b => b.offsetParent);
  if (btn) btn.click(); else lib.hidden = true;
}
document.querySelectorAll('.lib').forEach(lib => {
  const panel = lib.querySelector('.lib-panel'); if (!panel) return;
  let x0 = null, y0 = 0, dy = 0, decided = false, swiping = false, top0 = 0, lastY = 0, lastT = 0, vy = 0;
  const set = (v, anim) => { panel.style.transition = anim ? 'transform .22s ease-out' : ''; panel.style.transform = v ? `translateY(${v}px)` : ''; };
  panel.addEventListener('touchstart', e => {
    if (e.touches.length > 1 || e.target.closest('select, textarea, input[type=search], input[type=text], input[type=range], canvas')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = lastY = e.touches[0].clientY; lastT = performance.now(); dy = vy = 0; decided = swiping = false; top0 = panel.scrollTop;
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (x0 == null) return;
    const cx = e.touches[0].clientX, cy = e.touches[0].clientY, dx = cx - x0; dy = cy - y0;
    const now = performance.now(); if (now > lastT) { vy = vy * 0.6 + (cy - lastY) / (now - lastT) * 0.4; lastY = cy; lastT = now; }
    if (!decided && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      decided = true;
      // vers le bas, et la liste n'avait pas défilé : on fait glisser la fenêtre ; sinon la liste défile normalement
      swiping = dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2 && top0 <= 2 && panel.scrollTop <= 2;
      if (swiping) y0 = cy, dy = 0;
    }
    if (!swiping) return;
    if (e.cancelable) e.preventDefault();
    set(Math.max(0, dy));
  }, { passive: false });
  const end = () => {
    if (x0 == null) return; x0 = null;
    if (!swiping) return; swiping = false;
    if (performance.now() - lastT > 120) vy = 0;
    // le doigt levé sur un bouton : ce n'était pas un clic
    const block = ev => { if (ev.isTrusted) { ev.stopPropagation(); ev.preventDefault(); } };
    panel.addEventListener('click', block, true); setTimeout(() => panel.removeEventListener('click', block, true), 400);
    if (dy > 90 || (vy > 0.6 && dy > 30)) {
      set(panel.offsetHeight, true);
      setTimeout(() => { closeSheetPanel(lib); set(0); }, 220);
    } else set(0, true);
  };
  panel.addEventListener('touchend', end); panel.addEventListener('touchcancel', end);
});

// les boutons ronds se placent juste au-dessus du panneau du bas, quelle que soit sa hauteur
try {
  document.documentElement.style.setProperty('--sheet-h', $('sheet').offsetHeight + 'px');
} catch { /* navigateur ancien : position par défaut */ }

const saved = store.get('gpx');
if (saved) { try { showTrack(parseGPX(saved)); } catch { drawProfile(); } } else drawProfile();
checkShared();
stvReturn(); setTimeout(stvRetry, 8000);
setTimeout(openRouteLink, 600); // lien de parcours reçu

// =====================================================================
// Déménagement vers pisteo.app : les données (sorties, traces, réglages, liste des cartes) sont liées à
// l'adresse du site ; on les transporte de l'ancienne adresse (paul12102021.github.io) vers la nouvelle.
// =====================================================================
const OLD_HOST = 'paul12102021.github.io', NEW_ORIGIN = 'https://pisteo.app';
async function exportAll() {
  const ls = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); } } catch {}
  const tracks = await listRecent();
  const packs = (await listPacks()).filter(p => Array.isArray(p.tiles) && p.tiles.length).map(p => ({
    id: p.id, kind: p.kind, name: p.name, detail: p.detail, code: p.code, cc: p.cc, prov: p.prov, bbox: p.bbox, line: p.line,
    tiles: p.tiles, count: p.tiles.length, graphWanted: !!(p.graph || p.graphWanted) }));
  return { app: 'pisteo', move: 1, date: Date.now(), ls, tracks, packs };
}
async function importAll(d) {
  if (!d || d.app !== 'pisteo' || !d.move) return false;
  let n = 0;
  try {
    const have = new Set((await listRecent()).map(it => it.id));
    for (const it of d.tracks || []) if (it && it.id && it.text && !have.has(it.id)) { await idb('readwrite', st => st.put(it)); n++; }
    const haveP = new Set((await listPacks()).map(p => p.id));
    for (const p of d.packs || []) if (p && p.id && !haveP.has(p.id)) await idb('readwrite', st => st.put(Object.assign({}, p, { count: p.tiles.length, bytes: 0, date: Date.now(), complete: false, missing: p.tiles.length, restored: true })), 'packs');
  } catch {}
  // réglages, connexion Strava, trace ouverte… (sans écraser ce qui existe déjà ici)
  try { for (const k in d.ls || {}) if (localStorage.getItem(k) === null && !/^(fixVersion|natCur)$/.test(k)) localStorage.setItem(k, d.ls[k]); } catch {}
  try { sessionStorage.setItem('moved', String(n)); if ((d.packs || []).length) sessionStorage.setItem('bkMaps', '1'); } catch {}
  location.reload();
  return true;
}
(async () => {
  try { const n = sessionStorage.getItem('moved'); if (n !== null) { sessionStorage.removeItem('moved'); setTimeout(() => toast('Tes sorties, traces et réglages ont suivi Pisteo sur pisteo.app', 5000), 1200); } } catch {}
  // appli Android : la coquille charge d'abord l'ancienne adresse avec ?migrate=1, récupère tout, puis ouvre pisteo.app
  if (AND && AND.migrateOut && location.hostname === OLD_HOST && /[?&]migrate=1/.test(location.search)) {
    let s = ''; try { s = JSON.stringify(await exportAll()); } catch {}
    AND.migrateOut(s); return;
  }
  if (AND && AND.takeMigration && location.hostname !== OLD_HOST) {
    let s = null; try { s = AND.takeMigration(); } catch {}
    if (s) { try { await importAll(JSON.parse(s)); } catch {} return; }
  }
  // navigateur : l'ancienne adresse propose d'emporter les données vers pisteo.app (nouvel onglet + message entre les deux)
  if (!AND && location.hostname === OLD_HOST) {
    const box = document.createElement('div'); box.className = 'move-box';
    box.innerHTML = '<b></b><span></span><button class="btn go"></button><a class="linkbtn"></a>';
    box.querySelector('b').textContent = tr('Pisteo a déménagé sur pisteo.app');
    box.querySelector('span').textContent = tr('Emporte tes sorties, traces et réglages en un toucher.');
    const go = box.querySelector('button'); go.textContent = tr('Transférer et ouvrir pisteo.app');
    const ln = box.querySelector('a'); ln.textContent = tr('Ouvrir pisteo.app sans transférer'); ln.href = NEW_ORIGIN + '/';
    go.onclick = async () => {
      const data = await exportAll(), w = window.open(NEW_ORIGIN + '/?from=old', '_blank');
      if (!w) { location.href = NEW_ORIGIN + '/'; return; }
      const onMsg = e => { if (e.origin === NEW_ORIGIN && e.data && e.data.type === 'pisteo-ready') { w.postMessage({ type: 'pisteo-move', data }, NEW_ORIGIN); window.removeEventListener('message', onMsg); go.textContent = tr('Transfert fait ✓'); } };
      window.addEventListener('message', onMsg);
    };
    document.body.appendChild(box);
  }
  if (!AND && location.hostname !== OLD_HOST && /[?&]from=old/.test(location.search) && window.opener) {
    history.replaceState(null, '', location.pathname);
    window.addEventListener('message', e => { if (e.origin === 'https://' + OLD_HOST && e.data && e.data.type === 'pisteo-move') importAll(e.data.data); });
    try { window.opener.postMessage({ type: 'pisteo-ready' }, 'https://' + OLD_HOST); } catch {}
  }
})();
stvUI();
const VERSION = APP_VERSION + ' · 19 oct. 2026';
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
// Appli Android : bouton retour (ferme d'abord le panneau ouvert) et GPX reçu d'une autre appli
if (AND) {
  $('btnPip').style.display = 'none'; // fenêtre réduite : pas encore dans l'appli Android
  window.pisteoBack = () => {
    const open = [...document.querySelectorAll('.lib')].filter(x => !x.hidden);
    if (open.length) { open[open.length - 1].hidden = true; return true; }
    if (!$('more').hidden) { toggleMore(false); return true; }
    return false;
  };
  window.pisteoCheckShared = checkShared;
}
window.__balise = { onPos, get state() { return { nav, isOff, rejoin: !!rejoin, straight: rejoin && rejoin.straight, progress, act: Object.assign({ elapsed: actElapsed(), state: actState, points: rec.length }, act) }; } };
})();

// au doigt, une liste ou une case garde le cadre bleu de sélection après le choix : on le retire une fois la valeur choisie
document.addEventListener('change', e => { const t = e.target; if (t && (t.tagName === 'SELECT' || t.type === 'checkbox')) setTimeout(() => t.blur(), 400); }, true);
