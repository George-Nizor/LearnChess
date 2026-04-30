/*
 * Line selector — pick the next line for the user to drill.
 *
 * Strategy (chessdriller-derived, see docs/research/opening-trainers.md §2.3):
 *   1. BFS from the starting position, walking the move graph.
 *   2. At each branch, prefer paths that contain due own-moves
 *      (learning_due first, then review_due).
 *   3. For opponent moves: pick the heaviest-weighted reply (so the drill
 *      always replays the most-popular opponent response).
 *   4. Stop the walk when a line ends (no children) or after `maxPly` moves.
 *
 * The returned line is a sequence of moves from the starting position to a
 * terminal (or to maxPly), with opponent moves auto-resolved. The drill UI
 * replays it from the start, pausing at every own-move for input.
 */

import type { RepMove } from './types';
import { isDue } from './scheduler';
import { allMoves } from './db';
import { STARTING_FEN_NORM } from './fen';

export interface DrillLine {
  startFen: string;
  /** Sequence of edges from start to the line's end. */
  edges: RepMove[];
}

interface Score {
  hasLearningDue: boolean;
  hasReviewDue: boolean;
  earliestDueAt: number;     // earliest learning/review dueAt across own-moves on the line
  ownMoveCount: number;
}

function emptyScore(): Score {
  return { hasLearningDue: false, hasReviewDue: false, earliestDueAt: Number.POSITIVE_INFINITY, ownMoveCount: 0 };
}

function combine(a: Score, b: Score): Score {
  return {
    hasLearningDue: a.hasLearningDue || b.hasLearningDue,
    hasReviewDue: a.hasReviewDue || b.hasReviewDue,
    earliestDueAt: Math.min(a.earliestDueAt, b.earliestDueAt),
    ownMoveCount: a.ownMoveCount + b.ownMoveCount,
  };
}

function scoreOwnMove(move: RepMove, now: number): Score {
  if (!move.isOwnMove || move.deleted) return emptyScore();
  if (!isDue(move, now)) return { hasLearningDue: false, hasReviewDue: false, earliestDueAt: Number.POSITIVE_INFINITY, ownMoveCount: 1 };
  const dueAt = move.learningDueAt ?? move.reviewDueAt ?? Number.POSITIVE_INFINITY;
  return {
    hasLearningDue: move.learningDueAt !== null,
    hasReviewDue: move.reviewDueAt !== null,
    earliestDueAt: dueAt,
    ownMoveCount: 1,
  };
}

/** Compare two scores; positive = a is more important to drill first. */
function compareScores(a: Score, b: Score): number {
  if (a.hasLearningDue !== b.hasLearningDue) return a.hasLearningDue ? 1 : -1;
  if (a.hasReviewDue !== b.hasReviewDue) return a.hasReviewDue ? 1 : -1;
  if (a.earliestDueAt !== b.earliestDueAt) return -(a.earliestDueAt - b.earliestDueAt);
  return 0;
}

/**
 * Pick an opponent reply weighted-randomly by `weight`.
 *
 * Was: `reduce` to the heaviest weight — deterministic, so every Pirc drill
 * picked Byrne (the lessons-only branch with weight bumped above book) and
 * the user could never reach Classical / Austrian / 150 Attack / Deep Plan
 * without manually changing the URL. Roulette-wheel sampling restores
 * variety: at a branch with weights [0.5, 0.3, 0.2, 0.05] we get those
 * proportions of branches across many drills, instead of 100% of the
 * heaviest.
 *
 * `rng` is injectable so tests can pin a seed.
 */
function pickOpponentReply(candidates: RepMove[], rng: () => number): RepMove | null {
  if (candidates.length === 0) return null;
  const weights = candidates.map((c) => Math.max(0, c.weight ?? 0));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) {
    // Degenerate: no weight signal. Pick any candidate uniformly so the
    // drill still progresses.
    return candidates[Math.floor(rng() * candidates.length)] ?? candidates[0]!;
  }
  let r = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i] ?? 0;
    if (r <= 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

export interface SelectLineOpts {
  startFen?: string;
  maxPly?: number;
  now?: number;
  /** Random source for tie-breaking (defaults to Math.random). */
  rng?: () => number;
}

/**
 * Select the next line to drill from a repertoire.
 * Walks the move graph from `startFen`, preferring branches with due own-moves.
 *
 * Returns null if the repertoire has no moves at all.
 */
export async function selectDrillLine(repertoireId: number, opts: SelectLineOpts = {}): Promise<DrillLine | null> {
  const startFen = opts.startFen ?? STARTING_FEN_NORM;
  const maxPly = opts.maxPly ?? 30;
  const now = opts.now ?? Date.now();
  const rng = opts.rng ?? Math.random;

  // Pre-load all moves so we can compute branch scores without N round-trips
  const allRepMoves = await allMoves(repertoireId);
  if (allRepMoves.length === 0) return null;
  const byFromFen = new Map<string, RepMove[]>();
  for (const m of allRepMoves) {
    const arr = byFromFen.get(m.fromFen) ?? [];
    arr.push(m);
    byFromFen.set(m.fromFen, arr);
  }

  // Recursive DFS: returns the best line from `fen`, plus its score
  function bestFrom(fen: string, depth: number): { edges: RepMove[]; score: Score } {
    if (depth >= maxPly) return { edges: [], score: emptyScore() };
    const candidates = byFromFen.get(fen) ?? [];
    if (candidates.length === 0) return { edges: [], score: emptyScore() };

    // Decide whose move it is by inspecting the first candidate (they're all
    // from the same fen → same side to move)
    const first = candidates[0]!;
    if (first.isOwnMove) {
      // Score every own-move and recurse on each, pick the best path
      let best: { edges: RepMove[]; score: Score } | null = null;
      const ranked = candidates
        .filter((c) => !c.deleted)
        .map((c) => {
          const tail = bestFrom(c.toFen, depth + 1);
          const score = combine(scoreOwnMove(c, now), tail.score);
          return { edges: [c, ...tail.edges], score };
        });
      // Tie-breaking: shuffle deterministically using the rng
      ranked.sort((a, b) => {
        const cmp = compareScores(a.score, b.score);
        if (cmp !== 0) return -cmp;
        return rng() - 0.5;
      });
      best = ranked[0] ?? null;
      return best ?? { edges: [], score: emptyScore() };
    }

    // Opponent's move: weighted-random pick from non-deleted replies, recurse
    const reply = pickOpponentReply(candidates.filter((c) => !c.deleted), rng);
    if (!reply) return { edges: [], score: emptyScore() };
    const tail = bestFrom(reply.toFen, depth + 1);
    return { edges: [reply, ...tail.edges], score: tail.score };
  }

  const { edges } = bestFrom(startFen, 0);
  if (edges.length === 0) return null;
  return { startFen, edges };
}

export { STARTING_FEN_NORM };
