import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import { motion, AnimatePresence } from 'framer-motion';
import { Chessground } from '@/chess/board';
import { OPENINGS } from '@/chess/openings/book';
import { isPromotion, lastMoveSquares, legalDests, turnColor } from '@/chess/rules';
import type { Square } from '@/chess/rules';
import { playSound } from '@/sound';
import {
  allMoves,
  courseFor,
  getMove,
  importCuratedSpec,
  importLichessStudy,
  importPgn,
  linesCompletedFor,
  listLineProgress,
  listRepertoires,
  markLineNodeVisited,
  onCorrect,
  onWrong,
  putMove,
  recordAttempt,
  selectDrillLine,
  STARTING_FEN_NORM,
  type LineProgress,
  type OpeningCourse,
  type OpeningLine,
  type RepMove,
  type Repertoire,
} from '@/openings';
import { DrillSession, type SessionView } from '@/openings/drillSession';
import { Logo } from '@/components/ui/Logo';
import { MiniBoardPreview } from '@/components/ui/MiniBoardPreview';
import { LessonBubble } from '@/components/ui/LessonBubble';
import { PawnSkeleton } from '@/components/ui/PawnSkeleton';
import { extractVisualMarkers, parseProse } from '@/openings/proseParser';
import {
  LearnIcon, DrillIcon, ExploreIcon, PuzzlesIcon, TestIcon,
  OpenGameIcon, ClosedGameIcon, DefenceIcon, KingIcon, KnightIcon,
  type ChessIconProps,
} from '@/components/ui/ChessIcons';
import { PuzzlesView } from './OpeningsPuzzlesView';
import { OpeningsTestView } from './OpeningsTestView';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';

/** Map an opening category (from book.ts) to its icon. */
const CATEGORY_ICONS: Record<string, (p: ChessIconProps) => ReactNode> = {
  open: OpenGameIcon,
  'semi-open': DefenceIcon,
  closed: ClosedGameIcon,
  flank: KnightIcon,
  indian: KingIcon,
};

type Mode = 'learn' | 'drill' | 'explore' | 'puzzles' | 'test';
type CategoryFilter = 'open' | 'semi-open' | 'closed' | 'flank' | 'indian' | 'imported';
type ColorFilter = 'white' | 'black';

const RED_FLASH_MS = 600;
const GREEN_CHECK_MS = 700;
const REENABLE_BOARD_MS = 250;
const REVEAL_PULSE_AFTER = 2;
const STARTING_FEN_FULL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const SVG_CORRECT = `
  <g transform="translate(60,60) scale(0.32)">
    <circle cx="50" cy="50" r="48" fill="#22c55e" stroke="white" stroke-width="6"/>
    <path d="M 26 52 L 44 70 L 76 32" stroke="white" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>`;

const SVG_WRONG = `
  <g transform="translate(60,60) scale(0.32)">
    <circle cx="50" cy="50" r="48" fill="#ef4444" stroke="white" stroke-width="6"/>
    <path d="M 30 30 L 70 70 M 70 30 L 30 70" stroke="white" stroke-width="12" stroke-linecap="round"/>
  </g>`;

const _SVG_BRILLIANT = `
  <g transform="translate(60,60) scale(0.32)">
    <circle cx="50" cy="50" r="48" fill="#0ea5e9" stroke="white" stroke-width="6"/>
    <text x="50" y="68" text-anchor="middle" font-family="serif" font-size="56" font-weight="700" fill="white">!!</text>
  </g>`;
void _SVG_BRILLIANT;

// ───── Friendly metric helpers ────────────────────────────────────────────

function masteredCount(moves: RepMove[]): number {
  return moves.filter(
    (m) => m.isOwnMove && !m.deleted && m.learningStep === null && (m.reviewIntervalDays ?? 0) >= 7,
  ).length;
}

// ───── Speech-bubble prose renderer ──────────────────────────────────────

function renderInline(segment: string, keyPrefix: string): ReactNode[] {
  return segment.split(/(\*\*[^*]+\*\*)/).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={`${keyPrefix}-b-${i}`} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyPrefix}-t-${i}`}>{p}</span>
    ),
  );
}

function renderParagraph(para: string, paraIdx: number): ReactNode {
  const sentences = para.split(/(?<=[.!?])\s+(?=[A-Z"'(])/);
  return (
    <div key={`p-${paraIdx}`} className={paraIdx > 0 ? 'mt-4' : ''}>
      {sentences.map((s, si) => (
        <p
          key={`p-${paraIdx}-s-${si}`}
          className={si === 0 ? '' : 'mt-2'}
        >
          {renderInline(s, `p-${paraIdx}-s-${si}`)}
        </p>
      ))}
    </div>
  );
}

// Legacy renderProse retained for the Drill / Explore views which
// still use the simpler bold-and-paragraph rendering. The Learn view
// now uses LessonBubble for structured tabiya rendering.
function renderProse(text: string): ReactNode {
  const paragraphs = text.split(/\n\n+/);
  return <>{paragraphs.map((para, pi) => renderParagraph(para, pi))}</>;
}
// Mark as used to satisfy noUnusedLocals - other views that still use
// it will import via this binding once they're refactored. For now we
// keep it exported-equivalent to avoid the lint failure.
void renderProse;

// ───── Learn-mode viewer ──────────────────────────────────────────────────

interface LearnViewProps {
  course: OpeningCourse;
  line: OpeningLine;
  repertoireId: number;
  initialNodeIdx: number;
  onProgress: (nodeIdx: number) => void;
}

function LearnView({ course, line, repertoireId: _repertoireId, initialNodeIdx, onProgress }: LearnViewProps): ReactNode {
  const [nodeIdx, setNodeIdx] = useState<number>(Math.min(initialNodeIdx, line.nodes.length - 1));

  const node = line.nodes[nodeIdx]!;

  const fen = useMemo(() => {
    const game = new Chess();
    for (let i = 1; i <= nodeIdx; i++) {
      const n = line.nodes[i];
      if (!n?.san) continue;
      try { game.move(n.san); } catch { /* skip on data drift; validator catches at test time */ }
    }
    return game.fen();
  }, [nodeIdx, line.nodes]);

  const lastMove = useMemo<[Square, Square] | undefined>(() => {
    if (nodeIdx === 0) return undefined;
    const cur = line.nodes[nodeIdx];
    if (!cur?.fen || !cur.san) return undefined;
    try {
      const game = new Chess();
      for (let i = 1; i <= nodeIdx - 1; i++) {
        const n = line.nodes[i];
        if (!n?.san) continue;
        game.move(n.san);
      }
      const m = game.move(cur.san);
      return [m.from, m.to];
    } catch {
      return undefined;
    }
  }, [nodeIdx, line.nodes]);

  const playerSide = course.openingId.endsWith('-black') ? 'black' : 'white';

  // Extract visual markers from the current node's prose so the
  // chessground overlays the squares the lesson is talking about.
  // Yellow circles for "Key squares" the lesson names, green for
  // squares in White's plan, blue for squares in Black's plan, red
  // for squares in the tactical-theme callout.
  const visualMarkers = useMemo(() => extractVisualMarkers(parseProse(node.text)), [node.text]);

  const autoShapes = useMemo<DrawShape[]>(() => {
    const shapes: DrawShape[] = [];
    for (const m of visualMarkers.highlightSquares) {
      shapes.push({ orig: m.square as Square, brush: m.brush });
    }
    return shapes;
  }, [visualMarkers]);

  const cgConfig = useMemo<Config>(() => ({
    fen,
    orientation: playerSide,
    viewOnly: true,
    coordinates: true,
    ...(lastMove !== undefined ? { lastMove } : {}),
    animation: { enabled: true, duration: 250 },
    highlight: { lastMove: true, check: true },
    drawable: { enabled: false, visible: true, autoShapes },
  } satisfies Config), [fen, playerSide, lastMove, autoShapes]);

  const goNext = useCallback(() => {
    setNodeIdx((i) => {
      const next = Math.min(i + 1, line.nodes.length - 1);
      if (next > i) {
        playSound('move');
        onProgress(next);
      }
      return next;
    });
  }, [line.nodes.length, onProgress]);

  const goPrev = useCallback(() => {
    setNodeIdx((i) => Math.max(i - 1, 0));
  }, []);

  const goRestart = useCallback(() => {
    setNodeIdx(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  const finished = nodeIdx === line.nodes.length - 1;

  // The board column wraps the board in `.cg-board-fit` (a CSS
  // container-queries-based square that fits the smaller of its
  // parent's width and height). The container itself uses flex-1 so it
  // gobbles the column's height after the controls strip below the
  // board has taken its share. Bubble column scrolls vertically when
  // prose is tall so the page itself never scrolls. The h-full chain
  // traces back through AnimatePresence's flex-1 motion.div →
  // CourseDetail's flex column → <main>'s min-h-0 flex-1 → Layout's
  // h-screen.
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 md:grid-cols-[auto_minmax(280px,360px)]">
      <div className="flex min-h-0 min-w-0 flex-col items-center justify-start">
        <div className="cg-board-fit">
          <Chessground config={cgConfig} />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={goPrev}
            disabled={nodeIdx === 0}
            aria-label="Previous move"
            className="rounded-md border border-border bg-background px-3 py-1 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Prev
          </button>
          <div className="font-mono text-xs text-muted-foreground">
            {nodeIdx + 1} / {line.nodes.length}
          </div>
          <button
            type="button"
            onClick={goNext}
            disabled={finished}
            aria-label="Next move"
            className="rounded-md bg-accent px-4 py-1 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
          {finished && (
            <button
              type="button"
              onClick={goRestart}
              className="rounded-md border border-border bg-background px-3 py-1 text-sm hover:bg-muted"
            >
              ↻ Restart
            </button>
          )}
        </div>
      </div>

      <aside aria-live="polite" className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto">
        <div className="flex min-w-0 gap-3">
          <div className="flex-shrink-0 pt-1">
            <Logo size={32} decorative />
          </div>
          <div className="min-w-0 flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${line.id}-${nodeIdx}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="relative rounded-2xl rounded-tl-sm border border-border bg-elevated p-4 text-[14px] leading-6 shadow-sm"
              >
                <span
                  aria-hidden
                  className="absolute -left-2 top-3 h-3 w-3 rotate-45 border-b border-l border-border bg-elevated"
                />
                <LessonBubble text={node.text} />
                {finished && (
                  <p className="mt-3 text-sm font-medium text-accent">
                    ✓ End of line — switch to Drill to test what you've learned.
                  </p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Pawn-skeleton diagram: only show on the FINAL tabiya node
            where structural understanding matters most. Earlier per-
            move nodes are about specific moves; the pawn structure
            is the same as the parent so a duplicate would just be
            visual noise. */}
        {finished && (
          <div className="flex items-center gap-3 rounded-md border border-border bg-elevated/40 p-2.5 text-xs">
            <PawnSkeleton fen={fen} size={96} orientation={playerSide} />
            <div className="min-w-0">
              <div className="font-semibold uppercase tracking-wide text-muted-foreground">Pawn skeleton</div>
              <p className="mt-1 leading-snug text-muted-foreground">
                The pawn structure of this tabiya. Most middlegame
                plans are about these pawns - everything else moves
                around them.
              </p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

// ───── Drill view (chessdriller wrong-move UX, scoped to the active line) ──

interface DrillViewProps {
  repertoire: Repertoire;
  line: OpeningLine | undefined;
  onMastery: () => void;
}

function DrillView({ repertoire, line, onMastery }: DrillViewProps): ReactNode {
  const sessionRef = useRef<DrillSession | null>(null);
  const [sessionView, setSessionView] = useState<SessionView | null>(null);
  const [boardLocked, setBoardLocked] = useState(false);
  const [redFlashSquare, setRedFlashSquare] = useState<Square | null>(null);
  const [greenCheckSquare, setGreenCheckSquare] = useState<Square | null>(null);
  const [showRevealArrow, setShowRevealArrow] = useState(false);
  const [empty, setEmpty] = useState(false);

  const loadNextLine = useCallback(async () => {
    if (line) {
      const edges: RepMove[] = [];
      for (let i = 1; i < line.nodes.length; i++) {
        const fromFen = line.nodes[i - 1]!.fen;
        const toFen = line.nodes[i]!.fen;
        const m = await getMove(repertoire.id, fromFen, toFen);
        if (!m) break;
        edges.push(m);
      }
      if (edges.length > 0) {
        setEmpty(false);
        sessionRef.current = new DrillSession({ startFen: STARTING_FEN_NORM, edges });
        setSessionView(sessionRef.current.view());
        setBoardLocked(false);
        setRedFlashSquare(null);
        setShowRevealArrow(false);
        return;
      }
    }

    const drill = await selectDrillLine(repertoire.id);
    if (!drill) {
      setEmpty(true);
      sessionRef.current = null;
      setSessionView(null);
      return;
    }
    setEmpty(false);
    sessionRef.current = new DrillSession(drill);
    setSessionView(sessionRef.current.view());
    setBoardLocked(false);
    setRedFlashSquare(null);
    setShowRevealArrow(false);
  }, [repertoire.id, line]);

  useEffect(() => {
    void loadNextLine();
  }, [loadNextLine]);

  const handlePlayerMove = useCallback(
    (from: Square, to: Square): void => {
      const session = sessionRef.current;
      if (!session || boardLocked) return;
      const v = session.view();
      if (v.expected === null) return;

      const probe = new Chess(v.fen);
      let userUci: string;
      try {
        const m = probe.move({ from, to, promotion: isPromotion(probe, from, to) ? 'q' : 'q' });
        userUci = m.from + m.to + (m.promotion ?? '');
      } catch {
        return;
      }

      const result = session.attempt(userUci);
      if (result.kind === 'no-op') return;

      if (result.kind === 'wrong') {
        setSessionView(session.view());
        setRedFlashSquare(to);
        setBoardLocked(true);
        playSound('check');
        setTimeout(() => setRedFlashSquare(null), RED_FLASH_MS);
        setTimeout(() => setBoardLocked(false), REENABLE_BOARD_MS);
        const lastSan = probe.history({ verbose: true }).slice(-1)[0]?.san;
        void (async () => {
          const updated: RepMove = { ...result.correctMove, ...onWrong(result.correctMove) };
          await putMove(updated);
          await recordAttempt({
            repertoireId: repertoire.id,
            fromFen: result.correctMove.fromFen,
            toFen: result.correctMove.toFen,
            studiedAt: Date.now(),
            wasCorrect: false,
            ...(lastSan !== undefined ? { incorrectGuessSan: lastSan } : {}),
          });
          onMastery();
        })();
        return;
      }

      const expected = v.expected;
      const repertoireId = repertoire.id;
      playSound('move');
      setSessionView(result.advancedTo);
      setShowRevealArrow(false);
      setGreenCheckSquare(to);
      setTimeout(() => setGreenCheckSquare(null), GREEN_CHECK_MS);
      if (result.advancedTo.finished) {
        setBoardLocked(true);
        setTimeout(() => { void loadNextLine(); }, 600);
      }
      void (async () => {
        const updated: RepMove = { ...expected, ...onCorrect(expected) };
        await putMove(updated);
        await recordAttempt({
          repertoireId,
          fromFen: expected.fromFen,
          toFen: expected.toFen,
          studiedAt: Date.now(),
          wasCorrect: true,
        });
        onMastery();
      })();
    },
    [repertoire.id, boardLocked, loadNextLine, onMastery],
  );

  const handleReveal = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const r = session.reveal();
    if (!r) return;
    playSound('move');
    const srs = onWrong(r.revealed);
    await putMove({ ...r.revealed, ...srs });
    await recordAttempt({
      repertoireId: repertoire.id,
      fromFen: r.revealed.fromFen,
      toFen: r.revealed.toFen,
      studiedAt: Date.now(),
      wasCorrect: false,
      incorrectGuessSan: '(shown)',
    });
    setSessionView(r.advancedTo);
    setShowRevealArrow(false);
    onMastery();
    if (r.advancedTo.finished) {
      setBoardLocked(true);
      setTimeout(() => { void loadNextLine(); }, 600);
    }
  }, [repertoire.id, loadNextLine, onMastery]);

  const handleRestart = useCallback(() => {
    sessionRef.current?.reset();
    setSessionView(sessionRef.current?.view() ?? null);
    setRedFlashSquare(null);
    setShowRevealArrow(false);
    setBoardLocked(false);
  }, []);

  const boardFen = sessionView?.fen ?? STARTING_FEN_FULL;
  const game = useMemo(() => new Chess(boardFen), [boardFen]);
  const sideToMove = turnColor(game);
  const playerSide: 'white' | 'black' = repertoire.repForWhite ? 'white' : 'black';

  const isPlayerTurn =
    !boardLocked &&
    sessionView !== null &&
    sessionView.expected !== null &&
    sessionView.expected.isOwnMove &&
    sideToMove === playerSide;

  const dests = useMemo(() => (isPlayerTurn ? legalDests(game) : new Map<Square, Square[]>()), [game, isPlayerTurn]);
  const lastMove = useMemo(() => lastMoveSquares(game), [game]);

  const autoShapes = useMemo<DrawShape[]>(() => {
    const shapes: DrawShape[] = [];
    if (redFlashSquare) {
      shapes.push({ orig: redFlashSquare, brush: 'red', customSvg: { html: SVG_WRONG } });
    }
    if (greenCheckSquare) {
      shapes.push({ orig: greenCheckSquare, brush: 'green', customSvg: { html: SVG_CORRECT } });
    }
    if (showRevealArrow && sessionView?.expected) {
      const u = sessionView.expected.uci;
      shapes.push({ orig: u.slice(0, 2) as Square, dest: u.slice(2, 4) as Square, brush: 'green' });
    }
    return shapes;
  }, [redFlashSquare, greenCheckSquare, showRevealArrow, sessionView]);

  const cgConfig = useMemo<Config>(() => ({
    fen: boardFen,
    orientation: playerSide,
    turnColor: sideToMove,
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
    drawable: { enabled: true, visible: true, autoShapes },
  } satisfies Config), [boardFen, playerSide, sideToMove, lastMove, isPlayerTurn, dests, handlePlayerMove, autoShapes]);

  if (empty) {
    return (
      <div className="rounded-md border border-border bg-elevated p-6 text-sm">
        <p className="font-medium">No lines in this course yet.</p>
        <p className="mt-1 text-muted-foreground">Switch to <strong>Learn</strong> to walk through the prose introduction, or import more material.</p>
      </div>
    );
  }

  const showRevealButton = (sessionView?.wrongAttempts ?? 0) >= REVEAL_PULSE_AFTER;
  const formatHistory = (sans: { san: string }[]): string =>
    sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s.san}` : s.san)).join(' ');

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 md:grid-cols-[auto_minmax(260px,320px)]">
      <div className="flex min-h-0 min-w-0 flex-col items-center justify-start">
        <div className="cg-board-fit">
          <Chessground config={cgConfig} />
        </div>
      </div>
      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto text-sm">
        <div role="status" aria-live="polite" className="rounded-md border border-border bg-elevated p-4">
          {sessionView?.finished ? (
            <>
              <p className="text-base font-semibold text-accent">✓ Line complete</p>
              <p className="mt-1 text-xs text-muted-foreground">Loading next line…</p>
            </>
          ) : sessionView?.expected?.isOwnMove ? (
            <>
              <p className="text-base font-semibold">{sideToMove === 'white' ? 'White' : 'Black'} to move</p>
              {sessionView.wrongAttempts === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">Play the move from your repertoire.</p>
              ) : (
                <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                  Not the rep move. Try again.
                  {sessionView.wrongAttempts >= REVEAL_PULSE_AFTER && ' Use Show answer if stuck.'}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Waiting…</p>
          )}
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={handleRestart} className="flex-1 rounded border border-border bg-background py-2 text-xs hover:bg-muted">
            Restart line
          </button>
          {showRevealButton && (
            <button
              type="button"
              onClick={() => { setShowRevealArrow(true); void handleReveal(); }}
              className="flex-1 animate-pulse rounded bg-amber-500 py-2 text-xs font-medium text-white hover:opacity-90"
            >
              Show answer
            </button>
          )}
        </div>

        {sessionView && sessionView.history.length > 0 && (
          <div className="rounded border border-border bg-elevated p-3 text-xs">
            <div className="mb-1 uppercase text-muted-foreground">This line</div>
            <p className="font-mono leading-relaxed">{formatHistory(sessionView.history)}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

// ───── Explore view — links to /analysis ────────────────────────────────

function ExploreView({ repertoire, line }: { repertoire: Repertoire; line: OpeningLine | undefined }): ReactNode {
  const fen = useMemo(() => {
    if (!line) return STARTING_FEN_FULL;
    const game = new Chess();
    for (let i = 1; i < line.nodes.length; i++) {
      const n = line.nodes[i];
      if (!n?.san) continue;
      try { game.move(n.san); } catch { return STARTING_FEN_FULL; }
    }
    return game.fen();
  }, [line]);

  const cgConfig: Config = {
    fen,
    orientation: repertoire.repForWhite ? 'white' : 'black',
    viewOnly: true,
    animation: { enabled: false, duration: 0 },
  };
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 md:grid-cols-[auto_minmax(280px,360px)]">
      <div className="flex min-h-0 min-w-0 flex-col items-center justify-start">
        <div className="cg-board-fit">
          <Chessground config={cgConfig} />
        </div>
      </div>
      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto text-sm">
        <div className="rounded-md border border-border bg-elevated p-4">
          <h3 className="text-base font-semibold">Open in Analysis Board</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Explore {line ? <><strong>{line.name}</strong> from its end position</> : 'this opening from the starting position'} with Stockfish — multi-line analysis, eval bar,
            move-tree navigation. Make your own moves and see why the engine prefers what it prefers.
          </p>
          <Link
            to={`/analysis?fen=${encodeURIComponent(fen)}`}
            className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"
          >
            Open Analysis Board →
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          Tip: you can also enter the analysis board from the Tactics page (the small "Analyze position →" link under the puzzle).
        </p>
      </aside>
    </div>
  );
}

// ───── Per-line picker (chessreps-style line cards) ──────────────────────

interface LineCardProps {
  line: OpeningLine;
  active: boolean;
  progress: LineProgress | undefined;
  onSelect: () => void;
}

function LineCard({ line, active, progress, onSelect }: LineCardProps): ReactNode {
  const status: 'unseen' | 'in-progress' | 'completed' =
    progress === undefined || progress.discoveredNodeIdx <= 0
      ? 'unseen'
      : progress.completed
        ? 'completed'
        : 'in-progress';
  const badge = status === 'completed' ? '●' : status === 'in-progress' ? '◐' : '◯';
  const badgeTitle =
    status === 'completed' ? 'Completed' : status === 'in-progress' ? 'In progress' : 'Not started';
  const isDeviation = line.parentLineId !== undefined;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={
        isDeviation
          ? `Deviation off the ${line.parentLineId} mainline at ply ${line.deviationFromMove ?? '?'}`
          : undefined
      }
      className={`group flex shrink-0 flex-col gap-0 rounded-md border px-2 py-1 text-left transition-colors ${
        isDeviation ? 'min-w-[150px] max-w-[200px] ml-2 border-l-2 border-l-violet-400/60 dark:border-l-violet-300/40' : 'min-w-[170px] max-w-[220px]'
      } ${
        active
          ? 'border-accent bg-accent/10 shadow-sm'
          : 'border-border bg-elevated hover:bg-muted'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`truncate text-[12px] font-semibold leading-tight ${active ? 'text-foreground' : ''}`}>{line.name}</span>
        <span
          aria-label={badgeTitle}
          title={badgeTitle}
          className={`text-[10px] ${
            status === 'completed'
              ? 'text-accent'
              : status === 'in-progress'
                ? 'text-amber-500'
                : 'text-muted-foreground'
          }`}
        >
          {badge}
        </span>
      </div>
      <p
        className="line-clamp-1 text-[10px] leading-snug text-muted-foreground"
        title={line.description}
      >
        {line.description}
      </p>
      <div className="flex items-center gap-1.5">
        <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
          {line.nodes.length - 1} ply
        </p>
        {isDeviation && (
          <span
            className="rounded-sm bg-violet-100 px-1 py-0 text-[8.5px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
            aria-label="Deviation off the parent mainline"
          >
            Dev
          </span>
        )}
      </div>
    </button>
  );
}

/**
 * Order a course's lines so each deviation (`parentLineId` set) sits
 * immediately after its parent, with non-deviation lines (mainlines)
 * keeping their authored order. Stable: lines that aren't deviations
 * stay in the order they were declared in lessons.ts; deviations are
 * grouped under their parent in their authored order. If a deviation
 * names a missing parent (shouldn't happen) we append it at the end so
 * it's still reachable.
 */
function orderLinesForPicker(lines: OpeningLine[]): OpeningLine[] {
  const childrenByParent = new Map<string, OpeningLine[]>();
  const orphanedDeviations: OpeningLine[] = [];
  const mainlines: OpeningLine[] = [];
  const known = new Set(lines.map((l) => l.id));
  for (const l of lines) {
    if (l.parentLineId === undefined) {
      mainlines.push(l);
    } else if (known.has(l.parentLineId)) {
      const arr = childrenByParent.get(l.parentLineId) ?? [];
      arr.push(l);
      childrenByParent.set(l.parentLineId, arr);
    } else {
      orphanedDeviations.push(l);
    }
  }
  const out: OpeningLine[] = [];
  for (const m of mainlines) {
    out.push(m);
    const kids = childrenByParent.get(m.id);
    if (kids) out.push(...kids);
  }
  out.push(...orphanedDeviations);
  return out;
}

// ───── Course detail (header + tabs + mode body) ─────────────────────────

interface CourseDetailProps {
  repertoire: Repertoire;
  course: OpeningCourse | undefined;
  onBack: () => void;
}

function CourseDetail({ repertoire, course, onBack }: CourseDetailProps): ReactNode {
  const [activeLineId, setActiveLineId] = useState<string | null>(course?.lines[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>(course ? 'learn' : 'drill');
  const [lineProgressRows, setLineProgressRows] = useState<LineProgress[]>([]);
  const [stats, setStats] = useState<{ mastered: number; ownTotal: number; linesCompleted: number; linesTotal: number }>({
    mastered: 0,
    ownTotal: 0,
    linesCompleted: 0,
    linesTotal: 0,
  });

  // Reset active line whenever repertoire/course changes — pick first line.
  useEffect(() => {
    if (!course) {
      setActiveLineId(null);
      return;
    }
    const exists = activeLineId !== null && course.lines.some((l) => l.id === activeLineId);
    if (!exists) {
      setActiveLineId(course.lines[0]?.id ?? null);
    }
  }, [course, activeLineId]);

  const activeLine: OpeningLine | undefined = useMemo(() => {
    if (!course || activeLineId === null) return undefined;
    return course.lines.find((l) => l.id === activeLineId) ?? course.lines[0];
  }, [course, activeLineId]);

  const refreshStats = useCallback(async () => {
    if (!course) {
      setLineProgressRows([]);
      return;
    }
    const moves = await allMoves(repertoire.id);
    const own = moves.filter((m) => m.isOwnMove);
    const completed = await linesCompletedFor(repertoire.id);
    const rows = await listLineProgress(repertoire.id);
    setLineProgressRows(rows);
    setStats({
      mastered: masteredCount(moves),
      ownTotal: own.length,
      linesCompleted: completed.size,
      linesTotal: course.lines.length,
    });
  }, [repertoire.id, course]);

  useEffect(() => { void refreshStats(); }, [refreshStats]);

  useEffect(() => {
    if (mode === 'learn' && !course) setMode('drill');
  }, [course, mode]);

  const activeLineProgress = useMemo<LineProgress | undefined>(() => {
    if (!activeLine) return undefined;
    return lineProgressRows.find((r) => r.lineId === activeLine.id);
  }, [activeLine, lineProgressRows]);

  const handleLearnProgress = useCallback(
    async (nodeIdx: number) => {
      if (!activeLine) return;
      await markLineNodeVisited(repertoire.id, activeLine.id, nodeIdx, activeLine.nodes.length);
      await refreshStats();
    },
    [repertoire.id, activeLine, refreshStats],
  );

  // [/] keyboard shortcuts to cycle lines. Uses the picker order so a
  // deviation's siblings are reached in the same order they're rendered
  // (mainline → its deviations → next mainline → its deviations …).
  useEffect(() => {
    if (!course || course.lines.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key !== '[' && e.key !== ']') return;
      e.preventDefault();
      const ordered = orderLinesForPicker(course.lines);
      const idx = ordered.findIndex((l) => l.id === activeLineId);
      const next = e.key === ']' ? idx + 1 : idx - 1;
      const wrapped = ((next % ordered.length) + ordered.length) % ordered.length;
      setActiveLineId(ordered[wrapped]!.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [course, activeLineId]);

  return (
    <div className="flex h-full min-w-0 flex-col gap-2 overflow-hidden">
      {/* Compact header: back link + title + side badge + stats inline.
          Replaces the previous tall card so the board has more room
          on small laptops without sacrificing information density. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back
        </button>
        <h2 className="font-display text-lg font-semibold leading-tight">{repertoire.name}</h2>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {repertoire.repForWhite ? 'White' : 'Black'}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span title="Lines you've walked through Learn mode end-to-end">
            <span className="font-semibold text-foreground">{stats.linesCompleted}</span>
            <span className="opacity-60"> / {stats.linesTotal}</span> lines
          </span>
          <span title="Your own-moves with at least a 7-day review interval">
            <span className="font-semibold text-foreground">{stats.mastered}</span>
            <span className="opacity-60"> / {stats.ownTotal}</span> mastered
          </span>
        </div>
      </div>
      {(course?.tagline ?? repertoire.description) && (
        <p className="-mt-1 text-xs text-muted-foreground">{course?.tagline ?? repertoire.description}</p>
      )}

      {course && course.lines.length > 0 && (
        <section aria-label="Lines in this opening" className="shrink-0 rounded-md border border-border bg-elevated/40 px-2 py-1.5">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="font-display text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lines</h3>
            <p className="text-[10px] text-muted-foreground">
              {(() => {
                const mainlineCount = course.lines.filter((l) => l.parentLineId === undefined).length;
                const deviationCount = course.lines.length - mainlineCount;
                if (course.lines.length === 1) return '1 line';
                const base = deviationCount > 0
                  ? `${mainlineCount} mainline${mainlineCount === 1 ? '' : 's'} · ${deviationCount} deviation${deviationCount === 1 ? '' : 's'}`
                  : `${mainlineCount} lines`;
                return (
                  <>
                    {base} · <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">[</kbd> / <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">]</kbd>
                  </>
                );
              })()}
            </p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {orderLinesForPicker(course.lines).map((l) => {
              const progress = lineProgressRows.find((r) => r.lineId === l.id);
              return (
                <LineCard
                  key={l.id}
                  line={l}
                  active={l.id === activeLineId}
                  progress={progress}
                  onSelect={() => setActiveLineId(l.id)}
                />
              );
            })}
          </div>
        </section>
      )}

      <div className="flex shrink-0 items-center gap-1 self-start rounded-md border border-border bg-elevated/40 p-1 text-sm">
        {(['learn', 'drill', 'explore', 'puzzles', 'test'] as Mode[]).map((m) => {
          const isActive = mode === m;
          // 'test' shares the 'no course = disabled' policy with
          // 'learn' because both depend on the lesson tabiya prose
          // existing for this opening.
          const disabled = (m === 'learn' || m === 'test') && !course;
          const label =
            m === 'learn' ? 'Learn' :
            m === 'drill' ? 'Drill' :
            m === 'explore' ? 'Explore' :
            m === 'puzzles' ? 'Puzzles' :
            'Test';
          const Icon =
            m === 'learn' ? LearnIcon :
            m === 'drill' ? DrillIcon :
            m === 'explore' ? ExploreIcon :
            m === 'puzzles' ? PuzzlesIcon :
            TestIcon;
          return (
            <button
              key={m}
              type="button"
              onClick={() => !disabled && setMode(m)}
              disabled={disabled}
              className={`relative rounded px-3 py-1 text-[13px] font-medium transition-colors ${
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
              title={disabled ? 'No prose course yet for this opening' : undefined}
            >
              {isActive && (
                <motion.span
                  layoutId="opening-tab-pill"
                  className="absolute inset-0 rounded bg-background shadow-sm"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              <span className="relative inline-flex items-center gap-1.5">
                <Icon size={14} />
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mode body fills the remaining viewport height. Each mode view
          assumes h-full and lays itself out internally; the board sizes
          to the smaller of (this container's height, available width). */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${repertoire.id}-${activeLineId ?? 'none'}-${mode}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="min-h-0 flex-1"
        >
          {mode === 'learn' && course && activeLine && (
            <LearnView
              course={course}
              line={activeLine}
              repertoireId={repertoire.id}
              initialNodeIdx={Math.min(activeLineProgress?.discoveredNodeIdx ?? 0, activeLine.nodes.length - 1)}
              onProgress={(idx) => void handleLearnProgress(idx)}
            />
          )}
          {mode === 'drill' && (
            <DrillView repertoire={repertoire} line={activeLine} onMastery={() => void refreshStats()} />
          )}
          {mode === 'explore' && (
            <ExploreView repertoire={repertoire} line={activeLine} />
          )}
          {mode === 'puzzles' && (
            <PuzzlesView repertoire={repertoire} />
          )}
          {mode === 'test' && (
            <OpeningsTestView repertoire={repertoire} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ───── Catalogue (chessreps-style course grid) ───────────────────────────

interface CatalogueRow {
  rep: Repertoire;
  course: OpeningCourse | undefined;
  category: CategoryFilter;
  eco: string | undefined;
  description: string;
  /** Set of completed line ids for this rep. */
  completedLines: Set<string>;
}

interface CatalogueProps {
  rows: CatalogueRow[];
  onOpen: (repId: number) => void;
  onImport: () => void;
}

function Catalogue({ rows, onOpen, onImport }: CatalogueProps): ReactNode {
  const [search, setSearch] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<CategoryFilter>>(new Set());
  const [activeColors, setActiveColors] = useState<Set<ColorFilter>>(new Set());

  // All categories that actually appear in the catalogue (filter chip strip).
  const availableCategories = useMemo(() => {
    const set = new Set<CategoryFilter>();
    for (const r of rows) set.add(r.category);
    // Order chips deterministically.
    const order: CategoryFilter[] = ['open', 'semi-open', 'closed', 'flank', 'indian', 'imported'];
    return order.filter((c) => set.has(c));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.rep.name.toLowerCase().includes(q)) return false;
      if (activeCategories.size > 0 && !activeCategories.has(r.category)) return false;
      if (activeColors.size > 0) {
        const c: ColorFilter = r.rep.repForWhite ? 'white' : 'black';
        if (!activeColors.has(c)) return false;
      }
      return true;
    });
  }, [rows, search, activeCategories, activeColors]);

  // Aggregate stats: lines learned across all reps; courses with any progress.
  const aggregate = useMemo(() => {
    let linesLearned = 0;
    let linesTotal = 0;
    let coursesStarted = 0;
    for (const r of rows) {
      const total = r.course?.lines.length ?? 0;
      linesTotal += total;
      const learned = r.completedLines.size;
      linesLearned += learned;
      if (learned > 0) coursesStarted += 1;
    }
    return { linesLearned, linesTotal, coursesStarted, coursesTotal: rows.length };
  }, [rows]);

  const toggleCategory = (c: CategoryFilter) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };
  const toggleColor = (c: ColorFilter) => {
    setActiveColors((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-display text-3xl font-semibold leading-tight">Openings</h1>
          <button
            type="button"
            onClick={onImport}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            + Import custom
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Search courses</span>
            <span aria-hidden className="text-muted-foreground">🔍</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search openings…"
              className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              aria-label="Search courses by name"
            />
          </label>

          <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-1.5">
            {availableCategories.map((c) => {
              const active = activeCategories.has(c);
              const Icon = CATEGORY_ICONS[c];
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleCategory(c)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs capitalize transition-colors ${
                    active
                      ? 'border-accent bg-accent/15 text-foreground'
                      : 'border-border bg-elevated text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {Icon ? <Icon size={11} /> : null}
                  <span>{c}</span>
                </button>
              );
            })}
          </div>

          <div role="group" aria-label="Filter by colour" className="flex gap-1.5">
            {(['white', 'black'] as ColorFilter[]).map((c) => {
              const active = activeColors.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleColor(c)}
                  className={`rounded-full border px-2.5 py-1 text-xs capitalize transition-colors ${
                    active
                      ? 'border-accent bg-accent/15 text-foreground'
                      : 'border-border bg-elevated text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>

          <div className="ml-auto text-right text-xs text-muted-foreground">
            <div>
              <span className="font-mono text-foreground">{aggregate.linesLearned}</span>
              {' / '}
              <span className="font-mono">{aggregate.linesTotal}</span>{' lines learned'}
            </div>
            <div>
              <span className="font-mono text-foreground">{aggregate.coursesStarted}</span>
              {' / '}
              <span className="font-mono">{aggregate.coursesTotal}</span>{' courses started'}
            </div>
          </div>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-elevated p-6 text-sm text-muted-foreground">
          No openings match your filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filtered.map((row) => (
            <CourseCard key={row.rep.id} row={row} onOpen={() => onOpen(row.rep.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ───── Course card ───────────────────────────────────────────────────────

interface CourseCardProps {
  row: CatalogueRow;
  onOpen: () => void;
}

function CourseCard({ row, onOpen }: CourseCardProps): ReactNode {
  const total = row.course?.lines.length ?? 0;
  const learned = row.completedLines.size;
  const pct = total === 0 ? 0 : Math.round((learned / total) * 100);
  const orientation: 'white' | 'black' = row.rep.repForWhite ? 'white' : 'black';
  const Icon = CATEGORY_ICONS[row.category];

  return (
    <article
      aria-labelledby={`course-${row.rep.id}-title`}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4 shadow-sm transition-all hover:scale-[1.01] hover:shadow-md sm:flex-row sm:items-stretch sm:gap-4"
    >
      <div className="flex-shrink-0">
        <MiniBoardPreview size={140} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <h3
            id={`course-${row.rep.id}-title`}
            className="font-display text-base font-semibold leading-tight"
          >
            {row.rep.name}
          </h3>
          {Icon ? <Icon size={12} /> : null}
          {row.eco && (
            <span className="font-mono text-[10px] text-muted-foreground">{row.eco}</span>
          )}
          <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {orientation}
          </span>
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">{row.description}</p>

        <div className="mt-auto">
          {total > 0 && (
            <>
              <div className="mb-1 flex items-baseline justify-between text-[11px]">
                <span className="font-medium uppercase tracking-wide text-muted-foreground">Progress</span>
                <span className="font-mono text-foreground">{learned} / {total} lines</span>
              </div>
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${pct}%` }}
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${learned} of ${total} lines learned`}
                />
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

// ───── Main page ──────────────────────────────────────────────────────────

export function Openings(): ReactNode {
  const [reps, setReps] = useState<Repertoire[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  /** repId → set of completed line ids. Aggregated for catalogue cards. */
  const [completedByRep, setCompletedByRep] = useState<Map<number, Set<string>>>(new Map());

  const [searchParams, setSearchParams] = useSearchParams();
  const courseSlug = searchParams.get('course');

  // Auto-import curated openings on mount. Idempotent — picks up new openings.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const o of OPENINGS) {
        if (cancelled) return;
        await importCuratedSpec(o);
      }
      if (cancelled) return;
      const all = await listRepertoires();
      setReps(all);
    })();
    return () => { cancelled = true; };
  }, []);

  // Aggregate per-rep completed lines for the catalogue progress bars.
  // O(N) IDB calls — for our N≤~12 curated courses this is fine. If we add
  // user-imported reps to the catalogue and N grows past ~50, switch to a
  // single getAll on lineProgress filtered client-side.
  const refreshAggregate = useCallback(async () => {
    if (reps.length === 0) return;
    const entries = await Promise.all(
      reps.map(async (r) => [r.id, await linesCompletedFor(r.id)] as const),
    );
    setCompletedByRep(new Map(entries));
  }, [reps]);

  useEffect(() => { void refreshAggregate(); }, [refreshAggregate]);

  // Refresh aggregate whenever the user comes back to the catalogue
  // (i.e. courseSlug just transitioned to null).
  useEffect(() => {
    if (courseSlug === null) void refreshAggregate();
  }, [courseSlug, refreshAggregate]);

  // Build catalogue rows — one per curated repertoire, deduped by sourceLabel.
  const catalogueRows = useMemo<CatalogueRow[]>(() => {
    const seen = new Set<string>();
    const out: CatalogueRow[] = [];
    for (const r of reps) {
      const key = r.sourceKind === 'curated' && r.sourceLabel ? `${r.sourceKind}:${r.sourceLabel}` : `id:${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const opening = r.sourceLabel ? OPENINGS.find((x) => x.id === r.sourceLabel) : undefined;
      const course = courseFor(r.sourceLabel ?? '');
      const category: CategoryFilter = (opening?.category ?? 'imported');
      const description = course?.tagline ?? opening?.description ?? r.description ?? '';
      const completedLines = completedByRep.get(r.id) ?? new Set<string>();
      out.push({
        rep: r,
        course,
        category,
        eco: opening?.eco,
        description,
        completedLines,
      });
    }
    return out;
  }, [reps, completedByRep]);

  // Resolve activeRepId from URL slug. Slug == repertoire sourceLabel for curated.
  const activeRep = useMemo(() => {
    if (courseSlug === null) return undefined;
    return reps.find((r) => r.sourceLabel === courseSlug)
      ?? reps.find((r) => String(r.id) === courseSlug);
  }, [reps, courseSlug]);

  const activeCourse: OpeningCourse | undefined = useMemo(
    () => (activeRep ? courseFor(activeRep.sourceLabel ?? '') : undefined),
    [activeRep],
  );

  const openCourse = useCallback((repId: number) => {
    const rep = reps.find((r) => r.id === repId);
    if (!rep) return;
    const slug = rep.sourceLabel ?? String(rep.id);
    setSearchParams({ course: slug });
  }, [reps, setSearchParams]);

  const goBack = useCallback(() => {
    setSearchParams({});
  }, [setSearchParams]);

  // Outer wrapper. Two modes:
  //   - Catalogue (course list): scrolls vertically (this is the only
  //     allowed scroll target — the user is browsing a long list).
  //   - CourseDetail (inside a course): locked to viewport height so the
  //     board + lesson bubble fit without page scroll. Internal scroll
  //     is allowed within the lesson sidebar only.
  const inCourse = courseSlug !== null && activeRep !== undefined;
  return (
    <div
      className={
        inCourse
          ? 'mx-auto flex h-full max-w-7xl flex-col overflow-hidden px-6 py-3'
          : 'mx-auto h-full max-w-7xl overflow-y-auto px-6 py-6'
      }
    >
      {courseSlug === null && (
        <Catalogue
          rows={catalogueRows}
          onOpen={openCourse}
          onImport={() => setImportOpen(true)}
        />
      )}

      {courseSlug !== null && activeRep && (
        <CourseDetail
          key={activeRep.id}
          repertoire={activeRep}
          course={activeCourse}
          onBack={goBack}
        />
      )}

      {courseSlug !== null && !activeRep && reps.length > 0 && (
        <div className="rounded-md border border-border bg-elevated p-6 text-sm">
          <p className="font-medium">Course not found.</p>
          <button
            type="button"
            onClick={goBack}
            className="mt-2 text-sm text-accent hover:underline"
          >
            ← Back to courses
          </button>
        </div>
      )}

      {courseSlug !== null && reps.length === 0 && (
        <div className="rounded-md border border-border bg-elevated p-6 text-sm text-muted-foreground">
          Loading courses…
        </div>
      )}

      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={async (newRepId) => {
            const all = await listRepertoires();
            setReps(all);
            setImportOpen(false);
            const rep = all.find((r) => r.id === newRepId);
            const slug = rep?.sourceLabel ?? String(newRepId);
            setSearchParams({ course: slug });
          }}
        />
      )}
    </div>
  );
}

// ───── Import dialog (kept as before) ────────────────────────────────────

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (newRepId: number) => Promise<void> }) {
  const [tab, setTab] = useState<'pgn' | 'lichess'>('pgn');
  const [pgnText, setPgnText] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState<'w' | 'b'>('w');
  const [studyId, setStudyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async () => {
    setBusy(true);
    setErr(null);
    try {
      let id: number;
      if (tab === 'pgn') {
        if (!pgnText.trim()) throw new Error('Paste a PGN');
        if (!name.trim()) throw new Error('Give the repertoire a name');
        id = await importPgn({ pgn: pgnText, name: name.trim(), userColor: color, sourceLabel: 'pasted' });
      } else {
        if (!studyId.trim()) throw new Error('Enter a Lichess study ID');
        id = await importLichessStudy({ studyId: studyId.trim(), name: name.trim() || `Lichess study ${studyId.trim()}`, userColor: color });
      }
      await onImported(id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="import-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-lg border border-border bg-background p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="import-title" className="font-display text-lg font-semibold">Import repertoire</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-muted">✕</button>
        </div>
        <div className="mb-3 inline-flex rounded border border-border bg-muted/40 p-0.5 text-xs">
          {(['pgn', 'lichess'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-2 py-1 ${tab === t ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
            >
              {t === 'pgn' ? 'Paste PGN' : 'Lichess study'}
            </button>
          ))}
        </div>

        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-xs text-muted-foreground">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="My Italian Game (white)"
            />
          </label>

          <fieldset>
            <legend className="text-xs text-muted-foreground">I play as</legend>
            <div className="mt-1 flex gap-2">
              <label className="flex items-center gap-1 text-sm">
                <input type="radio" name="color" checked={color === 'w'} onChange={() => setColor('w')} /> White
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input type="radio" name="color" checked={color === 'b'} onChange={() => setColor('b')} /> Black
              </label>
            </div>
          </fieldset>

          {tab === 'pgn' && (
            <label className="block">
              <span className="text-xs text-muted-foreground">PGN (paste mainline + variations)</span>
              <textarea
                value={pgnText}
                onChange={(e) => setPgnText(e.target.value)}
                rows={8}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs"
                placeholder='[Event "Italian"]\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 *'
              />
            </label>
          )}
          {tab === 'lichess' && (
            <label className="block">
              <span className="text-xs text-muted-foreground">Lichess study ID (the 8-character code in the URL)</span>
              <input
                value={studyId}
                onChange={(e) => setStudyId(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                placeholder="abcd1234"
              />
              <span className="mt-1 block text-[11px] text-muted-foreground">Public studies only. We'll fetch from <code>https://lichess.org/api/study/{'{id}'}.pgn</code>.</span>
            </label>
          )}

          {err && <div role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900">{err}</div>}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-border px-3 py-1.5 text-sm">Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSubmit()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
