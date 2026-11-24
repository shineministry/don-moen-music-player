# Don Moen Music Player

A Spotify-styled web music player. Dark UI, green accent, bottom control bar, playlists,
search, queue panel — and a **Cloudflare R2** backend that stores your songs **and your queue**,
with an on-device **music cache** and a **"resume last song" prompt** when you come back later.

---

## Features

| Feature | How it works |
|---|---|
| **Spotify-style UI** | Left sidebar (Home / Search / Your Library), main content with song tables & cards, right "Now playing + queue" panel, fixed bottom player bar with seek, volume, shuffle, repeat. |
| **Queue in Cloudflare** | The queue, playback position, volume, shuffle/repeat and liked songs are saved as `state.json` **inside your R2 bucket** through the Worker API (`PUT /api/state`). It syncs on every change and mirrors to `localStorage` so it also works offline. |
| **Upload songs to the bucket** | Upload dialog (drag & drop or file picker) → `POST /api/upload` → object stored under `songs/<id>` in R2 with title/artist/duration as object metadata. |
| **Music cache** | A service worker caches every song after the first play (with proper HTTP `Range` slicing) plus the app shell. Second plays are instant and **songs keep playing offline**. |
| **Resume last song** | Playback position is saved while playing, on pause, and when you close the tab. On the next visit a **"Continue listening"** dialog shows the last song and offers **Resume** (continues at the exact second) or **Start over**. |

> Note: this is an *inspired-by* design — it intentionally does not copy Spotify's logo, name, or other brand assets.

---

## Project structure

```
├── index.html              # app markup (sidebar, player bar, modals)
├── css/styles.css          # Spotify-style theme
├── js/
│   ├── config.js           # ← set API_BASE + API_TOKEN here
│   ├── idb.js              # IndexedDB blob store (local fallback)
│   ├── store.js            # persistence: R2 via Worker + localStorage mirror
│   └── app.js              # UI, playback, queue, resume logic
├── sw.js                   # service worker: music cache + offline shell
├── worker/
│   ├── wrangler.toml       # Cloudflare config (R2 binding, CORS)
│   ├── package.json
│   └── src/index.js        # Worker API: upload / stream / queue state
└── README.md
```

`test-song.wav` is a small generated demo track for trying the player (safe to delete).

---

## 1. Run locally (no Cloudflare needed)

```bash
# any static server works — pick one:
npx serve .
# or
python -m http.server 8080
```

Open `http://localhost:8080`. The sidebar shows **"Local mode"** — songs are stored in
this browser (IndexedDB) and the queue in `localStorage`. You can already test uploading,
caching and the resume prompt.

> The service worker (music cache) requires `http://` or `https://` — not `file://`.

---

## 2. Deploy to Cloudflare (songs + queue in R2)

### Step 1 — Create the R2 bucket

1. Cloudflare dashboard → **R2 Object Storage** → enable R2 (free tier: 10 GB storage/month).
2. Create a bucket named **`don-moen-hymns`** (or change `bucket_name` in `worker/wrangler.toml`).

### Step 2 — Deploy the Worker (the API)

```bash
cd worker
npm install
npx wrangler login                       # first time only
npx wrangler r2 bucket create don-moen-hymns   # skip if you created it in the dashboard
npx wrangler deploy
```

Note the URL it prints, e.g. `https://don-moen-player-api.shinumaths989.workers.dev`.

Then protect writes with a secret (recommended):

```bash
npx wrangler secret put API_TOKEN         # type any strong password when prompted
```

> Without `API_TOKEN` the API is open (fine for a private/personal deployment).
> With it, uploads, queue-writes and deletes require the token; streaming stays public
> so the `<audio>` element can play.

### Step 3 — Deploy the frontend

From the project root (the folder containing `index.html`):

```bash
npx wrangler pages deploy . --project-name don-moen-player
```

(Or drag-and-drop the folder in Cloudflare Pages → *Direct Upload*, or use GitHub Pages /
Netlify / any static host. **HTTPS is required** for the music cache.)

### Step 4 — Connect the app to your bucket

Edit `js/config.js`:

```js
window.PLAYER_CONFIG = {
  API_BASE: "https://don-moen-player-api.shinumaths989.workers.dev",
  API_TOKEN: "",   // the value you set with `wrangler secret put API_TOKEN` ("" if you skipped it)
  MAX_UPLOAD_MB: 100
};
```

Re-deploy (`npx wrangler pages deploy .`) — or while testing, click the status pill at the
bottom-left of the sidebar and paste the URL; it is remembered in your browser.

**Optional:** set `ALLOWED_ORIGIN` in `worker/wrangler.toml` to your site's URL
(e.g. `https://don-moen-player.pages.dev`) so only your site can call the API, then
`cd worker && npx wrangler deploy`.

---

## 3. Using it

- **Upload** — green *Upload* button (or drag files anywhere onto the page). Songs go to R2
  when configured, otherwise into the browser. They are added to the library **and the queue**.
- **Add URL** — *Add URL* button for direct links to audio files.
- **Queue** — the queue icon in the player bar opens the right panel (now playing + next up).
  The queue itself lives in R2 (`state.json`) and survives new devices/browsers.
- **Resume** — pause mid-song, close the tab, come back later → the app asks to resume
  at the exact second you stopped.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` | Seek −5 s / +5 s (`Shift` = previous / next track) |
| `↑` / `↓` | Volume |
| `M` | Mute |
| `S` | Shuffle |
| `R` | Cycle repeat (off → all → one) |
| `Esc` | Close dialogs |

---

## How the resume + cache actually work

1. While playing, position is written to `localStorage` every ~3 s (and instantly on pause,
   tab close and `pagehide`). The same payload is pushed to R2 (`state.json`) so a second
   device can pick it up.
2. On load, if the saved position is ≥ 5 s in and not within the last 10 % of the track,
   the **Continue listening** dialog appears.
3. **Resume** re-queues the song if needed, seeks to the saved second and plays
   (a user gesture, so browsers allow autoplay).
4. Audio files are cached by the service worker in the Cache API. Repeat plays — and
   offline playback — are served from cache with correct `206 Partial Content` range
   responses, so seeking still works.

---

## API reference (Worker)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | – | connectivity check |
| GET | `/api/state` | – | queue + playback state |
| PUT | `/api/state` | ✔ | save queue + playback state |
| GET | `/api/library` | – | list songs in the bucket |
| POST | `/api/upload` | ✔ | upload a song (`X-Song-Title/Artist/Album/Duration`) |
| GET | `/api/songs/:id` | – | stream a song (supports `Range`) |
| DELETE | `/api/songs/:id` | ✔ | delete a song |

## Troubleshooting

- **"Cloudflare unreachable"** — check `API_BASE` has no trailing slash and the Worker is
  deployed; open `API_BASE/api/health` directly in the browser.
- **Uploads fail with 401** — `API_TOKEN` in `js/config.js` must match the Worker secret.
- **No resume prompt** — it only appears if you stopped ≥ 5 s into a track and near the end
  wasn't reached; check DevTools → Application → Local Storage.
- **Songs won't play after closing the tab** — locally stored songs live in IndexedDB;
  clearing browser data removes them. Use R2 for permanent storage.
