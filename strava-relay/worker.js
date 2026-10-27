// Relais Strava pour Pisteo (Cloudflare Worker, gratuit)
// Il garde le « Client Secret » de l'appli Strava hors du code public de Pisteo
// et transmet les envois de sorties à Strava.
// Variables à définir dans Cloudflare (Settings → Variables and Secrets) :
//   STRAVA_CLIENT_ID      (texte)  ex. 290814 (appli du compte Strava Pisteo)
//   STRAVA_CLIENT_SECRET  (secret) le Client Secret de strava.com/settings/api
//   ALLOWED_ORIGIN        (texte)  https://pisteo.app,https://paul12102021.github.io
// Adresse : https://api.pisteo.app (domaine personnalisé du worker « pisteo-strava », compte Cloudflare pisteo.app)
//
// Catalogue « Parcours Pisteo » (routes /catalogue…) : propositions vérifiées automatiquement et publiées aussitôt.
//   CATALOGUE  (espace KV lié au worker, Settings → Bindings → KV namespace, nom de variable CATALOGUE)
//   ADMIN_KEY  (secret)  mot de passe de la page d'administration : https://api.pisteo.app/catalogue/admin?key=…

const API = 'https://www.strava.com/api/v3';

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : allowed[0] || '',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url), path = url.pathname;
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    // page d'administration du catalogue : ouverte depuis un navigateur (pas d'origine), protégée par ADMIN_KEY
    if (path === '/catalogue/admin') return catAdmin(req, env, url);
    // photos du catalogue : affichées par de simples balises <img> (sans origine)
    if (path.startsWith('/catalogue/img/') && req.method === 'GET') return catImg(env, url, path);
    if (!okOrigin) return new Response('Origine refusée', { status: 403, headers: cors });
    if (path.startsWith('/catalogue')) {
      try { return await catalogue(req, env, path, json); }
      catch (e) { return json({ ok: false, message: 'Erreur du serveur, réessaie plus tard.' }, 500); }
    }
    const pass = async r => new Response(await r.text(), { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });

    try {
      // échange du code d'autorisation, ou renouvellement du jeton
      if (path === '/token' && req.method === 'POST') {
        const b = await req.json();
        const body = new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET });
        if (b.code) { body.set('code', b.code); body.set('grant_type', 'authorization_code'); }
        else if (b.refresh_token) { body.set('refresh_token', b.refresh_token); body.set('grant_type', 'refresh_token'); }
        else return json({ message: 'code ou refresh_token manquant' }, 400);
        return pass(await fetch('https://www.strava.com/oauth/token', { method: 'POST', body }));
      }
      const auth = req.headers.get('Authorization') || '';
      if (!/^Bearer \S+$/.test(auth)) return json({ message: 'jeton manquant' }, 401);
      // dépôt d'un GPX
      if (path === '/upload' && req.method === 'POST') {
        return pass(await fetch(API + '/uploads', { method: 'POST', headers: { Authorization: auth }, body: await req.formData() }));
      }
      // suivi du traitement par Strava
      let m = path.match(/^\/upload\/(\d+)$/);
      if (m && req.method === 'GET') return pass(await fetch(API + '/uploads/' + m[1], { headers: { Authorization: auth } }));
      // type d'activité (vélo / marche)
      m = path.match(/^\/activity\/(\d+)$/);
      if (m && req.method === 'PUT') {
        return pass(await fetch(API + '/activities/' + m[1], { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: await req.text() }));
      }
      return json({ message: 'inconnu' }, 404);
    } catch (e) {
      return json({ message: String(e && e.message || e) }, 502);
    }
  }
};

// =====================================================================
// Catalogue « Parcours Pisteo »
// =====================================================================
// Un parcours proposé = le lien de partage de Pisteo (tracé + description + points notés, compressés).
// Il est vérifié ici automatiquement ; s'il passe, il est publié tout de suite. Trois signalements
// de personnes différentes le masquent en attendant ton avis (page d'administration).
const CAT_LIMIT_DAY = 3, CAT_REPORTS_HIDE = 3;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const b64dec = s => { const out = []; for (let i = 0; i < s.length; i += 4) { const n = [0, 1, 2, 3].map(k => B64.indexOf(s[i + k] || 'A')); const v = (n[0] << 18) | (n[1] << 12) | (n[2] << 6) | n[3]; out.push(v >> 16 & 255); if (i + 2 < s.length) out.push(v >> 8 & 255); if (i + 3 < s.length) out.push(v & 255); } return new Uint8Array(out); };
const KINDS = ['vue', 'eau', 'difficile', 'danger', 'info'];
async function inflate(u8) { const st = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return new Uint8Array(await new Response(st).arrayBuffer()); }
// même format que readRouteLink dans app.js
async function readLink(hash) {
  const m = /^#?([zr])([A-Za-z0-9_-]+)(?:~(.*))?$/.exec(hash || ''); if (!m) return null;
  let u8 = b64dec(m[2]); if (m[1] === 'z') u8 = await inflate(u8);
  if (!u8 || (u8[0] !== 1 && u8[0] !== 2)) return null;
  const v2 = u8[0] === 2, hasE = u8[1] === 1, pts = []; let i = 2;
  const get = () => { let v = 0, f = 1, b; do { b = u8[i++]; v += (b & 127) * f; f *= 128; } while (b & 128 && i < u8.length); return v & 1 ? -(v + 1) / 2 : v / 2; };
  const count = v2 ? get() : Infinity; let a = 0, o = 0, e = 0;
  while (i < u8.length && pts.length < count) { a += get(); o += get(); if (hasE) e += get(); pts.push({ lat: a / 1e5, lon: o / 1e5, ele: hasE ? e : null }); }
  let desc = '', wpts = [];
  if (v2 && i < u8.length) { const J = JSON.parse(new TextDecoder().decode(u8.subarray(i))); desc = String(J.d || ''); wpts = (Array.isArray(J.w) ? J.w : []).map(w => ({ lat: w[0] / 1e5, lon: w[1] / 1e5, kind: KINDS[w[2]] || 'info', name: String(w[3] || ''), desc: String(w[4] || '') })); }
  let name = ''; try { name = decodeURIComponent(m[3] || ''); } catch {}
  return { pts, desc, wpts, name };
}
const hav = (p, q) => { const r = Math.PI / 180, dl = (q.lat - p.lat) * r, dn = (q.lon - p.lon) * r, a = Math.sin(dl / 2) ** 2 + Math.cos(p.lat * r) * Math.cos(q.lat * r) * Math.sin(dn / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(a)); };
// textes publics : pas de lien, d'adresse e-mail, de téléphone ni de grossièretés
const BAD = /\b(connard|connasse|salope|pute|encul\w*|batard|bâtard|merde|nique|fdp|ntm|pd|fuck\w*|shit|bitch|asshole|nazi\w*|hitler)\b/i;
function badText(t) {
  if (/https?:|www\.|\.(com|fr|net|org|io|be|ch|de|es|uk)\b/i.test(t)) return 'Pas de lien internet dans les textes.';
  if (/[\w.+-]+@[\w-]+\.\w+/.test(t)) return 'Pas d\'adresse e-mail dans les textes.';
  if (/(\+?\d[\s.-]?){9,}/.test(t)) return 'Pas de numéro de téléphone dans les textes.';
  if (BAD.test(t.normalize('NFD').replace(/[̀-ͯ]/g, '')) || BAD.test(t)) return 'Merci de reformuler : certains mots ne sont pas acceptés.';
  if (/(.)\1{6,}/.test(t) || (t.length > 20 && t === t.toUpperCase() && /[A-Z]{12,}/.test(t))) return 'Merci d\'écrire le texte normalement (sans majuscules ni caractères répétés).';
  return '';
}
async function ipKey(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'inconnu';
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + (env.ADMIN_KEY || 'pisteo')));
  return [...new Uint8Array(h)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function loadIndex(env) { return (await env.CATALOGUE.get('index', 'json')) || []; }
async function saveIndex(env, idx) { await env.CATALOGUE.put('index', JSON.stringify(idx)); }
const publicItem = it => ({ id: it.id, name: it.name, sport: it.sport, dist: it.dist, up: it.up, start: it.start, bb: it.bb, desc: it.desc, h: it.h, date: it.date, ph: (it.ph || []).filter(p => p.ok).map(p => p.n) });
const CAT_PHOTOS = 3, CAT_PHOTO_MAX = 700 * 1024;

// vérifications automatiques d'une proposition : renvoie un message d'erreur, ou '' si tout va bien
async function checkProposal(b, r, idx) {
  if (!r || r.pts.length < 20) return 'Tracé illisible ou trop court.';
  if (r.pts.some(p => !isFinite(p.lat) || !isFinite(p.lon) || Math.abs(p.lat) > 85 || Math.abs(p.lon) > 180)) return 'Tracé invalide.';
  let dist = 0, gap = 0;
  for (let i = 1; i < r.pts.length; i++) { const d = hav(r.pts[i - 1], r.pts[i]); dist += d; gap = Math.max(gap, d); }
  const bike = b.sport === 'bike';
  if (dist < 1000) return 'Parcours trop court (1 km au moins).';
  if (dist > (bike ? 300000 : 120000)) return `Parcours trop long pour le catalogue (${bike ? 300 : 120} km au plus).`;
  if (gap > 5000) return 'Le tracé a des trous de plus de 5 km : ce n\'est sans doute pas un vrai parcours.';
  const name = String(b.name || '').trim(), desc = String(r.desc || '').trim();
  if (name.length < 4 || name.length > 60) return 'Le nom doit faire entre 4 et 60 caractères.';
  if (/^((sortie|balade|course|course à pied|marche|randonnée|rando|vélo|sortie à vélo|sortie vélo|activité|entraînement)( (à pied|à vélo|vtt|gravel))? (du|de la|de l'|de l’|d'|d’|le|en) ?(matin|midi|après-midi|apres-midi|soir|soirée|nuit|\d)|sortie du|trace sans nom|parcours partagé|boucle (à pied|à vélo) de|vers |(morning|afternoon|evening|night|lunch) (ride|run|walk|hike))/i.test(name)) return 'Donne un vrai nom au parcours (lieu, sommet, lac…).';
  if (desc.length < 30) return 'Ajoute une description d\'au moins 30 caractères : difficulté, départ, ce qu\'on y voit…';
  for (const t of [name, desc, ...r.wpts.map(w => w.name + ' ' + w.desc)]) { const e = badText(t); if (e) return e; }
  // doublon : même sport, départ à moins de 300 m et longueur proche, ou tracé presque identique
  for (const it of idx) {
    if (it.hidden || it.sport !== b.sport) continue;
    const s = { lat: it.start[0], lon: it.start[1] };
    if (hav(s, r.pts[0]) < 300 && Math.abs(it.dist - dist) / it.dist < 0.15) return `Ce parcours est déjà dans le catalogue (« ${it.name} »).`;
  }
  return { dist };
}

async function catalogue(req, env, path, json) {
  if (!env.CATALOGUE) return json({ ok: false, message: 'Catalogue pas encore activé.' }, 503);
  // liste publique (petite : quelques centaines de parcours au plus)
  if (path === '/catalogue' && req.method === 'GET') {
    const idx = await loadIndex(env);
    return new Response(JSON.stringify({ v: 1, items: idx.filter(it => !it.hidden).map(publicItem) }), { headers: { ...Object.fromEntries(json({}).headers), 'Cache-Control': 'public, max-age=300' } });
  }
  if (path === '/catalogue/propose' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (typeof b.h !== 'string' || b.h.length > 8000) return json({ ok: false, message: 'Lien de parcours invalide.' }, 400);
    if (b.sport !== 'foot' && b.sport !== 'bike') return json({ ok: false, message: 'Indique à pied ou à vélo.' }, 400);
    const ik = await ipKey(req, env), day = new Date().toISOString().slice(0, 10), lk = `lim:${ik}:${day}`;
    const n = +(await env.CATALOGUE.get(lk) || 0);
    if (n >= CAT_LIMIT_DAY) return json({ ok: false, message: `${CAT_LIMIT_DAY} propositions par jour au plus. Réessaie demain.` }, 429);
    let r = null; try { r = await readLink(b.h); } catch {}
    const idx = await loadIndex(env);
    const res = await checkProposal(b, r, idx);
    if (typeof res === 'string') return json({ ok: false, message: res }, 422);
    let up = 0; for (let i = 1; i < r.pts.length; i++) if (r.pts[i].ele != null && r.pts[i - 1].ele != null && r.pts[i].ele > r.pts[i - 1].ele) up += r.pts[i].ele - r.pts[i - 1].ele;
    const lats = r.pts.map(p => p.lat), lons = r.pts.map(p => p.lon);
    const tok = crypto.randomUUID(); // jeton qui permet d'ajouter les photos de ce parcours, juste après
    const it = {
      tok,
      id: crypto.randomUUID().slice(0, 8), name: String(b.name).trim().slice(0, 60), sport: b.sport, dist: Math.round(res.dist), up: r.pts[0].ele != null ? Math.round(up) : null,
      start: [r.pts[0].lat, r.pts[0].lon], bb: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)],
      desc: r.desc.trim().slice(0, 500), h: b.h, date: day, by: ik, rep: 0, hidden: false
    };
    idx.push(it); await saveIndex(env, idx);
    await env.CATALOGUE.put(lk, String(n + 1), { expirationTtl: 2 * 86400 });
    return json({ ok: true, id: it.id, tok, message: 'Parcours publié dans le catalogue. Merci !' });
  }
  // photos d'un parcours qu'on vient de proposer (3 au plus) : visibles après ton accord sur la page d'administration
  // l'appli les envoie réduites et réenregistrées (sans position GPS ni autres métadonnées)
  if (path === '/catalogue/photo' && req.method === 'POST') {
    const url = new URL(req.url), id = url.searchParams.get('id'), tok = url.searchParams.get('tok');
    const idx = await loadIndex(env), it = idx.find(x => x.id === id);
    if (!it || !tok || it.tok !== tok) return json({ ok: false, message: 'Parcours introuvable.' }, 404);
    if (Date.now() - Date.parse(it.date + 'T00:00:00Z') > 3 * 86400e3) return json({ ok: false, message: 'Trop tard pour ajouter des photos.' }, 403);
    it.ph = it.ph || [];
    if (it.ph.length >= CAT_PHOTOS) return json({ ok: false, message: `${CAT_PHOTOS} photos au plus par parcours.` }, 422);
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.length < 2000 || buf.length > CAT_PHOTO_MAX || buf[0] !== 0xFF || buf[1] !== 0xD8) return json({ ok: false, message: 'Photo refusée (format ou taille).' }, 422);
    const n = it.ph.length ? Math.max(...it.ph.map(p => p.n)) + 1 : 0;
    await env.CATALOGUE.put(`img:${id}:${n}`, buf);
    it.ph.push({ n, ok: false }); await saveIndex(env, idx);
    return json({ ok: true, message: 'Photo reçue : visible après validation.' });
  }
  if (path === '/catalogue/report' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const ik = await ipKey(req, env), rk = `rep:${b.id}:${ik}`;
    if (await env.CATALOGUE.get(rk)) return json({ ok: true, message: 'Déjà signalé, merci.' });
    const idx = await loadIndex(env), it = idx.find(x => x.id === b.id);
    if (!it) return json({ ok: false, message: 'Parcours introuvable.' }, 404);
    it.rep = (it.rep || 0) + 1; (it.why = it.why || []).push(String(b.why || '').slice(0, 200));
    if (it.rep >= CAT_REPORTS_HIDE) it.hidden = true;
    await saveIndex(env, idx); await env.CATALOGUE.put(rk, '1', { expirationTtl: 90 * 86400 });
    return json({ ok: true, message: 'Merci, le signalement est pris en compte.' });
  }
  return json({ ok: false, message: 'inconnu' }, 404);
}

// page d'administration : liste des parcours, masquer / remettre / supprimer
async function catAdmin(req, env, url) {
  const html = (body, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catalogue Pisteo</title><style>body{font:15px system-ui,sans-serif;margin:16px;color:#17201c}li{margin:10px 0;padding:10px;border:1px solid #ccc;border-radius:10px;list-style:none}.h{opacity:.55}button{margin:4px 6px 0 0;padding:6px 10px}small{color:#666}</style>${body}`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const key = url.searchParams.get('key') || '';
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY || !env.CATALOGUE) return html('<p>Accès refusé.</p>', 403);
  const idx = await loadIndex(env);
  if (req.method === 'POST') {
    const f = await req.formData(), id = f.get('id'), act = f.get('act'), i = idx.findIndex(x => x.id === id);
    if (i >= 0) {
      const it = idx[i], n = +f.get('n');
      if (act === 'del') { for (const p of it.ph || []) await env.CATALOGUE.delete(`img:${id}:${p.n}`); idx.splice(i, 1); }
      else if (act === 'phok' || act === 'phno') {
        const p = (it.ph || []).find(x => x.n === n);
        if (p && act === 'phok') p.ok = true;
        if (p && act === 'phno') { it.ph = it.ph.filter(x => x !== p); await env.CATALOGUE.delete(`img:${id}:${n}`); }
      } else { it.hidden = act === 'hide'; if (act === 'show') it.rep = 0; }
      await saveIndex(env, idx);
    }
    return Response.redirect(url.toString(), 303);
  }
  const k = encodeURIComponent(key), rows = idx.slice().reverse().map(it => `<li class="${it.hidden ? 'h' : ''}"><b>${esc(it.name)}</b> <small>${it.sport === 'bike' ? 'vélo' : 'à pied'} · ${(it.dist / 1000).toFixed(1)} km${it.up != null ? ' · D+ ' + it.up + ' m' : ''} · ${it.date}${it.rep ? ` · <b>${it.rep} signalement(s)</b>` : ''}${it.hidden ? ' · MASQUÉ' : ''}</small><br>${esc(it.desc)}${it.why && it.why.length ? `<br><small>Motifs : ${esc(it.why.filter(Boolean).join(' / '))}</small>` : ''}<br>${(it.ph || []).map(p => `<span style="display:inline-block;margin:6px 6px 0 0;text-align:center"><img src="/catalogue/img/${esc(it.id)}/${p.n}?key=${k}" style="width:110px;height:110px;object-fit:cover;border-radius:8px;${p.ok ? '' : 'outline:3px solid #e8833a'}"><br><form method="post" action="?key=${k}" style="display:inline"><input type="hidden" name="id" value="${esc(it.id)}"><input type="hidden" name="n" value="${p.n}">${p.ok ? '' : '<button name="act" value="phok">Accepter</button>'}<button name="act" value="phno">${p.ok ? 'Retirer' : 'Refuser'}</button></form></span>`).join('')}<br><a href="https://pisteo.app/p/${esc(it.h)}" target="_blank">Ouvrir dans Pisteo</a><form method="post" action="?key=${k}"><input type="hidden" name="id" value="${esc(it.id)}">${it.hidden ? '<button name="act" value="show">Remettre</button>' : '<button name="act" value="hide">Masquer</button>'}<button name="act" value="del" onclick="return confirm('Supprimer définitivement ?')">Supprimer</button></form></li>`).join('');
  const wait = idx.reduce((a, it) => a + (it.ph || []).filter(p => !p.ok).length, 0);
  return html(`<h1>Catalogue Pisteo</h1><p>${idx.filter(x => !x.hidden).length} parcours publiés, ${idx.filter(x => x.hidden).length} masqués${wait ? `, <b>${wait} photo(s) à valider</b> (entourées en orange)` : ''}.</p><ul style="padding:0">${rows || '<li>Aucun parcours pour l\'instant.</li>'}</ul>`);
}

// photo d'un parcours : publique si tu l'as acceptée, visible aussi sur la page d'administration
async function catImg(env, url, path) {
  const m = path.match(/^\/catalogue\/img\/([\w-]+)\/(\d+)$/);
  if (!m || !env.CATALOGUE) return new Response('introuvable', { status: 404 });
  const admin = env.ADMIN_KEY && url.searchParams.get('key') === env.ADMIN_KEY;
  if (!admin) { const it = (await loadIndex(env)).find(x => x.id === m[1]); if (!it || it.hidden || !(it.ph || []).some(p => p.n === +m[2] && p.ok)) return new Response('introuvable', { status: 404 }); }
  const buf = await env.CATALOGUE.get(`img:${m[1]}:${m[2]}`, 'arrayBuffer');
  if (!buf) return new Response('introuvable', { status: 404 });
  return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': admin ? 'no-store' : 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' } });
}
