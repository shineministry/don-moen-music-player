/* =========================================================
   Don Moen Music Player — Cloudflare Worker (R2 backend)
   ---------------------------------------------------------
   GET    /api/health          → connectivity check
   GET    /api/state           → queue + playback state
   PUT    /api/state           → save queue + playback state   [auth]
   GET    /api/library         → list every song in the bucket
   POST   /api/upload          → upload a song file            [auth]
   GET    /api/songs/:id       → stream a song (HTTP Range)
   DELETE /api/songs/:id       → delete a song                 [auth]

   Auth = "Authorization: Bearer <API_TOKEN>" where API_TOKEN
   is a wrangler secret. Streaming stays public so <audio> can
   play without custom headers.
   ========================================================= */

const STATE_KEY = "state.json";
const SONGS_PREFIX = "songs/";

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });

function decodeHeader(value) {
  if (!value) return "";
  try { return decodeURIComponent(value); } catch (e) { return value; }
}

function sanitizeKey(value) {
  const clean = String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[_.-]+/, "")
    .slice(0, 80);
  return clean || "song";
}

function isAuthorized(request, env) {
  if (!env.API_TOKEN) return true; // no token configured → open bucket API
  const header = request.headers.get("Authorization") || "";
  return header === "Bearer " + env.API_TOKEN;
}

function requireAuth(request, env) {
  if (!isAuthorized(request, env)) {
    throw new HttpError("Unauthorized", 401);
  }
}

async function handle(request, env, url) {
  const path = url.pathname;

  if (path === "/api/health") {
    return json({ ok: true, service: "don-moen-player-api" });
  }

  /* ---------- queue / playback state ---------- */
  if (path === "/api/state" && request.method === "GET") {
    const obj = await env.BUCKET.get(STATE_KEY);
    if (!obj) return json({ updatedAt: 0 });
    try { return json(await obj.json()); }
    catch (e) { return json({ updatedAt: 0 }); }
  }

  if (path === "/api/state" && request.method === "PUT") {
    requireAuth(request, env);
    let body;
    try { body = await request.json(); }
    catch (e) { throw new HttpError("Invalid JSON body", 400); }
    body = body && typeof body === "object" ? body : {};
    body.updatedAt = Date.now();
    await env.BUCKET.put(STATE_KEY, JSON.stringify(body), {
      httpMetadata: { contentType: "application/json; charset=utf-8" }
    });
    return json({ ok: true, updatedAt: body.updatedAt });
  }

  /* ---------- library listing ---------- */
  if (path === "/api/library" && request.method === "GET") {
    const listed = await env.BUCKET.list({ prefix: SONGS_PREFIX });
    const entries = listed.objects.filter(o => !o.key.endsWith("/"));

    // list() may omit custom metadata → head() the objects that need it
    const songs = await Promise.all(entries.map(async (obj) => {
      let meta = obj.customMetadata;
      if (!meta || !meta.title) {
        try { const head = await env.BUCKET.head(obj.key); meta = (head && head.customMetadata) || {}; }
        catch (e) { meta = {}; }
      }
      const id = decodeURIComponent(obj.key.slice(SONGS_PREFIX.length));
      return {
        id,
        title: meta.title || id,
        artist: meta.artist || "",
        album: meta.album || "",
        duration: Number(meta.duration) || 0,
        addedAt: obj.uploaded ? new Date(obj.uploaded).getTime() : Date.now(),
        size: obj.size,
        source: "cloud"
      };
    }));

    songs.sort((a, b) => b.addedAt - a.addedAt);
    return json({ songs });
  }

  /* ---------- upload ---------- */
  if (path === "/api/upload" && request.method === "POST") {
    requireAuth(request, env);

    const contentType = request.headers.get("Content-Type") || "audio/mpeg";
    const duration = Number(decodeHeader(request.headers.get("X-Song-Duration"))) || 0;
    const title = decodeHeader(request.headers.get("X-Song-Title")) || url.searchParams.get("name") || "Untitled";
    const artist = decodeHeader(request.headers.get("X-Song-Artist")) || "";
    const album = decodeHeader(request.headers.get("X-Song-Album")) || "";

    const givenId = decodeHeader(request.headers.get("X-Song-Id"));
    const base = sanitizeKey((givenId || url.searchParams.get("name") || title).replace(/\.[^.]+$/, ""));
    const id = base + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const buf = await request.arrayBuffer();
    if (!buf.byteLength) throw new HttpError("Empty file", 400);
    if (buf.byteLength > 100 * 1024 * 1024) throw new HttpError("File exceeds 100 MB", 413);

    await env.BUCKET.put(SONGS_PREFIX + id, buf, {
      httpMetadata: {
        contentType: contentType.startsWith("audio/") ? contentType : "audio/mpeg",
        cacheControl: "public, max-age=31536000, immutable"
      },
      customMetadata: { title, artist, album, duration: String(Math.round(duration)) }
    });

    return json({
      id, title, artist, album, duration,
      size: buf.byteLength, source: "cloud", addedAt: Date.now()
    }, 201);
  }

  /* ---------- stream / delete a song ---------- */
  if (path.startsWith("/api/songs/")) {
    const id = decodeURIComponent(path.slice("/api/songs/".length));
    if (!id || id.includes("..")) throw new HttpError("Invalid song id", 400);
    const key = SONGS_PREFIX + id;

    if (request.method === "DELETE") {
      requireAuth(request, env);
      await env.BUCKET.delete(key);
      return json({ ok: true });
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const obj = await env.BUCKET.get(key);
      if (!obj) throw new HttpError("Song not found", 404);

      const total = obj.size;
      const type = (obj.httpMetadata && obj.httpMetadata.contentType) || "audio/mpeg";
      const baseHeaders = {
        "Content-Type": type,
        "Accept-Ranges": "bytes",
        "Content-Length": String(total),
        "Cache-Control": "public, max-age=31536000, immutable"
      };

      // HEAD → headers only (size/type), no body
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers: baseHeaders });
      }

      const rangeHeader = request.headers.get("Range");
      if (rangeHeader) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
        if (m) {
          let start, end;
          if (m[1] === "") {
            const suffix = Number(m[2]);
            start = Math.max(0, total - suffix);
            end = total - 1;
          } else {
            start = Number(m[1]);
            end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
          }
          if (!isNaN(start) && start < total && start <= end) {
            const ranged = await env.BUCKET.get(key, { range: { offset: start, length: end - start + 1 } });
            const part = await ranged.arrayBuffer();
            return new Response(part, {
              status: 206,
              headers: Object.assign({}, baseHeaders, {
                "Content-Range": "bytes " + start + "-" + end + "/" + total,
                "Content-Length": String(part.byteLength)
              })
            });
          }
          return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + total } });
        }
      }

      const full = await obj.arrayBuffer();
      return new Response(full, {
        status: 200,
        headers: baseHeaders
      });
    }
  }

  throw new HttpError("Not found", 404);
}

export default {
  async fetch(request, env, ctx) {
    const allowOrigin = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Song-Title, X-Song-Artist, X-Song-Album, X-Song-Duration, X-Song-Id",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, X-Cache",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    let res;
    try {
      res = await handle(request, env, new URL(request.url));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(err);
      res = json({ error: err.message || "Server error" }, status);
    }

    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
};
