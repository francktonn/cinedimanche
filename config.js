/* Valeurs fixes du site. Ce fichier est PUBLIC une fois déployé : n'y mets jamais le token du bot Twitch. */
window.CINE_CONFIG = {
  tmdb: "71c6717811caf98ad6554c59ca4dd72b",        // clé API TMDB (v3 ou jeton de lecture v4)
  channel: "El_matte0",     // nom de ta chaîne Twitch (ex : "machaine")
  hook: "https://mon-bot-discord-2hge.onrender.com/cine",        // adresse du bot Discord (ex : https://ton-bot.onrender.com/cine), facultatif
  hookSecret: "",  // mot de passe du bot, facultatif (visible publiquement si rempli, voir note)
  guild: "1545255800564486154",       // ID du serveur Discord, facultatif
  reward: "+1 nom cinédimanche"       // nom (ou ID) de la récompense de points de chaîne qui ajoute une part sur la roue, facultatif
};
