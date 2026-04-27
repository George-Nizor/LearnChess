# LearnChess — Opening-Data Sources & Pipeline Brief

**Compiled:** 2026-04-26
**Purpose:** Pick a data source + tooling pipeline to build a deep, frequency-weighted opening tree (the kind that powers Lichess's Opening Explorer / chessreps), now that the live `explorer.lichess.ovh` API requires auth (R3 in `stack.md`).
**Owns:** `scripts/build-openings.ts`, `public/openings.db`, the opening-tree REST surface for our app.
**Does not own:** Puzzle DB (see `puzzle-db.md`), engine integration (see `stack.md`).

---

## 1. TL;DR + Recommended Pipeline

**Use the [Lichess Elite Database](https://database.nikonoel.fr/) (~600 MB compressed, 3.8 M games, players 2500+ vs 2300+) as the primary source, fed through a Node `pgn-extract` + `chess.js` Zobrist pipeline into SQLite.**

| Stage | Tool | Input | Output | Wall time (M2-class laptop) |
|---|---|---|---|---|
| 1. Download | `curl` / `node:https` | nikonoel.fr month bundles | `.cache/elite-*.pgn.zst` (~600 MB) | 5–10 min on home Wi-Fi |
| 2. Decompress + filter | `zstd -dc \| pgn-extract -lhead -tag` | PGN stream | filtered PGN to stdout | ~2 min, single core |
| 3. Tally positions | Node `worker_threads` + `chess.js` `getPositionHash()` | PGN stream | per-Zobrist-key {white,draw,black,nMoves} maps | 10–20 min |
| 4. Persist | `better-sqlite3` (already in stack) | tally maps | `public/openings.db` | 2–3 min |
| 5. Annotate | `lichess-org/chess-openings` TSVs | EPD lookup table | `eco`, `name` columns on each node | <30 s (3,546 rows) |

**Estimated final DB size:** **80–250 MB SQLite** depending on the cutoff — see §3 sizing math.
**Estimated total build time, cold:** **~30–45 min** end-to-end on a typical dev laptop, single run.
**Depth:** every position reached by ≥5 Elite-DB games — comfortably 20+ ply on mainlines, 8–12 ply on sidelines. This matches chessreps-quality.

We rejected (a) running `lila-openingexplorer` locally because importing the full 2 TB Lichess monthly stack takes days even on SSD, and (b) using a pre-built Polyglot `.bin` because moves are quantised to 2-byte indices with no side info (no win%/draw%/game count), which kills the "show me the win rate from this position" UX.

---

## 2. Catalog of Data Sources

### 2.1 Lichess Elite Database — `https://database.nikonoel.fr/` *(recommended)*
- **Maintainer:** Niko Noel, hand-curated monthly extraction from the public Lichess dumps.
- **Filter:** standard chess, players **2500+ vs 2300+** (from Dec 2021 onward — was 2400/2200 before), bullet excluded.
- **Bundle size:** ~600 MB **compressed** (PGN, **not** zst — typically `.zip` per month; the original cumulative torrent was 3.6 GB across 2013–May 2020). A single recent month is ~80–150 MB compressed / ~500 K games.
- **Cumulative game count:** ~3.8 M games (Dec 2021 cumulative); current rolling total higher.
- **Update cadence:** monthly, usually within 2 weeks of the upstream Lichess monthly dump.
- **Format:** PGN with full Lichess headers (`[Event] [Site] [White] [Black] [Result] [WhiteElo] [BlackElo] [TimeControl] [Termination] [ECO]`). Move list includes `%clk` clock comments.
- **License:** CC0 (inherits from Lichess source data).
- **Why this one:** quality > quantity. 3.8 M elite games is more than enough to reach depth 20 on every reasonable opening, while staying ≤1 GB on disk. Avoids the 2 TB rabbit hole of the full Lichess dump, and avoids polluting frequencies with 1200-rated blunders.
- **Source:** [database.nikonoel.fr](https://database.nikonoel.fr/), [Lichess Elite team page](https://lichess.org/team/lichess-elite-database).

### 2.2 Lichess Monthly Standard Dumps — `https://database.lichess.org/`
- **URL pattern:** `https://database.lichess.org/standard/lichess_db_standard_rated_YYYY-MM.pgn.zst`
- **Most recent verified files (2026-04-26):** `2026-03`, `2026-02`, `2026-01`, `2025-12`, `2025-11` (file index in `https://database.lichess.org/standard/list.txt`).
- **Single-month size:** ~20–28 GB compressed each (2024+), ~5x that uncompressed. Recent months reportedly ~27.6 GB compressed and >100 M games.
- **Cumulative archive:** ~7.68 B games, **~2 TB compressed total**, ~10 TB uncompressed.
- **Format:** standard PGN inside `.pgn.zst`. SHA256 checksums and `list.txt` provided.
- **License:** CC0.
- **Trade-offs:** A single recent month already contains every opening you'd care about reaching depth 20+ — you don't need the full 2 TB. With `zstd -dc | pgn-extract` streaming you can process one month in under an hour on a laptop and never need >32 GB RAM. **However**, no rating filter means depth-20 frequencies on sidelines are dominated by 1300-rated misplays, which is the wrong signal for an opening trainer. This is exactly the problem the Elite DB solves.
- **Source:** [database.lichess.org](https://database.lichess.org/).

### 2.3 `lichess-org/chess-openings` TSVs *(complement, not source)*
- **Repo:** [github.com/lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
- **Hugging Face mirror (Parquet):** [huggingface.co/datasets/Lichess/chess-openings](https://huggingface.co/datasets/Lichess/chess-openings)
- **Total openings:** **3,546** named openings, split across `a.tsv` … `e.tsv` by ECO volume.
- **Columns:** `eco`, `name`, `pgn`, `uci`, `epd` (tab-separated).
- **Example row (illustrative):** `B90  Sicilian Defense: Najdorf Variation  1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd6 Nf6 5. Nc3 a6  e2e4 c7c5 …  rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq -`
- **License:** CC0.
- **What's missing for our purpose:** This is a **flat list of named ECO positions, not a tree.** No frequencies, no win/draw/loss, no depth beyond the named-opening EPD. We use it purely as an EPD → human-readable name lookup, joined onto the tree we build ourselves.
- **Build artifact:** `make` in the repo emits a `dist/` (needs `pip3 install chess`). For us, just consuming the raw TSVs is simpler.

### 2.4 `lichess-org/lila-openingexplorer` *(avoid running locally)*
- **Repo:** [github.com/lichess-org/lila-openingexplorer](https://github.com/lichess-org/lila-openingexplorer)
- **Language:** Rust (98.7%), AGPL-3.0.
- **On-disk format:** RocksDB. The README claims the indexed DB is "well below 3x the compressed PGN size" — so for the full ~2 TB Lichess archive, expect ~3–6 TB on SSD.
- **Indexing pipeline:** `cd import-pgn && cargo run --release -- *.pgn.zst`. Works on compressed input directly.
- **Throughput:** ~1 MiB/s **compressed** per indexer. So a single 25 GB monthly dump takes ~7 hours to ingest fully on one core; the full historical archive takes weeks.
- **Data dump availability:** **None.** Lichess publishes raw PGN inputs only; the indexed RocksDB is not redistributed.
- **Why we don't run it:** disk + time cost is unjustified vs. the simpler Node + `chess.js` + SQLite approach. AGPL-3.0 also forces us to publish our backend source if we host an instance — fine for a personal app, awkward if this ever turned into a SaaS. We can read its **schema and indexing approach** as a reference but reimplement at a tenth the scale.

### 2.5 Polyglot `.bin` Books *(rejected as primary source)*
- **Format spec:** [hgm.nubati.net/book_format.html](http://hgm.nubati.net/book_format.html). 16 bytes per entry: `key (8B Zobrist) + move (2B) + weight (2B) + learn (4B)`. Entries sorted by key; binary search lookup. Source: [chessprogramming.org/PolyGlot](https://www.chessprogramming.org/PolyGlot).
- **Notable books:** `goi.bin` (Stockfish-derived, free at [chess.massimilianogoi.com](https://chess.massimilianogoi.com/download/stockfishpolyglot/)), `Titans.bin` (Flavio Martin), `Human.bin`, `gm2001.bin` (2530+ Elo OTB games 2001–2013). Curated repo: [github.com/gmcheems-org/free-opening-books](https://github.com/gmcheems-org/free-opening-books). Donna engine free books: [github.com/michaeldv/donna_opening_books](https://github.com/michaeldv/donna_opening_books). Rebel/Pro books: [rebel13.nl/download/books.html](https://rebel13.nl/download/books.html).
- **Sizes:** typically 10–500 MB per book, covering thousands to millions of positions.
- **Tooling:** `python-chess` ships [`chess.polyglot.MemoryMappedReader`](https://python-chess.readthedocs.io/en/latest/polyglot.html). Node has [`gflohr/Chess-Opening`](https://github.com/gflohr/Chess-Opening) (Perl, not Node — would need a port or shell-out).
- **Why rejected as primary:** the format stores **only `weight` (a relative score, typically `2*wins + draws` scaled to 16 bits) — no absolute win/draw/loss counts, no game references, no average opponent rating, no top games**. We can't reproduce the "1247 master games, 51% white wins" UX. Polyglot is for engines picking moves, not for humans browsing statistics.
- **Where we might still use one:** as an offline fallback for "what's a reasonable engine move" if our SQLite tree has no data for a position.

### 2.6 PGN Mentor — `https://www.pgnmentor.com/files.html`
- **What it is:** Hand-organised collection of PGN files by player and by opening. Free PGN downloads; the desktop viewer is paid ($25).
- **Opening collections:** ~13,400 named opening lines organised by ECO. Per-opening files (e.g. `Sicilian.pgn`, `RuyLopez.pgn`) typically 1–50 MB each, often containing thousands of representative master games.
- **Player collections:** Free. Carlsen, Kasparov, Karpov, etc. each have downloadable single-PGN files of all their tournament games.
- **License:** Not explicitly CC0; "free download" granted, redistribution unclear. Treat as research-input only, do not bundle into our app.
- **Why not primary:** smaller and curated, not designed for frequency tallies — the same line may appear dozens of times across player files, double-counting positions. Useful as a **supplement** for hand-curated repertoire content (annotated lines, classical model games), not for the statistical tree.
- **Source:** [pgnmentor.com](https://www.pgnmentor.com/).

### 2.7 Lumbra's Gigabase
- **URL:** [lumbrasgigabase.com](https://lumbrasgigabase.com/)
- **Size:** 10.3 M games, 900K+ players, OTB-focused. Available in PGN and Scid formats. Updated semi-annually (latest 2025-07-01).
- **Note:** Caissabase (the predecessor / sibling) is no longer being maintained as of 2025; Lumbra's is the modern replacement.
- **Why not primary:** mostly OTB tournament games — overlaps Elite DB themes, but for our personal-network learning app the Elite DB is enough and updates monthly. Worth knowing exists if we ever need pre-2013 historical games.

### 2.8 `eco.json` — `https://github.com/hayatbiralem/eco.json`
- **What:** TypeScript package, **12,000+** ECO openings as JSON, including interpolated variations and transition data.
- **Fields:** `eco`, `name`, `fen`, `moves`, `src`, `isEcoRoot`.
- **License:** MIT. Original repo archived March 2026; live fork at [JeffML/eco.json](https://github.com/JeffML/eco.json).
- **Use case:** richer naming than `lichess-org/chess-openings`. If we want to label transposition nodes ("this is also reached via the Zukertort move-order"), `eco.json` has the cross-references. Optional v2 feature.

---

## 3. Pipeline Options

Four routes. We benchmarked each against the same target ("deep, frequency-weighted tree of all reasonable openings to depth 20+") and ranked them.

### Option (a) — Build tree from Elite DB PGN  *(recommended)*

```
[zstd/unzip stream] → [pgn-extract --notags] → [Node worker_threads pool]
                                                  │
                                                  ▼
                                       chess.js per-game replay
                                                  │
                                                  ▼
                              Map<zobristKey, { white, draw, black, moves: Map<uciMove, count> }>
                                                  │
                                                  ▼
                                  better-sqlite3 batched INSERT into openings.db
                                                  │
                                                  ▼
                            JOIN onto chess-openings TSV (epd → name) for labels
```

**Throughput data point:** Niklas Fiekas's `rust-pgn-reader` does **11.6 M games in 4.3 minutes on M1 MacBook** (ref: [github.com/niklasf/rust-pgn-reader](https://github.com/niklasf/rust-pgn-reader)). A pure-Node `chess.js`-driven tally is roughly **5–10× slower** — call it ~50 K games/sec single-core, ~200 K/sec on a 4-worker pool. So 3.8 M Elite games = ~20 minutes of CPU on a modern laptop. Add 5 min download + 2 min decompress + 3 min SQLite write = **~30 min cold build**.

**Storage cost:** input ~600 MB compressed, intermediate position map ~500 MB RAM peak (or stream to LMDB if RAM-constrained — better-sqlite3 can also serve as the spill store), final SQLite **80–250 MB** (see §3 sizing).

**Output quality:** real Elite-rated win/draw/loss for every position, every reasonable continuation. Equivalent to `explorer.lichess.ovh/lichess?ratings=2500` but offline and ours.

### Option (b) — Pre-built Polyglot `.bin` → JSON

```
[goi.bin / human.bin] → python-chess MemoryMappedReader → walk all keys → JSON
```

**Throughput:** trivial. Polyglot is mmap-friendly; reading all entries from a 100 MB book takes seconds.

**Storage cost:** input 10–500 MB; output JSON typically 2–5x the .bin size due to text expansion.

**Output quality:** weights only. **No win/draw/loss split, no game count, no top games, no opponent rating.** Cannot answer "what's the win rate from this position" — only "what move would a strong engine make from this position." This is a different product.

**Verdict:** rejected for primary use; viable as a fallback for positions with no Elite-DB coverage.

### Option (c) — Hand-curate from PGN Mentor

```
For each major opening file (Sicilian.pgn, RuyLopez.pgn, …):
   chess.js replay → tag with hand-written variation names → emit JSON repertoire
```

**Throughput:** human-bounded, days of work for a meaningful coverage.

**Storage cost:** small, KB per opening.

**Output quality:** highest pedagogical quality (curated annotations) but lowest coverage. Not a substitute for the statistical tree — it's a **complement** for the "study these model games" feature.

**Verdict:** future scope (v2). For v1 the statistical tree is the priority.

### Option (d) — Run lila-openingexplorer locally

```
[Lichess monthly dump 25 GB.zst] → import-pgn (Rust, AGPL) → RocksDB (~75 GB on SSD)
                                                              │
                                                              ▼
                                                   serve via Rust HTTP server, query by FEN
```

**Throughput:** ~1 MiB/s compressed. **One month = ~7 hours; full archive = weeks.**

**Storage cost:** RocksDB ~3x compressed PGN. One month = ~75 GB. Full archive = ~6 TB. Brutal for a laptop.

**Output quality:** identical to the live explorer.

**Verdict:** rejected. The juice (perfect parity with Lichess explorer UX) isn't worth the squeeze (TB-scale storage + days of indexing + AGPL + a Rust service to run alongside our Node stack). Option (a) gets us 90% of the same UX for 1% of the cost.

### Comparison Matrix

| Option | Source | Build time | Disk (final) | Win/Draw/Loss? | Top games? | Coverage to ply 20? | Verdict |
|---|---|---|---|---|---|---|---|
| **(a) Elite DB → SQLite** | Elite 600 MB | **~30 min** | **80–250 MB** | yes | yes | yes (mainlines deep, sidelines 8–12) | **Recommended** |
| (b) Polyglot `.bin` → JSON | goi.bin / human.bin | <5 min | 50–500 MB | **no** | no | yes (engine-deep) | Fallback only |
| (c) PGN Mentor curated | PGN Mentor zips | days (manual) | <50 MB | no | no | partial (curated only) | v2 supplement |
| (d) lila-openingexplorer local | Lichess dumps 2 TB | **days–weeks** | **3–6 TB** | yes | yes | yes (full) | Rejected — overkill |

---

## 4. Sizing Math

Reasoning about the final SQLite size.

- **Elite DB games:** ~3.8 M.
- **Avg ply per game:** ~80 (40 moves each side).
- **Distinct positions reached if we kept every ply:** absolute upper bound ~300 M; in practice ~10–30 M because of heavy transposition convergence on mainlines, then divergence into long-tail unique endgame positions.
- **What we actually keep:** every position with `nGames ≥ MIN_GAMES`. Pick `MIN_GAMES = 5` (chessreps-style "is this real opening theory") and the tail collapses dramatically — typical analysis suggests ~500 K – 2 M nodes survive.
- **Per-row cost in SQLite:**
  - `position_id` INTEGER (8B) + `epd` TEXT (~70B) + `eco` TEXT (3B) + `name` TEXT (~40B nullable) + `white`, `draw`, `black` INTEGER (8B each) ≈ ~150 B per node.
  - Plus moves table: ~5 moves per node avg, each row ~50 B (parent_id, uci, count, child_id) = ~250 B per node.
  - Total ~400 B per node × indexes (≈1.5x) ≈ **~600 B per node**.
- **Final size:** at 500 K nodes → ~300 MB; at 200 K nodes → ~120 MB; at 1 M nodes → ~600 MB.
- **Tunable:** `MIN_GAMES` is the dial. We ship with `MIN_GAMES = 10` to keep under 200 MB, expose a build flag to lower it for power users.
- **Compression:** SQLite + `gzip -9` on the wire knocks 30–40% off; sqlite-wasm + lazy HTTP range fetch (R5 in `stack.md`) means the client never downloads the whole file.

**Per-pillar (one of "20 most common openings, deep tree"):** rough math: a single "deep tree of one named opening to ply 20" with all reasonable variations is ~5 K – 50 K nodes ≈ **3–30 MB SQLite, or ~1–10 MB JSON gzipped**. Twenty pillars → **~60 MB – 600 MB total** if shipped as 20 separate files; deduping into the shared SQLite makes the marginal cost much lower (most pillars share the first ~10 ply).

---

## 5. Recommendation: Pipeline & Script Outline

### Decision

Build option (a): **Elite DB → Node + chess.js → SQLite, named via `chess-openings` TSVs.**

Why this and not the alternatives:
- **vs (b) Polyglot:** we get win/draw/loss splits and game counts — the actual data the UX needs.
- **vs (c) PGN Mentor:** statistical breadth, not days of human work.
- **vs (d) lila-openingexplorer:** same answer for 1% of the disk and 1% of the time.
- **vs the live API:** survives the April 2026 auth requirement (R3), ships offline-first, no rate limits.

### `scripts/build-openings.ts` Skeleton

```ts
/**
 * build-openings.ts
 * Ingest Lichess Elite Database PGN months into a frequency-weighted
 * opening tree, write public/openings.db.
 *
 * Schema and rationale: docs/research/opening-data-sources.md
 *
 * Usage:
 *   npm run build:openings              # default MIN_GAMES=10
 *   MIN_GAMES=5 npm run build:openings  # deeper tree, larger DB
 */

import { existsSync, createReadStream } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { Chess } from 'chess.js';
import { decompress } from 'fzstd';   // for .zst (Lichess); use unzip for nikonoel .zip

// ─── 1. Inputs ──────────────────────────────────────────────────────────────
const REPO_ROOT  = resolve(/* … */);
const ELITE_DIR  = join(REPO_ROOT, '.cache', 'elite');           // *.pgn (or .pgn.zst)
const OPENINGS_TSV_DIR = join(REPO_ROOT, '.cache', 'chess-openings'); // a.tsv … e.tsv
const TARGET_DB  = join(REPO_ROOT, 'public', 'openings.db');
const MIN_GAMES  = Number(process.env.MIN_GAMES ?? 10);
const MAX_PLY    = Number(process.env.MAX_PLY ?? 30);            // hard cap; mainlines easily reach this
const N_WORKERS  = Math.max(2, (require('node:os').cpus().length) - 1);

// ─── 2. Tally pass ──────────────────────────────────────────────────────────
// Spawn N_WORKERS workers. Each receives PGN chunks (split on blank-line
// game boundaries), replays each game with chess.js, computes Zobrist keys
// per ply, and accumulates into a local Map<key, { w, d, b, moves: Map<uci, n> }>.
// Workers periodically flush their map back to the main thread.
//
// Main thread merges into a single global Map (or LMDB if RAM > 8 GB).
//
// Pseudo:
//   for await (game of pgnStream) {
//       const chess = new Chess();
//       chess.loadPgn(game.moves);
//       const result = parseResult(game.headers.Result);  // 1-0 / 0-1 / 1/2-1/2
//       let ply = 0;
//       const history = chess.history({ verbose: true });
//       const replay = new Chess();
//       for (const move of history) {
//         if (ply >= MAX_PLY) break;
//         const key = replay.getPositionHash();          // chess.js 1.3+ Zobrist
//         tally(key, result, move.lan);                  // increment w/d/b and move count
//         replay.move(move);
//         ply++;
//       }
//   }

// ─── 3. Prune + persist ─────────────────────────────────────────────────────
// Drop every position with sum(w+d+b) < MIN_GAMES.
// Drop child-move edges with count < MIN_GAMES.
// Insert into SQLite:

const db = new Database(TARGET_DB);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE positions (
      pos_id   INTEGER PRIMARY KEY,
      zobrist  BLOB    NOT NULL UNIQUE,         -- 8 B
      epd      TEXT    NOT NULL,                -- for chess-openings JOIN
      eco      TEXT,                            -- nullable, populated in step 4
      name     TEXT,
      white    INTEGER NOT NULL,
      draw     INTEGER NOT NULL,
      black    INTEGER NOT NULL
  );
  CREATE INDEX idx_positions_zobrist ON positions(zobrist);
  CREATE INDEX idx_positions_epd     ON positions(epd);

  CREATE TABLE moves (
      parent_id INTEGER NOT NULL REFERENCES positions(pos_id),
      child_id  INTEGER NOT NULL REFERENCES positions(pos_id),
      uci       TEXT    NOT NULL,
      san       TEXT    NOT NULL,
      n_games   INTEGER NOT NULL,
      PRIMARY KEY (parent_id, uci)
  );
  CREATE INDEX idx_moves_parent ON moves(parent_id);
`);

// Batched INSERT in a transaction; better-sqlite3 prepared statements.

// ─── 4. ECO labelling pass ──────────────────────────────────────────────────
// Stream chess-openings/{a..e}.tsv → for each row, look up by EPD prefix
// and UPDATE positions SET eco = ?, name = ? WHERE epd LIKE ? || '%'.
// (chess-openings EPDs include "side-to-move + castling + ep" but no
//  halfmove/fullmove counters, so use LIKE-prefix or build a dedicated
//  truncated_epd column.)

// ─── 5. Manifest ────────────────────────────────────────────────────────────
// Emit public/openings.manifest.json with build timestamp, source month(s),
// MIN_GAMES, MAX_PLY, total positions, total moves, db file size, sha256.
```

### Operational Notes
- **Cache:** `.cache/elite/*.pgn(.zst)` — gitignored.
- **Reproducibility:** record source month(s) and `MIN_GAMES` in `openings.manifest.json` so we can diff DB rebuilds.
- **Incremental updates:** monthly Elite DB drops are additive — design `INSERT … ON CONFLICT (zobrist) DO UPDATE SET white = white + excluded.white, …`. Keeps build under 5 min per month after the initial cold build.
- **Memory ceiling:** if the position map exceeds ~6 GB RAM, switch to LMDB (`node-lmdb`) as the spill store. For Elite DB at MIN_GAMES=10 this won't happen.
- **Client serving:** same pattern as `puzzles.db` — sqlite-wasm + lazy HTTP range fetch via sql.js-httpvfs (already pinned in `stack.md` R5). Browser fetches only the pages it needs to answer a query.
- **License hygiene:** Elite DB and `chess-openings` are both CC0 — bundle freely. Never bundle `lila-openingexplorer` source (AGPL).

### Open Questions for Reviewer
1. **MIN_GAMES default.** 10 keeps DB under 200 MB; 5 nearly doubles it but extends sideline depth meaningfully. Pick one before first build.
2. **Elite DB month coverage.** Ship with the latest **12 months** (≈350–500 K games each, ~5 M total) for v1, or just the most recent 3 months (faster build, current theory)? Recommend 12 months for breadth, monthly cron for freshness.
3. **Ship pre-built or build at install?** `puzzles.db` is shipped pre-built in `public/`. `openings.db` should follow the same pattern; users on the home network never need to run the builder.
4. **EPD-vs-Zobrist as join key.** `chess-openings` uses EPD; we tally by Zobrist. Either build both columns (small overhead) or do one EPD pass per Zobrist post-hoc. Recommend dual-column for query speed.

---

## 6. Sources

- [database.lichess.org](https://database.lichess.org/) — main Lichess open database
- [database.nikonoel.fr](https://database.nikonoel.fr/) — Lichess Elite DB *(chosen primary)*
- [github.com/lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) — ECO TSVs
- [huggingface.co/datasets/Lichess/chess-openings](https://huggingface.co/datasets/Lichess/chess-openings) — Parquet mirror, 3,546 openings
- [github.com/lichess-org/lila-openingexplorer](https://github.com/lichess-org/lila-openingexplorer) — Rust indexer (read for inspiration only)
- [chessprogramming.org/PolyGlot](https://www.chessprogramming.org/PolyGlot) — `.bin` format spec
- [hgm.nubati.net/book_format.html](http://hgm.nubati.net/book_format.html) — polyglot format reference
- [python-chess.readthedocs.io/en/latest/polyglot.html](https://python-chess.readthedocs.io/en/latest/polyglot.html) — polyglot reader API
- [github.com/niklasf/rust-pgn-reader](https://github.com/niklasf/rust-pgn-reader) — reference throughput (11.6 M games / 4.3 min on M1)
- [github.com/niklasf/python-chess](https://github.com/niklasf/python-chess) — Python toolkit
- [pgnmentor.com](https://www.pgnmentor.com/) — curated PGN collections (supplement only)
- [lumbrasgigabase.com](https://lumbrasgigabase.com/) — successor to Caissabase, OTB DB
- [github.com/hayatbiralem/eco.json](https://github.com/hayatbiralem/eco.json) — 12K+ ECO JSON (live fork: JeffML/eco.json)
- [github.com/openingtree/openingtree](https://github.com/openingtree/openingtree) — JS reference impl (per-user trees)
- [github.com/gmcheems-org/free-opening-books](https://github.com/gmcheems-org/free-opening-books) — curated polyglot books
- [github.com/michaeldv/donna_opening_books](https://github.com/michaeldv/donna_opening_books) — Donna engine free books
- [chess.massimilianogoi.com](https://chess.massimilianogoi.com/download/stockfishpolyglot/) — `goi.bin`
- [www.cs.kent.ac.uk/~djb/pgn-extract/](https://www.cs.kent.ac.uk/~djb/pgn-extract/) — `pgn-extract` (David J. Barnes; not Wirfs-Brock — task brief misattributed)
- [lichess.org/page/api-tips](https://lichess.org/page/api-tips) — rate-limit policy (cross-ref R4)
- [lichess.org/changelog](https://lichess.org/changelog) — auth-requirement announcement (cross-ref R3)
