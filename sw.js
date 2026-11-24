/* =========================================================
   Service worker — music cache + offline app shell
   ---------------------------------------------------------
   • Audio files (/api/songs/*, cross-origin R2, *.mp3 …) are
     cached whole and served with proper HTTP Range slicing,
     so every song replays instantly and works fully offline.
   • The app shell is cached so the player opens offline.
   • Pages can ask (postMessage) to pre-download all songs
     into the audio cache — see CACHE_ALL handling below.
   ========================================================= */
const VERSION = "v3";
const SHELL_CACHE = "dmp-shell-" + VERSION;
const AUDIO_CACHE = "dmp-audio-" + VERSION;
const API_CACHE = "dmp-api-" + VERSION;
const KEEP = [SHELL_CACHE, AUDIO_CACHE, API_CACHE];

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
        keys.filter((k) => (k.startsWith("dmp-shell-") || k.startsWith("dmp-audio-") || k.startsWith("dmp-api-")) && !KEEP.includes(k))
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

/* Blob memo: materializing a 175 MB cached body on every seek
   would be slow — read it once per song per SW lifetime. */
const blobMemo = new Map(); // key → Promise<Blob>
function memoBlob(key, cached) {
  if (!blobMemo.has(key)) {
    blobMemo.set(key, cached.blob().catch((e) => { blobMemo.delete(key); throw e; }));
  }
  return blobMemo.get(key);
}

/* Serve a full (or Range) response out of a cached copy. */
async function sliceCached(key, cached, rangeHeader) {
  const blob = await memoBlob(key, cached);
  const total = blob.size;
  const type = cached.headers.get("Content-Type") || "audio/mpeg";
  const base = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Content-Length": String(total),
    "X-Cache": "HIT",
    // synthesized responses must pass CORS for <audio crossorigin>
    "Access-Control-Allow-Origin": "*"
  };

  if (!rangeHeader) {
    return new Response(blob, { status: 200, headers: base });
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) return new Response(blob, { status: 200, headers: base });

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
  const part = blob.slice(start, end + 1);
  return new Response(part, {
    status: 206,
    headers: Object.assign({}, base, {
      "Content-Range": "bytes " + start + "-" + end + "/" + total,
      "Content-Length": String(part.size)
    })
  });
}

/* In-flight full downloads, so playback + pre-cache never
   download the same song twice at once. */
const inflight = new Map(); // url → Promise<void>

/* Download a song once (no Range) and store it whole. */
function fillCache(cache, key, url) {
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const headers = new Headers();
      headers.delete("range");
      const res = await fetch(new Request(url, { headers: headers, credentials: "omit", mode: "cors" }));
      if (res.ok) await cache.put(key, res);
      blobMemo.delete(key); // new bytes → drop any stale memo
    } catch (e) { /* offline / quota — next request retries */ }
    finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

/* Cache-first for audio — works for same-origin AND cross-origin
   (the Worker sends Access-Control-Allow-Origin: *, so the SW can
   read the body and serve Range slices from cache). */
async function audioHandler(event, req, url) {
  const cache = await caches.open(AUDIO_CACHE);
  const key = url.href;
  let cached = await cache.match(key, { ignoreVary: true });

  if (!cached) {
    const range = req.headers.get("Range");
    const startsAtBeginning = !range || /^bytes=(0?)-/.test(range) || /^bytes=-/.test(range);

    if (startsAtBeginning) {
      // A background fill may already be downloading this song — let the
      // page stream from the network instead of starting a second copy.
      if (inflight.has(key)) return fetch(req);
      // Stream the full file to the page as it downloads; a tee'd copy
      // flows into the cache in the background (one download, both jobs).
      const headers = new Headers(req.headers);
      headers.delete("range");
      const fresh = await fetch(new Request(url, { headers: headers, credentials: "omit", mode: "cors" }));
      if (!fresh.ok) return fresh;
      const putP = cache.put(key, fresh.clone()).catch(() => { /* quota */ });
      if (event) event.waitUntil(putP);
      inflight.set(key, putP.finally(() => inflight.delete(key)));
      return fresh; // 200 full-body stream — legal answer to bytes=0-
    }
    // Seek into the middle of an uncached song: pass the Range straight
    // through for instant playback, fill the cache behind it.
    fillCache(cache, key, url);
    return fetch(req);
  }

  try {
    return await sliceCached(key, cached, req.headers.get("Range"));
  } catch (e) {
    return cached;
  }
}

/* =========================================================
   Pre-download every song into the audio cache (offline mode)
   ========================================================= */
let cacheAllRunning = false;

async function cacheAll(urls, client) {
  if (cacheAllRunning) return; // one run at a time (page re-sends on SW update)
  cacheAllRunning = true;
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const total = urls.length;
    let done = 0, failed = 0, added = 0, bytes = 0;
    let lastPost = 0;

    const post = (m) => { try { client && client.postMessage(m); } catch (e) { /* gone */ } };
    // throttled heartbeat: byte progress while a song streams in, so the
    // page can tell an alive SW from a terminated one
    const postProgress = (force) => {
      const now = Date.now();
      if (!force && now - lastPost < 400) return;
      lastPost = now;
      post({ type: "CACHE_PROGRESS", done: done, total: total, bytes: bytes });
    };
    post({ type: "CACHE_PROGRESS", done: 0, total: total, bytes: 0 });

    for (const url of urls) {
      try {
        // if playback is already downloading this song, let it finish first
        if (inflight.has(url)) await inflight.get(url);
        const hit = await cache.match(url, { ignoreVary: true });
        if (!hit) {
          const res = await fetch(new Request(url, { credentials: "omit", mode: "cors" }));
          if (!res.ok) throw new Error("HTTP " + res.status);
          if (res.body) {
            // stream into the cache while counting bytes (progress + heartbeat)
            const tracker = new TransformStream({
              transform(chunk, ctrl) {
                bytes += chunk.byteLength;
                postProgress(false);
                ctrl.enqueue(chunk);
              }
            });
            const tracked = res.body.pipeThrough(tracker);
            await cache.put(url, new Response(tracked, { status: res.status, headers: res.headers }));
            postProgress(true);
          } else {
            const len = Number(res.headers.get("Content-Length") || 0);
            if (len) { await cache.put(url, res); bytes += len; }
            else {
              const clone = res.clone();
              await cache.put(url, res);
              bytes += (await clone.blob()).size;
            }
          }
          blobMemo.delete(url);
          added++;
        }
        done++;
      } catch (e) {
        failed++;
      }
      postProgress(true);
      // let the page breathe between large files
      await new Promise((r) => setTimeout(r, 25));
    }

    post({ type: "CACHE_DONE", total: total, done: done, failed: failed, added: added, bytes: bytes });
  } finally {
    cacheAllRunning = false;
  }
}

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "CACHE_ALL" && Array.isArray(msg.urls)) {
    event.waitUntil(cacheAll(msg.urls, event.source));
  } else if (msg.type === "CACHE_STATUS" && Array.isArray(msg.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(AUDIO_CACHE);
      const cached = [];
      for (const u of msg.urls) if (await cache.match(u, { ignoreVary: true })) cached.push(u);
      try {
        event.source && event.source.postMessage({ type: "CACHE_STATUS", cached: cached, total: msg.urls.length });
      } catch (e) { /* gone */ }
    })());
  } else if (msg.type === "CACHE_ONE" && msg.url) {
    event.waitUntil((async () => {
      const cache = await caches.open(AUDIO_CACHE);
      await fillCache(cache, msg.url, msg.url);
    })());
  }
});

/* =========================================================
   API responses (health / state / library) — network-first
   with a cache fallback, so the library and queue still load
   when the device is offline.
   ========================================================= */
function isApiDataRequest(url) {
  return /^\/api\/(health|state|library)$/.test(url.pathname);
}

async function apiHandler(req, url) {
  const cache = await caches.open(API_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      cache.put(url.href, fresh.clone()).catch(() => { /* quota */ });
      return fresh;
    }
    // gateway/5xx error — the last good copy beats an error page
    const hit = await cache.match(url.href, { ignoreVary: true });
    if (hit) return hit;
    return fresh;
  } catch (e) {
    const hit = await cache.match(url.href, { ignoreVary: true });
    if (hit) return hit;
    throw e;
  }
}

/* Stale-while-revalidate for static assets, network-first for navigations. */
async function shellHandler(req) {
  const cache = await caches.open(SHELL_CACHE);
  const isNav = req.mode === "navigate" || req.destination === "document";

  if (isNav) {
    try {
      const fresh = await fetch(req);
      if (fresh.ok) {
        cache.put("index.html", fresh.clone()).catch(() => {});
        return fresh;
      }
      // a proxy/gateway error page (502…) is worse than the cached app
      const hit = await cache.match("index.html", { ignoreVary: true });
      if (hit) return hit;
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
  if (fresh.ok) {
    cache.put(req, fresh.clone()).catch(() => {});
  } else {
    // same asset may exist under a cached request URL — serve it instead
    const cached = await cache.match(req.url, { ignoreVary: true });
    if (cached) return cached;
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (isAudioRequest(req, url)) {
    // Same-origin AND cross-origin audio (R2 Worker) both get cached
    // + range-sliced. If the cross-origin fetch itself fails (no CORS),
    // fall back to a plain pass-through so playback still works.
    event.respondWith(
      audioHandler(event, req, url).catch(() => fetch(req))
    );
    return;
  }
  if (isApiDataRequest(url)) {
    // cross-origin Worker API: network-first, cache fallback (offline)
    event.respondWith(apiHandler(req, url).catch(() => fetch(req)));
    return;
  }
  if (sameOrigin) event.respondWith(shellHandler(req));
});
