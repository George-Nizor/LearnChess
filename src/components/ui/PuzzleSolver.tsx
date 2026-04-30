/*
 * PuzzleSolver — reusable inline puzzle-solving component.
 *
 * Originally the puzzle-solving UX lived only in src/routes/Tactics.tsx
 * (~600 lines of inline JSX + state). The Openings detail's Puzzles
 * tab needed the same UX but scoped to one opening, so we extracted
 * the core into this component.
 *
 * What this component owns:
 *   - Holding a small queue of PuzzleRows (passed in by the caller)
 *   - The current puzzle's solve state machine (awaiting / solved /
 *     wrong / revealed)
 *   - The chessground board with movable squares wired to the
 *     solution UCI sequence
 *   - The "Hint / Show solution / Next puzzle" controls
 *   - Optional rating + SRS card persistence (caller opts in)
 *
 * What this component does NOT own:
 *   - Filter chrome (themes / opening tags / rating range)
 *   - The puzzle DB itself (loaded by the caller)
 *   - Stats / dashboard rendering
 *
 * Spaced-repetition rationale: every puzzle solved updates the SR
 * card via the same SM-2-lite scheduler the moves and Test cards
 * use. Cards graded "again" come back ~10 minutes later; "good"
 * advances them on the standard ladder. This is the third pillar
 * of retrieval practice integrated across the app (drill / test /
 * tactics).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chess } from 'chess.js';
import { Chessground } from '@/chess/board';
import {
  isPromotion,
  lastMoveSquares,
  legalDests,
  tryMove,
  tryMoveUci,
  turnColor,
  type Square,
} from '@/chess/rules';
import { playSound, soundForMove } from '@/sound';
import { type PuzzleRow } from '@/puzzles/db';
import { nextCard } from '@/puzzles/scheduler';
import { recordPuzzleAttempt, upsertSrCard } from '@/persistence/db';
import type { Config } from 'chessground/config';
import { motion } from 'framer-motion';

type SolveStatus = 'awaiting' | 'wrong' | 'solved' | 'revealed';

interface ActivePuzzle {
  row: PuzzleRow;
  solutionUci: string[];
  setupUci: string;
  startFenAfterSetup: string;
  ply: number;
  hintsUsed: number;
  startedAt: number;
}

interface PuzzleSolverProps {
  /** Function returning the next puzzle to solve. Called once on mount + on every "next" click. Return null when no more puzzles available. */
  loadNext: () => PuzzleRow | null;
  /** Optional: persist attempts to the SR/attempts tables. Defaults to true. */
  persist?: boolean;
  /** Optional: footer text below the action area (e.g. opening label). */
  footerLabel?: string;
  /** Optional: link target to drop the user into the full Tactics route with a deep-link filter. */
  fullTacticsUrl?: string;
}

// ────────────────────────────────────────────────────────────────────
// Pure helpers (lifted from Tactics.tsx)
// ────────────────────────────────────────────────────────────────────

function setupPuzzle(row: PuzzleRow): ActivePuzzle {
  const moves = row.moves.split(' ');
  const setupUci = moves[0]!;
  const game = new Chess(row.fen);
  game.move({
    from: setupUci.slice(0, 2),
    to: setupUci.slice(2, 4),
    promotion: setupUci.length >= 5 ? (setupUci[4] as 'q' | 'r' | 'b' | 'n') : 'q',
  });
  return {
    row,
    solutionUci: moves.slice(1),
    setupUci,
    startFenAfterSetup: game.fen(),
    ply: 0,
    hintsUsed: 0,
    startedAt: Date.now(),
  };
}

function computeFenAtPly(a: ActivePuzzle): string {
  const game = new Chess(a.startFenAfterSetup);
  for (let i = 0; i < a.ply; i++) {
    const m = a.solutionUci[i];
    if (!m) break;
    try {
      game.move({
        from: m.slice(0, 2),
        to: m.slice(2, 4),
        promotion: m.length >= 5 ? (m[4] as 'q' | 'r' | 'b' | 'n') : 'q',
      });
    } catch {
      break;
    }
  }
  return game.fen();
}

// ────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────

export function PuzzleSolver({
  loadNext,
  persist = true,
  footerLabel,
  fullTacticsUrl,
}: PuzzleSolverProps): ReactNode {
  const [active, setActive] = useState<ActivePuzzle | null>(null);
  const [status, setStatus] = useState<SolveStatus>('awaiting');
  const [hintSquare, setHintSquare] = useState<Square | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const recordedRef = useRef(false);

  // Initial load + reload-on-loadNext-change
  useEffect(() => {
    const next = loadNext();
    if (next) {
      setActive(setupPuzzle(next));
      setStatus('awaiting');
      setHintSquare(null);
      recordedRef.current = false;
    } else {
      setExhausted(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fen = active ? (
    active.ply === 0 ? active.startFenAfterSetup : computeFenAtPly(active)
  ) : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const game = useMemo(() => new Chess(fen), [fen]);
  const sideToMove = turnColor(game);

  const playerSide: 'white' | 'black' = useMemo(() => {
    if (!active) return 'white';
    return turnColor(new Chess(active.startFenAfterSetup));
  }, [active]);

  const dests = useMemo(
    () => (active && status === 'awaiting' ? legalDests(game) : new Map<Square, Square[]>()),
    [game, active, status],
  );
  const lastMove = useMemo(() => lastMoveSquares(game), [game]);

  const persistAttempt = useCallback(async (solved: boolean, currentActive: ActivePuzzle) => {
    if (!persist) return;
    if (recordedRef.current) return;
    recordedRef.current = true;
    const card = nextCard({ puzzleId: currentActive.row.id, grade: solved ? 'good' : 'again' });
    await upsertSrCard(card);
    await recordPuzzleAttempt({
      puzzleId: currentActive.row.id,
      rating: currentActive.row.rating,
      themes: currentActive.row.themes ? currentActive.row.themes.split(' ').filter(Boolean) : [],
      attemptedAt: Date.now(),
      solved,
      timeMs: Date.now() - currentActive.startedAt,
      hintsUsed: currentActive.hintsUsed,
    });
  }, [persist]);

  const handlePlayerMove = useCallback(
    (from: Square, to: Square) => {
      if (!active || status !== 'awaiting') return;
      const expected = active.solutionUci[active.ply];
      if (!expected) return;
      const expectedFrom = expected.slice(0, 2);
      const expectedTo = expected.slice(2, 4);
      const promotion = isPromotion(game, from, to) ? 'q' : 'q';

      if (from !== expectedFrom || to !== expectedTo) {
        // Mate-in-1 alternative-route allowance
        const test = new Chess(game.fen());
        const moveResult = tryMoveUci(test, from + to + (isPromotion(game, from, to) ? 'q' : ''));
        if (moveResult && test.isCheckmate() && active.solutionUci.length - active.ply === 1) {
          playSound(soundForMove(moveResult));
          setStatus('solved');
          void persistAttempt(true, active);
          return;
        }
        playSound('check');
        setStatus('wrong');
        void persistAttempt(false, active);
        return;
      }

      // Correct user move
      const probe = new Chess(game.fen());
      const userResult = tryMove(probe, from, to, promotion);
      if (userResult) playSound(soundForMove(userResult));

      const newPly = active.ply + 1;
      if (newPly >= active.solutionUci.length) {
        setStatus('solved');
        setActive({ ...active, ply: newPly });
        void persistAttempt(true, active);
        return;
      }
      // Auto-play opponent's reply
      const oppReply = active.solutionUci[newPly]!;
      try {
        const oppMv = probe.move({
          from: oppReply.slice(0, 2),
          to: oppReply.slice(2, 4),
          promotion: oppReply.length >= 5 ? (oppReply[4] as 'q' | 'r' | 'b' | 'n') : 'q',
        });
        playSound(soundForMove({ isCapture: !!oppMv.captured, isCheck: probe.isCheck(), isCheckmate: probe.isCheckmate() }));
      } catch {
        setStatus('solved');
        void persistAttempt(true, active);
        return;
      }
      setActive({ ...active, ply: newPly + 1 });
    },
    [active, status, game, persistAttempt],
  );

  const cgConfig = useMemo<Config>(() => {
    return {
      fen,
      orientation: playerSide,
      turnColor: sideToMove,
      check: game.isCheck(),
      ...(lastMove !== undefined ? { lastMove } : {}),
      movable: {
        free: false,
        ...(active && status === 'awaiting' ? { color: playerSide } : {}),
        dests,
        events: {
          after: (orig, dest) => handlePlayerMove(orig as Square, dest as Square),
        },
      },
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      drawable: {
        enabled: true,
        visible: true,
        autoShapes: [
          ...(hintSquare ? [{ orig: hintSquare, brush: 'paleBlue' as const }] : []),
          // Show the solution arrow on wrong OR revealed
          ...((active && (status === 'wrong' || status === 'revealed') && active.solutionUci[active.ply])
            ? [{
                orig: active.solutionUci[active.ply]!.slice(0, 2) as Square,
                dest: active.solutionUci[active.ply]!.slice(2, 4) as Square,
                brush: 'green' as const,
              }]
            : []),
        ],
      },
    } satisfies Config;
  }, [fen, playerSide, sideToMove, game, lastMove, active, status, dests, handlePlayerMove, hintSquare]);

  const expectedSan = useMemo(() => {
    if (!active || (status !== 'wrong' && status !== 'revealed')) return null;
    try {
      const g = new Chess(fen);
      const exp = active.solutionUci[active.ply];
      if (!exp) return null;
      const m = g.move({
        from: exp.slice(0, 2),
        to: exp.slice(2, 4),
        promotion: exp.length >= 5 ? (exp[4] as 'q' | 'r' | 'b' | 'n') : 'q',
      });
      return m.san;
    } catch {
      return null;
    }
  }, [active, status, fen]);

  const showHintFn = useCallback(() => {
    if (!active) return;
    const expected = active.solutionUci[active.ply];
    if (!expected) return;
    setHintSquare(expected.slice(0, 2) as Square);
    setActive({ ...active, hintsUsed: active.hintsUsed + 1 });
  }, [active]);

  const showSolution = useCallback(() => {
    if (!active) return;
    setStatus('revealed');
  }, [active]);

  const advance = useCallback(() => {
    const next = loadNext();
    if (next) {
      setActive(setupPuzzle(next));
      setStatus('awaiting');
      setHintSquare(null);
      recordedRef.current = false;
    } else {
      setActive(null);
      setExhausted(true);
    }
  }, [loadNext]);

  if (exhausted) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-6 text-sm dark:border-emerald-800 dark:bg-emerald-950/30">
        <h3 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">All puzzles in this filter solved</h3>
        <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
          You've worked through every puzzle in this batch. Adjust
          filters or come back later for spaced-repetition reviews.
        </p>
        {fullTacticsUrl && (
          <Link
            to={fullTacticsUrl}
            className="mt-4 inline-block rounded-md border border-emerald-400 bg-emerald-100 px-3 py-2 text-xs hover:bg-emerald-200 dark:border-emerald-700 dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60"
          >
            Open full Tactics trainer →
          </Link>
        )}
      </div>
    );
  }

  if (!active) {
    return <p className="text-sm text-muted-foreground">Loading puzzle…</p>;
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_360px]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        className="cg-board-fit"
      >
        <Chessground config={cgConfig} />
      </motion.div>

      <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto text-sm">
        <div
          role="status"
          aria-live="polite"
          className={`rounded-md border p-4 text-center ${
            status === 'solved' ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : status === 'wrong' ? 'border-red-300 bg-red-50 text-red-900'
              : status === 'revealed' ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-border bg-background'
          }`}
        >
          {status === 'awaiting' ? (
            <>
              <p className="text-base font-semibold">{sideToMove === 'white' ? 'White to move' : 'Black to move'}</p>
              <p className="mt-1 text-xs text-muted-foreground">Find the best continuation</p>
            </>
          ) : status === 'solved' ? (
            <>
              <p className="text-2xl">✓</p>
              <p className="text-base font-semibold">Solved!</p>
            </>
          ) : status === 'revealed' ? (
            <>
              <p className="text-base font-semibold">Solution shown</p>
              {expectedSan && (
                <p className="mt-1 text-xs">
                  Best was <span className="font-mono font-bold">{expectedSan}</span>
                </p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">No rating change</p>
            </>
          ) : (
            <>
              <p className="text-2xl">✗</p>
              <p className="text-base font-semibold">Not the strongest move</p>
              {expectedSan && (
                <p className="mt-1 text-xs">
                  Best was <span className="font-mono font-bold">{expectedSan}</span>
                </p>
              )}
            </>
          )}
        </div>

        {status === 'awaiting' && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={showHintFn}
              className="flex-1 rounded border border-border bg-background py-2 text-xs hover:bg-muted"
            >
              Hint
            </button>
            <button
              type="button"
              onClick={showSolution}
              className="flex-1 rounded border border-border bg-background py-2 text-xs hover:bg-muted"
            >
              Show solution
            </button>
          </div>
        )}

        {(status === 'solved' || status === 'wrong' || status === 'revealed') && (
          <button
            type="button"
            onClick={advance}
            className="w-full rounded-md bg-accent py-3 text-sm font-semibold text-accent-foreground hover:opacity-90"
          >
            Next puzzle →
          </button>
        )}

        {footerLabel && (
          <p className="mt-1 text-[11px] text-muted-foreground">{footerLabel}</p>
        )}

        {fullTacticsUrl && (
          <Link
            to={fullTacticsUrl}
            className="rounded border border-border bg-background py-2 text-center text-[11px] text-muted-foreground hover:bg-muted"
          >
            Open in full Tactics trainer →
          </Link>
        )}
      </aside>
    </div>
  );
}
