/*
 * Endgames route — Course experience.
 *
 * Mirrors `src/routes/Openings.tsx` so the user gets the same Learn /
 * Drill / Explore flow they're used to from openings, but applied to
 * endgame positions. Conceptual structure ("study → chapter → position
 * with goal & summary text") is borrowed from lichess
 * `lila/modules/practice` — see `docs/research/competitor-deep-dive.md`
 * §5.1 for the prior-art write-up.
 *
 * Pieces:
 *   - Course sidebar: 5 categories (pawn / rook / minor / queen / misc),
 *     each expandable to its positions. Mastery indicator (★☆☆☆☆) is
 *     derived from `getEndgameAttempts(positionId)` — count wins ≤
 *     1.2 × DTZ optimal moves.
 *   - Header card: position name, category, plain-English goal.
 *   - Mode tabs (Learn / Drill / Explore) with the framer-motion
 *     `layoutId` sliding pill from Openings.tsx.
 *   - Learn: speech-bubble + knight avatar walking the optimal line.
 *   - Drill: tablebase-graded play-out with the lichess-style
 *     plain-English verdict strip above the board.
 *   - Explore: link to /analysis?fen=<fen>.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import { motion, AnimatePresence } from 'framer-motion';
import { Chessground } from '@/chess/board';
import { StockfishEngine } from '@/chess/engine';
import { ENDGAMES, type EndgamePosition } from '@/chess/endgames/positions';
import { isPromotion, lastMoveSquares, legalDests, tryMove, turnColor } from '@/chess/rules';
import type { Square } from '@/chess/rules';
import {
  gradeMove,
  probeTablebase,
  type TbResponse,
} from '@/chess/tablebase';
import {
  ENDGAME_COURSES,
  endgameLessonFor,
  getEndgameLessonProgress,
  markEndgameLessonNodeVisited,
  type EndgameCourse,
  type EndgameLesson,
} from '@/endgames';
import { recordEndgameAttempt, getEndgameAttempts, type EndgameAttempt } from '@/persistence/db';
import { TutorAvatar } from '@/components/ui/TutorAvatar';
import { LearnIcon, DrillIcon, ExploreIcon } from '@/components/ui/ChessIcons';
import { Popover } from '@/components/ui/Popover';
import { MiniBoardPreview } from '@/components/ui/MiniBoardPreview';
import { playSound, soundForMove } from '@/sound';
import type { Config } from 'chessground/config';

type Mode = 'learn' | 'drill' | 'explore';
type Status = 'playing' | 'won' | 'drawn' | 'lost' | 'unknown';

interface MoveLog {
  san: string;
  uci: string;
  grade: 'optimal' | 'good' | 'inaccuracy' | 'losing' | 'unknown';
}

// ───── Mastery (★) helper ────────────────────────────────────────────────
//
// Mirrors lichess practice's "completed" indicator (see lila/modules/practice
// where `PracticeProgress.chapters` records first-try success). We score on
// efficiency: a "win" attempt with `movesPlayed <= 1.2 × optimalMoves` is a
// star. Cap at 5 stars so the indicator stays compact.

function masteryStars(attempts: EndgameAttempt[], goal: EndgamePosition['goal']): number {
  let stars = 0;
  for (const a of attempts) {
    if (goal === 'win' && a.result === 'win') {
      const optimal = a.optimalMoves;
      if (optimal === 0 || a.movesPlayed <= Math.ceil(optimal * 1.2)) stars++;
    } else if (goal === 'draw' && a.result === 'draw') {
      stars++;
    }
    if (stars >= 5) return 5;
  }
  return stars;
}

function StarStrip({ count }: { count: number }): ReactNode {
  const filled = Math.min(5, Math.max(0, count));
  return (
    <span aria-label={`${filled} of 5 stars mastered`} className="inline-flex font-mono text-[10px] leading-none text-amber-500">
      {'★'.repeat(filled)}
      <span className="text-muted-foreground/40">{'☆'.repeat(5 - filled)}</span>
    </span>
  );
}

// ───── Speech-bubble prose renderer (parses **bold**) ────────────────────

function renderProse(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

// `plainEnglishGoal` was previously displayed in the slim header strip
// next to the position name. The header now uses the position
// description as a tooltip instead, so the helper is no longer used.
// Keeping it commented as documentation for what the goal field maps to.

// ───── Learn-mode viewer ──────────────────────────────────────────────────

interface LearnViewProps {
  lesson: EndgameLesson;
  initialNodeIdx: number;
  playerSide: 'white' | 'black';
  onProgress: (nodeIdx: number) => void;
}

function LearnView({ lesson, initialNodeIdx, playerSide, onProgress }: LearnViewProps): ReactNode {
  const [nodeIdx, setNodeIdx] = useState<number>(Math.min(initialNodeIdx, lesson.nodes.length - 1));
  const node = lesson.nodes[nodeIdx]!;

  // Tutor speaking-dots indicator — pulses true for ~700 ms whenever
  // the lesson advances. Mirrors Openings Learn behaviour.
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    setSpeaking(true);
    const t = window.setTimeout(() => setSpeaking(false), 700);
    return () => window.clearTimeout(t);
  }, [lesson.positionId, nodeIdx]);

  const fen = node.fen;

  const lastMove = useMemo<[Square, Square] | undefined>(() => {
    if (nodeIdx === 0) return undefined;
    // Replay from the start through chess.js to discover the from/to of
    // the move that produced THIS node. Same approach as openings/Learn —
    // keeps lesson authoring decoupled from "from/to" bookkeeping.
    try {
      const game = new Chess(lesson.nodes[0]!.fen);
      for (let i = 1; i < nodeIdx; i++) {
        const n = lesson.nodes[i];
        if (!n?.san) continue;
        game.move(n.san);
      }
      const cur = lesson.nodes[nodeIdx];
      if (!cur?.san) return undefined;
      const m = game.move(cur.san);
      return [m.from, m.to];
    } catch {
      return undefined;
    }
  }, [nodeIdx, lesson.nodes]);

  const cgConfig = useMemo<Config>(() => ({
    fen,
    orientation: playerSide,
    viewOnly: true,
    coordinates: true,
    ...(lastMove !== undefined ? { lastMove } : {}),
    animation: { enabled: true, duration: 250 },
    highlight: { lastMove: true, check: true },
  } satisfies Config), [fen, playerSide, lastMove]);

  const goNext = useCallback(() => {
    setNodeIdx((i) => {
      const next = Math.min(i + 1, lesson.nodes.length - 1);
      if (next > i) {
        playSound('move');
        onProgress(next);
      }
      return next;
    });
  }, [lesson.nodes.length, onProgress]);

  const goPrev = useCallback(() => {
    setNodeIdx((i) => Math.max(i - 1, 0));
  }, []);

  const goRestart = useCallback(() => {
    setNodeIdx(0);
  }, []);

  // Keyboard shortcuts: ←/→ for prev/next
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  const finished = nodeIdx === lesson.nodes.length - 1;

  // Layout matches Openings LearnView: board column has only the
  // board, sidebar holds the tutor avatar, controls strip, and
  // streaming bubbles.
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]">
      <div className="cg-board-fit">
        <Chessground config={cgConfig} />
      </div>

      <aside aria-live="polite" className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
        <div className="flex shrink-0 items-center gap-3">
          <TutorAvatar pulseKey={`${lesson.positionId}-${nodeIdx}`} size={48} speaking={speaking} />
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Tutor
            </div>
            <div className="font-display text-base font-medium leading-tight text-foreground">
              {lesson.title}
              <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                · move {nodeIdx} / {lesson.nodes.length - 1}
              </span>
            </div>
          </div>
        </div>

        {/* Move controls — pinned at top of sidebar so they don't shift the board. */}
        <div className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-elevated/40 p-1.5">
          <button
            type="button"
            onClick={goPrev}
            disabled={nodeIdx === 0}
            aria-label="Previous move"
            className="rounded border border-border bg-background/60 px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Prev
          </button>
          <div className="flex-1 text-center font-mono text-[11px] text-muted-foreground">
            {nodeIdx + 1} / {lesson.nodes.length}
          </div>
          <button
            type="button"
            onClick={goNext}
            disabled={finished}
            aria-label="Next move"
            className="rounded bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
          {finished && (
            <button
              type="button"
              onClick={goRestart}
              aria-label="Restart lesson"
              className="rounded border border-border bg-background/60 px-2 py-1 text-xs hover:bg-muted"
            >
              ↻
            </button>
          )}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={nodeIdx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="rounded-xl border border-border bg-elevated/80 p-3 text-[14px] leading-6 shadow-sm"
          >
            <p className="text-foreground/90">{renderProse(node.text)}</p>
          </motion.div>
        </AnimatePresence>

        {finished && (
          <div className="shrink-0 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
            <span className="font-semibold text-accent">✓ End of lesson</span>{' '}
            — switch to Drill to test what you've learned.
          </div>
        )}
      </aside>
    </div>
  );
}

// ───── Drill view — tablebase-graded play-out ────────────────────────────

interface DrillViewProps {
  position: EndgamePosition;
  onMastery: () => void;
}

function DrillView({ position, onMastery }: DrillViewProps): ReactNode {
  const [fen, setFen] = useState<string>(position.fen);
  const [moves, setMoves] = useState<MoveLog[]>([]);
  const [status, setStatus] = useState<Status>('playing');
  const [tbInitial, setTbInitial] = useState<TbResponse | null>(null);
  const [tbCurrent, setTbCurrent] = useState<TbResponse | null>(null);
  const [tbError, setTbError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const engineRef = useRef<StockfishEngine | null>(null);

  // Initialise the engine ONCE per drill mount (positions can change but
  // the engine survives — it accepts arbitrary FENs via search()).
  useEffect(() => {
    const e = new StockfishEngine();
    engineRef.current = e;
    e.init().catch(() => {
      // engine optional — tablebase is the source of truth
    });
    return () => {
      e.destroy();
      engineRef.current = null;
    };
  }, []);

  // Reset state and probe whenever the user switches positions.
  useEffect(() => {
    setFen(position.fen);
    setMoves([]);
    setStatus('playing');
    setHint(null);
    setTbInitial(null);
    setTbCurrent(null);
    setTbError(null);
    let cancelled = false;
    probeTablebase(position.fen)
      .then((r) => {
        if (cancelled) return;
        setTbInitial(r);
        setTbCurrent(r);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setTbError(err.message);
      });
    return () => { cancelled = true; };
  }, [position]);

  const game = useMemo(() => new Chess(fen), [fen]);
  const sideToMove = turnColor(game);
  const playerSide: 'white' | 'black' = position.side === 'w' ? 'white' : 'black';
  const isPlayerTurn = sideToMove === playerSide && status === 'playing';
  const dests = useMemo(() => (isPlayerTurn ? legalDests(game) : new Map<Square, Square[]>()), [game, isPlayerTurn]);
  const lastMove = useMemo(() => lastMoveSquares(game), [game]);

  const finishAttempt = useCallback(
    (finalStatus: Status) => {
      setStatus(finalStatus);
      const optimalMoves = tbInitial?.dtz !== null && tbInitial?.dtz !== undefined ? Math.abs(tbInitial.dtz) : 0;
      const playerMoves = moves.length;
      void recordEndgameAttempt({
        positionId: position.id,
        attemptedAt: Date.now(),
        result: finalStatus === 'won' ? 'win' : finalStatus === 'drawn' ? 'draw' : 'loss',
        movesPlayed: playerMoves,
        optimalMoves,
      }).then(() => onMastery());
    },
    [moves.length, position.id, tbInitial, onMastery],
  );

  const opponentMove = useCallback(
    async (afterFen: string) => {
      const probe = await probeTablebase(afterFen).catch(() => null);
      if (!probe || probe.moves.length === 0) {
        if (engineRef.current?.getStatus() === 'ready') {
          const r = await engineRef.current.search(afterFen, { movetime: 400 });
          const g = new Chess(afterFen);
          try {
            const promotion = (r.bestMove.length >= 5 ? (r.bestMove[4] as 'q' | 'r' | 'b' | 'n') : 'q');
            const mv = g.move({ from: r.bestMove.slice(0, 2), to: r.bestMove.slice(2, 4), promotion });
            setMoves((m) => [...m, { san: mv.san, uci: r.bestMove, grade: 'unknown' }]);
            setFen(g.fen());
          } catch {
            // engine returned an illegal move (rare); accept silently
          }
        }
        return;
      }
      const best = probe.moves[0]!;
      const g = new Chess(afterFen);
      try {
        const promotion = (best.uci.length >= 5 ? (best.uci[4] as 'q' | 'r' | 'b' | 'n') : 'q');
        const mv = g.move({ from: best.uci.slice(0, 2), to: best.uci.slice(2, 4), promotion });
        setMoves((m) => [...m, { san: best.san, uci: best.uci, grade: 'optimal' }]);
        setFen(g.fen());
        playSound(soundForMove({ isCapture: !!mv.captured, isCheck: g.isCheck(), isCheckmate: g.isCheckmate() }));
        const after = await probeTablebase(g.fen()).catch(() => null);
        setTbCurrent(after);
      } catch {
        // illegal move guard — should not happen with a TB move
      }
    },
    [],
  );

  const handlePlayerMove = useCallback(
    async (from: Square, to: Square) => {
      if (!isPlayerTurn) return;
      const next = new Chess(fen);
      const promotion = isPromotion(next, from, to) ? 'q' : 'q';
      const move = tryMove(next, from, to, promotion);
      if (!move) return;
      let grade: MoveLog['grade'] = 'unknown';
      if (tbCurrent) {
        const g = gradeMove(fen, tbCurrent, move.uci);
        grade = g.grade;
      }
      setMoves((m) => [...m, { san: move.san, uci: move.uci, grade }]);
      setFen(move.fenAfter);
      playSound(soundForMove(move));

      const probeAfter = await probeTablebase(move.fenAfter).catch(() => null);
      setTbCurrent(probeAfter);

      // Only end the attempt on a TRUE chess game-over. Tablebase verdicts
      // are surfaced in the strip above the board — they don't prematurely
      // terminate the trainer (per the user's "no early termination" rule).
      if (next.isCheckmate()) {
        const winner = next.turn() === position.side ? 'lost' : 'won';
        finishAttempt(winner);
        return;
      }
      if (next.isStalemate() || next.isInsufficientMaterial() || next.isThreefoldRepetition()) {
        finishAttempt(position.goal === 'draw' ? 'drawn' : 'lost');
        return;
      }

      void opponentMove(move.fenAfter);
    },
    [isPlayerTurn, fen, tbCurrent, position.side, position.goal, opponentMove, finishAttempt],
  );

  const cgConfig = useMemo<Config>(() => ({
    fen,
    orientation: playerSide,
    turnColor: sideToMove,
    check: game.isCheck(),
    ...(lastMove !== undefined ? { lastMove } : {}),
    movable: {
      free: false,
      ...(isPlayerTurn ? { color: playerSide } : {}),
      dests,
      events: {
        after: (orig, dest) => void handlePlayerMove(orig as Square, dest as Square),
      },
    },
    animation: { enabled: true, duration: 200 },
    highlight: { lastMove: true, check: true },
  } satisfies Config), [fen, playerSide, sideToMove, game, lastMove, isPlayerTurn, dests, handlePlayerMove]);

  const showHint = useCallback(() => {
    if (!tbCurrent || tbCurrent.moves.length === 0) {
      setHint('Tablebase has no suggestion for this position.');
      return;
    }
    const best = tbCurrent.moves[0]!;
    setHint(`Best move: ${best.san}${best.dtz !== null ? ` (dtz ${best.dtz})` : ''}`);
  }, [tbCurrent]);

  const restart = useCallback(() => {
    setFen(position.fen);
    setMoves([]);
    setStatus('playing');
    setHint(null);
    setTbCurrent(tbInitial);
  }, [position.fen, tbInitial]);

  // Verdict strip removed 2026-04-27: it reported "You are losing" after
  // every move because the tablebase view "after my move" is from the
  // opponent's perspective, but our verdict mapping wasn't inverting
  // consistently. The per-move grade column (optimal / inaccuracy / losing)
  // already surfaces blunders without misleading the user about the
  // overall position. Re-add only after fixing the side-relativity.

  return (
    // Same squeeze as the Learn view: outer page reserves 280px for the
    // courses sidebar so the inner board+sidebar grid has to shrink. Use
    // minmax(0,1fr) on both columns + min-w-0 on children so the right
    // panel (Hint / Restart / Move log) wraps within its column instead
    // of spilling past the viewport.
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
      <div className="cg-board-fit">
        <Chessground config={cgConfig} />
      </div>

      <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto text-sm">
        <div role="status" aria-live="polite" className="rounded-md border border-border bg-elevated p-3">
          <div className="text-xs uppercase text-muted-foreground">Status</div>
          <div className={`text-sm font-semibold uppercase ${
            status === 'won' ? 'text-emerald-600' : status === 'lost' ? 'text-red-600' : status === 'drawn' ? 'text-amber-600' : ''
          }`}>{status}</div>
        </div>

        {tbError && (
          <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            Tablebase: {tbError}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={showHint}
            className="w-full rounded-md border border-border bg-background py-2 text-xs hover:bg-muted"
          >
            Hint (uses tablebase)
          </button>
          {hint && <div className="rounded border border-border bg-background p-2 text-xs">{hint}</div>}

          <button
            type="button"
            onClick={restart}
            className="w-full rounded-md bg-accent py-2 text-xs font-medium text-accent-foreground hover:opacity-90"
          >
            Restart position
          </button>
        </div>

        <div className="border-t border-border pt-2">
          <div className="mb-1 text-xs uppercase text-muted-foreground">Moves</div>
          <ol className="max-h-[260px] space-y-1 overflow-y-auto font-mono text-xs">
            {moves.map((m, i) => (
              <li key={i} className="flex justify-between">
                <span>
                  {Math.floor(i / 2) + 1}{i % 2 === 0 ? '.' : '...'} {m.san}
                </span>
                <span className={`text-[10px] uppercase ${
                  m.grade === 'optimal' ? 'text-emerald-600'
                    : m.grade === 'good' ? 'text-emerald-500'
                    : m.grade === 'inaccuracy' ? 'text-amber-600'
                    : m.grade === 'losing' ? 'text-red-600'
                    : 'text-muted-foreground'
                }`}>{m.grade}</span>
              </li>
            ))}
            {moves.length === 0 && (
              <li className="text-muted-foreground italic">No moves yet — play one to start.</li>
            )}
          </ol>
        </div>
      </aside>
    </div>
  );
}

// ───── Explore view — links to /analysis ────────────────────────────────

function ExploreView({ position }: { position: EndgamePosition }): ReactNode {
  const cgConfig: Config = {
    fen: position.fen,
    orientation: position.side === 'w' ? 'white' : 'black',
    viewOnly: true,
    coordinates: true,
    animation: { enabled: false, duration: 0 },
  };
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(240px,480px)]">
      <div className="cg-board-fit">
        <Chessground config={cgConfig} />
      </div>
      <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto text-sm">
        <div className="rounded-md border border-border bg-elevated p-4">
          <h3 className="text-base font-semibold">Open in Analysis Board</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Drop this position into the Analysis Board to explore variations with Stockfish — multi-line
            evaluations, the move tree, and an eval bar. Make your own moves and see why the engine
            prefers what it prefers.
          </p>
          <Link
            to={`/analysis?fen=${encodeURIComponent(position.fen)}`}
            className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"
          >
            Open Analysis Board →
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          Tip: the same Analysis Board powers the "Analyze position →" link from Tactics puzzles.
        </p>
      </aside>
    </div>
  );
}

// ───── Main page ──────────────────────────────────────────────────────────

export function Endgames(): ReactNode {
  // Default-select the first position of the first course so the page has
  // something to render on first paint. `useMemo` keeps the reference
  // stable across renders so dependent memos don't bust their cache.
  const initialPos = useMemo<EndgamePosition>(
    () => ENDGAME_COURSES[0]?.positions[0] ?? ENDGAMES[0]!,
    [],
  );

  // ?course=<courseId> drives the catalogue ↔ detail switch (mirrors the
  // Openings route convention). When absent, render the catalogue. When
  // present, snap the active position to that course's first position.
  const [searchParams, setSearchParams] = useSearchParams();
  const courseSlug = searchParams.get('course');
  const slugCourse = useMemo(
    () => (courseSlug ? ENDGAME_COURSES.find((c) => c.id === courseSlug) : undefined),
    [courseSlug],
  );

  const [activePositionId, setActivePositionId] = useState<string>(initialPos.id);
  const [mode, setMode] = useState<Mode>('learn');
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(
    () => new Set(ENDGAME_COURSES.length > 0 ? [ENDGAME_COURSES[0]!.id] : []),
  );

  // When the user opens a course from the catalogue, snap the active
  // position to that course's first one (and expand only that course in
  // the popover).
  useEffect(() => {
    if (!slugCourse) return;
    const first = slugCourse.positions[0];
    if (first && first.id !== activePositionId) {
      const stillInCourse = slugCourse.positions.some((p) => p.id === activePositionId);
      if (!stillInCourse) setActivePositionId(first.id);
    }
    setExpandedCourses(new Set([slugCourse.id]));
  }, [slugCourse, activePositionId]);

  const openCourse = useCallback((courseId: string) => {
    setSearchParams({ course: courseId });
  }, [setSearchParams]);
  const goBack = useCallback(() => {
    setSearchParams({});
  }, [setSearchParams]);

  // Mastery counts per position (used in the sidebar star strip and the
  // "Mastered X/Y" chip). Loaded async; refreshed after each drill attempt.
  const [masteryByPos, setMasteryByPos] = useState<Map<string, number>>(new Map());

  // Lesson discovery progress per position (used in the "Lines learned X/N"
  // chip). Loaded async; refreshed after each Learn-mode advance.
  const [discoveredByPos, setDiscoveredByPos] = useState<Map<string, number>>(new Map());

  const refreshMastery = useCallback(async () => {
    const all = await getEndgameAttempts();
    const grouped = new Map<string, EndgameAttempt[]>();
    for (const a of all) {
      const arr = grouped.get(a.positionId) ?? [];
      arr.push(a);
      grouped.set(a.positionId, arr);
    }
    const next = new Map<string, number>();
    for (const p of ENDGAMES) {
      const attempts = grouped.get(p.id) ?? [];
      next.set(p.id, masteryStars(attempts, p.goal));
    }
    setMasteryByPos(next);
  }, []);

  const refreshDiscovered = useCallback(async () => {
    const next = new Map<string, number>();
    for (const p of ENDGAMES) {
      const lp = await getEndgameLessonProgress(p.id);
      // Stored value is the FURTHEST node visited (0-indexed). "Lines learned"
      // = furthestIndex + 1 if any progress, else 0.
      next.set(p.id, lp ? lp.discoveredNodeIdx + 1 : 0);
    }
    setDiscoveredByPos(next);
  }, []);

  useEffect(() => { void refreshMastery(); }, [refreshMastery]);
  useEffect(() => { void refreshDiscovered(); }, [refreshDiscovered]);

  const activePosition = useMemo<EndgamePosition>(() => {
    return ENDGAMES.find((p) => p.id === activePositionId) ?? initialPos;
  }, [activePositionId, initialPos]);

  const activeCourse = useMemo<EndgameCourse | undefined>(() => {
    return ENDGAME_COURSES.find((c) => c.positions.some((p) => p.id === activePositionId));
  }, [activePositionId]);

  const lesson = useMemo(() => endgameLessonFor(activePositionId), [activePositionId]);

  const handleLearnProgress = useCallback(
    async (nodeIdx: number) => {
      await markEndgameLessonNodeVisited(activePositionId, nodeIdx);
      await refreshDiscovered();
    },
    [activePositionId, refreshDiscovered],
  );

  // If the active position has no lesson, default mode to drill.
  useEffect(() => {
    if (mode === 'learn' && !lesson) setMode('drill');
  }, [lesson, mode]);

  const toggleCourse = useCallback((courseId: string) => {
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  }, []);

  // ── Friendly metrics for the active course ─────────────────────────────
  // "Lines learned X/N" = sum of discovered nodes across positions in this
  // course / sum of total nodes across the same positions.
  // "Mastered X/Y" = sum of stars across positions / 5 × position count.
  const courseStats = useMemo(() => {
    if (!activeCourse) return { learned: 0, learnedTotal: 0, mastered: 0, masteredTotal: 0 };
    let learned = 0;
    let learnedTotal = 0;
    let mastered = 0;
    let masteredTotal = 0;
    for (const p of activeCourse.positions) {
      const l = endgameLessonFor(p.id);
      if (l) {
        learned += discoveredByPos.get(p.id) ?? 0;
        learnedTotal += l.nodes.length;
      }
      mastered += masteryByPos.get(p.id) ?? 0;
      masteredTotal += 5;
    }
    return { learned, learnedTotal, mastered, masteredTotal };
  }, [activeCourse, discoveredByPos, masteryByPos]);

  // Catalogue ↔ detail switch. Same convention as Openings: no slug =
  // browseable catalogue (scrollable); slug = locked-viewport course
  // detail with the slim control bar.
  const inCourse = courseSlug !== null && slugCourse !== undefined;
  if (!inCourse) {
    return (
      <EndgameCatalogue
        onOpen={openCourse}
        masteryByPos={masteryByPos}
        discoveredByPos={discoveredByPos}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden px-6 py-3">
      {/* Single slim control strip — same pattern as Openings'
          CourseControlBar: back arrow + course/position label, position
          popover, mode tabs, progress chips. */}
      <EndgameControlBar
        course={activeCourse}
        position={activePosition}
        onBack={goBack}
        onSelectPosition={setActivePositionId}
        masteryByPos={masteryByPos}
        expandedCourses={expandedCourses}
        onToggleCourse={toggleCourse}
        mode={mode}
        onSelectMode={setMode}
        lessonAvailable={lesson !== undefined}
        stats={courseStats}
      />

      {/* Mode body — board + sidebar. Same shape as Openings so the
          board lands at the same coordinates regardless of route. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${activePositionId}-${mode}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="mt-3 min-h-0 flex-1"
        >
          {mode === 'learn' && lesson && (
            <LearnView
              key={activePositionId}
              lesson={lesson}
              initialNodeIdx={Math.min(discoveredByPos.get(activePositionId) ?? 0, lesson.nodes.length - 1)}
              playerSide={activePosition.side === 'w' ? 'white' : 'black'}
              onProgress={(idx) => void handleLearnProgress(idx)}
            />
          )}
          {mode === 'drill' && (
            <DrillView
              key={activePositionId}
              position={activePosition}
              onMastery={() => void refreshMastery()}
            />
          )}
          {mode === 'explore' && (
            <ExploreView position={activePosition} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ───── Endgame catalogue (course cards) ──────────────────────────────────
// Visual structure mirrors src/routes/Openings.tsx → Catalogue exactly:
//   - h1 + intro paragraph header
//   - sm:grid-cols-2 grid of cards
//   - each card: MiniBoardPreview thumbnail (140 px) + flex column with
//     title row, description, progress bar, "Open" button
// The MiniBoardPreview uses each course's first position as the
// preview FEN so each card has a distinguishing thumbnail.

interface EndgameCatalogueProps {
  onOpen: (courseId: string) => void;
  masteryByPos: Map<string, number>;
  discoveredByPos: Map<string, number>;
}

function EndgameCatalogue({ onOpen, masteryByPos, discoveredByPos }: EndgameCatalogueProps): ReactNode {
  return (
    <div className="mx-auto h-full max-w-7xl overflow-y-auto px-6 py-6">
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="font-display text-3xl font-semibold leading-tight">Endgames</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Foundational positions that win every game. Pick a course to
            start with the basic mate, walk through the lesson, then
            drill against the engine until the technique is automatic.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {ENDGAME_COURSES.map((course) => (
            <EndgameCourseCard
              key={course.id}
              course={course}
              masteryByPos={masteryByPos}
              discoveredByPos={discoveredByPos}
              onOpen={() => onOpen(course.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface EndgameCourseCardProps {
  course: EndgameCourse;
  masteryByPos: Map<string, number>;
  discoveredByPos: Map<string, number>;
  onOpen: () => void;
}

function EndgameCourseCard({ course, masteryByPos, discoveredByPos, onOpen }: EndgameCourseCardProps): ReactNode {
  const totalPositions = course.positions.length;
  const totalNodes = course.positions.reduce((acc, p) => {
    const l = endgameLessonFor(p.id);
    return acc + (l?.nodes.length ?? 0);
  }, 0);
  const learned = course.positions.reduce((acc, p) => acc + (discoveredByPos.get(p.id) ?? 0), 0);
  const mastered = course.positions.reduce((acc, p) => acc + (masteryByPos.get(p.id) ?? 0), 0);
  const masteredTotal = totalPositions * 5;
  const pct = totalNodes === 0 ? 0 : Math.round((learned / totalNodes) * 100);

  // Use the course's first position FEN as the card's preview thumbnail,
  // so every card has a visually distinctive board image.
  const firstPosition = course.positions[0];
  const previewFen = firstPosition?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const orientation: 'white' | 'black' = firstPosition?.side === 'b' ? 'black' : 'white';

  return (
    <article
      aria-labelledby={`endgame-course-${course.id}-title`}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4 shadow-sm transition-all hover:scale-[1.01] hover:shadow-md sm:flex-row sm:items-stretch sm:gap-4"
    >
      <div className="flex-shrink-0">
        <MiniBoardPreview size={140} fen={previewFen} orientation={orientation} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <h3
            id={`endgame-course-${course.id}-title`}
            className="font-display text-base font-semibold leading-tight"
          >
            {course.name}
          </h3>
          <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {totalPositions} positions
          </span>
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">{course.description}</p>

        <div className="mt-auto">
          {totalNodes > 0 && (
            <>
              <div className="mb-1 flex items-baseline justify-between text-[11px]">
                <span className="font-medium uppercase tracking-wide text-muted-foreground">Progress</span>
                <span className="font-mono text-foreground">{learned} / {totalNodes} learned</span>
              </div>
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${pct}%` }}
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${learned} of ${totalNodes} lesson nodes learned`}
                />
              </div>
              <div className="mb-2 text-[11px] text-muted-foreground">
                <span className="font-mono font-semibold text-foreground">{mastered}</span>
                <span className="opacity-60"> / {masteredTotal}</span> mastery stars
              </div>
            </>
          )}

          <button
            type="button"
            onClick={onOpen}
            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Open
          </button>
        </div>
      </div>
    </article>
  );
}

// ───── Endgame control bar (slim header) ─────────────────────────────────

interface EndgameControlBarProps {
  course: EndgameCourse | undefined;
  position: EndgamePosition;
  onBack: () => void;
  onSelectPosition: (id: string) => void;
  masteryByPos: Map<string, number>;
  expandedCourses: Set<string>;
  onToggleCourse: (id: string) => void;
  mode: Mode;
  onSelectMode: (m: Mode) => void;
  lessonAvailable: boolean;
  stats: { learned: number; learnedTotal: number; mastered: number; masteredTotal: number };
}

function EndgameControlBar({
  course,
  position,
  onBack,
  onSelectPosition,
  masteryByPos,
  expandedCourses,
  onToggleCourse,
  mode,
  onSelectMode,
  lessonAvailable,
  stats,
}: EndgameControlBarProps): ReactNode {
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border/60 bg-elevated/40 px-3 py-1.5 text-sm backdrop-blur-sm">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to courses"
        className="rounded text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        ←
      </button>

      {/* Title block — same shape as Openings:
            <Course name>  <Side badge>
          The position name + tagline aren't squeezed into the header
          (would wrap on smaller widths); they live as the title-tooltip
          on the position popover trigger and on the lesson sidebar. */}
      <div className="flex items-baseline gap-2">
        <h2
          className="font-display text-base font-semibold leading-tight text-foreground"
          title={position.description}
        >
          {course?.name ?? 'Endgames'}
        </h2>
        <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground">
          {position.side === 'w' ? 'White' : 'Black'}
        </span>
      </div>

      {/* Position popover trigger — shows the active position's name. */}
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          aria-controls="positions-popover"
          title={position.description}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1 text-[12.5px] font-medium hover:bg-muted"
        >
          <span className="max-w-[260px] truncate font-display">{position.name}</span>
          <span aria-hidden className="text-[10px] text-muted-foreground">▾</span>
        </button>
        <Popover
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          triggerRef={triggerRef}
          panelId="positions-popover"
          aria-label="Endgame courses and positions"
          className="left-0 mt-1 max-h-[60vh] w-[320px] overflow-y-auto p-2"
        >
          <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Courses
          </div>
          {ENDGAME_COURSES.map((c) => {
            const expanded = expandedCourses.has(c.id);
            const hasActive = c.positions.some((p) => p.id === position.id);
            return (
              <div key={c.id} className="mb-1">
                <button
                  type="button"
                  onClick={() => onToggleCourse(c.id)}
                  aria-expanded={expanded}
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                    hasActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span>{c.name}</span>
                  <span aria-hidden className="font-mono text-[10px]">{expanded ? '−' : '+'}</span>
                </button>
                {expanded && (
                  <ul className="mt-0.5 space-y-0.5">
                    {c.positions.map((p) => {
                      const stars = masteryByPos.get(p.id) ?? 0;
                      const isActive = p.id === position.id;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => {
                              onSelectPosition(p.id);
                              setPickerOpen(false);
                            }}
                            className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-[12px] transition-all ${
                              isActive
                                ? 'bg-accent/20 text-foreground ring-1 ring-accent/40'
                                : 'hover:bg-muted'
                            }`}
                          >
                            <span className="line-clamp-2 leading-snug">{p.name}</span>
                            <span className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span>{p.side === 'w' ? 'White' : 'Black'} · {p.goal}</span>
                              <StarStrip count={stars} />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </Popover>
      </div>

      {/* Mode tabs */}
      <div className="flex items-center gap-0.5 rounded-md border border-border bg-background/40 p-0.5">
        {(['learn', 'drill', 'explore'] as Mode[]).map((m) => {
          const isActive = mode === m;
          const disabled = m === 'learn' && !lessonAvailable;
          const label = m === 'learn' ? 'Learn' : m === 'drill' ? 'Drill' : 'Explore';
          const Icon = m === 'learn' ? LearnIcon : m === 'drill' ? DrillIcon : ExploreIcon;
          return (
            <button
              key={m}
              type="button"
              onClick={() => !disabled && onSelectMode(m)}
              disabled={disabled}
              className={`relative rounded px-2 py-0.5 text-[12px] font-medium transition-colors ${
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
              title={disabled ? 'No prose lesson for this position yet' : label}
            >
              {isActive && (
                <motion.span
                  layoutId="endgame-tab-pill"
                  className="absolute inset-0 rounded bg-elevated shadow-sm"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              <span className="relative inline-flex items-center gap-1.5">
                <Icon size={13} />
                <span className="hidden sm:inline">{label}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
        <span title="Lesson nodes seen across this course in Learn mode">
          <span className="font-mono font-semibold text-foreground">{stats.learned}</span>
          <span className="opacity-60">/{stats.learnedTotal}</span> learned
        </span>
        <span title="Up to 5 stars per position — earned by efficient drill wins">
          <span className="font-mono font-semibold text-foreground">{stats.mastered}</span>
          <span className="opacity-60">/{stats.masteredTotal}</span> mastered
        </span>
      </div>
    </div>
  );
}
