/**
 * build-puzzles.ts
 * Ingest the Lichess puzzle CSV (downloaded to .cache/) into a normalized
 * SQLite database, prune to a balanced ~50k subset, write public/puzzles.db.
 *
 * Schema and pruning rationale: docs/research/puzzle-db.md.
 *
 * Usage:
 *   npm run build:puzzles
 */

import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { parse } from 'csv-parse';
import { decompress } from 'fzstd';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_CSV_ZST = join(REPO_ROOT, '.cache', 'lichess_db_puzzle.csv.zst');
const TARGET_DB = join(REPO_ROOT, 'public', 'puzzles.db');
const MANIFEST = join(REPO_ROOT, 'public', 'puzzles.manifest.json');

/*
 * TARGET_COUNT bumped from 50k → 200k (2026-04-26) to give the opening
 * filter a meaningful working set: at 50k we typically see <1k puzzles
 * per major opening (ECO B20 etc.) and the user runs out of fresh content
 * after a single session. 4× scale ≈ 55 MB DB / ~17 MB Brotli, still
 * within ship budget for a personal-use static asset. Per-band targets
 * scale linearly (see BANDS below) so the rating distribution stays
 * balanced. Run `npm run build:puzzles` to regenerate; the existing
 * 50k DB at public/puzzles.db keeps working until then.
 */
const TARGET_COUNT = 200_000;
const RNG_SEED = 0xc4e55;
const MIN_NB_PLAYS = 50;
const MIN_POPULARITY = 80;
const MAX_RD = 100;

interface CsvRow {
  PuzzleId: string;
  FEN: string;
  Moves: string;
  Rating: string;
  RatingDeviation: string;
  Popularity: string;
  NbPlays: string;
  Themes: string;
  GameUrl: string;
  OpeningTags: string;
}

interface SurvivorRow {
  PuzzleId: string;
  FEN: string;
  Moves: string;
  Rating: number;
  RatingDeviation: number;
  Popularity: number;
  NbPlays: number;
  Themes: string;
  GameUrl: string;
  OpeningTags: string;
}

interface RatingBand {
  id: string;
  min: number;
  max: number;
  target: number;
}

// Targets scaled 4× to match the 200k TARGET_COUNT. Sum: 200,000.
const BANDS: RatingBand[] = [
  { id: 'B0', min: 600, max: 999, target: 16_000 },
  { id: 'B1', min: 1000, max: 1199, target: 20_000 },
  { id: 'B2', min: 1200, max: 1399, target: 24_000 },
  { id: 'B3', min: 1400, max: 1599, target: 28_000 },
  { id: 'B4', min: 1600, max: 1799, target: 28_000 },
  { id: 'B5', min: 1800, max: 1999, target: 24_000 },
  { id: 'B6', min: 2000, max: 2199, target: 22_000 },
  { id: 'B7', min: 2200, max: 2399, target: 20_000 },
  { id: 'B8', min: 2400, max: 4000, target: 18_000 },
];

const MAJOR_THEMES = [
  'fork', 'pin', 'skewer', 'discoveredAttack', 'hangingPiece', 'sacrifice',
  'attraction', 'deflection', 'interference', 'clearance', 'quietMove', 'zugzwang',
  'mateIn1', 'mateIn2', 'mateIn3', 'backRankMate', 'smotheredMate',
  'opening', 'middlegame', 'endgame',
  'rookEndgame', 'pawnEndgame', 'queenEndgame',
  'promotion', 'underPromotion', 'castling',
];

// Mulberry32 PRNG — deterministic from a 32-bit seed
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bandOf(rating: number): RatingBand | null {
  return BANDS.find((b) => rating >= b.min && rating <= b.max) ?? null;
}

async function streamDecompressedCsv(): Promise<NodeJS.ReadableStream> {
  // fzstd is pure JS — fine for 280 MB but slow. Buffer-once, decompress to memory.
  const zstd = await import('node:fs').then((fs) => fs.promises.readFile(SOURCE_CSV_ZST));
  const decompressed = decompress(zstd);
  return Readable.from([Buffer.from(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength)]);
}

async function loadSurvivors(): Promise<SurvivorRow[]> {
  console.log('[build-puzzles] decompressing zst…');
  const stream = await streamDecompressedCsv();

  console.log('[build-puzzles] parsing + filtering CSV…');
  const survivors: SurvivorRow[] = [];

  const parser = stream.pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: false,
    }),
  );

  let total = 0;
  for await (const r of parser as AsyncIterable<CsvRow>) {
    total++;
    const rd = Number(r.RatingDeviation);
    const pop = Number(r.Popularity);
    const plays = Number(r.NbPlays);
    if (rd > MAX_RD) continue;
    if (pop < MIN_POPULARITY) continue;
    if (plays < MIN_NB_PLAYS) continue;
    survivors.push({
      PuzzleId: r.PuzzleId,
      FEN: r.FEN,
      Moves: r.Moves,
      Rating: Number(r.Rating),
      RatingDeviation: rd,
      Popularity: pop,
      NbPlays: plays,
      Themes: r.Themes ?? '',
      GameUrl: r.GameUrl ?? '',
      OpeningTags: r.OpeningTags ?? '',
    });
    if (total % 500_000 === 0) console.log(`[build-puzzles]   read ${total.toLocaleString()} rows, kept ${survivors.length.toLocaleString()}`);
  }
  console.log(`[build-puzzles] survivors: ${survivors.length.toLocaleString()} of ${total.toLocaleString()} after quality filters`);
  return survivors;
}

function pruneBalanced(survivors: SurvivorRow[], rng: () => number): SurvivorRow[] {
  const byBand = new Map<string, SurvivorRow[]>();
  for (const p of survivors) {
    const b = bandOf(p.Rating);
    if (!b) continue;
    const arr = byBand.get(b.id) ?? [];
    arr.push(p);
    byBand.set(b.id, arr);
  }

  const selected: SurvivorRow[] = [];
  for (const band of BANDS) {
    const pool = byBand.get(band.id) ?? [];
    const bandSelected: SurvivorRow[] = [];
    const seen = new Set<string>();

    const quotaPerTheme = Math.max(1, Math.ceil((band.target / MAJOR_THEMES.length) * 1.2));
    for (const theme of MAJOR_THEMES) {
      const candidates = pool
        .filter((p) => !seen.has(p.PuzzleId) && p.Themes.split(' ').includes(theme))
        .sort((a, b) => b.Popularity - a.Popularity || b.NbPlays - a.NbPlays || a.PuzzleId.localeCompare(b.PuzzleId));
      const pick = candidates.slice(0, quotaPerTheme);
      for (const p of pick) {
        seen.add(p.PuzzleId);
        bandSelected.push(p);
      }
    }

    // Shuffle (Fisher-Yates with seeded RNG) and trim/fill
    for (let i = bandSelected.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = bandSelected[i];
      bandSelected[i] = bandSelected[j]!;
      bandSelected[j] = tmp;
    }

    if (bandSelected.length > band.target) {
      bandSelected.length = band.target;
    } else if (bandSelected.length < band.target) {
      const remaining = pool.filter((p) => !seen.has(p.PuzzleId));
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = remaining[i];
        remaining[i] = remaining[j]!;
        remaining[j] = tmp;
      }
      const need = band.target - bandSelected.length;
      bandSelected.push(...remaining.slice(0, need));
    }

    console.log(`[build-puzzles]   band ${band.id} (${band.min}-${band.max}): ${bandSelected.length} / ${band.target}`);
    selected.push(...bandSelected);
  }

  console.log(`[build-puzzles] selected ${selected.length} puzzles total`);
  return selected;
}

const SCHEMA_SQL = `
CREATE TABLE puzzles (
  id TEXT PRIMARY KEY,
  fen TEXT NOT NULL,
  moves TEXT NOT NULL,
  rating INTEGER NOT NULL,
  rating_dev INTEGER NOT NULL,
  popularity INTEGER NOT NULL,
  nb_plays INTEGER NOT NULL,
  game_url TEXT
) WITHOUT ROWID;
CREATE TABLE themes (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);
CREATE TABLE puzzle_themes (
  puzzle_id TEXT NOT NULL,
  theme_id INTEGER NOT NULL,
  PRIMARY KEY (puzzle_id, theme_id)
) WITHOUT ROWID;
CREATE TABLE opening_tags (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);
CREATE TABLE puzzle_opening_tags (
  puzzle_id TEXT NOT NULL,
  opening_tag_id INTEGER NOT NULL,
  PRIMARY KEY (puzzle_id, opening_tag_id)
) WITHOUT ROWID;
`;

const INDEX_SQL = `
CREATE INDEX idx_puzzles_rating ON puzzles(rating);
CREATE INDEX idx_puzzle_themes_theme_puzzle ON puzzle_themes(theme_id, puzzle_id);
CREATE INDEX idx_puzzle_opening_tag_puzzle ON puzzle_opening_tags(opening_tag_id, puzzle_id);
`;

function writeDb(selected: SurvivorRow[]): { themesCount: number; openingTagsCount: number } {
  if (existsSync(TARGET_DB)) {
    console.log(`[build-puzzles] removing existing ${TARGET_DB}`);
    unlinkSync(TARGET_DB);
  }
  console.log('[build-puzzles] creating SQLite DB…');
  const db = new Database(TARGET_DB);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.pragma('temp_store = MEMORY');
  db.exec(SCHEMA_SQL);

  const insertPuzzle = db.prepare('INSERT INTO puzzles (id, fen, moves, rating, rating_dev, popularity, nb_plays, game_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertTheme = db.prepare('INSERT OR IGNORE INTO themes (name) VALUES (?)');
  const getThemeId = db.prepare('SELECT id FROM themes WHERE name = ?');
  const insertPuzzleTheme = db.prepare('INSERT OR IGNORE INTO puzzle_themes (puzzle_id, theme_id) VALUES (?, ?)');
  const insertOpeningTag = db.prepare('INSERT OR IGNORE INTO opening_tags (name) VALUES (?)');
  const getOpeningTagId = db.prepare('SELECT id FROM opening_tags WHERE name = ?');
  const insertPuzzleOpening = db.prepare('INSERT OR IGNORE INTO puzzle_opening_tags (puzzle_id, opening_tag_id) VALUES (?, ?)');

  const themeIdCache = new Map<string, number>();
  const openingTagCache = new Map<string, number>();

  const txn = db.transaction((rows: SurvivorRow[]) => {
    for (const r of rows) {
      insertPuzzle.run(r.PuzzleId, r.FEN, r.Moves, r.Rating, r.RatingDeviation, r.Popularity, r.NbPlays, r.GameUrl || null);
      for (const theme of r.Themes.split(' ').filter(Boolean)) {
        let tid = themeIdCache.get(theme);
        if (tid === undefined) {
          insertTheme.run(theme);
          const row = getThemeId.get(theme) as { id: number } | undefined;
          if (!row) continue;
          tid = row.id;
          themeIdCache.set(theme, tid);
        }
        insertPuzzleTheme.run(r.PuzzleId, tid);
      }
      for (const tag of r.OpeningTags.split(' ').filter(Boolean)) {
        let oid = openingTagCache.get(tag);
        if (oid === undefined) {
          insertOpeningTag.run(tag);
          const row = getOpeningTagId.get(tag) as { id: number } | undefined;
          if (!row) continue;
          oid = row.id;
          openingTagCache.set(tag, oid);
        }
        insertPuzzleOpening.run(r.PuzzleId, oid);
      }
      void getThemeId;
      void getOpeningTagId;
    }
  });
  txn(selected);

  console.log('[build-puzzles] adding indices…');
  db.exec(INDEX_SQL);
  console.log('[build-puzzles] ANALYZE + VACUUM…');
  db.exec('ANALYZE;');
  db.exec('VACUUM;');
  db.close();

  return { themesCount: themeIdCache.size, openingTagsCount: openingTagCache.size };
}

const PUZZLE_DUMP_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

async function ensureSourceDownloaded(): Promise<void> {
  if (existsSync(SOURCE_CSV_ZST)) return;
  console.log(`[build-puzzles] source not found at ${SOURCE_CSV_ZST}`);
  console.log(`[build-puzzles] downloading from ${PUZZLE_DUMP_URL} (~280 MB, may take a few minutes)…`);
  mkdirSync(dirname(SOURCE_CSV_ZST), { recursive: true });
  const res = await fetch(PUZZLE_DUMP_URL);
  if (!res.ok) {
    throw new Error(`[build-puzzles] download failed: HTTP ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error('[build-puzzles] download failed: empty response body');
  }
  const { createWriteStream } = await import('node:fs');
  const { pipeline } = await import('node:stream/promises');
  const fileStream = createWriteStream(SOURCE_CSV_ZST);
  await pipeline(Readable.fromWeb(res.body as never), fileStream);
  console.log(`[build-puzzles] saved to ${SOURCE_CSV_ZST}`);
}

async function main(): Promise<void> {
  await ensureSourceDownloaded();

  const sourceStat = statSync(SOURCE_CSV_ZST);
  console.log(`[build-puzzles] source: ${SOURCE_CSV_ZST} (${(sourceStat.size / 1024 / 1024).toFixed(1)} MB)`);

  if (!existsSync(dirname(TARGET_DB))) mkdirSync(dirname(TARGET_DB), { recursive: true });

  const survivors = await loadSurvivors();
  const rng = mulberry32(RNG_SEED);
  const selected = pruneBalanced(survivors, rng);
  const stats = writeDb(selected);

  const finalSize = statSync(TARGET_DB).size;
  console.log(`[build-puzzles] wrote ${TARGET_DB} (${(finalSize / 1024 / 1024).toFixed(1)} MB)`);

  const manifest = {
    sourceFile: SOURCE_CSV_ZST.replace(REPO_ROOT, '.'),
    sourceSizeBytes: sourceStat.size,
    builtAt: new Date().toISOString(),
    rngSeed: RNG_SEED,
    minNbPlays: MIN_NB_PLAYS,
    minPopularity: MIN_POPULARITY,
    maxRd: MAX_RD,
    targetCount: TARGET_COUNT,
    actualCount: selected.length,
    themesCount: stats.themesCount,
    openingTagsCount: stats.openingTagsCount,
    bandTargets: BANDS.map((b) => ({ id: b.id, min: b.min, max: b.max, target: b.target })),
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[build-puzzles] wrote manifest ${MANIFEST}`);
  console.log('[build-puzzles] done.');
}

void main().catch((err: Error) => {
  console.error('[build-puzzles] failed:', err.message);
  process.exit(1);
});
