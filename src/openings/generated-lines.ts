/*
 * AUTO-GENERATED FILE — placeholder until the Tier-A pipeline runs.
 *
 * Once `npm run content:tree` and `npm run content:gen` produce real
 * output, this file is overwritten with the actual generated stubs.
 * lessons.ts imports GENERATED_LINES from here and merges them into
 * each opening's lines (with the `generated` flag preserved so the
 * Learn / Drill / line-picker UI can mark them as draft).
 *
 * See docs/CONTENT_SOURCING_PLAN.md for the full pipeline.
 *
 * To populate this file:
 *   1. Download a PGN dump from https://database.lichess.org/
 *      (Lichess Masters DB recommended; Standard DB filtered by
 *      --min-elo 2200 also works).
 *   2. zstd -dc lichess-masters.pgn.zst | npm run content:tree -- \
 *        --input - --output public/opening-tree.json --max-plies 14
 *   3. npm run content:gen
 *
 * Step 3 overwrites this file with auto-generated line stubs that
 * appear in the app immediately on the next dev/preview reload.
 */

export interface GeneratedLineSpec {
  id: string;
  openingId: string;
  name: string;
  description: string;
  intro: string;
  moves: { san: string; text: string }[];
  generated: { source: 'lichess-masters'; gamesAtTabiya: number };
}

/**
 * Empty until the pipeline runs. The merge in lessons.ts is a no-op
 * for empty input — your hand-authored lines stay exactly as-is.
 */
export const GENERATED_LINES: GeneratedLineSpec[] = [];
