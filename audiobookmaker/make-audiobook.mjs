#!/usr/bin/env node
// ============================================================
// make-audiobook.mjs — combine a folder of MP3s into one chaptered
// .m4b audiobook that Apple Books (and most other players) understands.
//
//   node audiobookmaker/make-audiobook.mjs <folder | files...> [options]
//
// One MP3 = one chapter. Files are ordered by natural filename sort
// ("2 …" before "10 …"). Chapter names come from the MP3 title tags when
// every file has a distinct one, otherwise from the cleaned-up filename.
// Book title/author default to the first file's album/artist tags, the
// cover to its embedded art or a cover.jpg/folder.jpg beside the files.
//
// Options:
//   -o, --output <file>    output .m4b (default: "<Title>.m4b" next to the input folder)
//   --title <text>         book title
//   --author <text>        author
//   --narrator <text>      narrator (stored as composer, which Apple Books shows)
//   --year <yyyy>          release year
//   --cover <image>        cover image (jpg/png)
//   --bitrate <rate>       AAC bitrate (default 64k)
//   --mono                 downmix to mono (smaller files; fine for speech)
//   --chapters <mode>      auto | tags | filenames (default auto)
//   --dry-run              print the plan (order, chapters, metadata) and stop
//
// Requires ffmpeg + ffprobe on PATH (brew install ffmpeg).
// ============================================================
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const AUDIO_EXT = /\.mp3$/i;
const COVER_NAMES = ["cover.jpg", "cover.jpeg", "cover.png", "folder.jpg", "folder.png"];

// ---------- helpers (exported for tests) ----------

export function naturalSort(files) {
  return [...files].sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: "base" }));
}

// "03 - The Storm.mp3" -> "The Storm"; "Track 07.mp3" -> "Track 07"; "0007.mp3" -> "7"
export function titleFromFilename(file) {
  const base = path.basename(file, path.extname(file)).replace(/_/g, " ").trim();
  if (/^\d+$/.test(base)) return String(Number(base));
  const stripped = base.replace(/^\s*(?:disc\s*\d+\s*[-.]?\s*)?\d+\s*[-.)_:]*\s*/i, "").trim();
  return stripped || base;
}

// Escape a value for ffmpeg's FFMETADATA1 format.
export function escapeMeta(s) {
  return String(s).replace(/([=;#\\\n])/g, "\\$1");
}

export function buildFfmetadata(meta, chapters) {
  const lines = [";FFMETADATA1"];
  for (const [k, v] of Object.entries(meta)) if (v) lines.push(`${k}=${escapeMeta(v)}`);
  for (const ch of chapters) {
    lines.push("", "[CHAPTER]", "TIMEBASE=1/1000",
      `START=${ch.start}`, `END=${ch.end}`, `title=${escapeMeta(ch.title)}`);
  }
  return lines.join("\n") + "\n";
}

// Chapter boundaries from per-file durations (seconds). Rounds the running
// total, not each duration, so long books don't drift.
export function chapterTimes(durations) {
  let total = 0;
  return durations.map((d) => {
    const start = Math.round(total * 1000);
    total += d;
    return { start, end: Math.round(total * 1000) };
  });
}

export function pickChapterTitles(tracks, mode = "auto") {
  const fromNames = tracks.map((t) => titleFromFilename(t.file));
  if (mode === "filenames") return fromNames;
  const tags = tracks.map((t) => t.tags.title?.trim());
  const usable = tags.every(Boolean) && new Set(tags).size === tags.length;
  if (mode === "tags") return tags.map((t, i) => t || fromNames[i]);
  return usable ? tags : fromNames;
}

// ---------- ffprobe / ffmpeg ----------

function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json",
    "-show_format", "-show_streams", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}:\n${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const audio = j.streams.find((s) => s.codec_type === "audio");
  if (!audio) throw new Error(`No audio stream in ${file}`);
  const tags = Object.fromEntries(Object.entries(j.format.tags || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const duration = parseFloat(j.format.duration ?? audio.duration);
  if (!(duration > 0)) throw new Error(`Could not read duration of ${file}`);
  return {
    file, duration, tags,
    sampleRate: Number(audio.sample_rate), channels: audio.channels,
    hasArt: j.streams.some((s) => s.codec_type === "video" && s.disposition?.attached_pic),
  };
}

function pickEncoder() {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  // Apple's AudioToolbox AAC (macOS) sounds noticeably better than ffmpeg's built-in one.
  return /\baac_at\b/.test(r.stdout) ? "aac_at" : "aac";
}

function runFfmpeg(args, totalSec) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostats",
      "-progress", "pipe:1", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.stdout.on("data", (d) => {
      const m = /out_time_us=(\d+)/.exec(String(d));
      if (m && process.stdout.isTTY) {
        const pct = Math.min(100, (Number(m[1]) / 1e6 / totalSec) * 100);
        process.stdout.write(`\r  encoding… ${pct.toFixed(1)}%  `);
      }
    });
    p.on("close", (code) => {
      if (process.stdout.isTTY) process.stdout.write("\n");
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}:\n${err}`));
    });
  });
}

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// ---------- main ----------

export async function makeAudiobook(inputs, opts = {}) {
  let files = [];
  let folder;
  for (const inp of inputs) {
    if (fs.statSync(inp).isDirectory()) {
      folder ??= path.resolve(inp);
      files.push(...fs.readdirSync(inp).filter((f) => AUDIO_EXT.test(f) && !f.startsWith("."))
        .map((f) => path.join(inp, f)));
    } else files.push(inp);
  }
  files = naturalSort(files.map((f) => path.resolve(f)));
  if (!files.length) throw new Error("No .mp3 files found.");
  folder ??= path.dirname(files[0]);

  const tracks = files.map(probe);
  const first = tracks[0].tags;
  const title = opts.title || first.album || path.basename(folder);
  const author = opts.author || first.album_artist || first.artist || "";
  const titles = pickChapterTitles(tracks, opts.chapters);
  const chapters = chapterTimes(tracks.map((t) => t.duration))
    .map((c, i) => ({ ...c, title: titles[i] }));
  const totalSec = tracks.reduce((a, t) => a + t.duration, 0);

  let cover = opts.cover ? path.resolve(opts.cover) : null;
  if (!cover) {
    const found = COVER_NAMES.map((n) => path.join(folder, n)).find((p) => fs.existsSync(p));
    if (found) cover = found;
    else if (tracks[0].hasArt) cover = tracks[0].file; // pull embedded art from the first MP3
  }

  const output = path.resolve(opts.output ||
    path.join(path.dirname(folder), `${title.replace(/[\/:*?"<>|]/g, "_")}.m4b`));

  const meta = {
    title, album: title, artist: author, album_artist: author,
    composer: opts.narrator, date: opts.year || first.date, genre: "Audiobook",
    media_type: "2", // iTunes "stik" = Audiobook
  };

  console.log(`${title}${author ? ` — ${author}` : ""}`);
  console.log(`  ${tracks.length} chapters, ${fmt(totalSec * 1000)}, cover: ${cover ? path.basename(cover) : "none"}`);
  console.log(`  → ${output}`);
  for (const [i, c] of chapters.entries())
    console.log(`  ${String(i + 1).padStart(3)}. ${fmt(c.start)}  ${c.title}`);
  if (opts.dryRun) return { output, chapters, meta, cover };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-"));
  try {
    const listFile = path.join(tmp, "list.txt");
    fs.writeFileSync(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
    const metaFile = path.join(tmp, "meta.txt");
    fs.writeFileSync(metaFile, buildFfmetadata(meta, chapters));

    const channels = opts.mono ? 1 : Math.min(2, Math.max(...tracks.map((t) => t.channels)));
    const args = ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-i", metaFile];
    if (cover) args.push("-i", cover);
    args.push("-map", "0:a", "-map_metadata", "1", "-map_chapters", "1");
    if (cover) args.push("-map", "2:v:0", "-c:v", "mjpeg", "-vf", "scale='min(1400,iw)':-2",
      "-disposition:v:0", "attached_pic");
    args.push("-c:a", pickEncoder(), "-b:a", opts.bitrate || "64k",
      "-ac", String(channels), "-ar", String(tracks[0].sampleRate),
      // -f mp4, not the ipod muxer .m4b would pick: ipod rejects the cover stream.
      "-movflags", "+faststart", "-f", "mp4", output);

    await runFfmpeg(args, totalSec);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`Done: ${output}`);
  return { output, chapters, meta, cover };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" }, title: { type: "string" }, author: { type: "string" },
      narrator: { type: "string" }, year: { type: "string" }, cover: { type: "string" },
      bitrate: { type: "string" }, mono: { type: "boolean" }, chapters: { type: "string" },
      "dry-run": { type: "boolean" }, help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || !positionals.length) {
    console.log(fs.readFileSync(new URL(import.meta.url), "utf8")
      .split("\n").slice(2, 27).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(positionals.length || values.help ? 0 : 1);
  }
  if (values.chapters && !["auto", "tags", "filenames"].includes(values.chapters)) {
    console.error("--chapters must be auto, tags or filenames"); process.exit(1);
  }
  makeAudiobook(positionals, { ...values, dryRun: values["dry-run"] })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
