/* Fonction Vercel : envoie le film choisi au bot Discord, sans jamais exposer le mot de passe du bot au navigateur.
   POST /api/cine  (header x-secret = CINE_ADMIN_SECRET)
   Corps : { film, by, num, poster, guild_id? }
   Variables d'environnement Vercel (Settings → Environment Variables) :
   - CINE_ADMIN_SECRET    : ton mot de passe admin (déjà configuré)
   - CINE_HOOK_URL        : adresse du bot, ex. https://mon-bot-discord-2hge.onrender.com/cine
   - CINE_WEBHOOK_SECRET  : le NOUVEAU mot de passe du bot (le même que dans le .env du bot)
   - CINE_GUILD_ID        : (facultatif) ID du serveur Discord
*/
function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Méthode non autorisée.' });
  }

  const admin = process.env.CINE_ADMIN_SECRET;
  const hook = (process.env.CINE_HOOK_URL || '').trim();
  const botSecret = process.env.CINE_WEBHOOK_SECRET || '';
  if (!admin) return res.status(500).json({ ok: false, error: 'CINE_ADMIN_SECRET manquant sur Vercel.' });
  if (!hook || !botSecret) return res.status(500).json({ ok: false, error: 'CINE_HOOK_URL / CINE_WEBHOOK_SECRET manquants sur Vercel.' });
  if (req.headers['x-secret'] !== admin) return res.status(401).json({ ok: false, error: 'Mot de passe incorrect.' });

  const b = readBody(req);
  const film = String(b.film || '').trim().slice(0, 80);
  if (!film) return res.status(400).json({ ok: false, error: 'Film manquant.' });
  const poster = typeof b.poster === 'string' && /^https:\/\//.test(b.poster) ? b.poster.slice(0, 500) : '';

  const payload = {
    secret: botSecret,
    film: film,
    by: String(b.by || '').trim().slice(0, 40),
    num: parseInt(b.num, 10) || 0,
    poster: poster,
    guild_id: String(b.guild_id || process.env.CINE_GUILD_ID || '').trim().slice(0, 30),
  };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    const j = await r.json().catch(() => ({}));
    return res.status(r.ok ? 200 : 502).json(j && typeof j === 'object' && 'ok' in j ? j : { ok: r.ok, error: r.ok ? undefined : 'Réponse inattendue du bot (code ' + r.status + ').' });
  } catch (e) {
    /* 504 : le navigateur réessaie (le bot gratuit sur Render met du temps à se réveiller) */
    return res.status(504).json({ ok: false, error: 'Bot injoignable (il se réveille peut-être).' });
  } finally {
    clearTimeout(timer);
  }
};
