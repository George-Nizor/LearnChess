/*
 * Settings — single-column form for global preferences.
 *
 * V1 covers:
 *   Display: theme (light/dark/auto)
 *   Board:   square palette + piece set, with live mini-board previews
 *   Sound:   pack picker with per-pack ▶ preview button
 *   Data:    wipe local progress
 *
 * Each preference store owns its own persistence (localStorage) and the
 * Settings page is a thin View. Sections are wrapped in bordered card shells
 * that match the visual style used by trainer routes.
 *
 * Live previews — design note:
 *   Rather than mounting one chessground per option (heavy, and chessground's
 *   board CSS targets a global tag selector so per-card overrides would clash),
 *   we render a static SVG/CSS grid via `MiniBoardPreview`. Each card receives
 *   the theme and piece-set IDs as props so it shows the EXACT palette + sprite
 *   the live board will use, without any coupling to the active store value.
 *   The active store value still drives the visible "selected" ring, and
 *   clicking a card commits the change via the store setter.
 *
 * Accessibility: every choice control is a real <button>/<input> with a label,
 * tab-order is logical (top-down), choice groups are wrapped in a
 * <fieldset>+<legend>, and the board/piece grids implement radiogroup
 * semantics with arrow-key navigation.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { PageShell } from '@/components/ui/PageShell';
import { MiniBoardPreview } from '@/components/ui/MiniBoardPreview';
import { SoundPreviewButton } from '@/components/ui/SoundPreviewButton';
import { useBoardTheme, BOARD_THEMES, type BoardThemeId } from '@/state/boardTheme';
import { usePieceSet, PIECE_SETS, type PieceSetId } from '@/state/pieceSet';
import { useSoundPack, SOUND_PACKS, type SoundPackId } from '@/state/soundPack';
import { clearAll } from '@/persistence/db';

type ThemeMode = 'light' | 'dark' | 'auto';

const THEME_KEY = 'learnchess.theme';

// Defaults for the per-section "Reset" buttons. Kept here (rather than
// re-imported from each store) because the store files keep their default
// internal — duplicating the four-character literals here is cheaper than
// widening their public API just for a reset button.
const DEFAULT_THEME_MODE: ThemeMode = 'auto';
const DEFAULT_BOARD_THEME: BoardThemeId = 'brown';
const DEFAULT_PIECE_SET: PieceSetId = 'cburnett';
const DEFAULT_SOUND_PACK: SoundPackId = 'standard';

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

// ── Reusable choice-group (compact pills, used for theme + sound) ────────

interface ChoiceGroupProps<T extends string> {
  legend: string;
  description?: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string; description?: string }>;
  onChange: (id: T) => void;
  /** Optional name to scope the radio inputs (avoids cross-form clashes). */
  name: string;
  /** Optional render-prop for trailing content per option (e.g. preview btn). */
  renderTrailing?: (id: T) => ReactNode;
}

function ChoiceGroup<T extends string>({
  legend, description, value, options, onChange, name, renderTrailing,
}: ChoiceGroupProps<T>): ReactNode {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {options.map((opt) => {
          const isActive = opt.id === value;
          const inputId = `${name}-${opt.id}`;
          return (
            <span key={opt.id} className="inline-flex items-center gap-1.5">
              <label
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
              {renderTrailing?.(opt.id)}
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}

// ── Preview-card grid (board theme + piece set) ──────────────────────────

interface PreviewGridProps<T extends string> {
  legend: string;
  description?: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string; description?: string }>;
  onChange: (id: T) => void;
  /** Render the preview thumbnail for an option. */
  renderPreview: (id: T) => ReactNode;
  /** Stable name for accessibility / keyboard handling. */
  name: string;
}

function PreviewGrid<T extends string>({
  legend, description, value, options, onChange, renderPreview, name,
}: PreviewGridProps<T>): ReactNode {
  // Refs in option-array order so arrow-key nav can focus the next/prev card.
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let next = idx;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown': next = (idx + 1) % options.length; break;
      case 'ArrowLeft':
      case 'ArrowUp':   next = (idx - 1 + options.length) % options.length; break;
      case 'Home':      next = 0; break;
      case 'End':       next = options.length - 1; break;
      default: return;
    }
    e.preventDefault();
    const target = options[next];
    if (!target) return;
    onChange(target.id);
    refs.current[next]?.focus();
  }, [options, onChange]);

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <div
        role="radiogroup"
        aria-label={legend}
        className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-3"
      >
        {options.map((opt, idx) => {
          const isActive = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={`${opt.label}${opt.description ? ` — ${opt.description}` : ''}`}
              tabIndex={isActive ? 0 : -1}
              ref={(el) => { refs.current[idx] = el; }}
              onClick={() => onChange(opt.id)}
              onKeyDown={(e) => onKeyDown(e, idx)}
              className={`group flex flex-col items-center gap-2 rounded-lg border p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                isActive
                  ? 'border-accent bg-accent/10 ring-1 ring-accent shadow-sm'
                  : 'border-border bg-background hover:bg-muted'
              }`}
              data-name={name}
            >
              {renderPreview(opt.id)}
              <span className={`text-xs font-medium ${isActive ? 'text-accent' : 'text-foreground'}`}>
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ── Reset-section button ────────────────────────────────────────────────

function ResetButton({ onClick, label = 'Reset to defaults' }: { onClick: () => void; label?: string }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {label}
    </button>
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

  const resetDisplay = useCallback(() => {
    handleThemeMode(DEFAULT_THEME_MODE);
  }, [handleThemeMode]);

  const resetBoard = useCallback(() => {
    setBoardTheme(DEFAULT_BOARD_THEME);
    setPieceSet(DEFAULT_PIECE_SET);
  }, [setBoardTheme, setPieceSet]);

  const resetSound = useCallback(() => {
    setSoundPack(DEFAULT_SOUND_PACK);
  }, [setSoundPack]);

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
          <ResetButton onClick={resetDisplay} />
        </section>

        {/* ── Board ─────────────────────────────────────────────────── */}
        <section
          aria-labelledby="settings-board"
          className="space-y-5 rounded-md border border-border bg-elevated p-5"
        >
          <h2 id="settings-board" className="font-display text-lg font-semibold">Board</h2>

          <PreviewGrid<BoardThemeId>
            name="board-theme"
            legend="Squares"
            description="Click a board to apply that palette."
            value={boardTheme}
            options={BOARD_THEMES}
            onChange={setBoardTheme}
            renderPreview={(id) => (
              <MiniBoardPreview boardTheme={id} pieceSet={pieceSet} size={140} />
            )}
          />

          <PreviewGrid<PieceSetId>
            name="piece-set"
            legend="Pieces"
            description="Alternate sets need to be vendored once via npm run vendor:piece-sets — until then they fall back to CBurnett."
            value={pieceSet}
            options={PIECE_SETS}
            onChange={setPieceSet}
            renderPreview={(id) => (
              <MiniBoardPreview boardTheme={boardTheme} pieceSet={id} size={140} />
            )}
          />

          <ResetButton onClick={resetBoard} label="Reset board to defaults" />
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
            description="Each pack ships move, capture, check and game-end samples. Press ▶ to sample without switching."
            value={soundPack}
            options={SOUND_PACKS}
            onChange={setSoundPack}
            renderTrailing={(id) => <SoundPreviewButton pack={id} />}
          />
          <ResetButton onClick={resetSound} label="Reset sound pack" />
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
