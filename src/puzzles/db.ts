/*
 * sqlite-wasm runtime wrapper for the puzzles DB.
 *
 * On first call we:
 *   1. Boot the official @sqlite.org/sqlite-wasm runtime. We pass `locateFile`
 *      pointing at /sqlite/sqlite3.wasm — vendor-sqlite.ts copied it there at
 *      build time. (Without locateFile, Emscripten's default URL resolution
 *      breaks under Vite's bundler and we fetch index.html, which fails as
 *      WASM with "expected magic word 00 61 73 6d, found 3c 21 64 6f".)
 *   2. Fetch /puzzles.db over HTTP into memory.
 *   3. Open it through the in-memory VFS (ephemeral; OPFS is a polish-pass).
 *
 * Why sqlite-wasm vs sql.js: smaller wasm, official, OPFS-capable, faster.
 */

import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm';

const PUZZLES_URL = '/puzzles.db';
const SQLITE_WASM_DIR = '/sqlite/';

interface PuzzleRow {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  rating_dev: number;
  popularity: number;
  nb_plays: number;
  /** Space-separated theme slugs (canonical Lichess vocab). */
  themes: string;
}

export interface PuzzleQueryOpts {
  themes?: string[];
  /**
   * Lichess opening slugs (e.g. `Sicilian_Defense_Najdorf_Variation`). Each
   * entry may either be an exact slug — matched with `name = ?` — or end in
   * `%` to indicate a LIKE prefix match (e.g. `Italian_Game%` matches every
   * Italian sub-variation). Mixing the two forms in a single call is
   * supported; results are de-duplicated by puzzle id via GROUP BY.
   */
  openingTags?: string[];
  ratingMin?: number;
  ratingMax?: number;
  limit?: number;
  randomSeed?: number;
}

export class PuzzlesDb {
  private static loadingPromise: Promise<PuzzlesDb> | null = null;

  private constructor(private readonly db: Database) {}

  static async load(): Promise<PuzzlesDb> {
    if (PuzzlesDb.loadingPromise) return PuzzlesDb.loadingPromise;
    PuzzlesDb.loadingPromise = (async () => {
      const sqlite3 = await sqlite3InitModule({
        print: () => {},
        printErr: (msg: string) => console.warn('[sqlite-wasm]', msg),
        locateFile: (filename: string) => `${SQLITE_WASM_DIR}${filename}`,
      });
      const res = await fetch(PUZZLES_URL);
      if (!res.ok) {
        throw new Error(
          `puzzles.db fetch failed: HTTP ${res.status}. Run \`npm run setup\` (or \`npm run build:puzzles\`) to populate it.`,
        );
      }
      const buf = new Uint8Array(await res.arrayBuffer());

      // SQLite databases start with the magic string "SQLite format 3\0"
      // (16 bytes). Vite's dev server falls back to index.html for missing
      // routes, so a fresh clone without the puzzle DB sees a 200 response
      // whose body is HTML, which then fails deeper inside sqlite3 with a
      // cryptic SQLITE_NOTADB. Sniff the magic bytes here so we can throw
      // a clear, actionable error before sqlite even gets the buffer.
      const isSqlite = buf.length >= 16
        && buf[0] === 0x53 && buf[1] === 0x51 && buf[2] === 0x4c
        && buf[3] === 0x69 && buf[4] === 0x74 && buf[5] === 0x65;
      if (!isSqlite) {
        throw new Error(
          'puzzles.db is missing or malformed. Run `npm run setup` (or `npm run build:puzzles`) to download + ingest the Lichess puzzle dump (~280 MB → ~55 MB DB). Subsequent boots are fast.',
        );
      }

      const db = new sqlite3.oo1.DB(':memory:', 'c');
      const dbHandle = (db as unknown as { pointer: number }).pointer;
      const p = sqlite3.wasm.allocFromTypedArray(buf);
      const rc = sqlite3.capi.sqlite3_deserialize(
        dbHandle,
        'main',
        p,
        buf.byteLength,
        buf.byteLength,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
      );
      if (rc !== 0) throw new Error(`sqlite3_deserialize failed (rc=${rc})`);
      return new PuzzlesDb(db);
    })();
    return PuzzlesDb.loadingPromise;
  }

  themes(): string[] {
    const rows = this.db.exec({
      sql: 'SELECT name FROM themes ORDER BY name',
      returnValue: 'resultRows',
      rowMode: 'object',
    }) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  /**
   * Sorted, de-duplicated list of every opening tag present in the DB
   * (e.g. `Sicilian_Defense_Najdorf_Variation`). Used by the Tactics
   * filter UI to drive opening-name autocomplete; the user types a
   * substring and we filter this list client-side rather than hitting
   * sqlite for every keystroke.
   */
  openingTags(): string[] {
    const rows = this.db.exec({
      sql: 'SELECT name FROM opening_tags ORDER BY name',
      returnValue: 'resultRows',
      rowMode: 'object',
    }) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  query(opts: PuzzleQueryOpts = {}): PuzzleRow[] {
    const { themes = [], openingTags = [], ratingMin = 600, ratingMax = 3200, limit = 20 } = opts;

    const whereParts: string[] = ['p.rating BETWEEN ? AND ?'];
    const args: (string | number)[] = [ratingMin, ratingMax];

    let from = 'puzzles p';
    if (themes.length > 0) {
      from += ` JOIN puzzle_themes pt ON pt.puzzle_id = p.id JOIN themes t ON t.id = pt.theme_id`;
      const placeholders = themes.map(() => '?').join(',');
      whereParts.push(`t.name IN (${placeholders})`);
      args.push(...themes);
    }

    if (openingTags.length > 0) {
      from += ` JOIN puzzle_opening_tags pot ON pot.puzzle_id = p.id JOIN opening_tags ot ON ot.id = pot.opening_tag_id`;
      // Split into exact matches (IN clause — single SQL fragment) and
      // prefix matches (one LIKE per entry). They OR together so the
      // AND with the rating predicate stays correct.
      const exact: string[] = [];
      const likes: string[] = [];
      for (const tag of openingTags) {
        if (tag.endsWith('%')) likes.push(tag);
        else exact.push(tag);
      }
      const ors: string[] = [];
      if (exact.length > 0) {
        const placeholders = exact.map(() => '?').join(',');
        ors.push(`ot.name IN (${placeholders})`);
        args.push(...exact);
      }
      for (const lk of likes) {
        ors.push(`ot.name LIKE ?`);
        args.push(lk);
      }
      whereParts.push(`(${ors.join(' OR ')})`);
    }

    const sql = `
      SELECT
        p.id, p.fen, p.moves, p.rating, p.rating_dev, p.popularity, p.nb_plays,
        COALESCE(
          (SELECT GROUP_CONCAT(t2.name, ' ')
             FROM puzzle_themes pt2 JOIN themes t2 ON t2.id = pt2.theme_id
             WHERE pt2.puzzle_id = p.id),
          ''
        ) AS themes
      FROM ${from}
      WHERE ${whereParts.join(' AND ')}
      GROUP BY p.id
      ORDER BY RANDOM()
      LIMIT ?
    `;
    args.push(limit);

    return this.db.exec({
      sql,
      bind: args,
      returnValue: 'resultRows',
      rowMode: 'object',
    }) as unknown as PuzzleRow[];
  }

  /**
   * Convenience helper for the cross-link from the Openings page —
   * `puzzlesForOpening('Italian_Game', 25)` runs a prefix LIKE without
   * any theme filtering. Useful for "give me 25 Italian Game puzzles"
   * without forcing the caller to construct the LIKE wildcard or pass
   * the full PuzzleQueryOpts shape.
   */
  puzzlesForOpening(openingTagPrefix: string, limit: number): PuzzleRow[] {
    const prefix = openingTagPrefix.endsWith('%') ? openingTagPrefix : `${openingTagPrefix}%`;
    return this.query({ openingTags: [prefix], limit });
  }

  count(): number {
    const rows = this.db.exec({
      sql: 'SELECT COUNT(*) AS n FROM puzzles',
      returnValue: 'resultRows',
      rowMode: 'object',
    }) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /**
   * Count of distinct puzzles whose opening tag matches the given
   * prefix. Used by the Openings detail's Puzzles tab to surface
   * "23 Italian Game puzzles available" without having to pull the
   * full puzzle rows when we only render a sample of them.
   */
  countForOpening(openingTagPrefix: string): number {
    const prefix = openingTagPrefix.endsWith('%') ? openingTagPrefix : `${openingTagPrefix}%`;
    const rows = this.db.exec({
      sql: `
        SELECT COUNT(DISTINCT p.id) AS n
          FROM puzzles p
          JOIN puzzle_opening_tags pot ON pot.puzzle_id = p.id
          JOIN opening_tags ot ON ot.id = pot.opening_tag_id
         WHERE ot.name LIKE ?
      `,
      bind: [prefix],
      returnValue: 'resultRows',
      rowMode: 'object',
    }) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }
}

export type { PuzzleRow };
