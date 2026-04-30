/*
 * Opening repertoire trainer — data types.
 *
 * Design lifted from chessdriller (gtim/chessdriller, MIT). See
 * docs/research/opening-trainers.md for the full reverse-engineering brief.
 *
 * Key idea: the repertoire is a FLAT graph of moves (`from_fen → to_fen`),
 * NOT a tree. Transpositions automatically dedupe because the same
 * (repertoireId, fromFen, toFen) triple always identifies the same edge.
 */

export type RepertoireSource = 'curated' | 'pgn' | 'lichess_study';

export interface Repertoire {
  id: number;
  name: string;
  repForWhite: boolean;     // true = White rep, false = Black rep
  createdAt: number;        // unix ms
  sourceKind: RepertoireSource;
  sourceLabel?: string;     // origin id (curated opening id, study URL, filename)
  description?: string;
}

/**
 * One row per directed edge (position-before, position-after) per repertoire.
 *
 * The compound key `[repertoireId, fromFen, toFen]` is the IndexedDB primary
 * key — IDB enforces uniqueness across records with the same key, which gives
 * us free transposition dedup. There is no separate auto-incrementing id;
 * use the compound key when referencing a move from history.
 */
export interface RepMove {
  repertoireId: number;
  /** Position BEFORE the move, normalized (no half-move clock / full-move number). */
  fromFen: string;
  /** Position AFTER the move, normalized. */
  toFen: string;
  san: string;
  uci: string;
  /** True = my repertoire move (drillable). False = opponent move (auto-played by trainer). */
  isOwnMove: boolean;
  /** Opponent-move weight 0..1 (normalised within siblings). For own-moves: undefined. */
  weight?: number;
  comment?: string;
  /** Soft-delete flag (set when last source PGN is removed). */
  deleted: boolean;

  // SRS state — only meaningful when isOwnMove=true. Mirrors chessdriller's
  // schema; see scheduler.ts for the SM-2-lite update rules.
  /** 0..3 in learning phase, null after graduation. */
  learningStep: number | null;
  /** unix ms when this move is next due in learning phase, null when graduated. */
  learningDueAt: number | null;
  /** Days; null until graduated. Sentinel 0 means "needs re-graduation after a wrong answer". */
  reviewIntervalDays: number | null;
  /** SM-2 ease factor; default 2.5; floor 1.3 after wrong answers. */
  reviewEase: number;
  /** unix ms when this move is next due in review phase, null when in learning. */
  reviewDueAt: number | null;
}

/** Append-only attempt log. Powers stats, mistake review, leech detection. */
export interface MoveAttempt {
  /** auto-incrementing IDB key */
  id?: number;
  repertoireId: number;
  fromFen: string;
  toFen: string;       // the CORRECT move (the one user was being drilled on)
  studiedAt: number;
  wasCorrect: boolean;
  /** SAN the user actually played, if wrong. */
  incorrectGuessSan?: string;
}

/** Mode the trainer is running in. */
export type TrainerMode = 'learn' | 'drill' | 'test';

/** Wrong-move feedback the UI surfaces. */
export interface WrongMoveContext {
  triedSan: string;
  correctSan: string;
  correctUci: string;
  attemptCount: number;
}

/** A completed drill line — start FEN + sequence of edges traversed. */
export interface DrilledLine {
  startFen: string;
  edges: RepMove[];
}
