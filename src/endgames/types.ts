/*
 * Endgame Course module — type definitions.
 *
 * Mirrors `src/openings/types.ts` in spirit (curated → grouped → trainable),
 * but the underlying graph is much smaller: an endgame is a single FEN with
 * an optimal continuation graded by the Lichess Syzygy tablebase, not a
 * tree of own-moves.
 *
 * Architectural decision (mirrors lichess `lila/modules/practice`): a Course
 * is a study; a Position is a chapter; the prose Lesson is the chapter's
 * "summary text + per-node explanation" payload. We don't duplicate the
 * curated `EndgamePosition` data — `src/chess/endgames/positions.ts` stays
 * the single source of truth and `EndgameCourse` simply *references*
 * positions by id.
 */

import type { EndgamePosition } from '@/chess/endgames/positions';

/** A curated curriculum: a named bundle of related endgame positions. */
export interface EndgameCourse {
  /** Stable id used in URL fragments and IndexedDB keys. */
  id: string;
  /** Human-friendly course name shown in the sidebar header. */
  name: string;
  /** One-line tagline rendered under the course name. */
  description: string;
  /** Underlying `EndgamePosition.category` this course bundles. */
  category: EndgamePosition['category'];
  /** Ordered list of curated positions that make up this course. Insertion
   *  order is the curriculum order — earlier positions are more foundational. */
  positions: EndgamePosition[];
}

/**
 * Per-position prose lesson. Walks the *optimal* tablebase line move by move
 * with one prose explanation per ply. Authored by hand; FENs are validated
 * against a chess.js replay at vitest-run time (see `lessons.ts`).
 */
export interface EndgameLesson {
  /** Matches the `EndgamePosition.id` it teaches. */
  positionId: string;
  /** Human-friendly title for the lesson card. */
  title: string;
  /** Short tagline rendered under the title. */
  tagline: string;
  /** Sequenced nodes — replayed in order during Learn mode. */
  nodes: EndgameLessonNode[];
}

/** One step in an `EndgameLesson`. Mirrors `LessonNode` in `src/openings/lessons.ts`. */
export interface EndgameLessonNode {
  /** Normalised FEN of the position AFTER the move (use `normFen`). */
  fen: string;
  /** SAN of the move that led here. Omit for the starting position only. */
  san?: string;
  /** Prose explanation. 1-4 sentences. Use **bold** for moves and key squares. */
  text: string;
}
