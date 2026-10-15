// node --test audiobookmaker/
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  naturalSort, titleFromFilename, escapeMeta, chapterTimes, pickChapterTitles, makeAudiobook,
} from "./make-audiobook.mjs";

const ff = (args) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  assert.equal(r.status, 0, String(r.stderr));
};

test("naturalSort orders 2 before 10", () => {
  assert.deepEqual(naturalSort(["/a/10 x.mp3", "/a/2 x.mp3", "/a/1 x.mp3"]),
    ["/a/1 x.mp3", "/a/2 x.mp3", "/a/10 x.mp3"]);
});

test("titleFromFilename strips track numbers", () => {
  assert.equal(titleFromFilename("/x/03 - The Storm.mp3"), "The Storm");
  assert.equal(titleFromFilename("/x/001_Prologue.mp3"), "Prologue");
  assert.equal(titleFromFilename("/x/12.mp3"), "12");
  assert.equal(titleFromFilename("/x/0007.mp3"), "7");
  assert.equal(titleFromFilename("/x/Chapter 4.mp3"), "Chapter 4");
});

test("escapeMeta escapes ffmetadata specials", () => {
  assert.equal(escapeMeta("a=b;c#d\\e"), "a\\=b\\;c\\#d\\\\e");
});

test("chapterTimes accumulates without drift", () => {
  const t = chapterTimes(Array(1000).fill(1.0004));
  assert.equal(t[999].end, Math.round(1000 * 1.0004 * 1000));
  assert.equal(t[1].start, t[0].end);
});

test("pickChapterTitles falls back to filenames when tags repeat", () => {
  const tr = (file, title) => ({ file, tags: { title } });
  assert.deepEqual(pickChapterTitles([tr("1 A.mp3", "Book"), tr("2 B.mp3", "Book")]), ["A", "B"]);
  assert.deepEqual(pickChapterTitles([tr("1 A.mp3", "One"), tr("2 B.mp3", "Two")]), ["One", "Two"]);
  assert.deepEqual(pickChapterTitles([tr("1 A.mp3", "One"), tr("2 B.mp3", "Two")], "filenames"), ["A", "B"]);
});

test("builds a chaptered m4b with cover and audiobook tags", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abm-test-"));
  const src = path.join(dir, "My Book");
  fs.mkdirSync(src);
  const art = path.join(dir, "art.png");
  ff(["-f", "lavfi", "-i", "color=red:s=300x450", "-frames:v", "1", art]);
  const secs = [3, 2, 4];
  // deliberately out of order on disk + one 44.1k mono file to exercise resampling
  for (const [i, name] of ["10 - Third.mp3", "1 - First.mp3", "2 - Second.mp3"].entries()) {
    const extra = i === 1 ? ["-i", art, "-map", "0:a", "-map", "1:v", "-c:v", "mjpeg", "-disposition:v", "attached_pic"] : [];
    ff(["-f", "lavfi", "-i", `sine=frequency=${300 + i * 100}:duration=${secs[i]}`, ...extra,
      "-ar", i === 2 ? "44100" : "48000", "-ac", "1",
      "-metadata", "album=Tagged Title", "-metadata", "artist=Jane Author", "-metadata", "title=Same",
      "-c:a", "libmp3lame", "-b:a", "64k", path.join(src, name)]);
  }
  // cover comes from art embedded in "1 - First" (the case that once broke chapter timing)

  const out = path.join(dir, "out.m4b");
  await makeAudiobook([src], { output: out, narrator: "Nick Reader" });

  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json",
    "-show_format", "-show_streams", "-show_chapters", out], { encoding: "utf8" });
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.chapters.map((c) => c.tags.title), ["First", "Second", "Third"]);
  assert.ok(Math.abs(Number(j.chapters[1].start_time) - 2) < 0.1, `chapter 2 starts ~2s: ${j.chapters[1].start_time}`);
  assert.ok(Math.abs(Number(j.format.duration) - 9) < 0.3, `total ~9s: ${j.format.duration}`);
  assert.equal(j.format.tags.title, "Tagged Title");
  assert.equal(j.format.tags.artist, "Jane Author");
  assert.equal(j.format.tags.composer, "Nick Reader");
  assert.equal(j.format.tags.media_type, "2");
  assert.ok(j.streams.some((s) => s.codec_name === "aac"));
  assert.ok(j.streams.some((s) => s.codec_type === "video" && s.disposition.attached_pic === 1), "has cover");
  // Chapter track must share the audio timescale; a finer one overflows on long books.
  const tb = (type) => j.streams.find((s) => s.codec_type === type).time_base;
  assert.equal(tb("data"), tb("audio"));

  fs.rmSync(dir, { recursive: true, force: true });
});
