/*
 * Piece-set store — controls which piece SVGs the board renders.
 *
 * cburnett is the bundled default (chessground.cburnett.css is imported in
 * main.tsx and ships as inline base64 SVGs). Alternate sets reference
 * vendored SVGs in /piece-sets/<set>/ via a runtime-injected <link>.
 *
 * The cburnett bundled rules ALWAYS load. When the user picks an alternate
 * set the alternate's <link> is appended AFTER cburnett's, so its
 * `.cg-wrap piece.*` selectors win by source order. Switching back to
 * cburnett removes the override link, falling back to the bundled rules.
 */
import { create } from 'zustand';

export type PieceSetId = 'cburnett' | 'merida' | 'alpha' | 'pirouetti' | 'tatiana';

export const PIECE_SETS: ReadonlyArray<{ id: PieceSetId; label: string; description: string }> = [
  { id: 'cburnett',  label: 'CBurnett',  description: 'Lichess default — clean line art (bundled).' },
  { id: 'merida',    label: 'Merida',    description: 'Bold classic, popular tournament shapes.' },
  { id: 'alpha',     label: 'Alpha',     description: 'Stylised, slightly chunkier.' },
  { id: 'pirouetti', label: 'Pirouetti', description: 'Elegant flowing lines.' },
  { id: 'tatiana',   label: 'Tatiana',   description: 'Modern, distinctive silhouettes.' },
];

const STORAGE_KEY = 'learnchess.pieceSet';
const LINK_ID = 'learnchess-piece-set-css';
const DEFAULT: PieceSetId = 'cburnett';

function readInitial(): PieceSetId {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && PIECE_SETS.some((s) => s.id === v)) return v as PieceSetId;
  } catch { /* private mode */ }
  return DEFAULT;
}

function applyLink(id: PieceSetId): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  if (id === DEFAULT) {
    // No override — let the bundled cburnett CSS take over.
    if (existing) existing.remove();
    return;
  }
  const href = `/piece-sets/${id}.css`;
  if (existing) {
    if (existing.getAttribute('href') !== href) existing.setAttribute('href', href);
    return;
  }
  const link = document.createElement('link');
  link.id = LINK_ID;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

interface PieceSetState {
  set: PieceSetId;
  setSet: (s: PieceSetId) => void;
}

export const usePieceSet = create<PieceSetState>((set) => ({
  set: readInitial(),
  setSet: (s) => {
    applyLink(s);
    try { localStorage.setItem(STORAGE_KEY, s); } catch { /* private mode */ }
    set({ set: s });
  },
}));

/** Apply the active piece-set link tag — call once at app boot. Safe to re-run. */
export function ensurePieceSetLink(): void {
  applyLink(usePieceSet.getState().set);
}
