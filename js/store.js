/* =========================================================
   Store — persistence layer
   - Queue + playback state  → Cloudflare R2 (via Worker API)
     with a localStorage mirror for instant/offline restore.
   - Song files               → Cloudflare R2 bucket
     (fallback: browser IndexedDB when API_BASE is empty)
   ========================================================= */
window.Store = (function () {
  const cfg = window.PLAYER_CONFIG || {};
  const LS_KEY = "dmp:state:v1";
  const LS_API_KEY = "dmp:api-override";

  const apiOverride = (() => {
    try { return localStorage.getItem(LS_API_KEY) || ""; } catch (e) { return ""; }
  })();

  const config = {
    api: (apiOverride || cfg.API_BASE || "").replace(/\/+$/, ""),
    token: cfg.API_TOKEN || "",
    maxMB: cfg.MAX_UPLOAD_MB || 100
  };

  function setApiOverride(url) {
    config.api = (url || "").replace(/\/+$/, "");
    try {
      if (config.api) localStorage.setItem(LS_API_KEY, config.api);
      else localStorage.removeItem(LS_API_KEY);
    } catch (e) { /* private mode */ }
  }

  const authHeaders = (extra) => {
    const h = Object.assign({}, extra);
    if (config.token) h["Authorization"] = "Bearer " + config.token;
    return h;
  };

  /* ---------------- local mirror ---------------- */
  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveLocal(state) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        songs: state.songs.map(s => ({
          id: s.id, source: s.source, title: s.title, artist: s.artist,
          album: s.album, duration: s.duration || 0, addedAt: s.addedAt,
          url: s.source === "url" ? s.url : undefined
        })),
        queue: state.queue.slice(),
        index: state.index,
        position: state.position || 0,
        volume: state.volume,
        muted: !!state.muted,
        shuffle: !!state.shuffle,
        repeat: state.repeat || "off",
        liked: Array.from(state.liked || []),
        progress: state.progress || null,
        updatedAt: Date.now()
      }));
    } catch (e) { /* quota / private mode */ }
  }

  /* ---------------- Cloudflare Worker API ---------------- */
  async function apiFetch(path, options) {
    if (!config.api) throw new Error("no-api");
    const res = await fetch(config.api + path, Object.assign({ cache: "no-store" }, options || {}));
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  }

  function health() {
    return apiFetch("/api/health");
  }

  function pullState() {
    return apiFetch("/api/state");
  }

  function pushState(payload) {
    return apiFetch("/api/state", {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    });
  }

  function pullLibrary() {
    return apiFetch("/api/library");
  }

  /* Upload a File/Blob to R2 with progress callbacks. */
  function uploadSong(file, meta, onProgress) {
    return new Promise((resolve, reject) => {
      if (!config.api) return reject(new Error("Cloudflare API not configured"));
      if (file.size > config.maxMB * 1024 * 1024) {
        return reject(new Error("File larger than " + config.maxMB + " MB"));
      }
      const xhr = new XMLHttpRequest();
      xhr.open("POST", config.api + "/api/upload?name=" + encodeURIComponent(file.name || "song"));
      xhr.setRequestHeader("Content-Type", file.type || "audio/mpeg");
      const headers = authHeaders({
        "X-Song-Title": encodeURIComponent(meta.title || ""),
        "X-Song-Artist": encodeURIComponent(meta.artist || ""),
        "X-Song-Album": encodeURIComponent(meta.album || ""),
        "X-Song-Duration": String(Math.round(meta.duration || 0))
      });
      Object.keys(headers).forEach(k => xhr.setRequestHeader(k, headers[k]));

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new Error(body.error || ("Upload failed (HTTP " + xhr.status + ")")));
        } catch (e) { reject(new Error("Invalid server response")); }
      };
      xhr.onerror = () => reject(new Error("Network error — check your API_BASE URL"));
      xhr.send(file);
    });
  }

  function deleteSong(id) {
    if (!config.api) return Promise.resolve({ ok: true });
    return apiFetch("/api/songs/" + encodeURIComponent(id), { method: "DELETE", headers: authHeaders() });
  }

  /* ---------------- local (IndexedDB) songs ---------------- */
  async function addLocalSong(file, meta) {
    const id = "local-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    await window.IDBStore.put({
      id: id,
      title: meta.title || file.name.replace(/\.[^.]+$/, ""),
      artist: meta.artist || "",
      album: meta.album || "",
      duration: meta.duration || 0,
      addedAt: Date.now(),
      type: file.type || "audio/mpeg",
      blob: file
    });
    return {
      id: id, source: "local",
      title: meta.title || file.name.replace(/\.[^.]+$/, ""),
      artist: meta.artist || "", album: meta.album || "",
      duration: meta.duration || 0, addedAt: Date.now()
    };
  }

  async function loadLocalSongs() {
    try {
      const recs = await window.IDBStore.all();
      return recs.map(r => ({
        id: r.id, source: "local",
        title: r.title, artist: r.artist, album: r.album,
        duration: r.duration || 0, addedAt: r.addedAt || 0
      }));
    } catch (e) { return []; }
  }

  async function getLocalSongBlob(id) {
    const rec = await window.IDBStore.get(id);
    return rec ? rec.blob : null;
  }

  async function removeLocalSong(id) {
    try { await window.IDBStore.del(id); } catch (e) { /* ignore */ }
  }

  return {
    config, setApiOverride,
    loadLocal, saveLocal,
    health, pullState, pushState, pullLibrary, uploadSong, deleteSong,
    addLocalSong, loadLocalSongs, getLocalSongBlob, removeLocalSong
  };
})();
