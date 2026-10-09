// Relais Strava pour Pisteo (Cloudflare Worker, gratuit)
// Il garde le « Client Secret » de l'appli Strava hors du code public de Pisteo
// et transmet les envois de sorties à Strava.
// Variables à définir dans Cloudflare (Settings → Variables and Secrets) :
//   STRAVA_CLIENT_ID      (texte)  ex. 109821
//   STRAVA_CLIENT_SECRET  (secret) le Client Secret de strava.com/settings/api
//   ALLOWED_ORIGIN        (texte)  https://paul12102021.github.io

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
    if (!okOrigin) return new Response('Origine refusée', { status: 403, headers: cors });

    const url = new URL(req.url), path = url.pathname;
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
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
