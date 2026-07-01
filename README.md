# Calibrary

A static-site generator that turns a [Calibre](https://calibre-ebook.com/) e-book
library into a private, **password-protected** book-browsing website — a
book-themed "reading room" you can host anywhere and open on any device.

It reads your Calibre `metadata.db` (plus the covers and book files on disk) and
outputs a folder of static HTML you can upload to any host or FTP server. No
backend, no database at runtime.

## Features

- **Browse** by title, author, series, or genre, with cover-first grids.
- **Live search** by book title or author (as-you-type dropdown).
- **Read in the browser** (EPUB reader) or **download** the book file.
- **Read Next** — bookmark books into a personal reading queue (kept per browser).
- **Bilingual interface** — English / Russian toggle; book content is left as-is.
- **Light, book-themed design** that works down to mobile.

## Password protection (private by design)

The whole site is **AES-256-GCM encrypted at rest** — every page, cover, and book
file is stored as ciphertext (`.enc`). Browsing starts at a **login page**; your
passphrase derives the decryption key (PBKDF2) in the browser, and nothing is
readable without it. It also ships `noindex` / `robots: Disallow` so search
engines skip it.

Because it's real client-side encryption, it works on **any static host** — no
server config (`.htaccess`, etc.) required. On plain HTTP (e.g. a LAN server or
iOS Safari, where Web Crypto is unavailable) it automatically falls back to a
pure-JS crypto implementation.

**Set your passphrase** in a git-ignored file at the project root:

```
echo 'your secret passphrase' > library-password.txt
```

(or pass `LIBRARY_PASSWORD='…'` as an environment variable at build time).

> Note: each build uses a fresh random salt, so after you upload a new build,
> everyone is asked to log in once more. This is a personal-library lock — strong
> enough to keep the collection private, not a bank vault.

## Requirements

- **Node.js 22+** (uses the built-in `node:sqlite` — no database driver needed).
- `npm install` once, to fetch the reader/crypto libraries (`epubjs`, `jszip`,
  `node-forge`).

## Usage

1. Put your Calibre library in a folder named **`Calibre`** next to `build.mjs`
   (it must contain `metadata.db` and the book folders), **or** point to it
   elsewhere — see [Custom Calibre library path](#custom-calibre-library-path).
2. Set your passphrase (see above).
3. Build:

```bash
npm install        # first time only
npm run build      # → writes ./dist
```

4. Upload the **`dist/`** folder to your host / FTP. Done.

### One-click rebuild (macOS)

Double-click **`rebuild.command`** in Finder (or run `./rebuild.command`). It
rebuilds `dist/`, and — if configured — mirrors the result to a local server
share. Editable settings live at the top of the file:

```sh
CALIBRE_DIR="Calibre"                 # source library (folder name or full path)
MIRROR_DEST="/Volumes/web/books"      # copy dist/ here after building ("" to skip)
```

### Custom Calibre library path

If your library lives somewhere other than `./Calibre`, set **`CALIBRE_DIR`** —
either edit the line in `rebuild.command`, or pass it as an environment variable.
It accepts a folder name next to the script **or** an absolute path:

```bash
CALIBRE_DIR="/Users/you/Books/Calibre Library" node build.mjs
```

The build prints `Source: …` so you can confirm which library it read.

## What's committed (and what isn't)

The repo contains only the generator and its source. **Your library, the built
site, and your passphrase are git-ignored** — no book files, covers, encrypted
output, or secrets are ever committed (`Calibre/`, `dist/`, `*.enc`, book/cover
files, and `library-password.txt`).

## How it works

- `build.mjs` reads `metadata.db`, copies + encrypts covers and book files, and
  renders every page as a tiny encrypted "shell". On load, the shell decrypts its
  payload in the browser and renders the real page.
- Translations are plain JSON in `src/i18n/`; the UI applies them client-side.
- Bookmarks and language choice are stored in `localStorage`.

## Tech

`node:sqlite` · [epub.js](https://github.com/futurepress/epub.js) · JSZip ·
[node-forge](https://github.com/digitalbazaar/forge) · vanilla JS + CSS.
