/* Fonction Vercel : lit / écrit l'historique du cinédimanche dans Upstash Redis.
   Variables d'environnement requises (Vercel → Settings → Environment Variables) :
   - KV_REST_API_URL + KV_REST_API_TOKEN   (ou UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN) : ajoutées automatiquement par l'intégration Upstash
   - CINE_ADMIN_SECRET : le mot de passe que tu choisis (seul lui permet d'écrire)
*/
const KEY = 'cinedimanche:data';

function cfg() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

async function redis(cmd) {
  const { url, token } = cfg();
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).result;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { url, token } = cfg();
  if (!url || !token) return res.status(500).json({ ok: false, error: 'Base Redis non configurée sur Vercel.' });

  try {
    if (req.method === 'GET') {
      const raw = await redis(['GET', KEY]);
      return res.status(200).json(raw ? JSON.parse(raw) : { empty: true });
    }

    if (req.method === 'POST') {
      const secret = process.env.CINE_ADMIN_SECRET;
      if (!secret) return res.status(500).json({ ok: false, error: 'CINE_ADMIN_SECRET manquant sur Vercel.' });
      if (req.headers['x-secret'] !== secret) return res.status(401).json({ ok: false, error: 'Mot de passe incorrect.' });

      const b = readBody(req);
      if (!b || !Array.isArray(b.hist)) return res.status(400).json({ ok: false, error: 'Données invalides.' });
      const clean = {
        saved: Number(b.saved) || Date.now(),
        hist: b.hist
          .filter((h) => h && typeof h.film === 'string' && h.film.trim())
          .slice(0, 2000)
          .map((h) => ({
            film: h.film.trim().slice(0, 80),
            by: String(h.by || '').trim().slice(0, 40),
            date: Number(h.date) || 0,
            round: Number(h.round) || 0,
            num: parseInt(h.num, 10) || 0,
          })),
        num: parseInt(b.num, 10) || 0,
        next: String(b.next || '').slice(0, 80),
      };
      await redis(['SET', KEY, JSON.stringify(clean)]);
      return res.status(200).json({ ok: true, saved: clean.saved });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Méthode non autorisée.' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Erreur serveur : ' + e.message });
  }
};
