/*
 * Glicko-1 lite — simplified rating system for puzzle/endgame progress.
 *
 * Why not raw Elo: Elo doesn't track confidence (RD), so a brand-new user
 * rated 1500 looks identical to one who's solved 500 puzzles. Glicko adds a
 * deviation that shrinks as you play, so early rating swings are large and
 * later ones are damped.
 *
 * Why not Glicko-2: G2 adds a volatility parameter that needs careful tuning.
 * For per-puzzle updates that we want to be deterministic and reviewable,
 * Glicko-1 is the sweet spot.
 *
 * Reference: http://www.glicko.net/glicko/glicko.pdf
 */

const Q = Math.log(10) / 400;

export interface RatingState {
  rating: number;
  rd: number;
}

export const INITIAL_USER_RATING: RatingState = { rating: 1500, rd: 350 };

function gFn(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));
}

function expectedScore(userRating: number, puzzleRating: number, puzzleRd: number): number {
  const g = gFn(puzzleRd);
  return 1 / (1 + Math.pow(10, (-g * (userRating - puzzleRating)) / 400));
}

/**
 * Update user rating after a single puzzle attempt.
 * `outcome`: 1 = solved, 0 = failed, 0.5 = partial credit (e.g. solved with hint).
 */
export function updateRating(
  user: RatingState,
  puzzleRating: number,
  puzzleRd: number,
  outcome: 0 | 0.5 | 1,
): RatingState {
  const g = gFn(puzzleRd);
  const eRaw = expectedScore(user.rating, puzzleRating, puzzleRd);
  // Clamp e away from 0/1 to avoid dSquared → Infinity at extreme rating gaps
  const e = Math.max(1e-6, Math.min(1 - 1e-6, eRaw));
  const dSquared = 1 / (Q * Q * g * g * e * (1 - e));
  const denom = 1 / (user.rd * user.rd) + 1 / dSquared;

  const newRating = user.rating + (Q / denom) * g * (outcome - e);
  const newRdSquared = 1 / denom;
  const newRd = Math.max(50, Math.min(350, Math.sqrt(newRdSquared)));

  return { rating: Math.round(newRating), rd: Math.round(newRd) };
}

export function ratingBand(rating: number): string {
  if (rating < 1000) return 'beginner';
  if (rating < 1400) return 'novice';
  if (rating < 1700) return 'intermediate';
  if (rating < 2000) return 'advanced';
  if (rating < 2300) return 'expert';
  return 'master';
}
