/* =========================================================
   Don Moen Music Player — main application
   Spotify-style UI · Cloudflare R2 queue · music cache ·
   resume-where-you-left-off prompt
   ========================================================= */
(function () {
"use strict";

/* ================= helpers ================= */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
function fmt(t) {
  t = Number(t);
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ":" + String(s).padStart(2, "0");
}
function debounce(fn, ms) {
  let t;
  return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); };
}

/* ================= icons ================= */
const ICONS = {
  home: '<path d="M3.2 10.8 12 3.5l8.8 7.3"/><path d="M5.4 9.4V20a1 1 0 0 0 1 1h3.8v-5.6h3.6V21h3.8a1 1 0 0 0 1-1V9.4"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.9"/><path d="m16 16 5.2 5.2"/>',
  library: '<path d="M4 4.5v15M8.4 4.5v15"/><path d="M12.6 5.6 16.6 4.4l3.7 14.2-4 1.2z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sort: '<path d="M4 6.5h12M4 12h8M4 17.5h5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevL: '<path d="m14.5 18-6-6 6-6"/>',
  chevR: '<path d="m9.5 6 6 6-6 6"/>',
  upload: '<path d="M20.5 15.5V19a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-3.5"/><path d="m7.5 8.5 4.5-5 4.5 5"/><path d="M12 3.5V15.5"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  heartFill: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill="currentColor" stroke="none"/>',
  shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6C13.6 6.6 14.8 6 16.1 6H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  prev: '<path d="M18.5 5.8v12.4L9.5 12z" fill="currentColor" stroke="none"/><path d="M5.5 5.5h2.6v13H5.5z" fill="currentColor" stroke="none"/>',
  next: '<path d="M5.5 5.8v12.4L14.5 12z" fill="currentColor" stroke="none"/><path d="M16 5.5h2.6v13H16z" fill="currentColor" stroke="none"/>',
  play: '<path d="M8.2 5.3v13.4L19 12z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7.4 5h3.5v14H7.4zM13.1 5h3.5v14h-3.5z" fill="currentColor" stroke="none"/>',
  volume: '<path d="M11 5 6.5 9H3v6h3.5L11 19z" fill="currentColor" stroke="none"/><path d="M15.3 8.6a4.8 4.8 0 0 1 0 6.8"/><path d="M18.3 5.6a9 9 0 0 1 0 12.8"/>',
  mute: '<path d="M11 5 6.5 9H3v6h3.5L11 19z" fill="currentColor" stroke="none"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/>',
  queue: '<path d="M21 15V6"/><path d="M18.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3M16 6H3M12 18H3"/>',
  full: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 1.9"/>',
  note: '<path d="M9 17.5V6.3l9.5-2v11"/><ellipse cx="6.6" cy="17.6" rx="2.5" ry="2.2"/><ellipse cx="16.1" cy="15.4" rx="2.5" ry="2.2"/>',
  trash: '<path d="M4 7h16M9.5 7V4.6h5V7M6.6 7l.9 13.4h9L17.4 7"/>',
  music: '<circle cx="12" cy="12" r="9"/><path d="M9.5 16V8l6-1.4v7"/><circle cx="8" cy="16.4" r="1.7"/><circle cx="14.3" cy="14.8" r="1.7"/>'
};
function icon(name, size) {
  return '<svg viewBox="0 0 24 24" width="' + (size || 22) + '" height="' + (size || 22) +
    '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (ICONS[name] || "") + "</svg>";
}
function fillStaticIcons() {
  $$("[data-ico]").forEach(el => {
    el.innerHTML = icon(el.dataset.ico, Number(el.dataset.size) || 22);
  });
}
function setIco(btn, name, size) {
  const holder = btn.querySelector(".nav-ico") || btn;
  holder.innerHTML = icon(name, size || 18);
}

/* ================= state ================= */
const audio = $("#audio");
const state = {
  songs: [],
  queue: [],
  index: -1,
  position: 0,
  volume: 1,
  muted: false,
  shuffle: false,
  repeat: "off",
  liked: new Set(),
  progress: null,
  view: "home",
  search: "",
  connected: false
};
let localUpdatedAt = 0;
let pendingSeek = 0;
let seeking = false;
let switching = false;
let resumeShown = false;

const getSong = (id) => state.songs.find(s => s.id === id) || null;
const currentSong = () => (state.index >= 0 && state.index < state.queue.length ? getSong(state.queue[state.index]) : null);
const searchResults = () => {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.songs;
  return state.songs.filter(s => (s.title + " " + (s.artist || "") + " " + (s.album || "")).toLowerCase().includes(q));
};
const likedSongs = () => state.songs.filter(s => state.liked.has(s.id));

function viewList() {
  if (state.view === "queue") return state.queue.slice();
  if (state.view === "search") return searchResults().map(s => s.id);
  if (state.view === "liked") return likedSongs().map(s => s.id);
  return state.songs.map(s => s.id);
}

/* ================= covers ================= */
function coverStyle(id) {
  let h = 7;
  id = String(id || "?");
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return "background:linear-gradient(135deg,hsl(" + hue + " 55% 45%),hsl(" + ((hue + 50) % 360) + " 60% 20%))";
}
function coverHTML(song, size) {
  if (!song) return icon("note", size || 20);
  return '<div class="cover" style="' + coverStyle(song.id) + '">' + icon("note", Math.round((size || 40) * 0.5)) + "</div>";
}

/* ================= persistence ================= */
function persist(sync) {
  Store.saveLocal(state);
  if (sync !== false) scheduleSync();
}
const scheduleSync = debounce(function () {
  if (!Store.config.api || !state.connected) return;
  Store.pushState(cloudPayload()).catch(() => { /* offline — local mirror still saved */ });
}, 1500);

function cloudPayload() {
  const durations = {};
  state.songs.forEach(s => {
    if (s.source === "cloud" && s.duration > 0) durations[s.id] = Math.round(s.duration);
  });
  return {
    version: 1,
    queue: state.queue.slice(),
    index: state.index,
    position: state.position || 0,
    volume: state.volume,
    muted: state.muted,
    shuffle: state.shuffle,
    repeat: state.repeat,
    liked: Array.from(state.liked),
    durations: durations,
    progress: state.progress,
    updatedAt: Date.now()
  };
}

/* ================= toasts ================= */
function toast(msg, type) {
  const host = $("#toastHost");
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 320);
  }, 3400);
}

/* ================= sync status ================= */
function setSync(mode) {
  const dot = $("#syncDot"), label = $("#syncLabel");
  dot.className = "sync-dot";
  if (mode === "on") { dot.classList.add("on"); label.textContent = "Cloudflare R2 connected"; state.connected = true; }
  else if (mode === "local") { dot.classList.add("local"); label.textContent = "Local mode — click to connect"; state.connected = false; }
  else if (mode === "connecting") { label.textContent = "Connecting to Cloudflare…"; state.connected = false; }
  else { label.textContent = "Cloudflare offline — click to retry"; state.connected = false; }
  $("#syncStatus").title = mode === "off" && lastConnectError
    ? "Last error: " + lastConnectError + " — click to retry (auto-retries in the background)"
    : label.textContent;
}

/* ================= playback ================= */
async function resolveUrl(song) {
  if (song.source === "url") return song.url;
  if (song.source === "cloud") return Store.config.api + "/api/songs/" + encodeURIComponent(song.id);
  if (song.source === "local") {
    if (!song._url) {
      const blob = await Store.getLocalSongBlob(song.id);
      if (!blob) throw new Error("file is missing from this browser");
      song._url = URL.createObjectURL(blob);
    }
    return song._url;
  }
  throw new Error("unknown song source");
}

async function playAt(i, startAt) {
  if (i < 0 || i >= state.queue.length) return;
  const song = getSong(state.queue[i]);
  if (!song) {
    state.queue.splice(i, 1);
    if (state.index >= state.queue.length) state.index = state.queue.length - 1;
    persist();
    render();
    return;
  }
  state.index = i;
  state.position = 0;
  state.progress = null;
  switching = true; // don't let the old track's pause event save bogus progress
  pendingSeek = startAt || 0;
  renderPlayer();
  renderContent();
  renderRight();
  try {
    const url = await resolveUrl(song);
    audio.src = url;
    audio.load();
    await audio.play();
  } catch (err) {
    console.error(err);
    toast('Could not play "' + song.title + '" — ' + (err.message || "error"), "error");
  }
}

function playFromContext(list, id) {
  if (!list.length) return;
  let idx = state.queue.indexOf(id);
  if (idx < 0) {
    state.queue = list.slice();
    idx = state.queue.indexOf(id);
    if (idx < 0) { state.queue = [id]; idx = 0; }
    persist();
  }
  playAt(idx, 0);
}

function togglePlay() {
  if (state.index < 0) {
    if (state.queue.length) playAt(0, 0);
    else if (state.songs.length) { state.queue = state.songs.map(s => s.id); playAt(0, 0); }
    else toast("Your library is empty — upload a song first");
    return;
  }
  if (audio.paused) {
    audio.play().catch(e => toast("Playback blocked: " + e.message, "error"));
  } else {
    audio.pause();
  }
}

function nextTrack(auto) {
  if (!state.queue.length) return;
  // natural end while "Repeat one" → replay the same track
  if (auto && state.repeat === "one") {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  if (state.shuffle && state.queue.length > 1) {
    let n;
    do { n = Math.floor(Math.random() * state.queue.length); } while (n === state.index);
    return playAt(n, 0);
  }
  if (state.index < state.queue.length - 1) return playAt(state.index + 1, 0);
  if (state.repeat === "all") return playAt(0, 0);
  if (auto) {
    // finished the whole queue naturally — clear the resume point
    audio.pause();
    state.progress = null;
    state.position = 0;
    persist();
    renderPlayer();
  }
}

function prevTrack() {
  if (!state.queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (state.index > 0) playAt(state.index - 1, 0);
  else if (state.repeat === "all") playAt(state.queue.length - 1, 0);
  else audio.currentTime = 0;
}

/* ================= progress / resume ================= */
let lastProgressSave = 0;
function saveProgress(force) {
  const song = currentSong();
  if (!song || !audio.src) return;
  const now = Date.now();
  if (!force && now - lastProgressSave < 3000) return;
  lastProgressSave = now;
  const pos = audio.currentTime || 0;
  state.position = pos;
  state.progress = {
    songId: song.id,
    position: pos,
    duration: (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (song.duration || 0)),
    updatedAt: now
  };
  Store.saveLocal(state); // fast local write — no network on every tick
}

function maybeResume() {
  if (resumeShown) return;
  const p = state.progress;
  if (!p || !p.songId || p.dismissed) return;
  const song = getSong(p.songId);
  if (!song) return;
  if (!p.position || p.position < 5) return;
  // don't nag if the song was essentially finished (last 10s, or last 20% for short clips)
  if (p.duration > 0 && p.position > p.duration - Math.min(10, p.duration * 0.2)) return;
  resumeShown = true;
  $("#resumeCover").innerHTML = coverHTML(song, 132);
  $("#resumeTitle").textContent = song.title;
  $("#resumeSub").textContent = [song.artist, song.album].filter(Boolean).join(" • ") || "Unknown artist";
  $("#resumeTime").textContent = "Stopped at " + fmt(p.position) + " of " + fmt(p.duration || song.duration || 0);
  $("#resumeOverlay").hidden = false;
}
function closeResume(clear) {
  $("#resumeOverlay").hidden = true;
  if (clear) {
    state.progress = null;
    persist();
  }
}
function resumePlay(fromStart) {
  const p = state.progress;
  $("#resumeOverlay").hidden = true;
  if (!p) return;
  let idx = state.queue.indexOf(p.songId);
  if (idx < 0) {
    state.queue.unshift(p.songId);
    idx = 0;
    persist();
  }
  playAt(idx, fromStart ? 0 : p.position);
}

/* ================= audio events ================= */
audio.volume = state.volume;
audio.addEventListener("loadedmetadata", () => {
  if (pendingSeek > 0 && isFinite(audio.duration)) {
    audio.currentTime = Math.min(pendingSeek, Math.max(0, audio.duration - 0.35));
    pendingSeek = 0;
  }
  const song = currentSong();
  if (song && isFinite(audio.duration) && audio.duration > 0 && Math.abs((song.duration || 0) - audio.duration) > 1) {
    song.duration = audio.duration;
    persist(false);
    renderContent();
  }
  updateProgressUI();
});
audio.addEventListener("timeupdate", () => {
  if (!seeking) updateProgressUI();
  saveProgress(false);
});
audio.addEventListener("play", () => {
  renderPlayer();
  renderContent();
  updateMediaSession();
  document.title = (currentSong() ? currentSong().title + " • " : "") + "Don Moen Music Player";
});
audio.addEventListener("playing", () => { switching = false; });
audio.addEventListener("pause", () => {
  renderPlayer();
  renderContent();
  if (!audio.ended && !switching) saveProgress(true);
  scheduleSync();
  document.title = "Don Moen Music Player";
});
audio.addEventListener("ended", () => nextTrack(true));
audio.addEventListener("error", () => {
  if (!audio.src) return;
  const song = currentSong();
  toast('Playback failed for "' + (song ? song.title : "song") + '"', "error");
});

function updateProgressUI() {
  const dur = isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : (currentSong() && currentSong().duration) || 0;
  const cur = audio.currentTime || 0;
  const pct = dur > 0 ? clamp(cur / dur, 0, 1) * 100 : 0;
  const seek = $("#seekBar");
  if (!seeking) seek.value = String(Math.round(pct * 10));
  seek.style.setProperty("--pct", pct.toFixed(2) + "%");
  $("#curTime").textContent = fmt(cur);
  $("#durTime").textContent = dur > 0 ? fmt(dur) : "0:00";
}

function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const song = currentSong();
  if (!song) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist || "Unknown artist",
      album: song.album || "Don Moen Music Player"
    });
    navigator.mediaSession.setActionHandler("play", () => audio.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("previoustrack", prevTrack);
    navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack(false));
  } catch (e) { /* unsupported */ }
}

/* ================= rendering ================= */
function render() {
  renderNav();
  renderContent();
  renderPlayer();
  renderRight();
  renderCounts();
}

function renderNav() {
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === state.view ||
    (b.dataset.view === "all" && state.view === "liked")));
  $$(".lib-item").forEach(b => b.classList.toggle("active", b.dataset.view === state.view));
}

function renderCounts() {
  $("#countAll").textContent = state.songs.length + (state.songs.length === 1 ? " song" : " songs");
  $("#countLiked").textContent = state.liked.size + (state.liked.size === 1 ? " song" : " songs");
  $("#countQueue").textContent = state.queue.length + " in queue";
}

function tableHTML(list, opts) {
  opts = opts || {};
  if (!list.length) return "";
  const curId = currentSong() ? currentSong().id : null;
  const rows = list.map((s, i) => {
    const playing = s.id === curId;
    const liked = state.liked.has(s.id);
    return (
      '<div class="trow' + (playing ? " is-playing" : "") + '" data-play-id="' + esc(s.id) + '">' +
        '<div class="trow-idx">' +
          '<span class="trow-num">' + (i + 1) + "</span>" +
          '<span class="row-play">' + icon("play", 14) + "</span>" +
          '<span class="eq' + (audio.paused ? " paused" : "") + '"><i></i><i></i><i></i></span>' +
        "</div>" +
        '<div class="trow-main">' + coverHTML(s, 40) +
          '<div class="trow-meta">' +
            '<div class="trow-title">' + esc(s.title) + "</div>" +
            '<div class="trow-sub">' + esc(s.artist || "Unknown artist") + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="trow-album">' + esc(s.album || "—") + "</div>" +
        '<div class="trow-date">' + (s.addedAt ? new Date(s.addedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—") + "</div>" +
        '<div class="trow-dur">' +
          '<button class="icon-btn trow-like' + (liked ? " on" : "") + '" data-like-id="' + esc(s.id) + '" title="Save to Liked Songs">' +
            icon(liked ? "heartFill" : "heart", 16) + "</button>" +
          '<span>' + (s.duration ? fmt(s.duration) : "—") + "</span>" +
          '<button class="icon-btn trow-like" data-del-id="' + esc(s.id) + '" title="Remove from library">' + icon("trash", 16) + "</button>" +
        "</div>" +
      "</div>"
    );
  }).join("");

  return (
    '<div class="table">' +
      '<div class="thead">' +
        "<div>#</div><div>Title</div><div class=\"cell-album\">Album</div><div class=\"cell-date\">Date added</div><div class=\"cell-dur\">" + icon("clock", 14) + "</div>" +
      "</div>" + rows +
    "</div>"
  );
}

function cardHTML(s) {
  return (
    '<div class="card" data-play-id="' + esc(s.id) + '">' +
      '<div class="card-cover">' + coverHTML(s) +
        '<button class="fab" title="Play">' + icon("play", 22) + "</button>" +
      "</div>" +
      '<div class="card-title">' + esc(s.title) + "</div>" +
      '<div class="card-sub">' + esc(s.artist || "Unknown artist") + "</div>" +
    "</div>"
  );
}

function emptyHTML() {
  return (
    '<div class="empty">' +
      '<div class="empty-ico">' + icon("music", 34) + "</div>" +
      "<h3>Your library is empty</h3>" +
      "<p>Upload audio files to your Cloudflare R2 bucket (or this browser) and they will show up here — with the queue, cache and resume prompt included.</p>" +
      '<button class="btn-green big upload-cta" data-action="upload">' + icon("upload", 18) + " Upload songs</button>" +
    "</div>"
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function homeHTML() {
  if (!state.songs.length) return emptyHTML();
  const songs = state.songs.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const shortcuts = songs.slice(0, 8).map(s =>
    '<button class="shortcut" data-play-id="' + esc(s.id) + '">' +
      coverHTML(s, 56) +
      '<span class="shortcut-title">' + esc(s.title) + "</span>" +
      '<span class="fab">' + icon("play", 20) + "</span>" +
    "</button>"
  ).join("");
  return (
    '<section class="hero"><h1>' + greeting() + "</h1>" +
      '<div class="shortcuts">' + shortcuts + "</div></section>" +
    '<section class="section"><div class="section-head"><h2>Recently added</h2>' +
      '<button class="link-btn" data-view="all">Show all</button></div>' +
      tableHTML(songs.slice(0, 10)) + "</section>" +
    '<section class="section"><div class="section-head"><h2>Made for you</h2></div>' +
      '<div class="cards">' + songs.slice(0, 6).map(cardHTML).join("") + "</div></section>"
  );
}

function searchHTML() {
  const res = searchResults();
  if (!state.search.trim()) {
    return (
      '<section class="section"><div class="section-head"><h2>Browse your library</h2></div>' +
      '<p style="color:var(--sub);margin:0 0 16px">Start typing to search songs, artists and albums — or explore everything below.</p>' +
      tableHTML(state.songs) + "</section>"
    );
  }
  if (!res.length) {
    return '<div class="empty"><div class="empty-ico">' + icon("search", 30) + "</div>" +
      "<h3>No results for “" + esc(state.search) + "”</h3><p>Try a different song, artist or album name.</p></div>";
  }
  return '<section class="section"><div class="section-head"><h2>Results for “' + esc(state.search) + "”</h2></div>" +
    tableHTML(res) + "</section>";
}

function playlistHero(title, sub, grad) {
  return (
    '<section class="playlist-hero" style="background:' + grad + '">' +
      '<div class="pl-cover">' + icon2("note", 64) + "</div>" +
      '<div class="pl-meta"><div class="pl-eyebrow">Playlist</div><h1>' + esc(title) + "</h1>" +
      '<div class="pl-sub">' + esc(sub) + "</div></div>" +
      '<div class="pl-actions">' +
        '<button class="pl-play" data-action="play-all" title="Play">' + icon2("play", 26) + "</button>" +
        '<button class="icon-btn lg" data-action="shuffle-all" title="Shuffle">' + icon2("shuffle", 24) + "</button>" +
      "</div>" +
    "</section>"
  );
}
const icon2 = icon; // alias (avoid shadowing in playlistHero params)

function libraryHTML() {
  const songs = state.songs.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  if (!songs.length) return emptyHTML();
  return playlistHero("All Songs", songs.length + " songs • stored in your library", "linear-gradient(135deg,#1db954 0%,#0b5c2c 55%,#121212 100%)") +
    '<section class="section">' + tableHTML(songs) + "</section>";
}

function likedHTML() {
  const songs = likedSongs();
  if (!songs.length) {
    return playlistHero("Liked Songs", "Songs you save with the heart button", "linear-gradient(135deg,#450af5 0%,#8e8ee5 60%,#121212 100%)") +
      '<div class="empty"><div class="empty-ico">' + icon("heart", 30) + "</div>" +
      "<h3>No liked songs yet</h3><p>Tap the heart on any track to save it here.</p></div>";
  }
  return playlistHero("Liked Songs", songs.length + " liked " + (songs.length === 1 ? "song" : "songs"), "linear-gradient(135deg,#450af5 0%,#8e8ee5 60%,#121212 100%)") +
    '<section class="section">' + tableHTML(songs) + "</section>";
}

function queueHTML() {
  const ids = state.queue;
  const cur = currentSong();
  if (!ids.length) {
    return playlistHero("Up Next", "Your queue, synced to Cloudflare", "linear-gradient(135deg,#535353 0%,#2a2a2a 60%,#121212 100%)") +
      '<div class="empty"><div class="empty-ico">' + icon("queue", 30) + "</div>" +
      "<h3>The queue is empty</h3><p>Play a song from your library to build a queue — it is saved to your Cloudflare bucket.</p>" +
      '<button class="btn-green big" data-view="all">Open library</button></div>';
  }
  const list = ids.map(getSong).filter(Boolean);
  const upcoming = ids.slice(state.index + 1).map(getSong).filter(Boolean);
  return (
    playlistHero("Up Next", list.length + " in queue • " + (cur ? "now playing " + cur.title : "nothing playing"),
      "linear-gradient(135deg,#535353 0%,#2a2a2a 60%,#121212 100%)") +
    '<section class="section"><div class="section-head"><h2>Queue</h2>' +
      '<button class="link-btn" data-action="clear-queue">Clear queue</button></div>' +
      tableHTML(list) + "</section>" +
    (upcoming.length
      ? '<section class="section"><div class="section-head"><h2>Next up</h2></div>' +
        upcoming.map(s => '<div class="qrow" data-play-id="' + esc(s.id) + '">' + coverHTML(s, 40) +
          '<div class="qrow-meta"><div class="qrow-title">' + esc(s.title) + '</div><div class="qrow-sub">' + esc(s.artist || "Unknown artist") + "</div></div>" +
          '</div>').join("") + "</section>"
      : "")
  );
}

function renderContent() {
  const c = $("#content");
  const scroll = c.scrollTop;
  let html;
  if (state.view === "home") html = homeHTML();
  else if (state.view === "search") html = searchHTML();
  else if (state.view === "all") html = libraryHTML();
  else if (state.view === "liked") html = likedHTML();
  else if (state.view === "queue") html = queueHTML();
  else html = homeHTML();
  c.innerHTML = html;
  c.scrollTop = scroll;
}

function renderPlayer() {
  const s = currentSong();
  $("#npCover").innerHTML = s ? coverHTML(s, 56) : icon("note", 22);
  $("#npTitle").textContent = s ? s.title : "Nothing playing";
  $("#npArtist").textContent = s ? (s.artist || "Unknown artist") : "—";
  setIco($("#btnPlay"), audio.paused ? "play" : "pause", 18);
  const liked = !!(s && state.liked.has(s.id));
  setIco($("#btnLike"), liked ? "heartFill" : "heart", 18);
  $("#btnLike").classList.toggle("on", liked);
  $("#btnShuffle").classList.toggle("on", state.shuffle);
  $("#btnRepeat").classList.toggle("on", state.repeat !== "off");
  $("#btnRepeat").title = state.repeat === "off" ? "Repeat off" : state.repeat === "all" ? "Repeat all" : "Repeat one";
  setIco($("#btnMute"), state.muted || state.volume === 0 ? "mute" : "volume", 18);
  const vb = $("#volBar");
  vb.value = String(Math.round((state.muted ? 0 : state.volume) * 100));
  vb.style.setProperty("--pct", (state.muted ? 0 : state.volume * 100).toFixed(1) + "%");
  updateProgressUI();
}

function renderRight() {
  const body = $("#rightBody");
  const s = currentSong();
  if (!s) {
    body.innerHTML = '<div class="qrow-empty" style="padding-top:20px">Nothing is playing yet. Pick a song from your library.</div>';
    return;
  }
  const upcoming = state.queue.slice(state.index + 1).map(getSong).filter(Boolean);
  body.innerHTML =
    '<div class="np-card">' + coverHTML(s, 300) +
      "<h2>" + esc(s.title) + "</h2>" +
      '<p class="np-card-sub">' + esc(s.artist || "Unknown artist") + (s.album ? " • " + esc(s.album) : "") + "</p>" +
    "</div>" +
    '<div class="rp-section-title">Next in queue' +
      (state.queue.length > 1 ? '<button class="link-btn" data-action="clear-queue">Clear</button>' : "") + "</div>" +
    (upcoming.length
      ? upcoming.map((q, i) =>
          '<div class="qrow" data-qindex="' + (state.index + 1 + i) + '">' + coverHTML(q, 40) +
            '<div class="qrow-meta"><div class="qrow-title">' + esc(q.title) + "</div>" +
            '<div class="qrow-sub">' + esc(q.artist || "Unknown artist") + "</div></div>" +
            '<button class="icon-btn qrow-x" data-qremove="' + (state.index + 1 + i) + '" title="Remove">' + icon("close", 16) + "</button>" +
          "</div>").join("")
      : '<div class="qrow-empty">End of the queue.</div>');
}

/* ================= views ================= */
const histStack = ["home"];
let histPos = 0;

function setView(view, push) {
  if (view === "search") {
    setTimeout(() => $("#searchInput").focus(), 60);
  }
  if (push !== false && view !== state.view) {
    histStack.length = histPos + 1;
    histStack.push(view);
    histPos = histStack.length - 1;
  }
  state.view = view;
  render();
  updateHistoryButtons();
  $("#content").scrollTop = 0;
}
function updateHistoryButtons() {
  $("#btnBack").disabled = histPos <= 0;
  $("#btnFwd").disabled = histPos >= histStack.length - 1;
}

/* ================= upload ================= */
function probeDuration(file) {
  return new Promise(resolve => {
    let done = false;
    const finish = (d) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(d); };
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => finish(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => finish(0);
    setTimeout(() => finish(0), 10000);
    a.src = url;
  });
}

function openUpload(tab) {
  $("#uploadOverlay").hidden = false;
  switchTab(tab || "files");
  $("#uploadTarget").textContent = Store.config.api
    ? "Files are uploaded straight to your Cloudflare R2 bucket."
    : "Cloudflare is not configured — songs are saved in this browser only. Click the status at the bottom-left to connect R2.";
}
function closeUpload() { $("#uploadOverlay").hidden = true; }
function switchTab(tab) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  $("#paneFiles").hidden = tab !== "files";
  $("#paneUrl").hidden = tab !== "url";
}

function addUploadRow(name) {
  const row = document.createElement("div");
  row.className = "up-row";
  row.innerHTML = '<span class="up-name">' + esc(name) + '</span><span class="up-status">0%</span><span class="up-bar" style="width:0%"></span>';
  $("#uploadList").appendChild(row);
  return row;
}
function updateUploadRow(row, frac, label, cls) {
  row.querySelector(".up-bar").style.width = Math.round(clamp(frac, 0, 1) * 100) + "%";
  const st = row.querySelector(".up-status");
  st.textContent = label || Math.round(frac * 100) + "%";
  st.className = "up-status" + (cls ? " " + cls : "");
}

async function uploadFiles(files) {
  files = Array.from(files || []);
  if (!files.length) return;
  openUpload("files");
  let added = 0;
  for (const file of files) {
    const row = addUploadRow(file.name);
    try {
      const duration = await probeDuration(file);
      const baseTitle = file.name.replace(/\.[^.]+$/, "");
      let song;
      if (Store.config.api) {
        updateUploadRow(row, 0.05, "Uploading…");
        song = await Store.uploadSong(file, { title: baseTitle, duration },
          frac => updateUploadRow(row, frac * 0.95));
      } else {
        updateUploadRow(row, 0.4, "Saving…");
        song = await Store.addLocalSong(file, { title: baseTitle, duration });
      }
      song.source = Store.config.api ? "cloud" : song.source;
      state.songs.unshift(song);
      state.queue.push(song.id);
      added++;
      updateUploadRow(row, 1, "Done ✓", "done");
    } catch (err) {
      console.error(err);
      updateUploadRow(row, 1, "Failed — " + err.message, "err");
      toast("Upload failed: " + err.message, "error");
    }
  }
  persist();
  render();
  if (added) {
    toast(added + (added === 1 ? " song added" : " songs added") + " to your library and queue", "ok");
    if (state.index < 0 && state.queue.length === added) playAt(0, 0);
  }
}

function addUrlSong() {
  const url = $("#urlInput").value.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return toast("Enter a valid http(s) audio URL", "error");
  const fallback = decodeURIComponent((url.split("?")[0].split("#")[0].split("/").pop() || "Unknown")).replace(/\.[^.]+$/, "");
  const song = {
    id: "url-" + uid(),
    source: "url",
    url: url,
    title: $("#urlTitle").value.trim() || fallback || "Unknown title",
    artist: $("#urlTitle").value.trim() ? $("#urlArtist").value.trim() : "",
    album: "",
    duration: 0,
    addedAt: Date.now()
  };
  state.songs.unshift(song);
  state.queue.push(song.id);
  persist();
  render();
  $("#urlInput").value = ""; $("#urlTitle").value = ""; $("#urlArtist").value = "";
  closeUpload();
  toast("Added to library and queue", "ok");
  // learn duration quietly
  const probe = new Audio();
  probe.preload = "metadata";
  probe.onloadedmetadata = () => {
    if (isFinite(probe.duration) && probe.duration > 0) {
      song.duration = probe.duration;
      persist(false);
      renderContent();
    }
  };
  probe.src = url;
}

async function deleteSong(id) {
  const song = getSong(id);
  if (!song) return;
  if (!confirm('Remove "' + song.title + '" from your library?')) return;
  try {
    if (song.source === "cloud") await Store.deleteSong(id);
    if (song.source === "local") await Store.removeLocalSong(id);
  } catch (e) { toast("Server delete failed: " + e.message, "error"); }
  const qi = state.queue.indexOf(id);
  if (qi >= 0) {
    state.queue.splice(qi, 1);
    if (qi < state.index) state.index--;
    else if (qi === state.index) {
      audio.pause();
      audio.removeAttribute("src");
      state.index = Math.min(state.index, state.queue.length - 1);
      if (state.index < 0) { state.index = -1; state.progress = null; }
    }
  }
  state.liked.delete(id);
  state.songs = state.songs.filter(s => s.id !== id);
  persist();
  render();
  toast("Removed from library");
}

function toggleLike(id) {
  if (state.liked.has(id)) state.liked.delete(id);
  else state.liked.add(id);
  persist();
  render();
}

/* ================= cloud connection ================= */
const RETRY_DELAYS = [3000, 8000, 15000, 30000, 60000]; // backoff schedule
let retryDelayIdx = 0;
let retryTimer = null;
let connectingNow = false;
let lastConnectError = "";

function stopRetrying() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelayIdx = 0;
}

function scheduleRetry() {
  if (retryTimer || connectingNow) return;
  const delay = RETRY_DELAYS[Math.min(retryDelayIdx, RETRY_DELAYS.length - 1)];
  retryDelayIdx++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connectCloud({ quiet: true });
  }, delay);
}

async function connectCloud(opts) {
  opts = opts || {};
  if (!Store.config.api) {
    setSync("local");
    return;
  }
  if (connectingNow) return;
  connectingNow = true;
  const wasOff = !state.connected;
  if (!opts.quiet) setSync("connecting");

  const timeout = (p, ms) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timed out after " + Math.round(ms / 1000) + "s")), ms))
  ]);

  try {
    await timeout(Store.health(), 12000);
    const results = await Promise.all([
      timeout(Store.pullLibrary(), 12000),
      timeout(Store.pullState(), 12000).catch(() => null)
    ]);
    mergeCloud(results[0], results[1]);
    lastConnectError = "";
    setSync("on");
    stopRetrying();
    if (!opts.quiet || wasOff) toast(wasOff && opts.quiet ? "Reconnected to Cloudflare R2" : "Connected to Cloudflare R2", "ok");
    render();
    learnCloudDurations();
  } catch (err) {
    console.warn("Cloudflare connection failed:", err);
    lastConnectError = (err && err.message) || "network error";
    setSync("off");
    if (opts.manual) toast("Connection failed: " + lastConnectError + " — retrying automatically", "error");
    else if (!opts.quiet) toast("Cloudflare unreachable — will keep retrying automatically", "error");
    scheduleRetry();
  } finally {
    connectingNow = false;
  }
}

function mergeCloud(lib, st) {
  // durations we already learned locally (cloud library has none for
  // bucket-root files until they've been probed/pushed to state.json)
  const knownDur = {};
  state.songs.forEach(s => { if (s.duration > 0) knownDur[s.id] = s.duration; });
  const savedDur = (st && st.durations && typeof st.durations === "object") ? st.durations : {};

  const cloudSongs = (lib && lib.songs ? lib.songs : []).map(s => ({
    id: s.id, source: "cloud",
    title: s.title || s.id, artist: s.artist || "", album: s.album || "",
    duration: Number(s.duration) || Number(savedDur[s.id]) || knownDur[s.id] || 0,
    addedAt: Number(s.addedAt) || Date.now(),
    size: s.size
  }));
  const others = state.songs.filter(s => s.source !== "cloud");
  state.songs = cloudSongs.concat(others);

  if (st && st.updatedAt && st.updatedAt >= localUpdatedAt) {
    if (Array.isArray(st.queue)) state.queue = st.queue.filter(id => getSong(id));
    if (typeof st.index === "number") state.index = clamp(st.index, -1, state.queue.length - 1);
    if (typeof st.volume === "number") state.volume = clamp(st.volume, 0, 1);
    state.muted = !!st.muted;
    state.shuffle = !!st.shuffle;
    state.repeat = st.repeat === "all" || st.repeat === "one" ? st.repeat : "off";
    state.liked = new Set(Array.isArray(st.liked) ? st.liked : []);
  }
  if (st && st.progress && (!state.progress || (st.progress.updatedAt || 0) >= (state.progress.updatedAt || 0))) {
    state.progress = st.progress;
  }
  // queue entries whose songs vanished are dropped above; make index sane
  if (state.index >= state.queue.length) state.index = state.queue.length - 1;
}

/* Files uploaded straight to the bucket carry no duration metadata.
   Probe them one at a time in the background (metadata-only request,
   not a full download) so the library shows real times. */
let durProbeStarted = false;
const durProbed = new Set();       // ids attempted in the current pass
const durAttempts = new Map();     // id → tries this session (cap: no endless retry)
function learnCloudDurations() {
  if (durProbeStarted) return;
  const pending = state.songs.filter(s =>
    s.source === "cloud" && !(s.duration > 0) && (durAttempts.get(s.id) || 0) < 2);
  if (!pending.length) return;
  durProbeStarted = true;

  const probeNext = () => {
    const song = pending.shift();
    if (!song) {
      durProbeStarted = false;
      durProbed.clear();
      return;
    }
    durProbed.add(song.id);
    durAttempts.set(song.id, (durAttempts.get(song.id) || 0) + 1);
    const a = new Audio();
    let settled = false;
    const finish = (d) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      a.onloadedmetadata = a.onerror = null;
      a.removeAttribute("src");
      if (d > 0 && (song.duration || 0) <= 0) {
        song.duration = d;
        durAttempts.delete(song.id);
        persist(); // sync → learned durations land in state.json for all devices
        renderContent();
      }
      setTimeout(probeNext, 600);
    };
    const timer = setTimeout(() => finish(0), 12000);
    a.preload = "metadata";
    a.onloadedmetadata = () => finish(isFinite(a.duration) && a.duration > 0 ? a.duration : 0);
    a.onerror = () => finish(0);
    resolveUrl(song).then(url => { a.src = url; }).catch(() => finish(0));
  };
  probeNext();
}

/* ================= boot ================= */
async function loadLocalState() {
  const saved = Store.loadLocal();
  if (saved) {
    localUpdatedAt = saved.updatedAt || 0;
    state.queue = Array.isArray(saved.queue) ? saved.queue : [];
    state.index = typeof saved.index === "number" ? saved.index : -1;
    state.position = saved.position || 0;
    state.volume = typeof saved.volume === "number" ? saved.volume : 1;
    state.muted = !!saved.muted;
    state.shuffle = !!saved.shuffle;
    state.repeat = saved.repeat || "off";
    state.liked = new Set(Array.isArray(saved.liked) ? saved.liked : []);
    state.progress = saved.progress || null;

    const meta = Array.isArray(saved.songs) ? saved.songs : [];
    const localMetas = meta.filter(s => s.source === "local");
    const verified = [];
    for (const m of localMetas) {
      try {
        const blob = await Store.getLocalSongBlob(m.id);
        if (blob) verified.push(m);
      } catch (e) { /* skip broken */ }
    }
    state.songs = meta.filter(s => s.source === "url").concat(verified)
      .concat(Store.config.api ? meta.filter(s => s.source === "cloud") : []); // cloud songs only when R2 is reachable
  }
  audio.volume = state.volume;
  audio.muted = state.muted;
  render();
}

function wireEvents() {
  /* --- navigation --- */
  document.addEventListener("click", (e) => {
    const viewBtn = e.target.closest("[data-view]");
    if (viewBtn) { setView(viewBtn.dataset.view); return; }

    const action = e.target.closest("[data-action]");
    if (action) {
      const a = action.dataset.action;
      if (a === "upload") openUpload("files");
      else if (a === "play-all") { const l = viewList(); if (l.length) { state.queue = l.slice(); persist(); playAt(0, 0); } }
      else if (a === "shuffle-all") {
        const l = viewList();
        if (l.length) {
          state.queue = l.slice();
          state.shuffle = true;
          persist();
          playAt(Math.floor(Math.random() * l.length), 0);
        }
      } else if (a === "clear-queue") {
        if (state.queue.length) {
          const cur = state.queue[state.index];
          state.queue = cur ? [cur] : [];
          state.index = cur ? 0 : -1;
          persist();
          render();
        }
      }
      return;
    }

    const likeBtn = e.target.closest("[data-like-id]");
    if (likeBtn) { e.stopPropagation(); toggleLike(likeBtn.dataset.likeId); return; }

    const delBtn = e.target.closest("[data-del-id]");
    if (delBtn) { e.stopPropagation(); deleteSong(delBtn.dataset.delId); return; }

    const qremove = e.target.closest("[data-qremove]");
    if (qremove) {
      e.stopPropagation();
      const i = Number(qremove.dataset.qremove);
      state.queue.splice(i, 1);
      if (i < state.index) state.index--;
      persist();
      render();
      return;
    }

    const qrow = e.target.closest("[data-qindex]");
    if (qrow) { playAt(Number(qrow.dataset.qindex), 0); return; }

    const row = e.target.closest("[data-play-id]");
    if (row) { playFromContext(viewList(), row.dataset.playId); return; }
  });

  /* --- sidebar / topbar --- */
  $("#btnUpload").addEventListener("click", () => openUpload("files"));
  $("#btnUploadLib").addEventListener("click", () => openUpload("files"));
  $("#btnAddUrl").addEventListener("click", () => openUpload("url"));
  $("#btnCreateList").addEventListener("click", () => toast("Playlists are coming soon — use Up Next for now"));
  $("#btnAvatar").addEventListener("click", () => toast("Signed in as Guest — your data stays in your Cloudflare bucket"));
  $("#btnBack").addEventListener("click", () => { if (histPos > 0) { histPos--; state.view = histStack[histPos]; render(); updateHistoryButtons(); } });
  $("#btnFwd").addEventListener("click", () => { if (histPos < histStack.length - 1) { histPos++; state.view = histStack[histPos]; render(); updateHistoryButtons(); } });

  const searchInput = $("#searchInput");
  searchInput.addEventListener("input", () => {
    state.search = searchInput.value;
    $("#searchClear").classList.toggle("visible", !!state.search);
    if (state.view !== "search") setView("search");
    else renderContent();
  });
  $("#searchClear").addEventListener("click", () => {
    searchInput.value = ""; state.search = "";
    $("#searchClear").classList.remove("visible");
    renderContent();
    searchInput.focus();
  });

  /* --- sync status / settings --- */
  $("#syncStatus").addEventListener("click", () => {
    const cur = Store.config.api || "";
    const next = window.prompt(
      "Cloudflare Worker API base URL.\n\nLeave empty to run in local-only mode (songs stored in this browser).\nExample: https://don-moen-player-api.example.workers.dev",
      cur
    );
    if (next === null) return;
    Store.setApiOverride(next.trim());
    state.songs = state.songs.filter(s => s.source !== "cloud");
    state.queue = state.queue.filter(id => !!getSong(id));
    if (state.index >= state.queue.length) state.index = state.queue.length - 1;
    render();
    connectCloud().then(() => render());
  });

  /* --- player controls --- */
  $("#btnPlay").addEventListener("click", togglePlay);
  $("#btnNext").addEventListener("click", () => nextTrack(false));
  $("#btnPrev").addEventListener("click", prevTrack);
  $("#btnShuffle").addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    persist();
    renderPlayer();
    toast(state.shuffle ? "Shuffle on" : "Shuffle off");
  });
  $("#btnRepeat").addEventListener("click", () => {
    state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
    persist();
    renderPlayer();
    toast(state.repeat === "off" ? "Repeat off" : state.repeat === "all" ? "Repeat all" : "Repeat one");
  });
  $("#btnLike").addEventListener("click", () => {
    const s = currentSong();
    if (s) toggleLike(s.id);
    else toast("Nothing is playing");
  });
  $("#btnQueue").addEventListener("click", () => {
    const app = $("#app"), bar = $("#rightbar");
    const open = bar.hidden;
    bar.hidden = !open;
    app.classList.toggle("with-right", open);
    if (open) renderRight();
  });
  $("#btnCloseRight").addEventListener("click", () => {
    $("#rightbar").hidden = true;
    $("#app").classList.remove("with-right");
  });
  $("#btnMute").addEventListener("click", () => {
    state.muted = !state.muted;
    audio.muted = state.muted;
    persist();
    renderPlayer();
  });
  $("#btnFull").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => toast("Full screen not allowed"));
  });

  const seek = $("#seekBar");
  seek.addEventListener("pointerdown", () => { seeking = true; });
  seek.addEventListener("input", () => {
    seeking = true;
    const dur = isFinite(audio.duration) ? audio.duration : 0;
    const pct = Number(seek.value) / 1000;
    seek.style.setProperty("--pct", (pct * 100).toFixed(2) + "%");
    $("#curTime").textContent = fmt(pct * dur);
    if (dur > 0) audio.currentTime = pct * dur;
  });
  const endSeek = () => { seeking = false; };
  seek.addEventListener("change", endSeek);
  window.addEventListener("pointerup", endSeek);

  const vol = $("#volBar");
  vol.addEventListener("input", () => {
    const v = Number(vol.value) / 100;
    state.volume = v;
    state.muted = v === 0;
    audio.volume = v;
    audio.muted = state.muted;
    vol.style.setProperty("--pct", vol.value + "%");
    setIco($("#btnMute"), v === 0 ? "mute" : "volume", 18);
  });
  vol.addEventListener("change", () => persist());

  /* --- resume modal --- */
  $("#btnResumeYes").addEventListener("click", () => resumePlay(false));
  $("#btnResumeNo").addEventListener("click", () => resumePlay(true));
  $("#btnResumeX").addEventListener("click", () => closeResume(true));
  $("#resumeOverlay").addEventListener("click", (e) => { if (e.target === $("#resumeOverlay")) closeResume(true); });

  /* --- upload modal --- */
  $("#btnCloseUpload").addEventListener("click", closeUpload);
  $("#uploadOverlay").addEventListener("click", (e) => { if (e.target === $("#uploadOverlay")) closeUpload(); });
  $$(".tab").forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));
  $("#btnBrowse").addEventListener("click", () => $("#fileInput").click());
  $("#dropZone").addEventListener("click", (e) => { if (e.target.id !== "btnBrowse") $("#fileInput").click(); });
  $("#fileInput").addEventListener("change", (e) => { uploadFiles(e.target.files); e.target.value = ""; });
  $("#btnAddUrlGo").addEventListener("click", addUrlSong);

  const dz = $("#dropZone");
  ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("hot"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("hot"); }));
  dz.addEventListener("drop", e => { if (e.dataTransfer) uploadFiles(e.dataTransfer.files); });

  /* --- global drag & drop --- */
  let dragDepth = 0;
  window.addEventListener("dragenter", e => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
      dragDepth++; $("#dragOverlay").hidden = false;
    }
  });
  window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("#dragOverlay").hidden = true; });
  window.addEventListener("dragover", e => e.preventDefault());
  window.addEventListener("drop", e => {
    e.preventDefault();
    dragDepth = 0;
    $("#dragOverlay").hidden = true;
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || [])
      .filter(f => (f.type && f.type.startsWith("audio/")) || /\.(mp3|m4a|ogg|wav|flac|opus|aac)$/i.test(f.name));
    if (files.length) uploadFiles(files);
  });

  /* --- keyboard shortcuts --- */
  document.addEventListener("keydown", e => {
    const t = (e.target.tagName || "").toLowerCase();
    if (t === "input" || t === "textarea" || e.target.isContentEditable) return;
    if (e.key === "Escape") { closeUpload(); if (!$("#resumeOverlay").hidden) closeResume(true); return; }
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); if (e.shiftKey) nextTrack(false); else if (isFinite(audio.duration)) { audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); saveProgress(false); } }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (e.shiftKey) prevTrack(); else { audio.currentTime = Math.max(0, audio.currentTime - 5); saveProgress(false); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); state.volume = clamp(state.volume + 0.05, 0, 1); audio.volume = state.volume; if (state.volume > 0) { state.muted = false; audio.muted = false; } persist(false); renderPlayer(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); state.volume = clamp(state.volume - 0.05, 0, 1); audio.volume = state.volume; persist(false); renderPlayer(); }
    else if (e.key === "m" || e.key === "M") { state.muted = !state.muted; audio.muted = state.muted; persist(false); renderPlayer(); }
    else if (e.key === "s" || e.key === "S") { state.shuffle = !state.shuffle; persist(); renderPlayer(); toast(state.shuffle ? "Shuffle on" : "Shuffle off"); }
    else if (e.key === "r" || e.key === "R") { state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off"; persist(); renderPlayer(); }
  });

  /* --- persistence hooks --- */
  window.addEventListener("pagehide", () => { saveProgress(true); Store.saveLocal(state); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      saveProgress(true);
      Store.saveLocal(state);
      if (Store.config.api && state.connected) Store.pushState(cloudPayload()).catch(() => {});
    }
  });
  window.addEventListener("offline", () => toast("You are offline — cached songs still play", "error"));
  window.addEventListener("online", () => { if (Store.config.api) connectCloud().then(() => render()); });
}

/* ================= start ================= */
async function start() {
  fillStaticIcons();
  wireEvents();
  await loadLocalState();
  updateHistoryButtons();
  await connectCloud();
  render();
  // give the UI a beat, then ask about resuming the last session
  setTimeout(maybeResume, 700);
}

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("Service worker failed:", err));
  });
}

start().catch(err => {
  console.error(err);
  toast("Player failed to start: " + err.message, "error");
});

})();
