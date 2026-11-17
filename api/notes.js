/* Fonction Vercel : stocke les notes des viewers (générées par notes_letterboxd.py) dans Supabase.
   GET  /api/notes  → { notes: {...}, saved: <timestamp> }  (lecture publique)
   POST /api/notes  → remplace les notes (header x-secret = CINE_ADMIN_SECRET)
   Utilise la même table que l'historique (cine_data), ligne id = 'notes' : aucune nouvelle table à créer.
   Variables d'environnement : SUPABASE_URL, SUPABASE_SERVICE_KEY, CINE_ADMIN_SECRET.
*/
const ROW_ID = 'notes';

function cfg() {
  return {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: process.env.SUPABASE_SERVICE_KEY || '',
  };
}

function headers(key, extra) {
  const h = { apikey: key, 'Content-Type': 'application/json' };
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
      const n = b && b.notes;
      if (!n || typeof n !== 'object' || Array.isArray(n)) return res.status(400).json({ ok: false, error: 'Données invalides (objet "notes" attendu).' });
      const titles = Object.keys(n);
      if (titles.length > 2000) return res.status(400).json({ ok: false, error: 'Trop de films.' });
      if (JSON.stringify(n).length > 1000000) return res.status(413).json({ ok: false, error: 'Données trop volumineuses.' });

      const data = { notes: n, saved: Date.now() };
      const r = await fetch(url + '/rest/v1/cine_data?on_conflict=id', {
        method: 'POST',
        headers: headers(key, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ id: ROW_ID, data: data, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error('supabase ' + r.status + ' ' + (await r.text()).slice(0, 150));
      return res.status(200).json({ ok: true, films: titles.length, saved: data.saved });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Méthode non autorisée.' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Erreur serveur : ' + e.message });
  }
};
