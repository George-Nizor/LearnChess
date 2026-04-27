/*
 * Board theme store — controls which `/board-themes/*.css` is loaded into
 * <head> at runtime. Persisted to localStorage so the choice survives a
 * page reload.
 *
 * Why dynamic <link> instead of bundling all theme CSS upfront:
 *  - 5 themes × ~3 KB CSS each = ~15 KB the user pays for even if they
 *    never change theme. Loading the active theme on demand means the
 *    initial bundle stays tight; the cost only kicks in on a theme swap.
 *  - The default theme's link is injected synchronously on first import
 *    (eagerly from main.tsx) so the board doesn't flash unstyled.
 *
 * Note: chessground.brown.css is NO LONGER imported from main.tsx — this
 * store owns the theme link end-to-end. The brown stylesheet from the npm
 * package and our `public/board-themes/brown.css` are byte-equivalent.
 */
import { create } from 'zustand';

export type BoardThemeId = 'brown' | 'blue' | 'green' | 'wood' | 'ic';

export const BOARD_THEMES: ReadonlyArray<{ id: BoardThemeId; label: string; description: string }> = [
  { id: 'brown',  label: 'Brown',  description: 'Classic warm wood tones (default).' },
  { id: 'blue',   label: 'Blue',   description: 'Cool slate-and-fog palette.' },
  { id: 'green',  label: 'Green',  description: 'Chess.com-style olive board.' },
  { id: 'wood',   label: 'Wood',   description: 'Warm walnut + oak.' },
  { id: 'ic',     label: 'IC',     description: 'High-contrast greyscale (a11y).' },
];

const STORAGE_KEY = 'learnchess.boardTheme';
const LINK_ID = 'learnchess-board-theme-css';
const DEFAULT: BoardThemeId = 'brown';

function readInitial(): BoardThemeId {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && BOARD_THEMES.some((t) => t.id === v)) return v as BoardThemeId;
  } catch {
    /* localStorage may be disabled */
  }
  return DEFAULT;
}

function applyLink(id: BoardThemeId): void {
  if (typeof document === 'undefined') return;
  const href = `/board-themes/${id}.css`;
  let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) {
    link.setAttribute('href', href);
  }
}

interface BoardThemeState {
  theme: BoardThemeId;
  setTheme: (t: BoardThemeId) => void;
}

export const useBoardTheme = create<BoardThemeState>((set) => ({
  theme: readInitial(),
  setTheme: (t) => {
    applyLink(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* private mode */ }
    set({ theme: t });
  },
}));

/** Inject the active theme link tag — call once at app boot. Safe to re-run. */
export function ensureBoardThemeLink(): void {
  applyLink(useBoardTheme.getState().theme);
}
