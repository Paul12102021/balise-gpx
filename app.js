/* Pisteo — navigation guidée sur une trace GPX
   © 2026 Pisteo. Tous droits réservés — toute copie ou réutilisation est interdite sans autorisation (voir LICENSE). */
(() => {
'use strict';

// La page et le code doivent être de la même version. Sinon (page gardée en cache
// par le téléphone ou par GitHub), on recharge une page fraîche, au plus 3 fois.
const APP_VERSION = 270;
// lien « pisteo.app/?moi=1 » (ou ?moi=0) : cet appareil est compté à part dans les statistiques (développeur).
// Lu avant tout rechargement de version, qui ne garde pas les paramètres de l'adresse.
try {
  const mm = location.search.match(/[?&]moi=([01])/);
  if (mm) {
    if (mm[1] === '1') localStorage.setItem('statMoi', '1'); else localStorage.removeItem('statMoi');
    sessionStorage.setItem('moiToast', mm[1]);
    const q = location.search.replace(/([?&])moi=[01](&|$)/, '$1').replace(/[?&]$/, '');
    history.replaceState(null, '', location.pathname + q + location.hash);
  }
} catch {}
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
  if (/[?&]fresh=/.test(location.search)) history.replaceState(null, '', location.pathname + (/[?&]shared=1/.test(location.search) ? '?shared=1' : /[?&]migrate=1/.test(location.search) ? '?migrate=1' : '') + location.hash); // garder le parcours partagé (#…)
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
  return txt.replace(/^Continuez tout droit/, 'continue tout droit').replace(/^Gardez la/, 'garde la')
    .replace(/^Série de lacets/, 'une série de lacets commence').replace(/^Faites demi-tour/, 'fais demi-tour').replace(/^Tournez/, 'tourne')
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

function turnInfo(t) {
  if (t && typeof t === 'object') {
    if (t.kind === 'straight') return { txt: 'Continuez tout droit', icon: 0 };
    if (t.kind === 'keepL') return { txt: 'Gardez la gauche', icon: -25 };
    if (t.kind === 'keepR') return { txt: 'Gardez la droite', icon: 25 };
    if (t.kind === 'lacets') return { txt: 'Série de lacets', icon: 'lacets' };
    t = t.ang;
  }
  const ang = t, a = Math.abs(ang), side = ang > 0 ? 'à droite' : 'à gauche';
  if (a >= 150) return { txt: 'Faites demi-tour', icon: 'uturn' };
  if (a >= 110) return { txt: `Tournez franchement ${side}`, icon: ang };
  if (a >= 60) return { txt: `Tournez ${side}`, icon: ang };
  return { txt: `Légèrement ${side}`, icon: ang };
}

// =====================================================================
// Carrefours : le réseau de chemins OpenStreetMap autour de la trace
// Les virages ne sont plus annoncés à chaque courbe du tracé, mais aux vrais carrefours :
// on y dit aussi « tout droit » ou « garde la gauche » quand un autre chemin part presque dans la même direction.
// Une courbe du chemin sans carrefour n'est pas annoncée ; une suite d'épingles devient « série de lacets ».
// Sans données (pas de réseau, hors des chemins connus) : les virages du tracé, comme avant.
// =====================================================================
const NET_STEP = 20; // un échantillon de la trace tous les 20 m : sur un chemin connu ou non
const NET_SKIP = '^(proposed|construction|abandoned|platform|corridor|elevator|bus_stop|raceway|rest_area|services|razed)$';
function netKey(p) {
  const r = q => q.lat.toFixed(4) + ',' + q.lon.toFixed(4), a = r(p.pts[0]), b = r(p.pts[p.pts.length - 1]);
  // même clé dans les deux sens (trace inversée : mêmes carrefours)
  return 'n2|' + [a, b].sort().join('|') + '|' + r(pointAt(p, p.total / 2)) + '|' + Math.round(p.total / 10);
}
// direction d'une branche : vers le point du chemin situé environ 20 m plus loin
function netBranch(geom, i, dir) {
  const a = geom[i]; let k = i, d = 0;
  while (true) {
    const j = k + dir; if (j < 0 || j >= geom.length || !geom[j]) break;
    d += hav(geom[k], geom[j]); k = j; if (d >= 20) break;
  }
  return k === i ? null : bearing(a, geom[k]);
}
function netBuild(p, json) {
  const nodes = new Map(), segs = [];
  for (const w of json.elements || []) {
    if (w.type !== 'way' || !w.geometry || !w.nodes || w.nodes.length < 2) continue;
    const g = w.geometry, ids = w.nodes, n = ids.length, closed = ids[0] === ids[n - 1];
    for (let i = 0; i < n; i++) {
      if (!g[i]) continue;
      if (i > 0 && g[i - 1]) segs.push([g[i - 1], g[i]]);
      if (closed && i === n - 1) continue;
      let o = nodes.get(ids[i]); if (!o) nodes.set(ids[i], o = { lat: g[i].lat, lon: g[i].lon, br: [] });
      const back = i > 0 ? netBranch(g, i, -1) : closed ? netBranch(g, n - 1, -1) : null;
      const fwd = i < n - 1 ? netBranch(g, i, 1) : null;
      if (back != null) o.br.push(back);
      if (fwd != null) o.br.push(fwd);
    }
  }
  // carrefour : au moins trois branches distinctes (deux chemins superposés ne comptent qu'une fois)
  const jn = [];
  for (const o of nodes.values()) {
    const br = [];
    for (const b of o.br) if (br.every(x => Math.abs(angDiff(x, b)) > 15)) br.push(b);
    if (br.length >= 3) jn.push([+o.lat.toFixed(6), +o.lon.toFixed(6), br.map(b => Math.round(b))]);
  }
  // trace sur un chemin connu, tous les 20 m (écart ≤ 15 m)
  const C = 0.0003, grid = new Map(), cell = (la, lo) => Math.floor(la / C) + ':' + Math.floor(lo / C);
  for (const s of segs) {
    const la0 = Math.min(s[0].lat, s[1].lat), la1 = Math.max(s[0].lat, s[1].lat), lo0 = Math.min(s[0].lon, s[1].lon), lo1 = Math.max(s[0].lon, s[1].lon);
    if ((la1 - la0) / C > 40 || (lo1 - lo0) / C > 40) continue; // segment démesuré : ignoré
    for (let y = Math.floor(la0 / C) - 1; y <= Math.floor(la1 / C) + 1; y++) for (let x = Math.floor(lo0 / C) - 1; x <= Math.floor(lo1 / C) + 1; x++) {
      const k = y + ':' + x; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(s);
    }
  }
  let on = '';
  for (let d = 0; d <= p.total; d += NET_STEP) {
    const q = pointAt(p, d), a = grid.get(cell(q.lat, q.lon));
    on += a && a.some(s => segDist(q, s[0], s[1]) <= 15) ? '1' : '0';
  }
  return { id: netKey(p), t: Date.now(), o: [+p.pts[0].lat.toFixed(5), +p.pts[0].lon.toFixed(5)], jn, on };
}
// distance (m) d'un point à un segment
function segDist(q, a, b) {
  const kx = Math.cos(rad(q.lat)) * 111320, ky = 110540;
  const ax = (a.lon - q.lon) * kx, ay = (a.lat - q.lat) * ky, bx = (b.lon - q.lon) * kx, by = (b.lat - q.lat) * ky;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, f = L ? clamp(-(ax * dx + ay * dy) / L, 0, 1) : 0;
  return Math.hypot(ax + f * dx, ay + f * dy);
}
// passages de la trace près d'un point (une boucle ou un aller-retour peut y passer plusieurs fois)
function netPasses(p, idx, q, tol) {
  const C = 0.0003, hits = [];
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const a = idx.get((Math.floor(q.lat / C) + y) + ':' + (Math.floor(q.lon / C) + x)); if (!a) continue;
    for (const i of a) {
      const d = segDist(q, p.pts[i], p.pts[i + 1]); if (d > tol) continue;
      const L = p.cum[i + 1] - p.cum[i], f = L ? clamp(hav(p.pts[i], q) / L, 0, 1) : 0, cosA = Math.sqrt(Math.max(0, 1 - (d / Math.max(hav(p.pts[i], q), d || 1)) ** 2));
      hits.push({ along: p.cum[i] + L * f * cosA, d });
    }
  }
  hits.sort((a, b) => a.along - b.along);
  const out = [];
  for (const h of hits) { const l = out[out.length - 1]; if (l && h.along - l.along < 40) { if (h.d < l.d) out[out.length - 1] = h; } else out.push(h); }
  return out;
}
function trackIndex(p) {
  const C = 0.0003, idx = new Map(), P = p.pts;
  for (let i = 0; i < P.length - 1; i++) {
    const ks = new Set([Math.floor(P[i].lat / C) + ':' + Math.floor(P[i].lon / C), Math.floor(P[i + 1].lat / C) + ':' + Math.floor(P[i + 1].lon / C)]);
    for (const k of ks) { let a = idx.get(k); if (!a) idx.set(k, a = []); a.push(i); }
  }
  return idx;
}
// virages d'un chemin à partir des carrefours connus
function netTurns(p, net) {
  const geo = computeTurns(p).filter(t => !t.arrive);
  const same = Math.abs(net.o[0] - p.pts[0].lat) < 2e-4 && Math.abs(net.o[1] - p.pts[0].lon) < 2e-4;
  // échantillons pris dans le sens d'origine : trace inversée → on compte depuis l'autre bout
  const onNet = d => { const c = net.on[Math.round((same ? d : p.total - d) / NET_STEP)]; return c === '1' || c == null; };
  const idx = trackIndex(p), ev = [];
  for (const [lat, lon, br] of net.jn) {
    for (const pass of netPasses(p, idx, { lat, lon }, 15)) {
      const a = pass.along; if (a < 15 || p.total - a < 15) continue;
      const J = { lat, lon }, inB = bearing(pointAt(p, a - 25), J), outB = bearing(J, pointAt(p, a + 25)), ang = angDiff(inB, outB);
      const backB = (inB + 180) % 360;
      // les deux branches de la trace (celle d'où l'on vient, celle où l'on va) : les plus proches de ces directions
      const near = d => br.reduce((x, b) => Math.abs(angDiff(b, d)) < Math.abs(angDiff(x, d)) ? b : x, br[0]);
      const bIn = near(backB), bOut = near(outB);
      if (Math.abs(angDiff(bIn, backB)) > 45 || Math.abs(angDiff(bOut, outB)) > 45) continue; // la trace ne suit pas ces chemins
      const others = br.filter(b => b !== bIn && b !== bOut).map(b => angDiff(inB, b));
      if (!others.length) continue; // le carrefour ne concerne pas ce passage
      if (Math.abs(ang) >= 35) ev.push({ along: a, ang, j: 1 });
      else {
        const close = others.filter(r => Math.abs(r) < 60); // un autre chemin part presque tout droit : on précise
        if (!close.length) continue;
        const kind = close.every(r => r > ang) ? 'keepL' : close.every(r => r < ang) ? 'keepR' : 'straight';
        ev.push({ along: a, ang, kind, j: 1 });
      }
    }
  }
  const jnNear = q => net.jn.some(([lat, lon]) => hav(q, { lat, lon }) <= 35);
  const bends = [];
  for (const t of geo) {
    if (ev.some(e => Math.abs(e.along - t.along) <= 30)) continue; // le carrefour tout proche fait foi
    const q = pointAt(p, t.along);
    if (!onNet(t.along) || Math.abs(t.ang) >= 150 || jnNear(q)) ev.push(t); // hors chemin connu, demi-tour, ou carrefour un peu décalé
    else bends.push(t); // simple courbe du chemin : rien à annoncer
  }
  // lacets : au moins 3 épingles qui se suivent, à moins de 250 m l'une de l'autre
  let run = [];
  const flush = () => { if (run.length >= 3) ev.push({ along: Math.max(1, run[0].along - 15), ang: 0, kind: 'lacets', n: run.length, len: run[run.length - 1].along - run[0].along + 30 }); run = []; };
  for (const b of bends) {
    if (Math.abs(b.ang) < 80) continue;
    if (run.length && b.along - run[run.length - 1].along > 250) flush();
    run.push(b);
  }
  flush();
  // deux consignes à moins de 25 m : on garde la plus importante
  const rank = t => t.kind === 'lacets' ? 0 : t.kind ? 1 : 2 + Math.abs(t.ang) / 180;
  ev.sort((a, b) => a.along - b.along);
  const out = [];
  for (const t of ev) {
    const l = out[out.length - 1];
    if (l && t.kind !== 'lacets' && l.kind !== 'lacets' && t.along - l.along < 25) { if (rank(t) > rank(l)) out[out.length - 1] = t; }
    else out.push(t);
  }
  out.push({ along: p.total, ang: 0, arrive: true });
  return out;
}
async function netGet(id) { try { return await idb('readonly', st => st.get(id), 'net'); } catch { return null; } }
async function netPut(rec) {
  try {
    await idb('readwrite', st => st.put(rec), 'net');
    const all = await idb('readonly', st => st.getAllKeys(), 'net');
    if (all && all.length > 40) { // on ne garde que les 40 traces les plus récentes
      const recs = (await idb('readonly', st => st.getAll(), 'net')).sort((a, b) => a.t - b.t);
      await idb('readwrite', st => { recs.slice(0, recs.length - 40).forEach(r => st.delete(r.id)); }, 'net');
    }
  } catch { /* stockage indisponible : le calcul sera refait */ }
}
const netBusy = new Set();
async function netAttach(p) {
  if (!p || p.total < 200 || p.total > 400000) return;
  const key = netKey(p);
  let net = await netGet(key);
  if (!net) {
    if (netBusy.has(key) || navigator.onLine === false) return;
    netBusy.add(key);
    try {
      const sp = simplifyDP(p.pts, 3000), coords = [];
      for (let i = 0; i < sp.length; i += 199) coords.push(sp.slice(i, i + 200).map(q => q.lat.toFixed(5) + ',' + q.lon.toFixed(5)).join(','));
      const f = `[highway][highway!~"${NET_SKIP}"][footway!~"^(sidewalk|crossing)$"][service!~"^(driveway|parking_aisle|drive-through)$"][access!~"^(private|no)$"]`;
      const q = `[out:json][timeout:90];(${coords.map(c => `way(around:20,${c})${f};`).join('')});out geom qt;`;
      const json = await overpassFast(q, null, true, null, false);
      net = netBuild(p, json); await netPut(net);
      stat('net_ok');
    } catch { stat('net_err'); return; }
    finally { netBusy.delete(key); }
  }
  if (!p.pts) return;
  try { p.turns = netTurns(p, net); p.net = 1; stat('net_used'); if (p === track && nav) guidance(); }
  catch (e) { console.error(e); }
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
// Photos aériennes IGN (BD ORTHO) : données ouvertes, France et outre-mer seulement, affichage en ligne
const ORTHO_URL = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM_0_19&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg';
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
  { id: 'ortho', name: 'Photos aériennes', tiles: [ORTHO_URL], max: 19, france: true, attr: '© <a href="https://www.ign.fr">IGN</a> · BD ORTHO' },
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

// Grand écran (PC, tablette à l'horizontale) : le panneau passe à gauche, la carte reste visible à droite.
// Seulement en aperçu : navigation, tracé point par point, choix d'une zone… gardent l'écran entier.
const WIDE = matchMedia('(min-width: 1000px) and (min-height: 560px)');
const isSide = () => document.body.classList.contains('side');
const sheetPad = () => isSide() ? 0 : $('sheet').offsetHeight;
function sideUpdate() {
  const b = document.body.classList;
  const on = WIDE.matches && !['nav', 'plan', 'zone', 'rtmode', 'choosing'].some(c => b.contains(c));
  if (on === b.contains('side')) return;
  b.toggle('side', on);
  if (!on) document.documentElement.style.setProperty('--sheet-h', $('sheet').offsetHeight + 'px');
  map.resize();
  setTimeout(() => { try { drawProfile(); } catch { /* pas encore prêt au démarrage */ } }, 0);
}
WIDE.addEventListener('change', sideUpdate);
new MutationObserver(sideUpdate).observe(document.body, { attributes: true, attributeFilter: ['class'] });
sideUpdate();
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
  // les photos aériennes IGN ne couvrent que la France : on les saute quand la carte est sur un autre pays
  let next = (layerIdx + 1) % LAYERS.length;
  while (LAYERS[next].france && natCur !== 'ign') next = (next + 1) % LAYERS.length;
  const N = LAYERS[next];
  setLayer(next); toast('Fond de carte : ' + N.name + (N.volunteer ? ' · service bénévole, parfois lent ou indisponible' : N.france ? ' · en ligne seulement' : ''), N.volunteer ? 4000 : 2800);
};
// Fond de carte qui ne répond plus (serveur en panne) : on passe sur un autre fond, sans changer le choix enregistré.
// Bascule seulement si plusieurs tuiles échouent ET qu'aucune n'arrive depuis 20 s (une tuile manquante en bord
// de pays ne suffit pas) ; une seule bascule automatique toutes les 3 min, jamais vers le fond qu'on vient de quitter.
// Secours : carte officielle (IGN…) ↔ Monde (OpenFreeMap), et Topo si les deux tombent ; photos aériennes → IGN.
let baseErrs = [], baseOk = 0, autoSwitch = { t: 0, from: -1 };
map.on('data', e => { if (e.tile && (e.sourceId === 'base' || e.sourceId === 'ofm')) baseOk = Date.now(); });
map.on('error', e => {
  const L = LAYERS[layerIdx];
  if (!L || (e.sourceId !== 'base' && e.sourceId !== 'ofm') || navigator.onLine === false) return;
  const now = Date.now(); baseErrs = baseErrs.filter(t => now - t < 20000); baseErrs.push(now);
  if (baseErrs.length < 8 || now - baseOk < 20000 || now - autoSwitch.t < 3 * 6e4) return;
  baseErrs = [];
  const c = map.getCenter(), inFr = c.lng > -5.5 && c.lng < 9.8 && c.lat > 41.2 && c.lat < 51.2;
  const idOf = id => LAYERS.findIndex(l => l.id === id);
  let to;
  if (L.france && !inFr) to = natCur !== 'ign' ? 0 : idOf('monde'); // photos aériennes hors de France
  else if (L.vector) to = 0;                       // Monde en panne → carte officielle du pays
  else if (L.id === 'ign') to = idOf('monde');      // carte officielle en panne → Monde
  else to = inFr || natCur !== 'ign' ? 0 : idOf('monde');
  if (to === autoSwitch.from || to === layerIdx) to = idOf('topo'); // le secours lui-même est tombé
  if (to < 0 || to === layerIdx || to === autoSwitch.from) return;
  autoSwitch = { t: now, from: layerIdx }; baseOk = now;
  setLayer(to, false);
  toast(L.france && !inFr ? 'Photos aériennes : France seulement' : `${L.name} ne répond pas : carte ${LAYERS[to].name} à la place`, 4500);
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
  // points notés (<wpt>) et description : partagés avec le parcours
  const wpts = [...doc.getElementsByTagName('wpt')].slice(0, NOTE_MAX).map(w => {
    const g = k => { const e = w.getElementsByTagName(k)[0]; return e ? e.textContent.trim() : ''; };
    const name = g('name'), desc = g('desc') || g('cmt');
    return { lat: +w.getAttribute('lat'), lon: +w.getAttribute('lon'), kind: NOTE_KINDS[g('type')] ? g('type') : 'info',
      name: (name || desc).slice(0, 120), desc: name && desc && desc !== name ? desc.slice(0, 300) : '' };
  }).filter(w => isFinite(w.lat) && isFinite(w.lon) && w.name);
  const dEl = doc.querySelector('metadata > desc, trk > desc, rte > desc');
  return { name: nameEl ? nameEl.textContent.trim() : 'Trace sans nom', pts, wpts, desc: dEl ? dEl.textContent.trim().slice(0, NOTE_DESC_MAX) : '' };
}
// ---------- points notés sur la trace (vue, eau, passage difficile…) et description ----------
const NOTE_MAX = 30, NOTE_DESC_MAX = 500;
const NOTE_KINDS = {
  vue: { e: '📷', l: 'Point de vue' }, eau: { e: '💧', l: 'Eau' }, difficile: { e: '🥾', l: 'Passage difficile' },
  danger: { e: '⚠️', l: 'Danger' }, info: { e: '📍', l: 'Info' }
};
let noteMks = [];
function drawNotes() {
  noteMks.forEach(m => m.remove()); noteMks = [];
  if (!track) return;
  track.wpts.forEach((n, i) => {
    const e = document.createElement('button'); e.className = 'mk-note k-' + n.kind; e.innerHTML = `<span>${NOTE_KINDS[n.kind].e}</span>`;
    e.setAttribute('aria-label', tr(NOTE_KINDS[n.kind].l) + ' : ' + n.name);
    e.onclick = ev => {
      ev.stopPropagation();
      const t = `${NOTE_KINDS[n.kind].e} ${n.name}${n.desc ? ' · ' + n.desc : ''}`, mine = track;
      toast(t, 6000, nav ? null : { label: 'Supprimer', run: () => { if (track !== mine) return; mine.wpts.splice(mine.wpts.indexOf(n), 1); commitNotes(); toast('Point supprimé', 2500); } });
    };
    noteMks.push(new maplibregl.Marker({ element: e, anchor: 'bottom', offset: [0, -4] }).setLngLat([n.lon, n.lat]).addTo(map));
  });
}
function trackDescUI() {
  const d = track && track.desc;
  $('trackDesc').textContent = d || ''; $('trackDesc').hidden = !d;
}
// réécrit le GPX enregistré avec les points et la description à jour (le reste du fichier est gardé tel quel)
function withNotes(text, notes) {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('gpx');
    const root = doc.documentElement, ns = root.namespaceURI || null, kids = e => [...e.children];
    const mk = (tag, txt) => { const e = doc.createElementNS(ns, tag); if (txt != null) e.textContent = txt; return e; };
    [...doc.getElementsByTagName('wpt')].forEach(e => e.remove());
    let md = kids(root).find(e => e.localName === 'metadata');
    if (md) kids(md).filter(e => e.localName === 'desc').forEach(e => e.remove());
    kids(root).filter(e => e.localName === 'trk' || e.localName === 'rte').forEach(t => kids(t).filter(e => e.localName === 'desc').forEach(e => e.remove()));
    if (notes.desc) {
      if (!md) { md = mk('metadata'); root.insertBefore(md, root.firstElementChild); }
      const nm = kids(md).find(e => e.localName === 'name');
      md.insertBefore(mk('desc', notes.desc), nm ? nm.nextSibling : md.firstChild);
    }
    const ref = md ? md.nextSibling : root.firstChild;
    for (const n of notes.wpts) {
      const w = mk('wpt'); w.setAttribute('lat', n.lat.toFixed(6)); w.setAttribute('lon', n.lon.toFixed(6));
      w.append(mk('name', n.name)); if (n.desc) w.append(mk('desc', n.desc)); w.append(mk('type', n.kind));
      root.insertBefore(w, ref);
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(doc).replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  } catch { return loopGPX(track.pts, track.name, notes); }
}
// enregistre les notes de la trace ouverte (et dans « Mes traces » si elle y est)
async function commitNotes() {
  if (!track) return;
  const mine = track, saved = store.get('gpx'), base = saved && saved.includes('<trkpt') ? saved : loopGPX(mine.pts, mine.name);
  const text = withNotes(base, { desc: mine.desc, wpts: mine.wpts });
  store.set('gpx', text.length < 4.5e6 ? text : '');
  drawNotes(); trackDescUI();
  try {
    if (mine.recItem) { mine.recItem.text = text; const r = mine.recItem; await idb('readwrite', st => st.put(r)); return; }
    const id = mine.name + '|' + Math.round(mine.total), it = (await listRecent()).find(x => x.id === id);
    if (it) await idb('readwrite', st => st.put(Object.assign({}, it, { text })));
  } catch { /* « Mes traces » indisponible : la trace ouverte garde ses notes */ }
}
// noter un point : on touche la carte, puis on choisit le type et on écrit un mot
let ndPt = null, ndKind = 'vue';
function addNote(after) {
  if (!track) return;
  startPick('Touche la carte à l\'endroit du point à noter', Object.assign(pt => {
    ndPt = pt; ndKind = 'vue'; $('ndText').value = ''; ndKindsUI(); $('noteDlg').hidden = false; $('noteDlg').dataset.after = after || '';
    setTimeout(() => $('ndText').focus(), 50);
  }, { cancel: () => { if (after === 'send') openSend({ name: track.name, pts: track.pts, cur: true }); } }));
}
function ndKindsUI() {
  const box = $('ndKinds'); box.innerHTML = '';
  for (const k in NOTE_KINDS) {
    const b = document.createElement('button'); b.className = 'chip' + (k === ndKind ? '' : ' nd-off'); b.textContent = NOTE_KINDS[k].e + ' ' + tr(NOTE_KINDS[k].l);
    b.onclick = () => { ndKind = k; ndKindsUI(); }; box.appendChild(b);
  }
}
function ndClose(ok) {
  $('noteDlg').hidden = true;
  const after = $('noteDlg').dataset.after;
  if (ok && track && ndPt) {
    if (track.wpts.length >= NOTE_MAX) toast(`${NOTE_MAX} points au plus par parcours.`, 3500);
    else {
      const txt = $('ndText').value.trim().slice(0, 120) || tr(NOTE_KINDS[ndKind].l);
      track.wpts.push({ lat: ndPt.lat, lon: ndPt.lon, kind: ndKind, name: txt, desc: '' }); commitNotes();
      toast('Point noté : il sera dans le lien partagé', 3000);
    }
  }
  ndPt = null;
  if (after === 'send' && track) openSend({ name: track.name, pts: track.pts, cur: true });
}
$('ndOk').onclick = () => ndClose(true);
$('ndClose').onclick = () => ndClose(false);
$('noteDlg').onclick = e => { if (e.target === $('noteDlg')) ndClose(false); };
$('ndText').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ndClose(true); } });
// ---------- signaler un problème de terrain à OpenStreetMap (note publique, sans compte) ----------
// Des bénévoles d'OpenStreetMap lisent ces notes et corrigent la carte, qui sert à Pisteo et à beaucoup d'autres applis.
// Sans réseau, le signalement attend et part dès que le téléphone en retrouve.
const OSM_API = 'https://api.openstreetmap.org/api/0.6';
const REP_KINDS = {
  ferme: '🚧 Chemin fermé ou impraticable', obstacle: '🌲 Obstacle (arbre tombé, éboulement…)', balisage: '🪧 Balisage manquant ou effacé',
  absent: '➕ Chemin absent de la carte', autre: '✏️ Autre problème'
};
// questions guidées par type : les réponses forment une note claire, que les bénévoles peuvent traiter sans venir sur place
const REP_Q = {
  ferme: [['Cause', ['Travaux', 'Éboulement ou effondrement', 'Propriété privée ou interdiction', 'Végétation envahissante', 'Inconnue']],
          ['Durée', ['Temporaire', 'Durable', 'Je ne sais pas']]],
  obstacle: [['Type', ['Arbre tombé', 'Éboulement', 'Boue ou inondation', 'Passerelle abîmée', 'Autre']],
             ['Passage', ['Franchissable', 'Infranchissable']]],
  balisage: [['Problème', ['Absent', 'Effacé', 'Contradictoire', 'Panneau manquant']]],
  absent: [['Type de chemin', ['Sentier', 'Chemin large ou piste', 'Piste cyclable']],
           ['Praticable', ['À pied', 'À vélo', 'À pied et à vélo']]],
  autre: []
};
const REP_HINT = {
  ferme: 'Précisions (facultatif) : panneau sur place, déviation possible…',
  obstacle: 'Précisions (facultatif) : taille, contournement possible…',
  balisage: 'Quel balisage ? Couleur, nom de l\'itinéraire (GR, PR…), sens de marche',
  absent: 'Où mène ce chemin ? Revêtement, état…',
  autre: 'Décris le problème (obligatoire)'
};
let repAns = {};
const REP_DAY_MAX = 5;
let repPt = null, repKind = 'ferme', repAfter = null;
function openUrl(u) {
  if (AND && AND.openExternal) { try { AND.openExternal(u, true); } catch { try { AND.openExternal(u); } catch {} } return; }
  window.open(u, '_blank', 'noopener');
}
function openReport(pt, after) {
  if (!pt) { toast('Position GPS introuvable. Va à découvert et réessaie.', 4000); return; }
  repPt = { lat: pt.lat, lon: pt.lon }; repAfter = after || null; repKind = 'ferme'; repAns = {}; $('repText').value = ''; repKindsUI(); $('repMsg').hidden = true;
  $('repDlg').hidden = false;
}
function repKindsUI() {
  const box = $('repKinds'); box.innerHTML = '';
  for (const k in REP_KINDS) {
    const b = document.createElement('button'); b.className = 'chip' + (k === repKind ? '' : ' nd-off'); b.textContent = tr(REP_KINDS[k]);
    b.onclick = () => { if (k !== repKind) { repKind = k; repAns = {}; } repKindsUI(); }; box.appendChild(b);
  }
  const qb = $('repQs'); qb.innerHTML = '';
  for (const [q, opts] of REP_Q[repKind]) {
    const row = document.createElement('div'); row.className = 'rep-q';
    const lab = document.createElement('span'); lab.textContent = tr(q); row.appendChild(lab);
    const ch = document.createElement('div'); ch.className = 'nd-kinds';
    for (const o of opts) {
      const b = document.createElement('button'); b.className = 'chip small' + (repAns[q] === o ? '' : ' nd-off'); b.textContent = tr(o);
      b.onclick = () => { repAns[q] = repAns[q] === o ? undefined : o; repKindsUI(); }; ch.appendChild(b);
    }
    row.appendChild(ch); qb.appendChild(row);
  }
  $('repText').placeholder = tr(REP_HINT[repKind]);
  repPreview();
}
// la note telle qu'elle partira : une ligne par information, la date du constat et le moyen de déplacement
function repNoteText() {
  const L = [tr(REP_KINDS[repKind].replace(/^\S+\s/, ''))];
  for (const [q] of REP_Q[repKind]) if (repAns[q]) L.push(`${tr(q)} : ${tr(repAns[q])}`);
  const det = $('repText').value.trim().slice(0, 500);
  if (det) L.push(`${tr('Précisions')} : ${det}`);
  L.push(tr(`Constaté ${profile === 'trekking' ? 'à vélo' : 'à pied'} le ${new Date().toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric' })}`));
  return L.join('\n') + '\n\n#Pisteo';
}
function repPreview() { $('repPrev').textContent = repNoteText(); }
$('repText').addEventListener('input', repPreview);
function repClose() { $('repDlg').hidden = true; const a = repAfter; repAfter = null; if (a) a(); }
const repQueue = () => { try { return JSON.parse(store.get('osmQueue') || '[]'); } catch { return []; } };
const repSent = () => { try { return JSON.parse(store.get('osmSent') || '[]').filter(t => Date.now() - t < 864e5); } catch { return []; } };
$('repOk').onclick = async () => {
  if (!repPt) return;
  const det = $('repText').value.trim().slice(0, 500);
  const say = m => { $('repMsg').textContent = tr(m); $('repMsg').hidden = false; };
  if ((repKind === 'absent' || repKind === 'autre' || repKind === 'balisage') && det.length < 8) { say(repKind === 'balisage' ? 'Indique le balisage concerné (couleur ou nom de l\'itinéraire) : sans ça, impossible de le corriger.' : 'Décris le problème en quelques mots : les bénévoles doivent comprendre quoi corriger.'); return; }
  const missing = REP_Q[repKind].filter(([q]) => !repAns[q]).map(([q]) => tr(q).toLowerCase());
  if (missing.length) { say(tr('Réponds aussi à : ') + missing.join(', ')); return; }
  if (repSent().length + repQueue().length >= REP_DAY_MAX) { say(`${REP_DAY_MAX} signalements par jour au plus, pour éviter les envois en double.`); return; }
  const text = repNoteText();
  const q = repQueue(); q.push({ lat: +repPt.lat.toFixed(6), lon: +repPt.lon.toFixed(6), text, t: Date.now() }); store.set('osmQueue', JSON.stringify(q));
  repClose();
  const n = await repFlush();
  toast(n ? 'Merci ! Signalement envoyé à OpenStreetMap' : 'Pas de réseau : le signalement partira dès que possible', 4000);
};
$('repCancel').onclick = repClose;
$('repDlg').onclick = e => { if (e.target === $('repDlg')) repClose(); };
let repBusy = false;
async function repFlush() {
  if (repBusy || navigator.onLine === false) return 0;
  repBusy = true; let sent = 0;
  try {
    for (const it of repQueue()) {
      let r;
      try { r = await fetch(`${OSM_API}/notes.json`, { method: 'POST', body: new URLSearchParams({ lat: it.lat, lon: it.lon, text: it.text }) }); }
      catch { break; } // pas de réseau : on réessaiera
      if (r.status === 429 || r.status >= 500) break; // serveur occupé : plus tard
      store.set('osmQueue', JSON.stringify(repQueue().filter(x => x.t !== it.t)));
      if (r.ok) {
        sent++; store.set('osmSent', JSON.stringify(repSent().concat(Date.now())));
        try { const f = await r.json(); if (f && f.properties) { osmNotes.push(osmNote(f)); osmDraw(); } } catch {}
      }
    }
  } finally { repBusy = false; }
  return sent;
}
window.addEventListener('online', () => setTimeout(repFlush, 3000));
setTimeout(repFlush, 8000);
$('ndReport').onclick = () => { const pt = ndPt, after = $('noteDlg').dataset.after; $('noteDlg').hidden = true; ndPt = null;
  openReport(pt, after === 'send' ? () => { if (track) openSend({ name: track.name, pts: track.pts, cur: true }); } : null); };
$('npReport').onclick = () => openReport(me);

// notes OpenStreetMap encore ouvertes le long de la trace : un problème déjà signalé par d'autres
let osmNotes = [], osmMks = [], osmFor = null;
const osmNote = f => {
  const c = (f.properties.comments || [])[0] || {};
  return { id: f.properties.id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], text: String(c.text || '').replace(/\s+/g, ' ').trim(), date: c.date || f.properties.date_created || '' };
};
function osmDraw() {
  osmMks.forEach(m => m.remove()); osmMks = [];
  if (!track) return;
  for (const n of osmNotes) {
    const e = document.createElement('button'); e.className = 'mk-osm'; e.textContent = '!';
    e.setAttribute('aria-label', tr('Problème signalé sur OpenStreetMap'));
    e.onclick = ev => {
      ev.stopPropagation();
      const d = Date.parse(n.date.replace(' UTC', 'Z').replace(' ', 'T'));
      toast(`${tr('Signalé sur OpenStreetMap')}${isNaN(d) ? '' : ' (' + fmtDate(d) + ')'} : ${n.text.slice(0, 140) || '…'}`, 7000, { label: 'Voir', run: () => openUrl(`https://www.openstreetmap.org/note/${n.id}`) });
    };
    osmMks.push(new maplibregl.Marker({ element: e }).setLngLat([n.lon, n.lat]).addTo(map));
  }
}
async function osmLoad() {
  const t = track; osmNotes = []; osmDraw();
  if (!t || navigator.onLine === false) return;
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of t.pts) { if (p.lon < w) w = p.lon; if (p.lon > e) e = p.lon; if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat; }
  const pad = 0.003; w -= pad; e += pad; s -= pad; n += pad;
  if ((e - w) * (n - s) > 4) return; // très grand parcours : on ne charge pas tout
  osmFor = t;
  try {
    const r = await fetch(`${OSM_API}/notes.json?bbox=${[w, s, e, n].map(v => v.toFixed(4)).join(',')}&limit=300&closed=0`);
    if (!r.ok || track !== t) return;
    const j = await r.json();
    osmNotes = (j.features || []).map(osmNote).filter(x => { const pr = project(t, x, true); return pr && pr.dist < 80; });
    if (track === t) osmDraw();
  } catch { /* pas de réseau ou service indisponible : rien à afficher */ }
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
  const sheetH = document.body.classList.contains('nav') ? 110 : sheetPad();
  const topH = document.body.classList.contains('nav') ? $('navTop').offsetHeight : isSide() ? 0 : 64;
  map.fitBounds(boundsOf(ptsList), { padding: { top: topH + 30, bottom: sheetH + 30, left: 40, right: 76 }, bearing: 0, pitch: 0, duration: 700, maxZoom: 16 });
}

async function showTrack(t, fit = true) {
  joinNear = false;
  track = makePath(t.pts, t.name); progress = null; clearRejoin(); loadDone();
  setTimeout(() => netAttach(track), 1500); // carrefours réels (en arrière-plan)
  track.climbs = computeClimbs(track); climbSpoken = new Map();
  track.wpts = (t.wpts || []).slice(); track.desc = t.desc || ''; trackDescUI();
  track.lit = litFor(track);
  setTimeout(trChipsUpdate, 0);
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
  setSrc('track', lineFeature(track.pts)); setDone(doneInfo().along / (track.total || 1), true); litUI();
  startMk.setLngLat([t.pts[0].lon, t.pts[0].lat]).addTo(map); drawNotes(); osmLoad();
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
  litShown = false; wxOn = false; wxDep = null; scrubD = null; if (scrubMk) scrubMk.remove(); wxApply(); trChipsUpdate(); // la météo part avec la trace
  // parcours balisés : on quitte leur affichage avec la trace (sauf si leur panneau est ouvert)
  if (rtMapOn && $('routes').hidden) rtHideMap();
  setSrc('track', EMPTY); setSrc('turn', EMPTY); litUI();
  startMk.remove(); endMk.remove(); drawNotes(); trackDescUI(); osmNotes = []; osmDraw();
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
  b.innerHTML = saved ? ICON_OK : ICON_SAVE; // icône seule : le nom de la trace garde la place
  const lab = tr(saved ? 'Trace enregistrée dans Mes traces' : 'Enregistrer la trace dans Mes traces');
  b.setAttribute('aria-label', lab); b.title = lab;
}
// nom trop long : un toucher l'affiche en entier
$('trackName').onclick = () => $('trackName').classList.toggle('full');
$('btnSaveTr').onclick = async () => {
  if (!track) return;
  if ($('btnSaveTr').classList.contains('done')) { toast('Déjà dans « Mes traces »', 3000, { label: 'Voir', run: openLib }); return; }
  const saved = store.get('gpx'), text = saved && saved.includes('<trkpt') ? saved : loopGPX(track.pts, track.name);
  await saveRecent(track, text);
  refreshSaveBtn();
  toast('Enregistrée dans « Mes traces »', 3500, { label: 'Voir', run: openLib });
};
// Inverser le sens : la même trace, parcourue de l'arrivée vers le départ
$('btnReverse').onclick = () => reverseTrack();
$('npRev').onclick = () => { toggleNavMore(false, true); reverseTrack(); };
function reverseTrack() {
  if (!track) return;
  const inNav = nav;
  const rev = track.name.endsWith(' (sens inverse)');
  const name = rev ? track.name.replace(/ \(sens inverse\)$/, '') : track.name + ' (sens inverse)';
  const text = loopGPX(track.pts.slice().reverse(), name, { desc: track.desc, wpts: track.wpts });
  const hadWx = wxShown(), dep = depAt();
  if (inNav) { // en navigation : on repart d'ici, dans l'autre sens, sans bouger la carte
    try { showTrack(parseGPX(text), false); } catch (e) { toast(e.message, 4000); return; }
    store.set('gpx', text.length < 4.5e6 ? text : ''); resetDone(); wrongReset(); arrived = false; poiAhead = null; poiSaid = new Set(); setTimeout(poiAlong, 500);
    navTrackId = track.id; if (me) { progress = project(track, me, true); guidance(); }
    say('Trace inversée. Tu es maintenant dans le bon sens.');
    toast('Trace inversée : tu es dans le bon sens', 3000);
    return;
  }
  loadText(text, false); store.set('gpx', text.length < 4.5e6 ? text : '');
  // météo affichée : on la garde, recalculée dans le nouveau sens (avec la même heure de départ)
  if (hadWx) { wxDep = dep ? { key: trKey(), t: dep } : null; wxOn = false; toggleWx(); }
  toast(rev ? 'Trace remise dans son sens d\'origine' : 'Trace inversée : départ et arrivée échangés', 3000);
}
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
    const r = indexedDB.open('balise', 7);
    r.onblocked = () => { clearTimeout(timer); dbP = null; rej(new Error('blocked')); };
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('packs')) d.createObjectStore('packs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('graphs')) d.createObjectStore('graphs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('graphChunks')) d.createObjectStore('graphChunks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('places')) d.createObjectStore('places', { keyPath: 'code' });
      if (!d.objectStoreNames.contains('net')) d.createObjectStore('net', { keyPath: 'id' }); // carrefours autour des traces
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' }); // photos des sorties (sur le téléphone)
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
    const old = await idb('readonly', st => st.get(id)).catch(() => null), keep = {};
    if (old && old.folder) keep.folder = old.folder;
    if (old && old.pos != null) keep.pos = old.pos;
    await idb('readwrite', st => st.put(Object.assign({ id, name: p.name, dist: p.total, up: p.hasEle ? p.totalUp : null, date: Date.now(), text }, keep, extra || {})));
    const all = (await listRecent()).filter(it => !isRec(it) && !it.folder);
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
// rangement : dossiers (un par projet) et ordre libre (appui long sur une trace, puis glisser)
const ICON_FOLDER = '<svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2.5h7.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z"/></svg>';
const ICON_GRIP = '<svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg>';
let libFolder = null, libMoveOpen = null; // dossier affiché (null : racine) · trace dont le menu « Ranger » est ouvert
function libFoldersStored() { try { const a = JSON.parse(store.get('libFolders') || '[]'); return Array.isArray(a) ? a.filter(x => typeof x === 'string' && x) : []; } catch { return []; } }
function libFolders(items) {
  const a = libFoldersStored();
  for (const it of items) if (it.folder && !a.includes(it.folder)) a.push(it.folder);
  return a;
}
const libSaveFolders = a => store.set('libFolders', JSON.stringify(a));
// ordre : les traces jamais déplacées (nouvelles) en haut, par date ; puis l'ordre choisi
const libSort = arr => arr.sort((a, b) => (a.pos == null) !== (b.pos == null) ? (a.pos == null ? -1 : 1) : a.pos == null ? b.date - a.date : a.pos - b.pos);
async function libPatch(ids, fn) {
  for (const id of ids) {
    const it = await idb('readonly', st => st.get(id)).catch(() => null);
    if (it) { fn(it); await idb('readwrite', st => st.put(it)).catch(() => {}); }
  }
}
// petite fenêtre de l'appli (à la place de celles du navigateur) : un nom à saisir, ou une confirmation
function libDialog({ title, text, value, ok, danger, ask }) {
  return new Promise(done => {
    const w = $('libDlg'), inp = $('libDlgIn'), sug = $('libDlgSug');
    $('libDlgTitle').textContent = tr(title);
    $('libDlgText').textContent = text ? tr(text) : ''; $('libDlgText').hidden = !text;
    inp.hidden = !ask; sug.hidden = !ask; sug.innerHTML = '';
    $('libDlgOk').textContent = tr(ok); $('libDlgOk').className = 'btn ' + (danger ? 'danger' : 'go');
    const finish = v => { w.hidden = true; w.onclick = null; inp.onkeydown = null; done(v); };
    const valid = () => { $('libDlgOk').disabled = ask && !inp.value.trim(); };
    if (ask) {
      inp.value = value || ''; inp.oninput = valid;
      inp.onkeydown = e => { if (e.key === 'Enter' && inp.value.trim()) finish(inp.value.trim().slice(0, 40)); };
      const have = new Set(libFoldersStored());
      for (const t of ['À faire', 'Déjà faites', 'Rando', 'Vélo', 'Vacances', 'Week-end']) {
        if (have.has(tr(t)) || value) continue;
        const c = document.createElement('button'); c.type = 'button'; c.className = 'lib-chip'; c.textContent = tr(t);
        c.onclick = () => { inp.value = c.textContent; valid(); inp.focus(); }; sug.appendChild(c);
      }
      sug.hidden = !sug.children.length;
    }
    valid();
    $('libDlgOk').onclick = () => finish(ask ? inp.value.trim().slice(0, 40) || null : true);
    $('libDlgNo').onclick = () => finish(ask ? null : false);
    w.onclick = e => { if (e.target === w) finish(ask ? null : false); };
    w.hidden = false;
    if (ask) setTimeout(() => { inp.focus(); inp.select(); }, 60);
  });
}
const libAskName = def => libDialog({ title: def ? 'Renommer le dossier' : 'Nouveau dossier', value: def, ok: def ? 'Renommer' : 'Créer', ask: true });
async function libNewFolder(moveId) {
  const items = (await listRecent()).filter(it => !isRec(it)), fs = libFolders(items);
  const n = await libAskName(''); if (!n) return;
  if (!fs.includes(n)) { fs.push(n); libSaveFolders(fs); }
  if (moveId) await libMoveTo(moveId, n); else renderLib();
}
async function libMoveTo(id, folder) {
  await libPatch([id], it => { if (folder) it.folder = folder; else delete it.folder; delete it.pos; });
  libMoveOpen = null; vibrate(15);
  toast(folder ? tr('Rangée dans « ' + folder + ' »') : tr('Sortie du dossier'), 2500);
  renderLib();
}
async function renderLib() {
  const list = $('libList'), all = (await listRecent()).filter(it => !isRec(it)), folders = libFolders(all);
  if (libFolder && !folders.includes(libFolder)) libFolder = null;
  const items = libSort(all.filter(it => (it.folder || null) === libFolder));
  list.innerHTML = '';
  $('libFoldHead').hidden = !libFolder; $('libBrowse').hidden = !!libFolder; $('libNewFold').hidden = !!libFolder;
  if (libFolder) $('libFoldName').textContent = libFolder;
  $('libTitle').textContent = tr('Mes traces');
  // dossiers en tête de la racine
  if (!libFolder) for (const f of folders) {
    const inF = all.filter(it => it.folder === f), km = inF.reduce((t, it) => t + (it.dist || 0), 0);
    const li = document.createElement('li'); li.className = 'lib-fold'; li.dataset.folder = f;
    const b = document.createElement('button'); b.className = 'lib-item';
    b.innerHTML = '<i>' + ICON_FOLDER + '</i><b></b><span></span>';
    b.querySelector('b').textContent = f;
    b.querySelector('span').textContent = inF.length ? (inF.length > 1 ? tr(inF.length + ' traces') : tr('1 trace')) + ' · ' + fmtDist(km) : tr('Vide');
    b.onclick = () => { libFolder = f; libMoveOpen = null; renderLib(); $('lib').querySelector('.lib-panel').scrollTop = 0; };
    li.appendChild(b); list.appendChild(li);
  }
  const empty = !items.length && (libFolder || !folders.length);
  $('libEmpty').hidden = !empty;
  $('libEmpty').textContent = libFolder ? tr('Ce dossier est vide. Pour y ranger une trace : touche l\'icône dossier à côté d\'elle, ou reste appuyé dessus et glisse-la sur le dossier.')
    : tr('Les traces que tu ouvres ou enregistres apparaîtront ici.');
  $('libHint').hidden = items.length < 2 && !(folders.length && items.length);
  for (const it of items) {
    const li = document.createElement('li'); li.className = 'lib-tr'; li.dataset.id = it.id;
    const open = document.createElement('button'); open.className = 'lib-item';
    open.innerHTML = '<b></b><span></span>';
    open.querySelector('b').textContent = it.name;
    open.querySelector('span').textContent = `${fmtDist(it.dist)}${it.up != null ? ' · D+ ' + fmtM(it.up) : ''} · ouverte le ${fmtDate(it.date)}`;
    open.onclick = () => { if (libDrag.justDropped) return; closeLib(); loadText(it.text); };
    const mv = document.createElement('button'); mv.className = 'lib-del' + (libMoveOpen === it.id ? ' on' : ''); mv.setAttribute('aria-label', tr('Ranger dans un dossier'));
    mv.innerHTML = ICON_FOLDER; mv.onclick = () => { libMoveOpen = libMoveOpen === it.id ? null : it.id; renderLib(); };
    const share = document.createElement('button'); share.className = 'lib-del'; share.setAttribute('aria-label', 'Envoyer ' + it.name);
    share.innerHTML = ICON_SHARE; share.onclick = () => { try { const t = parseGPX(it.text); openSend({ name: it.name, pts: t.pts, wpts: t.wpts, desc: t.desc, text: it.text }); } catch { shareGPX(it.text, it.name); } };
    const del = document.createElement('button'); del.className = 'lib-del'; del.setAttribute('aria-label', 'Retirer ' + it.name);
    del.innerHTML = ICON_DEL; del.onclick = async () => { await idb('readwrite', st => st.delete(it.id)).catch(() => {}); renderLib(); };
    li.append(open, mv, share, del); list.appendChild(li);
    if (libMoveOpen === it.id) {
      const m = document.createElement('li'); m.className = 'lib-move';
      const lab = document.createElement('span'); lab.textContent = tr('Ranger dans :'); m.appendChild(lab);
      const chip = (txt, on, run) => { const c = document.createElement('button'); c.className = 'lib-chip' + (on ? ' on' : ''); c.textContent = txt; c.onclick = run; m.appendChild(c); };
      if (it.folder) chip(tr('Hors dossier'), false, () => libMoveTo(it.id, null));
      for (const f of folders) if (f !== it.folder) chip(f, false, () => libMoveTo(it.id, f));
      chip(tr('＋ Nouveau dossier'), true, () => libNewFolder(it.id));
      list.appendChild(m);
    }
  }
}
async function openLib() {
  await renderLib(); $('lib').hidden = false;
}
$('libNewFold').onclick = () => libNewFolder(null);
$('libBack').onclick = () => { libFolder = null; libMoveOpen = null; renderLib(); };
$('libFoldRen').onclick = async () => {
  const old = libFolder, n = await libAskName(old); if (!n || n === old) return;
  const all = (await listRecent()).filter(it => !isRec(it)), fs = libFolders(all);
  if (fs.includes(n)) { toast(tr('Un dossier porte déjà ce nom'), 3000); return; }
  libSaveFolders(fs.map(f => f === old ? n : f));
  await libPatch(all.filter(it => it.folder === old).map(it => it.id), it => { it.folder = n; });
  libFolder = n; renderLib();
};
$('libFoldDel').onclick = async () => {
  const f = libFolder, all = (await listRecent()).filter(it => !isRec(it)), inF = all.filter(it => it.folder === f);
  if (!await libDialog({ title: 'Supprimer le dossier « ' + f + ' » ?', text: inF.length ? 'Ses traces sont gardées : elles reviennent dans « Mes traces ».' : '', ok: 'Supprimer', danger: true })) return;
  libSaveFolders(libFolders(all).filter(x => x !== f));
  await libPatch(inF.map(it => it.id), it => { delete it.folder; delete it.pos; });
  libFolder = null; renderLib();
};
// appui long puis glisser : changer l'ordre, ou lâcher sur un dossier pour l'y ranger
const libDrag = { li: null, timer: 0, x0: 0, y0: 0, dy: 0, top0: 0, over: null, justDropped: false, scroll: 0 };
function libDragStart() {
  const d = libDrag, li = d.li; if (!li) return;
  d.on = true; d.top0 = li.offsetTop; libMoveOpen = null;
  for (const m of $('libList').querySelectorAll('.lib-move')) m.remove();
  li.classList.add('drag'); $('libList').classList.add('dragging'); $('lib').classList.add('libdrag'); vibrate(25);
}
function libDragMove(x, y) {
  const d = libDrag, li = d.li, list = $('libList'), panel = $('lib').querySelector('.lib-panel');
  if (!d.on || !li) return;
  // défilement automatique près des bords
  // seulement si le doigt est vraiment collé au bord et qu'il y est allé, et doucement
  const rr = panel.getBoundingClientRect(), Z = 36, vh = window.visualViewport ? visualViewport.height : innerHeight;
  const r = { top: Math.max(rr.top, 0), bottom: Math.min(rr.bottom, vh) }; // partie du panneau vraiment visible
  cancelAnimationFrame(d.scroll);
  const depth = y < r.top + Z ? (r.top + Z - y) : y > r.bottom - Z ? -(y - (r.bottom - Z)) : 0;
  const edge = depth > 0 && y < d.y0 - 24 ? -1 : depth < 0 && y > d.y0 + 24 ? 1 : 0;
  if (edge) {
    const v = Math.min(5, 1 + Math.abs(depth) / 8);
    const step = () => { const before = panel.scrollTop; panel.scrollTop += edge * v; if (panel.scrollTop !== before) libDragMove(x, y); }; d.scroll = requestAnimationFrame(step);
  }
  const dy = y - d.y0 + (panel.scrollTop - d.st0);
  li.style.transform = `translateY(${dy - (li.offsetTop - d.top0)}px)`;
  // au-dessus d'un dossier ?
  li.style.pointerEvents = 'none';
  const under = document.elementFromPoint(x, y), fold = under && under.closest('.lib-fold, #libBack');
  li.style.pointerEvents = '';
  if (d.over !== fold) { if (d.over) d.over.classList.remove('drop'); d.over = fold; if (fold) { fold.classList.add('drop'); vibrate(10); } }
  li.classList.toggle('to-fold', !!fold);
  if (fold) return;
  // sinon : on change de place parmi les traces
  const trs = [...list.querySelectorAll('.lib-tr')].filter(x => x !== li), mid = li.getBoundingClientRect().top + li.offsetHeight / 2;
  let before = null;
  for (const o of trs) { const b = o.getBoundingClientRect(); if (mid < b.top + b.height / 2) { before = o; break; } }
  const cur = li.nextElementSibling;
  if (before !== cur && !(before === null && !cur)) {
    if (before) list.insertBefore(li, before); else list.appendChild(li);
    li.style.transform = `translateY(${dy - (li.offsetTop - d.top0)}px)`;
  }
}
async function libDragEnd() {
  const d = libDrag, li = d.li, list = $('libList');
  clearTimeout(d.timer); cancelAnimationFrame(d.scroll);
  if (!d.on) { d.li = null; return; }
  d.on = false; d.li = null; d.justDropped = true; setTimeout(() => { d.justDropped = false; }, 350);
  li.classList.remove('drag', 'to-fold'); li.style.transform = ''; list.classList.remove('dragging'); $('lib').classList.remove('libdrag');
  const over = d.over; d.over = null;
  if (over) { over.classList.remove('drop'); await libMoveTo(li.dataset.id, over.id === 'libBack' ? null : over.dataset.folder); return; }
  const ids = [...list.querySelectorAll('.lib-tr')].map(x => x.dataset.id), pos = new Map(ids.map((id, i) => [id, i]));
  await libPatch(ids, it => { it.pos = pos.get(it.id); });
  const panel = $('lib').querySelector('.lib-panel'), keep = panel.scrollTop;
  await renderLib(); panel.scrollTop = keep; // la liste reste où elle était
}
{
  const list = $('libList');
  const down = (e, x, y) => {
    const li = e.target.closest('.lib-tr'); if (!li || e.target.closest('.lib-del')) return;
    const d = libDrag; d.li = li; d.x0 = x; d.y0 = y; d.st0 = $('lib').querySelector('.lib-panel').scrollTop; d.on = false;
    clearTimeout(d.timer); d.timer = setTimeout(libDragStart, 420);
  };
  const move = (e, x, y) => {
    const d = libDrag; if (!d.li) return;
    if (!d.on) { if (Math.hypot(x - d.x0, y - d.y0) > 10) { clearTimeout(d.timer); d.li = null; } return; }
    if (e.cancelable) e.preventDefault();
    libDragMove(x, y);
  };
  list.addEventListener('touchstart', e => { if (e.touches.length === 1) down(e, e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  list.addEventListener('touchmove', e => move(e, e.touches[0].clientX, e.touches[0].clientY), { passive: false });
  list.addEventListener('touchend', () => libDragEnd());
  list.addEventListener('touchcancel', () => libDragEnd());
  list.addEventListener('mousedown', e => { if (e.button === 0) down(e, e.clientX, e.clientY); });
  window.addEventListener('mousemove', e => { if (libDrag.li) move(e, e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { if (libDrag.li) libDragEnd(); });
  list.addEventListener('contextmenu', e => { if (e.target.closest('.lib-tr')) e.preventDefault(); });
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
  if (items.length) renderBilan(items);
  bilanFold(items.length > 0);
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
// =====================================================================
// Photos des sorties : gardées sur le téléphone (réduites), placées sur le parcours grâce à leur
// position GPS ou, à défaut, à l'heure de la prise de vue comparée aux heures de passage.
// =====================================================================
// métadonnées EXIF d'un JPEG : heure de prise de vue et position GPS (si l'appareil les a notées)
function exifRead(buf) {
  try {
    const v = new DataView(buf); if (v.getUint16(0) !== 0xFFD8) return {};
    let o = 2;
    while (o + 4 < v.byteLength) {
      const mk = v.getUint16(o), len = v.getUint16(o + 2);
      if (mk === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949, u16 = a => v.getUint16(a, le), u32 = a => v.getUint32(a, le);
        const ifd = (start, want) => {
          const out = {}, n = u16(t + start);
          for (let i = 0; i < n; i++) {
            const e = t + start + 2 + i * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4), val = e + 8;
            if (!want.includes(tag)) continue;
            if (type === 2) { const p = cnt > 4 ? t + u32(val) : val; let s = ''; for (let k = 0; k < cnt - 1; k++) s += String.fromCharCode(v.getUint8(p + k)); out[tag] = s; }
            else if (type === 5) { const p = t + u32(val), a = []; for (let k = 0; k < cnt; k++) a.push(u32(p + k * 8) / (u32(p + k * 8 + 4) || 1)); out[tag] = a; }
            else if (type === 4 || type === 3) out[tag] = type === 4 ? u32(val) : u16(val);
          }
          return out;
        };
        const r0 = ifd(u32(t + 4), [0x8769, 0x8825, 0x0132]), res = {};
        const ex = r0[0x8769] ? ifd(r0[0x8769], [0x9003]) : {}, ds = ex[0x9003] || r0[0x0132];
        const m = ds && /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(ds);
        if (m) res.t = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(); // heure locale du téléphone
        if (r0[0x8825]) {
          const g = ifd(r0[0x8825], [1, 2, 3, 4]), dms = a => a && a[0] + a[1] / 60 + a[2] / 3600;
          if (g[2] && g[4]) { res.lat = dms(g[2]) * (g[1] === 'S' ? -1 : 1); res.lon = dms(g[4]) * (g[3] === 'W' ? -1 : 1); if (!res.lat && !res.lon) { delete res.lat; delete res.lon; } }
        }
        return res;
      }
      if ((mk & 0xFF00) !== 0xFF00) break;
      o += 2 + len;
    }
  } catch { /* fichier inattendu : sans métadonnées */ }
  return {};
}
// photo réduite (1600 px) et vignette (240 px), dans le bon sens
async function photoShrink(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const make = (max, q) => {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    return new Promise(ok => cv.toBlob(ok, 'image/jpeg', q));
  };
  const [full, thumb] = await Promise.all([make(1600, 0.82), make(240, 0.7)]);
  bmp.close && bmp.close();
  return { full, thumb };
}
// position d'une photo sans GPS : le point de la sortie enregistré à l'heure la plus proche (10 min au plus)
function photoPlace(t, pts) {
  let best = null, bd = 6e5;
  for (const p of pts) if (isFinite(p.t)) { const d = Math.abs(p.t - t); if (d < bd) { bd = d; best = p; } }
  return best ? { lat: best.lat, lon: best.lon } : null;
}
async function photoAdd(file, ref, pts, pos) {
  const ex = exifRead(await file.slice(0, 256 * 1024).arrayBuffer());
  const { full, thumb } = await photoShrink(file);
  const t = ex.t || pos && pos.t || file.lastModified || Date.now();
  const at = ex.lat != null ? { lat: ex.lat, lon: ex.lon } : pos ? { lat: pos.lat, lon: pos.lon } : pts ? photoPlace(t, pts) : null;
  const ph = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), ref, t, lat: at ? at.lat : null, lon: at ? at.lon : null, full, thumb };
  await idb('readwrite', st => st.put(ph), 'photos');
  return ph;
}
// photos d'une sortie : ajoutées à la sortie, ou prises pendant (bouton « Photo » en navigation)
async function photosOf(it, pts) {
  let all = []; try { all = (await idb('readonly', st => st.getAll(), 'photos')) || []; } catch { return []; }
  const ts = pts.filter(p => isFinite(p.t)).map(p => p.t), t0 = ts.length ? Math.min(...ts) : it.start, t1 = ts.length ? Math.max(...ts) : it.start;
  return all.filter(p => p.ref === 'rec:' + it.id || (p.ref === 'live' && t0 && p.t >= t0 - 6e4 && p.t <= t1 + 6e4)).sort((a, b) => a.t - b.t);
}
let soPhotos = [], phIdx = 0, phUrls = [];
function phRevoke() { phUrls.forEach(u => URL.revokeObjectURL(u)); phUrls = []; }
const phUrl = b => { const u = URL.createObjectURL(b); phUrls.push(u); return u; };
function soPhotosUI(it, pts) {
  const box = $('sdPhotos'); box.innerHTML = '';
  soPhotos.forEach((ph, i) => {
    const b = document.createElement('button'); b.className = 'ph-th'; b.setAttribute('aria-label', tr('Voir la photo'));
    b.style.backgroundImage = `url(${phUrl(ph.thumb)})`; b.onclick = () => phOpen(i, it, pts); box.appendChild(b);
  });
  $('sdPhCount').textContent = soPhotos.length ? `${soPhotos.length} photo${soPhotos.length > 1 ? 's' : ''}` : tr('Aucune photo');
}
function phOpen(i, it, pts) {
  phIdx = i; const ph = soPhotos[i]; if (!ph) { $('phView').hidden = true; return; }
  $('phImg').src = phUrl(ph.full);
  $('phInfo').textContent = new Date(ph.t).toLocaleString(LOC, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + (ph.lat == null ? tr(' · position inconnue') : '');
  $('phPrev').hidden = i === 0; $('phNext').hidden = i >= soPhotos.length - 1;
  $('phDel').hidden = false; $('phDel').textContent = tr('Supprimer'); delete $('phDel').dataset.armed;
  $('phPrev').onclick = () => phOpen(i - 1, it, pts); $('phNext').onclick = () => phOpen(i + 1, it, pts);
  $('phDel').onclick = async () => {
    if (!$('phDel').dataset.armed) { $('phDel').dataset.armed = '1'; $('phDel').textContent = tr('Toucher encore pour supprimer'); return; }
    await idb('readwrite', st => st.delete(ph.id), 'photos').catch(() => {});
    soPhotos.splice(i, 1); soPhotosUI(it, pts); previewRedraw && previewRedraw();
    if (!soPhotos.length) { $('phView').hidden = true; return; }
    phOpen(Math.min(i, soPhotos.length - 1), it, pts);
  };
  $('phView').hidden = false;
}
$('phClose').onclick = () => { $('phView').hidden = true; };
$('phView').onclick = e => { if (e.target === $('phView')) $('phView').hidden = true; };
// photo prise pendant la navigation : position et heure du moment
$('npPhoto').onclick = () => $('phCam').click();
$('phCam').onchange = async () => {
  const files = [...$('phCam').files]; $('phCam').value = '';
  if (!files.length) return;
  let n = 0;
  for (const f of files) { try { await photoAdd(f, 'live', null, me ? { lat: me.lat, lon: me.lon, t: Date.now() } : null); n++; } catch {} }
  toast(n ? (n > 1 ? `${n} photos gardées` : 'Photo gardée') + ' · ' + tr('visible dans la sortie') : 'Photo illisible.', 3000);
};
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
  phRevoke(); soPhotos = []; soPhotosUI(it, pts);
  previewRedraw = () => { drawRecMap($('sdMap'), pts, soPhotos); };
  requestAnimationFrame(() => { previewRedraw && previewRedraw(); if (hasE) drawRecProfile($('sdProfile'), pts); });
  photosOf(it, pts).then(l => { if ($('soDetail').hidden) return; soPhotos = l; soPhotosUI(it, pts); previewRedraw && previewRedraw(); });
  $('sdPhAdd').onclick = () => $('phIn').click();
  $('phIn').onchange = async () => {
    const files = [...$('phIn').files]; $('phIn').value = '';
    if (!files.length) return;
    $('sdPhCount').textContent = tr('Ajout des photos…');
    let n = 0, lost = 0;
    for (const f of files.slice(0, 30)) { try { const ph = await photoAdd(f, 'rec:' + it.id, pts); soPhotos.push(ph); n++; if (ph.lat == null) lost++; } catch {} }
    soPhotos.sort((a, b) => a.t - b.t); soPhotosUI(it, pts); previewRedraw && previewRedraw();
    toast(!n ? 'Photo illisible.' : lost ? `${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}, ${lost} sans position (prise hors de la sortie)` : `${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} et placée${n > 1 ? 's' : ''} sur le parcours`, 4000);
  };
  $('sdFollow').onclick = () => { closeSorties(); loadText(it.text, false); store.set('gpx', it.text.length < 4.5e6 ? it.text : ''); setTimeout(() => startNav(), 300); };
  $('sdExport').onclick = () => shareGPX(it.text, it.title || it.name);
  // partager le parcours de la sortie (lien, QR code, montre) : le tracé seul, sans les heures
  $('sdShare').onclick = () => {
    if (pts.length < 2) { toast('Sortie trop courte pour être partagée.', 3000); return; }
    let g = {}; try { g = parseGPX(it.text); } catch {}
    openSend({ name: recTitle(it), pts: pts.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele })), wpts: g.wpts || [], desc: g.desc || '', rec: it, sub: move ? tr('fait en ') + fmtDur(move / 1000) : '' });
  };
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
    for (const ph of soPhotos) await idb('readwrite', st => st.delete(ph.id), 'photos').catch(() => {});
    toast('Sortie supprimée'); showSoList();
  };
}
// =====================================================================
// Strava : envoi des sorties (automatique ou à la demande)
// Strava demande une « appli API » par utilisateur : Client ID et Secret restent sur le téléphone.
// =====================================================================
// Connexion via le relais Pisteo (Cloudflare Worker, voir strava-relay/worker.js) : il garde le secret
// de l'appli Strava hors du code public et transmet les envois.
const STRAVA_CLIENT_ID = '290814'; // appli Strava du compte Pisteo (25 oct. 2026)
const STRAVA_RELAY = 'https://api.pisteo.app'; // relais Cloudflare (strava-relay/worker.js), sur le compte pisteo.app
// connexion faite avec une autre appli Strava (ancien numéro) : elle ne marche plus, on la retire
const stvTok = () => { try { const t = JSON.parse(store.get('stvTok') || 'null'); if (t && (t.cid || '109821') !== STRAVA_CLIENT_ID) { store.set('stvTok', ''); store.set('stvInactive', ''); return null; } return t; } catch { return null; } };
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
const BK_KEYS = ['thr', 'voice', 'vib', 'recap', 'navStats', 'autoRec', 'alertNight', 'litNight', 'statsOff', 'soBilan', 'poi', 'gdAuto', 'eco', 'ecoSeen', 'banner', 'theme', 'profile', 'layerId', 'soLayer',
  'rtFilt', 'npProfOnly', 'showPacks', 'stvAuto', 'recHint', 'libFolders'];
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
function openBackup() { $('backup').hidden = false; $('bkSum').textContent = '…'; bkSay(''); bkRefresh(); gdUI(); }
$('btnBackup').onclick = openBackup;
$('bkClose').onclick = () => { $('backup').hidden = true; };
$('backup').onclick = e => { if (e.target === $('backup')) $('backup').hidden = true; };
// contenu d'une sauvegarde : sorties, traces, réglages et liste des cartes (sans leurs images)
async function bkData() {
  const items = await listRecent();
  const packs = (await listPacks()).filter(p => Array.isArray(p.tiles) && p.tiles.length).map(p => ({
    id: p.id, kind: p.kind, name: p.name, detail: p.detail, code: p.code, cc: p.cc, prov: p.prov, bbox: p.bbox, line: p.line,
    tiles: p.tiles, count: p.tiles.length, graphWanted: !!(p.graph || p.graphWanted) }));
  if (!items.length && !packs.length) return null;
  const settings = {};
  for (const k of BK_KEYS) { const v = store.get(k); if (v != null && v !== '') settings[k] = v; }
  return { app: 'pisteo', format: 1, version: APP_VERSION, date: new Date().toISOString(), settings, tracks: items, packs };
}
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
  await bkRestore(data);
};
async function bkRestore(data) {
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
$('stvOff').onclick = async () => {
  // l'autorisation est aussi retirée chez Strava (libère une place sur les 10 de l'appli Strava)
  try { const a = await stvAccess(); if (a) await fetch(STRAVA_RELAY + '/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + a } }); } catch {}
  store.set('stvTok', ''); stvUI(); toast('Strava déconnecté');
};
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
    store.set('stvTok', JSON.stringify({ cid: STRAVA_CLIENT_ID, a: j.access_token, r: j.refresh_token, exp: j.expires_at, who: j.athlete ? `${j.athlete.firstname || ''} ${j.athlete.lastname || ''}`.trim() : '' }));
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
  b.textContent = it.strava ? tr('✓ Sur Strava') : it.stravaManual ? 'Sur Strava ✓ · remettre' : 'Mettre sur Strava';
  // lien vers l'activité : texte imposé par Strava (« View on Strava »)
  const v = $('sdStvView'), url = it.strava ? 'https://www.strava.com/activities/' + it.strava : '';
  v.hidden = !url; v.href = url || '#';
  v.onclick = e => { if (AND && AND.openExternal) { e.preventDefault(); try { AND.openExternal(url); } catch {} } };
  b.onclick = async () => {
    if (it.strava) { window.open('https://www.strava.com/activities/' + it.strava, '_blank'); return; }
    // envoi direct seulement si Strava l'accepte (compte connecté et appli active), sinon import manuel
    // pas connecté : on propose de connecter Strava (envoi direct) plutôt que l'import manuel
    if (!stvOn()) { toast('Connecte d\'abord Strava pour envoyer tes sorties directement', 3500, { label: 'Import manuel', run: () => openStvManual(it) }); openStrava(); return; }
    if (stvBlocked()) { openStvManual(it); return; }
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
function drawRecMap(cv, pts, photos) {
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
  for (const ph of photos || []) {
    if (ph.lat == null) continue;
    const x = wx(ph.lon, z) - ox, y = wy(ph.lat, z) - oy;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#E8833A'; ctx.stroke();
    ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('📷', x, y + 0.5);
  }
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
  if (nav && !navHome && !pos.sim) navHome = { lat: pos.lat, lon: pos.lon };
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
  // la partie « déjà faite » n'avance qu'en navigation : en simple aperçu (ou trace inversée sous tes pieds),
  // être à l'arrivée ne doit pas marquer tout le parcours comme fait
  if (track) { progress = project(track, pos); if (nav) updateDone(pos); }
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
    offTrackLogic(); wrongWayCheck(pos); paceFix(pos); recapCheck(); poiCheck();
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

// ---------- mauvais sens : on avance sur la trace, mais à contresens ----------
let wrongD = 0, wrongRef = null, wrongShown = false;
function wrongReset() { wrongD = 0; wrongRef = null; wrongShown = false; }
// un autre passage de la trace, tout près, va-t-il dans ma direction ? (aller-retour, boucle en 8…)
function trackGoesThere(pos, brg) {
  const P = track.pts, kx = Math.cos(rad(pos.lat)) * 111320, ky = 110540;
  for (let i = 0; i < P.length - 1; i++) {
    const ax = (P[i].lon - pos.lon) * kx, ay = (P[i].lat - pos.lat) * ky;
    if (Math.abs(ax) > 300 || Math.abs(ay) > 300) continue;
    if (segDist(pos, P[i], P[i + 1]) > 25 || hav(P[i], P[i + 1]) < 1) continue;
    if (Math.abs(angDiff(brg, bearing(P[i], P[i + 1]))) < 50) return true;
  }
  return false;
}
function wrongWayCheck(pos) {
  if (!nav || !track || rejoin || isOff || arrived || !progress || progress.dist > 30 || pos.sim || (pos.acc || 0) > 30) { wrongRef = null; return; }
  if (!wrongRef) { wrongRef = pos; return; }
  const d = hav(wrongRef, pos); if (d < 15) return;
  const mv = bearing(wrongRef, pos); wrongRef = pos;
  if (d > 200) return; // saut GPS
  const a = progress.along, tb = bearing(pointAt(track, Math.max(0, a - 15)), pointAt(track, Math.min(track.total, a + 15)));
  if (Math.abs(angDiff(mv, tb)) > 135 && !trackGoesThere(pos, mv)) wrongD += d;
  else wrongD = Math.max(0, wrongD - d * 2);
  if (wrongD >= 120 && !wrongShown) {
    wrongShown = true; stat('sens_inverse');
    vibrate([300, 150, 300]); say('Attention, tu parcours la trace à contresens.');
    toast('Tu parcours la trace à contresens', 15000, { label: 'Inverser la trace', run: () => { stat('sens_inverse_ok'); reverseTrack(); } });
    if (eco === 'max') ecoWake(15000);
  }
  if (wrongShown && wrongD === 0) wrongShown = false; // de nouveau dans le bon sens : alerte réarmée
}

// ---------- points d'étape vocaux et points utiles devant soi ----------
// automatiques : tous les 3 km à pied, 10 km à vélo ; ou toutes les 15 / 30 min de navigation
const recapMode = () => store.get('recap') || 'auto';
$('optRecap').value = recapMode();
$('optRecap').onchange = e => { store.set('recap', e.target.value); stat('recap_' + e.target.value); };
let recapNext = 0, poiAhead = null, poiSaid = new Set();
function recapReset() { recapNext = 0; poiAhead = null; poiSaid = new Set(); }
function speakClock(secs) {
  const d = new Date(Date.now() + secs * 1000), h = d.getHours(), m = d.getMinutes();
  return LANG === 'fr' ? `${h} heure${h > 1 ? 's' : ''}${m ? ' ' + m : ''}` : fmtClock(secs);
}
function recapCheck() {
  const md = recapMode(); if (md === 'off' || !nav || !me || rejoin || isOff || arrived) return;
  const bike = profile === 'trekking';
  let due;
  if (md === 'auto') { const step = bike ? 10000 : 3000; if (!recapNext) recapNext = step; due = freeD >= recapNext; if (due) recapNext = (Math.floor(freeD / step) + 1) * step; }
  else { const step = +md * 60000; if (!recapNext) recapNext = navStartT + step; due = Date.now() >= recapNext; if (due) recapNext += step; }
  if (!due) return;
  const parts = [md === 'auto' ? `${speakDist(Math.round(freeD / 1000) * 1000)} parcourus.` : `${speakDist(freeD)} parcourus en ${fmtDur((Date.now() - navStartT) / 1000)}.`];
  const info = track && remainingInfo();
  if (info && info.rem > 300) {
    const up = track.hasEle && info.up >= 30 ? ` et ${Math.round(info.up / 10) * 10} mètres de montée` : '';
    parts.push(`Encore ${speakDist(info.rem)}${up}. Arrivée vers ${speakClock(info.secs)}.`);
  }
  stat('recap_dit');
  say(parts.join(' '), true);
}
// points utiles à moins de 60 m de la trace (eau, refuges, cabanes, abris, toilettes)
const POI_SAY = { w: 'point d\'eau potable', s: 'source', r: 'refuge gardé', c: 'cabane', a: 'abri', t: 'toilettes' };
async function poiAlong() {
  if (!track || poiAhead || !poiOn()) return;
  const mine = track; poiAhead = [];
  try {
    const lats = mine.pts.map(p => p.lat), lons = mine.pts.map(p => p.lon);
    await poiPrefetch([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]);
    if (track !== mine) return;
    const idx = trackIndex(mine), out = [];
    for (const T of poiTiles.values()) for (const [lat, lon, k, nm] of T) {
      if (!POI_SAY[k]) continue;
      for (const ps of netPasses(mine, idx, { lat, lon }, 60)) out.push({ along: ps.along, k, nm: nm || '' });
    }
    mine.poiAhead = poiAhead = out.sort((a, b) => a.along - b.along);
  } catch { /* pas de points utiles : rien à annoncer */ }
}
function poiCheck() {
  if (recapMode() === 'off' || !nav || !track || !poiAhead || !poiAhead.length || !progress || rejoin || isOff) return;
  const lead = profile === 'trekking' ? 1000 : 400, at = progress.along;
  const p = poiAhead.find(q => q.along > at + 50 && q.along - at <= lead && !poiSaid.has(q.k + Math.round(q.along)));
  if (!p) return;
  // les points du même type tout proches ne sont annoncés qu'une fois
  poiAhead.filter(q => q.k === p.k && Math.abs(q.along - p.along) < 500).forEach(q => poiSaid.add(q.k + Math.round(q.along)));
  stat('poi_dit_' + p.k);
  say(`${POI_SAY[p.k].charAt(0).toUpperCase() + POI_SAY[p.k].slice(1)} dans ${speakDist(p.along - at)}${p.nm && p.k !== 'w' && p.k !== 't' ? ', ' + p.nm : ''}.`, true);
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
  navStartT = Date.now(); freeD = 0; freeRef = null; paceReset(); wrongReset(); paceLoad(); recapReset(); if (track) setTimeout(poiAlong, 3000); nightSaid = 0;
  navHome = track && track.pts.length ? { lat: track.pts[0].lat, lon: track.pts[0].lon } : me && !me.sim ? { lat: me.lat, lon: me.lon } : null;
  setTimeout(trChipsUpdate, 0);
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
  navPrev = null;
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
  if (icon === 'lacets') return '<svg viewBox="0 0 48 48"><path d="M24 44v-6l-10-6 20-8-20-8 10-6V4"/><path d="M18 10l6-6 6 6"/></svg>';
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
  const ri = track && remainingInfo();
  ctx.fillText(ri ? `${tr('Arrivée')} ${fmtClock(ri.secs)}  ·  ${fmtDist(ri.rem)}` : `${fmtDist(freeD)} ${tr('parcourus')}  ·  ${fmtDur((Date.now() - navStartT) / 1000)}`, W / 2, H - 20);
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
  if (arrived && !rejoin) { // arrivée : le résumé de la sortie (ou du parcours), sans rien à choisir
    const on = actState === 'on' || actState === 'paused';
    const sum = on ? [fmtDist(act.d), fmtDur(actElapsed() / 1000), rec.some(q => q.ele != null) ? 'D+ ' + fmtM(recUp()) : ''] : [fmtDist(track.total), track.hasEle ? 'D+ ' + fmtM(track.totalUp) : ''];
    setBanner('done', '', 'Vous êtes arrivé', 'flag', '🏁 ' + sum.filter(Boolean).join(' · ')); setSrc('turn', EMPTY); return;
  }
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
  const info = next.arrive ? (rejoin ? { txt: 'Rejoignez la trace', icon: 'join' } : { txt: 'Arrivée', icon: 'flag' }) : turnInfo(next);
  const tone = rejoin ? 'rejoin' : 'ok';
  const sub = rejoin ? `Retour à la trace · ${fmtDist(rejoinProg.remain)} par le chemin` : '';
  if (dTo > 1200) setBanner(tone, fmtDist(dTo), track.route ? 'Continuez sur l\'itinéraire' : 'Continuez sur la trace', 0, (next.arrive ? '' : `puis ${lc(info.txt)}`) + (sub ? (next.arrive ? '' : ' · ') + sub : ''));
  else setBanner(tone, fmtDist(dTo), info.txt, info.icon, next.kind === 'lacets' ? `${next.n} épingles sur ${fmtDist(next.len)}` + (sub ? ' · ' + sub : '') : sub);

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
  const what = next.arrive ? (rejoin ? 'tu rejoindras la trace' : 'tu seras arrivé') : next.kind === 'lacets' ? `une série de ${next.n} lacets commence, sur ${speakDist(next.len)}` : spokenTurn(info.txt);
  // virage suivant tout proche : on annonce les deux d'un coup, comme un copilote
  const after = !next.arrive && path.turns.find(t => t.along > next.along + 3);
  // (seulement un vrai virage, pas une courbe, et vraiment proche : sinon ça devient bavard dans les lacets)
  const chain = after && !after.arrive && !after.kind && !next.kind && Math.abs(after.ang) >= 60 && after.along - next.along < Math.max(near * 2.5, 40);
  const then = chain ? `, puis tout de suite ${spokenTurn(turnInfo(after).txt).replace(/^tourne |^prends /, '')}` : '';
  const afterKey = chain ? path.id + ':' + Math.round(after.along) : null;
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  if (lvl < 1 && dTo <= far && dTo > near * 1.6) { say(`Dans ${speakDist(dTo)}, ${what}${then}.`); spoken.set(key, 1); }
  else if (lvl === 3 && dTo <= near) { if (!next.arrive && next.kind !== 'lacets') say(cap(spokenTurn(info.txt).replace(/^tourne |^prends /, '')) + '.', true); spoken.set(key, 2); }
  else if (lvl < 2 && dTo <= near) {
    if (!next.arrive && next.kind !== 'lacets') { const t = spokenTurn(info.txt); say((lvl === 1 && Math.random() < .35 ? pick(['Maintenant, ', 'C\'est ici, ']) + t : cap(t)) + then + '.'); }
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
// de nuit, à pied : profil personnalisé « nuit.brf » (privilégie les voies éclairées) ; donne aussi l'éclairage de chaque voie
// réglage « De nuit, privilégier l'éclairé » (désactivé par défaut) : seulement à pied, entre le coucher et le lever du soleil
// actif s'il fait déjà nuit, ou si l'arrivée prévue (estSecs : durée estimée) tombe au moins 15 min après le coucher du soleil
const routeLitOn = (estSecs = 0) => store.get('litNight') === '1' && (isDarkNow() || arrivesAfterDark(estSecs));
function arrivesAfterDark(estSecs) {
  if (!estSecs) return false;
  const c = me || (map && map.getCenter && { lat: map.getCenter().lat, lon: map.getCenter().lng }); if (!c) return false;
  const now = Date.now(), st = sunTimes(now, c.lat, c.lon); if (!st) return false;
  return now + estSecs * 1000 > st.set + 15 * 60000;
}
// durée estimée d'après les points de passage (à vol d'oiseau × 1,3, à l'allure du mode)
function estFromLonlats(lonlats) {
  const q = lonlats.split('|').map(x => { const [lon, lat] = x.split(',').map(Number); return { lat, lon }; });
  let d = 0; for (let i = 1; i < q.length; i++) d += hav(q[i - 1], q[i]);
  return d * 1.3 / (lpSpeed().v / 3.6);
}
let litToastT = 0;
let nightId = null, nightP = null;
function nightProfile(renew) {
  if (renew) { nightId = null; nightP = null; }
  if (nightId) return Promise.resolve(nightId);
  nightP = nightP || (async () => {
    const t = await fetch('nuit.brf?v=' + APP_VERSION).then(r => { if (!r.ok) throw new Error('profil'); return r.text(); });
    const j = await fetch('https://brouter.de/brouter/profile', { method: 'POST', body: t }).then(r => r.json());
    if (!j.profileid) { const e = new Error(j.error || 'profil refusé'); e.server = true; throw e; }
    return (nightId = j.profileid);
  })().catch(e => { nightP = null; throw e; });
  return nightP;
}
async function brProf(style, estSecs = 0) {
  if (profile !== 'trekking') {
    if (!routeLitOn(estSecs)) return profile;
    if (!isDarkNow() && Date.now() - litToastT > 60000) { litToastT = Date.now(); toast(tr('Arrivée après la tombée de la nuit : itinéraire par les rues éclairées'), 4500); }
    return nightProfile();
  }
  return style === 'river' ? riverProfile() : 'trekking';
}
// Plan de secours : si BRouter (serveur bénévole unique) ne répond pas, on calcule l'itinéraire sur le
// serveur OSRM de FOSSGIS (routing.openstreetmap.de, profils piéton et vélo, sans clé, 1 demande/s au plus).
// Moins fin (pas de profil balade ni éclairage), mais l'appli continue de guider. BRouter est réessayé après 5 min.
let brDownUntil = 0, osrmLast = 0, osrmToast = 0;
async function brFetch(lonlats, style, signal) {
  if (Date.now() > brDownUntil) {
    // profil « nuit » (plus de calcul côté serveur) : un peu plus de patience avant le plan de secours
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), profile !== 'trekking' && routeLitOn(estFromLonlats(lonlats)) ? 15000 : 8000);
    const stop = () => ctrl.abort(); if (signal) signal.addEventListener('abort', stop);
    try { return await brFetchMain(lonlats, style, ctrl.signal); }
    catch (e) {
      if (signal && signal.aborted) throw e;
      if (navigator.onLine === false) throw e; // pas de réseau : les chemins téléchargés prennent le relais
      brDownUntil = Date.now() + 5 * 6e4;
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', stop); }
  }
  // la variante « balade » n'existe que sur BRouter : on ne propose alors que l'itinéraire principal
  if (style === 'river') { const e = new Error('variante indisponible'); e.server = true; throw e; }
  return osrmFetch(lonlats, signal);
}
async function osrmFetch(lonlats, signal) {
  const wait = osrmLast + 1100 - Date.now(); osrmLast = Math.max(Date.now(), osrmLast + 1100);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  const kind = profile === 'trekking' ? 'bike' : 'foot';
  const r = await fetch(`https://routing.openstreetmap.de/routed-${kind}/route/v1/driving/${lonlats.split('|').join(';')}?overview=full&geometries=geojson`, { signal })
    .catch(e => { throw e; }); // réseau absent : l'appelant passe aux chemins téléchargés
  const j = r.ok ? await r.json() : null, rt = j && j.code === 'Ok' && j.routes && j.routes[0];
  if (!rt) { const e = new Error('serveurs d\'itinéraires indisponibles'); e.server = true; throw e; }
  // altitude ajoutée après coup (OSRM n'en donne pas) : IGN, sinon Open-Meteo
  const pts = await rtElevate(rt.geometry.coordinates.map(c => ({ lon: c[0], lat: c[1], ele: null })));
  if (Date.now() - osrmToast > 10 * 6e4) { osrmToast = Date.now(); toast(tr('Serveur d\'itinéraires habituel indisponible : itinéraire de secours'), 4500); }
  return { fallback: true, features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => p.ele != null ? [p.lon, p.lat, p.ele] : [p.lon, p.lat]) },
    properties: { 'track-length': String(Math.round(rt.distance)), messages: [] } }] };
}
// requête BRouter ; un profil personnalisé expiré sur le serveur est renvoyé une fois
async function brFetchMain(lonlats, style, signal) {
  for (let k = 0; ; k++) {
    const prof = await brProf(style, estFromLonlats(lonlats));
    const r = await fetch(`https://brouter.de/brouter?lonlats=${lonlats}&profile=${prof}&alternativeidx=0&format=geojson`, { signal });
    if (r.ok) { const j = await r.json(); if (prof === nightId) j.lit = true; return j; }
    const m = (await r.text().catch(() => '')).slice(0, 200);
    if (k === 0 && /^custom_/.test(prof)) { if (prof === nightId) await nightProfile(true); else await riverProfile(true); continue; }
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
  if (typeof wxShown === 'function' && wxShown()) wxApply(); // couleurs du vent selon le mode
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
    const ebc = $('ebClimb'); ebc.textContent = '';
    if (!$('climb').hidden) ebc.append('⛰ ', $('clTxt').textContent); // deux morceaux : le texte se traduit seul
    const ri = track && remainingInfo();
    $('ebRem').textContent = ri ? `${fmtDist(ri.rem)} restant · arrivée ${fmtClock(ri.secs)}` : `${fmtDist(freeD)} parcourus · ${fmtDur((Date.now() - navStartT) / 1000)}`;
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
    if (j.lit) litMark(f, pts);
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
// secours de Photon (serveur de Komoot) : index des lieux de l'IGN (France seulement)
async function searchIgnPoi(q, c, signal) {
  const r = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&index=poi&limit=8&lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}`, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const one = v => Array.isArray(v) ? v[0] : v;
  return ((await r.json()).features || []).map(f => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    return { lat, lon, name: p.toponym || one(p.name) || '', sub: one(p.city) || '' };
  }).filter(p => p.name && hav(c, p) < 100000).sort((x, y) => hav(c, x) - hav(c, y)).slice(0, 6);
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
      searchPhoton(q, c, ctrl.signal).catch(() => searchIgnPoi(q, c, ctrl.signal)).then(v => v.map(p => item(p.name, p.sub, p, p.name))).catch(() => [])
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
    const j = await brFetch(pts.map(ll).join('|'), style, ctrl.signal), f = j.features[0];
    const out = f.geometry.coordinates.map(c => ({ lon: c[0], lat: c[1], ele: c[2] != null ? c[2] : null }));
    if (j.lit) litMark(f, out);
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
    // de nuit : trois directions essayées en même temps ; puis les points de passage sont posés sur des rues
    // éclairées trouvées par ces essais (les trajets entre eux restent ainsi dans l'éclairé)
    if (profile !== 'trekking' && routeLitOn(loopCfg.byTime ? loopCfg.val * 60 : target / (sp.v / 3.6))) {
      const pool = [], addPool = pts => { let last = null; for (const q of pts) if (q.lit === 'y' && (!last || hav(last, q) > 40)) { pool.push(q); last = q; } };
      const evalLoop = pts => { const p = makePath(pts, ''), m = measure(p), err = Math.abs(m - target) / target, sh = litShare(pts); return { pts, m, err, sh, score: sh - Math.max(0, err - 0.1) * 3 }; };
      const angs = [ang, (ang + 120) % 360, (ang + 240) % 360];
      const probes = await Promise.all(angs.map(a => routeVia(loopPoints(start, r, a), 45000).then(p => removeSpurs(p), () => null)));
      let night = null, nightAng = ang;
      probes.forEach((p, i) => { if (!p) return; litRemember(p); addPool(p); const c = evalLoop(p); if (!night || c.score > night.score) { night = c; nightAng = angs[i]; } });
      if (night) {
        for (let k = 0; k < 2 && !(night.err < 0.12 && night.sh >= 0.85); k++) {
          r *= clamp(target / night.m, 0.6, 1.6);
          const wps = loopPoints(start, r, nightAng);
          for (let w = 1; w < wps.length - 1; w++) { // le point éclairé connu le plus proche
            let bq = null, bd = r * 0.7; for (const q of pool) { const d = hav(q, wps[w]); if (d < bd) { bd = d; bq = q; } }
            if (bq) wps[w] = { lat: bq.lat, lon: bq.lon };
          }
          let pts; try { pts = removeSpurs(await routeVia(wps, 45000)); } catch (e) { if (!e.server) throw e; break; }
          litRemember(pts); addPool(pts);
          const c = evalLoop(pts); if (c.score > night.score) night = c;
        }
        clearInterval(tick); showLoop(night.pts); return;
      }
    }
    for (let tryN = 0; tryN < 4; tryN++) {
      let pts;
      try { pts = removeSpurs(await routeVia(loopPoints(start, r, ang), 45000)); litRemember(pts); }
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
function loopGPX(pts, name, notes) {
  const esc = s => s.replace(/[<&>]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]));
  const meta = notes && notes.desc ? `  <metadata><desc>${esc(notes.desc)}</desc></metadata>\n` : '';
  const wp = notes && notes.wpts ? notes.wpts.map(n => `  <wpt lat="${n.lat.toFixed(6)}" lon="${n.lon.toFixed(6)}"><name>${esc(n.name)}</name>${n.desc ? `<desc>${esc(n.desc)}</desc>` : ''}<type>${n.kind}</type></wpt>\n`).join('') : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Pisteo" xmlns="http://www.topografix.com/GPX/1/1">\n${meta}${wp}  <trk><name>${esc(name)}</name><trkseg>\n` +
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
  setTimeout(() => { try { map.fitBounds(boundsOf([pts]), { padding: { top: 80, bottom: sheetPad() + $('loopBar').offsetHeight + 30, left: 30, right: 70 }, bearing: 0, pitch: 0, duration: 600 }); } catch {} }, 350);
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
  cp:  { rank: -1, badge: 'Pisteo', label: 'Parcours recommandé' },
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
  // secours : Open-Meteo (modèle mondial ~90 m, 100 points par demande) si le service IGN ne répond pas
  const omOne = async part => {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch('https://api.open-meteo.com/v1/elevation?latitude=' + part.map(i => pts[i].lat.toFixed(5)).join(',') + '&longitude=' + part.map(i => pts[i].lon.toFixed(5)).join(','), { signal: ctrl.signal });
      if (!r.ok) throw new Error('alti');
      const els = ((await r.json()) || {}).elevation || [];
      if (els.length !== part.length) throw new Error('alti');
      part.forEach((i, q) => { z[i] = typeof els[q] === 'number' && els[q] > -1000 ? els[q] : null; });
    } finally { clearTimeout(timer); }
  };
  const one = part => ignOne(part).catch(() => omOne(part));
  const ignOne = async part => {
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
// miroirs (oct. 2026) : OpenStreetMap France, puis VK Maps ; private.coffee / kumi.systems, un seul serveur, ne répondent plus
const OVERPASS_MIRRORS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
async function overpassFast(q, onWait, mirrorFirst, signal, fast) {
  // demandes « en relais » : un serveur, puis le suivant s'il échoue ou tarde 3 s ; la première réponse
  // gagne et les autres sont annulées. fast : pas d'attente longue, échec franc au bout de ~20 s
  // serveur principal souvent saturé : en dernier quand on veut aller vite
  const servers = mirrorFirst ? [OVERPASS_MIRRORS[0], OVERPASS_MIRRORS[1], OVERPASS] : [OVERPASS, OVERPASS_MIRRORS[0], OVERPASS_MIRRORS[1]];
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
const RT_SRC = [RT_DATA, 'https://raw.githubusercontent.com/Paul12102021/pisteo-data/gh-pages/'];
let rtSrcOk = 0;
const rtd = { man: null, manP: null, deps: null, tiles: new Map() };
async function rtdCache() { try { return await caches.open('rt-tiles'); } catch { return null; } }
async function rtdGet(path, maxAge) {
  const c = await rtdCache(), key = 'https://rt.tiles/' + path;
  const old = c && await c.match(key).catch(() => null);
  if (old && (!maxAge || Date.now() - (+old.headers.get('x-t') || 0) < maxAge)) return old.json();
  try {
    let txt = null, err = null;
    // GitHub Pages d'abord, puis la même branche lue directement sur GitHub (secours) ; la source qui répond est gardée
    for (let k = 0; k < RT_SRC.length && txt == null; k++) {
      const src = RT_SRC[(rtSrcOk + k) % RT_SRC.length];
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), k ? 15000 : 10000);
      try {
        const r = await fetch(src + path, { cache: 'no-cache', signal: ctrl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        txt = await r.text(); rtSrcOk = (rtSrcOk + k) % RT_SRC.length;
      } catch (e) { err = err || e; } finally { clearTimeout(timer); }
    }
    if (txt == null) throw err;
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
function rtListReady() { rtRender(); rtDraw(); rtBarText(); rtEnrich(); rtAddCat(rt.list, rt.at); }
// ---------- Catalogue « Parcours Pisteo » : parcours proposés par les utilisateurs, vérifiés par le relais ----------
const CAT_API = 'https://api.pisteo.app/catalogue';
let catP = null, catOn = false; // catOn : le catalogue a répondu (service activé sur le relais)
let catPT = 0;
function catLoad() {
  // appli restée ouverte : la liste est relue toutes les 10 min (parcours ajoutés ou retirés entre-temps)
  if (catP && Date.now() - catPT > 10 * 6e4) { catP = null; rtCache.clear(); }
  if (!catP) catPT = Date.now(), catP = (async () => {
    let c = null; try { c = JSON.parse(store.get('catCache') || 'null'); } catch {}
    if (c && c.on) catOn = true;
    if (c && Date.now() - c.t < 10 * 6e4) return c.items; // 10 min : un parcours retiré disparaît vite
    try {
      const r = await fetch(CAT_API, { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(); const items = Array.isArray(j.items) ? j.items : [];
      catOn = true; store.set('catCache', JSON.stringify({ t: Date.now(), items, on: 1 })); return items;
    } catch { return c ? c.items : []; }
  })();
  return catP;
}
// les parcours du catalogue proches du point, ajoutés en tête de la liste des parcours balisés
async function rtAddCat(list, at) {
  if (!list || !at || list.catDone) return;
  list.catDone = true;
  const items = await catLoad(), R = rtRadius(), sport = rtBike() ? 'bike' : 'foot', add = [];
  for (const c of items) {
    if (c.sport !== sport || !c.bb || !c.h) continue;
    const box = { lat: clamp(at.lat, c.bb[0], c.bb[2]), lon: clamp(at.lon, c.bb[1], c.bb[3]) };
    if (hav(at, box) > R) continue; // emprise trop loin : inutile de décoder le tracé
    let r = null; try { r = await readRouteLink(c.h); } catch {}
    if (!r) continue;
    let near = Infinity; for (const p of r.pts) { const d = hav(at, p); if (d < near) near = d; }
    if (near > R) continue;
    add.push({ id: 'c:' + c.id, cid: c.id, tags: {}, cat: 'cp', name: c.name, dist: c.dist, near: near < 300 ? 0 : near, big: false, at, src: 'c', h: c.h,
      bounds: { minlat: c.bb[0], minlon: c.bb[1], maxlat: c.bb[2], maxlon: c.bb[3] }, notes: { desc: r.desc || c.desc || '', wpts: r.wpts || [] }, cdesc: c.desc || r.desc || '', ph: Array.isArray(c.ph) ? c.ph : [], date: c.date, done: c.done, dms: c.ms });
  }
  if (!add.length || rt.list !== list) return;
  const score = it => it.near / 1000 - 1.5 * Math.min(it.ph.length, 3) + (Date.now() - Date.parse(it.date || 0)) / 864e5 / 365;
  add.sort((a, b) => score(a) - score(b)).forEach((it, i) => { it.top = i < CAT_SHOW; });
  list.unshift(...add);
  rtFiltUI();
  rtRender(); rtDraw(); rtBarText(); rtEnrich();
}
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
  else st = `${items.length} parcours ${where}. Touche une ligne sur la carte, ou glisse vers le haut pour la liste.` + (pr.done < pr.n ? ` (calcul ${pr.done}/${pr.n})` : '');
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
    const bits = [c.badge === 'Véloroute' || c.badge === 'Boucle vélo' ? c.label : it.cat === 'cp' ? `⭐ ${c.label}` : `${c.badge} · ${c.label}`];
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
  if (it.src === 'c') {
    const r = await readRouteLink(it.h); if (!r) throw new Error('pas de tracé');
    const p = makePath(r.pts, ''), g = { key, pts: r.pts, len: p.total, partial: false, up: p.hasEle ? p.totalUp : null, hasEle: p.hasEle };
    if (g.hasEle) g.elevP = Promise.resolve(g);
    return g;
  }
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
const RT_TF = [['', 'Tous'], ['b', 'Balisés'], ['c', '⭐ Recommandés']];
const CAT_SHOW = 5; // parcours recommandés mêlés aux balisés en mode « Tous » ; les autres avec « ⭐ Recommandés »
rt.filt = (() => { try { return Object.assign({ d: '', u: '', t: '' }, JSON.parse(store.get('rtFilt') || '') || {}); } catch { return { d: '', u: '', t: '' }; } })();
const rtFiltOn = () => !!(rt.filt.d || rt.filt.u || rt.filt.t);
const rtIn = (v, spec) => { const [a, b] = spec.split('-'); return v >= +a && (b === '' || v < +b); };
// true : correspond, false : écarté, null : pas encore calculé
function rtPass(it) {
  const cp = it.cat === 'cp';
  if (rt.filt.t === 'b' && cp) return false;
  if (rt.filt.t === 'c' && !cp) return false;
  if (!rt.filt.t && cp && !it.top) return false;
  if (!rt.filt.d && !rt.filt.u) return true;
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
  row($('rtFiltD'), RT_DF, 'd'); row($('rtFiltU'), RT_UF, 'u'); row($('rtFiltT'), RT_TF, 't');
  const nc = (rt.list || []).filter(it => it.cat === 'cp').length, bt = $('rtFiltT').lastChild;
  if (bt) bt.textContent = '⭐ ' + tr('Recommandés') + (nc ? ` (${nc})` : '');
}
function rtProgress() {
  const items = rt.list || [], done = items.filter(it => it.fail || (rt.geo.get(rtKey(it)) || {}).hasEle).length;
  return { done, n: items.length };
}

// ---------- Parcours dessinés par Pisteo (instantanés au toucher, filtrables) ----------
const RT_COL = { gr: '#d7263d', grp: '#e8890c', pr: '#e4b800', ev: '#1f5fd6', vn: '#2f7de1', vr: '#7b3fe4', vl: '#a46be8', vtt: '#7a5230', cp: '#0f9d76' };
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
  const text = loopGPX(pts, name, it.notes);
  if (update) { try { showTrack(parseGPX(text)); } catch { return; } } else loadText(text, false);
  store.set('gpx', text);
  const p = makePath(pts, ''), est = loopEst(p);
  rt.res = { text, name };
  $('rtbTitle').textContent = name;
  $('rtbSub').textContent = `${RT_CAT[it.cat].label} · ${fmtDist(p.total)}${p.hasEle ? ' · D+ ' + fmtM(p.totalUp) : ''} · environ ${fmtDur(est)}` + (partial ? ` · portion autour ${rt.fromMap || !me ? 'du point choisi' : 'de toi'}` : '');
  if (!update) { $('rtbKeep').textContent = 'Garder'; $('rtbKeep').disabled = false; }
  $('rtBar').hidden = false;
  if (update) return;
  setTimeout(() => { try { map.fitBounds(boundsOf([pts]), { padding: { top: 80, bottom: sheetPad() + $('rtBar').offsetHeight + 30, left: 30, right: 70 }, bearing: 0, pitch: 0, duration: 600 }); } catch {} }, 350);
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
  $('rtpGo').disabled = $('rtpKeep').disabled = $('rtpView').disabled = true; $('rtpKeep').textContent = 'Garder';
  const doneTxt = it.done && it.dms ? tr(`Parcouru le ${new Date(it.done).toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric' })} en ${fmtDur(it.dms / 1000)}`) : '';
  $('rtpDesc').textContent = [doneTxt, it.cdesc || ''].filter(Boolean).join('\n'); $('rtpDesc').hidden = !doneTxt && !it.cdesc; $('rtpReport').hidden = it.src !== 'c';
  const phs = (it.ph || []).map(n => `${CAT_API}/img/${it.cid}/${n}?d=${it.date || ''}`), strip = $('rtpPhotos'); strip.innerHTML = ''; strip.hidden = !phs.length;
  phs.forEach((u, i) => { const b = document.createElement('button'); b.className = 'ph-th'; b.style.backgroundImage = `url("${u}")`; b.setAttribute('aria-label', tr('Voir la photo')); b.onclick = () => catPhView(phs, i); strip.appendChild(b); });
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
  $('rtpGo').disabled = $('rtpKeep').disabled = $('rtpView').disabled = false;
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
  const it = rt.sel, name = it.name + (rt.selPartial ? ' (portion)' : ''), text = loopGPX(rt.selPts, name, it.notes);
  rt.res = { text, name };
  rtUnselect(); closeRoutes();
  loadText(text, false); store.set('gpx', text);
  startNav();
};
// « Aperçu » : le parcours s'ouvre comme un itinéraire (profil, météo, glisser sur le profil…) ; « Autres parcours » ramène à la liste
$('rtpView').onclick = () => {
  if (!rt.sel || !rt.selPts) return;
  const it = rt.sel, pts = rt.selPts, partial = rt.selPartial;
  rtUnselect(); closeRoutes(true);
  rtShow(it, pts, partial);
};
// parcours balisés : glisser vers le bas dans le panneau le réduit (la carte reste avec les parcours), vers le haut l'agrandit
(() => {
  const pnl = $('rtPanel'); let y0 = null, x0 = 0, top0 = 0;
  pnl.addEventListener('touchstart', e => {
    if (e.touches.length > 1 || e.target.closest('#rtGrab, input, select, canvas')) { y0 = null; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; top0 = pnl.scrollTop;
  }, { passive: true });
  pnl.addEventListener('touchend', e => {
    if (y0 == null) return;
    const t = e.changedTouches[0], dy = t.clientY - y0, dx = t.clientX - x0; y0 = null;
    if (Math.abs(dy) < 50 || Math.abs(dy) < Math.abs(dx) * 1.5) return;
    if (dy > 0 && top0 <= 2 && !rtSheet.collapsed) rtSetCollapsed(true);
    else if (dy < 0 && rtSheet.collapsed && !$('routes').classList.contains('has-card')) rtSetCollapsed(false);
  });
})();
$('rtpKeep').onclick = async () => {
  if (!rt.sel || !rt.selPts) return;
  const name = rt.sel.name + (rt.selPartial ? ' (portion)' : ''), text = loopGPX(rt.selPts, name, rt.sel.notes);
  await saveRecent(makePath(rt.selPts, name), text);
  $('rtpKeep').textContent = 'Gardé ✓'; $('rtpKeep').disabled = true;
  toast('Parcours gardé dans « Mes traces »', 3000);
};
$('rtToggle').onclick = () => rtSetCollapsed(!rtSheet.collapsed);
$('rtpReport').onclick = async () => {
  const it = rt.sel; if (!it || it.src !== 'c') return;
  const why = prompt(tr('Pourquoi signaler ce parcours ? (chemin privé ou interdit, dangereux, texte inapproprié…)'));
  if (why == null) return;
  try {
    const r = await fetch(CAT_API + '/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.cid, why: why.slice(0, 200) }) });
    const j = await r.json().catch(() => ({}));
    toast(j.message || 'Merci, le signalement est pris en compte.', 3500);
  } catch { toast('Pas de réseau : réessaie plus tard.', 3500); }
};

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
    // sans position connue (ordinateur, GPS lent) : recherche tout de suite autour de la carte affichée
    rt.prov = rtLastPos();
    const c0 = map.getCenter(), prov = rt.prov || { lat: c0.lat, lon: c0.lng };
    go(!!rt.prov);
    waitFix(20000).then(pos => {
      rt.prov = null;
      if ($('routes').hidden || rt.fromMap || !pos) return;
      if (hav(pos, prov) > 1500) go();
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
  // la trace et ce qui l'accompagne (sens, portions sombres, flèches de vent) : masqués ensemble pendant un tracé
  for (const id of ['track', 'track-casing', 'track-dir', 'litdark', 'litdark-bg']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  if (!on) { startMk.remove(); endMk.remove(); (wxPins || []).forEach(m => m.remove()); }
  else if (track) { startMk.addTo(map); endMk.addTo(map); wxMap(); }
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
  litRemember(pts); // éclairage (itinéraire calculé de nuit, à pied)
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
  const pts = removeSpurs(planAll()); litRemember(pts);
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
  r.pts.push({ lat: dest.lat, lon: dest.lon, ele: null, lit: (r.pts[r.pts.length - 1] || {}).lit }); litRemember(r.pts);
  if (!track) document.body.classList.remove('free');
  // le parcours suivi est gardé de côté : on peut le reprendre (« Reprendre le parcours »)
  if (track && !track.route) navPrev = { name: track.name, pts: track.pts.map(p => ({ lat: p.lat, lon: p.lon, ele: p.ele })) };
  await showTrack({ name: 'Vers ' + dest.label, pts: r.pts, signals: r.signals }, false);
  track.route = dest; track.style = profile === 'trekking' ? bikeStyle : null;
  arrived = false; guidance(); say(`Itinéraire prêt : ${speakDist(track.total)}. Allons-y !`);
  vibrate([60, 60, 60]); homeUI();
  toast(`✓ ${tr('Itinéraire vers')} ${dest.label} : ${fmtDist(track.total)}`, 7000, navPrev ? { label: tr('Annuler'), run: resumePrev } : null);
}
// revenir au parcours d'avant le détour (vers le départ, vers un lieu)
var navPrev = null;
async function resumePrev() {
  if (!navPrev || !nav) return;
  const p = navPrev; navPrev = null;
  await showTrack(p, false);
  isOff = false; offCount = 0; arrived = false; guidance(); homeUI();
  say(tr('Je reprends le parcours.')); toast(`✓ ${tr('Parcours repris')} : ${p.name}`, 4000);
}
async function reroute() {
  if (routing || !me || !track || !track.route) return;
  routing = true; lastRoute = Date.now(); $('btnRejoin').classList.add('busy'); guidance();
  const dest = track.route, style = track.style;
  try {
    let r;
    try { r = await fetchRoute(me, dest, Math.round(clamp(25 + hav(me, dest) / 1000 * 0.4, 25, 120)) * 1000, style); }
    catch (e) { await loadGraphs(); r = localRouteTo(me, dest); if (!r) throw e; }
    r.pts.push({ lat: dest.lat, lon: dest.lon, ele: null, lit: (r.pts[r.pts.length - 1] || {}).lit }); litRemember(r.pts);
    await showTrack({ name: 'Vers ' + dest.label, pts: r.pts, signals: r.signals }, false);
    track.route = dest; track.style = style; isOff = false; offCount = 0; arrived = false;
    say('J\'ai recalculé l\'itinéraire.');
  } catch { /* pas de réseau : nouvel essai automatique dans 30 s */ }
  routing = false; $('btnRejoin').classList.remove('busy'); guidance();
}

// =====================================================================
// Mesures affichées
// =====================================================================
// ---------- allure personnelle (heure d'arrivée) ----------
// à pied 4,5 km/h et 1 h par 600 m de D+ ; à vélo 16 km/h et 1 h par 800 m de D+ ; corrigé par tes sorties
const PACE0 = { foot: { v: 4.5 / 3.6, climb: 600 }, bike: { v: 16 / 3.6, climb: 800 } };
let paceHist = { foot: null, bike: null };
async function paceLoad() {
  try {
    const items = (await listRecent()).filter(isRec).filter(it => it.dist > 2000 && it.ms > 15 * 60000)
      .sort((a, b) => (b.start || b.date) - (a.start || a.date));
    for (const md of ['foot', 'bike']) {
      const its = items.filter(it => recMode(it) === md).slice(0, 10), c = PACE0[md].climb;
      let d = 0, t = 0;
      for (const it of its) { const flat = it.ms / 1000 - (it.up || 0) / c * 3600; if (flat > 300) { d += it.dist; t += flat; } }
      const lim = md === 'bike' ? [8, 35] : [2, 8];
      paceHist[md] = its.length >= 2 && t > 0 ? { v: clamp(d / t * 3.6, lim[0], lim[1]) / 3.6, n: its.length } : null;
    }
  } catch { /* pas de sorties : allure par défaut */ }
}
setTimeout(paceLoad, 4000);
// le jour même : temps et distance en mouvement depuis le début de la navigation (à partir de ~1 km)
let paceDay = { t: 0, d: 0, up: 0, all: 0, ref: null };
function paceReset() { paceDay = { t: 0, d: 0, up: 0, all: 0, ref: null }; }
function paceFix(pos) {
  if (!nav || pos.sim || (pos.acc || 0) > 40) return;
  const r = paceDay.ref; paceDay.ref = pos;
  if (!r || !r.t || !pos.t) return;
  const dt = (pos.t - r.t) / 1000; if (dt <= 0 || dt > 60) return;
  const d = hav(r, pos);
  paceDay.all += dt;
  if (d / dt > 0.5 && d / dt < 30) { // en mouvement
    paceDay.t += dt; paceDay.d += d;
    if (pos.ele != null && r.ele != null && pos.ele > r.ele) paceDay.up += Math.min(pos.ele - r.ele, 5);
  }
}
function paceNow(bike) {
  const md = bike ? 'bike' : 'foot', b = PACE0[md], h = paceHist[md];
  let v = h ? h.v : b.v;
  // allure du jour sur le plat (la montée faite retirée), de plus en plus prise en compte jusqu'à 5 km
  const flat = paceDay.t - paceDay.up / b.climb * 3600;
  if (paceDay.d > 1000 && flat > 120) {
    const lim = bike ? [5, 45] : [1.5, 9], vd = clamp(paceDay.d / flat * 3.6, lim[0], lim[1]) / 3.6;
    const w = clamp((paceDay.d - 1000) / 4000, 0, 0.8);
    v = w * vd + (1 - w) * v;
  }
  // les pauses du jour (au-delà de ~2 km) rallongent un peu l'estimation, au plus d'un tiers
  const stop = paceDay.d > 2000 && paceDay.t > 0 ? clamp(paceDay.all / paceDay.t, 1, 1.33) : 1;
  // vitesse de montée : proportionnelle à ton allure par rapport à l'allure de base
  return { v, climb: b.climb * clamp(v / b.v, 0.6, 1.6), stop };
}
function remainingInfo() {
  if (!track) return null;
  const di = doneInfo();
  let rem = di.remain, up = di.upLeft;
  if (progress && rejoin && rejoinProg) {
    const pt = rejoin.target.along != null ? infoAt(rejoin.target.along) : project(track, rejoin.target, true);
    rem = rejoinProg.remain + (pt ? pt.remain : 0);
    up = (pt ? pt.upLeft : up) + (rejoin.hasEle ? rejoinProg.upLeft : 0);
  }
  // temps = distance à ton allure sur le plat + D+ restant à ta vitesse de montée, puis tes pauses.
  // Allure : d'abord celle de tes sorties passées (même mode), puis de plus en plus celle du jour (en mouvement).
  const bike = profile === 'trekking', pace = paceNow(bike);
  const sigLeft = track.sig ? track.sig.filter(s => s > di.along + 20).length : 0; // ~20 s par feu
  const secs = (rem / pace.v + (track.hasEle ? up / pace.climb * 3600 : 0)) * pace.stop + sigLeft * 20;
  return { rem, up, secs };
}
// un chiffre trop long pour sa colonne est rapetissé plutôt que de déborder sur le voisin
function fitStat(id) {
  const el = $(id); el.style.fontSize = '';
  for (let fs = 21; el.scrollWidth > el.clientWidth + 1 && fs > 13; fs--) el.style.fontSize = (fs - 1) + 'px';
}
// ---------- cases du bas en navigation : au choix (toucher une case pour la changer) ----------
const NB_IDS = [['nbEta', 'nbDur'], ['nbRem', 'nbL2'], ['nbUp', 'nbL3']];
const NAV_STATS = { eta: 'Heure d\'arrivée', left: 'Temps restant', rem: 'Distance restante', up: 'D+ restant', done: 'Distance parcourue',
  upDone: 'D+ fait', pct: 'Progression', time: 'Temps de sortie', avg: 'Vitesse moyenne', ele: 'Altitude', clock: 'Heure', climb: 'Prochaine montée' };
function navStatSlots() {
  let a; try { a = JSON.parse(store.get('navStats') || 'null'); } catch {}
  return Array.isArray(a) && a.length === 3 && a.every(k => NAV_STATS[k]) ? a : ['eta', 'rem', 'up'];
}
function navStatVal(k, info) {
  const di = doneInfo(), el = actState !== 'idle' ? actElapsed() / 1000 : (Date.now() - navStartT) / 1000;
  const dist = actState !== 'idle' ? act.d : freeD;
  switch (k) {
    case 'eta': return [fmtClock(info.secs), 'arrivée · ' + fmtDur(info.secs)];
    case 'left': return [fmtDur(info.secs), 'restant'];
    case 'rem': return [fmtDist(info.rem), 'restant'];
    case 'up': return [track.hasEle ? fmtM(info.up) : '–', 'D+ restant'];
    case 'done': return [fmtDist(di.along), 'parcouru'];
    case 'upDone': return [track.hasEle ? fmtM(track.totalUp - di.upLeft) : '–', 'D+ fait'];
    case 'pct': return [Math.floor(di.along / track.total * 100) + ' %', 'progression'];
    case 'time': return [fmtDur(el), actState !== 'idle' ? 'temps (sortie)' : 'durée'];
    case 'avg': return [el > 60 ? kmh(dist / el * 3.6) : '–', 'vitesse moy.'];
    case 'ele': return [me && me.ele != null ? fmtM(me.ele) : '–', 'altitude'];
    case 'clock': return [new Date().toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }), 'heure'];
    case 'climb': {
      const cn = climbNow();
      if (!cn) return ['–', 'montée'];
      return cn.inside ? [fmtM(cn.up), 'sommet ' + fmtDist(cn.left)] : [fmtDist(cn.to), 'montée ' + fmtPct(cn.c.grade)];
    }
  }
  return ['–', ''];
}
function navStatPick(i) {
  if (!nav || !track) return;
  const cur = navStatSlots(), menu = $('nbPick');
  menu.innerHTML = '';
  const h = document.createElement('b'); h.textContent = 'Afficher dans cette case'; menu.appendChild(h);
  for (const [k, lbl] of Object.entries(NAV_STATS)) {
    const b = document.createElement('button'); b.className = 'nbp-item' + (cur[i] === k ? ' on' : ''); b.textContent = lbl;
    b.onclick = e => {
      e.stopPropagation();
      const a = cur.slice(), j = a.indexOf(k); if (j >= 0 && j !== i) a[j] = a[i]; // déjà dans une autre case : on échange
      a[i] = k; store.set('navStats', JSON.stringify(a)); stat('case_' + k);
      menu.hidden = true; updateStats();
    };
    menu.appendChild(b);
  }
  const r = $(NB_IDS[i][0]).parentElement.getBoundingClientRect();
  menu.style.left = clamp(r.left + r.width / 2 - 110, 8, innerWidth - 228) + 'px';
  menu.hidden = false;
}
NB_IDS.forEach(([v], i) => { $(v).parentElement.onclick = e => { e.stopPropagation(); navStatPick(i); }; });
document.addEventListener('click', e => { const m = $('nbPick'); if (m && !m.hidden && !m.contains(e.target)) m.hidden = true; }, true);
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
    nightCheck(info);
    navStatSlots().forEach((k, i) => { const [v, l] = navStatVal(k, info); $(NB_IDS[i][0]).textContent = v; $(NB_IDS[i][1]).textContent = l; });
    ['nbEta', 'nbRem', 'nbUp'].forEach(fitStat);
    climbUI();
    $('nbBar').style.width = clamp(doneInfo().along / track.total, 0, 1) * 100 + '%';
    const sp = me && me.speed != null && !isNaN(me.speed) ? me.speed * (IMP ? 2.23694 : 3.6) : null;
    $('spVal').textContent = sp == null ? '–' : (sp < 10 ? sp.toFixed(1).replace('.', ',') : Math.round(sp));
  }
}

// =====================================================================
// Montées à venir (comme ClimbPro) : repérées sur le profil, affichées et annoncées en navigation
// =====================================================================
// montée : du creux au sommet, en ignorant les petites descentes (< 15 m) ; au moins 25 m de D+ et 3 % de moyenne
function computeClimbs(p) {
  if (!p.hasEle) return [];
  const E = p.ele, C = p.cum, n = E.length, H = 15, ext = [];
  let mode = 0, cand = -1, mn = -1, mx = -1;
  for (let i = 0; i < n; i++) {
    const e = E[i]; if (e == null) continue;
    if (mode === 0) {
      if (mn < 0) { mn = mx = i; continue; }
      if (e > E[mx]) mx = i; if (e < E[mn]) mn = i;
      if (E[mx] - E[mn] >= H) { if (mx > mn) { ext.push(['lo', mn]); mode = 1; cand = mx; } else { ext.push(['hi', mx]); mode = -1; cand = mn; } }
    } else if (mode === 1) {
      if (e > E[cand] + 1) cand = i;
      // descente, ou replat de plus de 400 m sans rien gagner : la montée s'arrête au dernier point haut
      else if (E[cand] - e >= H || C[i] - C[cand] > 400) { ext.push(['hi', cand]); mode = -1; cand = i; }
    }
    else { if (e < E[cand]) cand = i; else if (e - E[cand] >= H) { ext.push(['lo', cand]); mode = 1; cand = i; } }
  }
  if (mode === 1) ext.push(['hi', cand]);
  const out = [];
  for (let k = 0; k < ext.length - 1; k++) {
    if (ext[k][0] !== 'lo' || ext[k + 1][0] !== 'hi') continue;
    let a = ext[k][1], b = ext[k + 1][1];
    // début réel : là où ça commence à monter (on retire le replat du creux)
    while (a < b - 1 && E[a + 1] != null && E[a + 1] - E[a] < 0.5 && C[a + 1] - C[ext[k][1]] < 2000) a++;
    // fin trop douce (faux plat après la vraie montée) : on la retire tant que les 300 derniers mètres montent à moins de 3 %
    const gr = (i, j) => (E[j] - E[i]) / Math.max(1, C[j] - C[i]);
    const back = (j, m) => { let i = j; while (i > a && C[j] - C[i] < m) i--; return i; };
    while (C[b] - C[a] > 600) { const i = back(b, 300); if (gr(i, b) >= Math.max(0.03, gr(a, b) * 0.4)) break; b = back(b, 100); }
    const len = C[b] - C[a], gain = E[b] - E[a];
    if (gain < 25 || len < 200 || gain / len < 0.03) continue;
    // pente max sur 100 m
    let mx = 0;
    for (let i = a, j = a; i < b; i++) { while (j < b && C[j] - C[i] < 100) j++; if (C[j] - C[i] >= 80) mx = Math.max(mx, (E[j] - E[i]) / (C[j] - C[i])); }
    out.push({ start: C[a], end: C[b], gain, len, grade: gain / len, max: Math.max(mx, gain / len), top: E[b] });
  }
  return out;
}
const fmtPct = g => Math.round(g * 100) + ' %';
let climbSpoken = new Map();
// montée en cours, ou prochaine montée à moins de 3 km
function climbNow() {
  if (!nav || !track || !track.climbs || !track.climbs.length || !progress || rejoin || isOff || arrived) return null;
  const at = progress.along, cs = track.climbs;
  const i = cs.findIndex(c => at < c.end - 10);
  if (i < 0) return null;
  const c = cs[i], n = cs.length;
  if (at >= c.start) {
    const left = c.end - at, eleNow = track.ele[progress.idx], up = eleNow != null ? Math.max(0, c.top - eleNow) : c.gain * left / c.len;
    return { c, i, n, inside: true, left, up, grade: left > 0 ? up / left : c.grade };
  }
  const to = c.start - at;
  return to <= 3000 ? { c, i, n, inside: false, to } : null;
}
function climbUI() {
  const el = $('climb'), cn = climbNow();
  el.hidden = !cn;
  if (!cn) return '';
  const c = cn.c, num = cn.n > 1 ? ` ${cn.i + 1}/${cn.n}` : '';
  let line;
  if (cn.inside) {
    line = `Sommet dans ${fmtDist(cn.left)} · encore ${fmtM(cn.up)} à ${fmtPct(cn.grade)}`;
    $('clTitle').textContent = 'Montée' + num;
    $('clBar').style.width = clamp(1 - cn.left / c.len, 0, 1) * 100 + '%';
  } else {
    line = `Dans ${fmtDist(cn.to)} : ${fmtDist(c.len)} à ${fmtPct(c.grade)} · D+ ${fmtM(c.gain)}`;
    $('clTitle').textContent = 'Prochaine montée' + num;
    $('clBar').style.width = '0%';
  }
  $('clTxt').textContent = line;
  el.dataset.hard = c.grade >= 0.08 ? '2' : c.grade >= 0.05 ? '1' : '0';
  // annonces : à l'approche, à mi-montée pour les longues, et peu avant le sommet
  if (cn.inside) {
    const key = c.start;
    const st = climbSpoken.get(key) || 0;
    if (c.gain >= 60 && st < 2 && cn.left < c.len / 2 && cn.left > 600) { climbSpoken.set(key, 2); say(`Mi-montée. Encore ${speakDist(cn.left)} et ${Math.round(cn.up / 10) * 10} mètres de dénivelé.`, true); }
    else if (c.gain >= 40 && st < 3 && cn.left <= Math.max(250, (speedEma || 1.2) * 60) && cn.left > 60) { climbSpoken.set(key, 3); say(`Sommet dans ${speakDist(cn.left)}.`, true); }
  } else {
    const st = climbSpoken.get(c.start) || 0, lead = clamp((speedEma || 1.2) * 60, 150, 600);
    if (st < 1 && cn.to <= lead && cn.to > 30) {
      climbSpoken.set(c.start, 1);
      const steep = c.max >= c.grade + 0.04 && c.max >= 0.08 ? `, jusqu'à ${Math.round(c.max * 100)} %` : '';
      say(`Montée dans ${speakDist(cn.to)} : ${speakDist(c.len)} à ${Math.round(c.grade * 100)} % de moyenne${steep}, ${Math.round(c.gain / 10) * 10} mètres de dénivelé.`, true);
    }
  }
  return line;
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
  const T = wxOnProf() ? 44 : 0; // place pour la météo au-dessus du profil
  // marge gauche à la largeur des altitudes affichées (pas d'espace perdu avant elles)
  const ticks = eleTicks(lo, hi, [10, 20, 50, 100, 200, 250, 500, 1000]);
  const L0 = Math.ceil(Math.max(14, ...ticks.map(t => ctx.measureText(t[1]).width))) + 5; cv._L0 = L0;
  const LB = track.lit && litShown ? 7 : 0; // bande « éclairage »
  const B = (T ? 26 : 16) + LB, w = W - L0 - 4, h = H - B - 4 - T; // météo : place pour la bande « ciel » au-dessus des km
  const X = d => L0 + d / track.total * w, Y = e => 4 + T + (1 - (e - lo) / (hi - lo)) * h;
  if (T) wxBands(ctx, X, 4 + T, h);
  if (LB) litBand(ctx, X, 4 + T + h + (T ? 15 : 2));
  ctx.strokeStyle = cssVar('--line'); ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const [v, lab] of ticks) {
    const y = Math.round(Y(v)) + .5; ctx.beginPath(); ctx.moveTo(L0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.fillText(lab, L0 - 4, y);
  }
  ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'; ctx.fillText('0', L0, H);
  ctx.textAlign = 'right'; ctx.fillText(fmtDist(track.total), W, H);
  const stride = Math.max(1, Math.floor(n / (w * 2)));
  const path = new Path2D(); let first = true;
  for (let i = 0; i < n; i += stride) { if (E[i] == null) continue; const x = X(C[i]), y = Y(E[i]); first ? path.moveTo(x, y) : path.lineTo(x, y); first = false; }
  if (E[n - 1] != null) path.lineTo(X(C[n - 1]), Y(E[n - 1]));
  const area = new Path2D(path); area.lineTo(X(track.total), 4 + T + h); area.lineTo(L0, 4 + T + h); area.closePath();
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
    ctx.beginPath(); ctx.moveTo(x, 4 + T); ctx.lineTo(x, 4 + T + h); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COL.me; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
  if (T) { wxTemps(ctx, X, 4 + T, h, L0, W); wxWindProf(ctx, X, 4 + T, h); wxMarks(ctx, X, L0, W); }
  if (cv === $('profile') && scrubD != null) scrubDraw(ctx, X, Y, T, h, L0, W);
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
  homeUI();
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
  return { name, fname: fname === '.gpx' ? 'parcours-pisteo.gpx' : fname, text: loopGPX(wtSrc.pts, name, wtNotes()) };
}
// notes envoyées avec le parcours : celles de la trace ouverte (modifiables ici), sinon celles du fichier
function wtNotes() {
  if (wtSrc && wtSrc.cur && track) {
    const d = $('wtDesc').value.trim().slice(0, NOTE_DESC_MAX);
    if (d !== track.desc) { track.desc = d; commitNotes(); }
    return { desc: track.desc, wpts: track.wpts };
  }
  return { desc: (wtSrc && wtSrc.desc) || '', wpts: (wtSrc && wtSrc.wpts) || [] };
}
function wtNotesUI() {
  const cur = !!(wtSrc && wtSrc.cur && track), rec = !cur && wtSrc && wtSrc.rec;
  $('wtRecNotes').hidden = !rec;
  if (rec) { const n = (wtSrc.wpts || []).length; $('wtRecInfo').textContent = wtSrc.desc || n ? tr('Description et points notés inclus') + (n ? ` (${n})` : '') : tr('Ajoute une description ou des points (vue, eau, danger…) pour ceux qui le referont'); }
  $('wtNotes').hidden = !cur;
  if (!cur) return;
  $('wtDesc').value = track.desc || '';
  const n = track.wpts.length;
  $('wtNoteCount').textContent = n ? `${n} point${n > 1 ? 's' : ''} noté${n > 1 ? 's' : ''} sur la carte` : 'Aucun point noté';
}
function wtSay(m) { $('wtMsg').textContent = m || ''; $('wtMsg').hidden = !m; }
function openSend(src) {
  wtSrc = src; const p = makePath(src.pts, '');
  $('wtName').textContent = `${src.name || 'Parcours'} · ${fmtDist(p.total)}${p.hasEle ? ' · D+ ' + fmtM(p.totalUp) : ''}${src.sub ? ' · ' + src.sub : ''}`; wtSay('');
  qrShown(false); wtNotesUI();
  $('wtPropose').hidden = !catOn; if (!catOn) catLoad().then(() => { $('wtPropose').hidden = !catOn; });
  $('watch').hidden = false;
}
$('wtDesc').addEventListener('change', () => wtNotes());
$('wtAddNote').onclick = () => { wtNotes(); $('watch').hidden = true; addNote('send'); };
// sortie : on l'ouvre sur la carte comme une trace, liée à la sortie pour que les notes y soient enregistrées
// ---------- preuve qu'un parcours a été fait : une sortie enregistrée, ou un GPX d'activité (heures de passage) ----------
// texte écrit au hasard (« djzodbekzbdh », « qsdfgh », « blablabla ») : pas de vraies phrases
const GIB_COMMON = new Set('le la les de des du un une et a au aux en pour sur avec par est sont dans ce cet cette qui que il elle on nous vous tres bien belle beau joli jolie tout tous plus pas peu sans vers apres avant entre chemin sentier route boucle parcours balade velo pied depart arrivee parking vue lac foret riviere village col montee descente facile difficile sympa the and of to in is with for on at from this very nice easy hard trail path road loop view el los las del con por para muy y un una der die das und mit von zu ist sehr'.split(' '));
function gibberish(t, sentence) {
  const s = String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), w = s.match(/[a-z]+/g) || [];
  if (!w.length) return true;
  if (w.some(x => x.length > 20)) return true;
  if (/([a-z]{2,4})\1{2,}/.test(s.replace(/[^a-z]/g, ''))) return true;
  if (w.some(x => /[bcdfghjklmnpqrstvwxz]{5,}/.test(x))) return true;
  const letters = w.join(''), vow = (letters.match(/[aeiouy]/g) || []).length;
  if (letters.length >= 8 && vow / letters.length < 0.22) return true;
  if (sentence && (w.filter(x => x.length >= 2).length < 4 || !w.some(x => GIB_COMMON.has(x)))) return true;
  return false;
}
const CP_SPEED = { foot: [1, 20], bike: [4, 50] }; // vitesse moyenne en mouvement plausible (km/h) : marche à course, balade à route
function cpProofText() {
  if (!wtSrc) return '';
  if (wtSrc.rec) return wtSrc.rec.text || '';
  if (wtSrc.cur && track) return (track.recItem && track.recItem.text) || store.get('gpx') || '';
  return wtSrc.text || '';
}
// renvoie { done, ms, dist, avg } ou { err } ; null si le fichier n'a pas d'heures (tracé dessiné ou calculé)
function cpProof() {
  let pts = []; try { pts = parseRec(cpProofText()).filter(p => isFinite(p.t)); } catch {}
  if (pts.length < 20) return null;
  let ms = 0, dist = 0, gapD = 0, gapMax = 0; const sp = [];
  let wd = 0, wt = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dt = (b.t - a.t) / 1000, d = hav(a, b);
    if (dt <= 0) continue;
    dist += d;
    if ((a.s || 0) !== (b.s || 0)) continue; // pause volontaire
    // coupure d'enregistrement : longue attente, ou bond de plus de 500 m entre deux positions (tracé en ligne droite)
    if ((dt > 600 && d > 1000) || d > 500 || d / dt > 25) { gapD += d; gapMax = Math.max(gapMax, d); continue; }
    if (dt < 300 && d / dt > 0.3) {
      ms += dt * 1000; wd += d; wt += dt;
      if (wt >= 60) { sp.push(wd / wt); wd = 0; wt = 0; } // vitesse par tranche d'une minute
    }
  }
  if (!dist || ms < 5 * 6e4) return { err: 'Sortie trop courte pour être proposée.' };
  if (gapMax > 1000 || gapD > dist * 0.1) return { err: `L'enregistrement de cette sortie a été coupé (${fmtDist(gapD)} tracés en ligne droite) : le parcours n'est pas fiable pour être proposé.` };
  // heures inventées par un logiciel de préparation (vitesse parfaitement constante) : pas une vraie sortie
  if (sp.length >= 15) { const m = sp.reduce((x, y) => x + y, 0) / sp.length, sd = Math.sqrt(sp.reduce((x, y) => x + (y - m) ** 2, 0) / sp.length); if (sd / m < 0.02) return null; }
  return { done: pts[0].t, ms, dist, avg: dist / 1000 / (ms / 36e5) };
}
const cpNoProof = () => toast('Seuls les parcours que tu as faits peuvent être proposés : enregistre ta sortie avec Pisteo, ou importe le GPX de ton activité (Strava, Garmin…).', 7000);
let cpPf = null;
$('wtPropose').onclick = () => {
  if (!wtSrc) return;
  cpPf = cpProof();
  if (!cpPf) { cpNoProof(); return; }
  if (cpPf.err) { toast(cpPf.err, 5000); return; }
  const n = wtNotes(), nm = wtSrc.name || '';
  $('cpName').value = CP_AUTO_NAME.test(nm) ? '' : nm.replace(/ \(sens inverse\)$/, '').slice(0, 60);
  $('cpDesc').value = n.desc || '';
  cpSport = wtSrc.rec && wtSrc.rec.mode ? wtSrc.rec.mode : cpPf.avg > 18 ? 'bike' : profile === 'trekking' ? 'bike' : 'foot'; cpSportUI();
  $('cpDone').textContent = tr(`Parcouru le ${new Date(cpPf.done).toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric' })} en ${fmtDur(cpPf.ms / 1000)} (${kmh(cpPf.avg)} de moyenne)`);
  $('cpMsg').hidden = true; $('cpSend').disabled = false;
  // proposé depuis une sortie : ses photos sont reprises (on peut en retirer)
  cpFiles = wtSrc.rec && soPhotos.length ? soPhotos.slice(0, 3).map(p => p.full) : []; cpThumbs();
  $('watch').hidden = true; $('propose').hidden = false;
};
let cpSport = 'foot', cpFiles = [];
// noms donnés automatiquement (Pisteo, Strava, Garmin…) : pas un vrai nom de parcours
const CP_AUTO_NAME = /^((sortie|balade|course|course à pied|marche|randonnée|rando|vélo|sortie à vélo|sortie vélo|activité|entraînement)( (à pied|à vélo|vtt|gravel))? (du|de la|de l'|de l’|d'|d’|le|en) ?(matin|midi|après-midi|apres-midi|soir|soirée|nuit|\d)|sortie du|trace sans nom|parcours partagé|boucle (à pied|à vélo) de|vers |(morning|afternoon|evening|night|lunch) (ride|run|walk|hike))/i;
function catPhView(urls, i) {
  $('phImg').src = urls[i]; $('phInfo').textContent = `${i + 1} / ${urls.length}`; $('phDel').hidden = true;
  $('phPrev').hidden = i === 0; $('phNext').hidden = i >= urls.length - 1;
  $('phPrev').onclick = () => catPhView(urls, i - 1); $('phNext').onclick = () => catPhView(urls, i + 1);
  $('phView').hidden = false;
}
const cpThumbs = () => {
  const box = $('cpPhotos'); box.innerHTML = '';
  cpFiles.forEach((f, i) => {
    const b = document.createElement('button'); b.className = 'ph-th cp-th'; b.style.backgroundImage = `url(${phUrl(f)})`;
    b.setAttribute('aria-label', tr('Retirer la photo')); b.textContent = '✕'; b.onclick = () => { cpFiles.splice(i, 1); cpThumbs(); }; box.appendChild(b);
  });
  $('cpPhAdd').hidden = cpFiles.length >= 3;
};
$('cpPhAdd').onclick = () => $('cpPhIn').click();
$('cpPhIn').onchange = () => { cpFiles = cpFiles.concat([...$('cpPhIn').files]).slice(0, 3); $('cpPhIn').value = ''; cpThumbs(); };
// photo pour le catalogue : réenregistrée (ce qui retire la position GPS et les autres métadonnées), 1280 px, 600 Ko au plus
async function cpPhotoBlob(f) {
  const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height)), cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k); cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  for (const q of [0.82, 0.7, 0.55]) { const b = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', q)); if (b && b.size < 600 * 1024) return b; }
  return null;
}
function cpSportUI() { $('cpFoot').classList.toggle('on', cpSport === 'foot'); $('cpBike').classList.toggle('on', cpSport === 'bike'); }
$('cpFoot').onclick = () => { cpSport = 'foot'; cpSportUI(); };
$('cpBike').onclick = () => { cpSport = 'bike'; cpSportUI(); };
const cpClose = () => { $('propose').hidden = true; if (wtSrc) $('watch').hidden = false; };
$('cpClose').onclick = cpClose;
$('propose').onclick = e => { if (e.target === $('propose')) cpClose(); };
$('cpSend').onclick = async () => {
  const say = (m, ok) => { $('cpMsg').textContent = tr(m); $('cpMsg').className = ok ? 'note cp-ok' : 'fin-msg'; $('cpMsg').hidden = false; };
  const name = $('cpName').value.trim(), desc = $('cpDesc').value.trim();
  if (name.length < 4 || CP_AUTO_NAME.test(name)) { say('Donne un nom au parcours (lieu, sommet, lac…).'); return; }
  if (gibberish(name, false)) { say('Donne un nom au parcours (lieu, sommet, lac…).'); return; }
  if (desc.length >= 30 && gibberish(desc, true)) { say('Écris une vraie description, en quelques phrases : difficulté, départ, ce qu\'on y voit…'); return; }
  if (desc.length < 30) { say('Ajoute une description d\'au moins 30 caractères : difficulté, départ, ce qu\'on y voit…'); return; }
  const [lo, hi] = CP_SPEED[cpSport];
  if (cpPf.avg > hi || cpPf.avg < lo) { say(cpSport === 'foot' && cpPf.avg > hi ? `Vitesse moyenne de ${Math.round(cpPf.avg)} km/h : ce parcours a-t-il été fait à vélo ?` : cpSport === 'bike' && cpPf.avg < lo ? `Vitesse moyenne de ${cpPf.avg.toFixed(1)} km/h : ce parcours a-t-il été fait à pied ?` : `Vitesse moyenne de ${Math.round(cpPf.avg)} km/h : trop rapide pour un parcours à vélo.`); return; }
  // la description sert aussi au parcours ouvert (et au lien partagé)
  if (wtSrc.cur && track) { $('wtDesc').value = desc.slice(0, NOTE_DESC_MAX); track.desc = $('wtDesc').value; commitNotes(); }
  const n = wtNotes(), notes = { desc, wpts: n.wpts };
  const url = await routeLink(name, wtSrc.pts, notes), h = url.slice(url.indexOf('#'));
  $('cpSend').disabled = true;
  try {
    const r = await fetch(CAT_API + '/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ h, name, sport: cpSport, done: cpPf.done, ms: Math.round(cpPf.ms) }) });
    const j = await r.json().catch(() => ({}));
    if (j.ok) {
      let sent = 0;
      for (const f of cpFiles) {
        try {
          const b = await cpPhotoBlob(f); if (!b) continue;
          const pr = await fetch(`${CAT_API}/photo?id=${encodeURIComponent(j.id)}&tok=${encodeURIComponent(j.tok)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: b });
          if (pr.ok) sent++;
        } catch { /* réseau coupé : le parcours reste publié sans cette photo */ }
      }
      store.set('catCache', ''); catP = null; rtCache.clear(); $('propose').hidden = true; cpFiles = [];
      toast(tr(j.message || 'Parcours publié dans le catalogue. Merci !') + (sent ? ' ' + tr(sent > 1 ? `${sent} photos envoyées, visibles après validation.` : '1 photo envoyée, visible après validation.') : ''), 5000);
      return;
    }
    say(j.message || `Envoi impossible (${r.status}).`);
  } catch { say('Pas de réseau : réessaie quand tu auras une connexion.'); }
  $('cpSend').disabled = false;
};
$('wtRecEdit').onclick = () => {
  const it = wtSrc && wtSrc.rec; if (!it) return;
  if (nav) { toast('Quitte d\'abord la navigation.', 3000); return; }
  $('watch').hidden = true; closeSorties();
  loadText(it.text, false); store.set('gpx', it.text.length < 4.5e6 ? it.text : '');
  if (!track) return;
  track.recItem = it; track.name = recTitle(it);
  openSend({ name: track.name, pts: track.pts, cur: true, sub: wtSrc.sub });
};
// QR code du lien : à montrer sur l'écran, ou à imprimer (club, départ d'une boucle…)
// le lien est raccourci (tracé plus simplifié) pour rester lisible par l'appareil photo
async function qrLink() {
  const notes = wtNotes();
  let url = '';
  for (const max of [300, 200, 140, 100, 70, 50]) { url = await routeLink(wtSrc.name, wtSrc.pts, notes, max); if (url.length <= 900) break; }
  return url;
}
// le même bouton affiche puis masque le QR code
function qrShown(on) { $('wtQrBox').hidden = !on; $('wtQr').textContent = on ? 'Masquer le QR code' : 'Afficher un QR code'; }
$('wtQr').onclick = async () => {
  if (!wtSrc) return;
  if (!$('wtQrBox').hidden) { qrShown(false); return; }
  const url = await qrLink();
  let q; try { q = qrcode(0, 'L'); q.addData(url); q.make(); } catch { wtSay('Parcours trop long pour un QR code : partage plutôt le lien.'); return; }
  const n = q.getModuleCount(), quiet = 4, scale = Math.max(4, Math.ceil(720 / (n + 2 * quiet)));
  const cv = $('wtQrCv'), side = (n + 2 * quiet) * scale, foot = 70;
  cv.width = side; cv.height = side + foot;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
  // sous le code : nom, distance et D+, pour une affiche ou un message
  ctx.fillStyle = '#17201c'; ctx.textAlign = 'center';
  ctx.font = `700 ${Math.round(side / 22)}px system-ui, sans-serif`;
  ctx.fillText((wtSrc.name || 'Parcours').slice(0, 40), side / 2, side + foot * 0.38);
  const p = makePath(wtSrc.pts, '');
  ctx.font = `${Math.round(side / 30)}px system-ui, sans-serif`; ctx.fillStyle = '#4a5550';
  ctx.fillText(tr(`${fmtDist(p.total)}${p.hasEle ? ' · D+ ' + fmtM(p.totalUp) : ''} · à scanner pour l'ouvrir dans Pisteo`), side / 2, side + foot * 0.8);
  $('wtQrSave').hidden = !!AND; // appli Android : une capture d'écran suffit
  $('wtQrNote').textContent = tr(AND ? 'Fais scanner l\'écran par un autre téléphone, ou prends une capture d\'écran pour l\'imprimer.' : 'Fais scanner l\'écran par un autre téléphone, ou enregistre l\'image pour l\'imprimer.');
  qrShown(true); wtSay('');
  setTimeout(() => $('wtQrBox').scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
};
$('wtQrSave').onclick = () => {
  $('wtQrCv').toBlob(async b => {
    if (!b) return;
    const fname = wtFile().fname.replace(/\.gpx$/, '-qr.png'), file = new File([b], fname, { type: 'image/png' });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: wtSrc.name }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = fname; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000); wtSay(`Image enregistrée : ${fname}`);
  }, 'image/png');
};
$('btnWatch').onclick = () => { if (track) openSend({ name: track.name, pts: track.pts, cur: true }); };
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
async function routeLink(name, pts, notes, max = 600) {
  const sp = simplifyDP(pts, max), hasE = sp.some(p => p.ele != null);
  const withN = !!(notes && (notes.desc || (notes.wpts && notes.wpts.length))), bytes = [withN ? 2 : 1, hasE ? 1 : 0];
  const put = v => { v = v < 0 ? -2 * v - 1 : 2 * v; while (v > 127) { bytes.push((v & 127) | 128); v = Math.floor(v / 128); } bytes.push(v); };
  if (withN) put(sp.length);
  let pa = 0, po = 0, pe = 0;
  for (const p of sp) {
    const a = Math.round(p.lat * 1e5), o = Math.round(p.lon * 1e5); put(a - pa); put(o - po); pa = a; po = o;
    if (hasE) { const e = Math.round(p.ele != null ? p.ele : pe); put(e - pe); pe = e; }
  }
  // notes : description et points (type, position, texte), à la suite du tracé
  if (withN) {
    const ks = Object.keys(NOTE_KINDS), J = { d: notes.desc || '', w: (notes.wpts || []).slice(0, NOTE_MAX).map(n => [Math.round(n.lat * 1e5), Math.round(n.lon * 1e5), ks.indexOf(n.kind), n.name, n.desc || ''].slice(0, n.desc ? 5 : 4)) };
    bytes.push(...new TextEncoder().encode(JSON.stringify(J)));
  }
  const raw = new Uint8Array(bytes), z = await zip(raw, 'in').catch(() => null);
  const data = z && z.length < raw.length ? 'z' + b64enc(z) : 'r' + b64enc(raw);
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}p/#${data}~${encodeURIComponent((name || '').slice(0, 60))}`;
}
async function readRouteLink(hash) {
  const m = /^#?([zr])([A-Za-z0-9_-]+)(?:~(.*))?$/.exec(hash || ''); if (!m) return null;
  let u8 = b64dec(m[2]); if (m[1] === 'z') u8 = await zip(u8, 'out');
  if (!u8 || (u8[0] !== 1 && u8[0] !== 2)) return null;
  const v2 = u8[0] === 2, hasE = u8[1] === 1, pts = []; let i = 2;
  const get = () => { let v = 0, f = 1, b; do { b = u8[i++]; v += (b & 127) * f; f *= 128; } while (b & 128 && i < u8.length); return v & 1 ? -(v + 1) / 2 : v / 2; };
  const count = v2 ? get() : Infinity;
  let a = 0, o = 0, e = 0;
  while (i < u8.length && pts.length < count) { a += get(); o += get(); if (hasE) e += get(); pts.push({ lat: a / 1e5, lon: o / 1e5, ele: hasE ? e : null }); }
  let desc = '', wpts = [];
  if (v2 && i < u8.length) try {
    const J = JSON.parse(new TextDecoder().decode(u8.subarray(i))), ks = Object.keys(NOTE_KINDS), s = (x, n) => String(x || '').slice(0, n);
    desc = s(J.d, NOTE_DESC_MAX);
    wpts = (Array.isArray(J.w) ? J.w : []).slice(0, NOTE_MAX).map(w => ({ lat: +w[0] / 1e5, lon: +w[1] / 1e5, kind: ks[w[2]] || 'info', name: s(w[3], 120), desc: s(w[4], 300) }))
      .filter(w => isFinite(w.lat) && isFinite(w.lon) && Math.abs(w.lat) <= 90 && w.name);
  } catch { /* notes illisibles : le tracé seul */ }
  let name = ''; try { name = decodeURIComponent(m[3] || ''); } catch {}
  return pts.length > 1 ? { name: name || 'Parcours partagé', pts, desc, wpts } : null;
}
function copyText(t) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t); return true; } } catch {}
  const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); return ok;
}
$('wtLink').onclick = async () => {
  if (!wtSrc) return;
  const p = makePath(wtSrc.pts, ''), url = await routeLink(wtSrc.name, wtSrc.pts, wtNotes());
  const info = `${wtSrc.name || 'Parcours'} · ${fmtDist(p.total)}${p.hasEle ? ' · D+ ' + fmtM(p.totalUp) : ''}${wtSrc.sub ? ' · ' + wtSrc.sub : ''}`;
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
  loadText(loopGPX(r.pts, r.name, { desc: r.desc, wpts: r.wpts }), false);
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
  $('finDelete').textContent = tr('Ne pas garder cette sortie'); $('finDelete').dataset.armed = '';
  $('finContinue').textContent = tr(nav ? 'Reprendre la navigation' : 'Continuer la sortie'); $('finExport').hidden = true;
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
      setTimeout(() => gdAuto(true), 4000); // sauvegarde Drive automatique, si activée
    } catch {
      // on ne perd rien : la sortie reste en cours (en pause) et peut être exportée
      if (actState === 'on') { act.since = Date.now(); }
      btn.disabled = false; btn.textContent = tr('✓ Enregistrer la sortie'); $('finExport').hidden = false; // repli : exporter
      $('finMsg').textContent = 'Impossible de ranger la sortie : un autre onglet de Pisteo est ouvert. Ferme les autres onglets puis réessaie, ou touche « Exporter le GPX ».';
      $('finMsg').hidden = false;
      return;
    }
    btn.disabled = false; btn.textContent = tr('✓ Enregistrer la sortie');
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
  { id: 'de', nat: 'de', name: 'Allemagne', file: 'regions/de.json' }, // Länder (TopPlusOpen, BKG ; remis le 26 oct.)
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
  if (pack.bbox) poiPrefetch(pack.bbox); // points utiles de la zone, pour les avoir hors ligne
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
      setTimeout(() => map.fitBounds([[w, s], [e, n]], { padding: { top: 90, bottom: sheetPad() + 20, left: 30, right: 76 }, bearing: 0, pitch: 0, duration: 700 }), 60);
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
// grosses demandes (réseau de chemins, localités) : serveur principal, puis les miroirs s'il refuse
// (il rejette les demandes coûteuses quand il est plein : 502 « at capacity », 504, 429)
async function overpass(q, tries = 2, onWait) {
  let last;
  const one = async (url, ms) => {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
      if (r.ok) return await r.json();
      last = new Error(r.status === 429 || r.status === 502 || r.status === 504 ? 'serveurs OpenStreetMap saturés, réessaie dans quelques minutes' : 'erreur ' + r.status);
    } catch (e) { last = e.name === 'AbortError' ? new Error('délai dépassé') : navigator.onLine === false ? new Error('pas de connexion') : new Error('serveurs OpenStreetMap injoignables'); }
    finally { clearTimeout(timer); }
    return null;
  };
  for (let t = 0; t < tries; t++) {
    await overpassWait(onWait);
    let j = await one(OVERPASS, 190000);
    for (const m of OVERPASS_MIRRORS) { if (j || navigator.onLine === false) break; j = await one(m, 190000); }
    if (j) return j;
    if (navigator.onLine === false) break;
    // tous saturés : on patiente de plus en plus longtemps avant de réessayer
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
const ONB_N = () => $('onb').querySelectorAll('.onb-s').length;
function onbShow(i) {
  onbI = i;
  $('onb').querySelectorAll('.onb-s').forEach((x, k) => x.classList.toggle('on', k === i));
  $('onb').querySelectorAll('.onb-dots i').forEach((x, k) => x.classList.toggle('on', k === i));
  const last = i === ONB_N() - 1;
  $('onbNext').hidden = last; $('onbSkip').textContent = last ? 'Explorer la carte' : 'Passer';
  $('onbFoot').classList.toggle('on', profile !== 'trekking'); $('onbBike').classList.toggle('on', profile === 'trekking');
}
function onbClose(how) { $('onb').hidden = true; store.set('onb', '1'); try { stat('onb_' + how); } catch {} }
$('onbNext').onclick = () => onbShow(onbI + 1);
$('onbSkip').onclick = () => onbClose(onbI === ONB_N() - 1 ? 'carte' : 'passer_' + onbI);
const onbMode = p => { setProfile(p, true); try { stat(p === 'trekking' ? 'onb_velo' : 'onb_pied'); } catch {} onbShow(2); };
$('onbFoot').onclick = () => onbMode('hiking-mountain');
$('onbBike').onclick = () => onbMode('trekking');
// première action : directement dans la bonne fenêtre (la position est demandée à ce moment-là)
$('onbLoop').onclick = () => { onbClose('boucle'); openLoop(); };
$('onbRoutes').onclick = () => { onbClose('balises'); rtShowOnMap(); };
$('onbGpx').onclick = () => { onbClose('gpx'); openLib(); };
// glisser à gauche / à droite pour changer d'écran
(() => { let x0 = null;
  $('onb').addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  $('onb').addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (dx < -50 && onbI < ONB_N() - 1) onbShow(onbI + 1); else if (dx > 50 && onbI > 0) onbShow(onbI - 1); });
})();
// petite fenêtre au centre (même style que l'accueil) : titre, texte, boutons [texte, classe, action]
function askCard(title, text, btns) {
  let el = document.getElementById('askCard');
  if (!el) { el = document.createElement('div'); el.id = 'askCard'; el.className = 'onb'; el.setAttribute('role', 'dialog'); document.body.appendChild(el); }
  el.innerHTML = '<div class="onb-card"><div class="onb-s on ask"><h2></h2><p></p></div><div class="onb-acts"></div></div>';
  el.querySelector('h2').textContent = title; el.querySelector('p').textContent = text;
  const acts = el.querySelector('.onb-acts');
  for (const [l, cls, run] of btns) { const b = document.createElement('button'); b.className = 'btn ' + (cls || ''); b.textContent = l; b.onclick = () => { el.hidden = true; if (run) run(); }; acts.appendChild(b); }
  el.hidden = false;
}
// ---------- demande d'avis : une seule fois, après une sortie gardée ----------
// oui → note Play Store (fenêtre Google dans l'appli 2.5.0, sinon la fiche) ; non → « Mon avis »
const PLAY_URL = 'https://play.google.com/store/apps/details?id=fr.pisteo.app';
function askReview() {
  if (store.get('avisAsk') || !(AND || PLAY_PUBLIC)) return;
  const ac = document.getElementById('askCard'); if (!$('onb').hidden || (ac && !ac.hidden)) return;
  store.set('avisAsk', '1'); try { stat('avis_demande'); } catch {}
  askCard('Ça t\'a plu ?', 'Sortie enregistrée, bravo ! Pisteo t\'a été utile ?', [
    ['Pas vraiment', 'ghost', () => { try { stat('avis_non'); } catch {}
      askCard('Pas vraiment', 'Dis-nous ce qui t\'a gêné : on lit tous les messages.', [['Non merci', 'ghost'], ['Donner mon avis', 'go', () => $('btnFeedback').click()]]); }],
    ['Oui, j\'ai aimé', 'go', () => { try { stat('avis_oui'); } catch {}
      askCard('Ça t\'a plu ?', 'Merci ! Une note sur le Play Store aide beaucoup Pisteo à se faire connaître.', [['Plus tard', 'ghost'], ['Noter Pisteo', 'go', () => {
        try { stat('avis_note'); } catch {}
        if (AND && AND.askReview) { try { AND.askReview(); return; } catch {} }
        if (AND && AND.openExternal) { try { AND.openExternal(PLAY_URL); return; } catch {} }
        window.open(PLAY_URL, '_blank');
      }]]); }]
  ]);
}
endActivity = (fn => async function (keep) {
  let ok = false; try { ok = keep && rec.length > 1 && recDist() > 500; } catch {}
  const r = await fn.apply(this, arguments);
  if (ok) setTimeout(askReview, 2500);
  return r;
})(endActivity);
// ---------- Réglages : noter Pisteo (appli Android) et partager Pisteo ----------
function openPlayReview() {
  try { stat('avis_reglages'); } catch {}
  if (AND && AND.askReview) { try { AND.askReview(); return; } catch {} }
  if (AND && AND.openExternal) { try { AND.openExternal(PLAY_URL); return; } catch {} }
  window.open(PLAY_URL, '_blank');
}
$('btnRate').hidden = !(AND || PLAY_PUBLIC);
$('btnRate').onclick = openPlayReview;
$('btnShareApp').onclick = async () => {
  try { stat('partage_appli'); } catch {}
  // tant que l'appli n'est pas publique, le lien Play Store ne marche que pour les testeurs : on partage le site
  const url = PLAY_PUBLIC ? PLAY_URL : 'https://pisteo.app';
  const title = 'Pisteo';
  const msg = tr('Pisteo : suis ta trace GPX à pied ou à vélo, avec alerte hors trace et cartes hors ligne.');
  if (AND && AND.shareText) { try { AND.shareText(msg + ' ' + url, title); return; } catch {} }
  if (navigator.share) { try { await navigator.share({ title, text: msg, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  toast(copyText(msg + ' ' + url) ? 'Lien copié : colle-le dans un message.' : url, 4000);
};
// ---------- avant de partir : batterie basse, économie d'énergie d'Android ----------
async function battCheck() {
  try {
    if (AND && AND.powerSave && AND.powerSave()) {
      if (store.get('battSaverWarn') !== new Date().toDateString()) {
        store.set('battSaverWarn', new Date().toDateString()); stat('alerte_economie');
        toast(tr('Économie d\'énergie Android activée : le GPS peut être coupé écran éteint. Désactive-la pour la sortie.'), 9000,
          AND.openBatterySettings ? { label: tr('Réglages batterie'), run: () => { try { AND.openBatterySettings(); } catch {} } } : undefined);
        return;
      }
    }
    const b = navigator.getBattery ? await navigator.getBattery() : null;
    if (!b || b.charging || b.level > 0.3) return;
    const key = new Date().toDateString() + Math.round(b.level * 10);
    if (store.get('battLowWarn') === key) return;
    store.set('battLowWarn', key); stat('alerte_batterie');
    toast(`${tr('Batterie à')} ${Math.round(b.level * 100)} % · ${tr('Recharge si tu peux avant de partir, ou active l\'économie de batterie pendant la navigation.')}`, 9000);
  } catch {}
}
startNav = (fn => async function () { setTimeout(battCheck, 1500); return fn.apply(this, arguments); })(startNav);
startActivity = (fn => function () { if (!nav) setTimeout(battCheck, 1500); return fn.apply(this, arguments); })(startActivity);
(async () => {
  if (store.get('onb') === '1' || /[?&]shared=1/.test(location.search)) return;
  const had = (await listRecent()).length > 0 || store.get('gpx');
  if (had) { store.set('onb', '1'); return; }
  onbShow(0); $('onb').hidden = false; try { stat('onb_vu'); } catch {}
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
  if (isSide()) { applyMore(want); return; } // grand écran : le panneau a toute la hauteur, pas d'animation
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
    if (!(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)) continue;
    // seulement si rien n'est par-dessus (une fenêtre ouverte au même endroit, ex. Strava sur « Indications »)
    const top = document.elementFromPoint(e.clientX, e.clientY);
    if (!top || !(sel === top || sel.parentElement.contains(top))) continue;
    e.preventDefault(); e.stopPropagation(); openPicker(sel); return;
  }
}, true);

attachSwipe($('sheet'), moreMotion());

// Fenêtres du bas (Mes cartes, Mes traces, Sauvegarde…) : glisser vers le bas pour fermer, quand la liste est tout en haut
function closeSheetPanel(lib) {
  const btn = [...lib.querySelectorAll('.closebtn[id*="Close"]')].find(b => b.offsetParent);
  if (btn) btn.click(); else lib.hidden = true;
}
document.querySelectorAll('.lib').forEach(lib => {
  const panel = lib.querySelector('.lib-panel'); if (!panel || lib.id === 'routes') return; // parcours balisés : geste à part (réduire, pas fermer)
  let x0 = null, y0 = 0, dy = 0, decided = false, swiping = false, top0 = 0, lastY = 0, lastT = 0, vy = 0;
  const set = (v, anim) => { panel.style.transition = anim ? 'transform .22s ease-out' : ''; panel.style.transform = v ? `translateY(${v}px)` : ''; };
  panel.addEventListener('touchstart', e => {
    if (e.touches.length > 1 || e.target.closest('select, textarea, input[type=search], input[type=text], input[type=range], canvas')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = lastY = e.touches[0].clientY; lastT = performance.now(); dy = vy = 0; decided = swiping = false; top0 = panel.scrollTop;
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (x0 == null) return;
    if (libDrag.li) { x0 = null; return; } // une trace de « Mes traces » est tenue (appui long) : ce n'est pas la fenêtre qu'on tire
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
const VERSION = APP_VERSION + ' · 25 oct. 2026';
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
  let backAt = 0;
  window.pisteoBack = () => {
    const open = [...document.querySelectorAll('.lib')].filter(x => !x.hidden);
    if (open.length) { open[open.length - 1].hidden = true; return true; }
    if (!$('more').hidden) { toggleMore(false); return true; }
    if (prepBack && track && !nav) { prepOpen(); return true; }
    // rien d'ouvert : un 1er appui prévient, un 2e dans les 2,5 s met l'appli en arrière-plan (évite les sorties par erreur)
    if (Date.now() - backAt > 2500) {
      backAt = Date.now();
      toast(nav || recording ? 'Appuie encore sur Retour pour réduire Pisteo (le suivi continue)' : 'Appuie encore sur Retour pour quitter Pisteo', 2500);
      return true;
    }
    backAt = 0; $('toast').hidden = true;
    return false;
  };
  window.pisteoCheckShared = checkShared;
}
window.__balise = { onPos, get state() { return { nav, isOff, rejoin: !!rejoin, straight: rejoin && rejoin.straight, progress, act: Object.assign({ elapsed: actElapsed(), state: actState, points: rec.length }, act) }; } };

// =====================================================================
// Soleil, météo le long du parcours, retour au départ, bilan des sorties
// =====================================================================
const hm = t => new Date(t).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
const escH = s => String(s).replace(/[<&>"]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));
// lever et coucher du soleil (équation du lever du soleil, précision ~1 min), sans réseau
function sunTimes(t, lat, lon) {
  const r = Math.PI / 180, d = new Date(t);
  const n = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12) / 864e5 + 2440587.5 - 2451545);
  const Js = n - lon / 360, M = (357.5291 + 0.98560028 * Js) % 360;
  const C = 1.9148 * Math.sin(M * r) + 0.02 * Math.sin(2 * M * r) + 0.0003 * Math.sin(3 * M * r);
  const L = (M + C + 180 + 102.9372) % 360, Jt = 2451545 + Js + 0.0053 * Math.sin(M * r) - 0.0069 * Math.sin(2 * L * r);
  const dec = Math.asin(Math.sin(L * r) * Math.sin(23.4397 * r));
  const cw = (Math.sin(-0.833 * r) - Math.sin(lat * r) * Math.sin(dec)) / (Math.cos(lat * r) * Math.cos(dec));
  if (cw < -1 || cw > 1) return null; // jour ou nuit polaire
  const w = Math.acos(cw) / r / 360, ms = j => (j - 2440587.5) * 864e5;
  return { rise: ms(Jt - w), set: ms(Jt + w) };
}
// temps estimé jusqu'à un point de la trace : allure de base (marche ou vélo + dénivelé),
// corrigée en navigation par le temps restant réel (qui tient compte de ta vitesse)
function baseSecs(x, y) {
  const s = lpSpeed(), u = z => track.totalUp - infoAt(z).upLeft;
  return Math.max(0, y - x) / (s.v / 3.6) + (track.hasEle ? Math.max(0, u(y) - u(x)) / s.climb * 3600 : 0);
}
// heure de départ choisie (météo à l'avance) : seulement hors navigation, pour cette trace, et tant qu'elle est à venir
function depAt() { return wxDep && !nav && track && wxDep.key === trKey() && wxDep.t > Date.now() ? wxDep.t : null; }
function etaAlong(d) {
  const dep = depAt(); if (dep) return dep + baseSecs(0, Math.max(0, d)) * 1000;
  const a = (doneInfo() || {}).along || 0;
  let k = 1;
  if (nav) { const ri = remainingInfo(), b = baseSecs(a, track.total); if (ri && b > 60) k = ri.secs / b; }
  return Date.now() + k * baseSecs(a, Math.max(a, d)) * 1000;
}
function sunInfo() {
  if (!track || !track.pts.length) return null;
  const end = track.pts[track.pts.length - 1], arr = etaAlong(track.total), st = sunTimes(arr, end.lat, end.lon);
  return st ? { arr, set: st.set, margin: (st.set - arr) / 60000 } : null;
}
// pastille « coucher du soleil » : seulement s'il fait jour et que la marge est courte (moins d'une heure)
function trChipsUpdate() {
  const show = !!track && track.hasEle && !nav;
  $('btnWx').hidden = !show;
  // seulement si « Prévenir avant la nuit » est activé, et si l'arrivée frôle ou dépasse le coucher du soleil
  const si = show && store.get('alertNight') === '1' ? sunInfo() : null, el = $('sunChip');
  const warn = !!si && Date.now() < si.set && si.margin < 15;
  $('trChips').hidden = !warn;
  if (!show) { document.body.classList.remove('wx-on'); wxMap(); return; }
  if (warn) el.innerHTML = si.margin >= 0
    ? `🌙 <span>${tr('Coucher du soleil')}</span> ${hm(si.set)} · <span>${tr('arrivée vers')}</span> ${hm(si.arr)}`
    : `🌙 <span>${tr('Arrivée vers')}</span> ${hm(si.arr)}, <span>${tr('après le coucher du soleil')}</span> (${hm(si.set)})`;
  $('btnWx').classList.toggle('on', wxShown()); document.body.classList.toggle('wx-on', wxOnProf()); wxMap(); depUI();
}
setInterval(() => { if (track && !nav) trChipsUpdate(); }, 60000);

// ---------- météo le long du parcours (Open-Meteo, gratuit, sans clé) : à la demande ----------
var wxOn = false, meteo = null, wxDep = null; // meteo = { key, at, marks: [{ d, ic, val, t }], rain: [[d0, d1]] } · wxDep = { key, t }
function trKey() { return track ? track.name + '|' + Math.round(track.total) : ''; }
function wxKey() { return track ? trKey() + '|' + (depAt() || 0) : ''; }
function wxShown() { return !!(wxOn && meteo && track && meteo.key === wxKey()); }
// météo sur le profil (bande, étiquettes, températures) ; sur la carte : le vent
function wxOnProf() { return wxShown(); }
const wxCat = c => c <= 1 ? 0 : c <= 3 ? 1 : c <= 48 ? 2 : (c <= 67 || (c >= 80 && c <= 82)) ? 3 : c <= 86 ? 4 : 5;
const wxIcon = c => c <= 1 ? '☀️' : c === 2 ? '⛅' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 57 ? '🌦️' : (c <= 67 || (c >= 80 && c <= 82)) ? '🌧️' : c <= 86 ? '🌨️' : '⛈️';
async function loadWx() {
  const a = depAt() ? 0 : (doneInfo() || {}).along || 0, N = 10, pts = [];
  for (let k = 0; k <= N; k++) { const d = a + (track.total - a) * k / N, q = pointAt(track, d); pts.push({ d, lat: q.lat, lon: q.lon, t: etaAlong(d) }); }
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + pts.map(p => p.lat.toFixed(3)).join(',') + '&longitude=' + pts.map(p => p.lon.toFixed(3)).join(',')
    + '&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,is_day&forecast_days=4&timeformat=unixtime&timezone=GMT';
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
  let js;
  try { const r = await fetch(url, { signal: ctrl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); js = await r.json(); }
  catch (e) { clearTimeout(timer); js = await wxMet(pts).catch(() => { throw e; }); } // secours : MET Norway
  finally { clearTimeout(timer); }
  wxBuild(pts, Array.isArray(js) ? js : [js], a);
}
// Secours météo : MET Norway (yr.no, gratuit, sans clé, un point par demande), mis au format Open-Meteo
const MET_CODE = { clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45, lightrain: 61, rain: 63, heavyrain: 65, lightrainshowers: 80, rainshowers: 81, heavyrainshowers: 82,
  lightsleet: 66, sleet: 67, heavysleet: 67, lightsleetshowers: 85, sleetshowers: 85, heavysleetshowers: 86, lightsnow: 71, snow: 73, heavysnow: 75, lightsnowshowers: 85, snowshowers: 85, heavysnowshowers: 86 };
async function wxMet(pts) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    return await Promise.all(pts.map(async p => {
      const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${p.lat.toFixed(3)}&lon=${p.lon.toFixed(3)}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const h = { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [], wind_speed_10m: [], wind_direction_10m: [], is_day: [] };
      for (const ts of ((await r.json()).properties || {}).timeseries || []) {
        const d = ts.data.instant.details, n1 = ts.data.next_1_hours || ts.data.next_6_hours; if (!n1) continue;
        const sym = n1.summary.symbol_code || '', base = sym.split('_')[0], mm = (n1.details || {}).precipitation_amount || 0;
        h.time.push(Date.parse(ts.time) / 1000); h.temperature_2m.push(d.air_temperature);
        h.precipitation_probability.push(mm >= 0.5 ? 80 : mm > 0 ? 45 : 5);
        h.weather_code.push(/thunder/.test(base) ? 95 : MET_CODE[base] != null ? MET_CODE[base] : 3);
        h.wind_speed_10m.push((d.wind_speed || 0) * 3.6); h.wind_direction_10m.push(d.wind_from_direction);
        h.is_day.push(/_night|_polartwilight/.test(sym) ? 0 : 1);
      }
      return { hourly: h };
    }));
  } finally { clearTimeout(timer); }
}
// prévisions heure par heure aux points du parcours → étiquettes aux changements de temps + bandes de pluie
function wxBuild(pts, js, a) {
  const S = [];
  pts.forEach((p, i) => {
    const h = js[i] && js[i].hourly; if (!h) return;
    let j = -1, best = Infinity; h.time.forEach((tt, k) => { const df = Math.abs(tt * 1000 - p.t); if (df < best) { best = df; j = k; } });
    if (j < 0 || best > 2 * 3600e3) return; // trop loin dans le temps pour la prévision
    S.push({ d: p.d, t: p.t, temp: h.temperature_2m[j], prob: h.precipitation_probability[j] || 0, code: h.weather_code[j], wind: h.wind_speed_10m[j] || 0, wdir: h.wind_direction_10m ? h.wind_direction_10m[j] : null, day: !h.is_day || h.is_day[j] !== 0 });
  });
  if (S.length < 2) throw new Error('far');
  const wet = s => s.prob >= 40 || (wxCat(s.code) >= 3 && s.prob >= 25), windy = s => s.wind >= 40;
  // on ne garde que le départ, l'arrivée et les moments où le temps change vraiment
  let marks = [], last = null;
  S.forEach((s, i) => {
    if (!last || i === S.length - 1 || wxCat(s.code) !== wxCat(last.code) || wet(s) !== wet(last) || Math.abs(s.temp - last.temp) >= 4 || windy(s) !== windy(last)) { marks.push(s); last = s; }
  });
  // assez d'écart entre deux étiquettes pour rester lisibles (au moins 18 % du parcours affiché)
  const span = track.total - a, keep = [marks[0]];
  for (let k = 1; k < marks.length; k++) {
    const m = marks[k], prev = keep[keep.length - 1];
    if (m.d - prev.d >= span * 0.18) keep.push(m);
    else if (k === marks.length - 1) { if (keep.length > 1) keep[keep.length - 1] = m; else keep.push(m); }
  }
  marks = keep.slice(0, 5);
  const step = span / (pts.length - 1), rain = [];
  let r0 = null;
  S.forEach((s, i) => {
    if (wet(s) && r0 == null) r0 = i;
    if (r0 != null && (!wet(s) || i === S.length - 1)) { const i1 = wet(s) ? i : i - 1; rain.push([Math.max(a, S[r0].d - step / 2), Math.min(track.total, S[i1].d + step / 2)]); r0 = null; }
  });
  // bande « ciel » : une couleur par portion (soleil, nuages, pluie, neige, orage), entre deux points de prévision
  const skyOf = s => wet(s) ? (wxCat(s.code) === 4 ? 'snow' : wxCat(s.code) === 5 ? 'storm' : 'rain') : wxCat(s.code) === 0 ? (s.day ? 'sun' : 'night') : 'cloud';
  const sky = S.map((s, i) => [i ? (S[i - 1].d + s.d) / 2 : s.d, i < S.length - 1 ? (s.d + S[i + 1].d) / 2 : s.d, skyOf(s)]);
  meteo = { key: wxKey(), at: Date.now(), rain, sky, samples: S.map(s => ({ d: s.d, t: s.t, wind: s.wind, wdir: s.wdir, temp: s.temp, prob: s.prob, code: s.code, day: s.day, wet: wet(s) })),
    marks: marks.map(s => ({ d: s.d, t: s.t, ic: windy(s) && !wet(s) ? '💨' : !s.day && s.code <= 2 ? '🌙' : wxIcon(s.code),
      val: wet(s) ? s.prob + ' %' : windy(s) ? Math.round(s.wind * (IMP ? 0.621 : 1)) + (IMP ? ' mph' : ' km/h') : Math.round(IMP ? s.temp * 9 / 5 + 32 : s.temp) + '°' })) };
}
// vent : sens de marche à chaque point de prévision → face / travers / dos (fort à partir de 20 km/h)
// échelle du vent selon le mode (vitesses de la prévision, à 10 m) : gris, vert, jaune, orange, rouge
// « vent de face » signalé dès le jaune : 20 km/h à vélo, 30 km/h à pied
const WINDC = { face: '#e04848' }, WIND_COLS = ['#8a959e', '#3fae6a', '#e8c228', '#f08a24', '#e04848'];
const windScale = () => profile === 'trekking' ? [10, 20, 30, 45] : [15, 30, 45, 60];
const windMin = () => windScale()[1];
const windCol = v => { const s = windScale(); let k = 0; while (k < s.length && v >= s[k]) k++; return WIND_COLS[k]; }; // couleur = force
function bearingAt(d) {
  const a = pointAt(track, Math.max(0, d - 60)), b = pointAt(track, Math.min(track.total, d + 60)), r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function wxWind() {
  const S = (meteo && meteo.samples || []).filter(s => s.wdir != null);
  if (!S.length) return null;
  const pts = S.map(s => { const diff = Math.abs(((s.wdir - bearingAt(s.d)) + 540) % 360 - 180);
    return { d: s.d, wind: s.wind, wdir: s.wdir, strong: s.wind >= windMin(), k: s.wind < 5 ? 'calm' : diff < 60 ? 'face' : diff > 120 ? 'back' : 'side' }; });
  // portions vent de face (entre deux points de prévision)
  const face = []; pts.forEach((q, i) => { if (q.k !== 'face' || !q.strong) return; const d0 = i ? (pts[i - 1].d + q.d) / 2 : q.d, d1 = i < pts.length - 1 ? (q.d + pts[i + 1].d) / 2 : q.d;
    const last = face[face.length - 1]; if (last && d0 - last[1] < 1) { last[1] = d1; last[2] = Math.max(last[2], q.wind); } else face.push([d0, d1, q.wind]); });
  return { pts, face };
}
const SKY = { sun: '#f2c94c', night: '#5c6b86', cloud: '#aab3bc', rain: '#2f80ed', snow: '#9fd3ff', storm: '#7b5cd6' };
function wxBands(ctx, X, top, h) {
  // fine bande colorée sous le profil : jaune soleil, gris nuages, bleu pluie
  ctx.save();
  for (const [d0, d1, k] of meteo.sky || []) { ctx.fillStyle = SKY[k]; ctx.fillRect(Math.floor(X(d0)), top + h + 2, Math.ceil(X(d1)) - Math.floor(X(d0)) + 1, 5); }
  ctx.restore();
}
// courbe des températures (pointillés rouges), avec le maximum et le minimum
function wxTemps(ctx, X, top, h, L0, W) {
  const S = meteo.samples || []; if (S.length < 2) return;
  let t0 = Infinity, t1 = -Infinity; S.forEach(s => { t0 = Math.min(t0, s.temp); t1 = Math.max(t1, s.temp); });
  const mid = (t0 + t1) / 2, half = Math.max(5, (t1 - t0) / 2 + 1.5), Y = t => top + h * .08 + (1 - (t - (mid - half)) / (2 * half)) * h * .84;
  ctx.save(); ctx.strokeStyle = '#e04848'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath();
  S.forEach((s, i) => i ? ctx.lineTo(X(s.d), Y(s.temp)) : ctx.moveTo(X(s.d), Y(s.temp))); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#e04848'; ctx.font = '600 10px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  const deg = t => Math.round(IMP ? t * 9 / 5 + 32 : t) + '°';
  const hi = S.reduce((b, s) => s.temp > b.temp ? s : b), lo = S.reduce((b, s) => s.temp < b.temp ? s : b);
  const lab = (s, dy) => { const x = X(s.d); ctx.textAlign = x > W - 30 ? 'right' : x < L0 + 20 ? 'left' : 'center'; ctx.fillText(deg(s.temp), clamp(x, L0 + 2, W - 2), Y(s.temp) + dy); };
  lab(hi, -9); if (Math.round(hi.temp) !== Math.round(lo.temp)) lab(lo, 10);
  ctx.restore();
}
function wxWindProf(ctx, X, top, h) {
  const wi = wxWind(); if (!wi || !wi.face.length) return;
  ctx.save(); ctx.fillStyle = WINDC.face;
  for (const [d0, d1] of wi.face) ctx.fillRect(Math.floor(X(d0)), top + h + 9, Math.max(3, Math.ceil(X(d1) - X(d0))), 3);
  const big = wi.face.reduce((b, f) => f[1] - f[0] > b[1] - b[0] ? f : b);
  ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const txt = '💨 ' + tr('vent de face') + ' ' + Math.round(big[2] * (IMP ? 0.621 : 1)) + (IMP ? ' mph' : ' km/h'), tw = ctx.measureText(txt).width;
  ctx.fillText(txt, clamp(X((big[0] + big[1]) / 2), X(0) + tw / 2, X(track.total) - tw / 2), top + h - 5);
  ctx.restore();
}
function wxMarks(ctx, X, L0, W, noFirstTime) {
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  for (const m of meteo.marks) {
    const x = clamp(X(m.d), L0 + 14, W - 18);
    ctx.font = '16px system-ui, sans-serif'; ctx.fillText(m.ic, x, 17);
    ctx.font = '700 11px system-ui, sans-serif'; ctx.fillStyle = cssVar('--ink'); ctx.fillText(m.val, x, 30);
    ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = cssVar('--muted'); if (!(noFirstTime && m === meteo.marks[0])) ctx.fillText(hm(m.t), x, 42);
  }
  ctx.restore();
}
async function toggleWx() {
  if (!track) return;
  if (wxShown()) { wxOn = false; }
  else {
    wxOn = true;
    if (!meteo || meteo.key !== wxKey() || Date.now() - meteo.at > 30 * 60000) {
      $('btnWx').classList.add('busy'); $('npWx').classList.add('busy');
      try { await loadWx(); }
      catch (e) { wxOn = false; toast(e.message === 'far' ? 'Météo : le parcours est trop loin dans le temps pour la prévision.' : navigator.onLine === false ? 'Météo : pas de réseau pour l\'instant.' : 'Météo indisponible pour l\'instant, réessaie dans un moment.', 4000); }
      $('btnWx').classList.remove('busy'); $('npWx').classList.remove('busy');
    }
  }
  wxApply();
}
// portion pluvieuse du tracé, en bleu sur la carte
var wxPins = [];
// sur la carte : flèches de vent le long du tracé (quand il souffle)
function wxMap() {
  (wxPins || []).forEach(m => m.remove()); wxPins = [];
  const wi = wxShown() ? wxWind() : null;
  if (wi) wi.pts.forEach((q, i) => {
    if (!i || i === wi.pts.length - 1) return; // pas sur le départ ni l'arrivée
    const p = pointAt(track, q.d), el = document.createElement('div'); el.className = 'wind-arrow'; el.style.background = windCol(q.wind);
    el.innerHTML = `<svg viewBox="0 0 24 24" style="transform:rotate(${q.wdir + 180}deg)"><path d="M12 20V4M6 10l6-6 6 6"/></svg>`;
    el.onclick = e => { e.stopPropagation(); toast(`💨 ${Math.round(q.wind * (IMP ? 0.621 : 1))} ${IMP ? 'mph' : 'km/h'} · ${tr({ face: 'vent de face', side: 'vent de travers', back: 'vent dans le dos', calm: 'vent faible' }[q.k])}`, 2500); };
    wxPins.push(new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map));
  });
}
function wxApply() {
  const on = wxShown(); wxMap(); depUI();
  document.body.classList.toggle('wx-on', wxOnProf());
  $('btnWx').classList.toggle('on', on); $('npWx').classList.toggle('on', on);
  drawProfile(); if (!$('navMore').hidden) drawProfileOn($('navProfile'));
}
$('btnWx').onclick = toggleWx;
$('npWx').onclick = toggleWx;
// ---------- heure de départ (météo à l'avance) ----------
function depLabel() {
  const t = depAt(); if (!t) return tr('maintenant');
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const k = Math.round((new Date(t).setHours(0, 0, 0, 0) - today) / 864e5);
  return (k === 0 ? tr('aujourd\'hui') : k === 1 ? tr('demain') : d.toLocaleDateString(LOC, { weekday: 'long' })) + ' ' + hm(t);
}
// bouton horloge (à côté de la météo) = heure de départ ; « i » en bas à gauche du profil = légende
function depUI() {
  const on = wxShown() && !nav, b = $('wxDepBtn');
  $('wxInfo').hidden = !on;
  b.hidden = !on; b.classList.toggle('on', !!depAt()); // vert : départ choisi à l'avance
}
function depDay(t) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const k = Math.round((new Date(t).setHours(0, 0, 0, 0) - today) / 864e5);
  return k === 1 ? tr('demain') : new Date(t).toLocaleDateString(LOC, { weekday: 'short' });
}
let depPick = null;
function depOpen() {
  const now = new Date(), opts = [['now', tr('Maintenant')], [Date.now() + 3600e3, tr('Dans 1 h')]];
  const at = (k, h) => { const d = new Date(); d.setDate(d.getDate() + k); d.setHours(h, 0, 0, 0); return +d; };
  if (now.getHours() < 17) opts.push([at(0, 18), tr('Ce soir') + ' 18:00']);
  opts.push([at(1, 8), tr('Demain') + ' 8:00']);
  $('depOpts').innerHTML = opts.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('');
  $('depDay').innerHTML = [0, 1, 2].map(k => { const d = new Date(); d.setDate(d.getDate() + k); return `<option value="${k}">${k === 0 ? tr('Aujourd\'hui') : k === 1 ? tr('Demain') : d.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'short' })}</option>`; }).join('');
  depSet(depAt() || 'now'); $('depSheet').hidden = false;
}
function depSet(v) {
  depPick = v === 'now' ? null : +v;
  const t = depPick ? new Date(depPick) : new Date(), today = new Date(); today.setHours(0, 0, 0, 0);
  $('depDay').value = String(clamp(Math.round((new Date(+t).setHours(0, 0, 0, 0) - today) / 864e5), 0, 2));
  $('depTime').value = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  $('depOpts').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v === 'now' ? 'now' : depPick)));
}
function depFromFields() {
  const [h, m] = ($('depTime').value || '08:00').split(':').map(Number), d = new Date(); d.setDate(d.getDate() + +$('depDay').value); d.setHours(h, m || 0, 0, 0);
  depPick = +d; $('depOpts').querySelectorAll('button').forEach(b => b.classList.remove('on'));
}
$('depOpts').onclick = e => { const b = e.target.closest('button'); if (b) depSet(b.dataset.v); };
$('depDay').onchange = depFromFields; $('depTime').onchange = depFromFields;
$('depClose').onclick = () => { $('depSheet').hidden = true; };
$('depSheet').onclick = e => { if (e.target === $('depSheet')) $('depSheet').hidden = true; };
$('depOk').onclick = async () => {
  $('depSheet').hidden = true;
  wxDep = depPick && depPick > Date.now() + 60e3 ? { key: trKey(), t: depPick } : null;
  wxOn = false; await toggleWx(); trChipsUpdate(); updateStats();
  if (wxShown()) toast('🕗 ' + tr('Départ') + ' ' + depLabel(), 2500);
};
$('wxDepBtn').onclick = depOpen;
$('wxInfo').onclick = () => {
  // échelle du vent du mode choisi (à pied / à vélo)
  const sc = windScale(), lab = [tr('Moins de') + ' ' + sc[0] + ' km/h'].concat(sc.slice(1).map((v, i) => sc[i] + ' ' + tr('à') + ' ' + v + ' km/h'), [tr('Plus de') + ' ' + sc[3] + ' km/h']);
  $('legWind').innerHTML = lab.map((l, i) => `<span><i class="ar" style="background:${WIND_COLS[i]}"></i>${l}</span>`).join('');
  $('legWindH').textContent = tr('Vent sur la carte') + ' · ' + tr(profile === 'trekking' ? 'à vélo' : 'à pied');
  $('legFace').textContent = tr('Vent de face') + ' (≥ ' + sc[1] + ' km/h)';
  $('wxLegSheet').hidden = false;
};
$('wxLegClose').onclick = () => { $('wxLegSheet').hidden = true; };
$('wxLegSheet').onclick = e => { if (e.target === $('wxLegSheet')) $('wxLegSheet').hidden = true; };
window.addEventListener('resize', () => { if (wxShown()) depUI(); });

// ---------- prévenir avant la nuit (réglage, désactivé par défaut) ----------
$('alertNight').checked = store.get('alertNight') === '1';
$('alertNight').onchange = e => { store.set('alertNight', e.target.checked ? '1' : '0'); trChipsUpdate(); };
var nightSaid = 0;
function nightCheck(info) {
  if (store.get('alertNight') !== '1' || !track || !track.pts.length) return;
  const end = track.pts[track.pts.length - 1], now = Date.now(), arr = now + info.secs * 1000, st = sunTimes(arr, end.lat, end.lon);
  if (!st || now > st.set || st.set - arr > 30 * 60000 || now - nightSaid < 45 * 60000) return;
  nightSaid = now;
  toast(`🌙 ${tr('Il te reste')} ${fmtDur((st.set - now) / 1000)} ${tr('de jour')} · ${tr('arrivée prévue')} ${hm(arr)}, ${tr('coucher du soleil à')} ${hm(st.set)}`, 9000);
  say(tr('Attention : tu risques d\'arriver après la tombée de la nuit.'));
}

// ---------- éclairage le long du parcours (itinéraires calculés « de nuit ») ----------
// BRouter renvoie les étiquettes de chaque voie (lit=yes / lit=no) ; chaque point reçoit l'état de sa voie
function litMark(f, pts) {
  const msgs = (f.properties && f.properties.messages || []).slice(1);
  let i = 0;
  for (const m of msgs) {
    const k = /\blit=yes\b/.test(m[9]) ? 'y' : /\blit=no\b/.test(m[9]) ? 'n' : 'u', lon = +m[0] / 1e6, lat = +m[1] / 1e6;
    while (i < pts.length) { pts[i].lit = k; const hit = Math.abs(pts[i].lon - lon) < 2e-6 && Math.abs(pts[i].lat - lat) < 2e-6; i++; if (hit) break; }
  }
  while (i < pts.length) { pts[i].lit = pts[i - 1] ? pts[i - 1].lit : 'u'; i++; }
  litRemember(pts);
}
// mémorisé par la forme du tracé (départ, arrivée, longueur), retrouvé quand ce tracé est affiché
var litCache = new Map(); // var : showTrack peut être appelé au démarrage, avant cette ligne
const litKey = (pts, total) => `${pts[0].lat.toFixed(4)},${pts[0].lon.toFixed(4)}|${pts[pts.length - 1].lat.toFixed(4)},${pts[pts.length - 1].lon.toFixed(4)}|${Math.round(total / 20)}`;
function litRemember(pts) {
  if (!pts || pts.length < 2 || !pts.some(p => p.lit)) return;
  let tot = 0; const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(tot += hav(pts[k - 1], pts[k]));
  if (!tot) return;
  const segs = []; // [début, fin, état] en fractions du parcours
  for (let k = 1; k < pts.length; k++) {
    const st = pts[k].lit || 'u', a = cum[k - 1] / tot, b = cum[k] / tot, last = segs[segs.length - 1];
    if (last && last[2] === st) last[1] = b; else segs.push([a, b, st]);
  }
  litCache.set(litKey(pts, tot), segs);
  if (litCache.size > 30) litCache.delete(litCache.keys().next().value);
}
function litShare(pts) {
  let all = 0, lit = 0;
  for (let k = 1; k < pts.length; k++) { const d = hav(pts[k - 1], pts[k]); all += d; if (pts[k].lit === 'y') lit += d; }
  return all ? lit / all : 0;
}
function litFor(t) { return litCache && t && t.pts.length > 1 ? litCache.get(litKey(t.pts, t.total)) || null : null; }
// résumé et portions sombres sur la carte
// bouton ampoule (comme la météo) : affiche ou masque l'éclairage ; visible seulement quand on le connaît
var litShown = false;
function litUI() {
  const known = !!(track && track.lit), segs = known && litShown ? track.lit : null, chip = $('litChip');
  $('btnLit').hidden = !known || nav; $('btnLit').classList.toggle('on', !!segs);
  const feats = [];
  if (segs) {
    const len = { y: 0, n: 0, u: 0 };
    for (const [a, b, k] of segs) {
      len[k] += (b - a) * track.total;
      if (k === 'y') continue;
      const c = []; for (let d = a * track.total; d <= b * track.total + 1; d += Math.max(8, (b - a) * track.total / 60)) { const q = pointAt(track, Math.min(d, b * track.total)); c.push([q.lon, q.lat]); }
      if (c.length > 1) feats.push({ type: 'Feature', properties: { k }, geometry: { type: 'LineString', coordinates: c } });
    }
    // d'abord ce qui compte pour la sécurité : les portions confirmées sans éclairage ; puis le confirmé éclairé
    const pc = Math.round(len.y / track.total * 100);
    const head = len.n > 30 ? `<b class="warn">⚠ ${fmtDist(len.n)} ${tr('sans éclairage')}</b>` : `<b>✓ ${tr('Aucune portion sombre connue')}</b>`;
    chip.innerHTML = `${head} <span>· ${pc} % ${tr('confirmé éclairé')}${len.u > 30 ? ` · ${fmtDist(len.u)} ${tr('non renseigné')}` : ''}</span>`;
  }
  chip.hidden = !segs || nav;
  const data = { type: 'FeatureCollection', features: feats };
  try {
    if (map.getSource('litdark')) map.getSource('litdark').setData(data);
    else if (feats.length) {
      map.addSource('litdark', { type: 'geojson', data });
      map.addLayer({ id: 'litdark-bg', type: 'line', source: 'litdark', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1b1f2a', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 10] } });
      map.addLayer({ id: 'litdark', type: 'line', source: 'litdark', layout: { 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'k'], 'n', '#9aa6b8', '#e8742a'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 16, 5], 'line-dasharray': [1.2, 1.2] } });
    }
  } catch { /* carte pas prête */ }
}
// bande sous le profil : jaune éclairé, gris foncé sombre, tirets inconnu
function litBand(ctx, X, y) {
  ctx.save();
  for (const [a, b, k] of track.lit) {
    const x0 = X(a * track.total), x1 = X(b * track.total);
    if (k === 'y') { ctx.fillStyle = '#f2c94c'; ctx.fillRect(x0, y, Math.max(1, x1 - x0), 4); }
    else if (k === 'n') { ctx.fillStyle = '#4a5568'; ctx.fillRect(x0, y, Math.max(1, x1 - x0), 4); }
    else { ctx.fillStyle = '#8a8f99'; for (let x = x0; x < x1; x += 6) ctx.fillRect(x, y, Math.min(3, x1 - x), 4); }
  }
  ctx.restore();
}
// il fait nuit ici (entre le coucher et le lever du soleil) : l'option « éclairé » est proposée cochée
function isDarkNow() {
  const c = me || (map && map.getCenter && { lat: map.getCenter().lat, lon: map.getCenter().lng }); if (!c) return false;
  const now = Date.now(), st = sunTimes(now, c.lat, c.lon); if (!st) return false;
  return now > st.set - 20 * 60000 || now < st.rise + 10 * 60000;
}
$('btnLit').onclick = () => { litShown = !litShown; litUI(); drawProfile(); };
$('optLit').checked = store.get('litNight') === '1';
$('optLit').onchange = e => store.set('litNight', e.target.checked ? '1' : '0');

// ---------- ramène-moi au départ ----------
var navHome = null;
function homeUI() {
  const b = $('npHome'), home = navHome, ok = !!(nav && home && me && !me.sim && hav(me, home) > 150);
  b.hidden = !ok || !!(track && track.route); // déjà en route vers le départ ou un lieu
  if (ok) $('npHomeD').textContent = '· ' + fmtDist(hav(me, home));
  const rs = $('npResume'), can = !!(nav && navPrev && track && track.route);
  rs.hidden = !can; if (can) $('npResumeN').textContent = navPrev.name;
}
$('npResume').onclick = resumePrev;
$('npHome').onclick = () => { if (navHome) goTo({ lat: navHome.lat, lon: navHome.lon, label: tr('le départ') }); };

// ---------- bilan des sorties : mois, année, tout (repliable, choix retenu) ----------
function bilanFold(has) {
  const open = store.get('soBilan') === '1';
  $('soFold').hidden = !has; $('soSum').hidden = !has || !open;
  if (!has) return;
  const now = new Date(), cur = blItems.filter(it => { const d = new Date(it.start || it.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }), S = blStats(cur);
  $('soFoldTxt').innerHTML = `📊 <b>${tr('Bilan')}</b> · ${now.toLocaleDateString(LOC, { month: 'long' })} : <b>${fmtDist(S.d)}</b> · ${S.n} ${tr(S.n > 1 ? 'sorties' : 'sortie')}`;
  $('soFoldChev').textContent = open ? tr('Masquer') + ' ▴' : tr('Afficher') + ' ▾';
}
$('soFold').onclick = () => { store.set('soBilan', store.get('soBilan') === '1' ? '0' : '1'); bilanFold(true); };
var blPeriod = 'm', blOff = 0, blItems = [];
function blRange(p, off) {
  const now = new Date();
  if (p === 'm') { const a = new Date(now.getFullYear(), now.getMonth() + off, 1); return [a.getTime(), new Date(a.getFullYear(), a.getMonth() + 1, 1).getTime(), a]; }
  if (p === 'y') { const a = new Date(now.getFullYear() + off, 0, 1); return [a.getTime(), new Date(a.getFullYear() + 1, 0, 1).getTime(), a]; }
  return [0, Infinity, null];
}
function blStats(items) {
  return { n: items.length, d: items.reduce((a, it) => a + (it.dist || 0), 0), up: items.reduce((a, it) => a + (it.up || 0), 0), ms: items.reduce((a, it) => a + (it.ms || 0), 0) };
}
function renderBilan(items) {
  if (items) blItems = items;
  const all = blItems, when = it => it.start || it.date;
  const [t0, t1, a] = blRange(blPeriod, blOff), cur = all.filter(it => when(it) >= t0 && when(it) < t1);
  const S = blStats(cur);
  let prevS = null;
  if (blPeriod !== 'all') { const [p0, p1] = blRange(blPeriod, blOff - 1); prevS = blStats(all.filter(it => when(it) >= p0 && when(it) < p1)); }
  const delta = (v, pv) => { if (!prevS || !prevS.n || !pv || !S.n) return ''; const k = Math.round((v - pv) / pv * 100); return k ? `<em class="${k < 0 ? 'dn' : ''}">${k > 0 ? '▲' : '▼'} ${Math.abs(k)} %</em>` : ''; };
  const title = blPeriod === 'm' ? a.toLocaleDateString(LOC, { month: 'long', year: 'numeric' }) : blPeriod === 'y' ? String(a.getFullYear()) : tr('Depuis le début');
  const oldest = all.length ? Math.min(...all.map(when)) : Date.now();
  const canPrev = blPeriod !== 'all' && blRange(blPeriod, blOff)[0] > oldest, canNext = blPeriod !== 'all' && blOff < 0;
  // colonnes : semaines du mois (lundi), mois de l'année, ou années
  const sum = (list, s, e) => list.filter(it => when(it) >= s && when(it) < e).reduce((x, it) => x + (it.dist || 0), 0);
  const cols = [], now = Date.now();
  if (blPeriod === 'm') {
    const first = new Date(t0); first.setDate(1 - ((first.getDay() + 6) % 7));
    for (let s = first.getTime(); s < t1; ) { const e = new Date(s); e.setDate(e.getDate() + 7); const ds = new Date(Math.max(s, t0)); cols.push({ lab: String(ds.getDate()), v: sum(cur, s, e.getTime()), cur: now >= s && now < e.getTime() }); s = e.getTime(); }
  } else if (blPeriod === 'y') {
    for (let m = 0; m < 12; m++) { const s = new Date(a.getFullYear(), m, 1).getTime(), e = new Date(a.getFullYear(), m + 1, 1).getTime(); cols.push({ lab: new Date(s).toLocaleDateString(LOC, { month: 'narrow' }), v: sum(cur, s, e), cur: now >= s && now < e }); }
  } else {
    const y1 = new Date().getFullYear(), y0 = Math.max(new Date(oldest).getFullYear(), y1 - 5);
    for (let y = y0; y <= y1; y++) cols.push({ lab: String(y), v: sum(all, new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()), cur: y === y1 });
  }
  const vmax = Math.max(1, ...cols.map(c => c.v));
  const fmtK = v => v >= 1000 ? (IMP ? Math.round(v / 1609.34) + ' mi' : Math.round(v / 1000) + ' km') : '';
  const foot = cur.filter(it => recMode(it) !== 'bike'), bike = cur.filter(it => recMode(it) === 'bike'), fd = blStats(foot).d, bd = blStats(bike).d;
  const longest = cur.reduce((b, it) => !b || (it.dist || 0) > (b.dist || 0) ? it : b, null);
  const climb = cur.reduce((b, it) => (it.up || 0) > ((b && b.up) || 0) ? it : b, null);
  const day = it => escH(it.title || new Date(when(it)).toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long' }));
  $('soSum').innerHTML = `
    <div class="bl-seg"><button data-p="m" class="${blPeriod === 'm' ? 'on' : ''}">${tr('Mois')}</button><button data-p="y" class="${blPeriod === 'y' ? 'on' : ''}">${tr('Année')}</button><button data-p="all" class="${blPeriod === 'all' ? 'on' : ''}">${tr('Tout')}</button></div>
    <div class="bl-head"><button data-o="-1" ${canPrev ? '' : 'disabled'} aria-label="${tr('Précédent')}">‹</button><span>${title}</span><button data-o="1" ${canNext ? '' : 'disabled'} aria-label="${tr('Suivant')}">›</button></div>
    <div class="bl-tiles">
      <div><b>${fmtDist(S.d)}</b><span>${S.n} ${tr(S.n > 1 ? 'sorties' : 'sortie')}</span>${delta(S.d, prevS && prevS.d)}</div>
      <div><b>${fmtM(S.up)}</b><span>D+</span>${delta(S.up, prevS && prevS.up)}</div>
      <div><b>${fmtDur(S.ms / 1000)}</b><span>${tr('en mouvement')}</span>${delta(S.ms, prevS && prevS.ms)}</div>
    </div>
    ${S.n ? `<div class="bl-chart">${cols.map(c => `<div class="${c.cur ? 'cur' : ''}"><small>${c.v && c.v === vmax ? fmtK(c.v) : ''}</small><i style="height:${c.v ? Math.max(4, c.v / vmax * 100) : 2}%;${c.v ? '' : 'opacity:.25'}"></i><span>${c.lab}</span></div>`).join('')}</div>
    <div class="bl-mix">${fd ? `<div style="flex:${fd};background:var(--go)"></div>` : ''}${bd ? `<div style="flex:${bd};background:#e07b39"></div>` : ''}</div>
    <div class="bl-leg">${foot.length ? `<span><i style="background:var(--go)"></i>${tr('À pied')} · ${fmtDist(fd)} · ${foot.length}</span>` : ''}${bike.length ? `<span><i style="background:#e07b39"></i>${tr('À vélo')} · ${fmtDist(bd)} · ${bike.length}</span>` : ''}</div>
    <div class="bl-rec"><div>🏆 ${tr('Plus longue')}<b>${fmtDist(longest.dist || 0)}</b><span>${day(longest)}</span></div>${climb ? `<div>⛰️ ${tr('Plus de D+')}<b>${fmtM(climb.up)}</b><span>${day(climb)}</span></div>` : ''}</div>`
    : `<p class="bl-empty">${tr('Aucune sortie sur cette période.')}</p>`}`;
  $('soSum').querySelectorAll('[data-p]').forEach(b => b.onclick = () => { blPeriod = b.dataset.p; blOff = 0; renderBilan(); });
  $('soSum').querySelectorAll('[data-o]').forEach(b => b.onclick = () => { blOff += +b.dataset.o; renderBilan(); });
}

// ---------- glisser le doigt sur le profil : le point correspondant s'affiche sur la carte ----------
var scrubD = null, scrubMk = null, scrubT = null;
function scrubAt(clientX) {
  if (!track || !track.hasEle) return;
  const r = cv.getBoundingClientRect(), L0 = cv._L0 || 38, w = r.width - L0 - 4;
  scrubToD(clamp((clientX - r.left - L0) / w, 0, 1) * track.total);
}
function scrubToD(d) {
  if (!track) return;
  scrubD = d;
  const q = pointAt(track, scrubD);
  if (!scrubMk) { const el = document.createElement('div'); el.className = 'scrub-dot'; scrubMk = new maplibregl.Marker({ element: el }); }
  scrubMk.setLngLat([q.lon, q.lat]).addTo(map);
  // point hors de l'écran : la carte le suit
  const pt = map.project([q.lon, q.lat]), mc = map.getContainer(), sheetTop = isSide() ? mc.clientHeight : $('sheet').getBoundingClientRect().top;
  if (pt.x < 20 || pt.y < 70 || pt.x > mc.clientWidth - 20 || pt.y > sheetTop - 20) map.easeTo({ center: [q.lon, q.lat], duration: 300 });
  clearTimeout(scrubT); drawProfile();
}
function scrubEnd(delay = 2500) {
  clearTimeout(scrubT);
  scrubT = setTimeout(() => { scrubD = null; if (scrubMk) scrubMk.remove(); drawProfile(); }, delay);
}
function scrubDraw(ctx, X, Y, T, h, L0, W) {
  const q = pointAt(track, scrubD), e = track.ele[q.i], x = X(scrubD);
  ctx.save();
  ctx.strokeStyle = cssVar('--ink'); ctx.globalAlpha = .55; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(x, 4 + T); ctx.lineTo(x, 4 + T + h); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  if (e != null) { ctx.fillStyle = COL.track; ctx.beginPath(); ctx.arc(x, Y(e), 5, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
  const up = track.totalUp - infoAt(scrubD).upLeft;
  // météo affichée : celle prévue à ce point, à l'heure de passage (le D+ laisse alors la place)
  let wxt = '';
  if (wxShown() && meteo.samples && meteo.samples.length) {
    const sm = meteo.samples.reduce((b, x) => Math.abs(x.d - scrubD) < Math.abs(b.d - scrubD) ? x : b);
    wxt = ` · ${!sm.day && sm.code <= 2 ? '🌙' : wxIcon(sm.code)} ${Math.round(IMP ? sm.temp * 9 / 5 + 32 : sm.temp)}°${sm.prob >= 20 ? ' · ' + tr('pluie') + ' ' + sm.prob + ' %' : ''}`;
  }
  const txt = `${fmtDist(scrubD)}${e != null ? ' · ' + fmtM(e) : ''}${!wxt && track.hasEle && up > 0 ? ' · D+ ' + fmtM(up) : ''} · ≈${hm(etaAlong(scrubD))}${wxt}`;
  ctx.font = '600 11px system-ui, sans-serif';
  const tw = ctx.measureText(txt).width + 12, bx = clamp(x - tw / 2, L0, W - tw), by = 4 + T;
  ctx.fillStyle = cssVar('--ink'); ctx.globalAlpha = .88; ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, tw, 18, 9); else ctx.rect(bx, by, tw, 18);
  ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = cssVar('--panel') || '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + 6, by + 9.5);
  ctx.restore();
}
(() => {
  let sx = 0, sy = 0, mode = null; // null : pas encore décidé · 'scrub' : glissé horizontal · 'sheet' : le panneau
  cv.addEventListener('touchstart', e => {
    if (!track || !track.hasEle || e.touches.length > 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; mode = null; scrubAt(sx);
  }, { passive: true });
  cv.addEventListener('touchmove', e => {
    if (!track || !track.hasEle) return;
    const x = e.touches[0].clientX, dx = x - sx, dy = e.touches[0].clientY - sy;
    if (!mode && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) mode = Math.abs(dy) > Math.abs(dx) * 1.2 ? 'sheet' : 'scrub';
    if (mode === 'sheet') { scrubEnd(0); return; }
    if (mode === 'scrub') { if (e.cancelable) e.preventDefault(); e.stopPropagation(); scrubAt(x); }
  }, { passive: false });
  cv.addEventListener('touchend', () => { if (mode !== 'sheet') scrubEnd(); });
  cv.addEventListener('touchcancel', () => scrubEnd(0));
  // souris (ordinateur) : survol
  cv.addEventListener('mousemove', e => { if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return; scrubAt(e.clientX); });
  cv.addEventListener('mouseleave', () => scrubEnd(800));
})();

// ---------- points utiles sur la carte (eau, sources, refuges, abris, toilettes) : dépôt pisteo-data ----------
const POI = { w: ['💧', '#2f80ed', 'Eau potable', 5], s: ['💧', '#6aa7d8', 'Source (eau non garantie)', 3], r: ['🏠', '#b0532b', 'Refuge gardé', 6],
  c: ['🛖', '#8a5a3b', 'Cabane non gardée', 5], a: ['⛺', '#3a7556', 'Abri', 4], t: ['🚻', '#7a5cc2', 'Toilettes', 1],
  v: ['🔭', '#d08a1e', 'Point de vue', 3], p: ['⛰️', '#6b6f73', 'Sommet', 2] };
var poiMan = null, poiTiles = new Map(), poiBusy = false;
const poiOn = () => store.get('poi') !== '0';
function poiImages() {
  for (const [k, [ic, col]] of Object.entries(POI)) {
    if (map.hasImage('poi-' + k)) continue;
    const S = 64, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
    x.fillStyle = col; x.strokeStyle = '#fff'; x.lineWidth = 6; x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 5, 0, 7); x.fill(); x.stroke();
    x.font = '30px system-ui, "Apple Color Emoji", "Noto Color Emoji", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ic, S / 2, S / 2 + 2);
    map.addImage('poi-' + k, x.getImageData(0, 0, S, S), { pixelRatio: 2 });
  }
}
function poiLayer() {
  if (map.getSource('poi')) return;
  poiImages();
  map.addSource('poi', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'poi', type: 'symbol', source: 'poi', minzoom: 12.5,
    layout: { 'icon-image': ['concat', 'poi-', ['get', 'k']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, .7, 16, 1], 'icon-allow-overlap': false,
      'symbol-sort-key': ['-', 0, ['get', 'pr']], 'icon-padding': 1 } });
  map.on('click', 'poi', e => {
    const f = e.features && e.features[0]; if (!f) return;
    const P = POI[f.properties.k]; toast(`${P[0]} ${tr(P[2])}${f.properties.n ? ' · ' + f.properties.n : ''}`, 3500);
  });
  map.on('mouseenter', 'poi', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'poi', () => { map.getCanvas().style.cursor = ''; });
}
async function poiUpdate() {
  // pas isStyleLoaded() : il reste faux tant qu'un fond de carte lent charge ses tuiles
  try { poiLayer(); } catch { map.once('idle', poiUpdate); return; }
  const show = poiOn() && map.getZoom() >= 12.5;
  map.setLayoutProperty('poi', 'visibility', poiOn() ? 'visible' : 'none');
  if (!show || poiBusy) return;
  poiBusy = true;
  try {
    if (!poiMan) poiMan = await rtdGet('poi.json', 864e5).catch(() => null);
    if (!poiMan || !poiMan.tiles) return;
    const b = map.getBounds(), have = new Set(poiMan.tiles);
    const g = poiMan.grid || 0.25, names = [];
    for (let x = Math.floor((b.getWest() + 180) / g); x <= Math.floor((b.getEast() + 180) / g); x++)
      for (let y = Math.floor((b.getSouth() + 90) / g); y <= Math.floor((b.getNorth() + 90) / g); y++) if (have.has(`${x}_${y}`) && names.length < 12) names.push(`${x}_${y}`);
    await Promise.all(names.filter(n => !poiTiles.has(n)).map(n => rtdGet(`p/${n}.json?d=${poiMan.date}`, 0).then(T => poiTiles.set(n, T.p || [])).catch(() => {})));
    const feats = [];
    for (const n of names) for (const [lat, lon, k, nm, ele] of poiTiles.get(n) || []) if (POI[k]) feats.push({ type: 'Feature', properties: { k, n: [nm, ele != null ? fmtM(ele) : ''].filter(Boolean).join(' · '), pr: POI[k][3] }, geometry: { type: 'Point', coordinates: [lon, lat] } });
    map.getSource('poi').setData({ type: 'FeatureCollection', features: feats });
  } finally { poiBusy = false; }
}
// cartes téléchargées : les points utiles de la zone sont gardés aussi (bbox = [ouest, sud, est, nord])
async function poiPrefetch(bb) {
  try {
    if (!poiMan) poiMan = await rtdGet('poi.json', 864e5).catch(() => null);
    if (!poiMan || !poiMan.tiles) return;
    const g = poiMan.grid || 0.25, have = new Set(poiMan.tiles), names = [];
    for (let x = Math.floor((bb[0] + 180) / g); x <= Math.floor((bb[2] + 180) / g); x++)
      for (let y = Math.floor((bb[1] + 90) / g); y <= Math.floor((bb[3] + 90) / g); y++) if (have.has(`${x}_${y}`)) names.push(`${x}_${y}`);
    for (let i = 0; i < names.length; i += 4) // par petits groupes, sans gêner le téléchargement de la carte
      await Promise.all(names.slice(i, i + 4).map(n => rtdGet(`p/${n}.json?d=${poiMan.date}`, 0).then(T => poiTiles.set(n, T.p || [])).catch(() => {})));
  } catch { /* les points se chargeront à l'affichage */ }
}
map.on('moveend', () => { if (poiOn()) poiUpdate(); });
map.on('load', poiUpdate);
if (map.loaded()) poiUpdate();
$('optPoi').checked = poiOn();
$('optPoi').onchange = e => { store.set('poi', e.target.checked ? '1' : '0'); poiUpdate(); };

// ---------- Préparer la sortie : étapes (plusieurs jours) et eau le long de la trace ----------
// points utiles près de la trace, gardés sur la trace : [{ along, k, nm, d }] ; null = pas de données pour cette zone
const PREP_NIGHT = { r: 3, c: 2, a: 1 }; // fin d'étape : refuge gardé > cabane > abri
async function prepPois(t) {
  if (t.prepPois !== undefined) return t.prepPois;
  const lats = t.pts.map(p => p.lat), lons = t.pts.map(p => p.lon);
  const bb = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  await poiPrefetch(bb);
  if (!poiMan || !poiMan.tiles) return null; // pas de réseau : on réessaiera
  const g = poiMan.grid || 0.25, have = new Set(poiMan.tiles);
  // zone couverte : au moins une tuile de points utiles le long de la trace
  let covered = false;
  for (let i = 0; i < t.pts.length && !covered; i += Math.max(1, Math.floor(t.pts.length / 200)))
    covered = have.has(`${Math.floor((t.pts[i].lon + 180) / g)}_${Math.floor((t.pts[i].lat + 90) / g)}`);
  if (!covered) return (t.prepPois = null);
  // tri grossier : cases de ~550 m autour de la trace, puis distance exacte au tracé
  const G = .005, near = new Set(), out = [], cell = (a, o) => Math.floor(a / G) + ':' + Math.floor(o / G);
  for (let i = 0; i < t.pts.length; i++) {
    const p = t.pts[i];
    if (i && hav(p, t.pts[i - 1]) < 150 && i % 4) continue;
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) near.add(cell(p.lat + y * G, p.lon + x * G));
  }
  for (const T of poiTiles.values()) for (const [lat, lon, k, nm] of T) {
    const tol = k === 'w' || k === 's' ? 250 : PREP_NIGHT[k] ? 400 : 0;
    if (!tol || !near.has(cell(lat, lon))) continue;
    const pr = project(t, { lat, lon }, true);
    if (pr && pr.dist <= tol) out.push({ along: pr.along, k, nm: nm || '', d: pr.dist });
  }
  return (t.prepPois = out.sort((a, b) => a.along - b.along));
}
const prepBike = () => profile === 'trekking';
const prepKey = () => 'prepDays|' + trKey();
// effort (secondes) du départ jusqu'à d, et distance où l'effort atteint s
const effTo = d => baseSecs(0, d);
function distForEff(s) {
  let lo = 0, hi = track.total;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (effTo(m) < s) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
function prepAutoDays() {
  const E = effTo(track.total), day = (prepBike() ? 5 : 6) * 3600;
  return Math.max(1, Math.min(20, Math.round(E / day) || 1));
}
function prepDays() { const v = +store.get(prepKey()); return v >= 1 && v <= 30 ? v : prepAutoDays(); }
// découpe en n étapes à effort égal ; chaque fin d'étape se cale sur un lieu pour la nuit à ± 15 % de l'effort d'une journée
// fins d'étape choisies à la main (mètres le long de la trace), gardées par trace et par nombre de jours
const prepEndsKey = n => 'prepEnds|' + trKey() + '|' + n;
function prepEndsGet(n) {
  try { const a = JSON.parse(store.get(prepEndsKey(n)) || 'null');
    if (Array.isArray(a) && a.length === n - 1 && a.every((v, i) => typeof v === 'number' && v > 0 && v < track.total && (!i || v > a[i - 1]))) return a; } catch {}
  return null;
}
// lieu pour la nuit le plus proche d'une fin d'étape (à moins de 600 m le long de la trace)
function prepNightAt(at, nights) {
  let best = null, bs = Infinity;
  for (const p of nights) { const s = Math.abs(p.along - at) - PREP_NIGHT[p.k] * 30 + p.d / 4; if (Math.abs(p.along - at) <= 600 && s < bs) { bs = s; best = p; } }
  return best;
}
function prepStages(n, pois) {
  const E = effTo(track.total), day = E / n, nights = (pois || []).filter(p => PREP_NIGHT[p.k]);
  const ends = []; let prev = 0;
  const own = n > 1 ? prepEndsGet(n) : null;
  if (own) for (const at of own) ends.push({ along: at, night: prepNightAt(at, nights), own: true });
  else for (let j = 1; j < n; j++) {
    const want = day * j, d0 = distForEff(want);
    let best = null, bestScore = Infinity;
    for (const p of nights) {
      if (p.along <= prev + 500 || p.along >= track.total - 500) continue;
      const off = Math.abs(effTo(p.along) - want) / day; if (off > .15) continue;
      const score = off - PREP_NIGHT[p.k] * .03 + p.d / 20000;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    const at = best ? best.along : Math.max(d0, prev + 100);
    ends.push({ along: at, night: best }); prev = at;
  }
  ends.push({ along: track.total, night: null, last: true });
  let from = 0;
  return ends.map((e, i) => {
    const a = infoAt(from), b = infoAt(e.along);
    const st = { n: i + 1, from, to: e.along, dist: e.along - from, up: a.upLeft - b.upLeft, down: a.downLeft - b.downLeft, secs: baseSecs(from, e.along), night: e.night, last: !!e.last, own: !!e.own };
    from = e.along; return st;
  });
}
// trous d'eau : portions sans point d'eau potable connu (au-delà de 10 km à pied, 30 km à vélo)
function prepWaterGaps(pois) {
  const lim = prepBike() ? 30000 : 10000, w = pois.filter(p => p.k === 'w').map(p => p.along);
  const marks = [0, ...w, track.total], gaps = [];
  for (let i = 1; i < marks.length; i++) {
    const a = marks[i - 1], b = marks[i]; if (b - a < lim) continue;
    gaps.push({ from: a, to: b, start: i === 1, end: i === marks.length - 1, src: pois.filter(p => p.k === 's' && p.along > a && p.along < b) });
  }
  return { gaps, n: w.length, lim };
}
// borne kilométrique, sans unité : « 8 → 30 km »
const kmN = m => { const v = IMP ? m / 1609.344 : m / 1000; return v < 10 && Math.abs(v - Math.round(v)) >= .05 ? v.toFixed(1).replace('.', ',') : String(Math.round(v)); };
const kmU = () => IMP ? ' mi' : ' km';
const POI_NAME = { r: 'Refuge gardé', c: 'Cabane non gardée', a: 'Abri' };
let prepMks = [], prepSeq = 0;
function prepHintSet(n, dry) {
  $('prepHint').innerHTML = [n > 1 ? `${n} <span>jours</span>` : '', dry ? '⚠️ <span>eau</span>' : ''].filter(Boolean).join(' · ');
}
function prepMarkers(stages) {
  prepMks.forEach(m => m.remove()); prepMks = [];
  if (!stages || stages.length < 2 || nav) return;
  for (const s of stages.slice(0, -1)) {
    const p = pointAt(track, s.to), e = document.createElement('div');
    e.className = 'stage-mk'; e.textContent = (LANG === 'fr' ? 'J' : LANG === 'es' ? 'D' : 'D') + s.n;
    e.title = tr('Fin du jour') + ' ' + s.n;
    prepMks.push(new maplibregl.Marker({ element: e }).setLngLat([p.lon, p.lat]).addTo(map));
  }
}
async function prepRender() {
  if (!track) return;
  const mine = track, seq = ++prepSeq, n = prepDays(), sel = $('prepDays');
  const max = Math.max(10, prepAutoDays() + 4, n);
  sel.innerHTML = Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  sel.value = String(n);
  const bike = prepBike(), E = effTo(track.total);
  $('prepSum').innerHTML = `<b>${fmtDist(track.total)}</b>${track.hasEle ? ` · <span>D+</span> <b>${fmtM(track.totalUp)}</b> · <span>D−</span> <b>${fmtM(track.totalDown)}</b>` : ''} · <span>${tr(bike ? 'à vélo' : 'à pied')}</span> <b>${fmtDur(E)}</b>`;
  document.querySelector('.prep-foot').textContent = tr(bike ? 'Temps à vélo estimé selon ton allure, sans les pauses.' : 'Temps de marche estimé selon ton allure, sans les pauses.');
  $('prepWater').innerHTML = `<p class="note">${escH(tr('Recherche des points d\'eau…'))}</p>`;
  const draw = pois => {
    const stages = prepStages(n, pois);
    $('prepStages').innerHTML = n < 2 ? '' : stages.map(s => {
      const night = s.last ? `<span class="pl-night">🏁 <span>${escH(tr('Arrivée'))}</span></span>`
        : s.night ? `<span class="pl-night">${POI[s.night.k][0]} <span>${escH(tr(POI_NAME[s.night.k]))}</span>${s.night.nm ? ' · ' + escH(s.night.nm) : ''}${s.night.d > 80 ? ` <span class="pl-km">(${fmtDist(Math.round(s.night.d / 10) * 10)} <span>${escH(tr('de la trace'))}</span>)</span>` : ''}</span>`
        : `<span class="pl-night none">🌙 <span>${escH(tr(pois ? 'Pas de refuge ni d\'abri repéré à cet endroit' : 'Lieux pour la nuit inconnus ici'))}</span></span>`;
      // fin d'étape réglable : ± 1 ou 5 km, ou un lieu pour la nuit proche (à ± 35 % de l'effort d'une journée)
      let ctl = '';
      if (!s.last) {
        const E1 = effTo(track.total) / n, here = effTo(s.to), lo = stages[s.n - 2] ? stages[s.n - 2].to : 0, hi = stages[s.n].to;
        const near = (pois || []).filter(p => PREP_NIGHT[p.k] && p.along > lo + 500 && p.along < hi - 500 && Math.abs(p.along - s.to) > 300 && Math.abs(effTo(p.along) - here) < E1 * .35)
          .sort((a, b) => Math.abs(a.along - s.to) - Math.abs(b.along - s.to)).slice(0, 4).sort((a, b) => a.along - b.along);
        ctl = `<div class="pl-ctl" data-i="${s.n - 1}"><span>${escH(tr('Fin d\'étape'))}</span><button data-mv="-5000">−5</button><button data-mv="-1000">−1</button><b>${kmN(s.to)}${kmU()}</b><button data-mv="1000">+1</button><button data-mv="5000">+5</button></div>`
          + (near.length ? `<div class="pl-near" data-i="${s.n - 1}">${near.map(p => `<button data-at="${Math.round(p.along)}">${POI[p.k][0]} ${escH(p.nm || tr(POI_NAME[p.k]))} · km ${kmN(p.along)}</button>`).join('')}</div>` : '');
      }
      return `<li><b><span>${escH(tr('Jour'))}</span> ${s.n}</b> · <b>${fmtDist(s.dist)}</b>${track.hasEle ? ` · <span>D+</span> ${fmtM(s.up)} · <span>D−</span> ${fmtM(s.down)}` : ''} · ${fmtDur(s.secs)}<br><span class="pl-km">${kmN(s.from)} → ${kmN(s.to)}${kmU()}</span>${night}${ctl}</li>`;
    }).join('') + (n > 1 && stages.some(s => s.own) ? `<li class="pl-reset"><button id="prepReset">↺ <span>${escH(tr('Recalculer les étapes automatiquement'))}</span></button></li>` : '');
    prepStagesWire(stages, n);
    prepMarkers(stages);
    prepHintSet(n, false);
    return stages;
  };
  draw(mine.prepPois || null);
  let pois = null; try { pois = await prepPois(mine); } catch {}
  if (track !== mine || seq !== prepSeq) return;
  draw(pois);
  prepOffline(); prepSafety();
  if (!pois) {
    $('prepWater').innerHTML = `<p class="note">${escH(tr(navigator.onLine === false ? 'Hors connexion : points d\'eau indisponibles pour le moment.' : 'Points d\'eau connus en France et dans les pays voisins seulement : pas de données ici.'))}</p>`;
    return;
  }
  const W = prepWaterGaps(pois);
  const gapHtml = W.gaps.map(gp => {
    const where = gp.start && gp.end ? `<span>${escH(tr('Sur tout le parcours'))}</span>`
      : gp.start ? `<span>${escH(tr('Départ'))}</span> → ${kmN(gp.to)}${kmU()}`
      : gp.end ? `${kmN(gp.from)}${kmU()} → <span>${escH(tr('arrivée'))}</span>`
      : `${kmN(gp.from)} → ${kmN(gp.to)}${kmU()}`;
    const src = gp.src.length ? `<br><small>💧 ${gp.src.length} <span>${escH(tr(gp.src.length > 1 ? 'sources sur ce tronçon (eau non garantie)' : 'source sur ce tronçon (eau non garantie)'))}</span></small>` : '';
    return `<p class="gap">⚠️ ${where} : <b>${fmtDist(gp.to - gp.from)}</b> <span>${escH(tr('sans point d\'eau potable connu'))}</span>${src}</p>`;
  }).join('');
  $('prepWater').innerHTML = (gapHtml || `<p class="ok">✓ <span>${escH(tr(W.n ? 'Un point d\'eau potable au moins tous les' : 'Parcours court : pas de long tronçon sans eau'))}</span>${W.n ? ' ' + fmtDist(W.lim) : ''}</p>`)
    + `<p class="note">${W.n} <span>${escH(tr(W.n > 1 ? 'points d\'eau potable à moins de 250 m de la trace' : 'point d\'eau potable à moins de 250 m de la trace'))}</span>. <span>${escH(tr('Données OpenStreetMap : vérifie sur place, et emporte de quoi tenir.'))}</span></p>`;
  if (W.gaps.length) prepHintSet(n, true);
  prepPoiList();
}
// partir sans réseau : trace gardée, carte et chemins le long de la trace, points utiles
// les traces préparées sont rangées dans un dossier à part de « Mes traces » : hors des 30 dernières traces ouvertes, qui s'effacent
const PREP_FOLDER = () => tr('Sorties préparées');
// sortie sur plusieurs jours : un dossier à son nom, avec la trace entière et une trace par jour (à ouvrir le matin de chaque étape)
const prepTripKey = () => 'prepTrip|' + trKey();
function prepSlice(from, to) {
  const P = track.pts, C = track.cum, out = [];
  const a = pointAt(track, from), b = pointAt(track, to);
  out.push({ lat: a.lat, lon: a.lon, ele: P[a.i].ele });
  for (let i = a.i + 1; i <= b.i; i++) if (C[i] > from && C[i] < to) out.push(P[i]);
  out.push({ lat: b.lat, lon: b.lon, ele: P[Math.min(b.i + 1, P.length - 1)].ele });
  return out;
}
async function prepDaysSave(folder) {
  const n = prepDays(), mine = track;
  let old = []; try { old = JSON.parse(store.get(prepTripKey() + '|ids') || '[]'); } catch {}
  for (const id of old) await idb('readwrite', st => st.delete(id)).catch(() => {});
  const ids = [];
  if (n > 1) {
    const st = prepStages(n, Array.isArray(mine.prepPois) ? mine.prepPois : null);
    for (const s of st) {
      const pts = prepSlice(s.from, s.to), nm = `${mine.name || tr('Parcours')} · ${tr('Jour')} ${s.n}`, p = makePath(pts, nm);
      if (await saveRecent(p, loopGPX(pts, nm), false, { folder, pos: s.n })) ids.push(nm + '|' + Math.round(p.total));
    }
  }
  store.set(prepTripKey() + '|ids', JSON.stringify(ids));
  store.set(prepTripKey() + '|sig', prepSig());
  return ids.length;
}
const prepSig = () => { const st = prepStages(prepDays(), track && Array.isArray(track.prepPois) ? track.prepPois : null); return st.map(s => Math.round(s.to)).join(','); };
async function prepKeep() {
  if (!track) return false;
  const id = trKey(), mine = track, n = prepDays();
  const saved = store.get('gpx'), text = saved && saved.includes('<trkpt') ? saved : loopGPX(mine.pts, mine.name);
  const old = await idb('readonly', st => st.get(id)).catch(() => null);
  if (!old) await saveRecent(mine, text);
  // plusieurs jours : dossier au nom de la sortie ; sinon « Sorties préparées » ; une trace déjà rangée reste dans son dossier
  const f = (old && old.folder) || (n > 1 ? (mine.name || tr('Parcours')).slice(0, 40) : PREP_FOLDER());
  await libPatch([id], it => { it.folder = f; it.pos = 0; });
  const fs = libFoldersStored(); if (!fs.includes(f)) { fs.push(f); libSaveFolders(fs); }
  store.set(prepTripKey(), f);
  await prepDaysSave(f);
  refreshSaveBtn();
  return f;
}
// étapes modifiées après coup : les traces du jour suivent
async function prepTripSync() {
  if (!track) return;
  const f = store.get(prepTripKey()); if (!f) return;
  if (store.get(prepTripKey() + '|sig') === prepSig()) return;
  await prepDaysSave(f);
}
async function prepOffline() {
  const mine = track; if (!mine) return;
  const id = trKey(), lats = mine.pts.map(p => p.lat), lons = mine.pts.map(p => p.lon);
  const bb = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  const [recent, packs] = await Promise.all([listRecent().catch(() => []), listPacks()]);
  if (track !== mine) return;
  const it = recent.find(x => x.id === id);
  let saved = !!(it && it.folder);
  if (saved && prepDays() > 1) { await prepTripSync(); saved = !!store.get(prepTripKey()) && store.get(prepTripKey() + '|sig') === prepSig(); }
  const own = packs.find(p => p.id === 'trace:' + id);
  const covers = p => p.bbox && p.bbox[0] <= bb[0] && p.bbox[1] <= bb[1] && p.bbox[2] >= bb[2] && p.bbox[3] >= bb[3];
  const pack = own && own.complete ? own : packs.find(p => p.complete && covers(p)) || own;
  const mapOk = !!(pack && pack.complete), graphOk = !!(pack && pack.graph && !pack.graph.partial);
  const poiOk = Array.isArray(mine.prepPois);
  // chaque ligne se touche : elle fait ce qui manque (ou montre le détail)
  const row = (ok, title, sub, act) => `<li><button class="prep-row" data-act="${act}"><i class="${ok === 'info' ? 'info' : ok ? 'ok' : 'no'}">${ok === 'info' ? 'i' : ok ? '✓' : ''}</i><span><span>${escH(tr(title))}</span>${sub ? `<small>${sub}</small>` : ''}</span><em>${ok === true ? '' : escH(tr(ok === 'info' ? 'Voir' : 'Faire'))}</em></button></li>`;
  const when = pack ? `${fmtMo(pack.bytes / 1024)} · ${fmtDate(pack.date)}` : '';
  // batterie : heures de navigation possibles (10 % gardés en réserve) face au jour le plus long, pauses comprises
  let battRow = '';
  try {
    const b = await battGet(), rate = +store.get('battRate') || 10, learned = !!store.get('battRate');
    const st = prepStages(prepDays(), Array.isArray(mine.prepPois) ? mine.prepPois : null);
    const need = Math.max(...st.map(s => s.secs)) * 1.3 / 3600, needAll = st.reduce((a, s) => a + s.secs, 0) * 1.3 / 3600;
    const rateTxt = `≈ ${String(rate).replace('.', ',')} %/h ${escH(tr(learned ? 'sur ce téléphone' : 'estimation par défaut, affinée après tes sorties'))}`;
    if (b && !b.charging) {
      const h = Math.max(0, (b.level * 100 - 10) / rate), ok = h >= need;
      battRow = row(ok, 'Batterie', `${Math.round(b.level * 100)} % · ${escH(tr('environ'))} ${fmtDur(h * 3600)} ${escH(tr('de navigation'))} · ${escH(tr(st.length > 1 ? 'jour le plus long' : 'il en faut'))} ${fmtDur(need * 3600)}${ok ? '' : ' · ' + escH(tr('recharge ou prends une batterie externe'))}${st.length > 1 ? `<br>${escH(tr('Sans recharge sur'))} ${st.length} ${escH(tr('jours'))} : ${fmtDur(needAll * 3600)} (${Math.round(needAll * rate)} %)` : ''}<br>${rateTxt}`, 'batt');
    } else {
      battRow = row('info', 'Batterie', `${escH(tr(b ? 'En charge.' : 'Niveau inconnu.'))} ${escH(tr(st.length > 1 ? 'Jour le plus long' : 'Il en faut'))} ${fmtDur(need * 3600)}, ${escH(tr('soit'))} ${Math.round(need * rate)} % ${escH(tr('de batterie'))}${st.length > 1 ? ` · ${st.length} ${escH(tr('jours'))} : ${Math.round(needAll * rate)} %` : ''}<br>${rateTxt}`, 'batt');
    }
  } catch {}
  $('prepOff').innerHTML = [
    row(saved, prepDays() > 1 ? 'Traces gardées dans Mes traces' : 'Trace gardée dans Mes traces', saved ? `📁 ${escH(it.folder)}${prepDays() > 1 && store.get(prepTripKey()) ? ` · <span>${escH(tr('trace entière + une trace par jour'))}</span>` : ''}` : escH(tr(prepDays() > 1 ? 'Un dossier pour la sortie : la trace entière et une trace par jour' : 'Rangée dans un dossier, pour ne pas être effacée')), 'keep'),
    row(mapOk, 'Carte le long de la trace', dl ? escH(tr('Téléchargement en cours…')) : mapOk ? when : pack ? escH(tr('Téléchargement incomplet')) : escH(tr('Pas encore téléchargée')), dl ? 'maps' : 'map'),
    row(graphOk, 'Chemins pour revenir sur la trace', graphOk ? `${pack.graph.km} km` : dl ? escH(tr('Après la carte')) : escH(tr('Itinéraire de retour calculé même sans réseau')), dl ? 'maps' : 'map'),
    row(poiOk, 'Points d\'eau et refuges', poiOk ? `${mine.prepPois.length} <span>${escH(tr('près de la trace, gardés sur le téléphone : visibles même sans réseau'))}</span>` : escH(tr('Indisponibles pour cette zone')), 'poi'),
    battRow,
    row('info', 'Météo', escH(tr('Regarde-la avant de partir : elle ne se met pas à jour sans réseau.')), 'wx'),
  ].join('');
  $('prepOff').querySelectorAll('.prep-row').forEach(bt => bt.onclick = () => prepAct(bt.dataset.act, { saved, mapOk, graphOk, poiOk, it }));
  const todo = !saved || !mapOk || !graphOk;
  $('prepOffGo').hidden = !todo;
  return { saved, mapOk, graphOk, poiOk };
}
async function prepMapDl() {
  if (navigator.onLine === false) { toast('Pas de connexion : télécharge la carte avant de partir, en Wi-Fi si possible.', 5000); return; }
  // le panneau Préparer reste ouvert dessous : « Retour » ou « Fermer » y ramène
  await openMaps();
  $('dlTrace').click();
}
async function prepAct(act, s) {
  stat('prep_ligne_' + act);
  if (act === 'keep') {
    if (s.saved) { libFolder = s.it.folder; openLib(); return; }
    const f = await prepKeep();
    if (f) toast(tr('Rangée dans « ' + f + ' »'), 3000, { label: tr('Voir'), run: () => { libFolder = f; openLib(); } });
    prepOffline();
  } else if (act === 'maps') { openMaps();
  } else if (act === 'map') {
    if (s.mapOk && s.graphOk) { openMaps(); return; }
    prepMapDl();
  } else if (act === 'poi') {
    if (track && !s.poiOk) { delete track.prepPois; prepRender(); }
    else prepPoiList(true);
  } else if (act === 'batt') {
    if (eco === 'max') toast('Économie de batterie déjà activée : écran noir entre les virages.', 4000);
    else toast('Pour tenir plus longtemps : économie de batterie (écran noir entre les virages, la carte revient aux virages).', 7000, { label: tr('Activer'), run: () => setEco('max') });
  } else if (act === 'wx') {
    prepLeave('Météo du parcours sur le profil.');
    if (!$('btnWx').hidden && !$('btnWx').classList.contains('on')) $('btnWx').click();
  }
}
// liste des points d'eau et refuges le long de la trace, rangés par jour ; toucher un point le montre sur la carte
function prepPoiList(open) {
  const pois = track && Array.isArray(track.prepPois) ? track.prepPois.filter(p => p.k === 'w' || p.k === 's' || PREP_NIGHT[p.k]) : null;
  const btn = $('prepPoiBtn'), list = $('prepPoiList');
  btn.hidden = !pois || !pois.length;
  if (!pois || !pois.length) { list.hidden = true; return; }
  if (open != null) list.hidden = !open;
  btn.innerHTML = `${list.hidden ? '▸' : '▾'} <span>${escH(tr(list.hidden ? 'Voir les points d\'eau et refuges' : 'Masquer la liste'))}</span> (${pois.length})`;
  if (list.hidden) return;
  const st = prepStages(prepDays(), track.prepPois);
  let day = 0, html = '';
  for (const p of pois) {
    while (st.length > 1 && day < st.length && p.along > st[day].to + 1) day++;
    if (st.length > 1 && !html.includes(`data-day="${day}"`)) html += `<li class="pp-day" data-day="${day}"><span>${escH(tr('Jour'))}</span> ${day + 1}</li>`;
    html += `<li><button class="pp-row" data-a="${Math.round(p.along)}" data-k="${p.k}"><b>${kmN(p.along)}${kmU()}</b><span>${POI[p.k][0]} ${escH(tr(POI[p.k][2]))}${p.nm ? ' · ' + escH(p.nm) : ''}</span><small>${p.d > 30 ? fmtDist(Math.round(p.d / 10) * 10) : ''}</small></button></li>`;
  }
  list.innerHTML = html;
  list.querySelectorAll('.pp-row').forEach(b => b.onclick = () => {
    const p = pois.find(q => Math.round(q.along) === +b.dataset.a && q.k === b.dataset.k); if (!p) return;
    const q = pointAt(track, p.along);
    if (!poiOn()) { store.set('poi', '1'); $('optPoi').checked = true; }
    prepLeave(`${POI[p.k][0]} ${tr(POI[p.k][2])}${p.nm ? ' · ' + p.nm : ''} · km ${kmN(p.along)}`);
    map.flyTo({ center: [q.lon, q.lat], zoom: 15 });
  });
  if (open) setTimeout(() => btn.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}
$('prepPoiBtn').onclick = () => prepPoiList($('prepPoiList').hidden);
// quitter le panneau pour regarder la carte ou le profil : « Retour » (ou le bouton du message) y ramène
let prepBack = false;
function prepLeave(msg) {
  $('prepSheet').hidden = true; prepBack = true;
  toast(msg, 6000, { label: tr('↩ Préparer'), run: prepOpen });
}
function prepOpen() { prepBack = false; if (!track) return; $('prepSheet').hidden = false; prepRender(); }
// téléchargement lancé d'ici : la liste se met à jour quand il se termine
let prepDlWas = false;
setInterval(() => { const d = !!dl; if (d !== prepDlWas) { prepDlWas = d; if (!$('prepSheet').hidden) prepOffline(); } }, 3000);
// en revenant de Mes cartes ou de Mes traces : la liste se met à jour
for (const id of ['maps', 'lib']) new MutationObserver(() => { if ($(id).hidden && !$('prepSheet').hidden) prepOffline(); }).observe($(id), { attributes: true, attributeFilter: ['hidden'] });

$('prepBook').onclick = () => prepRoadbook();
$('prepOffGo').onclick = async () => {
  if (!track) return;
  stat('prep_horsligne');
  await prepKeep();
  prepMapDl();
};
// ---------- feuille de route : une page à garder ou imprimer (étapes, eau, refuges, secours) ----------
const SOS_NUM = {
  ign: [['112', 'Urgences (toute l\'Europe)'], ['15', 'SAMU'], ['18', 'Pompiers'], ['114', 'Urgences par SMS']],
  es: [['112', 'Urgences']], de: [['112', 'Urgences']], be: [['112', 'Urgences']],
  ch: [['144', 'Ambulance'], ['1414', 'Rega (secours en hélicoptère)'], ['112', 'Urgences']],
  at: [['140', 'Secours en montagne'], ['144', 'Ambulance'], ['112', 'Urgences']],
  gb: [['999', 'Urgences : demander la police, puis le secours en montagne'], ['112', 'Urgences']],
  ca: [['911', 'Urgences']], us: [['911', 'Urgences']]
};
const sosFor = (lon, lat) => SOS_NUM[natAt(lon, lat)] || [['112', 'Urgences (Europe et nombreux pays)']];
async function prepRoadbook() {
  if (!track) return;
  stat('prep_feuille');
  const T = track, n = prepDays(), pois = Array.isArray(T.prepPois) ? T.prepPois : await prepPois(T).catch(() => null);
  const stages = prepStages(n, pois), bike = prepBike(), e = escH, t = s => e(tr(s));
  const km = d => kmN(d) + kmU(), s0 = T.pts[0], s1 = T.pts[T.pts.length - 1], ll = p => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
  const W = pois ? prepWaterGaps(pois) : null, pl = pois ? pois.filter(p => p.k === 'w' || p.k === 's' || PREP_NIGHT[p.k]) : [];
  const notes = (T.wpts || []).map(w => { const pr = project(T, w, true); return pr && pr.dist < 300 ? { along: pr.along, name: w.name || w.desc || '' } : null; }).filter(x => x && x.name);
  // profil entre deux distances : remplissage dégradé, points d'eau (bleu) et refuges sous la courbe, étapes en bandes
  const eleAt = d => { const i = pointAt(T, d).i; return T.ele[Math.min(i, T.ele.length - 1)] ?? 0; };
  let gid = 0;
  const prof = (from, to, Wd, H, bands) => {
    if (!T.hasEle || to - from < 50) return '';
    const N = 240, xs = [], es = [];
    for (let k = 0; k <= N; k++) { const d = from + (to - from) * k / N; xs.push(d); es.push(eleAt(d)); }
    let lo = Math.min(...es), hi = Math.max(...es); if (hi - lo < 60) { const m = (hi + lo) / 2; lo = m - 30; hi = m + 30; }
    const top = 16, bot = H - 20, sy = v => bot - (v - lo) / (hi - lo) * (bot - top), sx = d => (d - from) / (to - from) * Wd, id = 'g' + (++gid);
    const path = es.map((v, k) => `${k ? 'L' : 'M'}${sx(xs[k]).toFixed(1)},${sy(v).toFixed(1)}`).join('');
    let s = `<svg viewBox="0 0 ${Wd} ${H}" class="prof" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e9783a" stop-opacity=".55"/><stop offset="1" stop-color="#e9783a" stop-opacity=".06"/></linearGradient></defs>`;
    if (bands) bands.forEach((b, i) => { if (i % 2) s += `<rect x="${sx(b.from)}" y="0" width="${sx(b.to) - sx(b.from)}" height="${bot}" fill="#2F5E45" opacity=".06"/>`; s += `<text x="${(sx(b.from) + sx(b.to)) / 2}" y="11" font-size="10.5" font-weight="700" fill="#2F5E45" text-anchor="middle">${t('Jour')} ${b.n}</text>`; if (i) s += `<line x1="${sx(b.from)}" x2="${sx(b.from)}" y1="14" y2="${bot}" stroke="#2F5E45" stroke-width="1" stroke-dasharray="3 3" opacity=".6"/>`; });
    s += `<path d="${path}L${Wd},${bot}L0,${bot}Z" fill="url(#${id})"/><path d="${path}" fill="none" stroke="#d9541e" stroke-width="2" stroke-linejoin="round"/>`;
    for (const p of pl) if (p.along >= from && p.along <= to) s += p.k === 'w' || p.k === 's' ? `<circle cx="${sx(p.along).toFixed(1)}" cy="${bot + 5}" r="3" fill="${p.k === 'w' ? '#2f80ed' : '#8fb8de'}"/>` : `<rect x="${(sx(p.along) - 3).toFixed(1)}" y="${bot + 2}" width="6" height="6" rx="1" fill="#8a5a3b"/>`;
    s += `<text x="2" y="${H - 1}" font-size="10" fill="#6b746f">${Math.round(lo)} m</text><text x="${Wd - 2}" y="${H - 1}" font-size="10" fill="#6b746f" text-anchor="end">${Math.round(hi)} m max</text></svg>`;
    return s;
  };
  const tile = (v, l) => `<div class="tl"><b>${v}</b><span>${t(l)}</span></div>`;
  const poiLine = p => `<li><b>${km(p.along)}</b> ${POI[p.k][0]} ${t(POI[p.k][2])}${p.nm ? ' · ' + e(p.nm) : ''}${p.d > 60 ? ` <i>${fmtDist(Math.round(p.d / 10) * 10)} ${t('de la trace')}</i>` : ''}</li>`;
  const dayCards = stages.map(s => {
    const inDay = pl.filter(p => p.along >= s.from - 1 && p.along <= s.to + 1), gaps = W ? W.gaps.filter(g => g.to > s.from && g.from < s.to) : [];
    const noteL = notes.filter(x => x.along >= s.from && x.along <= s.to);
    const end = s.last ? `🏁 ${t('Arrivée')}` : s.night ? `${POI[s.night.k][0]} ${t(POI_NAME[s.night.k])}${s.night.nm ? ' · <b>' + e(s.night.nm) + '</b>' : ''}` : `🌙 ${t('Nuit : lieu à trouver (pas de refuge ni d\'abri repéré)')}`;
    return `<section class="day"><header><span class="dn">${n > 1 ? `${t('Jour')} ${s.n}` : t('Parcours')}</span><span class="km">${km(s.from)} → ${km(s.to)}</span></header>
<div class="tiles">${tile(fmtDist(s.dist), 'Distance')}${T.hasEle ? tile(fmtM(s.up), 'D+') + tile(fmtM(s.down), 'D−') : ''}${tile(fmtDur(s.secs), bike ? 'à vélo' : 'de marche')}</div><p class="note pz">${t('Avec les pauses : environ')} ${fmtDur(s.secs * 1.3)}</p>
${prof(s.from, s.to, 700, 120)}
${gaps.length ? gaps.map(g => `<p class="warn">⚠️ ${km(Math.max(g.from, s.from))} → ${km(Math.min(g.to, s.to))} : ${t('pas de point d\'eau potable connu')}${g.src.length ? ` (${g.src.length} ${t(g.src.length > 1 ? 'sources, eau non garantie' : 'source, eau non garantie')})` : ''} — ${t('prévoir de quoi boire')}</p>`).join('') : ''}
${inDay.length ? `<ul class="pts">${inDay.map(poiLine).join('')}</ul>` : ''}
${noteL.length ? `<ul class="pts notes">${noteL.map(x => `<li><b>${km(x.along)}</b> 📍 ${e(x.name)}</li>`).join('')}</ul>` : ''}
<p class="end">${end}</p></section>`;
  }).join('');
  const sos = sosFor(s0.lon, s0.lat);
  let link = ''; try { link = await routeLink(T.name, T.pts, { desc: T.desc, wpts: T.wpts }, 300); } catch {}
  let qr = '';
  try { const q = qrcode(0, 'L'); q.addData(link); q.make(); const m = q.getModuleCount(); let r = ''; for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) if (q.isDark(y, x)) r += `M${x},${y}h1v1h-1z`; qr = `<svg viewBox="-2 -2 ${m + 4} ${m + 4}" class="qr"><rect x="-2" y="-2" width="${m + 4}" height="${m + 4}" fill="#fff"/><path d="${r}"/></svg>`; } catch {}
  const dateTxt = new Date().toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric' });
  let html = `<!doctype html><html lang="${LANG}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(T.name || 'Pisteo')} · ${t('Feuille de route')}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef1ea;color:#17201c;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:780px;margin:0 auto;padding:0 0 28px}
.hero{background:linear-gradient(135deg,#2F5E45,#3f7a5b);color:#fff;padding:22px 18px 18px;border-radius:0 0 22px 22px}
.hero small{display:block;opacity:.8;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
.hero h1{margin:4px 0 2px;font-size:26px;line-height:1.15}.hero p{margin:0;opacity:.85}
.hero .tiles{margin-top:14px}.hero .tl{background:rgba(255,255,255,.14)}.hero .tl span{color:#fff;opacity:.8}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(74px,1fr));gap:6px;margin:10px 0}.pz{margin:-4px 0 4px}
.tl{background:#f3f5f0;border-radius:12px;padding:8px 9px}.tl b{display:block;font-size:17px;font-variant-numeric:tabular-nums;white-space:nowrap}.tl span{font-size:11.5px;color:#5d6963}
.card,.day{background:#fff;border-radius:18px;padding:14px 16px;margin:12px 12px 0;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h2{font-size:12.5px;letter-spacing:.07em;text-transform:uppercase;color:#2F5E45;margin:0 0 8px}
.prof{display:block;width:100%;height:auto;margin:6px 0 2px}.leg{font-size:11.5px;color:#5d6963;margin:2px 0 0}.leg i{display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 4px 0 10px;vertical-align:middle}
.day header{display:flex;justify-content:space-between;align-items:baseline;gap:8px;border-bottom:2px solid #2F5E45;padding-bottom:6px}
.dn{font-size:20px;font-weight:800;color:#2F5E45}.km{color:#5d6963;font-variant-numeric:tabular-nums}
.warn{margin:8px 0 0;padding:8px 10px;border-radius:10px;background:#fbefd8;color:#5b3d00;font-size:13.5px}
.pts{list-style:none;margin:8px 0 0;padding:0}.pts li{padding:5px 0;border-top:1px solid #edf0ea;font-size:13.5px}.pts b{display:inline-block;min-width:58px;font-variant-numeric:tabular-nums}.pts i{color:#6b746f;font-style:normal;font-size:12px}
.end{margin:10px 0 0;padding:9px 12px;border-radius:12px;background:#e6efe8;font-size:14px}
.sos{border:2px solid #c62828}.sos h2{color:#c62828}.nums{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;align-items:center}.nums b{font-size:24px;color:#c62828;font-variant-numeric:tabular-nums}
.coords{margin:10px 0 0;font-variant-numeric:tabular-nums}.note{color:#5d6963;font-size:12.5px}
.qrbox{display:flex;gap:14px;align-items:center}.qr{width:118px;height:118px;flex:none}a{color:#2F5E45;word-break:break-all}
.foot{text-align:center;color:#6b746f;font-size:12px;margin:18px 0 0}
.bar{position:sticky;top:0;z-index:2;display:flex;justify-content:center;padding:8px;background:rgba(238,241,234,.92);backdrop-filter:blur(6px)}
.bar button{font:600 15px system-ui,sans-serif;padding:10px 18px;border-radius:12px;border:0;background:#2F5E45;color:#fff}
@media print{@page{size:A4;margin:12mm}body{background:#fff}.bar{display:none}.hero{border-radius:14px}.card,.day{box-shadow:none;border:1px solid #dde3d8;margin:10px 0 0;break-inside:avoid}.wrap{max-width:none}}
</style></head><body><div class="bar"><button onclick="window.print()">${t('Imprimer ou enregistrer en PDF')}</button></div><div class="wrap">
<div class="hero"><small>${t('Feuille de route')} · ${e(dateTxt)}</small><h1>${e(T.name || tr('Parcours'))}</h1><p>${t(bike ? 'à vélo' : 'à pied')}${n > 1 ? ` · ${n} ${t('jours')}` : ''}</p>
<div class="tiles">${tile(fmtDist(T.total), 'Distance')}${T.hasEle ? tile(fmtM(T.totalUp), 'D+') + tile(fmtM(T.totalDown), 'D−') : ''}${tile(fmtDur(effTo(T.total)), bike ? 'à vélo' : 'de marche')}</div></div>
${T.hasEle ? `<div class="card"><h2>${t('Profil')}</h2>${prof(0, T.total, 700, 150, n > 1 ? stages : null)}<p class="leg"><i style="background:#2f80ed"></i>${t('Eau potable')}<i style="background:#8fb8de"></i>${t('Source')}<i style="background:#8a5a3b;border-radius:2px"></i>${t('Refuge, cabane, abri')}</p></div>` : ''}
${dayCards}
<div class="card sos"><h2>${t('Secours')}</h2><div class="nums">${sos.map(([num, l]) => `<b>${num}</b><span>${t(l)}</span>`).join('')}</div>
<p class="coords">${t('Départ')} : ${ll(s0)}<br>${t('Arrivée')} : ${ll(s1)}</p><p class="note">${t('Avant de partir, laisse cette feuille ou le lien du parcours à un proche, avec ton heure de retour prévue.')}</p></div>
${link ? `<div class="card"><h2>${t('Ouvrir le parcours')}</h2><div class="qrbox">${qr}<p class="note">${t('À scanner pour ouvrir le parcours dans Pisteo')}<br><a href="${e(link)}">${e(link.length > 60 ? link.slice(0, 60) + '…' : link)}</a></p></div></div>` : ''}
<p class="note" style="margin:12px 16px 0">${t(bike ? 'Temps à vélo estimé selon ton allure, sans les pauses.' : 'Temps de marche estimé selon ton allure, sans les pauses.')} ${t('Données OpenStreetMap : vérifie sur place, et emporte de quoi tenir.')}</p>
<p class="foot">${t('Préparé avec Pisteo')} · pisteo.app</p></div></body></html>`;
  // séparateur décimal de la langue (hors dessins)
  if (DICT && DICT.decimal !== ',') html = html.split(/(<svg[\s\S]*?<\/svg>)/).map((x, i) => i % 2 ? x : x.replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')).join('');
  const fname = (T.name || 'parcours').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) + ' - ' + tr('feuille de route') + '.html';
  if (AND && AND.openWith) { try { AND.openWith(fname, 'text/html', html, tr('Ouvrir la feuille de route avec')); return; } catch {} }
  const w = window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
  if (!w) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' })); a.download = fname; a.click(); }
}
// ---------- sécurité : prévenir un proche (heure de retour), secours ----------
const dtLocal = ms => { const d = new Date(ms), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
// retour prévu par défaut : départ (heure choisie pour la météo, sinon maintenant) + temps estimé + 30 % de pauses ;
// sur plusieurs jours : le dernier jour à la même heure d'arrivée
function prepRetDefault() {
  const start = depAt() || Date.now(), n = prepDays();
  const last = prepStages(n, Array.isArray(track.prepPois) ? track.prepPois : null).pop();
  let t = start + effTo(track.total) * 1300;
  if (n > 1) { const d = new Date(start + (n - 1) * 864e5); d.setHours(8, 30, 0, 0); t = d.getTime() + last.secs * 1300; }
  return Math.ceil(t / 9e5) * 9e5;
}
function prepSafety() {
  let ret = null; try { ret = JSON.parse(store.get('sosReturn') || 'null'); } catch {}
  prepRetT = ret && ret.key === trKey() && ret.t > Date.now() ? ret.t : prepRetDefault(); prepRetUI();
  $('prepTellInfo').innerHTML = ret && ret.key === trKey() && ret.t > Date.now() - 864e5
    ? `✓ <span>${escH(tr('Proche prévenu · retour prévu'))}</span> ${escH(new Date(ret.t).toLocaleString(LOC, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}` : '';
}
async function shareMsg(text, title) {
  if (AND && AND.shareText) { try { AND.shareText(text, title); return true; } catch {} }
  if (navigator.share) { try { await navigator.share({ title, text }); return true; } catch (e) { if (e.name === 'AbortError') return false; } }
  toast(copyText(text) ? 'Message copié : colle-le dans un SMS ou WhatsApp.' : text, 5000); return true;
}
$('prepTell').onclick = async () => {
  if (!track) return;
  const ret = prepRetT;
  if (!ret || isNaN(ret)) { toast('Choisis ton heure de retour prévue.', 3500); return; }
  stat('securite_proche');
  const n = prepDays(), s0 = track.pts[0], late = ret + 2 * 3600e3, num = sosFor(s0.lon, s0.lat)[0][0];
  const when = ms => new Date(ms).toLocaleString(LOC, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  let link = ''; try { link = await routeLink(track.name, track.pts, { desc: track.desc, wpts: track.wpts }); } catch {}
  const C = LANG === 'fr' ? ' : ' : ': ';
  let msg = [
    `${tr('Je pars sur ce parcours')}${C}${track.name || tr('Parcours')} (${fmtDist(track.total)}${track.hasEle ? ', ' + tr('D+') + ' ' + fmtM(track.totalUp) : ''}${n > 1 ? ', ' + n + ' ' + tr('jours') : ''}, ${tr(prepBike() ? 'à vélo' : 'à pied')}).`,
    `${tr('Départ')}${C}${s0.lat.toFixed(5)}, ${s0.lon.toFixed(5)}.`,
    `${tr('Retour prévu')}${C}${when(ret)}.`,
    `${tr('Sans nouvelles de moi le')} ${when(late)}, ${tr('appelle le')} ${num} ${tr('et donne-leur ce parcours')}${C.trimEnd()}`,
    link
  ].filter(Boolean).join('\n');
  if (DICT && DICT.decimal !== ',') msg = msg.replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2');
  if (await shareMsg(msg, tr('Ma sortie'))) {
    store.set('sosReturn', JSON.stringify({ key: trKey(), name: track.name || '', t: ret, said: 0 }));
    prepSafety();
  }
};
// heure de retour : un jour en pastille (aujourd'hui, demain, puis les 12 jours suivants) et l'heure au quart d'heure
let prepRetT = 0;
const dayStart = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
function prepRetUI() {
  if (!prepRetT) return;
  const t0 = dayStart(Date.now()), sel = dayStart(prepRetT), days = [];
  for (let k = 0; k < 14; k++) { const d = new Date(t0); d.setDate(d.getDate() + k); days.push(d.getTime()); }
  if (!days.includes(sel)) days.push(sel);
  const lab = (d, k) => k === 0 ? tr('Aujourd\'hui') : k === 1 ? tr('Demain') : new Date(d).toLocaleDateString(LOC, { weekday: 'short', day: 'numeric' });
  $('prepRetDays').innerHTML = days.map((d, k) => `<button role="option" data-d="${d}" class="${d === sel ? 'on' : ''}" aria-selected="${d === sel}">${escH(lab(d, Math.round((d - t0) / 864e5)))}</button>`).join('');
  $('prepRetTime').textContent = new Date(prepRetT).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
  $('prepRetSum').textContent = new Date(prepRetT).toLocaleString(LOC, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  $('prepRetDays').querySelectorAll('button').forEach(b => b.onclick = () => {
    const d = new Date(+b.dataset.d), o = new Date(prepRetT); d.setHours(o.getHours(), o.getMinutes(), 0, 0);
    prepRetT = d.getTime(); $('prepTellInfo').textContent = ''; prepRetUI();
  });
  const on = $('prepRetDays').querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
}
document.querySelectorAll('.ret-time button').forEach(b => b.onclick = () => {
  prepRetT = Math.max(Date.now(), prepRetT + +b.dataset.t * 60000); prepRetT = Math.round(prepRetT / 9e5) * 9e5;
  $('prepTellInfo').textContent = ''; prepRetUI();
});
// secours : position actuelle (ou départ de la trace), numéros du pays, appel et envoi de la position
function openSos() {
  stat('secours_ouvre');
  const fresh = me && !me.sim && me.t && Date.now() - me.t < 5 * 60000 ? me : null;
  const p = fresh || me || (track && track.pts[0]) || null;
  $('sosPosL').textContent = tr(fresh ? 'Ma position' : me ? 'Dernière position connue' : track ? 'Départ du parcours (pas de position GPS)' : 'Pas de position GPS');
  $('sosCoord').textContent = p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : '–';
  const meta = [];
  if (p && p.ele != null && !isNaN(p.ele)) meta.push(`${tr('Altitude')} ${fmtM(p.ele)}`);
  if (fresh && fresh.acc) meta.push(`± ${fmtM(fresh.acc)}`);
  if (fresh && fresh.t) meta.push(new Date(fresh.t).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }));
  $('sosMeta').textContent = meta.join(' · ');
  const nums = p ? sosFor(p.lon, p.lat) : [['112', 'Urgences (Europe et nombreux pays)']];
  $('sosCall').href = 'tel:' + nums[0][0]; $('sosCall').textContent = `${tr('Appeler le')} ${nums[0][0]}`;
  $('sosNums').innerHTML = nums.map(([n, l]) => `<a href="tel:${n}">${n}</a><span>${escH(tr(l))}</span>`).join('');
  $('sosShare').hidden = !(fresh || me);
  $('sosSheet').dataset.lat = p ? p.lat : ''; $('sosSheet').dataset.lon = p ? p.lon : '';
  $('sosSheet').hidden = false;
}
$('sosShare').onclick = () => {
  const lat = +$('sosSheet').dataset.lat, lon = +$('sosSheet').dataset.lon; if (!lat && !lon) return;
  stat('secours_position');
  const c = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  shareMsg(`${tr('Ma position')}${LANG === 'fr' ? ' : ' : ': '}${c}\nhttps://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=16/${lat.toFixed(5)}/${lon.toFixed(5)}\nhttps://maps.google.com/?q=${lat.toFixed(5)},${lon.toFixed(5)}`, tr('Ma position'));
};
$('sosCall').addEventListener('click', () => { try { stat('secours_appel'); } catch {} });
$('sosClose').onclick = () => { $('sosSheet').hidden = true; };
$('sosSheet').onclick = e => { if (e.target === $('sosSheet')) $('sosSheet').hidden = true; };
$('npSos').onclick = openSos;
$('prepSosBtn').onclick = openSos;
// rappel : heure de retour dépassée pendant la sortie, puis « bien rentré » à la fin
function sosRet() { try { return JSON.parse(store.get('sosReturn') || 'null'); } catch { return null; } }
setInterval(() => {
  const r = sosRet(); if (!r) return;
  if (Date.now() > r.t + 3 * 864e5) { store.set('sosReturn', ''); return; }
  if (r.said || Date.now() < r.t || !(nav || actState === 'on' || actState === 'paused')) return;
  r.said = 1; store.set('sosReturn', JSON.stringify(r)); stat('securite_retard');
  vibrate([300, 150, 300]); say('Ton heure de retour prévue est passée. Pense à prévenir ton proche.', true);
  toast('Heure de retour prévue dépassée', 15000, { label: 'Prévenir', run: () => shareMsg(tr('Petit retard sur ma sortie, tout va bien. Je te redis quand je suis rentré(e).'), tr('Ma sortie')) });
}, 60000);
endActivity = (fn => async function (keep) {
  const r = await fn.apply(this, arguments);
  const s = sosRet();
  if (s && Date.now() > s.t - 864e5 * 4) {
    store.set('sosReturn', '');
    setTimeout(() => toast('Bien rentré ? Préviens ton proche.', 12000, { label: 'Envoyer', run: () => shareMsg(tr('Bien rentré(e) de ma sortie, tout va bien !'), tr('Ma sortie')) }), 1500);
  }
  return r;
})(endActivity);
function prepUpdate() {
  const show = !!track && !nav && track.total > 2000;
  $('btnPrep').hidden = !show; if (!show) prepBack = false;
  if (!show) { prepMarkers(null); $('prepSheet').hidden = true; return; }
  // bouton : nombre de jours retenu pour cette trace (le détail se calcule à l'ouverture)
  const n = store.get(prepKey()) ? prepDays() : 1;
  prepHintSet(n, false);
  if (n > 1 && track.prepFor !== track.id) { track.prepFor = track.id; prepRender(); }
  else if (n < 2) prepMarkers(null);
}
$('btnPrep').onclick = () => { stat('prep_ouvre'); prepOpen(); };
$('prepClose').onclick = () => { $('prepSheet').hidden = true; };
$('prepSheet').onclick = e => { if (e.target === $('prepSheet')) $('prepSheet').hidden = true; };
$('prepDays').onchange = e => { store.set(prepKey(), e.target.value); stat('prep_jours'); prepRender(); };
function prepStagesWire(stages, n) {
  const save = a => { store.set(prepEndsKey(n), JSON.stringify(a.map(v => Math.round(v)))); stat('prep_etape_modifiee'); prepRender(); };
  const ends = () => stages.slice(0, -1).map(s => s.to);
  $('prepStages').querySelectorAll('.pl-ctl button').forEach(b => b.onclick = () => {
    const i = +b.closest('.pl-ctl').dataset.i, a = ends(), lo = i ? a[i - 1] : 0, hi = i < a.length - 1 ? a[i + 1] : track.total;
    a[i] = clamp(a[i] + +b.dataset.mv, lo + 500, hi - 500); save(a);
  });
  $('prepStages').querySelectorAll('.pl-near button').forEach(b => b.onclick = () => {
    const i = +b.closest('.pl-near').dataset.i, a = ends(); a[i] = +b.dataset.at; save(a);
  });
  const r = $('prepReset'); if (r) r.onclick = () => { store.set(prepEndsKey(n), ''); prepRender(); };
}
trChipsUpdate = (fn => function () { const r = fn.apply(this, arguments); try { prepUpdate(); } catch {} return r; })(trChipsUpdate);

// ---------- sauvegarde sur Google Drive (dossier caché de l'appli, champ drive.appdata) ----------
// appli Android 2.3+ : jeton demandé par la coquille (Google refuse les connexions dans une page intégrée) ;
// navigateur : fenêtre Google (Google Identity Services). Rien ne passe par un serveur Pisteo.
const GD_WEB_ID = '188110201759-japec6qf0ispjqvcgq05mk1l74lo7k68.apps.googleusercontent.com';
const GD_SCOPE = 'https://www.googleapis.com/auth/drive.appdata', GD_NAME = 'pisteo-sauvegarde.json', GD_API = 'https://www.googleapis.com';
var gdTok = null, gdExp = 0, gdWait = null, gdBusy = false;
const gdSupported = () => AND ? !!AND.driveAuth : true;
window.pisteoDrive = (tok, err) => {
  const w = gdWait; gdWait = null; if (!w) return;
  if (tok) { gdTok = tok; gdExp = Date.now() + 3300e3; w.ok(tok); } else w.ko(new Error(err || 'refus'));
};
function gdGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = ok; s.onerror = () => ko(new Error('réseau')); document.head.appendChild(s); });
}
function gdToken(interactive) {
  if (gdTok && Date.now() < gdExp) return Promise.resolve(gdTok);
  if (AND) {
    if (!AND.driveAuth) return Promise.reject(new Error('update'));
    return new Promise((ok, ko) => {
      gdWait = { ok, ko };
      try { AND.driveAuth(!!interactive); } catch (e) { gdWait = null; ko(e); return; }
      setTimeout(() => { if (gdWait && gdWait.ok === ok) { gdWait = null; ko(new Error('timeout')); } }, 180000);
    });
  }
  if (!interactive) return Promise.reject(new Error('consent')); // le navigateur ne peut pas le faire sans un toucher
  return gdGis().then(() => new Promise((ok, ko) => {
    const c = google.accounts.oauth2.initTokenClient({ client_id: GD_WEB_ID, scope: GD_SCOPE,
      callback: r => { if (r && r.access_token) { gdTok = r.access_token; gdExp = Date.now() + ((+r.expires_in || 3600) - 120) * 1000; ok(gdTok); } else ko(new Error((r && r.error) || 'refus')); },
      error_callback: e => ko(new Error((e && e.type) || 'refus')) });
    c.requestAccessToken({ prompt: '' });
  }));
}
async function gdFetch(url, opt = {}, interactive = false, retry = true) {
  const t = await gdToken(interactive);
  let r;
  try { r = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ Authorization: 'Bearer ' + t }, opt.headers || {}) })); }
  catch (e) { throw new Error('réseau'); }
  // jeton périmé (Android peut redonner un jeton déjà ancien) : on en redemande un, une fois
  if (r.status === 401) { gdTok = null; if (retry) return gdFetch(url, opt, interactive, false); throw new Error('auth'); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r;
}
async function gdFind(i) {
  const q = encodeURIComponent(`name='${GD_NAME}'`);
  const r = await gdFetch(`${GD_API}/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,size)&orderBy=modifiedTime%20desc`, {}, i);
  return ((await r.json()).files || [])[0] || null;
}
async function gdSave(i) {
  const data = await bkData(); if (!data) return null;
  const body = JSON.stringify(data), f = await gdFind(i);
  if (f) await gdFetch(`${GD_API}/upload/drive/v3/files/${f.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }, i);
  else {
    const b = 'pisteo' + Date.now(), meta = JSON.stringify({ name: GD_NAME, parents: ['appDataFolder'] });
    await gdFetch(`${GD_API}/upload/drive/v3/files?uploadType=multipart`, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b },
      body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--` }, i);
  }
  store.set('gdDate', String(Date.now()));
  return data;
}
const gdErr = e => e.message === 'update' ? 'Mets à jour l\'appli Pisteo (Play Store) pour la sauvegarde Drive.'
  : /refus|cancel|consent|12501|16:/i.test(e.message) ? 'Connexion à Google annulée.'
  : navigator.onLine === false ? 'Pas de réseau.' : 'Drive indisponible pour l\'instant (' + e.message + ').';
function gdUI() {
  const ok = gdSupported(), d = +store.get('gdDate') || 0;
  $('gdNow').disabled = $('gdRestore').disabled = $('gdAutoChk').disabled = !ok;
  $('gdAutoChk').checked = store.get('gdAuto') === '1';
  $('gdState').textContent = !ok ? tr('Mise à jour de l\'appli nécessaire') : store.get('gdAuto') === '1' && store.get('gdNeed') === '1' ? tr('Sauvegarde automatique en pause : touche « Sauvegarder sur Drive » pour te reconnecter à Google') : d ? tr('Dernière sauvegarde :') + ' ' + new Date(d).toLocaleString(LOC, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : tr('Pas encore utilisée');
}
const gdBtnBusy = (b, on) => b.classList.toggle('busy', on);
$('gdNow').onclick = async () => {
  if (gdBusy) return; gdBusy = true; gdBtnBusy($('gdNow'), true); bkSay('Sauvegarde sur Google Drive…');
  try { const d = await gdSave(true); store.set('gdNeed', ''); bkSay(d ? 'Sauvegardé sur Google Drive : ' + bkCount(d.tracks) + '.' : 'Rien à sauvegarder pour l\'instant.'); if (d && store.get('gdAuto') == null) { store.set('gdAuto', '1'); } }
  catch (e) { bkSay(gdErr(e)); }
  gdBusy = false; gdBtnBusy($('gdNow'), false); gdUI();
};
$('gdRestore').onclick = async () => {
  if (gdBusy) return; gdBusy = true; gdBtnBusy($('gdRestore'), true); bkSay('Recherche de ta sauvegarde sur Google Drive…');
  try {
    const f = await gdFind(true);
    if (!f) bkSay('Aucune sauvegarde Pisteo sur ce compte Google.');
    else { const r = await gdFetch(`${GD_API}/drive/v3/files/${f.id}?alt=media`, {}, true); await bkRestore(await r.json()); }
  } catch (e) { bkSay(gdErr(e)); }
  gdBusy = false; gdBtnBusy($('gdRestore'), false); gdUI();
};
$('gdAutoChk').onchange = async e => {
  store.set('gdAuto', e.target.checked ? '1' : '0');
  if (e.target.checked && !store.get('gdDate')) $('gdNow').onclick(); // première fois : connexion + première sauvegarde
  gdUI();
};
// automatique : après une sortie gardée (now) et au plus une fois par jour, sans rien demander (pas de fenêtre Google)
async function gdAuto(now) {
  if (store.get('gdAuto') !== '1' || !gdSupported() || gdBusy || navigator.onLine === false) return;
  if (!now && Date.now() - (+store.get('gdDate') || 0) < 20 * 3600e3) return;
  gdBusy = true;
  // Google redemande l'accord : impossible sans un toucher → on le signale dans les réglages ; sinon nouvel essai plus tard
  try { await gdSave(false); store.set('gdNeed', ''); } catch (e) { if (e.message === 'consent') store.set('gdNeed', '1'); }
  gdBusy = false; gdUI();
}
setTimeout(() => gdAuto(false), 15000);

// =====================================================================
// Statistiques anonymes d'utilisation (réglage « Partager des statistiques anonymes », activé par défaut)
// Des compteurs du jour, gardés sur le téléphone ; le résumé d'une journée finie est envoyé une fois au relais.
// Aucun identifiant, aucune position, aucun tracé.
// =====================================================================
const STATS_ON = () => store.get('statsOff') !== '1';
function statDay() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
// premier jour de l'appareil (pour « nouveaux / habitués ») ; déjà là avant ce suivi : « ancien »
if (!store.get('statFirst')) store.set('statFirst', store.get('stats') ? 'ancien' : statDay());
function statAge(d) {
  const f = store.get('statFirst'); if (!f || f === 'ancien') return 'ancien';
  const n = Math.round((Date.parse(d) - Date.parse(f)) / 864e5);
  return !(n > 0) ? 'nouveau' : n <= 7 ? 'j1-7' : n <= 30 ? 'j8-30' : 'j30';
}
function statLoad() { try { return JSON.parse(store.get('stats') || '{}') || {}; } catch { return {}; } }
function stat(name, n = 1) {
  if (!STATS_ON()) return;
  try {
    const all = statLoad(), d = statDay(), day = all[d] || (all[d] = {});
    const k = String(name).replace(/[^\w:.\-]/g, '_').slice(0, 60);
    if (k === 'nav' || k === 'sortie_pied' || k === 'sortie_velo') store.set('statActif', '1');
    if (Object.keys(day).length > 150 && !(k in day)) return;
    day[k] = Math.round(((day[k] || 0) + n) * 10) / 10;
    store.set('stats', JSON.stringify(all));
  } catch {}
}
// contexte de la journée : appli ou navigateur, langue, version, réglages principaux
function statDims(d) {
  const ua = navigator.userAgent, w = innerWidth;
  return {
    plat: AND ? 'android' : /Android/i.test(ua) ? 'web-android' : /iPhone|iPad/i.test(ua) ? 'web-ios' : 'web-pc',
    lang: LANG, ver: String(APP_VERSION), mode: profile === 'trekking' ? 'velo' : 'pied', units: IMP ? 'mi' : 'km',
    theme: store.get('theme') || 'auto', screen: w < 500 ? 'tel' : w < 1000 ? 'tablette' : 'grand',
    voice: store.get('voice') === '0' ? 'off' : 'on', eco: store.get('eco') || 'off', poi: store.get('poi') === '0' ? 'off' : 'on',
    night: store.get('alertNight') === '1' ? 'on' : 'off', lit: store.get('litNight') === '1' ? 'on' : 'off',
    strava: (() => { try { return stvOn() ? 'oui' : 'non'; } catch { return 'non'; } })(), drive: store.get('gdAuto') === '1' ? 'auto' : 'non',
    layer: (LAYERS[layerIdx] || {}).id || '?', age: statAge(d),
    // provenance : robot de test Google (Firebase Test Lab), toi (appareil marqué) ou un utilisateur
    src: (() => { try { if (AND && AND.testLab && AND.testLab()) return 'robot'; } catch {} return store.get('statMoi') === '1' ? 'moi' : 'humain'; })(),
    // a déjà lancé une navigation ou gardé une sortie sur cet appareil ; nombre de jours où l'appli a été ouverte
    actif: store.get('statActif') === '1' ? 'oui' : 'non',
    jours: (n => n <= 1 ? 'j1' : n <= 6 ? 'j2-6' : n <= 13 ? 'j7-13' : 'j14plus')(+(store.get('statJours') || 1)),
    os: (m => m ? 'android' + m[1] : '')(ua.match(/Android (\d+)/)) || (m => m ? 'ios' + m[1] : '')(ua.match(/OS (\d+)_\d+.* like Mac OS X/)) || 'autre'
  };
}
let statSending = false;
async function statFlush() {
  if (statSending || !STATS_ON() || navigator.onLine === false) return;
  const all = statLoad(), today = statDay(), days = Object.keys(all).filter(d => d < today).sort();
  if (!days.length) return;
  statSending = true;
  try {
    for (const d of days) {
      if (d < new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10)) { delete all[d]; continue; } // trop vieux : oublié
      const first = store.get('statFirst'), done = (store.get('statRet') || '').split(',');
      const age = first && first !== 'ancien' ? Math.round((Date.parse(d) - Date.parse(first)) / 864e5) : -1;
      const ms = [1, 7, 30].filter(m => age >= m && !done.includes(String(m)));
      const body = { d, c: all[d], dims: statDims(d) }; if (ms.length) body.ret = { first, m: ms };
      const r = await fetch(STRAVA_RELAY + '/stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok && r.status !== 400) break;
      if (ms.length) store.set('statRet', done.concat(ms.map(String)).filter(Boolean).join(','));
      delete all[d];
    }
    const cur = statLoad(); for (const d of Object.keys(cur)) if (!(d in all) && d < today) delete cur[d];
    store.set('stats', JSON.stringify(cur));
  } catch {} finally { statSending = false; }
}
// heure d'utilisation (heure du téléphone), comptée à chaque ouverture ou retour dans l'appli
const statHour = () => stat('heure_' + String(new Date().getHours()).padStart(2, '0'));
stat('open'); statHour();
// jours d'ouverture de l'appli sur cet appareil (compté à partir de la version 263)
const statOpenDay = () => { const d = statDay(); if (store.get('statLastDay') !== d) { store.set('statLastDay', d); store.set('statJours', String(+(store.get('statJours') || 0) + 1)); } };
statOpenDay();
// appareil du développeur : 7 touches rapides sur « Version … » en bas des réglages (ou le lien ?moi=1)
{
  const moiMsg = on => toast(on ? 'Statistiques : cet appareil est compté à part (« Moi »).' : 'Statistiques : cet appareil est de nouveau compté comme un utilisateur.', 4500);
  try { const t = sessionStorage.getItem('moiToast'); if (t) { sessionStorage.removeItem('moiToast'); setTimeout(() => moiMsg(t === '1'), 1500); } } catch {}
  let taps = 0, last = 0;
  $('note').addEventListener('click', () => {
    const n = Date.now(); taps = n - last < 1500 ? taps + 1 : 1; last = n;
    if (taps < 7) return;
    taps = 0; const on = store.get('statMoi') !== '1';
    try { if (on) localStorage.setItem('statMoi', '1'); else localStorage.removeItem('statMoi'); } catch {}
    moiMsg(on);
  });
}
setTimeout(statFlush, 8000); setInterval(statFlush, 3600e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { stat('resume'); statHour(); statOpenDay(); statFlush(); } });
// boutons touchés (un compteur par bouton utile)
const STAT_BTN = {
  btnNav: 'nav_btn', btnNew: 'autre_trajet', destLoop: 'boucle_ouvrir', lpGo: 'boucle', lbAgain: 'boucle_autre', lbEdit: 'boucle_modifier', lbKeep: 'boucle_garder', lbGo: 'boucle_naviguer',
  destPlan: 'point_par_point', ptView: 'pp_apercu', ptDone: 'pp_naviguer', destPick: 'choisir_carte', destFree: 'balade_libre', destRoutes: 'balises_ouvrir', rtpGo: 'balise_naviguer', rtpKeep: 'balise_garder',
  btnWx: 'meteo', wxDepBtn: 'meteo_depart', depOk: 'meteo_depart_ok', wxInfo: 'meteo_legende', btnLit: 'eclairage', btnReverse: 'inverser', btnWatch: 'envoyer_parcours', wtLink: 'lien_partage', wtQr: 'qr_code', wtPropose: 'catalogue_proposer',
  btnSaveTr: 'trace_enregistrer', btnOpen: 'gpx_ouvrir', btnSorties: 'mes_sorties', btnMaps: 'mes_cartes', btnStrava: 'strava_ouvrir', btnBackup: 'sauvegarde_ouvrir', btnFeedback: 'avis',
  stvConnect: 'strava_connecter', sdStrava: 'sortie_strava', sdStvView: 'strava_voir', sdShare: 'sortie_partager', sdExport: 'sortie_export', sdFollow: 'sortie_refaire', sdPhAdd: 'photo_ajouter', phCam: 'photo_camera',
  gdNow: 'drive_maintenant', gdRestore: 'drive_restaurer', btnRejoin: 'retour_trace', btnOverview: 'vue_ensemble', npHome: 'retour_depart', npResume: 'reprendre_parcours', btnLayer: 'fond_changer',
  btnPip: 'pip', btnEcoFab: 'eco_bouton', btnRecFab: 'rec_bouton', npRec: 'rec_panneau', npReport: 'signaler_osm', npProfOnly: 'profil_seul', btnExit: 'terminer', finSave: 'sortie_garder', finDelete: 'sortie_jeter', finContinue: 'sortie_continuer',
  rtFoot: 'balises_pied', rtBike: 'balises_velo', rtFiltT: 'balises_tous', rtFiltD: 'balises_balises', rtFiltU: 'balises_recommandes'
};
document.addEventListener('click', e => { const b = e.target.closest('[id]'); if (b && STAT_BTN[b.id]) stat(STAT_BTN[b.id]); }, true);
// évènements internes
const _st = (name, fn, before) => function (...a) { try { before ? before.apply(this, a) : stat(name); } catch {} return fn.apply(this, a); };
startNav = _st('nav', startNav, free => { stat('nav'); stat(free ? 'nav_libre' : track && track.route ? 'nav_vers_lieu' : 'nav_trace'); });
// précision GPS pendant l'enregistrement, par tranche (jamais la position) : comptée en mémoire, ajoutée chaque minute
const gpsAcc = { gps_bon: 0, gps_moyen: 0, gps_mauvais: 0 };
const gpsFlush = () => { for (const k in gpsAcc) if (gpsAcc[k]) { stat(k, gpsAcc[k]); gpsAcc[k] = 0; } };
setInterval(gpsFlush, 60000);
onPos = (fn => function (pos) {
  try { if (recording && pos && !pos.sim && pos.acc != null) gpsAcc[pos.acc <= 10 ? 'gps_bon' : pos.acc <= 30 ? 'gps_moyen' : 'gps_mauvais']++; } catch {}
  return fn.apply(this, arguments);
})(onPos);
// sortie faite au moins un moment sans réseau
addEventListener('offline', () => { if (recording) store.set('statOffline', '1'); });
// batterie au début de l'enregistrement (ignorée si le téléphone charge)
const battGet = () => navigator.getBattery ? navigator.getBattery().catch(() => null) : Promise.resolve(null);
battGet().then(b => b && b.addEventListener('chargingchange', () => { if (recording && b.charging) store.set('statBatt', 'x'); }));
beginRecording = (fn => function () {
  try {
    store.set('statOffline', navigator.onLine === false ? '1' : '');
    store.set('statBatt', ''); battGet().then(b => { if (b && !b.charging) store.set('statBatt', JSON.stringify({ l: b.level, t: Date.now() })); else store.set('statBatt', 'x'); });
  } catch {}
  return fn.apply(this, arguments);
})(beginRecording);
endActivity = (fn => async function (keep) {
  try {
    gpsFlush();
    if (keep && rec.length > 1) {
      if (store.get('statOffline') === '1') stat('sortie_hors_ligne');
      const b0 = (() => { try { return JSON.parse(store.get('statBatt') || 'null'); } catch { return null; } })(), b = b0 && b0.t ? await battGet() : null;
      if (b && !b.charging && b0.l > b.level) { const h = (Date.now() - b0.t) / 3600e3; if (h >= 0.25 && h < 24) { stat('batt_pct', Math.round((b0.l - b.level) * 100)); stat('batt_h', Math.round(h * 100) / 100);
        // consommation de ce téléphone, gardée pour l'estimation avant départ (moyenne glissante, en %/h)
        if (h >= 0.5) { const r = clamp((b0.l - b.level) * 100 / h, 1, 60), o = +store.get('battRate') || 0; store.set('battRate', String(Math.round((o ? o * .6 + r * .4 : r) * 10) / 10)); } } }
    }
    store.set('statBatt', ''); store.set('statOffline', '');
  } catch {}
  return fn.apply(this, arguments);
})(endActivity);
endActivity = (fn => async function (keep) {
  try {
    if (keep && rec.length > 1) {
      const km = recDist() / 1000, bike = profile === 'trekking', min = (act.ms || 0) / 60000, g = recGaps(rec);
      stat(bike ? 'sortie_velo' : 'sortie_pied'); stat(bike ? 'km_velo' : 'km_pied', Math.round(km * 10) / 10); stat('minutes_sortie', Math.round(min));
      if (g.n) { stat('sortie_coupee'); stat('coupure_min', Math.round(g.ms / 60000)); }
    } else if (!keep) stat('sortie_supprimee');
  } catch {}
  return fn.apply(this, arguments);
})(endActivity);
makeLoop = (fn => async function () {
  const t0 = Date.now(); stat(profile === 'trekking' ? 'boucle_velo' : 'boucle_pied'); try { if (profile !== 'trekking' && routeLitOn()) stat('boucle_nuit'); } catch {}
  const r = await fn.apply(this, arguments); stat('boucle_secondes', Math.round((Date.now() - t0) / 1000)); stat('boucle_calculs'); return r;
})(makeLoop);
goTo = _st('vers_lieu', goTo);
// services d'itinéraire : réussites et échecs (hors absence de réseau)
const _svc = (name, fn) => async function () {
  try { const r = await fn.apply(this, arguments); stat('svc_' + name + '_ok'); return r; }
  catch (e) { if (navigator.onLine !== false) stat('svc_' + name + '_echec'); throw e; }
};
brFetchMain = _svc('brouter', brFetchMain);
osrmFetch = _svc('osrm', osrmFetch);
// issue d'une recherche de boucle ratée (repérée par le message affiché)
toast = (fn => function (t) {
  try { const m = String(t); if (/^Aucune boucle trouvée/.test(m)) stat('boucle_introuvable'); else if (/^Le serveur d'itinéraires ne répond pas/.test(m)) stat('boucle_echec_serveur'); else if (/^Pas de réseau : boucle/.test(m)) stat('boucle_sans_reseau'); } catch {}
  return fn.apply(this, arguments);
})(toast);
// démarrage : page ouverte → carte prête, puis carte entièrement affichée
ready.then(() => { stat('perf_demarrage_ms', Math.round(performance.now())); stat('perf_demarrage_n'); map.once('idle', () => { stat('perf_carte_ms', Math.round(performance.now())); stat('perf_carte_n'); }); });
requestRejoin = _st('', requestRejoin, manual => stat(manual ? 'retour_trace_manuel' : 'retour_trace_auto'));
reroute = _st('recalcul', reroute);
stvUploadNow = (fn => async function () { try { const r = await fn.apply(this, arguments); stat('strava_envoi_ok'); return r; } catch (e) { stat('strava_envoi_echec'); throw e; } })(stvUploadNow);
openStvManual = _st('strava_manuel', openStvManual);
gdSave = (fn => async function () { try { const r = await fn.apply(this, arguments); stat('drive_ok'); return r; } catch (e) {
  stat('drive_echec');
  // raison de l'échec, en catégories (jamais le texte complet) : accord, délai, jeton, réseau, code HTTP…
  const m = String(e && e.message || ''), why = m === 'consent' ? 'accord' : m === 'timeout' ? 'delai' : m === 'auth' ? 'jeton' : m === 'réseau' || navigator.onLine === false ? 'reseau'
    : /^HTTP \d+$/.test(m) ? 'http' + m.slice(5) : /refus|cancel|12501|16:/i.test(m) ? 'refus' : m === 'update' ? 'maj' : 'autre';
  stat('drive_err_' + why); throw e; } })(gdSave);
downloadPack = _st('', downloadPack, pack => stat('carte_' + (pack.cc || (pack.kind === 'dep' ? 'fr' : pack.kind || 'zone'))));
setLayer = _st('', setLayer, (i, remember) => { if (remember !== false && LAYERS[i]) stat('fond_' + LAYERS[i].id); });
shareGPX = _st('gpx_partage', shareGPX);
// erreurs de l'appli (message court) : pour repérer les bugs
addEventListener('error', e => { if (e && e.message) stat('err:' + String(e.message).replace(/^Uncaught\s*/, '').slice(0, 50)); });
addEventListener('unhandledrejection', e => { const m = e && e.reason && (e.reason.message || String(e.reason)); if (m && !/abort|Failed to fetch|NetworkError|Load failed/i.test(m)) stat('err:' + String(m).slice(0, 50)); });
$('optStats').checked = STATS_ON();
$('optStats').onchange = e => { store.set('statsOff', e.target.checked ? '' : '1'); if (!e.target.checked) store.set('stats', ''); };
})();

// au doigt, une liste ou une case garde le cadre bleu de sélection après le choix : on le retire une fois la valeur choisie
document.addEventListener('change', e => { const t = e.target; if (t && (t.tagName === 'SELECT' || t.type === 'checkbox')) setTimeout(() => t.blur(), 400); }, true);
