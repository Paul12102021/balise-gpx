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
//
// Statistiques anonymes (route /stats, onglet « Statistiques » de la page d'administration) :
//   STATS  (base D1 liée au worker, Settings → Bindings → D1 database, nom de variable STATS) — la table se crée toute seule

const API = 'https://www.strava.com/api/v3';

export default {
  // vérification des services extérieurs (déclencheur Cron du worker, toutes les heures) → https://api.pisteo.app/etat
  async scheduled(ev, env, ctx) { ctx.waitUntil(etatCheck(env)); },
  async fetch(req, env, ctx) {
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
    // état des services extérieurs (lu par la vérification quotidienne de Claude et par toi dans un navigateur)
    if (path === '/etat' && req.method === 'GET') return etatGet(env, url, ctx);
    // photos du catalogue : affichées par de simples balises <img> (sans origine)
    if (path.startsWith('/catalogue/img/') && req.method === 'GET') return catImg(env, url, path);
    if (!okOrigin) return new Response('Origine refusée', { status: 403, headers: cors });
    if (path === '/stats' && req.method === 'POST') {
      try { return await statsIn(req, env, json); } catch (e) { return json({ ok: false }, 500); }
    }
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
        const r = await fetch('https://www.strava.com/oauth/token', { method: 'POST', body }), txt = await r.text();
        // nouvelle connexion : l'athlète est compté (suivi de la capacité Strava, page d'administration)
        if (r.ok && env.CATALOGUE) { try {
          const j = JSON.parse(txt); let id = j.athlete && j.athlete.id;
          // renouvellement (toutes les 6 h) : on retrouve l'athlète, pour compter aussi ceux connectés avant ce suivi
          if (!id && j.access_token) id = (await (await fetch(API + '/athlete', { headers: { Authorization: 'Bearer ' + j.access_token } })).json()).id;
          if (id && !(await env.CATALOGUE.get('stv:ath:' + id))) await env.CATALOGUE.put('stv:ath:' + id, new Date().toISOString().slice(0, 10));
        } catch {} }
        return new Response(txt, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });
      }
      const auth = req.headers.get('Authorization') || '';
      if (!/^Bearer \S+$/.test(auth)) return json({ message: 'jeton manquant' }, 401);
      // déconnexion depuis Pisteo : l'autorisation est retirée chez Strava (une place de libérée) et l'athlète décompté
      if (path === '/revoke' && req.method === 'POST') {
        let id = null; try { id = (await (await fetch(API + '/athlete', { headers: { Authorization: auth } })).json()).id; } catch {}
        const r = await fetch('https://www.strava.com/oauth/deauthorize', { method: 'POST', headers: { Authorization: auth } });
        if (id && env.CATALOGUE) await env.CATALOGUE.delete('stv:ath:' + id);
        return json({ ok: r.ok });
      }
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
const publicItem = it => ({ id: it.id, name: it.name, sport: it.sport, dist: it.dist, up: it.up, start: it.start, bb: it.bb, desc: it.desc, h: it.h, date: it.date, done: it.done, ms: it.ms, ph: (it.ph || []).filter(p => p.ok).map(p => p.n) });
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
  if (gibberish(name, false)) return 'Donne un vrai nom au parcours (lieu, sommet, lac…).';
  if (gibberish(desc, true)) return 'Écris une vraie description, en quelques phrases : difficulté, départ, ce qu\'on y voit…';
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
    return new Response(JSON.stringify({ v: 1, items: idx.filter(it => !it.hidden).map(publicItem) }), { headers: { ...Object.fromEntries(json({}).headers), 'Cache-Control': 'no-cache' } });
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
    // preuve que le parcours a été fait : date et durée en mouvement, vitesse moyenne plausible pour le sport
    const done = +b.done, ms = +b.ms, avg = res.dist / 1000 / (ms / 36e5), [lo, hi] = b.sport === 'bike' ? [4, 50] : [1, 20];
    if (!(done > Date.UTC(2000, 0, 1) && done < Date.now() + 864e5) || !(ms >= 3e5 && ms < 7 * 864e5)) return json({ ok: false, message: 'Seuls les parcours que tu as faits peuvent être proposés.' }, 422);
    if (!(avg >= lo * 0.9 && avg <= hi * 1.1)) return json({ ok: false, message: `Vitesse moyenne de ${Math.round(avg)} km/h : vérifie le sport choisi (à pied ou à vélo).` }, 422);
    let up = 0; for (let i = 1; i < r.pts.length; i++) if (r.pts[i].ele != null && r.pts[i - 1].ele != null && r.pts[i].ele > r.pts[i - 1].ele) up += r.pts[i].ele - r.pts[i - 1].ele;
    const lats = r.pts.map(p => p.lat), lons = r.pts.map(p => p.lon);
    const tok = crypto.randomUUID(); // jeton qui permet d'ajouter les photos de ce parcours, juste après
    const it = {
      tok,
      id: crypto.randomUUID().slice(0, 8), name: String(b.name).trim().slice(0, 60), sport: b.sport, dist: Math.round(res.dist), up: r.pts[0].ele != null ? Math.round(up) : null,
      start: [r.pts[0].lat, r.pts[0].lon], bb: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)],
      desc: r.desc.trim().slice(0, 500), h: b.h, date: day, done, ms: Math.round(ms), by: ik, rep: 0, hidden: false
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

// page d'administration : photos à valider, parcours signalés, tous les parcours (masquer / remettre / supprimer)
async function catAdmin(req, env, url) {
  const page = (body, status = 200) => new Response(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catalogue Pisteo</title><style>
:root{--bg:#EEF1E8;--card:#fff;--ink:#17201c;--mut:#5d6963;--line:#dde3d8;--go:#2F5E45;--warn:#E8833A;--bad:#C8412F;--chip:#E4EADF}
@media (prefers-color-scheme:dark){:root{--bg:#141a17;--card:#1d2621;--ink:#eef2ec;--mut:#9aa69f;--line:#2e3a33;--chip:#26312b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--go);color:#fff;padding:14px 16px 0}header h1{margin:0 0 10px;font-size:19px}
.stats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.st{background:rgba(255,255,255,.14);border-radius:10px;padding:6px 10px;font-size:13px}.st b{font-size:17px;display:block}
nav{display:flex;gap:4px;overflow-x:auto}nav a{color:#fff;opacity:.75;text-decoration:none;padding:9px 12px;border-radius:10px 10px 0 0;white-space:nowrap;font-weight:600;font-size:14px}nav a.on{opacity:1;background:var(--bg);color:var(--ink)}
main{max-width:860px;margin:0 auto;padding:16px;display:grid;gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:grid;grid-template-columns:150px 1fr}
.card.hid{opacity:.6}.map{background:var(--chip);display:flex;align-items:center;justify-content:center}.map svg{width:100%;height:100%;min-height:150px}
.body{padding:12px 14px;min-width:0}.t{font-weight:700;font-size:16px}.meta{color:var(--mut);font-size:13px;margin:2px 0 6px}.desc{margin:0 0 8px}
.tag{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:20px;margin-right:4px;background:var(--chip)}.tag.w{background:var(--warn);color:#fff}.tag.b{background:var(--bad);color:#fff}
.why{font-size:13px;color:var(--bad);margin:0 0 8px}
.phs{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 10px}.ph{width:132px}.ph img{width:132px;height:132px;object-fit:cover;border-radius:10px;display:block;cursor:zoom-in;border:3px solid transparent}.ph.wait img{border-color:var(--warn)}
.ph form{display:flex;gap:4px;margin-top:4px}
button{font:600 13px system-ui,sans-serif;border:0;border-radius:9px;padding:8px 11px;cursor:pointer;background:var(--chip);color:var(--ink)}button.ok{background:var(--go);color:#fff}button.no{background:var(--bad);color:#fff}
.acts{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.acts a{color:var(--go);font-weight:600;font-size:13px;margin-right:auto}
.empty{text-align:center;color:var(--mut);padding:40px 10px}
#zoom{position:fixed;inset:0;background:rgba(0,0,0,.88);display:none;align-items:center;justify-content:center;z-index:9}#zoom img{max-width:96%;max-height:92%}
@media (max-width:560px){.card{grid-template-columns:1fr}.map svg{min-height:130px;max-height:170px}}
</style><body>${body}<div id="zoom" onclick="this.style.display='none'"><img alt=""></div><script>document.querySelectorAll('.ph img').forEach(i=>i.onclick=()=>{const z=document.getElementById('zoom');z.querySelector('img').src=i.src;z.style.display='flex'});
// actions sans nouvelle page dans l'historique : « Retour » ne réaffiche plus un parcours supprimé
document.querySelectorAll('form').forEach(f=>f.addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter,d=new FormData(f);if(b&&b.name)d.set(b.name,b.value);f.querySelectorAll('button').forEach(x=>x.disabled=true);
try{await fetch(f.action,{method:'POST',body:d,redirect:'manual'})}catch(_){}location.replace(location.href)}));
// page ressortie de la mémoire du navigateur (bouton Retour) : on la recharge pour voir l'état réel
addEventListener('pageshow',e=>{if(e.persisted)location.reload()})</script></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const key = url.searchParams.get('key') || '';
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY || !env.CATALOGUE) return page('<main><p class="empty">Accès refusé.</p></main>', 403);
  if (url.searchParams.get('tab') === 'stats' && url.searchParams.get('csv')) return statsCsv(env, url);
  if (url.searchParams.get('tab') === 'stats') return page(await statsHtml(env, url, encodeURIComponent(key), esc));
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
      } else { it.hidden = act === 'hide'; if (act === 'show') { it.rep = 0; it.why = []; } }
      await saveIndex(env, idx);
    }
    return Response.redirect(url.toString(), 303);
  }
  const k = encodeURIComponent(key), waitN = it => (it.ph || []).filter(p => !p.ok).length;
  const tabs = [['wait', 'Photos à valider', idx.filter(waitN)], ['rep', 'Signalés', idx.filter(it => it.rep || it.hidden)], ['all', 'Tous', idx]];
  const f = url.searchParams.get('f') || (tabs[0][2].length ? 'wait' : tabs[1][2].length ? 'rep' : 'all');
  const list = (tabs.find(t => t[0] === f) || tabs[2])[2].slice().reverse();
  // petite carte du tracé, dessinée à partir du lien du parcours
  const svg = async it => {
    let pts = []; try { pts = (await readLink(it.h)).pts; } catch {}
    if (pts.length < 2) return '';
    const k2 = Math.cos(pts[0].lat * Math.PI / 180), xs = pts.map(p => p.lon * k2), ys = pts.map(p => -p.lat);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 || 1e-6, h = Math.max(...ys) - y0 || 1e-6, sc = 130 / Math.max(w, h);
    const ox = (150 - w * sc) / 2, oy = (150 - h * sc) / 2, P = pts.map((p, i) => `${(ox + (xs[i] - x0) * sc).toFixed(1)},${(oy + (ys[i] - y0) * sc).toFixed(1)}`);
    return `<svg viewBox="0 0 150 150"><polyline points="${P.join(' ')}" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" opacity=".7"/><polyline points="${P.join(' ')}" fill="none" stroke="#0f9d76" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${P[0].split(',')[0]}" cy="${P[0].split(',')[1]}" r="5" fill="#2F5E45" stroke="#fff" stroke-width="2"/></svg>`;
  };
  const form = (id, inner) => `<form method="post" action="?key=${k}&f=${f}"><input type="hidden" name="id" value="${esc(id)}">${inner}</form>`;
  const cards = await Promise.all(list.map(async it => `<article class="card${it.hidden ? ' hid' : ''}"><div class="map">${await svg(it)}</div><div class="body">
<div class="t">${esc(it.name)}</div>
<div class="meta">${it.sport === 'bike' ? '🚴 vélo' : '🥾 à pied'} · ${(it.dist / 1000).toFixed(1)} km${it.up != null ? ' · D+ ' + it.up + ' m' : ''} · proposé le ${new Date(it.date + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}${it.done ? ` · parcouru le ${new Date(it.done).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} en ${Math.floor(it.ms / 36e5) ? Math.floor(it.ms / 36e5) + ' h ' : ''}${String(Math.round(it.ms % 36e5 / 6e4)).padStart(2, '0')} min (${(it.dist / 1000 / (it.ms / 36e5)).toFixed(1)} km/h)` : ''}</div>
${it.hidden ? '<span class="tag b">Masqué</span>' : ''}${it.rep ? `<span class="tag b">${it.rep} signalement${it.rep > 1 ? 's' : ''}</span>` : ''}${waitN(it) ? `<span class="tag w">${waitN(it)} photo${waitN(it) > 1 ? 's' : ''} à valider</span>` : ''}
<p class="desc">${esc(it.desc)}</p>
${it.why && it.why.filter(Boolean).length ? `<p class="why">Motifs : ${esc(it.why.filter(Boolean).join(' · '))}</p>` : ''}
${(it.ph || []).length ? `<div class="phs">${it.ph.map(p => `<div class="ph${p.ok ? '' : ' wait'}"><img src="/catalogue/img/${esc(it.id)}/${p.n}?key=${k}" alt="" loading="lazy">${form(it.id, `<input type="hidden" name="n" value="${p.n}">${p.ok ? '<button name="act" value="phno">Retirer</button>' : '<button class="ok" name="act" value="phok">✓ Accepter</button><button class="no" name="act" value="phno">✕</button>'}`)}</div>`).join('')}</div>` : ''}
<div class="acts"><a href="https://pisteo.app/p/${esc(it.h)}" target="_blank" rel="noopener">Ouvrir dans Pisteo ↗</a>${form(it.id, it.hidden ? '<button class="ok" name="act" value="show">Remettre en ligne</button>' : '<button name="act" value="hide">Masquer</button>')}${form(it.id, `<button class="no" name="act" value="del" onclick="return confirm('Supprimer définitivement « ${esc(it.name).replace(/'/g, '’')} » ?')">Supprimer</button>`)}</div>
</div></article>`));
  const nPh = idx.reduce((a, it) => a + waitN(it), 0);
  // athlètes connectés à Strava via Pisteo (capacité de l'appli Strava : 10 avant validation)
  let nStv = 0; try { let cur; do { const l = await env.CATALOGUE.list({ prefix: 'stv:ath:', cursor: cur }); nStv += l.keys.length; cur = l.list_complete ? null : l.cursor; } while (cur); } catch {}
  const head = `<header><h1>⭐ Catalogue Pisteo</h1><div class="stats"><div class="st"><b>${idx.filter(x => !x.hidden).length}</b>en ligne</div><div class="st"><b>${nPh}</b>photo${nPh > 1 ? 's' : ''} à valider</div><div class="st"><b>${idx.filter(x => x.rep || x.hidden).length}</b>signalé${idx.filter(x => x.rep || x.hidden).length > 1 ? 's' : ''} ou masqué${idx.filter(x => x.rep || x.hidden).length > 1 ? 's' : ''}</div><div class="st"><b>${idx.filter(x => x.date === new Date().toISOString().slice(0, 10)).length}</b>aujourd'hui</div><div class="st"><b>${nStv}</b>connecté${nStv > 1 ? 's' : ''} Strava</div></div>
<nav>${tabs.map(([id, l, arr]) => `<a href="?key=${k}&f=${id}" class="${id === f ? 'on' : ''}">${l} (${arr.length})</a>`).join('')}<a href="?key=${k}&tab=stats">📊 Statistiques</a></nav></header>`;
  const empty = { wait: 'Aucune photo à valider. 👌', rep: 'Aucun parcours signalé.', all: 'Aucun parcours pour l’instant.' }[f] || '';
  return page(`${head}<main>${cards.join('') || `<p class="empty">${empty}</p>`}</main>`);
}

// photo d'un parcours : publique si tu l'as acceptée, visible aussi sur la page d'administration
async function catImg(env, url, path) {
  const m = path.match(/^\/catalogue\/img\/([\w-]+)\/(\d+)$/);
  if (!m || !env.CATALOGUE) return new Response('introuvable', { status: 404 });
  const admin = env.ADMIN_KEY && url.searchParams.get('key') === env.ADMIN_KEY;
  if (!admin) { const it = (await loadIndex(env)).find(x => x.id === m[1]); if (!it || it.hidden || !(it.ph || []).some(p => p.n === +m[2] && p.ok)) return new Response('introuvable', { status: 404 }); }
  const buf = await env.CATALOGUE.get(`img:${m[1]}:${m[2]}`, 'arrayBuffer');
  if (!buf) return new Response('introuvable', { status: 404 });
  return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': admin ? 'no-store' : 'public, max-age=600', 'Access-Control-Allow-Origin': '*' } });
}

// =====================================================================
// Statistiques anonymes
// =====================================================================
// Chaque appareil envoie le résumé d'une journée finie : { d: 'AAAA-MM-JJ', c: { compteur: n }, dims: { plat: 'android', … } }.
// Tout est additionné par jour (aucune ligne par appareil) : « dev » = nombre d'appareils actifs ce jour-là.
const ST_SQL = 'CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, k TEXT NOT NULL, v REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, k))';
let stReady = false;
async function stInit(env) { if (!stReady) { await env.STATS.prepare(ST_SQL).run(); stReady = true; } }
async function statsIn(req, env, json) {
  if (!env.STATS) return json({ ok: false, message: 'statistiques non configurées' }, 503);
  const b = await req.json().catch(() => null);
  const day = b && typeof b.d === 'string' && /^\d{4}-\d\d-\d\d$/.test(b.d) ? b.d : null;
  const now = Date.now(), t = day ? Date.parse(day + 'T12:00:00Z') : NaN;
  if (!day || !(t > now - 10 * 864e5 && t < now + 2 * 864e5)) return json({ ok: false }, 400);
  const rows = [['dev', 1]];
  for (const [k, v] of Object.entries(b.c || {}).slice(0, 160)) if (/^[\w:.\-]{1,60}$/.test(k) && typeof v === 'number' && isFinite(v) && v > 0 && v < 1e5) rows.push(['c:' + k, v]);
  for (const [k, v] of Object.entries(b.dims || {}).slice(0, 20)) if (/^\w{1,12}$/.test(k) && v != null) rows.push([`d:${k}:${String(v).replace(/[^\w.\-]/g, '_').slice(0, 30)}`, 1]);
  await stInit(env);
  const st = env.STATS.prepare('INSERT INTO daily (day, k, v) VALUES (?1, ?2, ?3) ON CONFLICT (day, k) DO UPDATE SET v = v + excluded.v');
  await env.STATS.batch(rows.map(([k, v]) => st.bind(day, k, v)));
  return json({ ok: true });
}
const ST_LABELS = {
  nav: 'Navigations', nav_trace: 'Navigation sur une trace', nav_vers_lieu: 'Navigation vers un lieu', nav_libre: 'Balade libre', boucle_pied: 'Boucles à pied', boucle_velo: 'Boucles à vélo', boucle_nuit: 'Boucles de nuit (éclairé)',
  boucle_autre: '« Autre » boucle', boucle_garder: 'Boucle gardée', point_par_point: 'Tracé point par point', choisir_carte: 'Choisir sur la carte', vers_lieu: 'Trajet vers un lieu', balises_ouvrir: 'Parcours balisés ouverts', balise_naviguer: 'Parcours balisé suivi',
  balises_recommandes: 'Filtre « Recommandés »', catalogue_proposer: 'Proposer au catalogue', meteo: 'Météo affichée', meteo_depart_ok: 'Heure de départ choisie', meteo_legende: 'Légende météo', eclairage: 'Éclairage affiché', inverser: 'Sens inversé',
  envoyer_parcours: '« Envoyer le parcours »', lien_partage: 'Lien de partage', qr_code: 'QR code', gpx_ouvrir: 'GPX ouvert', gpx_partage: 'GPX partagé / exporté', trace_enregistrer: 'Trace enregistrée (Mes traces)',
  strava_envoi_ok: 'Envois Strava réussis', strava_envoi_echec: 'Envois Strava échoués', strava_manuel: 'Import Strava manuel', strava_connecter: 'Connexion Strava', drive_ok: 'Sauvegardes Drive', drive_echec: 'Sauvegardes Drive échouées', drive_restaurer: 'Restaurations Drive',
  photo_ajouter: 'Photos ajoutées (bouton)', photo_camera: 'Photo prise', retour_trace_manuel: 'Retour à la trace (bouton)', retour_trace_auto: 'Retour à la trace (auto)', recalcul: 'Itinéraire recalculé', retour_depart: 'Ramène-moi au départ', reprendre_parcours: 'Reprendre le parcours',
  signaler_osm: 'Signalement OSM', pip: 'Image dans l’image', eco_bouton: 'Économie de batterie', avis: '« Mon avis »', sortie_supprimee: 'Sorties jetées', terminer: '« Terminer »'
};
async function statsHtml(env, url, k, esc) {
  const nav = `<header><h1>📊 Statistiques Pisteo</h1><nav><a href="?key=${k}">⭐ Catalogue</a><a class="on" href="?key=${k}&tab=stats">📊 Statistiques</a></nav></header>`;
  if (!env.STATS) return nav + '<main><p class="empty">Base D1 « STATS » pas encore reliée au worker (Settings → Bindings → D1 database, nom STATS).</p></main>';
  await stInit(env);
  const per = url.searchParams.get('p') || '30', n = per === 'all' ? 3650 : +per || 30;
  const iso = d => new Date(d).toISOString().slice(0, 10), today = Date.now();
  const since = iso(today - n * 864e5), prev = iso(today - 2 * n * 864e5);
  const q = async (a, b) => Object.fromEntries((await env.STATS.prepare('SELECT k, SUM(v) s FROM daily WHERE day >= ?1 AND day < ?2 GROUP BY k').bind(a, b).all()).results.map(r => [r.k, r.s]));
  const T = await q(since, '9999'), P = per === 'all' ? {} : await q(prev, since);
  const days = (await env.STATS.prepare("SELECT day, k, v FROM daily WHERE day >= ?1 AND k IN ('dev','c:sortie_pied','c:sortie_velo','c:nav') ORDER BY day").bind(since).all()).results;
  const g = (o, key) => o[key] || 0, fmt = v => Math.round(v).toLocaleString('fr-FR');
  const nDays = new Set(days.map(r => r.day)).size || 1;
  const delta = (a, b) => !b ? '' : `<i class="${a >= b ? 'up' : 'dn'}">${a >= b ? '▲' : '▼'} ${Math.round((a / b - 1) * 100)} %</i>`;
  const out = g(T, 'c:sortie_pied') + g(T, 'c:sortie_velo'), outP = g(P, 'c:sortie_pied') + g(P, 'c:sortie_velo');
  const kpi = (l, v, sub) => `<div class="k"><small>${l}</small><b>${v}</b>${sub || ''}</div>`;
  const kpis = `<div class="kpis">${kpi('Appareils actifs / jour', fmt(g(T, 'dev') / nDays), delta(g(T, 'dev'), g(P, 'dev')))}${kpi('Sorties enregistrées', fmt(out), delta(out, outP))}
${kpi('Kilomètres parcourus', fmt(g(T, 'c:km_pied') + g(T, 'c:km_velo')), `<small>🥾 ${fmt(g(T, 'c:km_pied'))} · 🚴 ${fmt(g(T, 'c:km_velo'))}</small>`)}${kpi('Navigations lancées', fmt(g(T, 'c:nav')), delta(g(T, 'c:nav'), g(P, 'c:nav')))}
${kpi('Ouvertures de l’appli', fmt(g(T, 'c:open') + g(T, 'c:resume')), '')}${kpi('Sorties avec coupure GPS', out ? Math.round(g(T, 'c:sortie_coupee') / out * 100) + ' %' : '–', `<small>${fmt(g(T, 'c:coupure_min'))} min sans position</small>`)}
${kpi('Calcul d’une boucle', g(T, 'c:boucle_calculs') ? (g(T, 'c:boucle_secondes') / g(T, 'c:boucle_calculs')).toFixed(1) + ' s' : '–', '<small>en moyenne</small>')}${kpi('Envois Strava', fmt(g(T, 'c:strava_envoi_ok')), g(T, 'c:strava_envoi_echec') ? `<small>${fmt(g(T, 'c:strava_envoi_echec'))} échec(s)</small>` : '')}</div>`;
  // courbe par jour
  const byDay = {}; for (const r of days) (byDay[r.day] = byDay[r.day] || {})[r.k] = r.v;
  const ds = Object.keys(byDay).sort(), W = 340, H = 110, maxD = Math.max(1, ...ds.map(d => byDay[d].dev || 0)), maxS = Math.max(1, ...ds.map(d => (byDay[d]['c:sortie_pied'] || 0) + (byDay[d]['c:sortie_velo'] || 0)));
  const X = i => 10 + (ds.length > 1 ? i * (W - 20) / (ds.length - 1) : (W - 20) / 2);
  const line = ds.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${(H - (byDay[d].dev || 0) / maxD * (H - 10)).toFixed(1)}`).join('');
  const bars = ds.map((d, i) => { const v = (byDay[d]['c:sortie_pied'] || 0) + (byDay[d]['c:sortie_velo'] || 0), h = v / maxS * (H - 50); return `<rect x="${(X(i) - 3).toFixed(1)}" y="${(H - h).toFixed(1)}" width="6" height="${h.toFixed(1)}" rx="2" fill="#E8742A" opacity=".85"/>`; }).join('');
  const chart = ds.length ? `<div class="scard"><h3>Activité par jour</h3><svg viewBox="0 0 ${W} ${H + 4}" width="100%">${bars}<path d="${line}" fill="none" stroke="#2F5E45" stroke-width="2.5"/></svg><div class="leg"><span><i style="background:#2F5E45"></i>Appareils actifs (max ${fmt(maxD)})</span><span><i style="background:#E8742A"></i>Sorties</span></div></div>` : '';
  const barList = (title, arr, col) => { arr = arr.filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]); if (!arr.length) return ''; const m = arr[0][1];
    return `<div class="scard"><h3>${title}</h3><div class="bars">${arr.map(([l, v]) => `<div><span>${esc(l)}</span><em><u style="width:${Math.max(2, v / m * 100)}%;background:${col || '#3A9A6A'}"></u></em><b>${fmt(v)}</b></div>`).join('')}</div></div>`; };
  const pref = p => Object.entries(T).filter(([key]) => key.startsWith(p)).map(([key, v]) => [key.slice(p.length), v]);
  const feats = Object.entries(ST_LABELS).map(([key, l]) => [l, g(T, 'c:' + key)]);
  const dimNames = { plat: 'Appli / navigateur', lang: 'Langue', ver: 'Version', mode: 'Mode', screen: 'Écran', strava: 'Strava connecté', drive: 'Sauvegarde Drive', theme: 'Thème', voice: 'Voix', eco: 'Économie batterie', poi: 'Points utiles', night: 'Alerte nuit', lit: 'De nuit : éclairé', units: 'Unités', layer: 'Fond de carte' };
  const devDays = g(T, 'dev') || 1;
  const dims = Object.entries(dimNames).map(([d, l]) => { const arr = pref(`d:${d}:`); if (!arr.length) return ''; arr.sort((a, b) => b[1] - a[1]);
    return `<div class="dim"><b>${l}</b>${arr.map(([v, c]) => `<span>${esc(v)} <i>${Math.round(c / devDays * 100)} %</i></span>`).join('')}</div>`; }).join('');
  const known = new Set(Object.keys(ST_LABELS).map(x => 'c:' + x));
  const others = Object.entries(T).filter(([key]) => key.startsWith('c:') && !known.has(key) && !key.startsWith('c:err:') && !key.startsWith('c:carte_') && !key.startsWith('c:fond_')).map(([key, v]) => [key.slice(2), v]);
  const pers = ['7', '30', 'all'].map(x => `<a class="${x === per ? 'on' : ''}" href="?key=${k}&tab=stats&p=${x}">${x === 'all' ? 'Tout' : x + ' jours'}</a>`).join('')
    + `<a style="margin-left:auto" href="?key=${k}&tab=stats&p=${per}&csv=1">⬇ Excel</a>`;
  return nav + `<main><style>.per{display:flex;gap:6px}.per a{background:var(--chip);border-radius:999px;padding:5px 12px;font-weight:600;font-size:13px;color:var(--ink);text-decoration:none}.per a.on{background:var(--go);color:#fff}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}.k{background:var(--card);border-radius:14px;padding:10px 12px}.k b{display:block;font-size:24px}.k small{color:var(--mut);display:block}.k i{font-style:normal;font-size:12px;font-weight:700}.k i.up{color:#3A9A6A}.k i.dn{color:#C8412F}
.scard{display:block;background:var(--card);border-radius:14px;padding:12px;margin-top:10px}.scard h3{margin:0 0 8px;font-size:13px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}
.bars div{display:grid;grid-template-columns:minmax(120px,40%) 1fr auto;gap:8px;align-items:center;font-size:13px;margin:4px 0}.bars em{display:block;height:10px}.bars u{display:block;height:10px;border-radius:5px}.bars b{font-size:12px;color:var(--mut)}
.leg{display:flex;gap:12px;font-size:12px;color:var(--mut)}.leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
.dim{margin:6px 0;font-size:13px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}.dim b{width:100%;font-size:12px;color:var(--mut)}.dim span{background:var(--chip);border-radius:8px;padding:2px 8px}.dim i{font-style:normal;color:var(--mut)}
.note{font-size:12px;color:var(--mut)}</style>
<div class="per">${pers}</div>${kpis}${chart}
${barList('Fonctions utilisées', feats)}
${barList('Cartes hors ligne téléchargées', pref('c:carte_').map(([c, v]) => [({ fr: 'France', es: 'Espagne', at: 'Autriche', be: 'Belgique', ch: 'Suisse', gb: 'Royaume-Uni', de: 'Allemagne', ca: 'Canada', us: 'États-Unis', zone: 'Zone libre' })[c] || c, v]))}
${barList('Fonds de carte choisis', pref('c:fond_'), '#2F5E45')}
<div class="scard"><h3>Appareils et réglages (part des jours-appareils)</h3>${dims || '<p class="note">Pas encore de données.</p>'}</div>
${barList('Erreurs de l’appli', pref('c:err:'), '#C8412F')}
${barList('Autres compteurs', others, '#8a959e')}
<p class="note">Anonyme : chaque appareil envoie une fois par jour les compteurs de la veille, additionnés ici par jour (aucune ligne par appareil, aucune position). Les chiffres arrivent avec un jour de décalage.</p></main>`;
}

// export pour Excel : une ligne par jour, une colonne par compteur (séparateur « ; », virgule décimale, UTF-8 avec BOM)
async function statsCsv(env, url) {
  if (!env.STATS) return new Response('Base STATS non reliée', { status: 503 });
  await stInit(env);
  const per = url.searchParams.get('p') || '30', n = per === 'all' ? 3650 : +per || 30;
  const since = new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const rows = (await env.STATS.prepare('SELECT day, k, v FROM daily WHERE day >= ?1 ORDER BY day').bind(since).all()).results;
  const keys = [...new Set(rows.map(r => r.k))].sort((a, b) => (a === 'dev' ? -1 : b === 'dev' ? 1 : a.localeCompare(b)));
  const byDay = {}; for (const r of rows) (byDay[r.day] = byDay[r.day] || {})[r.k] = r.v;
  const name = k => k === 'dev' ? 'appareils actifs' : k.startsWith('c:') ? (ST_LABELS[k.slice(2)] || k.slice(2)) : k.startsWith('d:') ? k.slice(2).replace(':', ' = ') : k;
  const cell = v => { const t = String(v).replace(/"/g, '""'); return /[;"\n]/.test(t) ? `"${t}"` : t; };
  const num = v => v == null ? '' : String(Math.round(v * 10) / 10).replace('.', ',');
  const lines = [['Jour', ...keys.map(name)].map(cell).join(';')];
  for (const d of Object.keys(byDay).sort()) lines.push([d, ...keys.map(k => num(byDay[d][k]))].join(';'));
  return new Response('﻿' + lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="pisteo-statistiques-${per === 'all' ? 'tout' : per + 'j'}-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
}

// ---------- Plan de secours : état des services extérieurs ----------
// Chaque service est testé comme l'appli s'en sert (une tuile, un itinéraire, une recherche…).
// crit : la navigation en dépend ; backup : nom du secours automatique de l'appli.
const ETAT_UA = 'Pisteo/1.0 (+https://pisteo.app; pisteo.app@gmail.com)';
function tileXY(lon, lat, z) {
  const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), r = lat * Math.PI / 180;
  return { z, x, y: Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n) };
}
function tileUrl(tpl, lon, lat, z) {
  const t = tileXY(lon, lat, z), o = 20037508.342789244, s = 2 * o / 2 ** z;
  const bbox = [-o + t.x * s, o - (t.y + 1) * s, -o + (t.x + 1) * s, o - t.y * s].join(',');
  return tpl.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y).replace('{bbox-epsg-3857}', bbox);
}
const ETAT = [
  ['site', 'Site pisteo.app (Cloudflare Pages)', 'https://pisteo.app/', t => /balise-version/.test(t), 1, 'copie du téléphone'],
  ['brouter', 'Itinéraires BRouter', 'https://brouter.de/brouter?lonlats=-0.3700,49.1800|-0.3500,49.1900&profile=trekking&alternativeidx=0&format=geojson', t => /FeatureCollection/.test(t), 1, 'OSRM FOSSGIS'],
  ['osrm', 'Itinéraires de secours OSRM (FOSSGIS)', 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/-0.37,49.18;-0.35,49.19?overview=false', t => /"Ok"/.test(t), 0, ''],
  ['ign', 'Carte IGN (Géoplateforme)', tileUrl('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM_0_19&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png', -0.37, 49.18, 12), 'img', 1, 'carte Monde'],
  ['ortho', 'Photos aériennes IGN', tileUrl('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM_0_19&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg', -0.37, 49.18, 12), 'img', 0, 'carte IGN'],
  ['ofm', 'Carte Monde (OpenFreeMap)', 'https://tiles.openfreemap.org/planet', t => /"tiles"/.test(t), 1, 'carte officielle du pays'],
  ['topo', 'Carte Topo (OpenTopoMap)', tileUrl('https://a.tile.opentopomap.org/{z}/{x}/{y}.png', -0.37, 49.18, 12), 'img', 0, 'IGN ou Monde'],
  ['cyclosm', 'Carte CyclOSM', tileUrl('https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', -0.37, 49.18, 12), 'img', 0, 'IGN ou Monde'],
  ['es', 'Carte Espagne (IGN España)', tileUrl('https://www.ign.es/wmts/mapa-raster?layer=MTN&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}', -3.7, 40.4, 12), 'img', 0, 'carte Monde'],
  ['at', 'Carte Autriche (basemap.at)', tileUrl('https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png', 16.37, 48.21, 12), 'img', 0, 'carte Monde'],
  ['be', 'Carte Belgique (IGN-NGI)', tileUrl('https://cartoweb.wmts.ngi.be/1.0.0/topo/default/3857/{z}/{y}/{x}.png', 4.35, 50.85, 12), 'img', 0, 'carte Monde'],
  ['ch', 'Carte Suisse (swisstopo)', tileUrl('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', 7.45, 46.95, 12), 'img', 0, 'carte Monde'],
  ['gb', 'Carte Royaume-Uni (Ordnance Survey)', tileUrl('https://api.os.uk/maps/raster/v1/zxy/Outdoor_3857/{z}/{x}/{y}.png?key=nrlrimaly1yk6su7XFpdMCAtA5r6DQPs', -3.1, 54.45, 12), 'img', 0, 'carte Monde'],
  ['de', 'Carte Allemagne (BKG)', tileUrl('https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png', 13.4, 52.5, 12), 'img', 0, 'carte Monde'],
  ['ca', 'Carte Canada (Toporama)', tileUrl('https://maps.geogratis.gc.ca/wms/toporama_fr?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=SCW-Toporama&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg', -75.7, 45.4, 12), 'img', 0, 'carte Monde'],
  ['us', 'Carte USA (USGS)', tileUrl('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', -105, 39.7, 12), 'img', 0, 'carte Monde'],
  ['alti', 'Altitude IGN', 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?resource=ign_rge_alti_wld&delimiter=%7C&zonly=true&lon=-0.37&lat=49.18', t => /elevations/.test(t), 0, 'Open-Meteo'],
  ['adresses', 'Recherche d\'adresses IGN', 'https://data.geopf.fr/geocodage/search?q=caen&limit=1', t => /features/.test(t), 0, 'communes téléchargées'],
  ['photon', 'Recherche de lieux (Photon, Komoot)', 'https://photon.komoot.io/api/?q=caen&limit=1', t => /features/.test(t), 0, 'lieux IGN'],
  ['overpass', 'Overpass (serveur principal)', 'https://overpass-api.de/api/status', t => /Connected as/.test(t), 0, '2 serveurs miroirs'],
  ['overpass2', 'Overpass (miroir private.coffee)', 'https://overpass.private.coffee/api/status', t => /Connected as/.test(t), 0, ''],
  ['meteo', 'Météo Open-Meteo', 'https://api.open-meteo.com/v1/forecast?latitude=49.18&longitude=-0.37&hourly=temperature_2m&forecast_days=1', t => /hourly/.test(t), 0, 'MET Norway'],
  ['met', 'Météo de secours MET Norway', 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=49.18&lon=-0.37', t => /timeseries/.test(t), 0, ''],
  ['altisecours', 'Altitude de secours Open-Meteo', 'https://api.open-meteo.com/v1/elevation?latitude=49.18&longitude=-0.37', t => /elevation/.test(t), 0, ''],
  ['data', 'Parcours balisés (GitHub Pages)', 'https://paul12102021.github.io/pisteo-data/manifest.json', t => /"tiles"/.test(t), 0, 'raw GitHub'],
  ['dataraw', 'Parcours balisés, secours raw GitHub', 'https://raw.githubusercontent.com/Paul12102021/pisteo-data/gh-pages/manifest.json', t => /"tiles"/.test(t), 0, ''],
  ['wmt', 'Waymarked Trails', tileUrl('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', -0.37, 49.18, 12), 'img', 0, 'Overpass'],
  ['communes', 'Communes (geo.api.gouv.fr)', 'https://geo.api.gouv.fr/communes?codeDepartement=14&fields=nom&format=json', t => /nom/.test(t), 0, ''],
  ['strava', 'Strava (API)', 'https://www.strava.com/api/v3/athlete', (t, r) => r.status === 401, 0, 'import manuel'],
  ['drive', 'Google Drive (API)', 'https://www.googleapis.com/drive/v3/about', (t, r) => r.status === 401 || r.status === 403, 0, 'export en fichier'],
  ['geofabrik', 'Geofabrik (mise à jour des données)', 'https://download.geofabrik.de/europe/france-updates/state.txt', t => /sequenceNumber/.test(t), 0, 'openstreetmap.fr'],
];
// un échec est retesté une fois 5 s plus tard (évite les fausses alertes sur un raté passager)
async function etatOne(e) { const r = await etatTry(e); if (r.ok) return r; await new Promise(ok => setTimeout(ok, 5000)); return etatTry(e); }
async function etatTry([id, name, u, test, crit, backup]) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { headers: { 'User-Agent': ETAT_UA, 'Referer': 'https://pisteo.app/' }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
    let ok;
    if (test === 'img') ok = r.ok && /image|octet/.test(r.headers.get('content-type') || '') && (await r.arrayBuffer()).byteLength > 100;
    else ok = test(await r.text(), r) && (r.ok || r.status === 401 || r.status === 403);
    return { id, name, ok, code: r.status, ms: Date.now() - t0, crit: !!crit, backup };
  } catch (e) { return { id, name, ok: false, code: 0, err: String(e.message || e).slice(0, 80), ms: Date.now() - t0, crit: !!crit, backup }; }
}
async function etatCheck(env) {
  const res = await Promise.all(ETAT.map(etatOne));
  const prev = (env.CATALOGUE && await env.CATALOGUE.get('etat', 'json')) || { res: [] };
  const now = new Date().toISOString();
  for (const r of res) { // depuis quand un service est en panne
    const p = prev.res.find(x => x.id === r.id);
    if (!r.ok) r.since = p && !p.ok && p.since ? p.since : now;
  }
  const out = { t: now, down: res.filter(r => !r.ok).map(r => r.id), res };
  if (env.CATALOGUE) await env.CATALOGUE.put('etat', JSON.stringify(out));
  return out;
}
async function etatGet(env, url, ctx) {
  let e = env.CATALOGUE && await env.CATALOGUE.get('etat', 'json');
  // pas de vérification depuis plus d'1 h 30 (déclencheur absent) : on vérifie maintenant
  if (!e || Date.now() - Date.parse(e.t) > 90 * 6e4 || (url.searchParams.get('maintenant') === '1' && Date.now() - Date.parse(e.t) > 5 * 6e4)) e = await etatCheck(env);
  // https://api.pisteo.app/etat : données brutes ; …/etat?format=page : tableau lisible
  if (url.searchParams.get('format') !== 'page') return new Response(JSON.stringify(e, null, 1), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
  const row = r => `<tr class="${r.ok ? 'ok' : 'ko'}"><td>${r.ok ? '✅' : r.crit ? '🔴' : '🟠'}</td><td>${r.name}</td><td>${r.ok ? r.ms + ' ms' : 'en panne' + (r.since ? ' depuis ' + new Date(r.since).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '')}</td><td>${r.backup || ''}</td></tr>`;
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pisteo · état des services</title>
<style>body{font:15px system-ui;margin:16px;background:#f6f7f5;color:#1d2a24}table{border-collapse:collapse;width:100%;max-width:820px}td,th{padding:6px 8px;border-bottom:1px solid #dde;text-align:left}tr.ko{background:#fdecea}th{font-size:13px;color:#667}</style>
<h1>État des services</h1><p>Vérifié le ${new Date(e.t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} · ${e.down.length ? e.down.length + ' en panne' : 'tout fonctionne'} · <a href="?format=page&maintenant=1">revérifier</a></p>
<table><tr><th></th><th>Service</th><th>État</th><th>Secours dans l'appli</th></tr>${e.res.map(row).join('')}</table>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
