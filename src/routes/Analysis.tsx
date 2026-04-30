import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chess, validateFen } from 'chess.js';
import { Chessground } from '@/chess/board';
import { StockfishEngine } from '@/chess/engine';
import type { UciInfo } from '@/chess/engine';
import { isPromotion, lastMoveSquares, legalDests, STARTING_FEN, tryMove, turnColor } from '@/chess/rules';
import type { Square } from '@/chess/rules';
import type { Config } from 'chessground/config';

/*
 * Analysis route — Lichess-style infinite-analysis board.
 *
 * Visual hierarchy mirrors lila's `ui/lib/src/ceval/view/main.ts`:
 *   - eval bar lives flush to the board's left edge
 *   - top toolbar above the board: ⟪ ◀ ▶ ⟫ ⟳ + copy FEN/PGN
 *   - right rail stack: move tree (2-col) → engine status bar → PV lines
 *   - FEN/PGN load inputs hide in a collapsed <details> at the bottom
 *
 * The engine plumbing is unchanged: StockfishEngine.search streams MultiPV-
 * indexed UciInfo, we accumulate by `multipv` index in a ref, and re-render.
 *
 * Race-condition handling: rapid scrubbing through history (arrow keys) would
 * spawn a `engine.search()` per keypress; the wrapper already cancels in-flight
 * searches on a new call, but to avoid postMessage chatter we debounce the
 * effect input by 100 ms before triggering a search.
 */

const CLAMP_CP = 1000;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Map (cp, mate) -> [0..1] always from white's perspective.
 *
 * UCI scores are reported from the side-to-move's POV, so the caller must
 * negate before passing if it's black's turn at the analysed position.
 */
function scoreToBarRatio(scoreCp: number | null, scoreMate: number | null): number {
  if (scoreMate !== null) return scoreMate > 0 ? 1 : 0;
  if (scoreCp === null) return 0.5;
  const cp = clamp(scoreCp, -CLAMP_CP, CLAMP_CP);
  return 0.5 + cp / (2 * CLAMP_CP);
}

function formatScore(scoreCp: number | null, scoreMate: number | null): string {
  if (scoreMate !== null) return `${scoreMate >= 0 ? '+' : '-'}M${Math.abs(scoreMate)}`;
  if (scoreCp === null) return '·';
  const pawns = scoreCp / 100;
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(2);
}

/** True if (cp, mate) read from white's POV is non-negative. */
function isWhiteAdvantage(scoreCp: number | null, scoreMate: number | null): boolean {
  if (scoreMate !== null) return scoreMate >= 0;
  if (scoreCp === null) return true; // neutral defaults to "white" chip
  return scoreCp >= 0;
}

interface HistoryEntry {
  san: string;
  fenAfter: string;
  ply: number; // 1-based ply index
}

interface EngineLine {
  multipv: number;
  scoreCp?: number;
  scoreMate?: number;
  depth: number;
  pv: string[]; // UCI moves
}

type MultiPvCount = 1 | 2 | 3 | 4;

const DEFAULT_MULTIPV: MultiPvCount = 3;
const SEARCH_DEPTH = 22;
const SEARCH_DEBOUNCE_MS = 100;
const PV_PREVIEW_PLIES = 12;

/**
 * History state machine. We use useReducer (not plain useState) because the
 * `playMove` transition has to truncate any future plies past the cursor —
 * doing that with cascaded setStates was racy when the user clicked a node
 * mid-arrow-scrub.
 */
interface HistoryState {
  history: HistoryEntry[];
  currentPly: number; // 0 = starting position, 1..N = after that ply
  rootFen: string; // the FEN we started analysing from
}

type HistoryAction =
  | { type: 'reset'; rootFen: string }
  | { type: 'playMove'; san: string; fenAfter: string }
  | { type: 'goto'; ply: number }
  | { type: 'first' }
  | { type: 'prev' }
  | { type: 'next' }
  | { type: 'last' }
  | { type: 'loadHistory'; rootFen: string; entries: HistoryEntry[] };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'reset':
      return { history: [], currentPly: 0, rootFen: action.rootFen };
    case 'playMove': {
      // Truncate any moves past the cursor (overwrite the line)
      const trimmed = state.history.slice(0, state.currentPly);
      const nextPly = trimmed.length + 1;
      return {
        ...state,
        history: [...trimmed, { san: action.san, fenAfter: action.fenAfter, ply: nextPly }],
        currentPly: nextPly,
      };
    }
    case 'goto':
      return { ...state, currentPly: clamp(action.ply, 0, state.history.length) };
    case 'first':
      return { ...state, currentPly: 0 };
    case 'prev':
      return { ...state, currentPly: Math.max(0, state.currentPly - 1) };
    case 'next':
      return { ...state, currentPly: Math.min(state.history.length, state.currentPly + 1) };
    case 'last':
      return { ...state, currentPly: state.history.length };
    case 'loadHistory':
      return {
        rootFen: action.rootFen,
        history: action.entries,
        currentPly: action.entries.length,
      };
  }
}

function fenAtPly(state: HistoryState): string {
  if (state.currentPly === 0) return state.rootFen;
  const entry = state.history[state.currentPly - 1];
  return entry?.fenAfter ?? state.rootFen;
}

/** A single SAN chip in a PV line — carries the SAN text plus the FEN reached
 * after playing it (so click-to-jump knows where to drop the cursor). */
interface PvChip {
  san: string;
  fenAfter: string;
  /** UCI of *just this move* — used to play it on the board. */
  uci: string;
  /** Index into the original PV (1-based: 1 = play move only). */
  index: number;
}

/**
 * Convert the head of a UCI PV into a list of clickable SAN chips by replaying
 * through chess.js. We stop on the first illegal move (e.g. PV truncated mid-
 * stream) rather than throwing — Stockfish occasionally emits short PVs at
 * low depth.
 */
function uciPvToChips(fen: string, ucis: string[], maxPlies: number): PvChip[] {
  const game = new Chess(fen);
  const chips: PvChip[] = [];
  for (let i = 0; i < Math.min(ucis.length, maxPlies); i++) {
    const uci = ucis[i];
    if (!uci || uci.length < 4) break;
    try {
      const promotion = uci.length >= 5 ? (uci[4] ?? 'q') : 'q';
      const m = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion });
      chips.push({ san: m.san, fenAfter: game.fen(), uci, index: i + 1 });
    } catch {
      break;
    }
  }
  return chips;
}

/**
 * Build the move-tree pairs (white/black) from a flat history. Used by the
 * sidebar list.
 */
interface MovePair {
  number: number;
  white?: HistoryEntry;
  black?: HistoryEntry;
}

function buildPairs(rootFen: string, history: HistoryEntry[]): MovePair[] {
  const parts = rootFen.split(' ');
  const fullmove = Number(parts[5] ?? '1');
  const startsBlack = parts[1] === 'b';

  const pairs: MovePair[] = [];
  let moveNo = fullmove;
  let i = 0;
  if (startsBlack && history[0]) {
    pairs.push({ number: moveNo, black: history[0] });
    i = 1;
    moveNo += 1;
  }
  while (i < history.length) {
    const w = history[i];
    const b = history[i + 1];
    const pair: MovePair = { number: moveNo };
    if (w) pair.white = w;
    if (b) pair.black = b;
    pairs.push(pair);
    moveNo += 1;
    i += 2;
  }
  return pairs;
}

/** Convert raw `nps` (nodes/sec) into a compact "1.2 Mn/s" / "850 kn/s" string. */
function formatNps(nps: number | undefined): string {
  if (!nps || nps <= 0) return '·';
  if (nps >= 1_000_000) return `${(nps / 1_000_000).toFixed(1)} Mn/s`;
  if (nps >= 1_000) return `${Math.round(nps / 1_000)} kn/s`;
  return `${nps} n/s`;
}

/**
 * Eval chip — fixed-width 56px, monospace. White background + dark text if
 * eval favours white (the side whose perspective the chip carries), dark
 * background + light text if it favours black. Mirrors the lichess "strong"
 * cp readout that sits at the head of every PV line in `_pv.scss`.
 *
 * The `light`/`dark` palette is hand-tuned per theme in dark mode — sage chip
 * vs. coal chip read clearly against either background. We use Tailwind
 * arbitrary values instead of theme tokens so the white/black semantic doesn't
 * accidentally flip when the user toggles dark mode (the chip is *positional*
 * — like the eval bar — so it must stay readable in either theme).
 */
function EvalChip({
  scoreCp,
  scoreMate,
  size = 'md',
}: {
  /** Score from WHITE's POV (caller must negate if it was black-to-move). */
  scoreCp: number | null;
  scoreMate: number | null;
  size?: 'sm' | 'md';
}): ReactElement {
  const positive = isWhiteAdvantage(scoreCp, scoreMate);
  const label = formatScore(scoreCp, scoreMate);
  const widthClass = size === 'sm' ? 'min-w-12' : 'min-w-14';
  const padClass = size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs';
  // Positive (white-favouring): paper-cream chip, charcoal text.
  // Negative (black-favouring): coal chip, off-white text.
  // Both variants stay legible in light + dark theme — they encode the
  // semantic colour (white = advantage to white), NOT the theme surface.
  const palette = positive
    ? 'bg-[oklch(96%_0.005_95)] text-[oklch(18%_0.01_95)] ring-1 ring-[oklch(82%_0.01_95)]'
    : 'bg-[oklch(20%_0_0)] text-[oklch(96%_0.005_95)] ring-1 ring-[oklch(35%_0.01_75)]';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded font-mono tabular-nums ${widthClass} ${padClass} ${palette}`}
      aria-label={`Evaluation ${label}`}
    >
      {label}
    </span>
  );
}

/**
 * Toolbar icon button — used for the navigation strip above the board. Square,
 * border, monospace glyph, accent ring on focus-visible. The tooltip text is
 * also the aria-label so keyboard + screen-reader users get the same hint.
 */
function ToolbarButton({
  onClick,
  label,
  glyph,
  hint,
  active = false,
  disabled = false,
}: {
  onClick: () => void;
  label: string;
  glyph: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
}): ReactElement {
  const base =
    'inline-flex h-8 w-9 items-center justify-center rounded-md border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  const palette = active
    ? 'border-accent/60 bg-accent/15 text-foreground'
    : 'border-border bg-background text-foreground hover:bg-muted disabled:opacity-50 disabled:hover:bg-background';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={hint ?? label}
      disabled={disabled}
      className={`${base} ${palette}`}
    >
      <span aria-hidden="true" className="font-mono leading-none">{glyph}</span>
    </button>
  );
}

export function Analysis() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [hState, dispatch] = useReducer(historyReducer, null, (): HistoryState => {
    const queryFen = searchParams.get('fen');
    if (queryFen) {
      try {
        if (validateFen(queryFen).ok) {
          return { history: [], currentPly: 0, rootFen: queryFen };
        }
      } catch {
        // fall through
      }
    }
    return { history: [], currentPly: 0, rootFen: STARTING_FEN };
  });

  const currentFen = fenAtPly(hState);

  const [multiPv, setMultiPv] = useState<MultiPvCount>(DEFAULT_MULTIPV);
  const [engineEnabled, setEngineEnabled] = useState(true);
  const [flipped, setFlipped] = useState(false);
  const [engineLines, setEngineLines] = useState<EngineLine[]>([]);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [latestNps, setLatestNps] = useState<number | undefined>(undefined);
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);
  const [pgnInput, setPgnInput] = useState('');
  const [pgnError, setPgnError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const engineRef = useRef<StockfishEngine | null>(null);
  // Keep the latest engineLines accumulator on a ref so the streaming
  // callback can grow the list without depending on stale closure state.
  const linesAccRef = useRef<Map<number, EngineLine>>(new Map());

  // Engine init (mount once)
  useEffect(() => {
    const engine = new StockfishEngine({ onError: (err) => setEngineError(err.message) });
    engineRef.current = engine;
    engine
      .init()
      .then(() => {
        setEngineReady(true);
        engine.setMultiPV(DEFAULT_MULTIPV);
      })
      .catch((err: Error) => setEngineError(err.message));
    return () => {
      engine.destroy();
      engineRef.current = null;
      setEngineReady(false);
    };
  }, []);

  // Push MultiPV changes to the engine
  useEffect(() => {
    if (engineReady && engineRef.current) {
      engineRef.current.setMultiPV(multiPv);
    }
  }, [engineReady, multiPv]);

  /*
   * Engine search — re-run on currentFen / multiPv / engineEnabled change.
   * Debounced 100 ms to absorb rapid arrow-key scrubbing. The cleanup runs
   * the engine.cancel() so an obsolete search is told to stop and flush its
   * bestmove (the wrapper handles serialisation of the next call).
   */
  useEffect(() => {
    if (!engineReady || !engineRef.current) return;
    if (!engineEnabled) return;

    let cancelled = false;
    const debounce = setTimeout(() => {
      if (cancelled || !engineRef.current) return;

      // Reset accumulator for this new position so stale PVs from the
      // previous search don't bleed through.
      linesAccRef.current = new Map();
      setEngineLines([]);
      setLatestNps(undefined);

      const onInfo = (info: UciInfo) => {
        if (cancelled) return;
        if (info.nps !== undefined) setLatestNps(info.nps);
        const idx = info.multipv ?? 1;
        const prev = linesAccRef.current.get(idx);
        const line: EngineLine = {
          multipv: idx,
          depth: info.depth ?? prev?.depth ?? 0,
          pv: info.pv ?? prev?.pv ?? [],
          ...(info.scoreCp !== undefined ? { scoreCp: info.scoreCp } : {}),
          ...(info.scoreMate !== undefined ? { scoreMate: info.scoreMate } : {}),
        };
        linesAccRef.current.set(idx, line);
        const sorted = Array.from(linesAccRef.current.values()).sort((a, b) => a.multipv - b.multipv);
        setEngineLines(sorted);
      };

      void engineRef.current
        .search(currentFen, { depth: SEARCH_DEPTH }, onInfo)
        .catch((err: Error) => {
          if (cancelled) return;
          // The cancel() flow rejects in-flight searches when a new one
          // starts. Don't surface that as an error — it's expected.
          if (err.message.includes('cancel')) return;
          setEngineError(err.message);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      void engineRef.current?.cancel();
    };
  }, [engineReady, engineEnabled, currentFen, multiPv]);

  // Parsed game state for chessground
  const game = useMemo(() => new Chess(currentFen), [currentFen]);
  const sideToMove = turnColor(game);
  const dests = useMemo(() => legalDests(game), [game]);
  const lastMove = useMemo(() => lastMoveSquares(game), [game]);

  const handleMove = useCallback(
    (from: Square, to: Square) => {
      const probe = new Chess(currentFen);
      const promo: 'q' | 'r' | 'b' | 'n' = isPromotion(probe, from, to) ? 'q' : 'q';
      const result = tryMove(probe, from, to, promo);
      if (!result) return;
      dispatch({ type: 'playMove', san: result.san, fenAfter: result.fenAfter });
    },
    [currentFen],
  );

  const orientation: 'white' | 'black' = useMemo(() => {
    const startSide: 'white' | 'black' = hState.rootFen.split(' ')[1] === 'b' ? 'black' : 'white';
    return flipped ? (startSide === 'white' ? 'black' : 'white') : startSide;
  }, [flipped, hState.rootFen]);

  const cgConfig = useMemo<Config>(() => {
    return {
      fen: currentFen,
      orientation,
      turnColor: sideToMove,
      check: game.isCheck(),
      ...(lastMove !== undefined ? { lastMove } : {}),
      movable: {
        free: false,
        color: sideToMove,
        dests,
        events: {
          after: (orig, dest) => handleMove(orig as Square, dest as Square),
        },
      },
      drawable: { enabled: true, visible: true, defaultSnapToValidMove: true },
      animation: { enabled: true, duration: 150 },
      highlight: { lastMove: true, check: true },
    } satisfies Config;
  }, [currentFen, orientation, sideToMove, game, lastMove, dests, handleMove]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack arrows when the user is typing in a field
      const tgt = e.target;
      if (tgt instanceof HTMLElement) {
        const tag = tgt.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt.isContentEditable) return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        dispatch({ type: 'prev' });
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        dispatch({ type: 'next' });
      } else if (e.key === 'Home') {
        e.preventDefault();
        dispatch({ type: 'first' });
      } else if (e.key === 'End') {
        e.preventDefault();
        dispatch({ type: 'last' });
      } else if (e.key === 'f' || e.key === 'F') {
        setFlipped((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // FEN input handling
  const applyFen = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        setFenError('FEN is empty');
        return;
      }
      const ok = validateFen(trimmed).ok;
      if (!ok) {
        setFenError('Invalid FEN');
        return;
      }
      setFenError(null);
      dispatch({ type: 'reset', rootFen: trimmed });
      // Reflect in URL so the position is shareable
      const params = new URLSearchParams(searchParams);
      params.set('fen', trimmed);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // PGN input handling
  const applyPgn = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setPgnError('PGN is empty');
      return;
    }
    const game = new Chess();
    try {
      game.loadPgn(trimmed);
    } catch (err) {
      setPgnError(`Invalid PGN: ${(err as Error).message}`);
      return;
    }
    const verbose = game.history({ verbose: true });
    if (verbose.length === 0) {
      setPgnError('PGN parsed but contained no moves');
      return;
    }
    // Replay to capture FEN-after for each ply.
    const headerFen = game.getHeaders()['FEN'];
    const startFen = headerFen ?? STARTING_FEN;
    const replay = new Chess(startFen);
    const entries: HistoryEntry[] = [];
    for (let i = 0; i < verbose.length; i++) {
      const v = verbose[i];
      if (!v) break;
      try {
        const m = replay.move({ from: v.from, to: v.to, ...(v.promotion ? { promotion: v.promotion } : {}) });
        entries.push({ san: m.san, fenAfter: replay.fen(), ply: i + 1 });
      } catch {
        break;
      }
    }
    setPgnError(null);
    dispatch({ type: 'loadHistory', rootFen: startFen, entries });
  }, []);

  const flashCopied = useCallback((label: string) => {
    setCopyMessage(`${label} copied`);
    window.setTimeout(() => setCopyMessage(null), 1500);
  }, []);

  const copyFen = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentFen);
      flashCopied('FEN');
    } catch {
      setCopyMessage('Copy failed');
    }
  }, [currentFen, flashCopied]);

  const copyPgn = useCallback(async () => {
    const game = new Chess(hState.rootFen);
    if (hState.rootFen !== STARTING_FEN) {
      game.setHeader('FEN', hState.rootFen);
      game.setHeader('SetUp', '1');
    }
    for (const entry of hState.history) {
      try {
        game.move(entry.san);
      } catch {
        break;
      }
    }
    const pgn = game.pgn();
    try {
      await navigator.clipboard.writeText(pgn);
      flashCopied('PGN');
    } catch {
      setCopyMessage('Copy failed');
    }
  }, [hState.rootFen, hState.history, flashCopied]);

  // Eval bar — score is always from side-to-move POV; flip for white-perspective.
  const top = engineLines[0];
  const sideMul = sideToMove === 'white' ? 1 : -1;
  const whiteCp = top?.scoreCp !== undefined ? top.scoreCp * sideMul : null;
  const whiteMate = top?.scoreMate !== undefined ? top.scoreMate * sideMul : null;
  const evalRatio = scoreToBarRatio(whiteCp, whiteMate);
  const evalLabel = formatScore(whiteCp, whiteMate);

  const movePairs = useMemo(() => buildPairs(hState.rootFen, hState.history), [hState.rootFen, hState.history]);

  /**
   * Play a single move from a PV onto the board. `chip.uci` is the UCI of the
   * move at `chip.index` in the PV — but to play it we need its FEN-before,
   * which is `pv[index-1].fenAfter` (or `currentFen` when index === 1).
   */
  const playPvChip = useCallback(
    (chip: PvChip, line: EngineLine) => {
      // Replay the PV up to (but not including) this chip to get the FEN it
      // is played FROM, then advance the linear history one move at a time
      // so the user can step back through the inserted ply with ◀.
      const probe = new Chess(currentFen);
      // Replay first `chip.index - 1` moves to bring the probe to the right
      // FEN, dispatching playMove for each so the linear history grows.
      for (let i = 0; i < chip.index - 1; i++) {
        const u = line.pv[i];
        if (!u || u.length < 4) return;
        try {
          const promo = u.length >= 5 ? (u[4] ?? 'q') : 'q';
          const m = probe.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: promo });
          dispatch({ type: 'playMove', san: m.san, fenAfter: probe.fen() });
        } catch {
          return;
        }
      }
      // Now play the clicked chip's move itself.
      try {
        const promo = chip.uci.length >= 5 ? (chip.uci[4] ?? 'q') : 'q';
        const m = probe.move({
          from: chip.uci.slice(0, 2),
          to: chip.uci.slice(2, 4),
          promotion: promo,
        });
        dispatch({ type: 'playMove', san: m.san, fenAfter: probe.fen() });
      } catch {
        // Stockfish PV truncated or the move is illegal in this branch.
      }
    },
    [currentFen],
  );

  const resetToStart = useCallback(() => {
    dispatch({ type: 'reset', rootFen: STARTING_FEN });
    const params = new URLSearchParams(searchParams);
    params.delete('fen');
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  // Width of the eval bar overlay = ratio * 100% from the bottom up.
  const evalBarStyle: CSSProperties = { height: `${(evalRatio * 100).toFixed(1)}%` };

  // Move-number column — derived once for the move-tree grid.
  const startsBlack = hState.rootFen.split(' ')[1] === 'b';

  // Group the white-only / no-move-yet starting state into something the move
  // tree can render without exploding when history is empty.
  const noHistoryYet = movePairs.length === 0;

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden px-6 py-3">
      {engineError && (
        <div role="alert" className="mb-2 shrink-0 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <strong>Engine error:</strong> {engineError}
          <p className="mt-1 text-xs">
            Run <code className="font-mono">npm run vendor:engine</code> to populate <code className="font-mono">public/engine/</code>.
          </p>
        </div>
      )}

      {/*
        Three-column layout, lichess-style:
          [eval bar] [board column] [right rail]
        Eval bar is `auto` width (it's a 12px stripe), the board column flexes
        to fill the row (cg-board-fit container queries down to its smaller
        axis), and the right rail is a fixed 360px so the PV move chips have
        enough horizontal real estate to breathe. The grid itself is h-full
        of <main>, so on narrow viewports the board shrinks rather than
        pushing the page off screen.
      */}
      <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[auto_minmax(0,1fr)_minmax(280px,360px)]">
        {/* Eval bar — taller than before so it visually anchors the board. */}
        <div
          aria-label={`Evaluation ${evalLabel}`}
          aria-live="polite"
          className="relative hidden h-full w-3 self-center overflow-hidden rounded border border-border bg-eval-black lg:block"
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-eval-white transition-[height] duration-200"
            style={evalBarStyle}
          />
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        </div>

        {/* Board column: top toolbar + board */}
        <div className="flex min-h-0 min-w-0 flex-col items-center gap-2">
          {/* Top toolbar — nav strip + flip + copy actions */}
          <div className="flex w-full max-w-full shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1" role="group" aria-label="Move navigation">
              <ToolbarButton
                onClick={() => dispatch({ type: 'first' })}
                label="Jump to start"
                hint="Start (Home)"
                glyph="⟪"
                disabled={hState.currentPly === 0}
              />
              <ToolbarButton
                onClick={() => dispatch({ type: 'prev' })}
                label="Previous move"
                hint="Previous (←)"
                glyph="◀"
                disabled={hState.currentPly === 0}
              />
              <ToolbarButton
                onClick={() => dispatch({ type: 'next' })}
                label="Next move"
                hint="Next (→)"
                glyph="▶"
                disabled={hState.currentPly === hState.history.length}
              />
              <ToolbarButton
                onClick={() => dispatch({ type: 'last' })}
                label="Jump to end"
                hint="End (End)"
                glyph="⟫"
                disabled={hState.currentPly === hState.history.length}
              />
              <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" />
              <ToolbarButton
                onClick={() => setFlipped((v) => !v)}
                label="Flip board"
                hint="Flip (F)"
                glyph="⟳"
                active={flipped}
              />
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void copyFen()}
                className="inline-flex items-center rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Copy FEN
              </button>
              <button
                type="button"
                onClick={() => void copyPgn()}
                className="inline-flex items-center rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Copy PGN
              </button>
              {copyMessage && (
                <span className="ml-1 text-xs text-muted-foreground" aria-live="polite">
                  {copyMessage}
                </span>
              )}
            </div>
          </div>

          <div className="cg-board-fit min-h-0">
            <Chessground config={cgConfig} />
          </div>

          {/* Mobile-only inline eval label (the desktop eval bar is hidden < lg).
              Screen readers get the eval through the chip's aria-label. */}
          <div className="text-xs text-muted-foreground lg:hidden" aria-live="polite">
            <EvalChip scoreCp={whiteCp} scoreMate={whiteMate} size="sm" />
          </div>
        </div>

        {/* Right rail — move tree, engine status + lines, position loader */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {/* Move tree — two-column grid (white | black) per move number. */}
          <section className="rounded-md border border-border bg-muted/30">
            <div className="flex items-baseline justify-between border-b border-border/60 px-3 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Moves</h2>
              <button
                type="button"
                onClick={resetToStart}
                className="text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Reset
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {noHistoryYet ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">
                  No moves yet — play on the board.
                </p>
              ) : (
                <ol
                  className="divide-y divide-border/40 font-mono text-sm leading-tight"
                  aria-label="Move list"
                >
                  {/* Highlight the starting position too — clicking the
                      "start" row jumps to the root. */}
                  <li>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'first' })}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                        hState.currentPly === 0 ? 'bg-accent/15 ring-1 ring-inset ring-accent/40' : ''
                      }`}
                    >
                      Start
                    </button>
                  </li>
                  {movePairs.map((pair) => {
                    const w = pair.white;
                    const b = pair.black;
                    const wActive = w !== undefined && hState.currentPly === w.ply;
                    const bActive = b !== undefined && hState.currentPly === b.ply;
                    return (
                      <li
                        key={pair.number}
                        className="grid grid-cols-[2.5rem_1fr_1fr] items-stretch text-foreground"
                      >
                        <span className="flex items-center justify-end pr-2 text-[11px] text-muted-foreground tabular-nums">
                          {pair.number}.
                        </span>
                        {w ? (
                          <button
                            type="button"
                            onClick={() => dispatch({ type: 'goto', ply: w.ply })}
                            className={`px-2 py-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                              wActive ? 'bg-accent/15 font-semibold ring-1 ring-inset ring-accent/40' : ''
                            }`}
                          >
                            {w.san}
                          </button>
                        ) : (
                          <span className="px-2 py-1 text-muted-foreground/60">{startsBlack ? '' : '…'}</span>
                        )}
                        {b ? (
                          <button
                            type="button"
                            onClick={() => dispatch({ type: 'goto', ply: b.ply })}
                            className={`px-2 py-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                              bActive ? 'bg-accent/15 font-semibold ring-1 ring-inset ring-accent/40' : ''
                            }`}
                          >
                            {b.san}
                          </button>
                        ) : (
                          <span className="px-2 py-1" />
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>

          {/* Engine status bar + PV stack */}
          <section className="rounded-md border border-border bg-muted/30">
            {/* Engine status row — name · depth · nps · MultiPV toggle */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-semibold uppercase tracking-wide">Stockfish 18 NNUE</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums" aria-label={`Depth ${top?.depth ?? 0}`}>
                depth {top?.depth ?? 0}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums" aria-label={`Speed ${formatNps(latestNps)}`}>
                {formatNps(latestNps)}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={engineEnabled}
                    onChange={(e) => setEngineEnabled(e.target.checked)}
                    className="h-3 w-3 accent-[var(--color-accent)]"
                    aria-label="Enable engine"
                  />
                  <span>On</span>
                </label>
                <span aria-hidden="true">·</span>
                <span className="text-muted-foreground" id="multipv-label">
                  Lines:
                </span>
                <div role="group" aria-labelledby="multipv-label" className="flex overflow-hidden rounded border border-border">
                  {([1, 2, 3, 4] as const).map((n) => {
                    const isOn = multiPv === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setMultiPv(n)}
                        aria-pressed={isOn}
                        className={`min-w-6 px-1.5 py-0.5 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                          isOn
                            ? 'bg-accent/20 text-foreground'
                            : 'bg-background text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* PV lines stack */}
            <ul className="divide-y divide-border/40" aria-label="Engine analysis lines">
              {!engineReady && engineLines.length === 0 && (
                <>
                  {Array.from({ length: multiPv }).map((_, i) => (
                    <li key={i} className="px-3 py-2">
                      <div className="h-7 animate-pulse rounded bg-muted" aria-hidden="true" />
                    </li>
                  ))}
                </>
              )}
              {engineReady && engineEnabled && engineLines.length === 0 && (
                <li className="px-3 py-3 text-xs text-muted-foreground">Searching…</li>
              )}
              {!engineEnabled && (
                <li className="px-3 py-3 text-xs text-muted-foreground">
                  Engine paused — toggle <span className="font-mono">On</span> to resume.
                </li>
              )}
              {engineLines.map((line) => {
                // Score is from side-to-move's POV; display from white's view.
                const wCp = line.scoreCp !== undefined ? line.scoreCp * sideMul : null;
                const wMate = line.scoreMate !== undefined ? line.scoreMate * sideMul : null;
                const chips = uciPvToChips(currentFen, line.pv, PV_PREVIEW_PLIES);
                // Move number for the *first* chip in this PV — derived from
                // the FEN's full-move counter and whose turn it is.
                const fenParts = currentFen.split(' ');
                const startFullMove = Number(fenParts[5] ?? '1');
                const startsBlackPv = fenParts[1] === 'b';
                return (
                  <li key={line.multipv} className="group">
                    <div className="flex items-start gap-2 px-3 py-2 hover:bg-background/60">
                      <EvalChip scoreCp={wCp} scoreMate={wMate} />
                      <div className="min-w-0 flex-1">
                        {/* PV moves rendered as inline clickable chips. We
                            number each white-move chip; black-move chips sit
                            adjacent without a number. Same convention as the
                            move tree. */}
                        <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 font-mono text-[13px] leading-tight text-foreground">
                          {chips.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            chips.map((chip, idx) => {
                              // Compute display move-number prefix.
                              // Index 0 = first move in PV. If we start with
                              // black-to-move, the first chip is black's reply
                              // (e.g. "5… Nc6"), then "6. d4 …".
                              let prefix = '';
                              if (idx === 0) {
                                if (startsBlackPv) prefix = `${startFullMove}…`;
                                else prefix = `${startFullMove}.`;
                              } else {
                                // Recompute for each chip — cheap, deterministic.
                                const offsetIfStartedBlack = startsBlackPv ? 1 : 0;
                                const localIdx = idx + offsetIfStartedBlack;
                                if (localIdx % 2 === 0) {
                                  // White's move
                                  prefix = `${startFullMove + Math.floor(localIdx / 2)}.`;
                                }
                              }
                              return (
                                <button
                                  key={chip.index}
                                  type="button"
                                  onClick={() => playPvChip(chip, line)}
                                  className="rounded px-1 -mx-0.5 transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                  aria-label={`Play ${chip.san}`}
                                >
                                  {prefix && (
                                    <span className="text-muted-foreground tabular-nums">{prefix}</span>
                                  )}
                                  <span className={prefix ? 'ml-0.5' : ''}>{chip.san}</span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Position loader — collapsed by default. */}
          <details className="group rounded-md border border-border bg-muted/30">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
              <span>Load FEN or PGN</span>
              <span aria-hidden="true" className="font-mono text-muted-foreground transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="space-y-3 border-t border-border/60 px-3 py-3">
              <div>
                <label htmlFor="fen-input" className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                  FEN
                </label>
                <textarea
                  id="fen-input"
                  rows={2}
                  value={fenInput}
                  onChange={(e) => setFenInput(e.target.value)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text');
                    if (text) {
                      setFenInput(text);
                      e.preventDefault();
                      applyFen(text);
                    }
                  }}
                  placeholder={currentFen}
                  className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <div className="mt-1 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => applyFen(fenInput)}
                    className="rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Load FEN
                  </button>
                  {fenError && (
                    <span className="text-[11px] text-red-700" role="alert">
                      {fenError}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="pgn-input" className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                  PGN
                </label>
                <textarea
                  id="pgn-input"
                  rows={3}
                  value={pgnInput}
                  onChange={(e) => setPgnInput(e.target.value)}
                  placeholder="1. e4 e5 2. Nf3 Nc6 …"
                  className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <div className="mt-1 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => applyPgn(pgnInput)}
                    className="rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Load PGN
                  </button>
                  {pgnError && (
                    <span className="text-[11px] text-red-700" role="alert">
                      {pgnError}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
