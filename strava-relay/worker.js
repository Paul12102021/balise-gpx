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
  // espacée : rien la nuit, toutes les 2 h en journée, toutes les heures tant qu'un service est en panne (voir etatDue)
  async scheduled(ev, env, ctx) { ctx.waitUntil(Promise.all([stFold(env).catch(() => 0), etatDue(env).then(go => go && etatCheck(env))])); },
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
  const page = (body, status = 200) => new Response(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Administration Pisteo</title><style>
:root{--bg:#EEF1E8;--card:#fff;--ink:#17201c;--mut:#5d6963;--line:#dde3d8;--go:#2F5E45;--warn:#E8833A;--bad:#C8412F;--chip:#E4EADF}
@media (prefers-color-scheme:dark){:root{--bg:#141a17;--card:#1d2621;--ink:#eef2ec;--mut:#9aa69f;--line:#2e3a33;--chip:#26312b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--go);color:#fff;padding:14px 16px 0}header h1{margin:0 0 10px;font-size:19px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.st{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;font-size:14px;color:var(--mut)}.st b{font-size:28px;line-height:1.15;display:block;color:var(--ink)}
main.top{padding-bottom:0}.per{display:flex;gap:8px;flex-wrap:wrap}.per a{background:var(--chip);border-radius:999px;padding:8px 16px;font-weight:600;font-size:15px;color:var(--ink);text-decoration:none}.per a.on{background:var(--go);color:#fff}
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
  if (url.searchParams.get('tab') === 'etat') {
    // vérification manuelle avec progression : la page teste les services un par un (?un=id), puis enregistre le tout (POST)
    const jr = o => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const one = url.searchParams.get('un');
    if (one) { const it = ETAT.find(x => x[0] === one); return it ? jr(await etatOne(it)) : jr({ ok: false, err: 'inconnu' }); }
    if (req.method === 'POST') {
      try { const res = (await req.json()).res; if (!Array.isArray(res)) throw 0; return jr(await etatStore(env, res.filter(r => ETAT.some(x => x[0] === r.id)))); }
      catch { return jr({ ok: false }); }
    }
    return page(await etatAdmin(env, url, encodeURIComponent(key)));
  }
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
  const head = adminHead(k, 'cat') + `<main class="top"><div class="stats"><div class="st"><b>${idx.filter(x => !x.hidden).length}</b>en ligne</div><div class="st"><b>${nPh}</b>photo${nPh > 1 ? 's' : ''} à valider</div><div class="st"><b>${idx.filter(x => x.rep || x.hidden).length}</b>signalé${idx.filter(x => x.rep || x.hidden).length > 1 ? 's' : ''} ou masqué${idx.filter(x => x.rep || x.hidden).length > 1 ? 's' : ''}</div><div class="st"><b>${idx.filter(x => x.date === new Date().toISOString().slice(0, 10)).length}</b>aujourd'hui</div><div class="st"><b>${nStv}</b>connecté${nStv > 1 ? 's' : ''} Strava</div></div>
<div class="per">${tabs.map(([id, l, arr]) => `<a href="?key=${k}&f=${id}" class="${id === f ? 'on' : ''}">${l} (${arr.length})</a>`).join('')}</div></main>`;
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
// arrivée : une seule ligne par résumé d'appareil (inbox), additionnée dans daily par la base elle-même (stFold),
// chaque heure et à l'ouverture de la page : ~2 écritures par appareil au lieu de 60 à 120
const ST_INBOX = 'CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY, r TEXT NOT NULL)';
const ST_LOG = 'CREATE TABLE IF NOT EXISTS etat_log (t TEXT NOT NULL, id TEXT NOT NULL, ok INTEGER NOT NULL, ms INTEGER)';
let stReady = false;
async function stInit(env) { if (!stReady) { await env.STATS.batch([ST_SQL, ST_INBOX, ST_LOG].map(q => env.STATS.prepare(q))); stReady = true; } }
async function stFold(env) {
  if (!env.STATS) return 0;
  await stInit(env);
  const m = await env.STATS.prepare('SELECT MAX(id) m FROM (SELECT id FROM inbox ORDER BY id LIMIT 5000)').first('m');
  if (!m) return 0;
  // addition et effacement dans une même transaction : rien n'est compté deux fois
  await env.STATS.batch([
    env.STATS.prepare("INSERT INTO daily (day, k, v) SELECT json_extract(e.value, '$[0]'), json_extract(e.value, '$[1]'), SUM(json_extract(e.value, '$[2]')) FROM inbox, json_each(inbox.r) e WHERE inbox.id <= ?1 GROUP BY 1, 2 ON CONFLICT (day, k) DO UPDATE SET v = v + excluded.v").bind(m),
    env.STATS.prepare('DELETE FROM inbox WHERE id <= ?1').bind(m)
  ]);
  return m;
}
// Rangement par provenance : « a| » = appli Android, « w| » = site web (navigateur).
// Les lignes sans préfixe datent d'avant ce rangement : elles ne comptent que dans « Tout ».
// u:… = appareils ayant fait l'action dans la journée (entonnoir) ; x:ver=…/x:plat=… = sorties et coupures GPS par version / appareil.
const ST_FUNNEL = [
  ['prep', 'Ont préparé un itinéraire', c => c.boucle_calculs || c.point_par_point || c.vers_lieu || c.choisir_carte || c.balise_naviguer || c.gpx_ouvrir],
  ['nav', 'Ont lancé une navigation', c => c.nav],
  ['sortie', 'Ont gardé une sortie', c => c.sortie_pied || c.sortie_velo],
  ['strava', 'Ont envoyé sur Strava', c => c.strava_envoi_ok]
];
async function statsIn(req, env, json) {
  if (!env.STATS) return json({ ok: false, message: 'statistiques non configurées' }, 503);
  const b = await req.json().catch(() => null);
  const day = b && typeof b.d === 'string' && /^\d{4}-\d\d-\d\d$/.test(b.d) ? b.d : null;
  const now = Date.now(), t = day ? Date.parse(day + 'T12:00:00Z') : NaN;
  if (!day || !(t > now - 10 * 864e5 && t < now + 2 * 864e5)) return json({ ok: false }, 400);
  const c = {}, dims = {};
  for (const [k, v] of Object.entries(b.c || {}).slice(0, 160)) if (/^[\w:.\-]{1,60}$/.test(k) && typeof v === 'number' && isFinite(v) && v > 0 && v < 1e5) c[k] = v;
  for (const [k, v] of Object.entries(b.dims || {}).slice(0, 20)) if (/^\w{1,12}$/.test(k) && v != null) dims[k] = String(v).replace(/[^\w.\-]/g, '_').slice(0, 30);
  // pays d'envoi, donné par Cloudflare (l'adresse IP n'est ni lue ni gardée) ; il remplace toute valeur envoyée par l'appli
  const cc = req.cf && typeof req.cf.country === 'string' && /^[A-Z]{2}$/.test(req.cf.country) ? req.cf.country : '';
  if (cc) dims.pays = cc; else delete dims.pays;
  const rows = [['dev', 1]];
  for (const [k, v] of Object.entries(c)) rows.push(['c:' + k, v]);
  for (const [k, v] of Object.entries(dims)) rows.push([`d:${k}:${v}`, 1]);
  for (const [id, , test] of ST_FUNNEL) if (test(c)) rows.push(['u:' + id, 1]);
  const out = (c.sortie_pied || 0) + (c.sortie_velo || 0);
  for (const dn of ['ver', 'plat', 'os', 'pays']) if (dims[dn]) {
    const p = `x:${dn}=${dims[dn]}:`; rows.push([p + 'dev', 1]);
    for (const [k, v] of [['sortie', out], ['coupee', c.sortie_coupee], ['coupure_min', c.coupure_min], ['batt_pct', c.batt_pct], ['batt_h', c.batt_h]]) if (v) rows.push([p + k, v]);
  }
  const grp = dims.plat === 'android' ? 'a|' : 'w|';
  // fidélité : rangée au premier jour de l'appareil (sa « cohorte ») ; m = jalon atteint (1, 7 ou 30 jours après)
  const ret = [], r = b.ret, f = r && typeof r.first === 'string' && /^\d{4}-\d\d-\d\d$/.test(r.first) ? r.first : null;
  if (f && f <= day && Date.parse(f) > t - 400 * 864e5 && Array.isArray(r.m)) for (const m of new Set(r.m)) if ([1, 7, 30].includes(m)) ret.push([f, 'ret:j' + m]);
  await stInit(env);
  await env.STATS.prepare('INSERT INTO inbox (r) VALUES (?1)').bind(JSON.stringify([...rows.map(([k, v]) => [day, grp + k, v]), ...ret.map(([d, k]) => [d, grp + k, 1])])).run();
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
// période et filtre demandés : p = hier | 7 | 30 | 90 | all | custom (from, to) ; f = all | app | web ; g = jour | semaine | mois
function stRange(url) {
  const D = 864e5, iso = t => new Date(t).toISOString().slice(0, 10), ok = s => /^\d{4}-\d\d-\d\d$/.test(s || '');
  const sp = url.searchParams, yest = iso(Date.now() - D);
  let p = sp.get('p') || '30', from, to = yest;
  if (p === 'custom' && (ok(sp.get('from')) || ok(sp.get('to')))) {
    from = ok(sp.get('from')) ? sp.get('from') : sp.get('to'); to = ok(sp.get('to')) ? sp.get('to') : from;
    if (to < from) [from, to] = [to, from];
  } else if (p === 'hier') from = yest;
  else if (p === 'all') from = '2000-01-01';
  else { p = ['7', '30', '90'].includes(p) ? p : '30'; from = iso(Date.now() - +p * D); }
  const len = Math.round((Date.parse(to) - Date.parse(from)) / D) + 1;
  const f = ['app', 'web'].includes(sp.get('f')) ? sp.get('f') : 'all';
  return { p, from, to, len, f, g: sp.get('g'), prevFrom: iso(Date.parse(from) - len * D), prevTo: iso(Date.parse(from) - D) };
}
// clé enregistrée → clé de base, ou null si elle n'entre pas dans le filtre
function stKey(k, f) {
  const g = k[1] === '|' ? k[0] : '';
  if ((f === 'app' && g !== 'a') || (f === 'web' && g !== 'w')) return null;
  return g ? k.slice(2) : k;
}
async function stTotals(env, a, b, f) {
  const o = {};
  for (const r of (await env.STATS.prepare('SELECT k, SUM(v) s FROM daily WHERE day >= ?1 AND day <= ?2 GROUP BY k').bind(a, b).all()).results) { const k = stKey(r.k, f); if (k) o[k] = (o[k] || 0) + r.s; }
  return o;
}
async function stDaily(env, a, b, f, keys) {
  const all = keys.flatMap(k => [k, 'a|' + k, 'w|' + k]).map(k => `'${k.replace(/'/g, "''")}'`).join(',');
  const o = {};
  for (const r of (await env.STATS.prepare(`SELECT day, k, SUM(v) s FROM daily WHERE day >= ?1 AND day <= ?2 AND k IN (${all}) GROUP BY day, k`).bind(a, b).all()).results) {
    const k = stKey(r.k, f); if (!k) continue; const d = o[r.day] || (o[r.day] = {}); d[k] = (d[k] || 0) + r.s;
  }
  return o;
}
const ST_MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const stDate = (d, y) => { const [Y, M, J] = d.split('-'); return `${+J} ${ST_MOIS[+M - 1]}${y ? ' ' + Y : ''}`; };
function stBucket(d, g) {
  if (g === 'mois') { const m = d.slice(0, 7), last = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).toISOString().slice(0, 10); return [m, m + '-01', last]; }
  if (g === 'semaine') { const t = Date.parse(d), wd = (new Date(t).getUTCDay() + 6) % 7, mon = new Date(t - wd * 864e5).toISOString().slice(0, 10); return [mon, mon, new Date(t + (6 - wd) * 864e5).toISOString().slice(0, 10)]; }
  return [d, d, d];
}
async function statsHtml(env, url, k, esc) {
  const nav = adminHead(k, 'stats');
  if (!env.STATS) return nav + '<main><p class="empty">Base D1 « STATS » pas encore reliée au worker (Settings → Bindings → D1 database, nom STATS).</p></main>';
  await stFold(env);
  const R = stRange(url), { f } = R;
  const T = await stTotals(env, R.from, R.to, f), P = R.p === 'all' ? {} : await stTotals(env, R.prevFrom, R.prevTo, f);
  const byDay = await stDaily(env, R.from, R.to, f, ['dev', 'c:sortie_pied', 'c:sortie_velo', 'c:nav', 'd:age:nouveau', 'ret:j1', 'ret:j7', 'ret:j30']);
  const g = (o, key) => o[key] || 0, fmt = v => Math.round(v).toLocaleString('fr-FR'), pc = (a, b) => b ? Math.round(a / b * 100) + ' %' : '–';
  const link = o => '?' + Object.entries(Object.assign({ key: k, tab: 'stats', p: R.p, f, from: R.p === 'custom' ? R.from : null, to: R.p === 'custom' ? R.to : null, g: R.g }, o)).filter(([, v]) => v != null && v !== '').map(([a, v]) => a === 'key' ? 'key=' + v : a + '=' + encodeURIComponent(v)).join('&');
  const nDays = Object.values(byDay).filter(d => d.dev).length || 1;
  const delta = (a, b) => !b ? '' : `<i class="${a >= b ? 'up' : 'dn'}">${a >= b ? '▲' : '▼'} ${Math.round((a / b - 1) * 100)} %</i>`;
  const out = g(T, 'c:sortie_pied') + g(T, 'c:sortie_velo'), outP = g(P, 'c:sortie_pied') + g(P, 'c:sortie_velo');
  const devDays = g(T, 'dev') || 1, older = g(T, 'd:age:j8-30') + g(T, 'd:age:j30') + g(T, 'd:age:ancien');
  // jours d'utilisation envoyés depuis le 29 octobre 2026 (les seuls qui ont l'ancienneté et l'entonnoir)
  const sumPref = (p, end) => Object.entries(T).filter(([key]) => key.startsWith(p) && (!end || key.endsWith(end))).reduce((a, [, v]) => a + v, 0);
  const ageDays = sumPref('d:age:') || 1, newDays = sumPref('x:plat=', ':dev') || 1;
  const kpi = (l, v, sub) => `<div class="k"><small>${l}</small><b>${v}</b>${sub || ''}</div>`;
  const kpis = `<div class="kpis">${kpi(R.len === 1 ? 'Appareils actifs' : 'Appareils actifs / jour', fmt(g(T, 'dev') / nDays), delta(g(T, 'dev'), g(P, 'dev')))}${kpi('Sorties enregistrées', fmt(out), delta(out, outP))}
${kpi('Nouveaux appareils', fmt(g(T, 'd:age:nouveau')), delta(g(T, 'd:age:nouveau'), g(P, 'd:age:nouveau')))}${kpi('Utilisation par des habitués', sumPref('d:age:') ? pc(older, ageDays) : '–', '<small>appareils de plus de 7 jours</small>')}
${kpi('Kilomètres parcourus', fmt(g(T, 'c:km_pied') + g(T, 'c:km_velo')), `<small>🥾 ${fmt(g(T, 'c:km_pied'))} · 🚴 ${fmt(g(T, 'c:km_velo'))}</small>`)}${kpi('Navigations lancées', fmt(g(T, 'c:nav')), delta(g(T, 'c:nav'), g(P, 'c:nav')))}
${kpi('Ouvertures de l’appli', fmt(g(T, 'c:open') + g(T, 'c:resume')), '')}${kpi('Sorties avec coupure GPS', out ? pc(g(T, 'c:sortie_coupee'), out) : '–', `<small>${fmt(g(T, 'c:coupure_min'))} min sans position</small>`)}
${kpi('Calcul d’une boucle', g(T, 'c:boucle_calculs') ? (g(T, 'c:boucle_secondes') / g(T, 'c:boucle_calculs')).toFixed(1) + ' s' : '–', '<small>en moyenne</small>')}${kpi('Envois Strava', fmt(g(T, 'c:strava_envoi_ok')), g(T, 'c:strava_envoi_echec') ? `<small>${fmt(g(T, 'c:strava_envoi_echec'))} échec(s)</small>` : '')}</div>`;
  // courbe : jour, semaine ou mois ; chaque colonne mène au détail de sa période
  const dataDays = Object.keys(byDay).sort();
  let chart = '';
  if (dataDays.length && R.len > 1) {
    const span = Math.round((Date.parse(R.to) - Date.parse(dataDays[0])) / 864e5) + 1;
    const gr = ['jour', 'semaine', 'mois'].includes(R.g) ? R.g : span > 200 ? 'mois' : span > 45 ? 'semaine' : 'jour';
    const B = {};
    for (let t = Date.parse(dataDays[0]); t <= Date.parse(R.to); t += 864e5) {
      const d = new Date(t).toISOString().slice(0, 10), [id, a, b] = stBucket(d, gr), x = B[id] || (B[id] = { a, b, dev: 0, n: 0, s: 0, nw: 0 }), v = byDay[d] || {};
      x.dev += v.dev || 0; x.n++; x.s += (v['c:sortie_pied'] || 0) + (v['c:sortie_velo'] || 0); x.nw += v['d:age:nouveau'] || 0;
    }
    const L = Object.values(B), W = 340, H = 120, top = 8;
    const maxD = Math.max(1, ...L.map(x => x.dev / x.n), ...L.map(x => x.nw)), maxS = Math.max(1, ...L.map(x => x.s));
    const cw = (W - 20) / L.length, X = i => 10 + cw * (i + .5);
    const path = fn => L.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${(H - fn(x) / maxD * (H - top)).toFixed(1)}`).join('');
    const bw = Math.max(2, Math.min(14, cw * .6));
    const bars = L.map((x, i) => { const h = x.s / maxS * (H - 50); return h ? `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="#E8742A" opacity=".85"/>` : ''; }).join('');
    const lab = x => x.a === x.b ? stDate(x.a) : gr === 'mois' ? ST_MOIS[+x.a.slice(5, 7) - 1] + ' ' + x.a.slice(0, 4) : stDate(x.a) + ' – ' + stDate(x.b);
    const hits = L.map((x, i) => `<a href="${link({ p: 'custom', from: x.a, to: x.b, g: null })}"><rect x="${(X(i) - cw / 2).toFixed(1)}" y="0" width="${cw.toFixed(1)}" height="${H}" fill="transparent"><title>${esc(lab(x))} : ${fmt(x.dev / x.n)} appareils / jour, ${fmt(x.nw)} nouveaux, ${fmt(x.s)} sorties</title></rect></a>`).join('');
    const dot = L.length <= 40 ? L.map((x, i) => `<circle cx="${X(i).toFixed(1)}" cy="${(H - x.dev / x.n / maxD * (H - top)).toFixed(1)}" r="2.5" fill="#2F5E45"/>`).join('') : '';
    const gl = ['jour', 'semaine', 'mois'].map(x => `<a class="${x === gr ? 'on' : ''}" href="${link({ g: x })}">${x[0].toUpperCase() + x.slice(1)}</a>`).join('');
    chart = `<div class="scard"><div class="hd"><h3>Activité par ${gr}</h3><div class="mini">${gl}</div></div>
<svg viewBox="0 0 ${W} ${H + 16}" width="100%">${bars}<path d="${path(x => x.nw)}" fill="none" stroke="#6FA8DC" stroke-width="1.5" stroke-dasharray="3 3"/><path d="${path(x => x.dev / x.n)}" fill="none" stroke="#2F5E45" stroke-width="2.5"/>${dot}
<text x="10" y="${H + 13}" font-size="10" fill="currentColor" opacity=".6">${esc(lab(L[0]))}</text><text x="${W - 10}" y="${H + 13}" font-size="10" fill="currentColor" opacity=".6" text-anchor="end">${esc(lab(L[L.length - 1]))}</text>${hits}</svg>
<div class="leg"><span><i style="background:#2F5E45"></i>Appareils actifs / jour</span><span><i style="background:#6FA8DC"></i>Nouveaux</span><span><i style="background:#E8742A"></i>Sorties</span></div><p class="note">Touche une ${gr === 'jour' ? 'journée' : gr} pour en voir le détail.</p></div>`;
  }
  const barList = (title, arr, col, note, keep) => { arr = arr.filter(x => x[1] > 0); if (!keep) arr.sort((a, b) => b[1] - a[1]); if (!arr.length) return ''; const m = Math.max(...arr.map(x => x[1]));
    return `<div class="scard"><h3>${title}</h3><div class="bars">${arr.map(([l, v, t]) => `<div><span>${esc(l)}</span><em><u style="width:${Math.max(2, v / m * 100)}%;background:${col || '#3A9A6A'}"></u></em><b>${t || fmt(v)}</b></div>`).join('')}</div>${note ? `<p class="note">${note}</p>` : ''}</div>`; };
  const pref = p => Object.entries(T).filter(([key]) => key.startsWith(p)).map(([key, v]) => [key.slice(p.length), v]);
  // entonnoir : part des appareils qui, dans la journée, vont jusqu'à chaque étape
  const funnel = sumPref('x:plat=', ':dev') ? `<div class="scard"><h3>Du lancement à la sortie</h3><div class="bars">${[['Ont ouvert l’appli', newDays], ...ST_FUNNEL.map(([id, l]) => [l, g(T, 'u:' + id)])].map(([l, v]) => `<div><span>${l}</span><em><u style="width:${Math.max(2, v / newDays * 100)}%;background:#2F5E45"></u></em><b>${pc(v, newDays)}</b></div>`).join('')}</div><p class="note">Part des appareils qui, dans leur journée, sont allés jusqu’à cette étape (${fmt(newDays)} jours d’utilisation). Compté depuis le 29 octobre 2026.</p></div>` : '';
  const ages = barList('Nouveaux et habitués', [['Premier jour', g(T, 'd:age:nouveau')], ['Installé depuis 1 à 7 jours', g(T, 'd:age:j1-7')], ['Depuis 8 à 30 jours', g(T, 'd:age:j8-30')], ['Depuis plus de 30 jours', g(T, 'd:age:j30')], ['Installé avant le suivi', g(T, 'd:age:ancien')]].map(([l, v]) => [l, v, pc(v, ageDays)]), '#6FA8DC', 'Part des jours d’utilisation selon l’ancienneté de l’appareil.', true);
  // heures d'utilisation
  const hrs = Array.from({ length: 24 }, (_, h) => g(T, 'c:heure_' + String(h).padStart(2, '0'))), maxH = Math.max(...hrs);
  const hours = maxH ? `<div class="scard"><h3>Heures d’utilisation</h3><svg viewBox="0 0 340 86" width="100%">${hrs.map((v, h) => { const bh = v / maxH * 66; return `<rect x="${(4 + h * 14).toFixed(1)}" y="${(70 - bh).toFixed(1)}" width="11" height="${bh.toFixed(1)}" rx="2" fill="#3A9A6A"><title>${h} h : ${fmt(v)}</title></rect>`; }).join('')}${[0, 6, 12, 18].map(h => `<text x="${(9.5 + h * 14).toFixed(1)}" y="83" font-size="10" fill="currentColor" opacity=".6" text-anchor="middle">${h} h</text>`).join('')}</svg><p class="note">Ouvertures et retours dans l’appli, selon l’heure du téléphone.</p></div>` : '';
  // sorties et coupures GPS par version et par appareil
  const cross = (dn, title, name, sort) => { const m = {};
    for (const [key, v] of pref(`x:${dn}=`)) { const i = key.lastIndexOf(':'), id = key.slice(0, i); (m[id] = m[id] || {})[key.slice(i + 1)] = v; }
    const ids = Object.keys(m).sort(sort); if (!ids.length) return '';
    return `<table class="tb"><tr><th>${title}</th><th>Usage</th><th>Sorties</th><th>Coupure GPS</th><th>Batterie</th></tr>${ids.map(id => { const x = m[id]; return `<tr><td>${esc(name(id))}</td><td>${pc(x.dev || 0, newDays)}</td><td>${fmt(x.sortie || 0)}</td><td>${x.sortie ? pc(x.coupee || 0, x.sortie) + (x.coupure_min ? ` <small>${fmt(x.coupure_min)} min</small>` : '') : '–'}</td><td>${x.batt_h ? (x.batt_pct / x.batt_h).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %/h' : '–'}</td></tr>`; }).join('')}</table>`; };
  const PLAT = { android: 'Appli Android', 'web-android': 'Site, Android', 'web-ios': 'Site, iPhone', 'web-pc': 'Site, ordinateur' };
  const osName = v => v.startsWith('android') ? 'Android ' + v.slice(7) : v.startsWith('ios') ? 'iOS ' + v.slice(3) : v === 'autre' ? 'Ordinateur / autre' : v;
  const vt = cross('ver', 'Version', v => 'v' + v, (a, b) => b - a) + cross('plat', 'Appareil', v => PLAT[v] || v) + cross('os', 'Système', osName, (a, b) => (parseInt(b.replace(/\D/g, '')) || 0) - (parseInt(a.replace(/\D/g, '')) || 0));
  const payName = (() => { let dn = null; try { dn = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch {} return c => { try { return (dn && dn.of(c)) || c; } catch { return c; } }; })();
  const flag = c => /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map(x => 0x1F1E6 + x.charCodeAt(0) - 65)) + ' ' : '';
  const paysT = cross('pays', 'Pays', c => flag(c) + payName(c), (a, b) => (pref(`x:pays=${b}:dev`)[0] || [0, 0])[1] - (pref(`x:pays=${a}:dev`)[0] || [0, 0])[1]);
  const pays = paysT ? `<div class="scard"><h3>Pays</h3>${paysT}<p class="note">Pays d’où l’appareil a envoyé sa journée, déduit par Cloudflare (aucune adresse IP gardée). Collecté depuis le 29 octobre 2026.</p></div>` : '';
  const versions = vt ? `<div class="scard"><h3>Versions, coupures GPS et batterie</h3>${vt}<p class="note">Usage : part des jours d’utilisation. Coupure GPS : part des sorties avec au moins un trou de position. Batterie : consommation moyenne pendant les sorties.</p></div>` : '';
  // sorties en détail, fiabilité, fidélité
  const kv = (title, rows, note) => { rows = rows.filter(Boolean); return rows.length ? `<div class="scard"><h3>${title}</h3><div class="kv">${rows.map(([l, v, sub]) => `<div><span>${l}</span><b>${v}${sub ? ` <small>${sub}</small>` : ''}</b></div>`).join('')}</div>${note ? `<p class="note">${note}</p>` : ''}</div>` : ''; };
  const dur = m => m >= 60 ? Math.floor(m / 60) + ' h ' + String(Math.round(m % 60)).padStart(2, '0') : Math.round(m) + ' min';
  const km1 = v => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' km', sec = v => (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' s';
  const perN = (a, b) => b ? (a / b).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '–';
  const nNav = g(T, 'c:nav'), gps = ['bon', 'moyen', 'mauvais'].map(x => g(T, 'c:gps_' + x)), gpsT = gps.reduce((a, b) => a + b, 0);
  const detail = kv('Sorties en détail', [
    out && ['Durée moyenne', dur(g(T, 'c:minutes_sortie') / out)],
    g(T, 'c:sortie_pied') && ['Distance moyenne à pied', km1(g(T, 'c:km_pied') / g(T, 'c:sortie_pied'))],
    g(T, 'c:sortie_velo') && ['Distance moyenne à vélo', km1(g(T, 'c:km_velo') / g(T, 'c:sortie_velo'))],
    (out || g(T, 'c:sortie_supprimee')) && ['Sorties gardées', pc(out, out + g(T, 'c:sortie_supprimee')), `${fmt(g(T, 'c:sortie_supprimee'))} jetée(s)`],
    nNav && ['Recalculs par navigation', perN(g(T, 'c:recalcul'), nNav)],
    nNav && ['Retours à la trace par navigation', perN(g(T, 'c:retour_trace_manuel') + g(T, 'c:retour_trace_auto'), nNav)],
    out && ['Faites sans réseau (au moins un moment)', pc(g(T, 'c:sortie_hors_ligne'), out)],
    g(T, 'c:batt_h') && ['Batterie consommée', (g(T, 'c:batt_pct') / g(T, 'c:batt_h')).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' % / h', `sur ${dur(g(T, 'c:batt_h') * 60)} mesurées`],
    gpsT && ['Précision GPS', `${pc(gps[0], gpsT)} bonne`, `${pc(gps[1], gpsT)} moyenne · ${pc(gps[2], gpsT)} mauvaise`]
  ], 'Précision GPS : bonne à 10 m près, moyenne jusqu’à 30 m, mauvaise au-delà. Batterie : sorties sans recharge, d’au moins 15 min.');
  const svc = n => { const ok = g(T, `c:svc_${n}_ok`), ko = g(T, `c:svc_${n}_echec`); return ok + ko ? [n === 'brouter' ? 'Itinéraires BRouter' : 'Itinéraires de secours (OSRM)', pc(ok, ok + ko) + ' réussis', `${fmt(ok + ko)} demandes`] : null; };
  const loops = g(T, 'c:boucle_calculs');
  const fiab = kv('Fiabilité', [
    g(T, 'c:perf_demarrage_n') && ['Démarrage (carte prête)', sec(g(T, 'c:perf_demarrage_ms') / g(T, 'c:perf_demarrage_n'))],
    g(T, 'c:perf_carte_n') && ['Carte entièrement affichée', sec(g(T, 'c:perf_carte_ms') / g(T, 'c:perf_carte_n'))],
    svc('brouter'), svc('osrm'),
    loops && ['Boucles introuvables', pc(g(T, 'c:boucle_introuvable'), loops), `${fmt(g(T, 'c:boucle_echec_serveur'))} échec(s) serveur · ${fmt(g(T, 'c:boucle_sans_reseau'))} sans réseau`]
  ], 'Temps moyens depuis l’ouverture de l’appli. Les demandes faites sans réseau ne comptent pas comme des échecs.');
  const yest0 = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const ret = [1, 7, 30].map(m => { const lim = new Date(Date.parse(yest0) - m * 864e5).toISOString().slice(0, 10); let n = 0, r = 0;
    for (const [d, v] of Object.entries(byDay)) if (d <= lim) { n += v['d:age:nouveau'] || 0; r += v['ret:j' + m] || 0; }
    return [`Revenus après ${m} jour${m > 1 ? 's' : ''}`, n ? pc(r, n) : '–', n ? `${fmt(r)} sur ${fmt(n)}` : 'pas encore assez de recul']; });
  const fidel = g(T, 'd:age:nouveau') ? kv('Fidélité des nouveaux appareils', ret, 'Parmi les appareils arrivés pendant la période, part de ceux qui ont rouvert l’appli au moins 1, 7 ou 30 jours après leur premier jour. Seuls comptent ceux arrivés assez tôt.') : '';
  const feats = Object.entries(ST_LABELS).map(([key, l]) => [l, g(T, 'c:' + key)]);
  const dimNames = { plat: 'Appli / navigateur', os: 'Système', pays: 'Pays', lang: 'Langue', ver: 'Version', mode: 'Mode', screen: 'Écran', strava: 'Strava connecté', drive: 'Sauvegarde Drive', theme: 'Thème', voice: 'Voix', eco: 'Économie batterie', poi: 'Points utiles', night: 'Alerte nuit', lit: 'De nuit : éclairé', units: 'Unités', layer: 'Fond de carte' };
  const dims = Object.entries(dimNames).map(([d, l]) => { const arr = pref(`d:${d}:`); if (!arr.length) return ''; arr.sort((a, b) => b[1] - a[1]);
    return `<div class="dim"><b>${l}</b>${arr.map(([v, c]) => `<span>${esc(v)} <i>${Math.round(c / devDays * 100)} %</i></span>`).join('')}</div>`; }).join('');
  const known = new Set(Object.keys(ST_LABELS).map(x => 'c:' + x));
  const others = Object.entries(T).filter(([key]) => key.startsWith('c:') && !known.has(key) && !/^c:(err:|carte_|fond_|heure_|svc_|perf_|gps_|batt_|boucle_introuvable|boucle_echec_serveur|boucle_sans_reseau|boucle_calculs|boucle_secondes|sortie_hors_ligne|sortie_pied|sortie_velo|sortie_coupee|coupure_min|km_|minutes_sortie|open|resume)/.test(key)).map(([key, v]) => [key.slice(2), v]);
  // filtres
  const chip = (on, href, l) => `<a class="${on ? 'on' : ''}" href="${href}">${l}</a>`;
  const filt = [['all', 'Tout'], ['app', '📱 Appli'], ['web', '🌐 Site web']].map(([x, l]) => chip(x === f, link({ f: x }), l)).join('');
  const pers = [['hier', 'Hier'], ['7', '7 jours'], ['30', '30 jours'], ['90', '90 jours'], ['all', 'Tout']].map(([x, l]) => chip(x === R.p, link({ p: x, from: null, to: null, g: null }), l)).join('')
    + `<a href="${link({ csv: 1 })}" style="margin-left:auto">⬇ Excel</a>`;
  const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const form = `<details class="dates"${R.p === 'custom' ? ' open' : ''}><summary>📅 Choisir les dates</summary><form method="get"><input type="hidden" name="key" value="${esc(decodeURIComponent(k))}"><input type="hidden" name="tab" value="stats"><input type="hidden" name="p" value="custom"><input type="hidden" name="f" value="${f}">
<label>Du <input type="date" name="from" value="${R.from > '2020' ? R.from : ''}" max="${yest}"></label><label>au <input type="date" name="to" value="${R.to}" max="${yest}"></label><button>Afficher</button></form></details>`;
  const per = R.len === 1 ? 'Le ' + stDate(R.from, true) : R.p === 'all' ? 'Depuis le début' : `Du ${stDate(R.from, R.from.slice(0, 4) !== R.to.slice(0, 4))} au ${stDate(R.to, true)}`;
  const fl = { all: '', app: ' · appli Android', web: ' · site web' }[f];
  const prevNote = R.p === 'all' ? '' : ` <span class="note">(▲▼ par rapport aux ${R.len} jours d’avant)</span>`;
  return nav + `<main><style>.per{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}.per a,.mini a{background:var(--chip);border-radius:999px;padding:5px 12px;font-weight:600;font-size:13px;color:var(--ink);text-decoration:none}.per a.on,.mini a.on{background:var(--go);color:#fff}
.mini{display:flex;gap:4px}.mini a{padding:3px 9px;font-size:12px}.hd{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}.hd h3{margin:0!important}
.dates{margin:2px 0 8px;font-size:13px}.dates summary{cursor:pointer;color:var(--mut);font-weight:600}.dates form{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}.dates input{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:5px 8px;color-scheme:light dark;font:inherit}.dates button{background:var(--go);color:#fff;border:0;border-radius:999px;padding:6px 14px;font-weight:700;font:inherit;font-weight:700}
.range{font-weight:700;margin:6px 0 8px}.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}.k{background:var(--card);border-radius:14px;padding:10px 12px}.k b{display:block;font-size:24px}.k small{color:var(--mut);display:block}.k i{font-style:normal;font-size:12px;font-weight:700}.k i.up{color:#3A9A6A}.k i.dn{color:#C8412F}
.scard{display:block;background:var(--card);border-radius:14px;padding:12px;margin-top:10px}.scard h3{margin:0 0 8px;font-size:13px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}.scard svg{color:var(--ink)}
.bars div{display:grid;grid-template-columns:minmax(120px,40%) 1fr auto;gap:8px;align-items:center;font-size:13px;margin:4px 0}.bars em{display:block;height:10px}.bars u{display:block;height:10px;border-radius:5px}.bars b{font-size:12px;color:var(--mut)}
.kv div{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:5px 0;border-top:1px solid var(--line)}.kv div:first-child{border-top:0}.kv b{text-align:right;font-weight:700}.kv small{display:block;font-weight:400;color:var(--mut);font-size:11px}
.tb{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px}.tb th{text-align:left;color:var(--mut);font-weight:600;font-size:12px;padding:4px 6px 4px 0}.tb td{padding:5px 6px 5px 0;border-top:1px solid var(--line)}.tb small{color:var(--mut)}
.leg{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--mut)}.leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
.dim{margin:6px 0;font-size:13px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}.dim b{width:100%;font-size:12px;color:var(--mut)}.dim span{background:var(--chip);border-radius:8px;padding:2px 8px}.dim i{font-style:normal;color:var(--mut)}
.note{font-size:12px;color:var(--mut)}</style>
<div class="per">${filt}</div><div class="per">${pers}</div>${form}
<div class="range">${per}${fl}${prevNote}</div>${g(T, 'dev') ? '' : '<p class="note">Aucune donnée pour cette période' + (f === 'all' ? '' : ' et ce filtre (le classement appli / site web existe depuis le 29 octobre 2026)') + '.</p>'}${kpis}${chart}
${funnel}${detail}${fiab}${fidel}${pays}${ages}${hours}${versions}
${barList('Fonctions utilisées', feats)}
${barList('Cartes hors ligne téléchargées', pref('c:carte_').map(([c, v]) => [({ fr: 'France', es: 'Espagne', at: 'Autriche', be: 'Belgique', ch: 'Suisse', gb: 'Royaume-Uni', de: 'Allemagne', ca: 'Canada', us: 'États-Unis', zone: 'Zone libre' })[c] || c, v]))}
${barList('Fonds de carte choisis', pref('c:fond_'), '#2F5E45')}
<div class="scard"><h3>Appareils et réglages (part des jours-appareils)</h3>${dims || '<p class="note">Pas encore de données.</p>'}</div>
${barList('Erreurs de l’appli', pref('c:err:'), '#C8412F')}
${barList('Autres compteurs', others, '#8a959e')}
<p class="note">Anonyme : chaque appareil envoie une fois par jour les compteurs de la veille, additionnés ici par jour (aucune ligne par appareil, aucune position). Les chiffres arrivent avec un jour de décalage, et seulement quand l’appareil rouvre l’appli.</p></main>`;
}

// export pour Excel : une ligne par jour, une colonne par compteur (séparateur « ; », virgule décimale, UTF-8 avec BOM) ; même période et même filtre que la page
async function statsCsv(env, url) {
  if (!env.STATS) return new Response('Base STATS non reliée', { status: 503 });
  await stFold(env);
  const R = stRange(url), byDay = {};
  for (const r of (await env.STATS.prepare('SELECT day, k, v FROM daily WHERE day >= ?1 AND day <= ?2 ORDER BY day').bind(R.from, R.to).all()).results) {
    const k = stKey(r.k, R.f); if (!k) continue; const d = byDay[r.day] || (byDay[r.day] = {}); d[k] = (d[k] || 0) + r.v;
  }
  const keys = [...new Set(Object.values(byDay).flatMap(Object.keys))].sort((a, b) => (a === 'dev' ? -1 : b === 'dev' ? 1 : a.localeCompare(b)));
  const fun = Object.fromEntries(ST_FUNNEL.map(([id, l]) => [id, l]));
  const name = k => k === 'dev' ? 'appareils actifs' : k.startsWith('c:') ? (ST_LABELS[k.slice(2)] || k.slice(2)) : k.startsWith('d:') ? k.slice(2).replace(':', ' = ') : k.startsWith('u:') ? 'appareils : ' + (fun[k.slice(2)] || k.slice(2)) : k.startsWith('x:') ? k.slice(2).replace(':', ' · ') : k;
  const cell = v => { const t = String(v).replace(/"/g, '""'); return /[;"\n]/.test(t) ? `"${t}"` : t; };
  const num = v => v == null ? '' : String(Math.round(v * 10) / 10).replace('.', ',');
  const lines = [['Jour', ...keys.map(name)].map(cell).join(';')];
  for (const d of Object.keys(byDay).sort()) lines.push([d, ...keys.map(k => num(byDay[d][k]))].join(';'));
  const tag = (R.p === 'custom' ? R.from + '_' + R.to : R.p === 'all' ? 'tout' : R.p === 'hier' ? R.from : R.p + 'j') + (R.f === 'all' ? '' : '-' + R.f);
  return new Response('﻿' + lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="pisteo-statistiques-${tag}.csv"`, 'Cache-Control': 'no-store' } });
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
// En-tête commun de la page d'administration : même titre et mêmes onglets, au même endroit, sur chaque section
function adminHead(k, sec) {
  const T = [['cat', '⭐ Catalogue', ''], ['stats', '📊 Statistiques', '&tab=stats'], ['etat', '🛰️ Services', '&tab=etat']];
  return `<header><h1>Administration Pisteo</h1><nav>${T.map(([id, l, q]) => `<a href="?key=${k}${q}"${id === sec ? ' class="on"' : ''}>${l}</a>`).join('')}</nav></header>`;
}
// Pour juger une panne : ce que voient les utilisateurs, ce que Paul doit faire, et au bout de combien d'heures prévenir Claude
// (tell : 0 = tout de suite ; null = jamais, ça se règle tout seul)
const ETAT_GUIDE = {
  site: { impact: 'Les personnes qui ont déjà ouvert Pisteo continuent normalement (copie sur le téléphone). Les nouveaux ne peuvent pas l\'ouvrir.', todo: 'Regarde cloudflarestatus.com. Si Cloudflare annonce une panne : attendre. Sinon, ouvre Cloudflare › Workers & Pages › pisteo › Deployments et regarde si le dernier déploiement a échoué.', tell: 1 },
  brouter: { impact: 'Les itinéraires passent par le secours OSRM : un peu moins fins, sans la variante « Balade » ni l\'option rues éclairées.', todo: 'Rien, attendre : BRouter est tenu par un bénévole et revient en général dans la journée.', tell: 72 },
  osrm: { impact: 'Aucun pour l\'instant : c\'est le secours de BRouter, qui marche. Mais si BRouter tombe, il n\'y aura plus de calcul d\'itinéraire en ligne.', todo: 'Rien.', tell: 168 },
  ign: { impact: 'En France, la carte Monde s\'affiche à la place du Plan IGN. Les cartes IGN téléchargées restent utilisables.', todo: 'Rien, attendre. L\'IGN annonce ses maintenances sur geoservices.ign.fr.', tell: 48 },
  ortho: { impact: 'Les photos aériennes ne s\'affichent plus : l\'appli revient sur la carte IGN.', todo: 'Rien.', tell: 168 },
  ofm: { impact: 'La carte Monde est remplacée par la carte officielle du pays. Les zones Monde déjà téléchargées restent utilisables.', todo: 'Rien, attendre.', tell: 72 },
  topo: { impact: 'Fond optionnel remplacé automatiquement par IGN ou Monde.', todo: 'Rien : service bénévole, il revient en général tout seul.', tell: null },
  cyclosm: { impact: 'Fond optionnel remplacé automatiquement par IGN ou Monde.', todo: 'Rien : service bénévole.', tell: null },
  alti: { impact: 'Les altitudes viennent d\'Open-Meteo : un peu moins précises, sans conséquence pour la navigation.', todo: 'Rien.', tell: 168 },
  adresses: { impact: 'La recherche d\'adresses en France ne répond plus ; les noms de lieux restent cherchables.', todo: 'Rien, attendre.', tell: 72 },
  photon: { impact: 'La recherche de lieux passe par l\'index de l\'IGN : France seulement.', todo: 'Rien, attendre.', tell: 168 },
  overpass: { impact: 'Téléchargement des chemins hors ligne et recherche « autour de moi » un peu plus lents : les miroirs prennent le relais.', todo: 'Rien : panne fréquente, ça revient seul.', tell: null },
  overpass2: { impact: 'Un des deux miroirs d\'Overpass ne répond pas. Si le serveur principal est aussi en panne, il reste le troisième.', todo: 'Rien.', tell: null },
  meteo: { impact: 'La météo du parcours vient de MET Norway (yr.no) : même affichage.', todo: 'Rien.', tell: 168 },
  met: { impact: 'Aucun tant qu\'Open-Meteo marche : c\'est le secours de la météo.', todo: 'Rien.', tell: null },
  altisecours: { impact: 'Aucun tant que l\'altitude IGN marche (c\'est son secours). Open-Meteo sert aussi la météo : à surveiller.', todo: 'Rien.', tell: 168 },
  data: { impact: 'Les parcours balisés et points utiles sont lus directement sur GitHub (secours) ; ceux déjà vus restent sur le téléphone.', todo: 'Regarde githubstatus.com.', tell: 48 },
  dataraw: { impact: 'Aucun tant que GitHub Pages marche : c\'est le secours des parcours balisés.', todo: 'Rien.', tell: 168 },
  wmt: { impact: 'Le calque des parcours balisés hors France peut manquer ; le tracé passe par Overpass.', todo: 'Rien.', tell: null },
  communes: { impact: 'Lors d\'un téléchargement de carte, les communes pour la recherche hors ligne ne sont pas récupérées.', todo: 'Rien, retélécharger la zone plus tard si besoin.', tell: null },
  strava: { impact: 'Les sorties ne partent plus sur Strava. Elles restent dans « Mes sorties » et peuvent être envoyées plus tard (ou importées à la main).', todo: 'Regarde status.strava.com. Pense aussi à l\'abonnement développeur Strava (essai jusqu\'au ~24 nov.).', tell: 24 },
  drive: { impact: 'La sauvegarde Google Drive échoue ; elle reprendra seule. L\'export en fichier marche toujours.', todo: 'Regarde google.com/appsstatus.', tell: 48 },
  geofabrik: { impact: 'Aucun pour les utilisateurs. La mise à jour des données du 1er et du 15 utilise le serveur de secours.', todo: 'Rien.', tell: null },
};
const ETAT_NAT = { es: 1, at: 1, be: 1, ch: 1, gb: 1, de: 1, ca: 1, us: 1 };
function etatGuide(r) {
  if (ETAT_GUIDE[r.id]) return ETAT_GUIDE[r.id];
  if (ETAT_NAT[r.id]) return { impact: 'Dans ce pays, la carte Monde s\'affiche à la place de la carte officielle. Les zones déjà téléchargées restent utilisables.', todo: r.id === 'gb' && (r.code === 401 || r.code === 403) ? 'Code ' + r.code + ' : la clé Ordnance Survey est peut-être expirée → vérifie sur osdatahub.os.uk, puis préviens-moi.' : 'Rien, attendre.', tell: r.id === 'gb' && (r.code === 401 || r.code === 403) ? 0 : 168 };
  return { impact: '', todo: '', tell: 72 };
}
// verdict d'ensemble : act (agir / me prévenir), watch (secours actifs, rien à faire), ok
function etatVerdict(e) {
  const now = Date.now(), down = e.res.filter(r => !r.ok), is = id => down.some(r => r.id === id);
  const items = down.map(r => {
    const g = etatGuide(r), h = r.since ? (now - Date.parse(r.since)) / 36e5 : 0;
    return { id: r.id, name: r.name, hours: Math.round(h * 10) / 10, impact: g.impact, todo: g.todo, tell: g.tell, overdue: g.tell != null && h >= g.tell };
  });
  const blocking = [];
  if (is('site')) blocking.push('le site est injoignable pour les nouveaux utilisateurs');
  if (is('brouter') && is('osrm')) blocking.push('plus aucun calcul d\'itinéraire en ligne (BRouter et son secours sont en panne)');
  if (is('ign') && is('ofm')) blocking.push('la carte IGN et la carte Monde sont toutes les deux en panne');
  if (is('data') && is('dataraw')) blocking.push('les parcours balisés ne se chargent plus (GitHub Pages et son secours)');
  const overdue = items.filter(i => i.overdue);
  let level = 'ok', title = 'Tout fonctionne', text = 'Rien à faire.';
  if (blocking.length || overdue.length) {
    level = 'act'; title = blocking.length ? 'Panne gênante' : 'Panne qui dure';
    text = (blocking.length ? 'Les utilisateurs sont gênés : ' + blocking.join(' ; ') + '. ' : '') + (overdue.length ? 'Préviens Claude (bouton ci-dessous) : ' + overdue.map(i => i.name).join(', ') + '.' : 'Préviens Claude si ça dure plus d\'une heure.');
  } else if (items.length) {
    level = 'watch'; title = 'Secours en place, rien à faire';
    text = 'L\'appli contourne ' + (items.length > 1 ? 'ces pannes' : 'cette panne') + ' toute seule. Je te dirai quand me prévenir si ça dure.';
  }
  return { level, title, text, items };
}
function etatMessage(e, v) {
  return `Pisteo – état des services du ${etatDate(e.t)} : ${v.title}.\n` + v.items.map(i => `- ${i.name} : en panne depuis ${i.hours} h (code ${(e.res.find(r => r.id === i.id) || {}).code || 'aucune réponse'})`).join('\n') + '\nPeux-tu regarder ce qu\'il faut faire ?';
}
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
async function etatCheck(env) { return etatStore(env, await Promise.all(ETAT.map(etatOne))); }
async function etatStore(env, res) {
  const prev = (env.CATALOGUE && await env.CATALOGUE.get('etat', 'json')) || { res: [] };
  const now = new Date().toISOString();
  for (const r of res) { // depuis quand un service est en panne
    const p = prev.res.find(x => x.id === r.id);
    if (!r.ok) r.since = p && !p.ok && p.since ? p.since : now;
  }
  const out = { t: now, down: res.filter(r => !r.ok).map(r => r.id), res };
  if (env.CATALOGUE) await env.CATALOGUE.put('etat', JSON.stringify(out));
  if (env.STATS) try {
    await stInit(env);
    const st = env.STATS.prepare('INSERT INTO etat_log (t, id, ok, ms) VALUES (?1, ?2, ?3, ?4)');
    await env.STATS.batch([...res.map(r => st.bind(now, r.id, r.ok ? 1 : 0, r.ok && r.ms ? Math.round(r.ms) : null)),
      env.STATS.prepare('DELETE FROM etat_log WHERE t < ?1').bind(new Date(Date.now() - 400 * 864e5).toISOString())]);
  } catch {}
  return out;
}
// heure de Paris (0-23)
const parisHour = () => parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(new Date()), 10);
const ETAT_DAY = [7, 21]; // vérifications de 7 h à 21 h ; la nuit, personne ne navigue (ou presque)
async function etatDue(env) {
  const h = parisHour();
  if (h < ETAT_DAY[0] || h > ETAT_DAY[1]) return false;
  const prev = env.CATALOGUE && await env.CATALOGUE.get('etat', 'json');
  // une panne qui gêne (service critique) ou récente (moins de 24 h) : on suit son retour toutes les heures ;
  // une panne qui dure sur un service secondaire (Overpass…) ne change rien à l'appli : rythme normal
  if (prev && (prev.res || []).some(r => !r.ok && (r.crit || Date.now() - Date.parse(r.since || prev.t) < 24 * 36e5))) return true;
  return h % 2 === 1; // sinon une fois toutes les 2 h : 7 h, 9 h, 11 h… 21 h
}
async function etatLoad(env, url) {
  let e = env.CATALOGUE && await env.CATALOGUE.get('etat', 'json');
  // résultat trop vieux en journée (plus de 3 h : déclencheur absent) : on vérifie maintenant ; la nuit, on garde le dernier.
  // « revérifier » : 5 min au plus souvent
  const age = e ? Date.now() - Date.parse(e.t) : Infinity, h = parisHour(), day = h >= ETAT_DAY[0] && h <= ETAT_DAY[1];
  if (!e || (day && age > 3 * 36e5) || (url.searchParams.get('maintenant') === '1' && age > 5 * 6e4)) e = await etatCheck(env);
  return e;
}
const etatDate = d => new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function etatTable(e) {
  const order = r => r.ok ? 2 : r.crit ? 0 : 1;
  const row = r => `<tr data-id="${r.id}" class="${r.ok ? 'ok' : r.crit ? 'crit' : 'ko'}"><td>${r.ok ? '✅' : r.crit ? '🔴' : '🟠'}</td><td>${r.name}</td><td>${r.ok ? r.ms + ' ms' : 'en panne' + (r.since ? ' depuis le ' + etatDate(r.since) : '') + (r.code ? ' (' + r.code + ')' : '')}</td><td>${r.backup || ''}</td></tr>`;
  return `<style>.etat{border-collapse:collapse;width:100%;max-width:860px;font-size:14px}.etat td,.etat th{padding:7px 8px;border-bottom:1px solid #8883;text-align:left}.etat tr.ko{background:#f59e0b22}.etat tr.crit{background:#ef444433}.etat th{font-size:12px;opacity:.7}</style>
<table class="etat"><tr><th></th><th>Service</th><th>État</th><th>Secours dans l'appli</th></tr>${e.res.slice().sort((a, b) => order(a) - order(b)).map(row).join('')}</table>`;
}
function etatResume(e) {
  const crit = e.res.filter(r => !r.ok && r.crit).length;
  return `Vérifié le ${etatDate(e.t)} · ${e.down.length ? `<b>${e.down.length} en panne</b>${crit ? ' dont ' + crit + ' critique' + (crit > 1 ? 's' : '') : ''}` : '<b>tout fonctionne</b>'} · vérification automatique toutes les 2 h de 7 h à 21 h (toutes les heures pendant une panne critique ou de moins de 24 h)`;
}
// historique des pannes, reconstitué à partir des vérifications notées (etat_log)
async function etatHist(env, url, k) {
  if (!env.STATS) return '';
  await stInit(env);
  const n = ['7', '30', '90'].includes(url.searchParams.get('hp')) ? +url.searchParams.get('hp') : 30;
  const since = new Date(Date.now() - n * 864e5).toISOString();
  const rows = (await env.STATS.prepare('SELECT t, id, ok, ms FROM etat_log WHERE t >= ?1 ORDER BY t').bind(since).all()).results;
  const chips = ['7', '30', '90'].map(x => `<a class="${+x === n ? 'on' : ''}" href="?key=${k}&tab=etat&hp=${x}">${x} jours</a>`).join('');
  const head = `<h2 style="font-size:16px;margin:18px 0 6px">Historique des pannes</h2><div class="hper">${chips}</div>`;
  if (!rows.length) return head + '<p class="hnote">Pas encore d’historique : il se remplit à chaque vérification depuis le 29 octobre 2026.</p>';
  const name = Object.fromEntries(ETAT.map(x => [x[0], x[1]])), crit = Object.fromEntries(ETAT.map(x => [x[0], !!x[4]]));
  const S = {}, eps = [];
  for (const r of rows) {
    const x = S[r.id] || (S[r.id] = { n: 0, ok: 0, ms: 0, msn: 0, cur: null, eps: [] });
    x.n++; if (r.ok) { x.ok++; if (r.ms) { x.ms += r.ms; x.msn++; } }
    if (!r.ok && !x.cur) { x.cur = { id: r.id, a: r.t, b: null }; x.eps.push(x.cur); eps.push(x.cur); }
    else if (r.ok && x.cur) { x.cur.b = r.t; x.cur = null; }
  }
  const now = Date.now(), len = e => (e.b ? Date.parse(e.b) : now) - Date.parse(e.a);
  const dur = ms => { const h = ms / 36e5; return h < 1 ? Math.max(1, Math.round(ms / 6e4)) + ' min' : h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' j'; };
  const date = d => new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const pc = x => (Math.floor(x.ok / x.n * 1000) / 10).toLocaleString('fr-FR') + ' %';
  const ids = Object.keys(S).sort((a, b) => S[a].ok / S[a].n - S[b].ok / S[b].n || (name[a] || a).localeCompare(name[b] || b));
  const bad = ids.filter(id => S[id].eps.length), good = ids.length - bad.length;
  const sum = { checks: Math.max(...ids.map(id => S[id].n)), eps: eps.length, open: eps.filter(e => !e.b).length };
  const table = bad.length ? `<table class="etat"><tr><th>Service</th><th>Disponible</th><th>Pannes</th><th>Durée totale</th><th>Plus longue</th></tr>${bad.map(id => { const x = S[id], tot = x.eps.reduce((a, e) => a + len(e), 0), max = Math.max(...x.eps.map(len)), open = x.cur;
    return `<tr class="${open ? (crit[id] ? 'crit' : 'ko') : ''}"><td>${crit[id] ? '⭐ ' : ''}${name[id] || id}${open ? ' <small>· en panne</small>' : ''}</td><td>${pc(x)}</td><td>${x.eps.length}</td><td>${dur(tot)}</td><td>${dur(max)}</td></tr>`; }).join('')}</table>` : '<p>Aucune panne sur la période. 🎉</p>';
  const last = eps.slice().sort((a, b) => b.a.localeCompare(a.a)).slice(0, 12);
  const list = last.length ? `<h3 style="font-size:14px;margin:14px 0 4px">Dernières pannes</h3><table class="etat"><tr><th>Service</th><th>Début</th><th>Fin</th><th>Durée</th></tr>${last.map(e => `<tr><td>${name[e.id] || e.id}</td><td>${date(e.a)}</td><td>${e.b ? date(e.b) : '<b>en cours</b>'}</td><td>${e.b ? '' : '≥ '}${dur(len(e))}</td></tr>`).join('')}</table>` : '';
  const slow = ids.filter(id => S[id].msn).map(id => [id, S[id].ms / S[id].msn]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const slowTxt = slow.length ? `<p class="hnote">Les plus lents quand ils répondent : ${slow.map(([id, ms]) => `${name[id] || id} (${Math.round(ms)} ms)`).join(', ')}.</p>` : '';
  return head + `<style>.hper{display:flex;gap:6px;margin:0 0 8px}.hper a{background:#ffffff14;border-radius:999px;padding:4px 12px;font-size:13px;font-weight:600;color:inherit;text-decoration:none}.hper a.on{background:#2f6b4f;color:#fff}.hnote{font-size:13px;opacity:.75;max-width:860px}</style>
<p>${sum.checks} vérifications · <b>${sum.eps} panne${sum.eps > 1 ? 's' : ''}</b>${sum.open ? ` dont ${sum.open} en cours` : ''} · ${good} service${good > 1 ? 's' : ''} sans aucune panne · ⭐ = service critique</p>${table}${list}${slowTxt}
<p class="hnote">Mesuré à chaque vérification (toutes les 1 à 2 h, de 7 h à 21 h) : une panne courte entre deux vérifications peut passer inaperçue, et les durées sont approchées à la vérification près.</p>`;
}
async function etatAdmin(env, url, k) {
  const nav = adminHead(k, 'etat');
  const e = await etatLoad(env, url), v = etatVerdict(e);
  const col = { ok: '#22c55e', watch: '#f59e0b', act: '#ef4444' }[v.level], ic = { ok: '✅', watch: '🟠', act: '🔴' }[v.level];
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dur = h => h < 1 ? 'moins d\'1 h' : h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' jours';
  const tellTxt = i => i.tell == null ? 'Inutile : ça se règle tout seul.' : i.overdue ? '<b>Oui, maintenant.</b>' : i.tell === 0 ? '<b>Oui, tout de suite.</b>' : 'Seulement si ça dure plus de ' + dur(i.tell) + '.';
  const cards = v.items.map(i => `<div class="ecard${i.overdue ? ' over' : ''}"><div class="eh"><b>${esc(i.name)}</b><span>en panne depuis ${dur(i.hours)}</span></div>
<p><span class="el">Pour les utilisateurs</span>${esc(i.impact)}</p><p><span class="el">Ce que tu fais</span>${esc(i.todo)}</p><p><span class="el">Me prévenir ?</span>${tellTxt(i)}</p></div>`).join('');
  return nav + `<main class="emain"><style>.emain a{color:#7cc4ff}.everd{border-left:5px solid ${col};background:#ffffff0d;padding:12px 16px;border-radius:8px;max-width:860px;margin:8px 0 18px}
.everd h2{margin:0 0 6px;font-size:18px}.everd p{margin:0}.ecard{background:#ffffff0a;border:1px solid #8884;border-radius:8px;padding:10px 14px;margin:0 0 10px;max-width:830px}.ecard.over{border-color:#ef4444}
.eh{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px}.eh span{opacity:.75;font-size:13px}.ecard p{margin:4px 0;font-size:14px}.el{display:inline-block;min-width:185px;margin-right:6px;opacity:.65;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
.ebtn{background:#2f6b4f;color:#fff;border:0;border-radius:6px;padding:8px 14px;font:inherit;cursor:pointer;margin:4px 0 20px}</style>
<p>${etatResume(e)}</p>
<button class="ebtn" id="erun" style="margin:0 0 6px">🔄 Revérifier maintenant</button>
<div id="eprog" hidden style="max-width:860px;margin:0 0 14px"><div style="height:10px;background:#8883;border-radius:99px;overflow:hidden"><div id="ebar" style="height:100%;width:0;background:var(--go,#2F5E45);transition:width .3s"></div></div>
<p id="etxt" style="margin:6px 0 0;font-size:14px"></p><div id="echips" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:6px;margin-top:10px"></div></div>
<script>(()=>{const ids=${JSON.stringify(ETAT.map(x => x[0]))},names=${JSON.stringify(Object.fromEntries(ETAT.map(x => [x[0], x[1]])))},key=${JSON.stringify(decodeURIComponent(k))};
const b=document.getElementById('erun');b.onclick=async()=>{b.disabled=true;b.textContent='⏳ Vérification en cours…';document.getElementById('eprog').hidden=false;
const bar=document.getElementById('ebar'),txt=document.getElementById('etxt'),res=[];let done=0,bad=0;
document.querySelectorAll('.etat tr[data-id]').forEach(tr=>{tr.className='';tr.cells[0].textContent='⏳';tr.cells[2].textContent='en cours…'});
const chips=document.getElementById('echips'),chip={};ids.forEach(id=>{const c=document.createElement('div');c.style.cssText='background:#ffffff0d;border:1px solid #8884;border-radius:8px;padding:6px 10px;font-size:13px;transition:background .3s';c.textContent='⏳ '+names[id];chips.appendChild(c);chip[id]=c});
const show=()=>{bar.style.width=(100*done/ids.length)+'%';txt.textContent=done+' / '+ids.length+' services vérifiés'+(bad?' · '+bad+' en échec pour l’instant':'')};show();
const u=id=>'?key='+encodeURIComponent(key)+'&tab=etat&un='+encodeURIComponent(id);let next=0;
const worker=async()=>{while(next<ids.length){const id=ids[next++];if(chip[id])chip[id].textContent='🔎 '+names[id]+' · en cours';let r;try{r=await fetch(u(id),{cache:'no-store'}).then(x=>x.json())}catch(_){r={id,name:names[id],ok:false,code:0,err:'réseau'}}
res.push(r);done++;if(!r.ok)bad++;const c=chip[id];if(c){c.textContent=(r.ok?'✅ ':r.crit?'🔴 ':'🟠 ')+names[id]+(r.ok?' · '+r.ms+' ms':' · en panne');c.style.background=r.ok?'#22c55e1a':r.crit?'#ef444440':'#f59e0b33'}const tr=document.querySelector('.etat tr[data-id="'+id+'"]');if(tr){tr.className=r.ok?'ok':r.crit?'crit':'ko';tr.cells[0].textContent=r.ok?'✅':r.crit?'🔴':'🟠';tr.cells[2].textContent=r.ok?r.ms+' ms':'en panne'+(r.code?' ('+r.code+')':'')}show()}};
await Promise.all(Array.from({length:8},worker));txt.textContent='Enregistrement…';
try{await fetch('?key='+encodeURIComponent(key)+'&tab=etat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({res})})}catch(_){}
location.replace('?key='+encodeURIComponent(key)+'&tab=etat')}})()</script>
<div class="everd"><h2>${ic} ${v.title}</h2><p>${esc(v.text)}</p></div>
${cards}${v.items.length ? `<button class="ebtn" id="ecopy">📋 Copier le message pour Claude</button><textarea id="emsg" hidden>${esc(etatMessage(e, v))}</textarea>
<script>document.getElementById('ecopy').onclick=async function(){const t=document.getElementById('emsg').value;try{await navigator.clipboard.writeText(t);this.textContent='✓ Copié : colle-le dans la conversation Pisteo'}catch(_){const a=document.getElementById('emsg');a.hidden=false;a.select();this.textContent='Sélectionné : Ctrl+C'}}</script>` : ''}
<h2 style="font-size:16px;margin:10px 0 6px">Tous les services</h2>${etatTable(e)}${await etatHist(env, url, k).catch(() => '')}</main>`;
}
async function etatGet(env, url, ctx) {
  const e = await etatLoad(env, url);
  // https://api.pisteo.app/etat : données brutes (+ verdict) ; …/etat?format=page : tableau lisible
  if (url.searchParams.get('format') !== 'page') return new Response(JSON.stringify(Object.assign({ verdict: etatVerdict(e) }, e), null, 1), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pisteo · état des services</title>
<style>body{font:15px system-ui;margin:16px;background:#f6f7f5;color:#1d2a24}</style><h1>État des services</h1><p>${etatResume(e)} · <a href="?format=page&maintenant=1">revérifier</a></p>${etatTable(e)}`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
