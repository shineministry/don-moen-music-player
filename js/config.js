/* =========================================================
   Player configuration
   ---------------------------------------------------------
   API_BASE  : URL of your Cloudflare Worker that fronts R2.
               Leave "" to run in "local only" mode (songs are
               stored in this browser's IndexedDB).
   API_TOKEN : must match the API_TOKEN secret set on the
               Worker (wrangler secret put API_TOKEN).
   ========================================================= */
window.PLAYER_CONFIG = {
  API_BASE: "https://don-moen-player-api.shinumaths989.workers.dev",
  API_TOKEN: "",     // same value as the worker's API_TOKEN secret
  MAX_UPLOAD_MB: 100
};
