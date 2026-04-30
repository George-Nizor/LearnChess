/*
 * FEN normalisation for use as a graph edge key.
 *
 * A standard FEN has 6 fields: piece placement, side to move, castling,
 * en passant, half-move clock, full-move number. The last two fields are
 * irrelevant for transposition identity — they record path history, not
 * position state.
 *
 * Example: `r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3`
 *   → normalised: `r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -`
 *
 * Two positions reached by different move orders end up with the same
 * normalised FEN, so the move table dedupes transpositions automatically.
 */

export function normFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export const STARTING_FEN_NORM = normFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

/** Returns 'w' or 'b' from a normalised or full FEN. */
export function sideToMoveOf(fen: string): 'w' | 'b' {
  const parts = fen.split(' ');
  return parts[1] === 'b' ? 'b' : 'w';
}
