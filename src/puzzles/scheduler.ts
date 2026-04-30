import type { SrCard } from '@/persistence/db';

/*
 * SM-2-lite spaced repetition scheduler.
 * Original SM-2 (SuperMemo 2) by Piotr Wozniak — proven over decades for
 * vocabulary and recall. We keep the algorithm intact and just simplify the
 * grade input to four buckets:
 *   - 'again' (failed)         → reset interval, reduce ease
 *   - 'hard'  (got it, slow)   → keep interval, slight ease decrease
 *   - 'good'  (correct)        → expand interval per ease
 *   - 'easy'  (instant)        → expand more, ease boost
 *
 * Why SM-2 here vs full Glicko / FSRS:
 *   SM-2 is well understood, deterministic, and you can compute next-review by
 *   hand to verify the scheduler. FSRS is more accurate but needs millions of
 *   reviews to fit. For v1 with hundreds of reviews, SM-2 is plenty.
 */

export type Grade = 'again' | 'hard' | 'good' | 'easy';

export const DEFAULT_EASE = 2.5;
export const MIN_EASE = 1.3;
export const DAY_MS = 86_400_000;

export interface SchedulerInput {
  card?: SrCard;
  puzzleId: string;
  grade: Grade;
  now?: number;
}

export function nextCard({ card, puzzleId, grade, now = Date.now() }: SchedulerInput): SrCard {
  const ease = card?.easeFactor ?? DEFAULT_EASE;
  const reps = card?.repetitions ?? 0;
  const interval = card?.intervalDays ?? 0;

  let nextEase = ease;
  let nextInterval = interval;
  let nextReps = reps;

  switch (grade) {
    case 'again':
      nextReps = 0;
      nextInterval = 0;
      nextEase = Math.max(MIN_EASE, ease - 0.2);
      break;
    case 'hard':
      nextReps = reps + 1;
      nextInterval = nextReps === 1 ? 1 : Math.max(1, Math.round(interval * 1.2));
      nextEase = Math.max(MIN_EASE, ease - 0.15);
      break;
    case 'good':
      nextReps = reps + 1;
      if (nextReps === 1) nextInterval = 1;
      else if (nextReps === 2) nextInterval = 6;
      else nextInterval = Math.max(1, Math.round(interval * ease));
      break;
    case 'easy':
      nextReps = reps + 1;
      if (nextReps === 1) nextInterval = 4;
      else if (nextReps === 2) nextInterval = 10;
      else nextInterval = Math.max(1, Math.round(interval * ease * 1.3));
      nextEase = ease + 0.15;
      break;
  }

  return {
    puzzleId,
    easeFactor: nextEase,
    intervalDays: nextInterval,
    repetitions: nextReps,
    dueAt: now + nextInterval * DAY_MS,
    lastReviewedAt: now,
  };
}

export function isDue(card: SrCard, now = Date.now()): boolean {
  return card.dueAt <= now;
}
