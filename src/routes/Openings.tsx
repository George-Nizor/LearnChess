import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
import { LearnIcon, DrillIcon, ExploreIcon } from '@/components/ui/ChessIcons';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';

type Mode = 'learn' | 'drill' | 'explore';

const RED_FLASH_MS = 600;
const GREEN_CHECK_MS = 700;
const REENABLE_BOARD_MS = 250;
const REVEAL_PULSE_AFTER = 2;
const STARTING_FEN_FULL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/*
 * chess.com-style move-quality glyphs rendered on the destination square via
 * chessground's `customSvg` autoShape API. SVG viewBox is implicitly the
 * square (0..100 by chessground convention). We size the badge to ~30% of
 * the square and dock it bottom-right so it doesn't obscure the piece.
 */
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

// SVG_BRILLIANT — reserved for future "first-time correct on a deep-review
// move" detection. Not wired up yet; keep the asset for the eventual hook.
// (Drop the leading underscore from the constant when it goes live.)
const _SVG_BRILLIANT = `
  <g transform="translate(60,60) scale(0.32)">
    <circle cx="50" cy="50" r="48" fill="#0ea5e9" stroke="white" stroke-width="6"/>
    <text x="50" y="68" text-anchor="middle" font-family="serif" font-size="56" font-weight="700" fill="white">!!</text>
  </g>`;
void _SVG_BRILLIANT;

// ───── Friendly metric helpers ────────────────────────────────────────────

function masteredCount(moves: RepMove[]): number {
  // "Mastered" = own-move that has graduated learning AND has at least a
  // 7-day review interval (matches our scheduler.ts `masteryOf` 'short' bucket).
  return moves.filter(
    (m) => m.isOwnMove && !m.deleted && m.learningStep === null && (m.reviewIntervalDays ?? 0) >= 7,
  ).length;
}

// ───── Speech-bubble prose renderer ──────────────────────────────────────
//
// Handles two layers of formatting:
//   - Paragraphs: split on `\n\n`, render each as its own <p> with a top
//     margin so the bubble doesn't read as a wall of text.
//   - Sentences: even within a single paragraph, two-or-more sentences get a
//     subtle line-break (a soft `<br>`) after each terminal-punctuation +
//     space pair. Authors don't have to reformat every existing lesson —
//     visually-improved formatting is automatic.
//   - **bold** for inline move references, rendered via <strong>.

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
  // Insert a soft break after every sentence boundary (.!? followed by space
  // and a capital letter). Single break, not a paragraph — keeps the eye
  // moving without blowing out vertical space.
  const sentences = para.split(/(?<=[.!?])\s+(?=[A-Z"'(])/);
  return (
    <p key={`p-${paraIdx}`} className={paraIdx > 0 ? 'mt-3' : ''}>
      {sentences.map((s, si) => (
        <span key={`p-${paraIdx}-s-${si}`}>
          {renderInline(s, `p-${paraIdx}-s-${si}`)}
          {si < sentences.length - 1 && ' '}
        </span>
      ))}
    </p>
  );
}

function renderProse(text: string): ReactNode {
  const paragraphs = text.split(/\n\n+/);
  return <>{paragraphs.map((para, pi) => renderParagraph(para, pi))}</>;
}

// ───── Learn-mode viewer ──────────────────────────────────────────────────

interface LearnViewProps {
  course: OpeningCourse;
  line: OpeningLine;
  repertoireId: number;
  initialNodeIdx: number;
  onProgress: (nodeIdx: number) => void;
}

function LearnView({ course, line, repertoireId: _repertoireId, initialNodeIdx, onProgress }: LearnViewProps): ReactNode {
  // The parent re-keys this whole subtree on activeLineId change, so the
  // initial state is the truthful per-line starting point — no per-line
  // reset effect needed here. We DON'T sync nodeIdx to changes in
  // initialNodeIdx after mount, because that would regress the user's
  // view when their own clicks bump progress through the parent.
  const [nodeIdx, setNodeIdx] = useState<number>(Math.min(initialNodeIdx, line.nodes.length - 1));

  const node = line.nodes[nodeIdx]!;

  // Build full FEN with halfmove + fullmove counters by replaying from the start
  // through chess.js — chessground needs the full FEN.
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

  // Determine the user's "side" from the opening to set board orientation
  const playerSide = course.openingId.endsWith('-black') ? 'black' : 'white';

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

  // Keyboard shortcuts: ←/→ for prev/next
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
            {nodeIdx + 1} / {line.nodes.length}
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
              key={`${line.id}-${nodeIdx}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="relative rounded-2xl rounded-tl-sm border border-border bg-elevated p-5 text-base leading-relaxed shadow-sm"
            >
              {/* Tail pointing back at the avatar */}
              <span
                aria-hidden
                className="absolute -left-2 top-3 h-3 w-3 rotate-45 border-b border-l border-border bg-elevated"
              />
              <div className="prose-tight text-foreground">{renderProse(node.text)}</div>
              {finished && (
                <p className="mt-4 text-sm font-medium text-accent">
                  ✓ End of line — switch to Drill to test what you've learned.
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </aside>
    </div>
  );
}

// ───── Drill view (chessdriller wrong-move UX, scoped to the active line) ──

interface DrillViewProps {
  repertoire: Repertoire;
  /** Active line — used to filter the drill walk to this line's positions only. */
  line: OpeningLine | undefined;
  onMastery: () => void;          // called after any move so parent can refresh stats
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
    // When a line is selected, build the drill edges directly from the
    // line's nodes by looking up each (fromFen, toFen) edge in the rep DB.
    // This pins the drill to the EXACT variation the user picked rather
    // than the heaviest book line.
    //
    // Some authored lines teach positions the curated rep tree doesn't
    // include yet (e.g. Italian Quiet plays 4.d3 directly while book.ts
    // only has d3 after c3-Nf6). When that happens we fall back to the
    // chessdriller-style walker so the user can still drill *something*
    // — losing per-line specificity but never showing a dead screen.
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
      // Fall through to the auto-walker if no edges are in the rep DB.
    }

    // No line scope (e.g. user-imported PGN repertoire) or the selected
    // line isn't in the curated tree — fall back to the chessdriller-style
    // auto-walker over the whole repertoire.
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
    async (from: Square, to: Square) => {
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
        setRedFlashSquare(to);
        setBoardLocked(true);
        playSound('check');
        const updated: RepMove = { ...result.correctMove, ...onWrong(result.correctMove) };
        await putMove(updated);
        const lastSan = probe.history({ verbose: true }).slice(-1)[0]?.san;
        await recordAttempt({
          repertoireId: repertoire.id,
          fromFen: result.correctMove.fromFen,
          toFen: result.correctMove.toFen,
          studiedAt: Date.now(),
          wasCorrect: false,
          ...(lastSan !== undefined ? { incorrectGuessSan: lastSan } : {}),
        });
        setSessionView(session.view());
        setTimeout(() => setRedFlashSquare(null), RED_FLASH_MS);
        setTimeout(() => setBoardLocked(false), REENABLE_BOARD_MS);
        onMastery();
        return;
      }

      // correct — flash a green check on the destination
      playSound('move');
      setGreenCheckSquare(to);
      setTimeout(() => setGreenCheckSquare(null), GREEN_CHECK_MS);
      const updated: RepMove = { ...v.expected, ...onCorrect(v.expected) };
      await putMove(updated);
      await recordAttempt({
        repertoireId: repertoire.id,
        fromFen: v.expected.fromFen,
        toFen: v.expected.toFen,
        studiedAt: Date.now(),
        wasCorrect: true,
      });
      setSessionView(result.advancedTo);
      setShowRevealArrow(false);
      onMastery();
      if (result.advancedTo.finished) {
        setBoardLocked(true);
        setTimeout(() => { void loadNextLine(); }, 600);
      }
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
    // chess.com-style move-quality badges: red ✗ for wrong, green ✓ for correct.
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
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[auto_320px]">
      <div className="flex justify-center">
        <Chessground config={cgConfig} />
      </div>
      <aside className="flex flex-col gap-3 text-sm">
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
  // If a line is selected, open the analysis from its current ending position
  // so the user can branch out from where the lesson left off.
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
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[auto_360px]">
      <div className="flex justify-center">
        <Chessground config={cgConfig} />
      </div>
      <aside className="flex flex-col gap-3 text-sm">
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
  // Status badge: ◯ unseen, ◐ in-progress, ● completed.
  // discoveredNodeIdx === 0 means only the intro was opened — count that as
  // unseen for the badge so users know they haven't actually started.
  const status: 'unseen' | 'in-progress' | 'completed' =
    progress === undefined || progress.discoveredNodeIdx <= 0
      ? 'unseen'
      : progress.completed
        ? 'completed'
        : 'in-progress';
  const badge = status === 'completed' ? '●' : status === 'in-progress' ? '◐' : '◯';
  const badgeTitle =
    status === 'completed' ? 'Completed' : status === 'in-progress' ? 'In progress' : 'Not started';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`group flex min-w-[200px] max-w-[260px] shrink-0 flex-col gap-1 rounded-md border p-3 text-left transition-colors ${
        active
          ? 'border-accent bg-accent/10 shadow-sm'
          : 'border-border bg-elevated hover:bg-muted'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-sm font-semibold leading-tight ${active ? 'text-foreground' : ''}`}>{line.name}</span>
        <span
          aria-label={badgeTitle}
          title={badgeTitle}
          className={`text-xs ${
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
      <p className="text-[11px] leading-snug text-muted-foreground">{line.description}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {line.nodes.length - 1} ply
      </p>
    </button>
  );
}

// ───── Main page ──────────────────────────────────────────────────────────

export function Openings(): ReactNode {
  const [reps, setReps] = useState<Repertoire[]>([]);
  const [activeRepId, setActiveRepId] = useState<number | null>(null);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('learn');
  const [importOpen, setImportOpen] = useState(false);
  const [lineProgressRows, setLineProgressRows] = useState<LineProgress[]>([]);

  const [stats, setStats] = useState<{ mastered: number; ownTotal: number; linesCompleted: number; linesTotal: number }>({
    mastered: 0,
    ownTotal: 0,
    linesCompleted: 0,
    linesTotal: 0,
  });

  // Auto-import curated openings on every visit. importCuratedSpec is idempotent
  // (checks for existing by sourceLabel), so this also picks up any new opening
  // added to book.ts since the user's last visit. Sequential awaits to avoid
  // React-strict-mode double-invoke racing the existence check.
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
      if (all.length > 0 && activeRepId === null) {
        setActiveRepId(all[0]!.id);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeRep = useMemo(() => reps.find((r) => r.id === activeRepId), [reps, activeRepId]);
  // Memoise the course so dependency identities (`course`) stay stable across
  // renders that don't change the active repertoire.
  const course: OpeningCourse | undefined = useMemo(
    () => (activeRep ? courseFor(activeRep.sourceLabel ?? '') : undefined),
    [activeRep],
  );

  // Reset the active line whenever the repertoire changes — default to first line.
  useEffect(() => {
    if (!course) {
      setActiveLineId(null);
      return;
    }
    // If the current activeLineId doesn't belong to this course, pick the first.
    const exists = activeLineId !== null && course.lines.some((l) => l.id === activeLineId);
    if (!exists) {
      setActiveLineId(course.lines[0]?.id ?? null);
    }
  }, [course, activeLineId]);

  const activeLine: OpeningLine | undefined = useMemo(() => {
    if (!course || activeLineId === null) return undefined;
    return course.lines.find((l) => l.id === activeLineId) ?? course.lines[0];
  }, [course, activeLineId]);

  // Refresh friendly metrics for the active repertoire.
  const refreshStats = useCallback(async () => {
    if (activeRepId === null || !course) {
      setLineProgressRows([]);
      return;
    }
    const moves = await allMoves(activeRepId);
    const own = moves.filter((m) => m.isOwnMove);
    const completed = await linesCompletedFor(activeRepId);
    const rows = await listLineProgress(activeRepId);
    setLineProgressRows(rows);
    setStats({
      mastered: masteredCount(moves),
      ownTotal: own.length,
      linesCompleted: completed.size,
      linesTotal: course.lines.length,
    });
  }, [activeRepId, course]);

  useEffect(() => { void refreshStats(); }, [refreshStats]);

  // If the active opening has no course, default mode to drill.
  useEffect(() => {
    if (mode === 'learn' && !course && activeRep) setMode('drill');
  }, [course, mode, activeRep]);

  // Per-line learn progress lookup for the active line.
  const activeLineProgress = useMemo<LineProgress | undefined>(() => {
    if (!activeLine) return undefined;
    return lineProgressRows.find((r) => r.lineId === activeLine.id);
  }, [activeLine, lineProgressRows]);

  const handleLearnProgress = useCallback(
    async (nodeIdx: number) => {
      if (activeRepId === null || !activeLine) return;
      await markLineNodeVisited(activeRepId, activeLine.id, nodeIdx, activeLine.nodes.length);
      await refreshStats();
    },
    [activeRepId, activeLine, refreshStats],
  );

  // [/] keyboard shortcuts to cycle through lines while in Learn mode.
  useEffect(() => {
    if (!course || course.lines.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key !== '[' && e.key !== ']') return;
      e.preventDefault();
      const idx = course.lines.findIndex((l) => l.id === activeLineId);
      const next = e.key === ']' ? idx + 1 : idx - 1;
      const wrapped = ((next % course.lines.length) + course.lines.length) % course.lines.length;
      setActiveLineId(course.lines[wrapped]!.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [course, activeLineId]);

  const groupedByCategory = useMemo(() => {
    // Belt-and-braces dedup by sourceLabel — if React-strict-mode double-invoke
    // ever bypassed importCuratedSpec's existence check, a curated opening can
    // appear twice in IDB. Show only the first per sourceLabel here so the
    // sidebar isn't visually broken; the duplicate row stays in IDB harmlessly.
    const seenSource = new Set<string>();
    const deduped = reps.filter((r) => {
      const key = r.sourceKind === 'curated' && r.sourceLabel ? `${r.sourceKind}:${r.sourceLabel}` : `id:${r.id}`;
      if (seenSource.has(key)) return false;
      seenSource.add(key);
      return true;
    });

    const map = new Map<string, Repertoire[]>();
    for (const r of deduped) {
      const o = r.sourceLabel ? OPENINGS.find((x) => x.id === r.sourceLabel) : undefined;
      const cat = o?.category ?? 'imported';
      const arr = map.get(cat) ?? [];
      arr.push(r);
      map.set(cat, arr);
    }
    return map;
  }, [reps]);

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Single shared grid: course sidebar (left) + content column (right).
          Putting EVERYTHING in one grid means the header, tabs, and board all
          align to the same left edge — fixes the misalignment the user flagged. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
        {/* Course sidebar — sticky on desktop so it stays visible while
            scrolling through long Drill move lists. */}
        <aside className="md:sticky md:top-4 md:self-start max-h-[calc(100vh-6rem)] overflow-y-auto rounded-md border border-border bg-elevated/40 p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold">Courses</h3>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
            >
              + Import
            </button>
          </div>
          {Array.from(groupedByCategory.entries()).map(([cat, items]) => (
            <section key={cat} className="mb-4">
              <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{cat}</h4>
              <ul className="space-y-1">
                {items.map((r) => {
                  const o = r.sourceLabel ? OPENINGS.find((x) => x.id === r.sourceLabel) : undefined;
                  const repCourse = courseFor(r.sourceLabel ?? '');
                  const lessonCount = repCourse?.lines.length ?? 0;
                  const isActive = r.id === activeRepId;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => { setActiveRepId(r.id); setMode(repCourse ? 'learn' : 'drill'); }}
                        className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                          isActive
                            ? 'bg-accent text-accent-foreground shadow-sm'
                            : 'hover:bg-muted'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium leading-tight">{r.name}</span>
                          {lessonCount > 0 && (
                            <span
                              aria-label={`${lessonCount} ${lessonCount === 1 ? 'lesson' : 'lessons'}`}
                              title={`${lessonCount} ${lessonCount === 1 ? 'lesson' : 'lessons'}`}
                              className={`flex-shrink-0 text-[10px] font-mono ${isActive ? 'text-accent-foreground/80' : 'text-accent'}`}
                            >
                              {lessonCount}●
                            </span>
                          )}
                        </div>
                        <div className={`mt-0.5 flex items-center gap-2 text-[11px] ${isActive ? 'text-accent-foreground/80' : 'text-muted-foreground'}`}>
                          <span>for {r.repForWhite ? 'White' : 'Black'}</span>
                          {o?.eco && <span className="font-mono">· {o.eco}</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="mt-2 px-1 text-[10px] text-muted-foreground">
            <span className="text-accent">N●</span> = has lessons (line count)
          </p>
        </aside>

        {/* Right column — header, tabs, mode body all flow vertically and align
            to the same left edge as each other. */}
        <div className="flex min-w-0 flex-col gap-4">
          {activeRep && (
            <div className="rounded-md border border-border bg-elevated p-5">
              <div className="flex items-baseline gap-3">
                <h2 className="font-display text-2xl font-semibold leading-tight">{activeRep.name}</h2>
                <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {activeRep.repForWhite ? 'White' : 'Black'}
                </span>
              </div>
              {(course?.tagline ?? activeRep.description) && (
                <p className="mt-1.5 text-sm text-muted-foreground">{course?.tagline ?? activeRep.description}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-6">
                <ProgressChip
                  label="Lines learned"
                  value={stats.linesCompleted}
                  total={stats.linesTotal}
                  hint="Lines you've walked through Learn mode end-to-end"
                />
                <ProgressChip
                  label="Moves mastered"
                  value={stats.mastered}
                  total={stats.ownTotal}
                  hint="Your own-moves with at least a 7-day review interval"
                />
              </div>
            </div>
          )}

          {/* Per-line picker — only render when the course has a line set. */}
          {activeRep && course && course.lines.length > 0 && (
            <section aria-label="Lines in this opening" className="rounded-md border border-border bg-elevated/40 p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="font-display text-sm font-semibold">Lines</h3>
                <p className="text-[11px] text-muted-foreground">
                  {course.lines.length === 1
                    ? '1 line'
                    : <>{course.lines.length} lines · use <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">[</kbd> / <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">]</kbd> to switch</>}
                </p>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {course.lines.map((l) => {
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

          {activeRep && (
            <div className="flex items-center gap-1 self-start rounded-md border border-border bg-elevated/40 p-1 text-sm">
              {(['learn', 'drill', 'explore'] as Mode[]).map((m) => {
                const isActive = mode === m;
                const disabled = m === 'learn' && !course;
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
                      <Icon size={15} />
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Mode body — INSIDE the right column so it aligns with header + tabs */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`${activeRepId}-${activeLineId ?? 'none'}-${mode}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {!activeRep && (
                <div className="rounded-md border border-border bg-elevated p-6 text-sm text-muted-foreground">
                  Loading courses…
                </div>
              )}
              {activeRep && mode === 'learn' && course && activeLine && (
                <LearnView
                  course={course}
                  line={activeLine}
                  repertoireId={activeRep.id}
                  initialNodeIdx={Math.min(activeLineProgress?.discoveredNodeIdx ?? 0, activeLine.nodes.length - 1)}
                  onProgress={(idx) => void handleLearnProgress(idx)}
                />
              )}
              {activeRep && mode === 'drill' && (
                <DrillView repertoire={activeRep} line={activeLine} onMastery={() => void refreshStats()} />
              )}
              {activeRep && mode === 'explore' && (
                <ExploreView repertoire={activeRep} line={activeLine} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={async (newRepId) => {
            const all = await listRepertoires();
            setReps(all);
            setActiveRepId(newRepId);
            setMode('drill');
            setImportOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ───── Friendly progress chip ────────────────────────────────────────────

function ProgressChip({ label, value, total, hint }: { label: string; value: number; total: number; hint?: string }) {
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
