/*
 * Drill session orchestration. Pure logic — no React. The component holds a
 * reducer-like `useReducer`/`useState` tree and forwards user actions here.
 *
 * Lifecycle:
 *   1. Construct a session from a `DrillLine` (from selectDrillLine).
 *   2. The session auto-plays opponent moves until it's the user's turn.
 *   3. Component asks for the current FEN + expected user move; renders the
 *      board and waits for input.
 *   4. Component calls `attempt(fromUci)`; we return `{ kind: 'correct' | 'wrong' }`.
 *   5. On correct, the session advances past the user's move AND the next
 *      opponent reply, leaving the user at their next decision point.
 *   6. On end of line, returns `{ kind: 'finished' }`.
 */

import { Chess } from 'chess.js';
import type { DrillLine } from './lineSelector';
import type { RepMove } from './types';
import { normFen } from './fen';

export type AttemptResult =
  | { kind: 'correct'; advancedTo: SessionView }
  | { kind: 'wrong'; correctMove: RepMove; attemptCount: number }
  | { kind: 'no-op' };

export interface SessionView {
  fen: string;             // CURRENT board FEN (chess.js full FEN, including counters)
  ply: number;             // index into line.edges
  expected: RepMove | null; // next own-move the user should play; null if finished
  finished: boolean;
  wrongAttempts: number;
  history: { san: string; fenAfter: string }[];
}

export class DrillSession {
  private game: Chess;
  private cursor: number = 0;       // index into line.edges of the next edge to consume
  private wrongAttempts = 0;
  private historySan: { san: string; fenAfter: string }[] = [];

  constructor(public readonly line: DrillLine) {
    this.game = new Chess();
    // Replay edges UP TO the first own-move (not inclusive). Auto-play the
    // opponent's setup if necessary.
    this.advanceOpponentMoves();
  }

  /** Advance through any opponent edges in the line until we land on an own-move (or end). */
  private advanceOpponentMoves(): void {
    while (this.cursor < this.line.edges.length) {
      const edge = this.line.edges[this.cursor]!;
      if (edge.isOwnMove) return;
      this.applyEdge(edge);
      this.cursor++;
    }
  }

  private applyEdge(edge: RepMove): void {
    const m = this.game.move({
      from: edge.uci.slice(0, 2),
      to: edge.uci.slice(2, 4),
      promotion: edge.uci.length >= 5 ? (edge.uci[4] as 'q' | 'r' | 'b' | 'n') : 'q',
    });
    this.historySan.push({ san: m.san, fenAfter: this.game.fen() });
  }

  view(): SessionView {
    const expected = this.cursor < this.line.edges.length ? this.line.edges[this.cursor]! : null;
    return {
      fen: this.game.fen(),
      ply: this.cursor,
      expected: expected !== null ? expected : null,
      finished: this.cursor >= this.line.edges.length,
      wrongAttempts: this.wrongAttempts,
      history: [...this.historySan],
    };
  }

  /** Try a user move (UCI). Returns the outcome and updates internal state on correct. */
  attempt(uci: string): AttemptResult {
    const expected = this.cursor < this.line.edges.length ? this.line.edges[this.cursor]! : null;
    if (!expected) return { kind: 'no-op' };
    if (!expected.isOwnMove) return { kind: 'no-op' };

    if (uci !== expected.uci) {
      this.wrongAttempts++;
      return { kind: 'wrong', correctMove: expected, attemptCount: this.wrongAttempts };
    }

    // Correct. Apply the user's move and any subsequent opponent move.
    this.applyEdge(expected);
    this.cursor++;
    this.wrongAttempts = 0;

    // Auto-play opponent's reply (if line has one)
    this.advanceOpponentMoves();

    return { kind: 'correct', advancedTo: this.view() };
  }

  /** Reveal & play the correct move (used when the user clicks "Show answer"). */
  reveal(): { revealed: RepMove; advancedTo: SessionView } | null {
    const expected = this.cursor < this.line.edges.length ? this.line.edges[this.cursor]! : null;
    if (!expected) return null;
    this.applyEdge(expected);
    this.cursor++;
    this.wrongAttempts = 0;
    this.advanceOpponentMoves();
    return { revealed: expected, advancedTo: this.view() };
  }

  /** Reset to the start of the line. */
  reset(): void {
    this.game = new Chess();
    this.cursor = 0;
    this.wrongAttempts = 0;
    this.historySan = [];
    this.advanceOpponentMoves();
  }

  /** Helpful for tests: read-only state. */
  get currentNormFen(): string {
    return normFen(this.game.fen());
  }
  get attemptsThisMove(): number {
    return this.wrongAttempts;
  }
}
