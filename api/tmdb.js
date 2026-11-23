/* Fonction Vercel : relais vers TMDB, pour que la clé API ne soit jamais visible dans le navigateur.
   GET /api/tmdb?path=/search/movie&query=...&language=fr-FR   (lecture publique, seuls les chemins ci-dessous sont autorisés)
   Variable d'environnement Vercel : TMDB_KEY (clé API v3 ou jeton de lecture v4)
*/
const ALLOWED = /^\/(search\/movie|movie\/\d{1,9}|movie\/\d{1,9}\/images)$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }
  const key = (process.env.TMDB_KEY || '').trim();
  if (!key) return res.status(500).json({ error: 'TMDB_KEY manquante sur Vercel.' });

  const q = req.query || {};
  const path = String(q.path || '');
  if (!ALLOWED.test(path)) return res.status(400).json({ error: 'Chemin non autorisé.' });

  const sp = new URLSearchParams();
  Object.keys(q).forEach((k) => {
    if (k === 'path' || k === 'api_key') return;
    const v = Array.isArray(q[k]) ? q[k][0] : q[k];
    sp.set(k, String(v).slice(0, 200));
  });
  const headers = {};
  if (key.length > 40) headers.Authorization = 'Bearer ' + key;
  else sp.set('api_key', key);

  try {
    const r = await fetch('https://api.themoviedb.org/3' + path + '?' + sp.toString(), { headers });
    const txt = await r.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    /* mise en cache côté Vercel : moins d'appels, et le site reste rapide */
    if (r.ok) res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    else res.setHeader('Cache-Control', 'no-store');
    return res.status(r.status).send(txt);
  } catch (e) {
    return res.status(502).json({ error: 'TMDB injoignable.' });
  }
};
