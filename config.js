/* Valeurs fixes du site. Ce fichier est PUBLIC une fois déployé : n'y mets JAMAIS de mot de passe, de clé API ni de token.
   Les secrets (bot Discord, TMDB) sont dans les variables d'environnement Vercel, utilisées par api/cine.js et api/tmdb.js. */
window.CINE_CONFIG = {
  channel: "El_matte0",     // nom de ta chaîne Twitch
  reward: "+1 nom cinédimanche"       // nom (ou ID) de la récompense de points de chaîne qui ajoute une part sur la roue
};
