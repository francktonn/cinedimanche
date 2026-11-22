/* Fonction Vercel : stocke les personnalisations des films faites depuis le tableau de bord admin
   (affiche, titre affiché, synopsis, année, durée, genres, ID TMDB) dans Supabase.
   GET  /api/films  → { films: {...}, saved: <timestamp> }  (lecture publique)
   POST /api/films  → remplace les personnalisations (header x-secret = CINE_ADMIN_SECRET)
   Utilise la même table que l'historique (cine_data), ligne id = 'films' : aucune nouvelle table à créer.
   Variables d'environnement : SUPABASE_URL, SUPABASE_SERVICE_KEY, CINE_ADMIN_SECRET (déjà configurées).
   À placer dans le dossier api/ du projet, à côté de historique.js et notes.js.
*/
const ROW_ID = 'films';

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

/* ne garde que les champs connus, avec des limites de taille */
function cleanFilm(o) {
  if (!o || typeof o !== 'object') return null;
  const c = {};
  if (typeof o.title === 'string' && o.title.trim()) c.title = o.title.trim().slice(0, 120);
  if (o.year && /^\d{4}$/.test(String(o.year))) c.year = String(o.year);
  const rt = parseInt(o.runtime, 10);
  if (rt > 0 && rt < 1000) c.runtime = rt;
  if (Array.isArray(o.genres)) {
    const g = o.genres.map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 8);
    if (g.length) c.genres = g;
  }
  if (typeof o.overview === 'string' && o.overview.trim()) c.overview = o.overview.trim().slice(0, 4000);
  if (typeof o.poster === 'string' && o.poster.length <= 600000 && /^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/.test(o.poster)) c.poster = o.poster;
  const tm = parseInt(o.tmdb, 10);
  if (tm > 0) c.tmdb = tm;
  return Object.keys(c).length ? c : null;
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
      const f = b && b.films;
      if (!f || typeof f !== 'object' || Array.isArray(f)) return res.status(400).json({ ok: false, error: 'Données invalides (objet "films" attendu).' });
      const titles = Object.keys(f);
      if (titles.length > 2000) return res.status(400).json({ ok: false, error: 'Trop de films.' });

      const films = {};
      titles.forEach((t) => {
        const c = cleanFilm(f[t]);
        if (c && t.trim()) films[t.trim().slice(0, 80)] = c;
      });
      if (JSON.stringify(films).length > 4000000) return res.status(413).json({ ok: false, error: 'Données trop volumineuses (affiches trop lourdes).' });

      const data = { films: films, saved: Number(b.saved) || Date.now() };
      const r = await fetch(url + '/rest/v1/cine_data?on_conflict=id', {
        method: 'POST',
        headers: headers(key, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ id: ROW_ID, data: data, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error('supabase ' + r.status + ' ' + (await r.text()).slice(0, 150));
      return res.status(200).json({ ok: true, films: Object.keys(films).length, saved: data.saved });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Méthode non autorisée.' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Erreur serveur : ' + e.message });
  }
};
