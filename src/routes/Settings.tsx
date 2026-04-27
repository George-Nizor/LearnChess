/*
 * Settings — single-column form for global preferences.
 *
 * V1 covers:
 *   Display: theme (light/dark/auto)
 *   Board:   square palette, piece set
 *   Sound:   pack + preview button
 *   Data:    wipe local progress
 *
 * Each preference store owns its own persistence (localStorage) and the
 * Settings page is a thin View. We deliberately don't introduce a
 * shadcn Card primitive here — the existing routes use bordered divs
 * for "card" surfaces (`rounded-md border border-border bg-elevated p-5`)
 * so we match that pattern for visual consistency.
 *
 * Accessibility: every control is a real <button>/<input> with a label,
 * tab-order is logical (top-down), and choice groups are wrapped in a
 * <fieldset>+<legend> so screen readers announce the group name.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { PageShell } from '@/components/ui/PageShell';
import { useBoardTheme, BOARD_THEMES, type BoardThemeId } from '@/state/boardTheme';
import { usePieceSet, PIECE_SETS, type PieceSetId } from '@/state/pieceSet';
import { useSoundPack, SOUND_PACKS, type SoundPackId } from '@/state/soundPack';
import { playSound } from '@/sound';
import { clearAll } from '@/persistence/db';

type ThemeMode = 'light' | 'dark' | 'auto';

const THEME_KEY = 'learnchess.theme';

function readThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch { /* private mode */ }
  return 'auto';
}

function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  let dark: boolean;
  if (mode === 'auto') {
    try { localStorage.removeItem(THEME_KEY); } catch { /* ignore */ }
    dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    try { localStorage.setItem(THEME_KEY, mode); } catch { /* ignore */ }
    dark = mode === 'dark';
  }
  if (dark) root.classList.add('dark');
  else root.classList.remove('dark');
}

// ── Reusable choice-group ───────────────────────────────────────────────

interface ChoiceGroupProps<T extends string> {
  legend: string;
  description?: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string; description?: string }>;
  onChange: (id: T) => void;
  /** Optional name to scope the radio inputs (avoids cross-form clashes). */
  name: string;
}

function ChoiceGroup<T extends string>({ legend, description, value, options, onChange, name }: ChoiceGroupProps<T>): ReactNode {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        {options.map((opt) => {
          const isActive = opt.id === value;
          const inputId = `${name}-${opt.id}`;
          return (
            <label
              key={opt.id}
              htmlFor={inputId}
              title={opt.description}
              className={`group cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'border-accent bg-accent text-accent-foreground shadow-sm'
                  : 'border-border bg-background text-foreground hover:bg-muted'
              }`}
            >
              <input
                id={inputId}
                type="radio"
                name={name}
                value={opt.id}
                checked={isActive}
                onChange={() => onChange(opt.id)}
                className="sr-only"
              />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// ── Settings page ───────────────────────────────────────────────────────

export function Settings(): ReactNode {
  const boardTheme = useBoardTheme((s) => s.theme);
  const setBoardTheme = useBoardTheme((s) => s.setTheme);
  const pieceSet = usePieceSet((s) => s.set);
  const setPieceSet = usePieceSet((s) => s.setSet);
  const soundPack = useSoundPack((s) => s.pack);
  const setSoundPack = useSoundPack((s) => s.setPack);

  const [themeMode, setThemeModeState] = useState<ThemeMode>(readThemeMode);
  const [wipeStatus, setWipeStatus] = useState<'idle' | 'confirm' | 'wiping' | 'done'>('idle');

  // Listen for OS-level theme changes when in 'auto' mode.
  useEffect(() => {
    if (themeMode !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (): void => applyThemeMode('auto');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [themeMode]);

  const handleThemeMode = useCallback((m: ThemeMode) => {
    applyThemeMode(m);
    setThemeModeState(m);
  }, []);

  const handleSoundChoice = useCallback((p: SoundPackId) => {
    setSoundPack(p);
  }, [setSoundPack]);

  const handlePreviewSound = useCallback(() => {
    playSound('move', soundPack);
  }, [soundPack]);

  const handleWipe = useCallback(async () => {
    setWipeStatus('wiping');
    try {
      await clearAll();
      setWipeStatus('done');
    } catch {
      setWipeStatus('idle');
    }
  }, []);

  return (
    <PageShell width="narrow">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="space-y-6"
      >
        <header>
          <h1 className="font-display text-3xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Preferences are saved locally and apply across the app.
          </p>
        </header>

        {/* ── Display ───────────────────────────────────────────────── */}
        <section
          aria-labelledby="settings-display"
          className="space-y-4 rounded-md border border-border bg-elevated p-5"
        >
          <h2 id="settings-display" className="font-display text-lg font-semibold">Display</h2>
          <ChoiceGroup
            name="theme"
            legend="Colour theme"
            description="Auto follows your operating system."
            value={themeMode}
            options={[
              { id: 'light', label: 'Light' },
              { id: 'dark',  label: 'Dark' },
              { id: 'auto',  label: 'Auto' },
            ]}
            onChange={handleThemeMode}
          />
        </section>

        {/* ── Board ─────────────────────────────────────────────────── */}
        <section
          aria-labelledby="settings-board"
          className="space-y-4 rounded-md border border-border bg-elevated p-5"
        >
          <h2 id="settings-board" className="font-display text-lg font-semibold">Board</h2>
          <ChoiceGroup<BoardThemeId>
            name="board-theme"
            legend="Squares"
            value={boardTheme}
            options={BOARD_THEMES}
            onChange={setBoardTheme}
          />
          <ChoiceGroup<PieceSetId>
            name="piece-set"
            legend="Pieces"
            description="Alternate sets need to be vendored once via npm run vendor:piece-sets — until then they fall back to CBurnett."
            value={pieceSet}
            options={PIECE_SETS}
            onChange={setPieceSet}
          />
        </section>

        {/* ── Sound ─────────────────────────────────────────────────── */}
        <section
          aria-labelledby="settings-sound"
          className="space-y-4 rounded-md border border-border bg-elevated p-5"
        >
          <h2 id="settings-sound" className="font-display text-lg font-semibold">Sound</h2>
          <ChoiceGroup<SoundPackId>
            name="sound-pack"
            legend="Pack"
            description="Each pack ships move, capture, check and game-end samples."
            value={soundPack}
            options={SOUND_PACKS}
            onChange={handleSoundChoice}
          />
          <div>
            <button
              type="button"
              onClick={handlePreviewSound}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Preview move sound"
            >
              Preview move sound
            </button>
          </div>
        </section>

        {/* ── Data ──────────────────────────────────────────────────── */}
        <section
          aria-labelledby="settings-data"
          className="space-y-4 rounded-md border border-border bg-elevated p-5"
        >
          <h2 id="settings-data" className="font-display text-lg font-semibold">Data</h2>
          <p className="text-xs text-muted-foreground">
            All progress is stored in your browser only. Wiping clears it on this device — there is no cloud copy.
          </p>
          {wipeStatus === 'idle' && (
            <button
              type="button"
              onClick={() => setWipeStatus('confirm')}
              className="rounded-md border border-red-500 bg-background px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-950"
            >
              Wipe local progress
            </button>
          )}
          {wipeStatus === 'confirm' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground">Are you sure? This cannot be undone.</span>
              <button
                type="button"
                onClick={() => void handleWipe()}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Yes, wipe it
              </button>
              <button
                type="button"
                onClick={() => setWipeStatus('idle')}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          )}
          {wipeStatus === 'wiping' && (
            <p className="text-sm text-muted-foreground" role="status">Wiping…</p>
          )}
          {wipeStatus === 'done' && (
            <p className="text-sm text-accent" role="status">
              Local progress cleared. Reload the page to see a fresh dashboard.
            </p>
          )}
        </section>
      </motion.div>
    </PageShell>
  );
}
