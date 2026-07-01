#!/bin/bash
# Double-click this file (or run ./rebuild.command) to rebuild the library.
# It reads your Calibre library and regenerates the encrypted ./dist folder.

# ┌──────────────────────────────────────────────────────────────────┐
# │  SETTINGS — edit if you move your library                         │
# └──────────────────────────────────────────────────────────────────┘
# Folder that contains metadata.db. Either a name next to this script
# (default "Calibre") or a full path, e.g.
#   CALIBRE_DIR="/Users/drew/Books/Calibre Library"
CALIBRE_DIR="/Users/drew/Files/Calibre Library"

# Mirror the finished site to a local server share after building.
# Leave empty ("") to skip. Skipped automatically if the share isn't mounted.
#   WH143 local server:
MIRROR_DEST="/Volumes/web/books"
# ────────────────────────────────────────────────────────────────────

export CALIBRE_DIR
cd "$(dirname "$0")" || exit 1

echo "═══════════════════════════════════════════"
echo "  Rebuilding Calibrary…"
echo "═══════════════════════════════════════════"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js is not installed or not on your PATH."
  echo "  Install it from https://nodejs.org and try again."
  read -n 1 -s -r -p "Press any key to close…"; echo; exit 1
fi

# Install dependencies on first run / after a git pull that added one (e.g. sharp).
if [ ! -d node_modules/sharp ]; then
  echo "Installing dependencies (first run or updated)…"
  npm install || { echo "✗ npm install failed."; read -n 1 -s -r -p "Press any key to close…"; echo; exit 1; }
fi

node build.mjs
status=$?

echo ""
if [ $status -ne 0 ]; then
  echo "✗ Build failed (see the messages above)."
  read -n 1 -s -r -p "Press any key to close…"; echo
  exit 1
fi
echo "✓ Build complete → ./dist"

# ── Mirror to local server (e.g. WH143) if reachable ─────────────────
if [ -n "$MIRROR_DEST" ]; then
  # the mount point is the first two path segments, e.g. /Volumes/web
  MIRROR_VOL="/$(printf '%s' "$MIRROR_DEST" | cut -d/ -f2-3)"
  echo ""
  if [ -d "$MIRROR_VOL" ] && [ -w "$MIRROR_VOL" ]; then
    echo "Mirroring to $MIRROR_DEST …"
    mkdir -p "$MIRROR_DEST" 2>/dev/null
    if rsync -a --delete --delete-excluded --exclude '.DS_Store' dist/ "$MIRROR_DEST/"; then
      echo "✓ Mirrored to $MIRROR_DEST"
    else
      echo "✗ Mirror failed while copying — but ./dist is fine, upload it manually."
    fi
  else
    echo "• $MIRROR_VOL isn’t mounted/writable — skipping mirror."
    echo "  Connect to the server and mount its share, then run this again."
  fi
fi

echo ""
echo "Done."
read -n 1 -s -r -p "Press any key to close…"; echo
