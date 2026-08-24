// ============================================================
// make-demo-library.mjs — build a throwaway Calibre library of
// invented books, for promo screenshots without exposing the real one.
//
//   node make-demo-library.mjs
//
// Writes a Calibre-compatible metadata.db + per-book folders (each with a
// generated cover.jpg + placeholder .epub) into ./demo/library. Then feed it
// to the real, unmodified build:
//
//   CALIBRE_DIR="$(pwd)/demo/library" OUT_DIR=demo/dist LIBRARY_PASSWORD=demo \
//     node build.mjs
//
// The demo site lands in ./demo/dist and unlocks with the passphrase "demo".
// The real Calibre library, dist/, and password file are never touched.
// ============================================================
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(__dir, "demo", "library");

// ------------------------------------------------------------
// The invented catalogue. All titles, authors, and blurbs are fictional.
// series: [name, index]; the first genre drives the cover palette.
// added: days-ago (drives "Recently shelved" order). isbn is clearly synthetic.
// ------------------------------------------------------------
const AUTHORS = {
  feldspar: { name: "Marta Feldspar",   sort: "Feldspar, Marta" },
  devaney:  { name: "Colm Devaney",     sort: "Devaney, Colm" },
  oyelaran: { name: "Nadia Oyelaran",   sort: "Oyelaran, Nadia" },
  thorn:    { name: "Elias Thorn",      sort: "Thorn, Elias" },
  marsh:    { name: "Josephine Marsh",  sort: "Marsh, Josephine" },
  aday:     { name: "Rowan Aday",       sort: "Aday, Rowan" },
  halloran: { name: "Ines Halloran",    sort: "Halloran, Ines" },
  pyne:     { name: "Gregor Pyne",      sort: "Pyne, Gregor" },
  kline:    { name: "Deborah Kline",    sort: "Kline, Deborah" },
  ellery:   { name: "Beau Ellery",      sort: "Ellery, Beau" },
  nathan:   { name: "Priya Nathan",     sort: "Nathan, Priya" },
  reeve:    { name: "Thomas Reeve",     sort: "Reeve, Thomas" },
};

const BOOKS = [
  // — The Aldergrove Chronicles (fantasy trilogy) —
  { title: "The Hollow Crown of Aldergrove", author: "feldspar", series: ["The Aldergrove Chronicles", 1],
    genres: ["Fantasy", "Adventure"], year: 2018, added: 40, isbn: "978-1-9000-0001-2",
    blurb: "When the border wards fail on midwinter's night, a hedge-witch's apprentice inherits a crown no living king dared wear. The first of the Aldergrove Chronicles." },
  { title: "Ashes of the Rookery", author: "feldspar", series: ["The Aldergrove Chronicles", 2],
    genres: ["Fantasy", "Adventure"], year: 2019, added: 33, isbn: "978-1-9000-0002-9",
    blurb: "The rookery towers have burned, and with them the only maps to the old roads. Aldergrove's reluctant queen must trade a kingdom for a rumour." },
  { title: "The Last Cartographer", author: "feldspar", series: ["The Aldergrove Chronicles", 3],
    genres: ["Fantasy", "Adventure"], year: 2021, added: 22, isbn: "978-1-9000-0003-6",
    blurb: "Every map ends somewhere. The concluding volume of the Aldergrove Chronicles follows the woman who drew the edge of the world." },

  // — Inspector Vale Mysteries —
  { title: "The Blackfriars Ledger", author: "devaney", series: ["Inspector Vale Mysteries", 1],
    genres: ["Mystery", "Crime"], year: 2015, added: 58, isbn: "978-1-9000-0011-1",
    blurb: "A drowned clerk, a ledger with three pages torn out, and a fog that won't lift off the Thames. Inspector Vale's first case." },
  { title: "A Quiet House in Pimlico", author: "devaney", series: ["Inspector Vale Mysteries", 2],
    genres: ["Mystery", "Crime"], year: 2017, added: 47, isbn: "978-1-9000-0012-8",
    blurb: "The neighbours heard nothing — which is exactly what troubles Vale about the quiet house on Cambridge Street." },
  { title: "The Saltmarsh Inheritance", author: "devaney", series: ["Inspector Vale Mysteries", 3],
    genres: ["Mystery", "Crime"], year: 2020, added: 18, isbn: "978-1-9000-0013-5",
    blurb: "An estate on the tidal flats, a will that changes with the moon, and a family that would rather drown than divide. Vale goes to the coast." },

  // — The Kepler Cycle (sci-fi) —
  { title: "Signal to the Drowned Stars", author: "oyelaran", series: ["The Kepler Cycle", 1],
    genres: ["Science Fiction"], year: 2016, added: 52, isbn: "978-1-9000-0021-0",
    blurb: "A dead colony keeps broadcasting. The salvage crew sent to switch it off finds the signal has been waiting for them by name." },
  { title: "The Vantage Protocol", author: "oyelaran", series: ["The Kepler Cycle", 2],
    genres: ["Science Fiction", "Thriller"], year: 2019, added: 27, isbn: "978-1-9000-0022-7",
    blurb: "To read the future you must agree never to change it. The second Kepler Cycle novel asks what a promise is worth at lightspeed." },

  // — Standalones —
  { title: "Bread, Salt, and Time", author: "thorn",
    genres: ["Cooking"], year: 2022, added: 8, isbn: "978-1-9000-0031-9",
    blurb: "A slow-baker's field guide to sourdough, patience, and the small chemistry of a warm kitchen — with fifty foolproof loaves." },
  { title: "The Cartwright Letters", author: "marsh",
    genres: ["Historical Fiction", "Literary Fiction"], year: 2014, added: 63, isbn: "978-1-9000-0041-8",
    blurb: "Two sisters, one shared correspondent, and forty years of letters that never quite say the thing. A novel of the long Edwardian summer." },
  { title: "Tide Tables", author: "aday",
    genres: ["Poetry"], year: 2020, added: 30, isbn: "978-1-9000-0051-7",
    blurb: "Poems measured against the sea — arrivals, departures, and the hours between. A slim, salt-worn debut collection." },
  { title: "The Glassblower's Daughter", author: "halloran",
    genres: ["Historical Fiction", "Romance"], year: 2013, added: 70, isbn: "978-1-9000-0061-6",
    blurb: "In a Murano workshop between the wars, an apprentice learns that some things are only beautiful while they're still too hot to hold." },
  { title: "Midnight at the Empire", author: "pyne",
    genres: ["Thriller"], year: 2019, added: 25, isbn: "978-1-9000-0071-5",
    blurb: "A washed-up projectionist, a reel that shouldn't exist, and ninety minutes to get it out of the building alive." },
  { title: "What the River Keeps", author: "feldspar",
    genres: ["Literary Fiction"], year: 2016, added: 44, isbn: "978-1-9000-0081-4",
    blurb: "A drought lowers the reservoir and raises the drowned village beneath it — and everything the valley agreed to forget." },
  { title: "A Short History of Almost Leaving", author: "kline",
    genres: ["Biography", "Literary Fiction"], year: 2021, added: 12, isbn: "978-1-9000-0091-3",
    blurb: "A memoir in departures: every train not taken, every door held open a beat too long. Wry, exact, and quietly devastating." },
  { title: "The Weight of Small Rooms", author: "devaney",
    genres: ["Literary Fiction"], year: 2012, added: 66, isbn: "978-1-9000-0101-9",
    blurb: "Before the inspector, the man. A tenement childhood told room by room — the writer's only work outside the Vale novels." },
  { title: "Foxfire County", author: "ellery",
    genres: ["Young Adult", "Fantasy"], year: 2022, added: 5, isbn: "978-1-9000-0111-8",
    blurb: "The woods behind the county line glow on the nights someone's about to leave for good. Sixteen-year-old Wren means to find out why." },
  { title: "The Undertow", author: "nathan",
    genres: ["Horror", "Thriller"], year: 2018, added: 37, isbn: "978-1-9000-0121-7",
    blurb: "The tide brings the same swimmer back to shore every morning. The town has learned not to count them. A novel of the drowned coast." },
  { title: "The Vinegar Wars", author: "reeve",
    genres: ["History"], year: 2017, added: 55, isbn: "978-1-9000-0131-6",
    blurb: "How a condiment bankrupted three empires. A brisk, footnote-rich history of the trade routes that ran on sour wine." },
];

// ------------------------------------------------------------
// Cover art — invented typographic covers rendered to 800×1200 JPEG.
// Colour is built per-book in HSL: a genre anchors the hue, then a
// deterministic per-book (per-series for sets) jitter spreads hues across the
// wheel so every cover has its own vivid background. Series-mates keep the hue
// and step lightness by volume — a matched set in graded shades. Four rotating
// templates give layout variety on top.
// ------------------------------------------------------------
const GENRE_HUE = {
  Fantasy: { h: 158, s: 46, l: 36 },          Adventure: { h: 178, s: 44, l: 36 },
  Mystery: { h: 210, s: 48, l: 36 },          Crime: { h: 232, s: 46, l: 37 },
  "Science Fiction": { h: 256, s: 46, l: 38 }, "Young Adult": { h: 282, s: 46, l: 40 },
  Poetry: { h: 306, s: 40, l: 40 },           Romance: { h: 340, s: 50, l: 42 },
  Horror: { h: 354, s: 30, l: 14 },           Thriller: { h: 10, s: 54, l: 38 },
  Cooking: { h: 24, s: 58, l: 42 },           "Historical Fiction": { h: 38, s: 52, l: 40 },
  History: { h: 50, s: 50, l: 40 },           Biography: { h: 128, s: 40, l: 34 },
  "Literary Fiction": { h: 96, s: 34, l: 36 },
};
const DEFAULT_HUE = { h: 210, s: 44, l: 37 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

// HSL (h 0-360, s/l 0-100) → #rrggbb.
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

// Full per-book palette derived from the genre hue + jitter.
function paletteFor(b) {
  const base = GENRE_HUE[b.genres[0]] || DEFAULT_HUE;
  const h = (((base.h + (hash(b.series ? b.series[0] : b.title) % 33) - 16) % 360) + 360) % 360;
  const lj = b.series ? (b.series[1] - 2) * 4 : (hash(b.title) % 13) - 6;
  const l = clamp(base.l + lj, base.l < 20 ? 10 : 25, 50);
  const s = base.s;
  return {
    bg: hslToHex(h, s, l),                          // saturated field
    deep: hslToHex(h, s, clamp(l - 9, 8, 100)),     // darker field (Minimal)
    paper: hslToHex(h, 30, 93),                     // light hued near-white text
    accent: hslToHex(h, clamp(s + 22, 0, 88), 66),  // brighter rule / tag
    bandLight: hslToHex(h, clamp(s - 26, 14, 100), 86), // light band (Split)
    inkDark: hslToHex(h, clamp(s + 6, 0, 60), 22),  // dark text on the light band
  };
}
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Greedy word-wrap; picks the largest font size that keeps the title within
// maxLines given an approximate glyph advance.
function fitTitle(title, { maxWidth, maxFont, minFont, maxLines, advance = 0.53 }) {
  const words = title.split(/\s+/);
  for (let fs = maxFont; fs >= minFont; fs -= 4) {
    const cpl = Math.max(6, Math.floor(maxWidth / (fs * advance)));
    const lines = [];
    let line = "";
    for (const w of words) {
      const next = line ? line + " " + w : w;
      if (next.length > cpl && line) { lines.push(line); line = w; }
      else line = next;
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines) return { fs, lines };
  }
  // Smallest size: wrap and accept overflow.
  const cpl = Math.max(6, Math.floor(maxWidth / (minFont * advance)));
  const lines = []; let line = "";
  for (const w of words) {
    const next = line ? line + " " + w : w;
    if (next.length > cpl && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return { fs: minFont, lines };
}

const SERIF = "Georgia, 'Palatino Linotype', 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const W = 800, H = 1200;

function tspans(lines, x, y, lh) {
  return lines.map((l, i) => `<tspan x="${x}" y="${y + i * lh}">${xml(l)}</tspan>`).join("");
}
const caps = (s) => xml(s.toUpperCase());

// Four templates, each returns full SVG markup.
function tplClassic(b, p) {                       // framed, colour field, centered serif
  const { fs, lines } = fitTitle(b.title, { maxWidth: 600, maxFont: 78, minFont: 40, maxLines: 4 });
  const lh = fs * 1.08;
  const blockH = lines.length * lh;
  const y0 = 470 - blockH / 2 + fs * 0.8;
  return `
    <rect width="${W}" height="${H}" fill="${p.bg}"/>
    <rect x="46" y="46" width="${W - 92}" height="${H - 92}" fill="none" stroke="${p.paper}" stroke-width="2" opacity="0.5"/>
    <rect x="62" y="62" width="${W - 124}" height="${H - 124}" fill="none" stroke="${p.paper}" stroke-width="1" opacity="0.35"/>
    <text x="${W / 2}" y="200" text-anchor="middle" font-family="${SANS}" font-size="26" letter-spacing="6" fill="${p.paper}" opacity="0.85">${caps(b.authorName)}</text>
    <line x1="300" y1="250" x2="500" y2="250" stroke="${p.accent}" stroke-width="2"/>
    <text text-anchor="middle" font-family="${SERIF}" font-weight="600" font-size="${fs}" fill="${p.paper}">${tspans(lines, W / 2, y0, lh)}</text>
    <circle cx="${W / 2}" cy="${Math.max(y0 + blockH + 60, 760)}" r="7" fill="none" stroke="${p.accent}" stroke-width="2"/>
    ${b.seriesTag ? `<text x="${W / 2}" y="1080" text-anchor="middle" font-family="${SANS}" font-size="22" letter-spacing="3" fill="${p.paper}" opacity="0.7">${caps(b.seriesTag)}</text>` : ""}
  `;
}
function tplBlock(b, p) {                          // saturated full-bleed, bold sans, lower-left
  const { fs, lines } = fitTitle(b.title, { maxWidth: 660, maxFont: 96, minFont: 46, maxLines: 4, advance: 0.56 });
  const lh = fs * 1.02;
  const y0 = 1010 - (lines.length - 1) * lh;
  return `
    <rect width="${W}" height="${H}" fill="${p.bg}"/>
    <text x="70" y="150" font-family="${SANS}" font-size="26" letter-spacing="5" fill="${p.paper}" opacity="0.85">${caps(b.authorName)}</text>
    <rect x="70" y="185" width="120" height="6" fill="${p.accent}"/>
    <text x="70" text-anchor="start" font-family="${SANS}" font-weight="700" font-size="${fs}" fill="${p.paper}">${tspans(lines, 70, y0, lh)}</text>
    ${b.seriesTag ? `<text x="70" y="1120" font-family="${SANS}" font-size="22" letter-spacing="3" fill="${p.accent}">${caps(b.seriesTag)}</text>` : ""}
  `;
}
function tplSplit(b, p) {                          // two-tone split, title straddles the seam
  const seam = 660;
  const { fs, lines } = fitTitle(b.title, { maxWidth: 620, maxFont: 76, minFont: 40, maxLines: 4 });
  const lh = fs * 1.06;
  return `
    <rect width="${W}" height="${seam}" fill="${p.bg}"/>
    <rect y="${seam}" width="${W}" height="${H - seam}" fill="${p.bandLight}"/>
    <rect y="${seam - 4}" width="${W}" height="8" fill="${p.accent}"/>
    <text x="${W / 2}" y="150" text-anchor="middle" font-family="${SANS}" font-size="26" letter-spacing="5" fill="${p.paper}" opacity="0.9">${caps(b.authorName)}</text>
    <text x="${W / 2}" text-anchor="middle" font-family="${SERIF}" font-weight="600" font-size="${fs}" fill="${p.inkDark}">${tspans(lines, W / 2, seam + 110, lh)}</text>
    ${b.seriesTag ? `<text x="${W / 2}" y="1120" text-anchor="middle" font-family="${SANS}" font-size="22" letter-spacing="3" fill="${p.inkDark}" opacity="0.7">${caps(b.seriesTag)}</text>` : ""}
  `;
}
function tplMinimal(b, p) {                        // deep field, centered italic serif, airy
  const { fs, lines } = fitTitle(b.title, { maxWidth: 600, maxFont: 82, minFont: 42, maxLines: 4 });
  const lh = fs * 1.12;
  const blockH = lines.length * lh;
  const y0 = 560 - blockH / 2 + fs * 0.8;
  return `
    <rect width="${W}" height="${H}" fill="${p.deep}"/>
    <text text-anchor="middle" font-family="${SERIF}" font-style="italic" font-weight="500" font-size="${fs}" fill="${p.paper}">${tspans(lines, W / 2, y0, lh)}</text>
    <line x1="330" y1="${y0 + blockH + 40}" x2="470" y2="${y0 + blockH + 40}" stroke="${p.accent}" stroke-width="2"/>
    <text x="${W / 2}" y="${y0 + blockH + 100}" text-anchor="middle" font-family="${SANS}" font-size="26" letter-spacing="6" fill="${p.accent}">${caps(b.authorName)}</text>
    ${b.seriesTag ? `<text x="${W / 2}" y="1110" text-anchor="middle" font-family="${SANS}" font-size="22" letter-spacing="3" fill="${p.paper}" opacity="0.55">${caps(b.seriesTag)}</text>` : ""}
  `;
}
const TEMPLATES = [tplClassic, tplBlock, tplSplit, tplMinimal];

async function renderCover(b) {
  const p = paletteFor(b);
  // Series-mates share a template; standalones vary by title.
  const key = b.series ? b.series[0] : b.title;
  const tpl = TEMPLATES[hash(key) % TEMPLATES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${tpl(b, p)}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

// A tiny placeholder EPUB so the Download button + "Formats: EPUB" row render.
// Not a real book — screenshots never open it.
const PLACEHOLDER_EPUB = Buffer.from(
  "Calibrary demo placeholder — this is a synthetic file for screenshots, not a real book.\n"
);

const sortTitle = (t) => t.replace(/^(the|a|an)\s+/i, "");

// ------------------------------------------------------------
// Build the library on disk.
// ------------------------------------------------------------
async function main() {
  fs.rmSync(LIB, { recursive: true, force: true });
  fs.mkdirSync(LIB, { recursive: true });

  const db = new DatabaseSync(path.join(LIB, "metadata.db"));
  db.exec(`
    CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, sort TEXT, pubdate TEXT,
      timestamp TEXT, series_index REAL, path TEXT, has_cover INTEGER);
    CREATE TABLE comments (book INTEGER, text TEXT);
    CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT, sort TEXT);
    CREATE TABLE books_authors_link (book INTEGER, author INTEGER);
    CREATE TABLE series (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE books_series_link (book INTEGER, series INTEGER);
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE books_tags_link (book INTEGER, tag INTEGER);
    CREATE TABLE languages (id INTEGER PRIMARY KEY, lang_code TEXT);
    CREATE TABLE books_languages_link (book INTEGER, lang_code INTEGER);
    CREATE TABLE identifiers (book INTEGER, type TEXT, val TEXT);
    CREATE TABLE data (book INTEGER, format TEXT, name TEXT);
  `);

  // authors
  const authorId = {};
  let aid = 1;
  for (const key of Object.keys(AUTHORS)) {
    authorId[key] = aid;
    db.prepare("INSERT INTO authors (id, name, sort) VALUES (?, ?, ?)").run(aid, AUTHORS[key].name, AUTHORS[key].sort);
    aid++;
  }

  // series + tags interned on first use
  const seriesId = {}; let sid = 1;
  const tagId = {}; let tid = 1;
  const internSeries = (n) => (seriesId[n] ??= (db.prepare("INSERT INTO series (id, name) VALUES (?, ?)").run(sid, n), sid++));
  const internTag = (n) => (tagId[n] ??= (db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(tid, n), tid++));

  // one English language row
  db.prepare("INSERT INTO languages (id, lang_code) VALUES (1, 'eng')").run();

  const now = Date.now();
  const insBook = db.prepare(`INSERT INTO books
    (id, title, sort, pubdate, timestamp, series_index, path, has_cover)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)`);
  const insComment = db.prepare("INSERT INTO comments (book, text) VALUES (?, ?)");
  const insBAL = db.prepare("INSERT INTO books_authors_link (book, author) VALUES (?, ?)");
  const insBSL = db.prepare("INSERT INTO books_series_link (book, series) VALUES (?, ?)");
  const insBTL = db.prepare("INSERT INTO books_tags_link (book, tag) VALUES (?, ?)");
  const insBLL = db.prepare("INSERT INTO books_languages_link (book, lang_code) VALUES (?, 1)");
  const insId = db.prepare("INSERT INTO identifiers (book, type, val) VALUES (?, 'isbn', ?)");
  const insData = db.prepare("INSERT INTO data (book, format, name) VALUES (?, 'EPUB', 'book')");

  let bid = 1, coverCount = 0;
  for (const b of BOOKS) {
    const relPath = `book-${bid}`;
    const dir = path.join(LIB, relPath);
    fs.mkdirSync(dir, { recursive: true });

    const pubdate = `${b.year}-01-01T00:00:00+00:00`;
    const timestamp = new Date(now - b.added * 86400000).toISOString();
    const seriesIdx = b.series ? b.series[1] : 1.0;
    insBook.run(bid, b.title, sortTitle(b.title), pubdate, timestamp, seriesIdx, relPath);
    if (b.blurb) insComment.run(bid, `<p>${xml(b.blurb)}</p>`);
    insBAL.run(bid, authorId[b.author]);
    if (b.series) insBSL.run(bid, internSeries(b.series[0]));
    for (const g of b.genres) insBTL.run(bid, internTag(g));
    insBLL.run(bid);
    if (b.isbn) insId.run(bid, b.isbn);
    insData.run(bid);

    // cover + placeholder file
    const meta = { ...b, authorName: AUTHORS[b.author].name, seriesTag: b.series ? `${b.series[0]} · Book ${b.series[1]}` : "" };
    fs.writeFileSync(path.join(dir, "cover.jpg"), await renderCover(meta));
    fs.writeFileSync(path.join(dir, "book.epub"), PLACEHOLDER_EPUB);
    coverCount++;
    bid++;
  }

  db.close();
  console.log(`✓ Demo library → ${path.relative(__dir, LIB)}`);
  console.log(`  ${BOOKS.length} books · ${Object.keys(AUTHORS).length} authors · ${sid - 1} series · ${tid - 1} genres · ${coverCount} covers`);
  console.log(`\nBuild the demo site with:`);
  console.log(`  CALIBRE_DIR="${LIB}" OUT_DIR=demo/dist LIBRARY_PASSWORD=demo node build.mjs`);
}

main().catch((e) => { console.error(e); process.exit(1); });
