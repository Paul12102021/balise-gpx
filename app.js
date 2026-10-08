/* Balise GPX — suivi de trace GPX sur smartphone */
(() => {
'use strict';

// ---------- utilitaires ----------
const $ = id => document.getElementById(id);
const R = 6371000, rad = d => d * Math.PI / 180;
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = m => m == null ? '–' : (m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 1 : 2).replace('.', ',') + ' km' : Math.round(m) + ' m');
const fmtM = m => m == null || isNaN(m) ? '–' : Math.round(m) + ' m';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* quota */ } },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
let toastT;
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms);
}

// ---------- carte ----------
const LAYERS = [
  { name: 'OpenTopoMap', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', sub: 'abc', max: 17,
    attr: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)' },
  { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', sub: '', max: 19,
    attr: '© OpenStreetMap' }
];
let layerIdx = +(store.get('layer') || 0) % LAYERS.length;
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([45.9, 6.6], 11);
let tileLayer;
function setLayer(i) {
  if (tileLayer) map.removeLayer(tileLayer);
  const l = LAYERS[i];
  tileLayer = L.tileLayer(l.url, { subdomains: l.sub || 'a', maxZoom: l.max, attribution: l.attr, crossOrigin: true }).addTo(map);
  store.set('layer', i);
}
setLayer(layerIdx);
$('btnLayer').onclick = () => { layerIdx = (layerIdx + 1) % LAYERS.length; setLayer(layerIdx); toast('Fond : ' + LAYERS[layerIdx].name); };

// ---------- trace ----------
let track = null;            // { name, pts:[{lat,lon,ele}], cum:[m], up:[m] }
let trackLine, startMk, endMk;

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
  const nameEl = doc.querySelector('trk > name, rte > name, metadata > name');
  return { name: nameEl ? nameEl.textContent.trim() : 'Trace sans nom', pts };
}

function prepareTrack(t) {
  const { pts } = t, n = pts.length;
  // lissage léger de l'altitude (moyenne glissante sur 5 points) pour un D+ réaliste
  const hasEle = pts.some(p => p.ele != null);
  const ele = pts.map((p, i) => {
    if (!hasEle) return null;
    let s = 0, c = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (pts[k].ele != null) { s += pts[k].ele; c++; }
    return c ? s / c : null;
  });
  const cum = [0], up = [0];
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + haversine(pts[i - 1], pts[i]);
    const d = (ele[i] != null && ele[i - 1] != null) ? ele[i] - ele[i - 1] : 0;
    up[i] = up[i - 1] + (d > 0 ? d : 0);
  }
  t.ele = ele; t.cum = cum; t.up = up; t.hasEle = hasEle;
  t.total = cum[n - 1]; t.totalUp = up[n - 1];
  return t;
}

function showTrack(t, fit = true) {
  track = prepareTrack(t);
  [trackLine, startMk, endMk].forEach(l => l && map.removeLayer(l));
  const ll = t.pts.map(p => [p.lat, p.lon]);
  const css = getComputedStyle(document.documentElement);
  trackLine = L.polyline(ll, { color: css.getPropertyValue('--track').trim() || '#c2187a', weight: 5, opacity: .85 }).addTo(map);
  startMk = L.circleMarker(ll[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#2f8a4c', fillOpacity: 1 }).addTo(map).bindTooltip('Départ');
  endMk = L.circleMarker(ll[ll.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#17201c', fillOpacity: 1 }).addTo(map).bindTooltip('Arrivée');
  if (fit) map.fitBounds(trackLine.getBounds(), { padding: [30, 30], paddingBottomRight: [30, 220] });
  $('trackName').textContent = `${t.name} · ${fmtDist(t.total)}${t.hasEle ? ' · D+ ' + fmtM(t.totalUp) : ''}`;
  lastIdx = 0; progress = null;
  drawProfile(); updateHud();
}

function loadText(text, save = true) {
  try {
    const t = parseGPX(text);
    showTrack(t);
    if (save) store.set('gpx', text.length < 4.5e6 ? text : '');
    toast('Trace chargée : ' + t.pts.length + ' points');
  } catch (e) { toast(e.message, 4000); }
}
$('fileIn').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader(); r.onload = () => loadText(r.result); r.readAsText(f); e.target.value = '';
};

// ---------- projection de ma position sur la trace ----------
let lastIdx = 0, progress = null; // progress: {dist, along, idx, frac}
function project(pos) {
  const P = track.pts, n = P.length, kx = Math.cos(rad(pos.lat)) * 111320, ky = 110540;
  // fenêtre de recherche autour du dernier point, puis recherche globale si on est loin
  const scan = (from, to) => {
    let best = { d2: Infinity };
    for (let i = Math.max(0, from); i < Math.min(n - 1, to); i++) {
      const ax = (P[i].lon - pos.lon) * kx, ay = (P[i].lat - pos.lat) * ky;
      const bx = (P[i + 1].lon - pos.lon) * kx, by = (P[i + 1].lat - pos.lat) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      let f = L2 ? -(ax * dx + ay * dy) / L2 : 0; f = Math.max(0, Math.min(1, f));
      const px = ax + f * dx, py = ay + f * dy, d2 = px * px + py * py;
      if (d2 < best.d2) best = { d2, idx: i, frac: f };
    }
    return best;
  };
  let b = scan(lastIdx - 50, lastIdx + 400);
  if (n < 1 || b.d2 > 150 * 150) { const g = scan(0, n); if (g.d2 < b.d2) b = g; }
  if (b.idx == null) return null;
  lastIdx = b.idx;
  const segLen = track.cum[b.idx + 1] - track.cum[b.idx];
  const along = track.cum[b.idx] + b.frac * segLen;
  const segUp = track.up[b.idx + 1] - track.up[b.idx];
  const upDone = track.up[b.idx] + b.frac * segUp;
  return { dist: Math.sqrt(b.d2), along, idx: b.idx, frac: b.frac, upLeft: track.totalUp - upDone };
}

// ---------- GPS ----------
let watchId = null, me = null, meMk, accCircle, follow = true, wakeLock = null;
const meIcon = L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => { if (watchId != null && document.visibilityState === 'visible') keepAwake(); });

function startGPS() {
  if (!('geolocation' in navigator)) { toast('Ce navigateur ne donne pas accès au GPS.', 4000); return false; }
  if (watchId != null) return true;
  watchId = navigator.geolocation.watchPosition(onPos, err => {
    const m = { 1: 'Accès à la position refusé. Autorise la localisation pour ce site dans les réglages.',
                2: 'Position indisponible. Va à découvert pour capter le GPS.', 3: 'Le GPS met du temps à répondre…' };
    toast(m[err.code] || err.message, 4500);
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  keepAwake();
  return true;
}
function stopGPS() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

function onPos(p) {
  const c = p.coords;
  me = { lat: c.latitude, lon: c.longitude, ele: c.altitude, acc: c.accuracy, t: p.timestamp };
  const ll = [me.lat, me.lon];
  if (!meMk) {
    accCircle = L.circle(ll, { radius: me.acc, className: 'me-acc', weight: 1 }).addTo(map);
    meMk = L.marker(ll, { icon: meIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
    map.setView(ll, Math.max(map.getZoom(), 15));
  } else { meMk.setLatLng(ll); accCircle.setLatLng(ll).setRadius(me.acc); }
  if (follow) map.panTo(ll, { animate: true });
  if (recording) addRecPoint(me);
  if (track && following) { progress = project(me); checkOffTrack(); }
  updateHud(); drawProfile();
}

let following = false;
$('btnFollow').onclick = () => {
  if (!following) {
    if (!track) { toast('Ouvre d\'abord un fichier GPX.'); return; }
    if (!startGPS()) return;
    following = true; follow = true; unlockAudio();
    $('btnFollow').textContent = 'Arrêter le suivi'; $('btnFollow').classList.add('active');
    $('btnCenter').classList.add('on');
  } else {
    following = false; progress = null; hideAlert();
    $('btnFollow').textContent = 'Démarrer le suivi'; $('btnFollow').classList.remove('active');
    if (!recording) stopGPS();
    updateHud(); drawProfile();
  }
};
$('btnCenter').onclick = () => {
  follow = true; $('btnCenter').classList.add('on');
  if (me) map.setView([me.lat, me.lon], Math.max(map.getZoom(), 16)); else startGPS();
};
map.on('dragstart', () => { follow = false; $('btnCenter').classList.remove('on'); });

// ---------- alerte hors trace ----------
let threshold = +(store.get('thr') || 50), offCount = 0, isOff = false, muted = false, audioCtx;
$('thr').value = String(threshold);
$('thr').onchange = e => { threshold = +e.target.value; store.set('thr', threshold); };

function unlockAudio() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch {}
}
function beep() {
  if (muted || !audioCtx) return;
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
let lastBeep = 0;
function checkOffTrack() {
  if (!progress) return;
  // on ignore les positions trop imprécises pour ne pas déclencher de fausse alerte
  const tol = threshold + Math.min(me.acc || 0, 60) * .5;
  if (progress.dist > tol && (me.acc || 0) < 100) offCount++; else offCount = 0;
  if (offCount >= 2) {
    const now = Date.now();
    if (!isOff || now - lastBeep > 20000) {
      if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
      beep(); lastBeep = now;
    }
    isOff = true;
    showAlert(`à ${fmtDist(progress.dist)} de la trace`);
  } else if (isOff && progress.dist < threshold * .7) {
    isOff = false; muted = false;
    if (navigator.vibrate) navigator.vibrate(120);
    const a = $('alert'); a.classList.add('back'); $('alertTxt').textContent = '— de retour sur la trace';
    $('btnMute').hidden = true; setTimeout(hideAlert, 3000);
  }
}
function showAlert(txt) { const a = $('alert'); a.classList.remove('back'); a.hidden = false; $('alertTxt').textContent = txt; $('btnMute').hidden = false; }
function hideAlert() { $('alert').hidden = true; $('alert').classList.remove('back'); }
$('btnMute').onclick = () => { muted = true; toast('Son coupé jusqu\'au retour sur la trace'); };

// ---------- HUD ----------
function updateHud() {
  const pr = progress;
  $('sDist').textContent = track ? fmtDist(pr ? track.total - pr.along : track.total) : '–';
  $('sUp').textContent = track && track.hasEle ? fmtM(pr ? pr.upLeft : track.totalUp) : '–';
  const off = $('sOff');
  off.textContent = pr ? fmtDist(pr.dist) : '–';
  off.classList.toggle('bad', !!pr && pr.dist > threshold);
  $('sEle').textContent = me && me.ele != null ? fmtM(me.ele) : (pr && track.ele[pr.idx] != null ? '≈' + fmtM(track.ele[pr.idx]) : '–');
}

// ---------- profil altimétrique ----------
const cv = $('profile');
function drawProfile() {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement), col = v => css.getPropertyValue(v).trim();
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = col('--muted');
  if (!track) { ctx.fillText('Le profil altimétrique apparaîtra ici.', 0, H / 2); return; }
  if (!track.hasEle) { ctx.fillText('Ce GPX ne contient pas d\'altitudes.', 0, H / 2); return; }
  const E = track.ele, C = track.cum, n = E.length;
  let lo = Infinity, hi = -Infinity; E.forEach(e => { if (e != null) { lo = Math.min(lo, e); hi = Math.max(hi, e); } });
  const pad = Math.max(20, (hi - lo) * .08); lo -= pad; hi += pad;
  const L0 = 38, B = 16, w = W - L0 - 4, h = H - B - 4;
  const X = d => L0 + d / track.total * w, Y = e => 4 + (1 - (e - lo) / (hi - lo)) * h;
  // grille
  const step = [10, 20, 50, 100, 200, 250, 500, 1000].find(s => (hi - lo) / s <= 4) || 1000;
  ctx.strokeStyle = col('--line'); ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const y = Math.round(Y(v)) + .5; ctx.beginPath(); ctx.moveTo(L0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillText(v + '', L0 - 4, y);
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('0', L0, H); ctx.textAlign = 'right'; ctx.fillText(fmtDist(track.total), W, H);
  // courbe
  const stride = Math.max(1, Math.floor(n / (w * 2)));
  const path = new Path2D(); let first = true;
  for (let i = 0; i < n; i += stride) { if (E[i] == null) continue; const x = X(C[i]), y = Y(E[i]); first ? path.moveTo(x, y) : path.lineTo(x, y); first = false; }
  if (E[n - 1] != null) path.lineTo(X(C[n - 1]), Y(E[n - 1]));
  const area = new Path2D(path); area.lineTo(X(track.total), 4 + h); area.lineTo(L0, 4 + h); area.closePath();
  ctx.fillStyle = col('--track'); ctx.globalAlpha = .14; ctx.fill(area); ctx.globalAlpha = 1;
  ctx.strokeStyle = col('--track'); ctx.lineWidth = 2; ctx.stroke(path);
  // ma position sur le profil
  if (progress && E[progress.idx] != null) {
    const x = X(progress.along), y = Y(E[progress.idx]);
    ctx.strokeStyle = col('--me'); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, 4 + h); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col('--me'); ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
}
window.addEventListener('resize', drawProfile);

// ---------- enregistrement de ma trace ----------
let recording = false, rec = [], recLine;
try { rec = JSON.parse(store.get('rec') || '[]'); } catch { rec = []; }
function recDist() { let d = 0; for (let i = 1; i < rec.length; i++) d += haversine(rec[i - 1], rec[i]); return d; }
function updRecInfo() { $('recInfo').textContent = rec.length ? `(${rec.length} pts · ${fmtDist(recDist())})` : '(vide)'; }
function drawRec() {
  const ll = rec.map(p => [p.lat, p.lon]);
  if (!recLine) recLine = L.polyline(ll, { color: getComputedStyle(document.documentElement).getPropertyValue('--rec').trim(), weight: 3, dashArray: '6 6' }).addTo(map);
  else recLine.setLatLngs(ll);
}
function addRecPoint(p) {
  if (p.acc > 50) return;
  const last = rec[rec.length - 1];
  if (last && haversine(last, p) < 5) return; // évite d'accumuler des points à l'arrêt
  rec.push({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), ele: p.ele != null ? +p.ele.toFixed(1) : null, t: p.t });
  if (rec.length % 5 === 0) store.set('rec', JSON.stringify(rec));
  drawRec(); updRecInfo();
}
if (rec.length) { drawRec(); updRecInfo(); }
$('btnRec').onclick = () => {
  const b = $('btnRec');
  if (!recording) {
    if (!startGPS()) return;
    recording = true; b.classList.add('recording'); b.lastChild.textContent = 'Arrêter';
    toast(rec.length ? 'Enregistrement repris' : 'Enregistrement démarré');
  } else {
    recording = false; b.classList.remove('recording'); b.lastChild.textContent = 'Enregistrer';
    store.set('rec', JSON.stringify(rec)); if (!following) stopGPS();
    toast('Enregistrement en pause · ' + fmtDist(recDist()));
  }
};
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
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: fname }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = fname;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

// ---------- cartes hors ligne ----------
function tileXY(lat, lon, z) {
  const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2 * n);
  return [x, y];
}
function tilesAlongTrack(zmin, zmax) {
  const set = new Set(), l = LAYERS[layerIdx], subs = (l.sub || '').split('').filter(Boolean);
  for (let z = zmin; z <= zmax; z++) {
    let lastKey = '';
    for (const p of track.pts) {
      const [x, y] = tileXY(p.lat, p.lon, z), key = x + '/' + y;
      if (key === lastKey) continue; lastKey = key;
      // la tuile + ses voisines immédiates pour garder de la marge autour du chemin
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) set.add(`${z}/${x + dx}/${y + dy}`);
    }
  }
  return [...set].map(k => {
    const [z, x, y] = k.split('/');
    // même sous-domaine que Leaflet, pour que la carte retrouve les tuiles en cache
    return l.url.replace('{s}', subs.length ? subs[Math.abs(+x + +y) % subs.length] : '').replace('{z}', z).replace('{x}', x).replace('{y}', y);
  });
}
let dlRunning = false;
$('btnOffline').onclick = async () => {
  if (!track) { toast('Ouvre d\'abord un fichier GPX.'); return; }
  if (!('caches' in window)) { toast('Ce navigateur ne permet pas le stockage hors ligne.', 4000); return; }
  if (dlRunning) return;
  const urls = tilesAlongTrack(11, 16);
  if (urls.length > 4000) { toast(`Trace trop longue (${urls.length} tuiles). Découpe-la en étapes.`, 5000); return; }
  dlRunning = true; $('btnOffline').disabled = true; $('offProg').hidden = false;
  const cache = await caches.open('tiles-v1');
  let done = 0, fail = 0;
  const step = async () => {
    while (urls.length) {
      const u = urls.shift();
      try {
        if (!(await cache.match(u))) {
          const r = await fetch(u, { mode: 'cors' });
          if (r.ok) await cache.put(u, r); else fail++;
        }
      } catch { fail++; }
      done++;
      const tot = done + urls.length;
      $('offBar').style.width = (done / tot * 100) + '%';
      $('offTxt').textContent = `${done} / ${tot} tuiles`;
    }
  };
  await Promise.all([step(), step(), step()]); // 3 requêtes à la fois, pour ménager les serveurs de cartes
  dlRunning = false; $('btnOffline').disabled = false;
  $('offTxt').textContent = fail ? `Terminé · ${fail} tuiles en échec, relance pour compléter` : 'Carte disponible hors ligne ✓';
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
};

// ---------- exemple ----------
$('btnDemo').onclick = () => {
  // boucle fictive autour du lac d'Annecy (Semnoz), altitudes synthétiques
  const pts = [], c = [45.82, 6.10], N = 400;
  for (let i = 0; i <= N; i++) {
    const a = i / N * 2 * Math.PI;
    const r = .028 + .006 * Math.sin(3 * a) + .003 * Math.cos(7 * a);
    pts.push(`<trkpt lat="${(c[0] + r * Math.sin(a)).toFixed(6)}" lon="${(c[1] + r * 1.4 * Math.cos(a)).toFixed(6)}"><ele>${(900 + 520 * Math.sin(a / 2) ** 2 + 60 * Math.sin(9 * a)).toFixed(1)}</ele></trkpt>`);
  }
  loadText(`<gpx><trk><name>Exemple · boucle du Semnoz</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`);
};

// ---------- panneau ----------
const sheet = $('sheet');
function toggleMore(open) {
  const m = $('more'); m.hidden = open === undefined ? !m.hidden : !open;
  document.body.classList.toggle('sheet-open', !m.hidden);
  $('btnMore').textContent = m.hidden ? 'Plus' : 'Moins';
}
$('btnMore').onclick = () => toggleMore(); $('grip').onclick = () => toggleMore();

// ---------- démarrage ----------
const saved = store.get('gpx');
if (saved) { try { showTrack(parseGPX(saved)); } catch {} }
else drawProfile();
if (!window.isSecureContext) $('note').textContent = 'Attention : le GPS ne fonctionne qu\'en HTTPS.';
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
