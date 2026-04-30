import { describe, expect, it } from 'vitest';
import {
  Chess,
  STARTING_FEN,
  gameStatus,
  isPromotion,
  legalDests,
  newGame,
  tryMove,
  tryMoveUci,
  turnColor,
} from '@/chess/rules';

describe('STARTING_FEN', () => {
  it('parses to a valid starting position', () => {
    const game = new Chess(STARTING_FEN);
    expect(game.turn()).toBe('w');
    expect(game.history()).toHaveLength(0);
  });
});

describe('newGame', () => {
  it('returns a Chess at the standard start position by default', () => {
    expect(newGame().fen()).toBe(STARTING_FEN);
  });

  it('accepts a custom FEN', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    expect(newGame(fen).fen()).toBe(fen);
  });
});

describe('legalDests', () => {
  it('returns 20 source squares of legal moves at the start', () => {
    const dests = legalDests(newGame());
    let totalMoves = 0;
    for (const arr of dests.values()) totalMoves += arr.length;
    expect(totalMoves).toBe(20);
  });

  it('returns no moves for a checkmated side', () => {
    const game = new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(legalDests(game).size).toBe(0);
  });
});

describe('tryMove', () => {
  it('plays a legal move and updates state', () => {
    const game = newGame();
    const result = tryMove(game, 'e2', 'e4');
    expect(result).not.toBeNull();
    expect(result?.san).toBe('e4');
    expect(result?.uci).toBe('e2e4');
    expect(game.turn()).toBe('b');
  });

  it('returns null for an illegal move', () => {
    const game = newGame();
    expect(tryMove(game, 'e2', 'e5')).toBeNull();
    expect(game.turn()).toBe('w');
  });

  it('records captures', () => {
    const game = new Chess('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
    const result = tryMove(game, 'e4', 'd5');
    expect(result?.isCapture).toBe(true);
  });
});

describe('tryMoveUci', () => {
  it('accepts UCI strings without promotion', () => {
    const game = newGame();
    const result = tryMoveUci(game, 'e2e4');
    expect(result?.san).toBe('e4');
  });

  it('accepts UCI strings with promotion', () => {
    const game = new Chess('rnbqkbnr/pppppP1p/8/8/8/8/PPPPP1PP/RNBQKBNR w KQkq - 0 1');
    const result = tryMoveUci(game, 'f7g8q');
    expect(result?.san).toMatch(/Q/);
  });

  it('returns null for malformed UCI', () => {
    expect(tryMoveUci(newGame(), 'e2')).toBeNull();
    expect(tryMoveUci(newGame(), 'xyzw')).toBeNull();
  });
});

describe('gameStatus', () => {
  it('reports an in-progress game', () => {
    expect(gameStatus(newGame()).isOver).toBe(false);
  });

  it('reports checkmate (Fool’s mate)', () => {
    const game = newGame();
    game.move('f3');
    game.move('e5');
    game.move('g4');
    game.move('Qh4');
    const status = gameStatus(game);
    expect(status.isOver).toBe(true);
    expect(status.result).toBe('black');
    expect(status.reason).toBe('checkmate');
  });

  it('reports stalemate as a draw', () => {
    const game = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    const status = gameStatus(game);
    expect(status.isOver).toBe(true);
    expect(status.result).toBe('draw');
    expect(status.reason).toBe('stalemate');
  });
});

describe('turnColor', () => {
  it('maps to chessground colour names', () => {
    const game = newGame();
    expect(turnColor(game)).toBe('white');
    game.move('e4');
    expect(turnColor(game)).toBe('black');
  });
});

describe('isPromotion', () => {
  it('detects pawn promotion squares', () => {
    const game = new Chess('rnbqkbnr/pppppP1p/8/8/8/8/PPPPP1PP/RNBQKBNR w KQkq - 0 1');
    expect(isPromotion(game, 'f7', 'g8')).toBe(true);
    expect(isPromotion(game, 'f7', 'f8')).toBe(true);
  });

  it('returns false for non-pawn moves', () => {
    expect(isPromotion(newGame(), 'g1', 'f3')).toBe(false);
  });
});

describe('FEN round-trips', () => {
  it('preserves FEN through a Chess construction', () => {
    const fens = [
      STARTING_FEN,
      'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      '8/8/8/4k3/4P3/4K3/8/8 b - - 0 1',
      'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
    ];
    for (const fen of fens) {
      expect(new Chess(fen).fen()).toBe(fen);
    }
  });
});
