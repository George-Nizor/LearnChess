/*
 * PuzzlesView — the fourth tab on the Openings detail page (after
 * Learn / Drill / Explore).
 *
 * Idea: each opening has tactics that come up A LOT in real games. The
 * Lichess puzzle DB tags every puzzle with the opening it came from, so
 * we can surface "tactics that have actually happened in {Italian Game}"
 * as a study pillar of the opening itself, not a separate trip to the
 * Tactics tab. The user studies an opening's ideas (Learn), tests their
 * memory of the lines (Drill), explores positions in the engine
 * (Explore), and sharpens the tactical patterns the opening produces
 * (Puzzles).
 *
 * Two render modes:
 *   - 'overview' (default): summary card + theme chips + 6 sample
 *     positions. The user can pick a sample to jump straight into
 *     solving, OR jump to the full /tactics route via the CTA.
 *   - 'solving': inline PuzzleSolver scoped to this opening's slug.
 *     SRS card persistence reuses the same scheduler as the main
 *     Tactics route, so progress here counts toward the user's
 *     overall puzzle review queue.
 *
 * The "Solve here" UX was the missing piece: previously the user had
 * to leave the opening's context to actually solve. Now they stay
 * inside the Pirc/Italian/etc. lesson flow and the puzzles arrive
 * pre-filtered.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chessground } from '@/chess/board';
import { PuzzlesDb, type PuzzleRow } from '@/puzzles/db';
import { labelFor } from '@/puzzles/themes';
import { openingSlugPrefix } from '@/openings/slug';
import { PuzzleSolver } from '@/components/ui/PuzzleSolver';
import type { Repertoire } from '@/openings';
import type { Config } from 'chessground/config';
import { Chess } from 'chess.js';
import { motion } from 'framer-motion';

interface PuzzlesViewProps {
  repertoire: Repertoire;
}

/** SAN-style theme labels we always want highlighted before others if present. */
const PRIORITY_THEMES = [
  'fork', 'pin', 'mate', 'mateIn1', 'mateIn2', 'mateIn3', 'sacrifice',
  'discoveredAttack', 'doubleCheck', 'skewer', 'attraction', 'deflection',
  'middlegame', 'endgame', 'opening',
];

/** Pretty rating-band label; matches Tactics' tier names loosely. */
function describeRatingBand(min: number, max: number): string {
  if (max <= 1200) return 'beginner-friendly';
  if (min >= 2000) return 'expert';
  if (min >= 1600) return 'intermediate-to-strong';
  return 'all levels';
}

export function PuzzlesView({ repertoire }: PuzzlesViewProps): ReactNode {
  const slug = openingSlugPrefix(repertoire.sourceLabel ?? '', repertoire.name);
  const slugLike = `${slug}%`;

  const [db, setDb] = useState<PuzzlesDb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<PuzzleRow[] | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  // Two render modes - overview (summary cards) and solving (inline
  // PuzzleSolver). User toggles via the "Solve here" CTA.
  const [solving, setSolving] = useState(false);

  // Solving mode owns its own queue. Loaded fresh from the DB each
  // time we enter solve mode, replenished automatically when empty.
  const queueRef = useRef<PuzzleRow[]>([]);

  // Load DB once; re-run the slug-scoped query whenever the active
  // repertoire (and therefore slug) changes.
  useEffect(() => {
    let cancelled = false;
    PuzzlesDb.load()
      .then((loaded) => {
        if (cancelled) return;
        setDb(loaded);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!db) return;
    // 50-row sample drives both the theme histogram and the 6 visible
    // cards. Keeping the sample bounded prevents the renderer from
    // booting 50 chessgrounds (we slice to 6 below).
    const rows = db.query({ openingTags: [slugLike], limit: 50, ratingMin: 600, ratingMax: 3200 });
    setSample(rows);
    setTotalCount(db.countForOpening(slugLike));
  }, [db, slugLike]);

  // Aggregate themes across the sample for the chip strip.
  const themeChips = useMemo<{ theme: string; count: number; label: string }[]>(() => {
    if (!sample) return [];
    const counts = new Map<string, number>();
    for (const p of sample) {
      const themes = (p.themes ?? '').split(' ').filter(Boolean);
      for (const t of themes) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const entries = [...counts.entries()].map(([theme, count]) => ({
      theme, count, label: labelFor(theme),
    }));
    // Sort: priority themes first (in priority order), then by descending
    // count for the rest. Cap at 8 so the strip stays one-line on desktop.
    const prioRank = (t: string): number => {
      const i = PRIORITY_THEMES.indexOf(t);
      return i === -1 ? Number.POSITIVE_INFINITY : i;
    };
    entries.sort((a, b) => {
      const pa = prioRank(a.theme); const pb = prioRank(b.theme);
      if (pa !== pb) return pa - pb;
      return b.count - a.count;
    });
    return entries.slice(0, 8);
  }, [sample]);

  // Visible mini-board cards — small N to keep chessground spin-up cheap.
  const cards = useMemo(() => sample?.slice(0, 6) ?? [], [sample]);

  const ratingRange = useMemo(() => {
    if (!sample || sample.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const p of sample) {
      if (p.rating < min) min = p.rating;
      if (p.rating > max) max = p.rating;
    }
    return { min, max };
  }, [sample]);

  if (error) {
    return (
      <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Puzzle DB unavailable.</strong>
        <p className="mt-1 text-xs">{error}</p>
        <p className="mt-2 text-xs">
          Run <code className="font-mono">npm run build:puzzles</code> first, then reload.
        </p>
      </div>
    );
  }

  if (!db || sample === null) {
    return (
      <p className="rounded-md border border-border bg-elevated/40 p-4 text-sm text-muted-foreground">
        Loading puzzles drawn from {repertoire.name} games…
      </p>
    );
  }

  // Empty state — we have a slug but the puzzle DB has zero matches.
  // Almost always means our slug doesn't line up with Lichess's, but the
  // user just sees "no puzzles tagged" with a path forward.
  if (sample.length === 0) {
    return (
      <div className="rounded-md border border-border bg-elevated/40 p-6 text-sm">
        <h3 className="text-base font-semibold">No tagged puzzles found</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Lichess tagged 0 puzzles with the {repertoire.name} opening in the
          subset we ship. You can still solve general tactics in the Tactics tab.
        </p>
        <Link
          to="/tactics"
          className="mt-4 inline-block rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-muted"
        >
          Open Tactics →
        </Link>
      </div>
    );
  }

  // Solve mode renders the inline PuzzleSolver. The loadNext closure
  // pulls from a queue of 50 puzzles for this opening; when the
  // queue empties we re-query the DB for a fresh batch (RANDOM()
  // ordering ensures we don't see the same 50 forever). Persisting
  // is on so attempts feed the same SR/dashboard pipeline as the
  // main /tactics route.
  if (solving) {
    const loadNext = (): PuzzleRow | null => {
      if (queueRef.current.length === 0) {
        if (!db) return null;
        queueRef.current = db.query({
          openingTags: [slugLike],
          limit: 25,
          ratingMin: 600,
          ratingMax: 3200,
        });
      }
      return queueRef.current.shift() ?? null;
    };
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Solving puzzles from <span className="text-accent">{repertoire.name}</span>
          </h3>
          <button
            type="button"
            onClick={() => setSolving(false)}
            className="rounded border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
          >
            ← Back to overview
          </button>
        </div>
        <PuzzleSolver
          loadNext={loadNext}
          persist
          footerLabel={`Drawn from real Lichess games tagged "${repertoire.name}". Spaced-repetition cards persist to your overall puzzle queue.`}
          fullTacticsUrl={`/tactics?opening=${encodeURIComponent(slug)}`}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* HEADER — count + rating band + primary CTA. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-elevated/40 p-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">
            {totalCount !== null ? totalCount.toLocaleString() : '—'} puzzles
            <span className="font-normal text-muted-foreground"> from {repertoire.name} games</span>
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {ratingRange
              ? <>Rated {ratingRange.min}–{ratingRange.max} in this sample · {describeRatingBand(ratingRange.min, ratingRange.max)}</>
              : 'Drawn from real Lichess games tagged with this opening.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary CTA: solve INLINE without leaving the opening. */}
          <button
            type="button"
            onClick={() => { queueRef.current = []; setSolving(true); }}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"
          >
            Solve here →
          </button>
          {/* Secondary: jump to /tactics for the full filter chrome. */}
          <Link
            to={`/tactics?opening=${encodeURIComponent(slug)}`}
            className="rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-muted"
          >
            Open in full Tactics
          </Link>
        </div>
      </div>

      {/* THEME CHIPS — show what kind of tactics actually come up. */}
      {themeChips.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Common tactics in this opening
          </div>
          <div className="flex flex-wrap gap-2">
            {themeChips.map((c) => (
              <Link
                key={c.theme}
                to={`/tactics?opening=${encodeURIComponent(slug)}`}
                title={`${c.count} ${c.label} puzzles in the sample — click to train`}
                className="rounded-full border border-border bg-elevated px-3 py-1 text-xs hover:bg-muted"
              >
                <span className="font-medium">{c.label}</span>
                <span className="ml-1.5 text-muted-foreground">{c.count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* SAMPLE CARDS — 6 mini boards, each clickable into Tactics. */}
      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Sample positions
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((row) => (
            <PuzzleSampleCard key={row.id} row={row} slug={slug} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ───── Puzzle sample card ───────────────────────────────────────────────

interface PuzzleSampleCardProps {
  row: PuzzleRow;
  slug: string;
}

function PuzzleSampleCard({ row, slug }: PuzzleSampleCardProps): ReactNode {
  // The DB stores the opponent's setup move first — we want to show the
  // position the user would actually solve, i.e. AFTER that setup move.
  const post = useMemo(() => {
    try {
      const game = new Chess(row.fen);
      const setup = row.moves.split(' ')[0];
      if (!setup) return { fen: row.fen, side: 'white' as const };
      game.move({
        from: setup.slice(0, 2),
        to: setup.slice(2, 4),
        promotion: setup.length >= 5 ? (setup[4] as 'q' | 'r' | 'b' | 'n') : 'q',
      });
      return { fen: game.fen(), side: game.turn() === 'w' ? 'white' as const : 'black' as const };
    } catch {
      return { fen: row.fen, side: 'white' as const };
    }
  }, [row]);

  const cgConfig: Config = {
    fen: post.fen,
    orientation: post.side,
    viewOnly: true,
    coordinates: false,
    animation: { enabled: false, duration: 0 },
    drawable: { enabled: false, visible: false },
  };

  // First two themes — keeps the card readable at small sizes.
  const themePreview = (row.themes ?? '').split(' ').filter(Boolean).slice(0, 2);

  return (
    <Link
      to={`/tactics?opening=${encodeURIComponent(slug)}`}
      title={`${post.side === 'white' ? 'White' : 'Black'} to move · rated ${row.rating}. Open in Tactics.`}
      className="group flex flex-col gap-2 rounded-md border border-border bg-elevated p-3 hover:border-accent hover:bg-muted"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        // Cap the inline chessground width — at desktop this puts 3 cards
        // per row comfortably inside the bubble column.
        className="mx-auto w-[160px]"
      >
        <Chessground config={cgConfig} />
      </motion.div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{post.side === 'white' ? 'White to move' : 'Black to move'}</span>
        <span className="font-mono text-muted-foreground">{row.rating}</span>
      </div>
      {themePreview.length > 0 && (
        <div className="flex flex-wrap gap-1 text-[10px]">
          {themePreview.map((t) => (
            <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              {labelFor(t)}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
