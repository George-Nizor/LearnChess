/*
 * Repertoire importers.
 *
 * - `importCuratedSpec`  — convert one of the existing hand-curated SPECS
 *   from `chess/openings/book.ts` into the flat-move repertoire format.
 * - `importPgn`          — parse a PGN string (mainline + variations) into
 *   moves. Walks recursively via chess.js's history + RAV variations.
 * - `importLichessStudy` — fetch a public Lichess study by ID and import.
 */

import { Chess } from 'chess.js';
import type { Opening, OpeningNode } from '@/chess/openings/book';
import { normFen, STARTING_FEN_NORM, sideToMoveOf } from './fen';
import { freshSrsState } from './scheduler';
import { allMoves, bulkPutMoves, createRepertoire, findRepertoireBySource, putMove } from './db';
import type { RepMove } from './types';
import { OPENING_COURSES, type OpeningCourse } from './lessons';

const STARTING_FEN_FULL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Normalised top-of-children weight so the trainer can pick "the heaviest"
function normaliseWeights<T extends { weight?: number }>(siblings: T[]): void {
  const total = siblings.reduce((s, c) => s + (c.weight ?? 0), 0);
  if (total === 0) return;
  for (const s of siblings) s.weight = (s.weight ?? 0) / total;
}

/** Build a RepMove from a parent FEN and a child OpeningNode. */
function nodeToMove(parentFen: string, node: OpeningNode, repertoireId: number, isOwnMove: boolean, weight: number): RepMove {
  const game = new Chess(parentFen);
  const m = game.move(node.san);
  const srs = freshSrsState();
  return {
    repertoireId,
    fromFen: normFen(parentFen),
    toFen: normFen(game.fen()),
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ''),
    isOwnMove,
    weight,
    ...(node.comment !== undefined ? { comment: node.comment } : {}),
    deleted: false,
    learningStep: srs.learningStep ?? 0,
    learningDueAt: srs.learningDueAt ?? Date.now(),
    reviewIntervalDays: srs.reviewIntervalDays ?? null,
    reviewDueAt: srs.reviewDueAt ?? null,
    reviewEase: srs.reviewEase ?? 2.5,
  };
}

/**
 * Import a curated `Opening` (from src/chess/openings/book.ts) into the rep
 * DB. Idempotent — re-running on an existing rep BACKFILLS any new edges
 * introduced by changes to book.ts or lessons.ts (without touching
 * existing SRS state on edges that are unchanged). Necessary because the
 * lesson sidecar (lessons.ts) is content-iterated separately from book.ts
 * and we want users to pick up new lesson lines without nuking IDB.
 */
export async function importCuratedSpec(opening: Opening): Promise<number> {
  const existing = await findRepertoireBySource('curated', opening.id);
  const repertoireId = existing
    ? existing.id
    : await createRepertoire({
        name: opening.name,
        repForWhite: opening.forColor === 'w',
        createdAt: Date.now(),
        sourceKind: 'curated',
        sourceLabel: opening.id,
        description: opening.description,
      });

  const moves: RepMove[] = [];
  const userSide: 'w' | 'b' = opening.forColor;

  function walk(parentFen: string, children: OpeningNode[]): void {
    if (children.length === 0) return;
    // Normalise sibling weights so the trainer's "pick heaviest" works without
    // knowing absolute scales.
    const siblings = children.map((c) => ({ ...c }));
    normaliseWeights(siblings);
    const sideAtParent = sideToMoveOf(parentFen);
    const isOwn = sideAtParent === userSide;
    for (const child of siblings) {
      // Build the child node by re-running through the original tree (we have
      // the fen on the original child, but use the spec's authoritative
      // recomputation via chess.js to be safe).
      const original = children.find((c) => c.san === child.san);
      if (!original) continue;
      const move = nodeToMove(parentFen, original, repertoireId, isOwn, child.weight ?? 0);
      moves.push(move);
      if (original.children && original.children.length > 0) {
        walk(original.fen, original.children);
      }
    }
  }

  // The opening.tree is a synthetic root; its children are the first real moves
  walk(STARTING_FEN_FULL, opening.tree.children ?? []);

  // Augment with lesson lines from `lessons.ts` (if a matching course
  // exists). The book.ts tree is necessarily shallow — broad coverage of
  // multiple replies — but each lesson line dives 12-14 plies into a
  // specific tabiya. Without this merge, the drill stops when book.ts
  // does (e.g. Pirc beyond move 6). Walking the lessons gives the user
  // the full authored line as a drillable sequence.
  const course = OPENING_COURSES[opening.id];
  if (course !== undefined) {
    moves.push(...lessonCourseMoves(course, repertoireId, userSide));
  }

  // Dedupe edges that share the same (fromFen, toFen) — could happen via
  // transpositions, or from book/lesson overlap on early moves.
  const dedup = new Map<string, RepMove>();
  for (const m of moves) {
    const key = m.fromFen + '|' + m.toFen;
    const existing = dedup.get(key);
    if (existing) {
      // Keep the higher-weight one; preserve own-move flag if either says so
      if ((m.weight ?? 0) > (existing.weight ?? 0)) dedup.set(key, m);
    } else {
      dedup.set(key, m);
    }
  }

  // Backfill: only insert edges that don't already exist for this rep, so
  // we never clobber the user's accumulated SRS state on a re-import.
  let toInsert = [...dedup.values()];
  if (existing) {
    const have = new Set((await allMoves(repertoireId)).map((m) => m.fromFen + '|' + m.toFen));
    toInsert = toInsert.filter((m) => !have.has(m.fromFen + '|' + m.toFen));
  }

  await bulkPutMoves(toInsert);
  return repertoireId;
}

/**
 * Convert a curated `OpeningCourse` (from `lessons.ts`) into RepMove edges.
 * Each line is a linear chain of moves; we walk it through chess.js to get
 * authoritative SAN/FEN at every ply, then emit one RepMove per edge.
 *
 * Move weights default to 1 — these are deeper continuations beyond the
 * book.ts tree, so they shouldn't outrank the carefully-tuned book weights
 * for branches the book already covers (the dedup pass keeps book entries
 * when both exist for the same edge).
 */
function lessonCourseMoves(course: OpeningCourse, repertoireId: number, userSide: 'w' | 'b'): RepMove[] {
  const out: RepMove[] = [];
  for (const line of course.lines) {
    const game = new Chess();
    let parentFen = STARTING_FEN_FULL;
    for (const node of line.nodes) {
      if (node.san === undefined) continue; // skip the intro/start node
      let move;
      try {
        move = game.move(node.san);
      } catch {
        // Author error in lessons.ts — should have been caught at module
        // load. Skip the rest of the line so one bad node doesn't poison
        // the whole import.
        break;
      }
      const isOwn = sideToMoveOf(parentFen) === userSide;
      const srs = freshSrsState();
      out.push({
        repertoireId,
        fromFen: normFen(parentFen),
        toFen: normFen(game.fen()),
        san: move.san,
        uci: move.from + move.to + (move.promotion ?? ''),
        isOwnMove: isOwn,
        weight: 1,
        deleted: false,
        learningStep: srs.learningStep ?? 0,
        learningDueAt: srs.learningDueAt ?? Date.now(),
        reviewIntervalDays: srs.reviewIntervalDays ?? null,
        reviewDueAt: srs.reviewDueAt ?? null,
        reviewEase: srs.reviewEase ?? 2.5,
      });
      parentFen = game.fen();
    }
  }
  return out;
}

/**
 * Import a PGN string. Walks the mainline + variations.
 * `userColor` says which side's moves are drillable.
 */
export async function importPgn(opts: {
  pgn: string;
  name: string;
  userColor: 'w' | 'b';
  sourceLabel?: string;
}): Promise<number> {
  const repertoireId = await createRepertoire({
    name: opts.name,
    repForWhite: opts.userColor === 'w',
    createdAt: Date.now(),
    sourceKind: 'pgn',
    ...(opts.sourceLabel !== undefined ? { sourceLabel: opts.sourceLabel } : {}),
  });

  const moves: RepMove[] = [];
  const seen = new Set<string>();

  // chess.js doesn't directly expose RAV variations; we walk the PGN by
  // re-parsing each game (multi-game PGN files are common). For each game,
  // we only walk the mainline (variations require manual PGN traversal).
  const games = splitPgnGames(opts.pgn);
  for (const single of games) {
    const game = new Chess();
    try {
      game.loadPgn(single, { strict: false });
    } catch {
      continue;
    }
    const history = game.history({ verbose: true });
    const cursor = new Chess();
    for (const h of history) {
      const fromFen = cursor.fen();
      try {
        cursor.move({ from: h.from, to: h.to, promotion: h.promotion ?? 'q' });
      } catch {
        break;
      }
      const fromN = normFen(fromFen);
      const toN = normFen(cursor.fen());
      const key = fromN + '|' + toN;
      if (seen.has(key)) continue;
      seen.add(key);
      const isOwn = sideToMoveOf(fromN) === opts.userColor;
      const srs = freshSrsState();
      moves.push({
        repertoireId,
        fromFen: fromN,
        toFen: toN,
        san: h.san,
        uci: h.from + h.to + (h.promotion ?? ''),
        isOwnMove: isOwn,
        weight: 1,
        deleted: false,
        learningStep: srs.learningStep ?? 0,
        learningDueAt: srs.learningDueAt ?? Date.now(),
        reviewIntervalDays: srs.reviewIntervalDays ?? null,
        reviewDueAt: srs.reviewDueAt ?? null,
        reviewEase: srs.reviewEase ?? 2.5,
      });
    }
  }

  await bulkPutMoves(moves);
  return repertoireId;
}

/** Crude PGN splitter — splits at empty lines between games. */
function splitPgnGames(pgn: string): string[] {
  const out: string[] = [];
  const lines = pgn.split(/\r?\n/);
  let buf: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && buf.length > 0 && buf.some((b) => b.includes('1.'))) {
      out.push(buf.join('\n'));
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.length > 0) out.push(buf.join('\n'));
  return out.filter((g) => g.trim().length > 0);
}

/** Fetch a public Lichess study and import all chapters. No auth needed for public studies. */
export async function importLichessStudy(opts: { studyId: string; name: string; userColor: 'w' | 'b' }): Promise<number> {
  const url = `https://lichess.org/api/study/${opts.studyId}.pgn`;
  const res = await fetch(url, { headers: { Accept: 'application/x-chess-pgn' } });
  if (!res.ok) throw new Error(`Lichess study fetch failed: HTTP ${res.status}`);
  const pgn = await res.text();
  return importPgn({ pgn, name: opts.name, userColor: opts.userColor, sourceLabel: `lichess:${opts.studyId}` });
}

export { STARTING_FEN_NORM };

/** Convenience: import a single rep move directly (for tests and seeding). */
export async function importSingleMove(rm: Omit<RepMove, 'deleted' | 'learningStep' | 'learningDueAt' | 'reviewIntervalDays' | 'reviewDueAt' | 'reviewEase'>): Promise<void> {
  const srs = freshSrsState();
  await putMove({
    ...rm,
    deleted: false,
    learningStep: srs.learningStep ?? 0,
    learningDueAt: srs.learningDueAt ?? Date.now(),
    reviewIntervalDays: srs.reviewIntervalDays ?? null,
    reviewDueAt: srs.reviewDueAt ?? null,
    reviewEase: srs.reviewEase ?? 2.5,
  });
}
