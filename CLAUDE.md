# calibrary

Static web reader over a Calibre library. Build with `build.mjs`; output in `dist/`.

## Library maintenance

The Calibre library at `/Users/drew/Files/Calibre Library` (`metadata.db`) is the source of truth for the app's book data. Before touching book metadata, read **[BOOKKEEPING.md](./BOOKKEEPING.md)** — it holds the bookkeeper's rules (correct info, no duplicates, good covers), the vetted data sources for verifying series info (Fantlab, LitRes, LiveLib, Labirint, author sites, Wikipedia), and the safe `calibredb` editing workflow. Keep that file up to date as the library evolves.
