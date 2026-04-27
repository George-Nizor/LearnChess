import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import { Chessground } from '@/chess/board';
import { isPromotion, lastMoveSquares, legalDests, tryMove, tryMoveUci, turnColor } from '@/chess/rules';
import { playSound, soundForMove } from '@/sound';
import type { Square } from '@/chess/rules';
import { PuzzlesDb, type PuzzleRow } from '@/puzzles/db';
import { nextCard } from '@/puzzles/scheduler';
import { INITIAL_USER_RATING, ratingBand, updateRating, type RatingState } from '@/puzzles/rating';
import { GROUP_LABELS, groupThemes, labelFor, type ThemeGroup } from '@/puzzles/themes';
import {
  getRecentPuzzleAttempts,
  getUserRating,
  recordPuzzleAttempt,
  setUserRating,
  upsertSrCard,
} from '@/persistence/db';
import { Popover } from '@/components/ui/Popover';
import { OPENINGS } from '@/chess/openings/book';
import { formatOpeningTag, openingSlugPrefix } from '@/openings/slug';
import type { Config } from 'chessground/config';

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

/** Group order in the picker. Beginners see "tactics" themes first. */
const GROUP_ORDER: ThemeGroup[] = ['tactics', 'mating', 'endgame', 'phase', 'positional', 'special'];

/** Groups that start expanded inside the popover — the two highest-traffic
 *  ones based on how Lichess orders its training/themes index. The rest are
 *  collapsed by default to keep the popover scrollable height short. */
const DEFAULT_OPEN_GROUPS: readonly ThemeGroup[] = ['tactics', 'mating'];

const DEFAULT_RATING_MIN = 1200;
const DEFAULT_RATING_MAX = 1600;

// Opening slug helpers moved to `@/openings/slug` so the Openings
// detail's Puzzles tab can share the same mapping.

function setupPuzzle(row: PuzzleRow): ActivePuzzle {
  const moves = row.moves.split(' ');
  const setupUci = moves[0]!;
  const game = new Chess(row.fen);
  game.move({ from: setupUci.slice(0, 2), to: setupUci.slice(2, 4), promotion: setupUci.length >= 5 ? (setupUci[4] as 'q' | 'r' | 'b' | 'n') : 'q' });
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
      game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.length >= 5 ? (m[4] as 'q' | 'r' | 'b' | 'n') : 'q' });
    } catch {
      break;
    }
  }
  return game.fen();
}

export function Tactics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [db, setDb] = useState<PuzzlesDb | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [themesAvailable, setThemesAvailable] = useState<string[]>([]);
  const [openingTagsAvailable, setOpeningTagsAvailable] = useState<string[]>([]);
  const [selectedThemes, setSelectedThemes] = useState<string[]>(['fork']);
  const [selectedOpenings, setSelectedOpenings] = useState<string[]>([]);
  const [openingSearch, setOpeningSearch] = useState('');
  const [ratingMin, setRatingMin] = useState(DEFAULT_RATING_MIN);
  const [ratingMax, setRatingMax] = useState(DEFAULT_RATING_MAX);
  const [active, setActive] = useState<ActivePuzzle | null>(null);
  const [status, setStatus] = useState<SolveStatus>('awaiting');
  const [hintSquare, setHintSquare] = useState<Square | null>(null);
  const [userRating, setUserRatingState] = useState<RatingState>(INITIAL_USER_RATING);
  const [lastRatingDelta, setLastRatingDelta] = useState<number | null>(null);
  const [recentAttempts, setRecentAttempts] = useState(0);
  const [solvedCount, setSolvedCount] = useState(0);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const recordedRef = useRef(false);
  const queueRef = useRef<PuzzleRow[]>([]);
  const themeTriggerRef = useRef<HTMLButtonElement>(null);

  // Load puzzle DB once
  useEffect(() => {
    PuzzlesDb.load()
      .then((loaded) => {
        setDb(loaded);
        setThemesAvailable(loaded.themes());
        setOpeningTagsAvailable(loaded.openingTags());
      })
      .catch((err: Error) => setDbError(err.message));
  }, []);

  /*
   * Cross-link from the Openings page: `/tactics?opening=Italian_Game` should
   * pre-select an opening filter on first mount. We strip the query param
   * after consuming it so a manual edit doesn't keep re-applying. Run-once
   * via an effect-level guard so React 19 strict-mode double-invocations
   * don't duplicate the entry.
   */
  const openingParamConsumedRef = useRef(false);
  useEffect(() => {
    if (openingParamConsumedRef.current) return;
    const opening = searchParams.get('opening');
    if (!opening) return;
    openingParamConsumedRef.current = true;
    const slug = opening.endsWith('%') ? opening : `${opening}%`;
    setSelectedOpenings((cur) => (cur.includes(slug) ? cur : [...cur, slug]));
    queueRef.current = [];
    // Drop the query param so the URL reflects the actual UI state.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('opening');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  // Hydrate persisted user rating + session counters
  useEffect(() => {
    void getUserRating('tactics').then((r) => {
      if (r) setUserRatingState({ rating: r.rating, rd: r.rd });
    });
    void getRecentPuzzleAttempts(50).then((arr) => {
      setRecentAttempts(arr.length);
      setSolvedCount(arr.filter((a) => a.solved).length);
    });
  }, []);

  /*
   * BUG FIX (2026-04-26): the previous version had loadNext depending on the
   * filter state via useCallback, so any filter toggle changed loadNext's
   * identity, fired the mount useEffect, and silently advanced the user past
   * their current puzzle. We now read filters from a ref so loadNext only
   * changes when `db` changes — and we explicitly empty the queue on filter
   * change without auto-advancing the visible puzzle.
   */
  const filtersRef = useRef({ selectedThemes, selectedOpenings, ratingMin, ratingMax });
  useEffect(() => {
    filtersRef.current = { selectedThemes, selectedOpenings, ratingMin, ratingMax };
    queueRef.current = [];     // next click will re-query with new filters
  }, [selectedThemes, selectedOpenings, ratingMin, ratingMax]);

  const loadNext = useCallback(() => {
    if (!db) return;
    if (queueRef.current.length === 0) {
      const f = filtersRef.current;
      queueRef.current = db.query({
        themes: f.selectedThemes,
        openingTags: f.selectedOpenings,
        ratingMin: f.ratingMin,
        ratingMax: f.ratingMax,
        limit: 25,
      });
    }
    const next = queueRef.current.shift();
    if (!next) {
      setActive(null);
      setStatus('awaiting');
      return;
    }
    setActive(setupPuzzle(next));
    setStatus('awaiting');
    setHintSquare(null);
    setLastRatingDelta(null);
    recordedRef.current = false;
  }, [db]);

  // Initial puzzle on first DB load only; do NOT depend on loadNext.
  const firstLoadRef = useRef(false);
  useEffect(() => {
    if (db && !firstLoadRef.current) {
      firstLoadRef.current = true;
      loadNext();
    }
  }, [db, loadNext]);

  /**
   * Record an attempt at most once per puzzle (the user can resolve, retry,
   * etc. — we still only count a single rating change). Solved -> grade='good',
   * failed -> grade='again' for the SR scheduler. No self-grading buttons.
   */
  const recordAttempt = useCallback(
    async (solved: boolean, currentActive: ActivePuzzle) => {
      if (recordedRef.current) return;
      recordedRef.current = true;
      const outcome = solved ? 1 : 0;
      const newRating = updateRating(userRating, currentActive.row.rating, currentActive.row.rating_dev || 75, outcome);
      const delta = newRating.rating - userRating.rating;
      setLastRatingDelta(delta);
      setUserRatingState(newRating);
      await setUserRating({ pillar: 'tactics', rating: newRating.rating, rd: newRating.rd, updatedAt: Date.now() });
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
      setRecentAttempts((n) => n + 1);
      if (solved) setSolvedCount((n) => n + 1);
    },
    [userRating],
  );

  const fen = active ? (
    active.ply === 0 ? active.startFenAfterSetup : computeFenAtPly(active)
  ) : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const game = useMemo(() => new Chess(fen), [fen]);
  const sideToMove = turnColor(game);
  // Pin the board orientation to the side that's to move at puzzle start
  // (i.e. after the opponent's setup move). Derive once per puzzle so the
  // board doesn't flip every time the user or opponent plays a move.
  const playerSide: 'white' | 'black' = useMemo(() => {
    if (!active) return 'white';
    return turnColor(new Chess(active.startFenAfterSetup));
  }, [active]);
  const dests = useMemo(() => (active && status === 'awaiting' ? legalDests(game) : new Map<Square, Square[]>()), [game, active, status]);
  const lastMove = useMemo(() => lastMoveSquares(game), [game]);

  const handlePlayerMove = useCallback(
    (from: Square, to: Square) => {
      if (!active || status !== 'awaiting') return;
      const expected = active.solutionUci[active.ply];
      if (!expected) return;
      const expectedFrom = expected.slice(0, 2);
      const expectedTo = expected.slice(2, 4);
      const promotion = isPromotion(game, from, to) ? 'q' : 'q';

      if (from !== expectedFrom || to !== expectedTo) {
        // Allow any move that delivers checkmate as the final move
        const test = new Chess(game.fen());
        const moveResult = tryMoveUci(test, from + to + (isPromotion(game, from, to) ? 'q' : ''));
        if (moveResult && test.isCheckmate() && active.solutionUci.length - active.ply === 1) {
          playSound(soundForMove(moveResult));
          setStatus('solved');
          void recordAttempt(true, active);
          return;
        }
        playSound('check');
        setStatus('wrong');
        void recordAttempt(false, active);
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
        void recordAttempt(true, active);
        return;
      }
      // Auto-play opponent's reply (next solution move)
      const oppReply = active.solutionUci[newPly]!;
      try {
        const oppMv = probe.move({ from: oppReply.slice(0, 2), to: oppReply.slice(2, 4), promotion: oppReply.length >= 5 ? (oppReply[4] as 'q' | 'r' | 'b' | 'n') : 'q' });
        playSound(soundForMove({ isCapture: !!oppMv.captured, isCheck: probe.isCheck(), isCheckmate: probe.isCheckmate() }));
      } catch {
        setStatus('solved');
        void recordAttempt(true, active);
        return;
      }
      setActive({ ...active, ply: newPly + 1 });
    },
    [active, status, game, recordAttempt],
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
          // After a wrong move OR when the user clicks Show solution,
          // show the correct continuation as a green arrow.
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

  const showHintFn = useCallback(() => {
    if (!active) return;
    const expected = active.solutionUci[active.ply];
    if (!expected) return;
    setHintSquare(expected.slice(0, 2) as Square);
    setActive({ ...active, hintsUsed: active.hintsUsed + 1 });
  }, [active]);

  // "Show solution" reveals the answer WITHOUT penalising the user. The
  // previous behaviour (setStatus('wrong') + recordAttempt(false)) cost
  // ~200 rating per click and counted toward accuracy as a failed solve
  // - actively discouraging the use of a learning aid. New behaviour:
  // surface the move on the board (drawable arrow keys off this status)
  // and show the SAN in the sidebar, but no rating delta, no SRS card
  // update, no recorded attempt. The user can click Next to move on.
  const showSolution = useCallback(() => {
    if (!active) return;
    setStatus('revealed');
  }, [active]);

  const toggleTheme = useCallback((theme: string) => {
    setSelectedThemes((cur) => (cur.includes(theme) ? cur.filter((t) => t !== theme) : [...cur, theme]));
    queueRef.current = [];
  }, []);

  const removeTheme = useCallback((theme: string) => {
    setSelectedThemes((cur) => cur.filter((t) => t !== theme));
    queueRef.current = [];
  }, []);

  const addOpening = useCallback((tag: string) => {
    setSelectedOpenings((cur) => (cur.includes(tag) ? cur : [...cur, tag]));
    setOpeningSearch('');
    queueRef.current = [];
  }, []);

  const removeOpening = useCallback((tag: string) => {
    setSelectedOpenings((cur) => cur.filter((t) => t !== tag));
    queueRef.current = [];
  }, []);

  const resetRating = useCallback(() => {
    setRatingMin(DEFAULT_RATING_MIN);
    setRatingMax(DEFAULT_RATING_MAX);
    queueRef.current = [];
  }, []);

  // Curated quick-select — derived from the OPENINGS array so the labels
  // match what the user sees on the Openings page. Uses prefix slugs so
  // "Italian Game" matches "Italian Game", "Italian Game Two Knights",
  // etc. De-duped by display name to avoid showing both "Italian Game"
  // (white) and "Italian Game" (black) entries when an opening is
  // playable from both sides.
  // Hoisted ABOVE the early-return guards so React's rules-of-hooks
  // ordering stays consistent across renders (db-loading and post-load).
  const quickOpenings = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string; slug: string }[] = [];
    for (const o of OPENINGS) {
      if (seen.has(o.name)) continue;
      seen.add(o.name);
      out.push({ id: o.id, name: o.name, slug: `${openingSlugPrefix(o.id, o.name)}%` });
    }
    return out;
  }, []);

  if (dbError) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-3 text-3xl font-semibold">Tactics</h1>
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <strong>Puzzle DB unavailable.</strong>
          <p className="mt-1 text-sm">{dbError}</p>
          <p className="mt-2 text-sm">
            Run <code className="font-mono">npm run build:puzzles</code> after the CSV download finishes
            (<code className="font-mono">.cache/lichess_db_puzzle.csv.zst</code>).
          </p>
        </div>
      </div>
    );
  }

  if (!db) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-3 text-3xl font-semibold">Tactics</h1>
        <p className="text-sm text-muted-foreground">Loading puzzle database…</p>
      </div>
    );
  }

  const accuracy = recentAttempts === 0 ? null : Math.round((solvedCount / recentAttempts) * 100);

  // Compute "expected continuation" for the wrong-state display: show what
  // the user should have played from the current ply.
  const expectedSan = (() => {
    if (!active || (status !== 'wrong' && status !== 'revealed')) return null;
    try {
      const g = new Chess(fen);
      const exp = active.solutionUci[active.ply];
      if (!exp) return null;
      const m = g.move({ from: exp.slice(0, 2), to: exp.slice(2, 4), promotion: exp.length >= 5 ? (exp[4] as 'q' | 'r' | 'b' | 'n') : 'q' });
      return m.san;
    } catch {
      return null;
    }
  })();

  // Trigger label — Lichess-style: show the first two selected themes inline
  // and overflow into "+N more" so the sidebar can be ~200px wide and the
  // chip still fits one or two lines. Counts opening filters too so the
  // user sees "Italian Game +1 more" if they've added an opening on top
  // of theme picks.
  const triggerLabel: string = (() => {
    const all: string[] = [
      ...selectedThemes.map(labelFor),
      ...selectedOpenings.map(formatOpeningTag),
    ];
    if (all.length === 0) return 'All themes & openings';
    const head = all.slice(0, 2);
    if (all.length <= 2) return head.join(', ');
    return `${head.join(', ')} +${all.length - 2} more`;
  })();

  const isRatingDefault = ratingMin === DEFAULT_RATING_MIN && ratingMax === DEFAULT_RATING_MAX;

  // Filtered autocomplete suggestions — case-insensitive substring match
  // against every opening tag in the DB. Cap at 25 so the list stays
  // scannable; the user types more characters to narrow further. Filter
  // out already-selected slugs (with or without trailing `%`) so the
  // user can't add the same opening twice.
  const openingSuggestions: string[] = (() => {
    const q = openingSearch.trim().toLowerCase();
    if (q.length === 0) return [];
    const selectedNorm = new Set(selectedOpenings.map((s) => (s.endsWith('%') ? s.slice(0, -1) : s)));
    const out: string[] = [];
    for (const tag of openingTagsAvailable) {
      if (selectedNorm.has(tag)) continue;
      if (tag.toLowerCase().includes(q)) {
        out.push(tag);
        if (out.length >= 25) break;
      }
    }
    return out;
  })();

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold">Tactics</h1>
        <div className="text-sm text-muted-foreground">
          rating <span className="font-mono font-medium text-foreground">{userRating.rating}</span>
          <span className="ml-1 text-xs">±{userRating.rd}</span>
          <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs uppercase">{ratingBand(userRating.rating)}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_auto_300px]">
        {/* ────── FILTER SIDEBAR (compact, ≈200px) ─────────────────────── */}
        <aside className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Filters</h3>

          {/* Theme picker — collapsed-by-default popover trigger.
              The button's visible text IS its accessible name; we add
              aria-label to make the dynamic value ("Fork +2 more") less
              cryptic for screen-reader users by prefixing the field name. */}
          <div className="relative">
            <button
              ref={themeTriggerRef}
              type="button"
              onClick={() => setThemePickerOpen((o) => !o)}
              aria-haspopup="dialog"
              aria-expanded={themePickerOpen}
              aria-controls="theme-picker-panel"
              aria-label={`Themes filter: ${triggerLabel}`}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="truncate" title={triggerLabel}>{triggerLabel}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
                className={`shrink-0 transition-transform ${themePickerOpen ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <Popover
              open={themePickerOpen}
              onClose={() => setThemePickerOpen(false)}
              triggerRef={themeTriggerRef}
              panelId="theme-picker-panel"
              aria-label="Filter by theme and opening"
              className="max-h-[60vh] w-[320px] overflow-y-auto p-3"
            >
              {/* ────── OPENINGS SECTION ─────────────────────────────── */}
              <div className="mb-3">
                <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Opening
                  {selectedOpenings.length > 0 && (
                    <span className="ml-1 rounded bg-accent/20 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                      {selectedOpenings.length}
                    </span>
                  )}
                </div>

                {/* Quick-select strip — curated list cross-linked from
                    the Openings courses so the user doesn't have to
                    type "Sicilian" from scratch. */}
                {quickOpenings.length > 0 && (
                  <div className="mb-2 px-1">
                    <div className="mb-1 text-[10px] uppercase text-muted-foreground/70">From your openings courses</div>
                    <ul className="flex flex-wrap gap-1" aria-label="Quick-select openings">
                      {quickOpenings.map((q) => {
                        const selected = selectedOpenings.includes(q.slug);
                        return (
                          <li key={q.id}>
                            <button
                              type="button"
                              onClick={() => (selected ? removeOpening(q.slug) : addOpening(q.slug))}
                              aria-pressed={selected}
                              className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
                                selected
                                  ? 'border-accent bg-accent text-accent-foreground'
                                  : 'border-border bg-background hover:bg-muted'
                              }`}
                            >
                              {q.name}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* Search-with-autocomplete — Lichess has thousands of
                    opening slugs, so substring search is the only sane
                    interaction. We avoid the full WAI combobox pattern
                    (it requires arrow-key navigation, aria-activedescendant,
                    etc.) by rendering matches as plain buttons just below
                    the input. Screen-reader users tab into the buttons
                    naturally; visible-state changes are announced via
                    the role="status" "no matches" line. */}
                <div className="px-1">
                  <label htmlFor="opening-search" className="sr-only">Filter by opening name</label>
                  <input
                    id="opening-search"
                    type="search"
                    value={openingSearch}
                    onChange={(e) => setOpeningSearch(e.target.value)}
                    placeholder="Filter by opening…"
                    autoComplete="off"
                    className="w-full rounded border border-border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  {openingSuggestions.length > 0 && (
                    <ul
                      aria-label="Matching openings"
                      className="mt-1 max-h-40 overflow-y-auto rounded border border-border bg-background"
                    >
                      {openingSuggestions.map((tag) => (
                        <li key={tag}>
                          <button
                            type="button"
                            onClick={() => addOpening(tag)}
                            className="block w-full truncate px-2 py-1 text-left text-[11px] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                            title={formatOpeningTag(tag)}
                          >
                            {formatOpeningTag(tag)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {openingSearch.trim().length > 0 && openingSuggestions.length === 0 && (
                    <div className="mt-1 px-1 text-[10px] text-muted-foreground" role="status">
                      No matching openings.
                    </div>
                  )}
                </div>

                {/* Selected-openings chips inside the popover so they
                    stay visible when the user scrolls past the
                    quick-select. */}
                {selectedOpenings.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1 px-1" aria-label="Selected openings">
                    {selectedOpenings.map((tag) => (
                      <li key={tag}>
                        <button
                          type="button"
                          onClick={() => removeOpening(tag)}
                          aria-label={`Remove ${formatOpeningTag(tag)} opening filter`}
                          className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <span>{formatOpeningTag(tag)}</span>
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mb-2 border-t border-border" />

              {/* ────── THEMES SECTION ───────────────────────────────── */}
              <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Themes
              </div>
              {(() => {
                const grouped = groupThemes(themesAvailable);
                return GROUP_ORDER.filter((g) => grouped.has(g)).map((g) => {
                  const themesInGroup = (grouped.get(g) ?? []).sort((a, b) =>
                    labelFor(a).localeCompare(labelFor(b)),
                  );
                  const selectedInGroup = themesInGroup.filter((t) => selectedThemes.includes(t)).length;
                  const defaultOpen = DEFAULT_OPEN_GROUPS.includes(g) || selectedInGroup > 0;
                  return (
                    <details key={g} open={defaultOpen} className="mb-1 group">
                      <summary className="flex cursor-pointer list-none items-center justify-between rounded px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                        <span>
                          {GROUP_LABELS[g]}
                          {selectedInGroup > 0 && (
                            <span className="ml-1 rounded bg-accent/20 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                              {selectedInGroup}
                            </span>
                          )}
                        </span>
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          focusable="false"
                          className="transition-transform group-open:rotate-90"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </summary>
                      <div className="mt-1 mb-2 flex flex-wrap gap-1 pl-1">
                        {themesInGroup.map((t) => {
                          const selected = selectedThemes.includes(t);
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => toggleTheme(t)}
                              aria-pressed={selected}
                              className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
                                selected
                                  ? 'border-accent bg-accent text-accent-foreground'
                                  : 'border-border bg-background hover:bg-muted'
                              }`}
                            >
                              {labelFor(t)}
                            </button>
                          );
                        })}
                      </div>
                    </details>
                  );
                });
              })()}
              {(selectedThemes.length > 0 || selectedOpenings.length > 0) && (
                <div className="mt-2 flex gap-3 border-t border-border pt-2">
                  {selectedThemes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setSelectedThemes([]); queueRef.current = []; }}
                      className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Clear themes
                    </button>
                  )}
                  {selectedOpenings.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setSelectedOpenings([]); queueRef.current = []; }}
                      className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Clear openings
                    </button>
                  )}
                </div>
              )}
            </Popover>
          </div>

          {/* Selected-openings chip strip — placed above themes so the
              high-level "what am I drilling" filter is visible first. */}
          {selectedOpenings.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1" aria-label="Active openings">
              {selectedOpenings.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    onClick={() => removeOpening(tag)}
                    aria-label={`Remove ${formatOpeningTag(tag)} opening filter`}
                    className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    title={formatOpeningTag(tag)}
                  >
                    <span className="max-w-[140px] truncate">{formatOpeningTag(tag)}</span>
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Selected-themes chip strip */}
          {selectedThemes.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1" aria-label="Active themes">
              {selectedThemes.map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() => removeTheme(t)}
                    aria-label={`Remove ${labelFor(t)} filter`}
                    className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span>{labelFor(t)}</span>
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Rating range — compact side-by-side */}
          <div className="mt-3">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase text-muted-foreground">Rating</span>
              {!isRatingDefault && (
                <button
                  type="button"
                  onClick={resetRating}
                  className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Reset
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <label className="sr-only" htmlFor="rating-min">Minimum rating</label>
              <input
                id="rating-min"
                type="number"
                className="w-full rounded border border-border bg-background px-1 py-0.5 text-center font-mono text-xs"
                value={ratingMin}
                onChange={(e) => { setRatingMin(Number(e.target.value)); queueRef.current = []; }}
                min={400}
                max={3000}
                step={50}
              />
              <span className="text-xs text-muted-foreground">–</span>
              <label className="sr-only" htmlFor="rating-max">Maximum rating</label>
              <input
                id="rating-max"
                type="number"
                className="w-full rounded border border-border bg-background px-1 py-0.5 text-center font-mono text-xs"
                value={ratingMax}
                onChange={(e) => { setRatingMax(Number(e.target.value)); queueRef.current = []; }}
                min={400}
                max={3000}
                step={50}
              />
            </div>
          </div>

          {/* Skip-puzzle action — small icon button at the bottom. */}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={loadNext}
              title="Skip current puzzle and load a new one"
              aria-label="Skip puzzle"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <polygon points="5 4 15 12 5 20 5 4" />
                <line x1="19" y1="5" x2="19" y2="19" />
              </svg>
              <span>Skip puzzle</span>
            </button>
          </div>
        </aside>

        {/* ────── BOARD CENTRE ─────────────────────────────────────────── */}
        <div className="flex flex-col items-center">
          <Chessground config={cgConfig} />
          {active && (
            <div className="mt-3 flex w-full max-w-[640px] flex-col items-center gap-2">
              <Link
                to={`/analysis?fen=${encodeURIComponent(fen)}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent-soft/40 px-3 py-1.5 text-xs font-medium text-accent hover:border-accent hover:bg-accent-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span>Analyze position</span>
              </Link>
              <details className="text-[11px] text-muted-foreground">
                <summary className="cursor-pointer list-none rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  Show puzzle ID
                </summary>
                <div className="mt-1 text-center">
                  Puzzle <span className="font-mono">{active.row.id}</span> · rating{' '}
                  <span className="font-mono">{active.row.rating}</span>
                </div>
              </details>
            </div>
          )}
        </div>

        {/* ────── STATUS SIDEBAR ───────────────────────────────────────── */}
        <aside className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
          {/* Big primary status block — chess.com-style: one clear message + one primary action. */}
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
            {!active ? (
              <p className="text-sm">No puzzle queued. Adjust filters and reshuffle.</p>
            ) : status === 'awaiting' ? (
              <>
                <p className="text-base font-semibold">{sideToMove === 'white' ? 'White to move' : 'Black to move'}</p>
                <p className="mt-1 text-xs text-muted-foreground">Find the best continuation</p>
              </>
            ) : status === 'solved' ? (
              <>
                <p className="text-2xl">✓</p>
                <p className="text-base font-semibold">Solved!</p>
                {lastRatingDelta !== null && (
                  <p className={`mt-1 font-mono text-xs ${lastRatingDelta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {lastRatingDelta >= 0 ? '+' : ''}{lastRatingDelta} rating
                  </p>
                )}
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
                {lastRatingDelta !== null && (
                  <p className={`mt-1 font-mono text-xs ${lastRatingDelta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {lastRatingDelta >= 0 ? '+' : ''}{lastRatingDelta} rating
                  </p>
                )}
              </>
            )}
          </div>

          {/* Single primary action area */}
          {active && status === 'awaiting' && (
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

          {active && (status === 'solved' || status === 'wrong' || status === 'revealed') && (
            <button
              type="button"
              onClick={loadNext}
              onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  loadNext();
                }
              }}
              className="w-full rounded-md bg-accent py-3 text-sm font-semibold text-accent-foreground hover:opacity-90"
            >
              Next puzzle →
            </button>
          )}

          {/* Compact footer — Attempts / Accuracy / DB count on one row. */}
          <div className="mt-auto border-t border-border pt-3">
            <dl className="grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <dt className="text-muted-foreground">Attempts</dt>
                <dd className="font-mono">{recentAttempts}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Accuracy</dt>
                <dd className="font-mono">{accuracy === null ? '—' : `${accuracy}%`}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">DB</dt>
                <dd className="font-mono" title={`${db.count().toLocaleString()} puzzles loaded`}>
                  {db.count() >= 1000 ? `${Math.round(db.count() / 1000)}k` : db.count()}
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
