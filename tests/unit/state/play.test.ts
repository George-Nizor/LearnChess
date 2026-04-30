import { beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { usePlayStore } from '@/state/play';
import { STARTING_FEN } from '@/chess/rules';

describe('usePlayStore', () => {
  beforeEach(() => {
    usePlayStore.getState().newGame('w');
  });

  it('starts at the standard position with white to move', () => {
    const s = usePlayStore.getState();
    expect(s.fen).toBe(STARTING_FEN);
    expect(s.history).toEqual([]);
    expect(s.playerColor).toBe('w');
    expect(s.isGameOver).toBe(false);
  });

  it('applies a legal move and updates fen + history', () => {
    const ok = usePlayStore.getState().applyMoveFromSquares('e2', 'e4');
    expect(ok).toBe(true);
    const s = usePlayStore.getState();
    expect(s.history).toEqual(['e2e4']);
    expect(new Chess(s.fen).turn()).toBe('b');
  });

  it('rejects an illegal move and leaves state untouched', () => {
    const before = usePlayStore.getState().fen;
    const ok = usePlayStore.getState().applyMoveFromSquares('e2', 'e5');
    expect(ok).toBe(false);
    expect(usePlayStore.getState().fen).toBe(before);
  });

  it('detects game-over after Fool’s mate', () => {
    const apply = usePlayStore.getState().applyMoveUci;
    expect(apply('f2f3')).toBe(true);
    expect(apply('e7e5')).toBe(true);
    expect(apply('g2g4')).toBe(true);
    expect(apply('d8h4')).toBe(true);
    expect(usePlayStore.getState().isGameOver).toBe(true);
  });

  it('clamps skill level to 0..20', () => {
    const set = usePlayStore.getState().setSkillLevel;
    set(-5);
    expect(usePlayStore.getState().skillLevel).toBe(0);
    set(99);
    expect(usePlayStore.getState().skillLevel).toBe(20);
    set(12);
    expect(usePlayStore.getState().skillLevel).toBe(12);
  });

  it('clamps engine movetime within 50..10000 ms', () => {
    const set = usePlayStore.getState().setEngineMovetime;
    set(10);
    expect(usePlayStore.getState().engineMovetime).toBe(50);
    set(50_000);
    expect(usePlayStore.getState().engineMovetime).toBe(10_000);
    set(450);
    expect(usePlayStore.getState().engineMovetime).toBe(450);
  });

  it('flipSide swaps player colour and resets the position', () => {
    usePlayStore.getState().applyMoveUci('e2e4');
    usePlayStore.getState().flipSide();
    const s = usePlayStore.getState();
    expect(s.playerColor).toBe('b');
    expect(s.fen).toBe(STARTING_FEN);
    expect(s.history).toEqual([]);
  });

  it('newGame resets evaluation and game-over flags', () => {
    usePlayStore.getState().setEvaluation({ scoreCp: 100, scoreMate: null, bestMoveUci: 'e2e4', depth: 12 });
    usePlayStore.getState().setEngineThinking(true);
    usePlayStore.getState().newGame();
    const s = usePlayStore.getState();
    expect(s.evaluation.scoreCp).toBeNull();
    expect(s.isEngineThinking).toBe(false);
    expect(s.isGameOver).toBe(false);
  });
});
