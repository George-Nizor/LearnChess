/*
 * Plain-English translation of a Lichess Syzygy tablebase verdict for the
 * side-to-move. Used by the Endgames trainer to surface "You are winning ·
 * Mate in 14" instead of raw `category: cursed-win, dtz: 12`.
 *
 * The mapping is from the *current* side-to-move's POV. The Lichess API
 * already reports `category` from that POV (e.g. `loss` means "side to move
 * is losing"), so for the player we invert: when the *opponent* is to move
 * and `category === 'loss'`, the player is winning.
 *
 * `tone` drives the strip background colour:
 *   - good    = player is winning
 *   - neutral = drawn (or a "blessed/cursed" 50-move-rule edge case)
 *   - bad     = player is losing
 *   - unknown = outside tablebase coverage / unparseable category
 */
import type { TbResponse } from './client';

export type VerdictTone = 'good' | 'neutral' | 'bad' | 'unknown';

export interface VerdictText {
  text: string;
  tone: VerdictTone;
}

export function verdictText(
  tb: TbResponse | null,
  _side: 'w' | 'b',
  _goal: 'win' | 'draw',
): VerdictText {
  if (tb === null) {
    return { text: 'Outside tablebase coverage', tone: 'unknown' };
  }

  // The API reports `category` for the side to move. The Endgames trainer
  // calls this helper with the *post-opponent-move* tablebase response, so
  // when it's the player's turn again, "win" means the opponent (the side to
  // move) can win — i.e. the player is losing. Likewise "loss" means the
  // side to move is losing, i.e. the player is winning.
  switch (tb.category) {
    case 'win':
      return { text: 'You are losing', tone: 'bad' };
    case 'cursed-win':
      return {
        text: 'Losing — cursed win for opponent (50-move rule may save you)',
        tone: 'bad',
      };
    case 'loss': {
      const dtm = tb.dtm;
      if (dtm !== null) {
        return { text: `You are winning · Mate in ${Math.abs(dtm)}`, tone: 'good' };
      }
      return { text: 'You are winning', tone: 'good' };
    }
    case 'blessed-loss':
      return {
        text: 'Drawn (blessed loss for opponent — 50-move saves them)',
        tone: 'neutral',
      };
    case 'draw':
      return { text: 'Drawn with best play', tone: 'neutral' };
    case 'maybe-win':
      return { text: 'You are likely losing (tablebase uncertain)', tone: 'bad' };
    case 'maybe-loss':
      return { text: 'You are likely winning (tablebase uncertain)', tone: 'good' };
    default:
      return { text: tb.category, tone: 'unknown' };
  }
}

const TONE_CLASS: Record<VerdictTone, string> = {
  good: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  neutral: 'bg-amber-100 text-amber-900 border-amber-300',
  bad: 'bg-red-100 text-red-900 border-red-300',
  unknown: 'bg-muted text-muted-foreground border-border',
};

export function verdictToneClass(tone: VerdictTone): string {
  return TONE_CLASS[tone];
}
