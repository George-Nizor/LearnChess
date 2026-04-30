/*
 * SM-2-lite SRS scheduler for opening repertoire moves.
 *
 * Lifted (almost verbatim) from chessdriller's API:
 *   github.com/gtim/chessdriller/blob/main/src/routes/api/study/move/+server.js
 *
 * Two phases:
 *   1. LEARNING — sub-day, step-based. Learning steps in minutes:
 *        [0, 10 min, 1 hr, 8 hr]
 *      On correct: advance step. After step 3 + correct: graduate to review.
 *      On wrong: reset to step 0, due immediately.
 *
 *   2. REVIEW — multi-day, multiplicative.
 *      On correct: interval *= ease (default 2.5), capped at 100 days.
 *      On wrong (interval > 1): re-graduate (interval=0 sentinel).
 *      On wrong (interval == 1): bounce back to learning step 0.
 *      Ease decreases by 0.2 (floor 1.3) on every wrong answer.
 */

import type { RepMove } from './types';

export const STEP_MINUTES: readonly number[] = [0, 10, 60, 8 * 60];
export const MAX_REVIEW_INTERVAL_DAYS = 100;
export const DEFAULT_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MIN_MS = 60_000;
export const DAY_MS = 86_400_000;

export type SrsUpdate = Partial<Pick<
  RepMove,
  'learningStep' | 'learningDueAt' | 'reviewIntervalDays' | 'reviewDueAt' | 'reviewEase'
>>;

/** Update an own-move's SRS state after a correct response. */
export function onCorrect(move: RepMove, now: number = Date.now()): SrsUpdate {
  // Currently in the learning phase
  if (move.learningStep !== null) {
    const nextStep = move.learningStep + 1;
    if (nextStep < STEP_MINUTES.length) {
      const stepMin = STEP_MINUTES[nextStep] ?? 0;
      return {
        learningStep: nextStep,
        learningDueAt: now + stepMin * MIN_MS,
      };
    }
    // Graduating from learning to review
    return {
      learningStep: null,
      learningDueAt: null,
      reviewIntervalDays: 1,
      reviewDueAt: now + DAY_MS,
      reviewEase: move.reviewEase || DEFAULT_EASE,
    };
  }

  // Already in review — multiply interval by ease
  if (move.reviewIntervalDays !== null) {
    const ease = move.reviewEase || DEFAULT_EASE;
    // Sentinel 0 means "needs re-graduation" — treat as fresh graduation
    const baseInterval = move.reviewIntervalDays === 0 ? 1 : move.reviewIntervalDays;
    let nextInterval = baseInterval * ease;
    if (nextInterval > MAX_REVIEW_INTERVAL_DAYS) nextInterval = MAX_REVIEW_INTERVAL_DAYS;
    return {
      reviewIntervalDays: nextInterval,
      reviewDueAt: now + nextInterval * DAY_MS,
    };
  }

  // Move had no SRS state at all — initialise as freshly learned step 0
  return {
    learningStep: 0,
    learningDueAt: now,
  };
}

/** Update an own-move's SRS state after a wrong response. */
export function onWrong(move: RepMove, now: number = Date.now()): SrsUpdate {
  const nextEase = Math.max(MIN_EASE, (move.reviewEase || DEFAULT_EASE) - 0.2);

  // In learning OR very fresh review (interval == 1) → reset to learning step 0
  if (move.learningStep !== null || move.reviewIntervalDays === 1) {
    return {
      learningStep: 0,
      learningDueAt: now,
      reviewIntervalDays: null,
      reviewDueAt: null,
      reviewEase: nextEase,
    };
  }

  // In deeper review (interval > 1) → mark for re-graduation, NOT learning reset
  return {
    learningStep: null,
    learningDueAt: null,
    reviewIntervalDays: 0,
    reviewDueAt: now,
    reviewEase: nextEase,
  };
}

/** Is this move currently due to be reviewed? Opponent moves are never due (we don't drill them). */
export function isDue(move: RepMove, now: number = Date.now()): boolean {
  if (!move.isOwnMove || move.deleted) return false;
  if (move.learningDueAt !== null) return move.learningDueAt <= now;
  if (move.reviewDueAt !== null) return move.reviewDueAt <= now;
  // No SRS state at all — never been studied; treat as due
  return true;
}

/** Mastery bucket for UI colour-coding (chessable-style). */
export type MasteryBucket = 'unseen' | 'learning' | 'short' | 'medium' | 'long';

export function masteryOf(move: RepMove): MasteryBucket {
  if (!move.isOwnMove) return 'unseen';
  if (move.learningStep !== null) return 'learning';
  if (move.reviewIntervalDays === null || move.reviewIntervalDays === 0) return 'unseen';
  if (move.reviewIntervalDays < 7) return 'short';
  if (move.reviewIntervalDays < 30) return 'medium';
  return 'long';
}

/** Initial SRS state for a freshly imported own-move (never studied). */
export function freshSrsState(now: number = Date.now()): SrsUpdate {
  return {
    learningStep: 0,
    learningDueAt: now,
    reviewIntervalDays: null,
    reviewDueAt: null,
    reviewEase: DEFAULT_EASE,
  };
}
