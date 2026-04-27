import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';

export type { Color, PieceSymbol, Square } from 'chess.js';
export { Chess } from 'chess.js';

export type Dests = Map<Square, Square[]>;

export interface MoveResult {
  from: Square;
  to: Square;
  san: string;
  uci: string;
  fenAfter: string;
  isCapture: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  promotion?: PieceSymbol;
}

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function newGame(fen: string = STARTING_FEN): Chess {
  return new Chess(fen);
}

export function legalDests(game: Chess): Dests {
  const dests: Dests = new Map();
  for (const move of game.moves({ verbose: true })) {
    const arr = dests.get(move.from) ?? [];
    arr.push(move.to);
    dests.set(move.from, arr);
  }
  return dests;
}

export function turnColor(game: Chess): 'white' | 'black' {
  return game.turn() === 'w' ? 'white' : 'black';
}

export function tryMove(
  game: Chess,
  from: Square,
  to: Square,
  promotion: PieceSymbol = 'q',
): MoveResult | null {
  try {
    const move = game.move({ from, to, promotion });
    return {
      from: move.from,
      to: move.to,
      san: move.san,
      uci: move.from + move.to + (move.promotion ?? ''),
      fenAfter: game.fen(),
      isCapture: move.captured !== undefined,
      isCheck: game.isCheck(),
      isCheckmate: game.isCheckmate(),
      ...(move.promotion !== undefined ? { promotion: move.promotion } : {}),
    };
  } catch {
    return null;
  }
}

export function tryMoveUci(game: Chess, uci: string): MoveResult | null {
  if (uci.length < 4) return null;
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = (uci.length >= 5 ? uci[4] : 'q') as PieceSymbol;
  return tryMove(game, from, to, promotion);
}

export function gameStatus(game: Chess): {
  isOver: boolean;
  result: 'white' | 'black' | 'draw' | null;
  reason: string | null;
} {
  if (!game.isGameOver()) {
    return { isOver: false, result: null, reason: null };
  }
  if (game.isCheckmate()) {
    const winner: 'white' | 'black' = game.turn() === 'w' ? 'black' : 'white';
    return { isOver: true, result: winner, reason: 'checkmate' };
  }
  if (game.isStalemate()) return { isOver: true, result: 'draw', reason: 'stalemate' };
  if (game.isThreefoldRepetition()) return { isOver: true, result: 'draw', reason: 'repetition' };
  if (game.isInsufficientMaterial()) return { isOver: true, result: 'draw', reason: 'insufficient material' };
  if (game.isDraw()) return { isOver: true, result: 'draw', reason: 'fifty-move rule' };
  return { isOver: true, result: 'draw', reason: 'unknown' };
}

export function lastMoveSquares(game: Chess): [Square, Square] | undefined {
  const history = game.history({ verbose: true });
  const last = history[history.length - 1];
  if (!last) return undefined;
  return [last.from, last.to];
}

export function isPromotion(game: Chess, from: Square, to: Square): boolean {
  const piece = game.get(from);
  if (!piece || piece.type !== 'p') return false;
  const toRank = to[1];
  return (piece.color === 'w' && toRank === '8') || (piece.color === 'b' && toRank === '1');
}

const _color: Color = 'w';
void _color;
