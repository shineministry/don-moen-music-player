/* =========================================================
   Service worker — music cache + offline app shell
   ---------------------------------------------------------
   • Audio files (/api/songs/*, local media, *.mp3 …) are
     cached whole and served with proper HTTP Range slicing,
     so songs replay instantly without re-downloading.
   • The app shell is cached so the player opens offline.
   ========================================================= */
const VERSION = "v1";
const SHELL_CACHE = "dmp-shell-" + VERSION;
const AUDIO_CACHE = "dmp-audio-" + VERSION;
const KEEP = [SHELL_CACHE, AUDIO_CACHE];

const SHELL_ASSETS = [
  "./",
  "index.html",
  "css/styles.css",
  "js/config.js",
  "js/idb.js",
  "js/store.js",
  "js/app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => (k.startsWith("dmp-shell-") || k.startsWith("dmp-audio-")) && !KEEP.includes(k))
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isAudioRequest(req, url) {
  if (url.pathname.includes("/api/songs/")) return true;
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i.test(url.pathname)) return true;
  return false;
}

/* Serve a full (or Range) response out of a cached copy. */
async function sliceCached(cached, rangeHeader) {
  const buf = await cached.clone().arrayBuffer();
  const total = buf.byteLength;
  const type = cached.headers.get("Content-Type") || "audio/mpeg";
  const base = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Content-Length": String(total),
    "X-Cache": "HIT"
  };

  if (!rangeHeader) {
    return new Response(buf, { status: 200, headers: base });
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) return new Response(buf, { status: 200, headers: base });

  let start, end;
  if (m[1] === "") {
    // suffix range: bytes=-N
    const suffix = Number(m[2]);
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
  }
  if (isNaN(start) || start >= total || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + total } });
  }
  const part = buf.slice(start, end + 1);
  return new Response(part, {
    status: 206,
    headers: Object.assign({}, base, {
      "Content-Range": "bytes " + start + "-" + end + "/" + total,
      "Content-Length": String(part.byteLength)
    })
  });
}

/* Cache-first for audio: fetch ONCE (without Range), store, slice per request. */
async function audioHandler(req, url) {
  const cache = await caches.open(AUDIO_CACHE);
  const key = url.href;
  let cached = await cache.match(key, { ignoreVary: true });

  if (!cached) {
    // Strip Range so we always store a complete 200 response (Cache API rejects 206).
    const headers = new Headers(req.headers);
    headers.delete("range");
    const fresh = await fetch(new Request(url, { headers: headers, credentials: "omit" }));
    if (fresh.ok) {
      cached = fresh.clone();
      try { await cache.put(key, fresh); } catch (e) { /* quota — still playable */ }
    } else {
      return fresh;
    }
  }

  try {
    return await sliceCached(cached, req.headers.get("Range"));
  } catch (e) {
    return cached;
  }
}

/* Stale-while-revalidate for static assets, network-first for navigations. */
async function shellHandler(req) {
  const cache = await caches.open(SHELL_CACHE);
  const isNav = req.mode === "navigate" || req.destination === "document";

  if (isNav) {
    try {
      const fresh = await fetch(req);
      if (fresh.ok) cache.put("index.html", fresh.clone());
      return fresh;
    } catch (e) {
      const hit = await cache.match("index.html", { ignoreVary: true });
      if (hit) return hit;
      throw e;
    }
  }

  const hit = await cache.match(req, { ignoreVary: true }) || await cache.match(req.url, { ignoreVary: true });
  if (hit) {
    // refresh in the background
    fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()).catch(() => {}); }).catch(() => {});
    return hit;
  }
  const fresh = await fetch(req);
  if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (isAudioRequest(req, url)) {
    // Same-origin audio gets cached + range-sliced. Cross-origin audio is
    // passed through untouched (CORS/no-cors constraints).
    if (sameOrigin) event.respondWith(audioHandler(req, url));
    return;
  }
  if (sameOrigin) event.respondWith(shellHandler(req));
});
