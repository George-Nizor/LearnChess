/*
 * Sound-pack store — controls which `/sounds/<pack>/*.mp3` is played by
 * `src/sound/index.ts`. Persisted to localStorage so the choice survives
 * a page reload. Standard is the default; if a pack 404s the runtime falls
 * back to synthesised WebAudio tones (handled in src/sound/index.ts).
 */
import { create } from 'zustand';

export type SoundPackId = 'standard' | 'piano' | 'nes' | 'futuristic';

export const SOUND_PACKS: ReadonlyArray<{ id: SoundPackId; label: string; description: string }> = [
  { id: 'standard',   label: 'Standard',   description: 'Lichess default — soft tactile clicks.' },
  { id: 'piano',      label: 'Piano',      description: 'Warm piano notes per move.' },
  { id: 'nes',        label: 'NES',        description: '8-bit retro effects (chess.com vibe).' },
  { id: 'futuristic', label: 'Futuristic', description: 'Synth blips and beeps.' },
];

const STORAGE_KEY = 'learnchess.soundPack';
const DEFAULT: SoundPackId = 'standard';

function readInitial(): SoundPackId {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && SOUND_PACKS.some((p) => p.id === v)) return v as SoundPackId;
  } catch { /* private mode */ }
  return DEFAULT;
}

interface SoundPackState {
  pack: SoundPackId;
  setPack: (p: SoundPackId) => void;
}

export const useSoundPack = create<SoundPackState>((set) => ({
  pack: readInitial(),
  setPack: (p) => {
    try { localStorage.setItem(STORAGE_KEY, p); } catch { /* private mode */ }
    set({ pack: p });
  },
}));
