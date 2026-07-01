// ============================================================
// Calibrary — static site generator for a Calibre library.
//   node build.mjs
// Reads <CALIBRE_DIR>/metadata.db (+ book folders), writes ./dist.
// CALIBRE_DIR defaults to ./Calibre (override in rebuild.command).
// The whole site is AES-encrypted; set LIBRARY_PASSWORD to your secret.
// ============================================================
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
// Source Calibre library. Override with CALIBRE_DIR (set in rebuild.command);
// accepts a folder name next to this script or an absolute path.
const SRC_INPUT = (process.env.CALIBRE_DIR || "Calibre").trim();
const SRC = path.isAbsolute(SRC_INPUT) ? SRC_INPUT : path.join(__dir, SRC_INPUT);
const OUT = path.join(__dir, "dist");
const DB_PATH = path.join(SRC, "metadata.db");
const SITE_NAME = "Calibrary";
const TAGLINE = "A reading room for the small hours.";
// Set true to re-enable the in-browser EPUB reader ("Read online" button + reader pages).
const SHOW_READER = false;
const THEME_COLOR = "#f3eee2";   // cream — status bar / theme tint

// Apple + PWA head tags. Makes "Add to Home Screen" a true standalone app:
// the status bar is tinted to the theme (not a white bar) and iOS uses the
// crisp apple-touch-icon.png instead of a fuzzy screenshot of the page. Also
// registers the (shell-only) service worker so the app opens offline.
const appleHead = (root) => `<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${SITE_NAME}">
<link rel="apple-touch-icon" href="${root}apple-touch-icon.png">
<script>if('serviceWorker'in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}</script>`;

// ---- encryption (private library) -----------------------------------
// The whole library is AES-GCM encrypted at rest. The passphrase comes
// from (in order): the LIBRARY_PASSWORD env var, the git-ignored
// ./library-password.txt file, or the "changeme" fallback.
function readPassword() {
  if (process.env.LIBRARY_PASSWORD) return process.env.LIBRARY_PASSWORD;
  try {
    const f = path.join(__dir, "library-password.txt");
    if (fs.existsSync(f)) { const p = fs.readFileSync(f, "utf8").trim(); if (p) return p; }
  } catch (e) {}
  return "changeme";
}
const PASSWORD = readPassword();
const ITERS = 150000;
// The salt MUST be stable across rebuilds. The client caches the derived key
// (password+salt) in localStorage; if the salt changed every build, that key
// would stop matching after each rebuild and — with pages cached by the
// service worker across builds — trap the reader in an unlockable login loop.
// So we generate one random salt and persist it (git-ignored, next to the
// password). Same salt + same password ⇒ same key ⇒ old keys keep working and
// old cached pages still decrypt. IVs stay random per-encryption, so GCM
// security is unchanged; the salt is public in every page anyway.
function readOrCreateSalt() {
  const f = path.join(__dir, "library-salt.txt");
  try {
    if (fs.existsSync(f)) {
      const b = Buffer.from(fs.readFileSync(f, "utf8").trim(), "base64");
      if (b.length === 16) return b;
    }
  } catch (e) {}
  const s = crypto.randomBytes(16);
  try { fs.writeFileSync(f, s.toString("base64") + "\n"); } catch (e) {}
  return s;
}
const SALT = readOrCreateSalt();
const KEY = crypto.pbkdf2Sync(PASSWORD, SALT, ITERS, 32, "sha256");
function encBytes(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]); // iv | ciphertext | tag
}
const encB64 = (buf) => encBytes(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)).toString("base64");
const CHECK = encB64("calibrary");
// Injected into every shell/page/login so the client can derive + verify.
const calCfg = (root) =>
  `<script>window.CAL={salt:"${SALT.toString("base64")}",iters:${ITERS},check:"${CHECK}",login:"${root}login/",home:"${root}"};</script>`;

// ---- genre label map + noise filter ---------------------------------
const GENRE_LABELS = {
  det_action: "Detective · Action", det_classic: "Classic Detective",
  det_history: "Historical Detective", det_police: "Police Procedural",
  detective: "Detective", foreign_fantasy: "Foreign Fantasy",
  foreign_sf: "Foreign Sci-Fi", literature_20: "20th-Century Literature",
  popadanec: "Portal Fantasy", prose_rus_classic: "Russian Classic Prose",
  sf: "Science Fiction", sf_action: "Sci-Fi Action", sf_cyberpunk: "Cyberpunk",
  sf_detective: "Sci-Fi Detective", sf_fantasy: "Science Fantasy",
  sf_heroic: "Heroic Fantasy", sf_history: "Alternate History",
  sf_horror: "Horror", sf_humor: "Comedic Sci-Fi", sf_social: "Social Sci-Fi",
  sf_space: "Space Opera", thriller: "Thriller",
};
const NOISE_TAGS = new Set(["ebook", "epub"]);
const genreLabel = (n) => GENRE_LABELS[n] || n;

const LANG_LABELS = { rus: "Russian", eng: "English", ukr: "Ukrainian" };

// deterministic book-cloth spine palette
const SPINES = ["#7d2b2b","#8a5a2b","#3f5a4a","#2f4858","#4a3b5c","#6b4423",
  "#2d4739","#5c3a2e","#454b6b","#6b2d4a","#2b5d5d","#734a1e"];
function hash(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return Math.abs(h);}
const spineColor = (s) => SPINES[hash(s || "x") % SPINES.length];

// ---- helpers --------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const attr = esc;
const fmtIdx = (n) => (n == null ? "" : Number.isInteger(n) ? String(n) : String(+n.toFixed(1)));

function sanitize(html) {
  if (!html) return "";
  return String(html)
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*style[\s\S]*?<\s*\/\s*style\s*>/gi, "")
    .replace(/ on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/ on[a-z]+\s*=\s*'[^']*'/gi, "");
}

function rmrf(p){ fs.rmSync(p,{recursive:true,force:true}); }
function ensure(p){ fs.mkdirSync(p,{recursive:true}); }
function relRoot(rel){ return rel === "" ? "" : "../".repeat(rel.split("/").length); }
function writeRaw(rel, html){
  const dir = rel === "" ? OUT : path.join(OUT, rel);
  ensure(dir);
  fs.writeFileSync(path.join(dir, "index.html"), html);
}
// Encrypt a full page and write a tiny shell that decrypts it (or sends
// the visitor to the login page when the library is locked).
function writePage(rel, html){
  const root = relRoot(rel);
  const shell = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${SITE_NAME}</title>
<meta name="color-scheme" content="light">
<meta name="theme-color" content="${THEME_COLOR}">
${appleHead(root)}
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${root}assets/theme.css">
${calCfg(root)}
</head>
<body>
<script id="cal-payload" type="application/octet-stream">${encB64(html)}</script>
<script src="${root}assets/crypto.js"></script>
<script src="${root}assets/boot.js"></script>
<noscript><p style="font-family:monospace;padding:2rem">This private library needs JavaScript to unlock.</p></noscript>
</body>
</html>`;
  writeRaw(rel, shell);
}
function copyIf(from, to){
  try { if (fs.existsSync(from)) { ensure(path.dirname(to)); fs.copyFileSync(from, to); return true; } }
  catch(e){}
  return false;
}

// ============================================================
// 1. Load data
// ============================================================
if (!fs.existsSync(DB_PATH)) {
  console.error(`\n  metadata.db not found at ${DB_PATH}\n  Point CALIBRE_DIR at your Calibre library folder (edit rebuild.command) and retry.\n`);
  process.exit(1);
}
console.log(`Source: ${SRC}`);
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const q = (sql) => db.prepare(sql).all();

const rawBooks = q(`
  SELECT b.id, b.title, b.sort, b.pubdate, b.timestamp, b.series_index,
         b.path, b.has_cover, c.text AS comment
  FROM books b LEFT JOIN comments c ON c.book = b.id
  ORDER BY b.sort`);

const authorsByBook = {}, authorMap = {};
for (const r of q(`SELECT bal.book, a.id, a.name FROM books_authors_link bal
    JOIN authors a ON a.id = bal.author ORDER BY a.sort`)) {
  (authorsByBook[r.book] ||= []).push({ id: r.id, name: r.name });
  authorMap[r.id] ||= { id: r.id, name: r.name, books: [] };
}
const seriesByBook = {}, seriesMap = {};
for (const r of q(`SELECT bsl.book, s.id, s.name FROM books_series_link bsl
    JOIN series s ON s.id = bsl.series`)) {
  seriesByBook[r.book] = { id: r.id, name: r.name };
  seriesMap[r.id] ||= { id: r.id, name: r.name, books: [] };
}
const genresByBook = {}, genreMap = {};
for (const r of q(`SELECT btl.book, t.id, t.name FROM books_tags_link btl
    JOIN tags t ON t.id = btl.tag`)) {
  if (NOISE_TAGS.has(r.name)) continue;
  (genresByBook[r.book] ||= []).push({ id: r.id, name: r.name });
  genreMap[r.id] ||= { id: r.id, name: r.name, books: [] };
}
const langByBook = {};
for (const r of q(`SELECT bll.book, l.lang_code FROM books_languages_link bll
    JOIN languages l ON l.id = bll.lang_code`)) {
  (langByBook[r.book] ||= []).push(r.lang_code);
}
const idsByBook = {};
for (const r of q(`SELECT book, type, val FROM identifiers`)) {
  (idsByBook[r.book] ||= {})[r.type] = r.val;
}
const fmtByBook = {};
for (const r of q(`SELECT book, format, name FROM data`)) {
  (fmtByBook[r.book] ||= []).push({ format: r.format, name: r.name });
}

// assemble
function pickDownload(formats) {
  if (!formats) return null;
  const order = ["EPUB", "ORIGINAL_EPUB", "FB2", "MOBI", "PDF", "AZW3"];
  for (const f of order) { const hit = formats.find((x) => x.format === f); if (hit) return hit; }
  return formats[0];
}

const books = rawBooks.map((b) => {
  const authors = authorsByBook[b.id] || [];
  const series = seriesByBook[b.id] || null;
  const genres = genresByBook[b.id] || [];
  const langs = langByBook[b.id] || [];
  const dl = pickDownload(fmtByBook[b.id]);
  const isEpub = dl && (dl.format === "EPUB" || dl.format === "ORIGINAL_EPUB");
  const ext = dl ? (dl.format.includes("EPUB") ? "epub" : dl.format.toLowerCase()) : null;
  const spineKey = (authors[0]?.name || "") + (series?.name || b.title);
  return {
    ...b, authors, series, genres, langs,
    year: b.pubdate ? parseInt(String(b.pubdate).slice(0, 4), 10) : null,
    added: b.timestamp ? Date.parse(b.timestamp) || 0 : 0,
    isbn: idsByBook[b.id]?.isbn || null,
    ids: idsByBook[b.id] || {},
    dl, isEpub, ext,
    fmtList: (fmtByBook[b.id] || []).map((f) => f.format).filter((f, i, a) => a.indexOf(f) === i),
    spine: spineColor(spineKey),
  };
});
const bookById = Object.fromEntries(books.map((b) => [b.id, b]));

// back-fill relations
for (const b of books) {
  for (const a of b.authors) authorMap[a.id].books.push(b.id);
  if (b.series) seriesMap[b.series.id].books.push(b.id);
  for (const g of b.genres) genreMap[g.id].books.push(b.id);
}
const authors = Object.values(authorMap).sort((a, b) => a.name.localeCompare(b.name));
const seriesList = Object.values(seriesMap)
  .map((s) => ({ ...s, books: s.books.slice().sort((x, y) => (bookById[x].series_index || 0) - (bookById[y].series_index || 0)) }))
  .sort((a, b) => b.books.length - a.books.length || a.name.localeCompare(b.name));
const genres = Object.values(genreMap).sort((a, b) => b.books.length - a.books.length || genreLabel(a.name).localeCompare(genreLabel(b.name)));

console.log(`Loaded ${books.length} books · ${authors.length} authors · ${seriesList.length} series · ${genres.length} genres`);

// ============================================================
// 2. Reset output + copy assets, covers, files
// ============================================================
rmrf(OUT); ensure(OUT);
const assetsOut = path.join(OUT, "assets");
ensure(assetsOut);
for (const [from, to] of [
  ["src/theme.css", "theme.css"],
  ["src/app.js", "app.js"],
  ["src/reader.js", "reader.js"],
  ["src/crypto.js", "crypto.js"],
  ["src/boot.js", "boot.js"],
  ["src/login.js", "login.js"],
  ["src/i18n.js", "i18n.js"],
  ["node_modules/epubjs/dist/epub.min.js", "epub.min.js"],
  ["node_modules/jszip/dist/jszip.min.js", "jszip.min.js"],
  ["node_modules/node-forge/dist/forge.min.js", "forge.min.js"],
]) copyIf(path.join(__dir, from), path.join(assetsOut, to));

// translation dictionaries
for (const l of ["en", "ru"]) copyIf(path.join(__dir, "src/i18n", `${l}.json`), path.join(assetsOut, "i18n", `${l}.json`));

// Encrypt covers + book files to <id>.<ext>.enc (no plaintext leaves the build).
function encFile(from, to) {
  try {
    if (!fs.existsSync(from)) return false;
    ensure(path.dirname(to));
    fs.writeFileSync(to, encBytes(fs.readFileSync(from)));
    return true;
  } catch (e) { return false; }
}
let covers = 0, filesCopied = 0;
for (const b of books) {
  const dir = path.join(SRC, b.path);
  if (b.has_cover && encFile(path.join(dir, "cover.jpg"), path.join(OUT, "covers", `${b.id}.jpg.enc`))) covers++;
  if (b.dl) {
    const src = path.join(dir, `${b.dl.name}.${b.ext}`);
    if (encFile(src, path.join(OUT, "files", `${b.id}.${b.ext}.enc`))) { filesCopied++; b.hasFile = true; }
  }
}
console.log(`Encrypted ${covers} covers · ${filesCopied} book files`);

// Encrypted search index (title / author / series) for the header search.
const searchIndex = books.map((b) => ({
  id: b.id, t: b.title,
  a: b.authors.map((a) => a.name).join(", "),
  s: b.series ? b.series.name : "",
}));
fs.writeFileSync(path.join(OUT, "search.json.enc"), encBytes(Buffer.from(JSON.stringify(searchIndex))));

// Encrypted card index — lets the client render cards for saved (Read Next) books.
const cardIndex = books.map((b) => ({
  id: b.id, t: b.title,
  a: b.authors.map((a) => a.name).join(", "),
  s: b.series ? b.series.name : "",
  si: b.series ? fmtIdx(b.series_index) : "",
  sp: b.spine,
}));
fs.writeFileSync(path.join(OUT, "books.json.enc"), encBytes(Buffer.from(JSON.stringify(cardIndex))));

// favicon (brass book spine) + manifest
fs.writeFileSync(path.join(OUT, "favicon.svg"),
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="#efe9db"/><rect x="8" y="6" width="7" height="20" rx="1" fill="#9a6d20"/><rect x="16" y="6" width="6" height="20" rx="1" fill="#9c3826"/><rect x="9.5" y="9" width="4" height="1" fill="#efe9db"/><rect x="9.5" y="22" width="4" height="1" fill="#efe9db"/></svg>`);

// ---- rasterised app icons (dependency-free PNG) ---------------------
// iOS home-screen icons must be raster PNG — an SVG apple-touch-icon is
// ignored and iOS falls back to a blurry screenshot. We draw the book-spine
// mark at a few sizes so it stays sharp on high-density screens.
function crc32(buf){
  let c = ~0;
  for (let i = 0; i < buf.length; i++){
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function pngChunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba){
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, colour type 6 (RGBA)
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}
// nearest-point rounded-rect hit test (all args in 0..1 fractions)
function inRoundRect(px, py, x, y, w, h, r){
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const rx = Math.min(Math.max(px, x + r), x + w - r);
  const ry = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - rx, dy = py - ry;
  return dx * dx + dy * dy <= r * r;
}
function renderIcon(size){
  const rgba = Buffer.alloc(size * size * 4);
  const cream = [0xef,0xe9,0xdb], bronze = [0x9a,0x6d,0x20], bronzeHi = [0x6f,0x4c,0x14];
  const oxblood = [0x9c,0x38,0x26], oxHi = [0x73,0x28,0x1b];
  const w1 = 0.225, w2 = 0.19, gap = 0.03;
  const x1 = (1 - (w1 + gap + w2)) / 2, x2 = x1 + w1 + gap;
  const yTop = 0.26, hgt = 0.48, rs = 0.02;
  const lineX = x1 + 0.045, lineW = w1 - 0.09, lineH = 0.018, lr = 0.006;
  const lines = [yTop + 0.06, yTop + hgt - 0.09];
  const SS = size > 256 ? 2 : 4, n = SS * SS;
  for (let py = 0; py < size; py++){
    for (let px = 0; px < size; px++){
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++){
        const fx = (px + (sx + 0.5) / SS) / size, fy = (py + (sy + 0.5) / SS) / size;
        let col = cream;
        if (inRoundRect(fx, fy, x1, yTop, w1, hgt, rs)){
          col = fx < x1 + 0.05 ? bronzeHi : bronze;
          for (const ly of lines) if (inRoundRect(fx, fy, lineX, ly, lineW, lineH, lr)) col = cream;
        }
        if (inRoundRect(fx, fy, x2, yTop, w2, hgt, rs)) col = fx < x2 + 0.045 ? oxHi : oxblood;
        r += col[0]; g += col[1]; b += col[2];
      }
      const o = (py * size + px) * 4;
      rgba[o] = Math.round(r / n); rgba[o+1] = Math.round(g / n); rgba[o+2] = Math.round(b / n); rgba[o+3] = 255;
    }
  }
  return rgba;
}
for (const [name, sz] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]])
  fs.writeFileSync(path.join(OUT, name), encodePng(sz, sz, renderIcon(sz)));

fs.writeFileSync(path.join(OUT, "site.webmanifest"), JSON.stringify({
  name: SITE_NAME, short_name: SITE_NAME, start_url: "./", display: "standalone",
  background_color: "#e8e2d3", theme_color: THEME_COLOR,
  icons: [
    { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
    { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
}, null, 2));

// ---- offline fallback + service worker ------------------------------
// Shell-only offline support: the UI/code is precached so the app always
// opens (and can decrypt already-cached pages) with no connection; pages you
// haven't visited fall back to this offline page. No plaintext is ever stored
// — only the encrypted assets the browser already downloaded. The cache name
// is a hash of the shell code, so it changes (and purges old caches) whenever
// the HTML/CSS/JS changes — but NOT on every rebuild, which would needlessly
// re-download the shell each time only the library content changed.
const SW_VERSION = crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(__dir, "src/theme.css")))
  .update(fs.readFileSync(path.join(__dir, "src/crypto.js")))
  .update(fs.readFileSync(path.join(__dir, "src/boot.js")))
  .update(fs.readFileSync(path.join(__dir, "src/app.js")))
  .update(fs.readFileSync(path.join(__dir, "src/i18n.js")))
  .update(fs.readFileSync(path.join(__dir, "src/login.js")))
  .digest("hex").slice(0, 12);
fs.writeFileSync(path.join(OUT, "offline.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${SITE_NAME} — Offline</title>
<meta name="color-scheme" content="light">
<meta name="theme-color" content="${THEME_COLOR}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/theme.css">
</head>
<body class="login-body">
<main class="login">
  <svg class="login__mark" viewBox="0 0 16 24" aria-hidden="true">
    <rect x="0.6" y="0.6" width="14.8" height="22.8" rx="1.8" fill="var(--accent)"/>
    <rect x="0.6" y="0.6" width="3.6" height="22.8" rx="1.8" fill="var(--accent-hi)"/>
  </svg>
  <h1>You're offline</h1>
  <p>This page isn't in the cache yet. Reconnect and try again — pages you've already opened stay available offline.</p>
  <p class="login__note"><a href="/" style="color:var(--accent)">Return to the library</a></p>
</main>
</body>
</html>`);

fs.writeFileSync(path.join(OUT, "sw.js"), `// Calibrary service worker — shell-only offline (build ${SW_VERSION}).
const CORE_CACHE = "cal-core-${SW_VERSION}";
const RUNTIME = "cal-rt-${SW_VERSION}";
const CORE = [
  "/offline.html", "/favicon.svg", "/apple-touch-icon.png", "/site.webmanifest",
  "/assets/theme.css", "/assets/crypto.js", "/assets/forge.min.js",
  "/assets/boot.js", "/assets/app.js", "/assets/i18n.js", "/assets/login.js",
  "/assets/i18n/en.json", "/assets/i18n/ru.json",
];
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CORE_CACHE)
      .then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CORE_CACHE && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // Navigations: network-first, fall back to a cached copy, then the offline page.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/offline.html")))
    );
    return;
  }
  // Static assets & fonts: stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => { if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); } return res; })
        .catch(() => hit);
      return hit || net;
    })
  );
});
`);

// ============================================================
// 3. HTML shell + components
// ============================================================
const NAV = [
  ["Books", "books/"], ["Authors", "authors/"],
  ["Series", "series/"], ["Genres", "genres/"],
];

function searchForm(root, extraClass = "") {
  return `<form class="search ${extraClass}" role="search" data-jump="${root}books/" data-search-form autocomplete="off">
    <svg viewBox="0 0 24 24" fill="none" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
    <input type="search" name="q" placeholder="Search by title or author…" data-i18n-ph="search.ph" aria-label="Search books" data-i18n-al="search.aria" enterkeyhint="search" autocomplete="off"
      role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${extraClass ? "sr-h" : "sr-m"}">
    <div class="search__results" data-search-results id="${extraClass ? "sr-h" : "sr-m"}" role="listbox" hidden></div>
  </form>`;
}

// A small closed-book mark (2:3), tinted from the theme accent.
const bookMark = (cls) =>
  `<svg class="${cls}" viewBox="0 0 16 24" aria-hidden="true">
    <rect x="0.6" y="0.6" width="14.8" height="22.8" rx="1.8" fill="var(--accent)"/>
    <rect x="0.6" y="0.6" width="3.6" height="22.8" rx="1.8" fill="var(--accent-hi)"/>
    <path d="M7 6.8h6M7 10.3h6M7 13.8h4.4" stroke="#fff" stroke-opacity="0.55" stroke-width="1" stroke-linecap="round"/>
  </svg>`;

const NAV_KEY = { Books: "nav.books", Authors: "nav.authors", Series: "nav.series", Genres: "nav.genres" };
function langSel() {
  return `<div class="langsel" role="group" aria-label="Language">
    <button type="button" data-lang="en">EN</button>
    <button type="button" data-lang="ru">RU</button>
  </div>`;
}
function header(root, active) {
  const readNext =
    `<a href="${root}read-next/"${active === "Read Next" ? ' aria-current="page"' : ""}><span data-i18n="nav.readnext">Read Next</span><span class="nav__badge" data-bm-count hidden>0</span></a>`;
  const links = NAV.map(([label, href]) =>
    `<a href="${root}${href}"${active === label ? ' aria-current="page"' : ""} data-i18n="${NAV_KEY[label]}">${label}</a>`).join("") + readNext;
  const mlinks = links;
  return `<header class="site-header">
    <div class="wrap site-header__inner">
      <a class="brand" href="${root}" aria-label="Calibrary home">${bookMark("brand__mark")}<span class="brand__name">Cali<b>brary</b></span></a>
      <nav class="nav" aria-label="Primary">${links}</nav>
      ${langSel()}
      ${searchForm(root, "search--header")}
      <button class="menu-toggle" aria-label="Menu" aria-expanded="false" aria-controls="mnav">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>
    </div>
    <nav class="site-nav-mobile wrap" id="mnav" aria-label="Mobile">${mlinks}${searchForm(root)}</nav>
  </header>`;
}

function footer(root) {
  return `<footer class="site-footer"><div class="wrap">
    <span>${SITE_NAME} · <span data-i18n="footer.summary" data-n="${books.length}">${books.length} volumes · generated from a Calibre library</span></span>
    <span><a href="${root}books/" data-i18n="footer.browse">Browse all</a></span>
  </div></footer>`;
}

function layout({ title, description, root, active, body, bodyClass = "", head = "", scripts = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<meta name="color-scheme" content="light">
<meta name="theme-color" content="${THEME_COLOR}">
${appleHead(root)}
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="manifest" href="${root}site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,340..600;1,9..144,340..600&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..500&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${root}assets/theme.css">
${calCfg(root)}
<script src="${root}assets/crypto.js"></script>
<script src="${root}assets/i18n.js"></script>
${head}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
<a class="skip-link" href="#main">Skip to content</a>
${header(root, active)}
<main id="main">
${body}
</main>
${footer(root)}
<script src="${root}assets/app.js" defer></script>
${scripts}
</body>
</html>`;
}

// ---- reusable components -------------------------------------
// 1×1 transparent placeholder; the real cover is decrypted client-side.
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const BM_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.4l-6.5-3.7-6.5 3.7V4a.5.5 0 0 1 .5-.5z"/></svg>`;
function coverInner(b, root) {
  if (b.has_cover) {
    return `<img src="${BLANK}" data-enc="${root}covers/${b.id}.jpg.enc" alt="Cover of ${attr(b.title)}" decoding="async">`;
  }
  return `<div class="card__cover--empty">${esc(b.title)}</div>`;
}

function bookCard(b, root, { showIndex = false } = {}) {
  const by = b.authors.map((a) => esc(a.name)).join(", ") || "Unknown";
  const searchStr = [b.title, by, b.series?.name, ...b.genres.map((g) => genreLabel(g.name))].join(" ");
  const genreIds = b.genres.map((g) => g.id).join("|");
  const badge = showIndex && b.series ? `<span class="card__badge">#${fmtIdx(b.series_index)}</span>` : "";
  return `<article class="card" data-card
    data-search="${attr(searchStr)}" data-genres="${genreIds}"
    data-title="${attr(b.sort || b.title)}" data-author="${attr(b.authors[0]?.name || "")}"
    data-added="${b.added}" data-year="${b.year || 0}">
    <div class="card__cover" style="--spine:${b.spine}">
      <a class="card__link" href="${root}book/${b.id}/" aria-label="Open ${attr(b.title)}">${coverInner(b, root)}</a>
      ${badge}
      <button class="bm" data-bookmark="${b.id}" aria-label="Save “${attr(b.title)}” for later" aria-pressed="false">${BM_ICON}</button>
    </div>
    <a class="card__body" href="${root}book/${b.id}/"><h3 class="card__title">${esc(b.title)}</h3></a>
    <div class="card__by">${by}</div>
    ${b.series ? `<div class="card__meta">${esc(b.series.name)} · #${fmtIdx(b.series_index)}</div>` : ""}
  </article>`;
}

function grid(list, root, opts) {
  return `<div class="grid">${list.map((b) => bookCard(b, root, opts)).join("")}</div>`;
}

// ============================================================
// 4. Home
// ============================================================
(function home() {
  const root = "";
  const recent = books.slice().sort((a, b) => b.added - a.added).slice(0, 12);

  const topSeries = seriesList.slice(0, 25);
  const seriesRail = topSeries.map((s) =>
    `<a class="chip" href="${root}series/${s.id}/">${esc(s.name)}<b>${s.books.length}</b></a>`).join("");

  const genreChips = genres.slice(0, 25).map((g) =>
    `<a class="chip chip--genre" href="${root}genre/${g.id}/"><span data-i18n-genre="${attr(g.name)}">${esc(genreLabel(g.name))}</span><b>${g.books.length}</b></a>`).join("");

  const body = `
  <section class="hero wrap">
    <p class="eyebrow" data-i18n="home.eyebrow">Personal library · established from Calibre</p>
    <h1 class="hero__title" data-i18n-html="home.herotitle">Books for the <em>small hours</em>, shelved and lit.</h1>
    <p class="hero__lead" data-i18n="home.herolead" data-n="${books.length}">${books.length} volumes — science fiction, fantasy, detective and the odd classic — browsable by author, series, genre or title. Read them here or take them with you.</p>
    <div class="stats">
      <a class="stat" href="${root}books/"><b>${books.length}</b><span data-i18n="stat.volumes">Volumes</span></a>
      <a class="stat" href="${root}authors/"><b>${authors.length}</b><span data-i18n="stat.authors">Authors</span></a>
      <a class="stat" href="${root}series/"><b>${seriesList.length}</b><span data-i18n="stat.series">Series</span></a>
      <a class="stat" href="${root}genres/"><b>${genres.length}</b><span data-i18n="stat.genres">Genres</span></a>
    </div>
  </section>

  <section class="section wrap" data-home-readnext hidden>
    <div class="section__head"><h2 data-i18n="home.readnext">Read next</h2><a class="section__more" href="${root}read-next/" data-i18n="home.queue">Your queue →</a></div>
    <div class="grid" data-readnext-grid></div>
  </section>

  <section class="section wrap">
    <div class="section__head"><h2 data-i18n="home.recent">Recently shelved</h2><a class="section__more" href="${root}books/" data-i18n="home.allbooks">All books →</a></div>
    ${grid(recent, root)}
  </section>

  <section class="section--tight wrap">
    <div class="section__head"><h2 data-i18n="home.seriessec">Series</h2><a class="section__more" href="${root}series/" data-i18n="home.allseries">All series →</a></div>
    <div class="chips">${seriesRail}</div>
  </section>

  <section class="section wrap">
    <div class="section__head"><h2 data-i18n="home.genressec">Genres</h2><a class="section__more" href="${root}genres/" data-i18n="home.allgenres">All genres →</a></div>
    <div class="chips">${genreChips}</div>
  </section>`;

  writePage("", layout({
    title: `${SITE_NAME} - Home`,
    description: `A personal library of ${books.length} ebooks — browse by author, series, genre or title, and read in your browser.`,
    root, active: "", body,
  }));
})();

// ============================================================
// 5. Books index (filterable)
// ============================================================
(function booksIndex() {
  const root = "../";
  const genreOptions = genres.map((g) =>
    `<option value="${g.id}" data-i18n-genre="${attr(g.name)}">${esc(genreLabel(g.name))}</option>`).join("");
  const body = `
  <div class="page-head wrap">
    <p class="breadcrumb"><a href="${root}" data-i18n="crumb.home">Home</a><span>/</span><span data-i18n="books.h1">All books</span></p>
    <h1 data-i18n="books.h1">All books</h1>
  </div>
  <section class="section--tight wrap">
    <div class="toolbar">
      <form class="search" role="search" onsubmit="return false">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input type="search" data-filter-q placeholder="Filter by title, author, series…" data-i18n-ph="books.filterph" aria-label="Filter books" data-i18n-al="books.filteraria" enterkeyhint="search">
      </form>
      <label class="field"><span data-i18n="books.genre">Genre</span>
        <select data-filter-genre aria-label="Filter by genre"><option value="" data-i18n="books.all">All</option>${genreOptions}</select>
      </label>
      <label class="field"><span data-i18n="books.sortlabel">Sort</span>
        <select data-sort aria-label="Sort books">
          <option value="title" data-i18n="sort.title">Title A–Z</option>
          <option value="author" data-i18n="sort.author">Author A–Z</option>
          <option value="newest" data-i18n="sort.newest">Recently added</option>
          <option value="year" data-i18n="sort.year">Publication year</option>
        </select>
      </label>
      <span class="result-count" data-count data-i18n="count.books" data-n="${books.length}">${books.length} books</span>
    </div>
    <div class="grid" data-filterable>${books.map((b) => bookCard(b, root)).join("")}</div>
    <p class="empty-state" data-empty hidden data-i18n="books.empty">Nothing on this shelf matches. Try fewer words.</p>
  </section>`;
  writePage("books", layout({
    title: `${SITE_NAME} - All books`,
    description: `Browse and filter all ${books.length} books by title, author, series and genre.`,
    root, active: "Books", body,
  }));
})();

// ============================================================
// 6. Book detail + reader
// ============================================================
const readerIcon = {
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20"/></svg>`,
  dl: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 21h14"/></svg>`,
};

const chevBtn = (dir, label) => {
  const d = dir === "prev" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6";
  return `<button class="carousel__btn carousel__btn--${dir}" data-carousel-${dir} aria-label="${label}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${d}"/></svg></button>`;
};
function relatedRail(prefixKey, prefixEn, name, list, root) {
  if (!list.length) return "";
  return `<div class="book__section"><h2><span data-i18n="${prefixKey}">${prefixEn}</span> ${esc(name)}</h2>
    <div class="carousel" data-carousel>
      ${chevBtn("prev", "Scroll back")}
      <div class="grid grid--rail carousel__track" data-carousel-track>${list.map((b) => bookCard(b, root, { showIndex: true })).join("")}</div>
      ${chevBtn("next", "Scroll forward")}
    </div></div>`;
}

for (const b of books) {
  const root = "../../";
  const by = b.authors.map((a) => `<a href="${root}author/${a.id}/">${esc(a.name)}</a>`).join(", ") || "Unknown";
  const genreChips = b.genres.map((g) =>
    `<a class="chip chip--genre" href="${root}genre/${g.id}/" data-i18n-genre="${attr(g.name)}">${esc(genreLabel(g.name))}</a>`).join("");
  const langKey = { rus: "langname.rus", eng: "langname.eng", ukr: "langname.ukr" };
  const langVal = b.langs.map((l) => langKey[l]
    ? `<span data-i18n="${langKey[l]}">${esc(LANG_LABELS[l] || l)}</span>` : esc(LANG_LABELS[l] || l)).join(", ");
  const facts = [];
  if (b.year) facts.push(["book.published", "Published", String(b.year)]);
  if (b.langs.length) facts.push(["book.language", "Language", langVal]);
  if (b.fmtList.length) facts.push(["book.formats", "Formats", esc(b.fmtList.map((f) => f.replace("ORIGINAL_", "")).filter((x,i,a)=>a.indexOf(x)===i).join(", "))]);
  if (b.isbn) facts.push(["book.isbn", "ISBN", esc(b.isbn)]);
  const factsHtml = facts.map(([k, en, v]) => `<dt data-i18n="${k}">${en}</dt><dd>${v}</dd>`).join("");

  const actions = [];
  if (SHOW_READER && b.hasFile && b.isEpub) actions.push(`<a class="btn btn--primary" href="${root}read/${b.id}/">${readerIcon.book} <span data-i18n="book.read">Read online</span></a>`);
  if (b.hasFile) actions.push(`<button type="button" class="btn${SHOW_READER ? "" : " btn--primary"}" data-download="${root}files/${b.id}.${b.ext}.enc" data-name="${attr(b.dl.name)}.${b.ext}">${readerIcon.dl} <span data-i18n="book.download">Download</span> ${b.ext.toUpperCase()}</button>`);
  actions.push(`<button type="button" class="btn btn--bookmark" data-bookmark="${b.id}" aria-pressed="false">${BM_ICON}<span data-bm-text>Read next</span></button>`);

  const seriesSiblings = b.series
    ? seriesMap[b.series.id].books.filter((id) => id !== b.id).map((id) => bookById[id])
    : [];
  const authorOthers = b.authors.length
    ? authorMap[b.authors[0].id].books.filter((id) => id !== b.id && !seriesSiblings.some((s) => s.id === id))
        .map((id) => bookById[id]).slice(0, 8)
    : [];

  const jsonld = {
    "@context": "https://schema.org", "@type": "Book",
    name: b.title,
    author: b.authors.map((a) => ({ "@type": "Person", name: a.name })),
    inLanguage: b.langs[0], bookFormat: "https://schema.org/EBook",
    ...(b.isbn ? { isbn: b.isbn } : {}),
    ...(b.series ? { isPartOf: { "@type": "BookSeries", name: b.series.name } } : {}),
  };

  const body = `
  <article class="book wrap">
    <aside class="book__aside">
      <img class="book__cover" src="${BLANK}" data-enc="${root}covers/${b.id}.jpg.enc" alt="Cover of ${attr(b.title)}" style="--spine:${b.spine}">
      <div class="book__actions">${actions.join("") || '<span class="result-count" data-i18n="book.nofile">No file available</span>'}</div>
    </aside>
    <div class="book__main">
      <p class="breadcrumb"><a href="${root}" data-i18n="crumb.home">Home</a><span>/</span><a href="${root}books/" data-i18n="nav.books">Books</a></p>
      <h1 class="book__title">${esc(b.title)}</h1>
      <p class="book__byline"><span data-i18n="book.by">by</span> ${by}</p>
      ${b.series ? `<a class="book__series" href="${root}series/${b.series.id}/">${esc(b.series.name)} · <span data-i18n="book.bookno">Book</span> ${fmtIdx(b.series_index)}</a>` : ""}
      ${b.comment ? `<div class="book__section"><h2 data-i18n="book.about">About</h2><div class="prose">${sanitize(b.comment)}</div></div>` : ""}
      ${genreChips ? `<div class="book__section"><h2 data-i18n="book.genres">Genres</h2><div class="chips">${genreChips}</div></div>` : ""}
      ${factsHtml ? `<div class="book__section"><h2 data-i18n="book.details">Details</h2><dl class="facts">${factsHtml}</dl></div>` : ""}
      ${relatedRail("book.morein", "More in", b.series ? b.series.name : "", seriesSiblings, root)}
      ${relatedRail("book.moreby", "More by", b.authors[0] ? b.authors[0].name : "", authorOthers, root)}
    </div>
  </article>`;

  writePage(`book/${b.id}`, layout({
    title: `${SITE_NAME} - ${b.title}`,
    description: (b.comment ? b.comment.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 155)
      : `${b.title}${b.authors[0] ? " by " + b.authors[0].name : ""} — read online or download.`),
    root, active: "Books", body,
    head: `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`,
  }));

  // ---- reader page ----
  if (SHOW_READER && b.hasFile && b.isEpub) {
    const rroot = "../../";
    const chev = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${d}"/></svg>`;
    const readerBody = `
    <div class="reader-progress" aria-hidden="true"></div>
    <div class="reader-bar">
      <a class="iconbtn" href="${rroot}book/${b.id}/" aria-label="Back to book">${chev("M15 18l-6-6 6-6")}</a>
      <span class="reader-bar__title">${esc(b.title)}</span>
      <button class="iconbtn" data-font-dec aria-label="Smaller text">A−</button>
      <button class="iconbtn" data-font-inc aria-label="Larger text">A+</button>
    </div>
    <button class="reader-nav reader-nav--prev" data-prev aria-label="Previous page" style="--dir:90deg">${chev("M15 18l-6-6 6-6")}</button>
    <div id="viewer"></div>
    <button class="reader-nav reader-nav--next" data-next aria-label="Next page" style="--dir:270deg">${chev("M9 6l6 6-6 6")}</button>
    <div class="reader-loading"><span><span data-i18n="reader.opening">Opening</span> ${esc(b.title)}…</span></div>`;
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${SITE_NAME} - Reading: ${esc(b.title)}</title>
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="${THEME_COLOR}">
${appleHead(rroot)}
<link rel="icon" href="${rroot}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${rroot}assets/theme.css">
${calCfg(rroot)}
<script src="${rroot}assets/crypto.js"></script>
<script src="${rroot}assets/i18n.js"></script>
</head>
<body class="reader-body" data-epub="${rroot}files/${b.id}.epub.enc" data-book="${b.id}">
${readerBody}
<script src="${rroot}assets/jszip.min.js"></script>
<script src="${rroot}assets/epub.min.js"></script>
<script src="${rroot}assets/reader.js"></script>
</body>
</html>`;
    writePage(`read/${b.id}`, html);
  }
}

// ============================================================
// 7. Author / Series / Genre pages
// ============================================================
function collectionPage(kind, item, list, { root, crumbKey, active, subKey, n, subEn, i18nGenre, opts }) {
  const h1 = i18nGenre
    ? `<h1><span data-i18n-genre="${attr(i18nGenre)}">${esc(item.title)}</span></h1>`
    : `<h1>${esc(item.title)}</h1>`;
  return `
  <div class="page-head wrap">
    <p class="breadcrumb"><a href="${root}" data-i18n="crumb.home">Home</a><span>/</span><a href="${root}${kind}s/" data-i18n="${crumbKey}">${active}</a></p>
    ${h1}
    <p data-i18n="${subKey}" data-n="${n}">${subEn}</p>
  </div>
  <section class="section--tight wrap">
    ${grid(list, root, opts)}
  </section>`;
}

for (const a of authors) {
  const root = "../../";
  const list = a.books.map((id) => bookById[id]).sort((x, y) => (x.sort || x.title).localeCompare(y.sort || y.title));
  writePage(`author/${a.id}`, layout({
    title: `${SITE_NAME} - ${a.name}`,
    description: `${list.length} book${list.length === 1 ? "" : "s"} by ${a.name} in the library.`,
    root, active: "Authors",
    body: collectionPage("author", { title: a.name }, list, {
      root, crumbKey: "nav.authors", active: "Authors", subKey: "sub.author", n: list.length,
      subEn: `${list.length} book${list.length === 1 ? "" : "s"} in the library.`,
    }),
  }));
}

for (const s of seriesList) {
  const root = "../../";
  const list = s.books.map((id) => bookById[id]);
  writePage(`series/${s.id}`, layout({
    title: `${SITE_NAME} - ${s.name} (series)`,
    description: `The ${s.name} series — ${list.length} book${list.length === 1 ? "" : "s"}, in reading order.`,
    root, active: "Series",
    body: collectionPage("serie", { title: s.name }, list, {
      root, crumbKey: "nav.series", active: "Series", subKey: "sub.seriesorder", n: list.length,
      subEn: `${list.length} book${list.length === 1 ? "" : "s"}, shown in series order.`,
      opts: { showIndex: true },
    }),
  }));
}

for (const g of genres) {
  const root = "../../";
  const list = g.books.map((id) => bookById[id]).sort((x, y) => (x.sort || x.title).localeCompare(y.sort || y.title));
  writePage(`genre/${g.id}`, layout({
    title: `${SITE_NAME} - ${genreLabel(g.name)}`,
    description: `${list.length} ${genreLabel(g.name)} book${list.length === 1 ? "" : "s"} in the library.`,
    root, active: "Genres",
    body: collectionPage("genre", { title: genreLabel(g.name) }, list, {
      root, crumbKey: "nav.genres", active: "Genres", subKey: "sub.genre", n: list.length,
      subEn: `${list.length} book${list.length === 1 ? "" : "s"}.`, i18nGenre: g.name,
    }),
  }));
}

// ============================================================
// 8. Directory index pages (authors / series / genres)
// ============================================================
function dirIndex(kind, active, headKey, introKey, items, root) {
  const rows = items.map((it) => {
    const name = it.genreCode
      ? `<span class="dir__name" data-i18n-genre="${attr(it.genreCode)}">${esc(it.name)}</span>`
      : `<span class="dir__name">${esc(it.name)}</span>`;
    return `<a href="${root}${it.href}">${name}<span class="dir__count" data-i18n="count.books" data-n="${it.count}">${it.count} book${it.count === 1 ? "" : "s"}</span></a>`;
  }).join("");
  return `
  <div class="page-head wrap">
    <p class="breadcrumb"><a href="${root}" data-i18n="crumb.home">Home</a><span>/</span><span data-i18n="${headKey}">${active}</span></p>
    <h1 data-i18n="${headKey}">${active}</h1>
    <p data-i18n="${introKey}" data-n="${items.length}">${items.length} ${active.toLowerCase()} across the collection.</p>
  </div>
  <section class="section--tight wrap"><div class="dir">${rows}</div></section>`;
}

writePage("authors", layout({
  title: `${SITE_NAME} - Authors`, description: `All ${authors.length} authors in the library.`,
  root: "../", active: "Authors",
  body: dirIndex("author", "Authors", "nav.authors", "idx.authors",
    authors.map((a) => ({ name: a.name, count: a.books.length, href: `author/${a.id}/` })), "../"),
}));
writePage("series", layout({
  title: `${SITE_NAME} - Series`, description: `All ${seriesList.length} series in the library.`,
  root: "../", active: "Series",
  body: dirIndex("series", "Series", "nav.series", "idx.series",
    seriesList.map((s) => ({ name: s.name, count: s.books.length, href: `series/${s.id}/` })), "../"),
}));
writePage("genres", layout({
  title: `${SITE_NAME} - Genres`, description: `All ${genres.length} genres in the library.`,
  root: "../", active: "Genres",
  body: dirIndex("genre", "Genres", "nav.genres", "idx.genres",
    genres.map((g) => ({ name: genreLabel(g.name), count: g.books.length, href: `genre/${g.id}/`, genreCode: g.name })), "../"),
}));

// ---- Read Next (client-rendered from bookmarks) --------------------
writePage("read-next", layout({
  title: `${SITE_NAME} - Read Next`,
  description: "Books you've saved to read next.",
  root: "../", active: "Read Next",
  body: `
  <div class="page-head wrap">
    <p class="breadcrumb"><a href="../" data-i18n="crumb.home">Home</a><span>/</span><span data-i18n="nav.readnext">Read Next</span></p>
    <h1 data-i18n="readnext.h1">Read next</h1>
    <p><span data-i18n="readnext.intro">Books you’ve set aside for later.</span> <span class="result-count" data-readnext-count></span></p>
  </div>
  <section class="section--tight wrap" data-readnext-full>
    <div class="grid" data-readnext-grid></div>
    <p class="empty-state" data-readnext-empty hidden data-i18n="readnext.empty">Nothing saved yet — tap the bookmark on any cover, or “Read next” on a book’s page, to build your queue.</p>
  </section>`,
}));

// ============================================================
// 9. Login page (plaintext), robots.txt, 404
// ============================================================
const pageCount = 1 + 4 + books.length + authors.length + seriesList.length + genres.length;

// -- login page (unencrypted shell that unlocks everything else) --
const loginRoot = "../";
const lockSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>`;
const loginHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${SITE_NAME} - Unlock</title>
<meta name="color-scheme" content="light">
<meta name="theme-color" content="${THEME_COLOR}">
${appleHead(loginRoot)}
<link rel="icon" href="${loginRoot}favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,340..600;1,9..144,340..600&family=Newsreader:opsz,wght@6..72,400..600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${loginRoot}assets/theme.css">
${calCfg(loginRoot)}
<script src="${loginRoot}assets/crypto.js"></script>
<script src="${loginRoot}assets/i18n.js"></script>
</head>
<body class="login-body">
<main class="login">
  ${bookMark("login__mark")}
  <h1>Cali<b>brary</b></h1>
  <p data-i18n="login.tagline">A private collection. Enter the passphrase to unlock the stacks.</p>
  <form class="login__form" id="login-form" autocomplete="on">
    <label class="login__field">
      ${lockSvg}
      <input type="password" id="pw" name="password" placeholder="Passphrase" data-i18n-ph="login.ph" aria-label="Passphrase" data-i18n-al="login.ph" autocomplete="current-password" autofocus>
    </label>
    <p class="login__error" role="alert" hidden></p>
    <button type="submit" data-i18n="login.unlock">Unlock</button>
  </form>
  <p class="login__note" data-i18n="login.note">Nothing loads until it's decrypted in your browser.</p>
  ${langSel()}
</main>
<script src="${loginRoot}assets/login.js"></script>
</body>
</html>`;
writeRaw("login", loginHtml);

// robots: keep everything out of indexes
fs.writeFileSync(path.join(OUT, "robots.txt"), `User-agent: *\nDisallow: /\n`);

// 404 — plaintext (visitors here aren't necessarily unlocked)
const notFound = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${SITE_NAME} - Not found</title>
<meta name="color-scheme" content="light">
<meta name="theme-color" content="${THEME_COLOR}">
${appleHead("/")}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,340..500&family=IBM+Plex+Mono:wght@400&display=swap">
<link rel="stylesheet" href="/assets/theme.css">
<script>window.CAL={home:"/"};</script>
<script src="/assets/i18n.js"></script>
</head>
<body class="login-body">
<main class="login">
  <p class="eyebrow">404</p>
  <h1 data-i18n-html="notfound.h1">Off the <b>shelf</b></h1>
  <p data-i18n="notfound.body">That page isn't here. It may have been re-catalogued.</p>
  <p class="login__note"><a href="/" data-i18n="notfound.back">Return to the library →</a></p>
</main>
</body>
</html>`;
writeRaw("404", notFound);
fs.copyFileSync(path.join(OUT, "404", "index.html"), path.join(OUT, "404.html"));

db.close();
console.log(`\n✓ Built ${pageCount} encrypted pages + login → dist/`);
console.log(PASSWORD === "changeme"
  ? `  ⚠ Using default password "changeme". Rebuild with LIBRARY_PASSWORD='your secret' to set your own.`
  : `  Locked with your LIBRARY_PASSWORD.`);
