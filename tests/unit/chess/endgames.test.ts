import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { ENDGAMES, endgameById } from '@/chess/endgames/positions';

function pieceCount(fen: string): number {
  return fen.split(' ')[0]!.replace(/[^a-zA-Z]/g, '').length;
}

describe('Endgame positions', () => {
  it('every position parses as a legal FEN', () => {
    for (const p of ENDGAMES) {
      expect(() => new Chess(p.fen)).not.toThrow();
    }
  });

  it('every position is at most 7 pieces (within Syzygy 7-man coverage)', () => {
    for (const p of ENDGAMES) {
      expect(pieceCount(p.fen), `${p.id} (${p.name})`).toBeLessThanOrEqual(7);
    }
  });

  it('side-to-move in FEN matches declared side', () => {
    for (const p of ENDGAMES) {
      const game = new Chess(p.fen);
      expect(game.turn(), `${p.id}: declared side ${p.side}, FEN turn ${game.turn()}`).toBe(p.side);
    }
  });

  it('endgameById returns the matching position', () => {
    expect(endgameById('lucena')?.category).toBe('rook');
    expect(endgameById('does-not-exist')).toBeUndefined();
  });
});
