/* Fonction Vercel : lit / écrit l'historique du cinédimanche dans Supabase.
   Variables d'environnement requises (Vercel → Settings → Environment Variables) :
   - SUPABASE_URL          : ex. https://abcdefgh.supabase.co
   - SUPABASE_SERVICE_KEY  : la clé secrète (service_role / sb_secret_...), JAMAIS dans le navigateur
   - CINE_ADMIN_SECRET     : le mot de passe que tu choisis (seul lui permet d'écrire)
*/
const ROW_ID = 'main';

function cfg() {
  return {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: process.env.SUPABASE_SERVICE_KEY || '',
  };
}

function headers(key, extra) {
  const h = { apikey: key, 'Content-Type': 'application/json' };
  /* les anciennes clés service_role sont des JWT (eyJ...) ; les nouvelles clés sb_secret_ ne vont que dans apikey */
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  return Object.assign(h, extra || {});
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { url, key } = cfg();
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Supabase non configuré sur Vercel (SUPABASE_URL / SUPABASE_SERVICE_KEY).' });

  try {
    if (req.method === 'GET') {
      const r = await fetch(url + '/rest/v1/cine_data?id=eq.' + ROW_ID + '&select=data', { headers: headers(key) });
      if (!r.ok) throw new Error('supabase ' + r.status);
      const rows = await r.json();
      return res.status(200).json(rows && rows[0] && rows[0].data ? rows[0].data : { empty: true });
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
      const r = await fetch(url + '/rest/v1/cine_data?on_conflict=id', {
        method: 'POST',
        headers: headers(key, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ id: ROW_ID, data: clean, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error('supabase ' + r.status + ' ' + (await r.text()).slice(0, 150));
      return res.status(200).json({ ok: true, saved: clean.saved });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Méthode non autorisée.' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Erreur serveur : ' + e.message });
  }
};
