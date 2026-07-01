# Library bookkeeping

The [Calibre library](/Users/drew/Files/Calibre%20Library) (`metadata.db`) is the single source of truth for the calibrary web app. These are the standing rules for keeping it clean, plus the vetted data sources to use when verifying book info. This file is committed so it syncs across devices via GitHub.

## The bookkeeper's rules

1. **Book info must be correct.** Verify title, author, and especially **series name + reading-order index** for every book. Fix missing series and wrong series/index.
2. **No duplicates.** One record per title. When copies differ by format, keep the record with the richer real formats (a distinct `.fb2`/`.epub` beats Calibre's redundant `.original_epub` backup) and remove the rest.
3. **Good covers.** Every book should have a present, sharp, reasonably large cover.

### Series: real cycles vs. publisher labels

Only tag a book with a **series** if it belongs to a genuine numbered story cycle. Do **not** use publisher/imprint marketing collections as series — leave those books with no series. Known non-series labels seen in this library:

- Zotov: «Невероятный Zотов», «Бестселлеры Zотова», «Zотов®»
- Stephen King (AST): «Тёмная Башня», «Темная башня [АСТ]», «Король на все времена» — these are cover imprints, **not** the real Dark Tower saga. Most King novels here are standalone.

## Vetted data sources

Check these in order; cross-check reading order between at least two for anything ambiguous.

- **Fantlab** — <https://fantlab.ru> — best for SF/F cycles and reading order; author pages list every цикл with numbering. Primary for Tarmashev, Zotov, Lukyanenko, Nikitin, and King/Dan Brown translations.
- **LitRes** — <https://litres.ru> — Russian ebook store; lists циклы and confirms the series name as actually sold in Russian.
- **LiveLib** — <https://livelib.ru> — `/author/<id>/series-<slug>` groups an author's books by cycle.
- **Labirint** — <https://labirint.ru> — print editions and boxed sets, often labelled "Цикл X. Книга N".
- **Author official sites** — e.g. Tarmashev's canonical chronology at <https://www.tarmashev.com/books_timeline.php>.
- **Wikipedia (en/ru)** — reading order for Western authors (King, Dan Brown, Ann Cleeves).

## Safe editing workflow

Edit through `calibredb` (not raw SQL) so Calibre sees the changes cleanly.

```sh
export PATH="/Applications/calibre.app/Contents/MacOS:$PATH"   # CLI lives inside the app bundle
LIB="/Users/drew/Files/Calibre Library"
cdb(){ calibredb --with-library "$LIB" "$@"; }

# before editing
pgrep -x calibre && echo "close Calibre first"        # never edit while the app is open
cp -p "$LIB/metadata.db" "$LIB/metadata.db.backup-$(date +%Y%m%d)"

# set / fix a series
cdb set_metadata --field series:"Роберт Лэнгдон" --field series_index:3 <id>
# clear a wrong series
cdb set_metadata --field series:"" <id>
# remove a duplicate (deletes the files too — back up the folder first)
cp -Rp "$LIB/<Author>/<Book (id)>" "$LIB/.metadata-fix-backup-$(date +%Y%m%d)/"
cdb remove <id>
```

Read-only inspection with `sqlite3 "$LIB/metadata.db"` is fine. Relevant tables: `books`, `authors` + `books_authors_link`, `series` + `books_series_link`, and `books.series_index`.

## Change log

- **2026-07-01** — First pass. Dan Brown → «Роберт Лэнгдон» order fixed (Утраченный символ #3 added, Код да Винчи 1→2). Zotov: built «Ад и рай» (4), «Каледин и Алиса» (3), «Конец света» (3) cycles; stripped marketing-collection tags. Tarmashev: moved «Предыстория. Книга первая» to «Древний. Предыстория» #1 (resolved index-1 collision). King: stripped 5 fake publisher-series tags (all standalone). Removed 2 duplicate records (Вычеркнутые из жизни, Жажда власти). 130 → 128 books.
