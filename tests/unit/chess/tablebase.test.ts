import { describe, expect, it } from 'vitest';
import { gradeMove, type TbResponse } from '@/chess/tablebase';

const winningResp: TbResponse = {
  category: 'win',
  dtz: 14,
  dtm: 22,
  checkmate: false,
  stalemate: false,
  insufficient_material: false,
  moves: [
    { uci: 'e6e7', san: 'e7', category: 'win', dtz: 13, dtm: 21, zeroing: false, checkmate: false, stalemate: false, insufficient_material: false },
    { uci: 'e6f5', san: 'Kf5', category: 'win', dtz: 19, dtm: 25, zeroing: false, checkmate: false, stalemate: false, insufficient_material: false },
    { uci: 'e6f7', san: 'Kf7', category: 'draw', dtz: null, dtm: null, zeroing: false, checkmate: false, stalemate: false, insufficient_material: false },
  ],
};

describe('gradeMove', () => {
  it('grades the optimal move as "optimal"', () => {
    const r = gradeMove('fen-before', winningResp, 'e6e7');
    expect(r.grade).toBe('optimal');
  });

  it('grades a winning-but-slower move as "good"', () => {
    const r = gradeMove('fen-before', winningResp, 'e6f5');
    expect(r.grade).toBe('good');
  });

  it('grades a winning-to-drawn move as "losing"', () => {
    const r = gradeMove('fen-before', winningResp, 'e6f7');
    expect(r.grade).toBe('losing');
  });

  it('returns "unknown" for moves not in the response', () => {
    const r = gradeMove('fen-before', winningResp, 'a1a2');
    expect(r.grade).toBe('unknown');
  });
});
