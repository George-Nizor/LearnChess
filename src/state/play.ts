import { create } from 'zustand';
import { Chess } from 'chess.js';
import { STARTING_FEN, tryMove, tryMoveUci } from '@/chess/rules';
import type { Square } from '@/chess/rules';

/*
 * zustand notes for users coming from Redux/MobX:
 *  - The store IS the hook. `usePlayStore(s => s.fen)` subscribes only to that
 *    slice; React re-renders only when the slice changes.
 *  - State is plain JS — no immer, no actions/reducers boilerplate. We mutate
 *    by calling `set({...})` with the new partial state.
 *  - We keep the heavy `Chess` instance OUT of the store (it's mutable; storing
 *    it would defeat zustand's shallow-equality re-render detection). The
 *    source of truth is the FEN string; we reconstruct a Chess instance lazily
 *    inside actions, which is cheap (chess.js parses FEN in microseconds).
 */

export type EngineMode = 'depth' | 'movetime';
export type PlayerColor = 'w' | 'b';

export interface EvalSnapshot {
  scoreCp: number | null;
  scoreMate: number | null;
  bestMoveUci: string | null;
  depth: number | null;
}

interface PlayState {
  fen: string;
  history: string[];
  playerColor: PlayerColor;
  skillLevel: number;
  engineMode: EngineMode;
  engineDepth: number;
  engineMovetime: number;
  showEvalBar: boolean;
  showBestArrow: boolean;
  evaluation: EvalSnapshot;
  isEngineThinking: boolean;
  isGameOver: boolean;

  newGame: (playerColor?: PlayerColor) => void;
  flipSide: () => void;
  applyMoveFromSquares: (from: Square, to: Square, promotion?: 'q' | 'r' | 'b' | 'n') => boolean;
  applyMoveUci: (uci: string) => boolean;
  setSkillLevel: (level: number) => void;
  setEngineMode: (mode: EngineMode) => void;
  setEngineDepth: (depth: number) => void;
  setEngineMovetime: (ms: number) => void;
  toggleEvalBar: () => void;
  toggleBestArrow: () => void;
  setEvaluation: (e: EvalSnapshot) => void;
  setEngineThinking: (b: boolean) => void;
}

const EMPTY_EVAL: EvalSnapshot = { scoreCp: null, scoreMate: null, bestMoveUci: null, depth: null };

export const usePlayStore = create<PlayState>((set, get) => ({
  fen: STARTING_FEN,
  history: [],
  playerColor: 'w',
  // Defaults match the Play page's "Intermediate" strength preset so the
  // radio group renders with one card selected on first load.
  skillLevel: 10,
  engineMode: 'movetime',
  engineDepth: 12,
  engineMovetime: 600,
  showEvalBar: true,
  showBestArrow: false,
  evaluation: EMPTY_EVAL,
  isEngineThinking: false,
  isGameOver: false,

  newGame: (playerColor) => {
    set({
      fen: STARTING_FEN,
      history: [],
      ...(playerColor !== undefined ? { playerColor } : {}),
      evaluation: EMPTY_EVAL,
      isEngineThinking: false,
      isGameOver: false,
    });
  },

  flipSide: () => {
    const next: PlayerColor = get().playerColor === 'w' ? 'b' : 'w';
    set({
      fen: STARTING_FEN,
      history: [],
      playerColor: next,
      evaluation: EMPTY_EVAL,
      isEngineThinking: false,
      isGameOver: false,
    });
  },

  applyMoveFromSquares: (from, to, promotion = 'q') => {
    const game = new Chess(get().fen);
    const move = tryMove(game, from, to, promotion);
    if (!move) return false;
    set({
      fen: move.fenAfter,
      history: [...get().history, move.uci],
      isGameOver: game.isGameOver(),
      evaluation: EMPTY_EVAL,
    });
    return true;
  },

  applyMoveUci: (uci) => {
    const game = new Chess(get().fen);
    const move = tryMoveUci(game, uci);
    if (!move) return false;
    set({
      fen: move.fenAfter,
      history: [...get().history, move.uci],
      isGameOver: game.isGameOver(),
      evaluation: EMPTY_EVAL,
    });
    return true;
  },

  setSkillLevel: (level) => set({ skillLevel: Math.max(0, Math.min(20, Math.round(level))) }),
  setEngineMode: (mode) => set({ engineMode: mode }),
  setEngineDepth: (depth) => set({ engineDepth: Math.max(1, Math.min(30, Math.round(depth))) }),
  setEngineMovetime: (ms) => set({ engineMovetime: Math.max(50, Math.min(10_000, Math.round(ms))) }),
  toggleEvalBar: () => set({ showEvalBar: !get().showEvalBar }),
  toggleBestArrow: () => set({ showBestArrow: !get().showBestArrow }),
  setEvaluation: (e) => set({ evaluation: e }),
  setEngineThinking: (b) => set({ isEngineThinking: b }),
}));
