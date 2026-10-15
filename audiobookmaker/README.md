# audiobookmaker

Combine a folder of MP3s into one chaptered `.m4b` audiobook for Apple Books.

```sh
node audiobookmaker/make-audiobook.mjs "~/Downloads/Some Book"
```

- **One MP3 = one chapter**, in natural filename order (`2 …` before `10 …`).
- **Chapter names** come from the MP3 title tags when each file has its own,
  otherwise from the filename with track numbers stripped (`03 - The Storm.mp3` → `The Storm`).
- **Title / author** default to the first file's album / artist tags (falls back to the folder name).
- **Cover**: `--cover`, else `cover.jpg` / `folder.jpg` in the folder, else art embedded in the first MP3.
- Output is AAC 64k (Apple's encoder on macOS), tagged as an audiobook, written next to the input folder.

Preview the order and chapter list without encoding:

```sh
node audiobookmaker/make-audiobook.mjs "Some Book" --dry-run
```

Options: `-o out.m4b`, `--title`, `--author`, `--narrator`, `--year`, `--cover img.jpg`,
`--bitrate 96k`, `--mono`, `--chapters auto|tags|filenames`. Run with `--help` for details.

Then open the `.m4b` in Apple Books (double-click, or drag it in) and it syncs to your iPhone and iPad.

Requires `ffmpeg` (`brew install ffmpeg`). Tests: `node --test audiobookmaker/`.
