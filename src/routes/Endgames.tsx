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
import { Link } from 'react-router-dom';
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
  verdictText,
  verdictToneClass,
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
import { Logo } from '@/components/ui/Logo';
import { LearnIcon, DrillIcon, ExploreIcon } from '@/components/ui/ChessIcons';
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

function plainEnglishGoal(p: EndgamePosition): string {
  const side = p.side === 'w' ? 'White' : 'Black';
  if (p.goal === 'win') {
    if (p.category === 'queen' || p.category === 'rook' || p.category === 'minor') {
      return `Checkmate the lone king · You play ${side}`;
    }
    return `Win the position · You play ${side}`;
  }
  return `Hold the draw · You play ${side}`;
}

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

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[auto_360px]">
      <div className="flex flex-col items-center">
        <Chessground config={cgConfig} />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={goPrev}
            disabled={nodeIdx === 0}
            aria-label="Previous move"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Prev
          </button>
          <div className="font-mono text-xs text-muted-foreground">
            {nodeIdx + 1} / {lesson.nodes.length}
          </div>
          <button
            type="button"
            onClick={goNext}
            disabled={finished}
            aria-label="Next move"
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
          {finished && (
            <button
              type="button"
              onClick={goRestart}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
            >
              ↻ Restart
            </button>
          )}
        </div>
      </div>

      {/* Speech-bubble panel — knight avatar + prose. Animates in on node change. */}
      <aside aria-live="polite" className="flex gap-3">
        <div className="flex-shrink-0 pt-1">
          <Logo size={40} decorative />
        </div>
        <div className="flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={nodeIdx}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="relative rounded-2xl rounded-tl-sm border border-border bg-elevated p-4 text-sm leading-relaxed shadow-sm"
            >
              <span
                aria-hidden
                className="absolute -left-2 top-3 h-3 w-3 rotate-45 border-b border-l border-border bg-elevated"
              />
              <p className="text-foreground">{renderProse(node.text)}</p>
              {finished && (
                <p className="mt-3 text-xs font-medium text-accent">
                  ✓ End of lesson — switch to Drill to test what you've learned.
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
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

  const verdict = useMemo(
    () => verdictText(tbCurrent, position.side, position.goal),
    [tbCurrent, position.side, position.goal],
  );

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_280px]">
      <div className="flex flex-col items-center gap-2">
        <div className="flex w-[min(80vh,90vw,640px)] flex-col gap-2">
          {/* Plain-English verdict strip — replaces raw "category: cursed-win,
              dtz: 12" with "You are winning · Mate in 14". Mirrors the
              lichess endgame trainer cue the user asked for. */}
          <div
            role="status"
            aria-live="polite"
            className={`flex h-8 w-full items-center justify-center rounded-md border px-3 text-sm font-semibold ${verdictToneClass(verdict.tone)}`}
          >
            {verdict.text}
          </div>
          <Chessground config={cgConfig} />
        </div>
      </div>

      <aside className="flex flex-col gap-3 text-sm">
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
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[auto_360px]">
      <div className="flex justify-center">
        <Chessground config={cgConfig} />
      </div>
      <aside className="flex flex-col gap-3 text-sm">
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

// ───── Friendly progress chip ────────────────────────────────────────────

function ProgressChip({ label, value, total, hint }: { label: string; value: number; total: number; hint?: string }): ReactNode {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div title={hint} className="min-w-[140px]">
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{value}/{total}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full bg-accent"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
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
  const [activePositionId, setActivePositionId] = useState<string>(initialPos.id);
  const [mode, setMode] = useState<Mode>('learn');
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(
    () => new Set(ENDGAME_COURSES.length > 0 ? [ENDGAME_COURSES[0]!.id] : []),
  );

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

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Single shared grid: course sidebar (left) + content column (right).
          Putting EVERYTHING in one grid means the header, tabs, and mode body
          all align to the same left edge — same fix that was applied to
          Openings.tsx for the alignment issue. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
        {/* Course sidebar — sticky on desktop so it stays visible while
            scrolling through long Drill move lists. */}
        <aside className="md:sticky md:top-4 md:self-start max-h-[calc(100vh-6rem)] overflow-y-auto rounded-md border border-border bg-elevated/40 p-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Courses</h3>
          </div>
          {ENDGAME_COURSES.map((course) => {
            const expanded = expandedCourses.has(course.id);
            const courseHasActive = course.positions.some((p) => p.id === activePositionId);
            return (
              <section key={course.id} className="mb-2">
                <button
                  type="button"
                  onClick={() => toggleCourse(course.id)}
                  aria-expanded={expanded}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide transition-colors ${
                    courseHasActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span>{course.name}</span>
                  <span aria-hidden className="font-mono text-[10px]">{expanded ? '−' : '+'}</span>
                </button>
                {expanded && (
                  <ul className="mt-1 space-y-0.5">
                    {course.positions.map((p) => {
                      const stars = masteryByPos.get(p.id) ?? 0;
                      const isActive = p.id === activePositionId;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => { setActivePositionId(p.id); }}
                            className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-xs transition-all ${
                              isActive
                                ? 'bg-accent text-accent-foreground'
                                : 'hover:bg-muted'
                            }`}
                          >
                            <span className="line-clamp-2 leading-snug">{p.name}</span>
                            <span className={`flex items-center justify-between text-[10px] ${
                              isActive ? 'text-accent-foreground/80' : 'text-muted-foreground'
                            }`}>
                              <span>{p.side === 'w' ? 'White' : 'Black'} · {p.goal}</span>
                              <StarStrip count={stars} />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </aside>

        {/* Right column — header, tabs, mode body all flow vertically and align
            to the same left edge as each other. `min-w-0` prevents long
            content (move lists, prose) from blowing the grid out. */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="rounded-md border border-border bg-elevated p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {activeCourse?.name ?? activePosition.category}
            </div>
            <h2 className="font-display text-2xl font-semibold">{activePosition.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{plainEnglishGoal(activePosition)}</p>
            <p className="mt-2 text-xs text-muted-foreground">{activePosition.description}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-xs">
              <ProgressChip
                label="Lines learned"
                value={courseStats.learned}
                total={courseStats.learnedTotal}
                hint="Lesson nodes seen across this course in Learn mode"
              />
              <ProgressChip
                label="Mastered"
                value={courseStats.mastered}
                total={courseStats.masteredTotal}
                hint="Up to 5 stars per position — earned by efficient drill wins"
              />
            </div>
          </div>

          {/* Mode tab strip — uses framer-motion layoutId for the sliding pill */}
          <div className="flex items-center gap-1 self-start rounded-md border border-border bg-elevated/40 p-1 text-sm">
            {(['learn', 'drill', 'explore'] as Mode[]).map((m) => {
              const isActive = mode === m;
              const disabled = m === 'learn' && !lesson;
              const label = m === 'learn' ? 'Learn' : m === 'drill' ? 'Drill' : 'Explore';
              const Icon = m === 'learn' ? LearnIcon : m === 'drill' ? DrillIcon : ExploreIcon;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => !disabled && setMode(m)}
                  disabled={disabled}
                  className={`relative rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                    isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="endgame-tab-pill"
                      className="absolute inset-0 rounded bg-background shadow-sm"
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                  <span className="relative inline-flex items-center gap-1.5">
                    <Icon size={15} />
                    {label}
                  </span>
                </button>
              );
            })}
            {!lesson && (
              <span className="ml-2 text-[11px] text-muted-foreground">
                No prose lesson for this position yet — Learn unlocks once one is authored.
              </span>
            )}
          </div>

          {/* Mode body — INSIDE the right column so it aligns with header + tabs */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`${activePositionId}-${mode}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
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
      </div>
    </div>
  );
}
