# Puzzle DB — Phase 0 Research Brief

**Status:** draft, awaiting one user decision (see open question).
**Date:** 2026-04-26
**Scope:** SQLite schema + ingest/prune for the Lichess puzzle subset shipped with the web app. No runtime stack decisions here.

---

## 1. TL;DR

- **Source:** `https://database.lichess.org/lichess_db_puzzle.csv.zst` — CC0, 5,829,565 puzzles, ~220 MB compressed / ~1.19 GB uncompressed, refreshed monthly (last dump: 2026-03-25). [Lichess open db](https://database.lichess.org/), [HuggingFace mirror](https://huggingface.co/datasets/Lichess/chess-puzzles/blob/main/README.md)
- **Plan:** build-time Node script ingests CSV → SQLite (~6M rows, normalized) → prunes to a balanced ~50k subset → emits `puzzles.db` (~10–15 MB) shipped as a static asset.
- **Schema:** normalized — `puzzles` + `themes` + `puzzle_themes` + `opening_tags` + `puzzle_opening_tags`. Rationale below; FTS5 not worth it at 50k.
- **Runtime:** [`@sqlite.org/sqlite-wasm`](https://sqlite.org/wasm) preferred over [`sql.js`](https://github.com/sql-js/sql.js/) (smaller wasm, OPFS-capable, faster). Cold load ~600 KB wasm + ~12 MB DB = ~1–2 s on broadband, ~5 s on 3G. Acceptable.

### Open question for the user (decide in plan mode)

> **Filter puzzles by opening tag at INGEST time or QUERY time?**
>
> - **Ingest-time filter** (whitelist ~12 mainline openings: Sicilian, French, Italian, Ruy Lopez, Caro-Kann, Queen's Gambit, English, Scotch, Scandinavian, Indian, Philidor, Queen's Pawn). Drops opening-tagged puzzles outside the list. Smaller DB, simpler client. Locks the curriculum.
> - **Query-time filter** (ship every opening tag, ~1,500+ unique slugs). Larger `opening_tags` table (~150 KB extra), full flexibility, can add new opening tracks without rebuilding the DB.
>
> **Recommendation:** *query-time*. The size cost is negligible (~1–2% of bundle), and locking the opening list at ingest is the kind of decision that's annoying to reverse once users have study sessions in progress. Curriculum lessons can still hard-code their preferred tag list — query-time filtering is strictly a superset. The only reason to pick ingest-time is if you want to aggressively prune the *puzzle* row count by dropping any puzzle whose opening tag isn't in the whitelist; even then, opening tags are sparse (only set for puzzles starting before move 20), so the savings are modest.
>
> Decision needed before `scripts/build-puzzles.ts` is written.

---

## 2. Source CSV schema (verified 2026-04-26)

Lichess [documents the columns inline on database.lichess.org](https://database.lichess.org/#puzzles). Verbatim column list, in order:

```
PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl, OpeningTags
```

| Column            | Type (HF parquet)   | Meaning                                                                                                |
|-------------------|---------------------|--------------------------------------------------------------------------------------------------------|
| `PuzzleId`        | `large_string` (5 chars, e.g. `000hf`) | Unique. Base62-ish slug; treat as opaque TEXT.                                                          |
| `FEN`             | `large_string`      | Position **before** the opponent's move. Player-side position = FEN with `Moves[0]` applied.            |
| `Moves`           | `large_string`      | Solution in UCI, space-separated (`e8f7 e2e6 f7f8 e6f7`). First move is opponent's, rest is solution.  |
| `Rating`          | `uint16`            | Glicko-2 rating of the puzzle.                                                                         |
| `RatingDeviation` | `uint16`            | Glicko-2 RD. High RD = unstable rating, worth filtering out at ingest (RD > 100 is sketchy).           |
| `Popularity`      | `int8`              | `100 * (up - down) / (up + down)`, range −100..+100. Quality signal.                                   |
| `NbPlays`         | `uint32`            | Total play count. Vetting signal — low NbPlays means few players have rated it.                        |
| `Themes`          | `list[string]`      | Space-separated tag list in CSV. Many-to-many. ~70 distinct values.                                    |
| `GameUrl`         | `string`            | Source game URL (`https://lichess.org/{gameId}/{color}#{ply}`). Useful for "show source game" UI.      |
| `OpeningTags`     | `list[string]`      | Space-separated opening slugs (`Sicilian_Defense Sicilian_Defense_Najdorf_Variation`). **Only set when puzzle starts before move 20.** Sparse — most puzzles have empty `OpeningTags`. |

Sample row (from HF dataset, equivalent CSV):

```
000hf,r1bqk2r/pp1nbNp1/2p1p2p/8/2BP4/1PN3P1/P3QP1P/3R1RK1 b kq - 0 19,e8f7 e2e6 f7f8 e6f7,1575,75,92,674,mate mateIn2 middlegame short,https://lichess.org/71ygsFeE/black#38,Horwitz_Defense Horwitz_Defense_Other_variations
```

### Theme vocabulary (canonical, ~70 keys)

Pulled from [`puzzleTheme.xml` in lila](https://github.com/lichess-org/lila/blob/master/translation/source/puzzleTheme.xml) and [the themes page](https://lichess.org/training/themes). Grouped:

- **Phases:** `opening`, `middlegame`, `endgame`, `rookEndgame`, `bishopEndgame`, `pawnEndgame`, `knightEndgame`, `queenEndgame`, `queenRookEndgame`
- **Lengths:** `oneMove`, `short`, `long`, `veryLong`
- **Goals:** `equality`, `advantage`, `crushing`, `mate`
- **Mate-in-N:** `mateIn1`, `mateIn2`, `mateIn3`, `mateIn4`, `mateIn5`
- **Motifs:** `advancedPawn`, `attackingF2F7`, `capturingDefender`, `discoveredAttack`, `doubleCheck`, `exposedKing`, `fork`, `hangingPiece`, `kingsideAttack`, `pin`, `queensideAttack`, `sacrifice`, `skewer`, `trappedPiece`
- **Advanced:** `attraction`, `clearance`, `collinearMove`, `discoveredCheck`, `defensiveMove`, `deflection`, `interference`, `intermezzo`, `quietMove`, `xRayAttack`, `zugzwang`
- **Mate patterns:** `anastasiaMate`, `arabianMate`, `backRankMate`, `balestraMate`, `blindSwineMate`, `bodenMate`, `cornerMate`, `doubleBishopMate`, `dovetailMate`, `epauletteMate`, `hookMate`, `killBoxMate`, `pillsburysMate`, `morphysMate`, `operaMate`, `smotheredMate`, `swallowstailMate`, `triangleMate`, `vukovicMate`
- **Special moves:** `castling`, `enPassant`, `promotion`, `underPromotion`
- **Origin:** `master`, `masterVsMaster`, `superGM`

Note: keep them as TEXT keys, not enum integers — Lichess can add new themes (they did so for `killBoxMate` recently). The `themes` table is the source of truth at build time.

---

## 3. Proposed SQLite schema

Normalized. Five tables. Designed for read-only browser use against a static DB.

```sql
-- One row per puzzle. Hot path for rating-window queries.
CREATE TABLE puzzles (
    id              TEXT PRIMARY KEY,        -- Lichess PuzzleId, e.g. '000hf'. 5 chars, opaque.
    fen             TEXT NOT NULL,           -- ~50–80 bytes; position BEFORE opponent's first move.
    moves           TEXT NOT NULL,           -- UCI, space-separated. ~20–80 bytes.
    rating          INTEGER NOT NULL,        -- Glicko-2 rating. Indexed (range queries).
    rating_dev      INTEGER NOT NULL,        -- Glicko-2 RD. Filter at ingest (RD <= 100), keep for display.
    popularity      INTEGER NOT NULL,        -- -100..+100. Filter at ingest.
    nb_plays        INTEGER NOT NULL,        -- Vetting threshold at ingest.
    game_url        TEXT                     -- nullable; can be reconstructed from id, but cheap to store.
) WITHOUT ROWID;
-- WITHOUT ROWID is correct here: TEXT primary key, every column is part of every read.
-- Saves ~5–10% on size and avoids the rowid btree.

CREATE TABLE themes (
    id              INTEGER PRIMARY KEY,     -- small int for tight join keys
    name            TEXT UNIQUE NOT NULL     -- canonical Lichess key, e.g. 'mateIn2'
);

CREATE TABLE puzzle_themes (
    puzzle_id       TEXT NOT NULL,
    theme_id        INTEGER NOT NULL,
    PRIMARY KEY (puzzle_id, theme_id)
) WITHOUT ROWID;
-- Composite PK doubles as the (puzzle_id, theme_id) covering index.

CREATE TABLE opening_tags (
    id              INTEGER PRIMARY KEY,
    name            TEXT UNIQUE NOT NULL     -- e.g. 'Sicilian_Defense_Najdorf_Variation'
);

CREATE TABLE puzzle_opening_tags (
    puzzle_id       TEXT NOT NULL,
    opening_tag_id  INTEGER NOT NULL,
    PRIMARY KEY (puzzle_id, opening_tag_id)
) WITHOUT ROWID;
```

### Why normalized over denormalized TEXT + LIKE/FTS5

| Approach                     | 50k DB size | Query: theme=fork AND rating BETWEEN 1400 AND 1600 | Bundle cost |
|------------------------------|-------------|---------------------------------------------------|-------------|
| Normalized (proposed)        | ~12 MB      | Indexed join, <5 ms                               | baseline    |
| TEXT column + `LIKE '% fork %'`  | ~10 MB      | Full table scan after rating filter, ~50 ms       | −2 MB, +10× query latency |
| TEXT column + FTS5 virtual table | ~16 MB      | Indexed FTS lookup, <5 ms                         | +4 MB (FTS5 indices duplicate the data) |

Normalized wins. FTS5 is for full-text natural-language search, not tag-set membership; using it here would be a hammer on a screw and inflates the bundle. The denormalized TEXT-with-LIKE option is tempting (fewer tables, no joins) but quickly degrades when the user filters by 2+ themes (`AND themes LIKE '% pin %' AND themes LIKE '% endgame %'`) and you can't index it usefully.

### Why `id TEXT PRIMARY KEY WITHOUT ROWID`

- Lichess PuzzleIds are 5-char strings; storing them as TEXT keeps the GameUrl reconstructable and trivially debuggable.
- `WITHOUT ROWID` removes the redundant rowid btree. Saves ~600 KB at 50k rows. Caveat: row size should stay under ~50% of page size; our rows are ~150–200 bytes, well within budget.
- Alternative (rejected): convert PuzzleId to INTEGER via base62 decode → saves ~3 bytes/row in joins (~150 KB total). Not worth the readability cost.

---

## 4. Indices

```sql
-- Range queries by rating are the dominant access pattern (the SR scheduler picks
-- puzzles within a window around the user's current rating).
CREATE INDEX idx_puzzles_rating ON puzzles(rating);

-- Composite for "puzzles with theme X in rating window".
-- Order matters: theme_id first (high selectivity), then we fall through to a rating
-- filter that's still cheap because the result set is small.
CREATE INDEX idx_puzzle_themes_theme_puzzle ON puzzle_themes(theme_id, puzzle_id);

-- Same shape for opening tags.
CREATE INDEX idx_puzzle_opening_tag_puzzle ON puzzle_opening_tags(opening_tag_id, puzzle_id);

-- (No index on puzzles.popularity / nb_plays — those are filtered at ingest;
-- runtime never queries on them.)
```

**No FTS5.** Tag-set membership is not a full-text problem and FTS5 would add ~4 MB to the bundle. Skip it.

**ANALYZE.** Run `ANALYZE;` once after the build, before the final `VACUUM;`. The query planner uses `sqlite_stat1` to pick the right index for `WHERE theme_id = ? AND puzzle_id IN (SELECT id FROM puzzles WHERE rating BETWEEN ? AND ?)` style queries. Costs ~50 KB in the shipped DB, worth it.

### Typical runtime queries

```sql
-- "Give me 20 fork puzzles around rating 1500"
SELECT p.id, p.fen, p.moves, p.rating
FROM puzzles p
JOIN puzzle_themes pt ON pt.puzzle_id = p.id
JOIN themes t ON t.id = pt.theme_id
WHERE t.name = 'fork'
  AND p.rating BETWEEN 1400 AND 1600
ORDER BY RANDOM()
LIMIT 20;

-- "Sicilian puzzles, any theme, 1600-1800"
SELECT p.id, p.fen, p.moves, p.rating
FROM puzzles p
JOIN puzzle_opening_tags pot ON pot.puzzle_id = p.id
JOIN opening_tags ot ON ot.id = pot.opening_tag_id
WHERE ot.name LIKE 'Sicilian_Defense%'
  AND p.rating BETWEEN 1600 AND 1800
LIMIT 20;
```

---

## 5. Ingest pipeline — `scripts/build-puzzles.ts`

Pseudo-code outline. Single Node script, idempotent, deterministic.

```ts
// 0. Inputs (env vars or CLI args)
const SOURCE_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const TARGET_COUNT = 50_000;
const RNG_SEED = 0xC4E55;          // bump to refresh the subset
const MIN_NB_PLAYS = 50;           // vetting threshold
const MIN_POPULARITY = 80;         // 80% net upvote rate
const MAX_RD = 100;                // drop noisy ratings
const OPENING_FILTER = 'query';    // 'ingest' | 'query' — pending user decision

// 1. Download (with on-disk cache keyed by ETag/Last-Modified)
//    Skip if local copy exists and matches the upstream ETag.
const csvZst = await downloadCached(SOURCE_URL, '.cache/puzzles.csv.zst');

// 2. Stream-decompress with @mongodb-js/zstd or zstd-napi.
//    Do NOT decompress to disk — pipe directly into the CSV parser.
const csvStream = decompressZstd(csvZst);

// 3. Parse with `csv-parse` in streaming mode. Filter eagerly:
//    - drop rows with rating_deviation > MAX_RD
//    - drop rows with popularity < MIN_POPULARITY
//    - drop rows with nb_plays < MIN_NB_PLAYS
//    Yields ~1.5–2M survivor rows from ~5.8M.
const survivors: PuzzleRow[] = [];
for await (const row of parseCsv(csvStream, { columns: true })) {
    if (+row.RatingDeviation > MAX_RD) continue;
    if (+row.Popularity < MIN_POPULARITY) continue;
    if (+row.NbPlays < MIN_NB_PLAYS) continue;
    survivors.push(row);
}

// 4. Prune (see §6 for algorithm). Returns ~50k rows.
const selected = pruneBalanced(survivors, TARGET_COUNT, RNG_SEED);

// 5. Build the DB with better-sqlite3 (Node-side; not the wasm build).
//    Use a single transaction for ingest — 100× faster than autocommit.
const db = new Database('puzzles.db');
db.pragma('journal_mode = OFF');     // build-time only, no concurrent readers
db.pragma('synchronous = OFF');
db.pragma('temp_store = MEMORY');
db.exec(SCHEMA_SQL);                 // CREATE TABLE statements from §3

const insertPuzzle = db.prepare(`INSERT INTO puzzles VALUES (?,?,?,?,?,?,?,?)`);
const insertTheme = db.prepare(`INSERT OR IGNORE INTO themes (name) VALUES (?)`);
const getThemeId = db.prepare(`SELECT id FROM themes WHERE name = ?`);
const insertPuzzleTheme = db.prepare(`INSERT INTO puzzle_themes VALUES (?,?)`);
// ...same shape for opening_tags

const themeIdCache = new Map<string, number>();
const txn = db.transaction((rows: PuzzleRow[]) => {
    for (const r of rows) {
        insertPuzzle.run(r.PuzzleId, r.FEN, r.Moves, +r.Rating,
                         +r.RatingDeviation, +r.Popularity, +r.NbPlays, r.GameUrl);
        for (const theme of r.Themes.split(' ').filter(Boolean)) {
            let tid = themeIdCache.get(theme);
            if (tid === undefined) {
                insertTheme.run(theme);
                tid = getThemeId.get(theme).id;
                themeIdCache.set(theme, tid);
            }
            insertPuzzleTheme.run(r.PuzzleId, tid);
        }
        // ...same loop for r.OpeningTags (skip whole loop if OPENING_FILTER === 'ingest'
        //    and the tag isn't in the whitelist)
    }
});
txn(selected);

// 6. Indices, ANALYZE, VACUUM (in that order).
db.exec(INDEX_SQL);
db.exec('ANALYZE;');
db.exec('VACUUM;');                  // reclaim free pages, defrag — critical for size
db.close();

// 7. Emit a sidecar manifest with the seed, source ETag, build timestamp,
//    final puzzle count, theme-band distribution. Useful for debugging
//    "why does today's prod DB look different from my local one?"
writeFileSync('puzzles.manifest.json', JSON.stringify(manifest, null, 2));
```

Build time: ~2–4 minutes on a developer laptop (download dominates). The decompress + parse + filter pass is CPU-bound at ~30 s.

---

## 6. Pruning algorithm — balanced 50k subset

Goals:
1. Roughly even **rating coverage** across skill levels (don't dump 30k puzzles into the 1500–1700 band just because that's where the mass is).
2. Roughly even **theme coverage** within each rating band (don't end up with all `endgame` in the high band, all `mateIn1` in the low band — both correlations exist in the raw data).
3. **Deterministic** — same seed, same source dump → same output. Lets us audit changes between builds.

### Rating bands (9 bands, ~5,500 puzzles each)

| Band | Rating range | Target count |
|------|--------------|--------------|
| B0   | 600–999      | 4,000        |
| B1   | 1000–1199    | 5,000        |
| B2   | 1200–1399    | 6,000        |
| B3   | 1400–1599    | 7,000        |
| B4   | 1600–1799    | 7,000        |
| B5   | 1800–1999    | 6,000        |
| B6   | 2000–2199    | 5,500        |
| B7   | 2200–2399    | 5,000        |
| B8   | 2400+        | 4,500        |
| **Total** | | **50,000** |

Slight bell weighting toward 1400–1800 — that's where the largest user population will be (most chess.com / lichess players sit between 800 and 1800 rapid-equivalent), so we want the densest puzzle pool there.

### Within-band theme balancing

For each band, we want to guarantee minimum coverage of "major themes" (the ones a curriculum cares about):

```
MAJOR_THEMES = [
  // motifs
  'fork', 'pin', 'skewer', 'discoveredAttack', 'hangingPiece', 'sacrifice',
  'attraction', 'deflection', 'interference', 'clearance', 'quietMove', 'zugzwang',
  // mates
  'mateIn1', 'mateIn2', 'mateIn3', 'backRankMate', 'smotheredMate',
  // phases
  'opening', 'middlegame', 'endgame',
  // endgame types
  'rookEndgame', 'pawnEndgame', 'queenEndgame',
  // special
  'promotion', 'underPromotion', 'castling',
]  // ~26 majors
```

### Algorithm (deterministic, seeded RNG)

```
function pruneBalanced(survivors, targetCount, seed):
    rng = seedrandom(seed)                         // reproducible PRNG, e.g. seedrandom

    // 1. Bucket every puzzle into its rating band
    byBand = groupBy(survivors, p => bandFor(p.Rating))

    selected = []
    for each band B with target count Tb:
        pool = byBand[B]
        bandSelected = []

        // 2. Theme-quota pass: aim for ~Tb / N_majors per major theme
        quotaPerTheme = ceil(Tb / len(MAJOR_THEMES) * 1.2)
            // 1.2× cushion lets popular themes overlap; we trim later.
        for theme in MAJOR_THEMES:
            candidates = pool.filter(p => p.Themes.includes(theme)
                                          && !bandSelected.includes(p))
            // Sort by quality descending, then deterministic shuffle of ties.
            candidates.sort(by Popularity desc, then by NbPlays desc, then by id asc)
            pick = candidates.slice(0, quotaPerTheme)
            bandSelected.push(...pick)

        // 3. If we overshot Tb, randomly drop excess (seeded RNG).
        //    If we undershot, fill with random remaining puzzles from the band.
        bandSelected = deterministicShuffle(bandSelected, rng)
        if len(bandSelected) > Tb:
            bandSelected = bandSelected.slice(0, Tb)
        else:
            remaining = pool.filter(p => !bandSelected.includes(p))
            remaining = deterministicShuffle(remaining, rng)
            bandSelected.push(...remaining.slice(0, Tb - len(bandSelected)))

        selected.push(...bandSelected)

    return selected   // ~50,000 puzzles
```

Notes:
- The 1.2× quota cushion is intentional — many puzzles carry 3+ themes (e.g. `fork mateIn2 endgame short`), so quota selections naturally overlap. The shuffle-and-trim step handles overshoot fairly.
- We sort candidates by `(Popularity desc, NbPlays desc, id asc)` *before* picking, so within a theme quota we keep the highest-quality vetted puzzles. The PRNG is only used for tie-breaking and overshoot trimming, never for primary selection.
- Same `(seed, source dump)` → bit-identical output. CI can assert this.

### Sanity checks (assert at end of build)

```
assert puzzles.count == 50000 ± 100
assert min(rating) >= 600 && max(rating) <= 3200
assert every MAJOR_THEME has >= 1500 puzzles total
assert no rating band has < 0.7 * target_count
```

---

## 7. Size + perf estimates

### Bundle size (50k puzzles, normalized schema, after VACUUM)

| Component                      | Estimated size |
|--------------------------------|----------------|
| `puzzles` rows (~150 B × 50k)  | ~7.5 MB        |
| `puzzles` btree overhead (~15%)| ~1.1 MB        |
| `puzzle_themes` (~3 themes/puzzle avg × 12 B) | ~1.8 MB |
| `puzzle_opening_tags` (sparse, ~0.3 tags/puzzle × 12 B) | ~180 KB |
| `themes` + `opening_tags` lookup tables | ~50 KB |
| `idx_puzzles_rating`           | ~600 KB        |
| `idx_puzzle_themes_*`          | ~1.2 MB        |
| `sqlite_stat1` (post-ANALYZE)  | ~50 KB         |
| **Total uncompressed `puzzles.db`** | **~12.5 MB** |
| **Brotli-compressed for HTTP transfer** (sqlite pages compress ~3–4×) | **~3.5–4.5 MB** |

Serve with `Content-Encoding: br` and the user only downloads ~4 MB.

### Cold-load perf in browser

Using [`@sqlite.org/sqlite-wasm`](https://sqlite.org/wasm) (preferred over [sql.js](https://github.com/sql-js/sql.js/) — the official build has a smaller wasm payload, supports OPFS, and runs ~10–20% faster for our workload per [the SQLite Wasm docs](https://sqlite.org/wasm) and [sqlite/sqlite-wasm#55](https://github.com/sqlite/sqlite-wasm/issues/55)):

| Step                                    | Broadband (50 Mbps) | Mobile 4G (10 Mbps) | 3G (1.5 Mbps) |
|-----------------------------------------|---------------------|---------------------|---------------|
| Fetch wasm (~600 KB compressed)         | ~150 ms             | ~600 ms             | ~3 s          |
| Fetch + decompress puzzles.db (~4 MB → 12 MB) | ~700 ms        | ~3 s                | ~20 s         |
| Wasm instantiate + open DB              | ~200 ms             | ~300 ms             | ~500 ms       |
| **First query ready**                   | **~1.0 s**          | **~4 s**            | **~24 s**     |

Mitigations:
- Cache the DB in `Cache Storage` (service worker) — second-visit load is ~50 ms.
- Use OPFS persistence on first load → subsequent sessions skip the network entirely. ([Chrome blog on SQLite Wasm + OPFS](https://developer.chrome.com/blog/sqlite-wasm-in-the-browser-backed-by-the-origin-private-file-system))
- Show a skeleton UI / first-use tutorial during the initial download — by the time the user clicks "start", the DB is loaded.

### HTTP range request alternative (mention, don't pursue)

[`sql.js-httpvfs`](https://github.com/phiresky/sql.js-httpvfs) and [`sqlite-wasm-http`](https://www.npmjs.com/package/sqlite-wasm-http) let the browser query a remote SQLite file via HTTP Range requests, fetching only the pages a query touches — phiresky's demo serves a 670 MB DB while transferring ~1 KB per simple lookup.

For our 4 MB compressed / 12 MB uncompressed DB, this is overkill — a single full download amortizes over many sessions, and Range requests defeat compression (servers can't gzip a partial response). **Skip for v1.** Revisit only if we expand to a 100k+ puzzle DB or add a "browse all puzzles" UI that does many small queries before the user warms up to the SR loop.

---

## 8. Open questions / risks

1. **Opening filter timing** — the open question above. Blocks `scripts/build-puzzles.ts` design.
2. **Refresh cadence.** Lichess updates the dump monthly. Do we rebuild monthly via CI, quarterly, or pin to one snapshot? Monthly rebuilds will shuffle puzzle IDs in the subset (any user's IndexedDB SR history keyed on puzzle id will get stale entries — those should just become "skipped, puzzle no longer in pool"). Quarterly is probably the right cadence.
3. **`Moves` field semantics.** Reminder for the runtime engineer: the FEN is the position **before** the opponent's move; the first UCI move in `Moves` is the opponent's setup move, the remaining moves are the player's solution. Easy to get wrong, document loudly in the puzzle player UI code.
4. **OpeningTags sparsity.** Only puzzles starting before move 20 have opening tags. If we want comprehensive opening practice, the pool is much smaller than 50k — closer to 15–20k puzzles total carry any opening tag. Worth surfacing in the UI ("we only have 12 Najdorf puzzles in your rating band").
5. **Theme drift.** Lichess can add/rename themes. Build script should `WARN` (not fail) on unknown themes, log them, and keep going. Add new themes to `MAJOR_THEMES` manually after review.
6. **Rating distribution skew.** The raw dump is heavily concentrated 1400–2000 (where most active players solve). Bands B0 (600–999) and B8 (2400+) may have fewer than the target count of puzzles meeting the popularity/RD/plays filters. The pruner should log per-band fill rates; if B0 only achieves 2,000 puzzles instead of 4,000, that's worth knowing.
7. **CC0 attribution.** No legal requirement, but a `CREDITS.md` link to [database.lichess.org](https://database.lichess.org/) is good citizenship and the right thing.

---

## Sources

- [Lichess Open Database — puzzles section](https://database.lichess.org/) — canonical column spec, download URL.
- [Lichess/chess-puzzles on HuggingFace](https://huggingface.co/datasets/Lichess/chess-puzzles/blob/main/README.md) — puzzle count (5,829,565), file sizes, sample row.
- [Lichess puzzle themes page](https://lichess.org/training/themes) — full theme vocabulary with descriptions.
- [`puzzleTheme.xml` in lila](https://github.com/lichess-org/lila/blob/master/translation/source/puzzleTheme.xml) — canonical theme keys (source of truth).
- [SQLite Wasm docs](https://sqlite.org/wasm) — runtime engine reference.
- [sql.js GitHub](https://github.com/sql-js/sql.js/) — alternative runtime, rejected due to wasm size.
- [sqlite/sqlite-wasm#55](https://github.com/sqlite/sqlite-wasm/issues/55) — payload size discussion.
- [SQLite Wasm + OPFS (Chrome blog)](https://developer.chrome.com/blog/sqlite-wasm-in-the-browser-backed-by-the-origin-private-file-system) — persistence strategy.
- [`sql.js-httpvfs`](https://github.com/phiresky/sql.js-httpvfs) and [`sqlite-wasm-http`](https://www.npmjs.com/package/sqlite-wasm-http) — Range-request alternative (deferred).
