import { describe, expect, it } from 'vitest';
import { normFen, sideToMoveOf, STARTING_FEN_NORM } from '@/openings/fen';

describe('normFen', () => {
  it('strips half-move + full-move counters', () => {
    const full = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    expect(normFen(full)).toBe('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -');
  });

  it('returns the same string when already normalized', () => {
    const norm = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
    expect(normFen(norm)).toBe(norm);
  });

  it('two transposing FENs normalize to the same key', () => {
    // 1.e4 e5 2.Nf3 Nc6 — two move-orders reach the same final position
    const a = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const b = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 4';
    expect(normFen(a)).toBe(normFen(b));
  });

  it('STARTING_FEN_NORM is the start position without counters', () => {
    expect(STARTING_FEN_NORM).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  });
});

describe('sideToMoveOf', () => {
  it('reads white to move', () => {
    expect(sideToMoveOf(STARTING_FEN_NORM)).toBe('w');
  });

  it('reads black to move', () => {
    expect(sideToMoveOf('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -')).toBe('b');
  });
});
