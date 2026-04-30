/*
 * SetupBanner — a one-time warning shown at the top of the page when
 * either the Stockfish engine or the puzzles DB is missing on a fresh
 * clone. The two assets are large (~85 MB engine NNUE files, ~55 MB
 * puzzle DB) and intentionally gitignored — users have to run
 * `npm run setup` once to populate them.
 *
 * The banner probes both assets via HEAD requests at mount, dismisses
 * itself if both are present, and stays sticky until the user clicks
 * the "Hide" button (which sets a sessionStorage flag). It does NOT
 * block any route — Play / Tactics / Openings still load and each show
 * their own per-feature errors if the user tries to use the missing
 * asset directly. The banner is the friendly upfront cue.
 */
import { useEffect, useState } from 'react';

const SESSION_KEY = 'learnchess-setup-banner-dismissed-v1';

interface AssetStatus {
  engineMissing: boolean;
  puzzlesMissing: boolean;
}

async function probeAssets(): Promise<AssetStatus> {
  // Engine manifest: a small JSON file. Missing or malformed = engine isn't
  // vendored. We check for the jsFile field rather than just existence so a
  // half-vendored state (manifest written but wasm/nnue missing) still
  // surfaces.
  let engineMissing = false;
  try {
    const res = await fetch('/engine/engine.json', { cache: 'no-cache' });
    if (!res.ok) {
      engineMissing = true;
    } else {
      const m = (await res.json()) as { jsFile?: string };
      if (!m.jsFile) engineMissing = true;
    }
  } catch {
    engineMissing = true;
  }

  // Puzzles DB: sniff the SQLite magic bytes — Vite serves index.html as
  // a fallback for missing routes, so a 200 doesn't guarantee the file
  // is present. Same sniff as src/puzzles/db.ts.
  let puzzlesMissing = false;
  try {
    const res = await fetch('/puzzles.db', { cache: 'no-cache', headers: { Range: 'bytes=0-15' } });
    if (!res.ok) {
      puzzlesMissing = true;
    } else {
      const buf = new Uint8Array(await res.arrayBuffer());
      const isSqlite = buf.length >= 16
        && buf[0] === 0x53 && buf[1] === 0x51 && buf[2] === 0x4c
        && buf[3] === 0x69 && buf[4] === 0x74 && buf[5] === 0x65;
      puzzlesMissing = !isSqlite;
    }
  } catch {
    puzzlesMissing = true;
  }

  return { engineMissing, puzzlesMissing };
}

export function SetupBanner() {
  const [status, setStatus] = useState<AssetStatus | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (dismissed) return;
    void probeAssets().then(setStatus);
  }, [dismissed]);

  if (dismissed || status === null) return null;
  const { engineMissing, puzzlesMissing } = status;
  if (!engineMissing && !puzzlesMissing) return null;

  const what = engineMissing && puzzlesMissing
    ? 'the Stockfish engine and the tactics puzzle database are'
    : engineMissing
      ? 'the Stockfish engine is'
      : 'the tactics puzzle database is';

  const handleDismiss = () => {
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* private mode etc. */ }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex-shrink-0 font-semibold uppercase tracking-wide">First-run setup</span>
        <span className="min-w-0 flex-1">
          Looks like {what} not present yet. Run{' '}
          <code className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 font-mono dark:border-amber-700 dark:bg-amber-900/60">
            npm run setup
          </code>
          {' '}once to download Stockfish + build the puzzle database (~140 MB total, ~3-5 minutes).
          {engineMissing && !puzzlesMissing ? ' Play and Analysis are unavailable until then.' : null}
          {puzzlesMissing && !engineMissing ? ' Tactics and the Openings → Puzzles tab are unavailable until then.' : null}
          {engineMissing && puzzlesMissing ? ' Play, Analysis, Tactics, and the Openings → Puzzles tab are unavailable until then.' : null}
        </span>
        <button
          type="button"
          onClick={handleDismiss}
          className="flex-shrink-0 rounded border border-amber-400 bg-amber-100 px-2 py-0.5 text-[11px] hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-900/60 dark:hover:bg-amber-900"
        >
          Hide
        </button>
      </div>
    </div>
  );
}
