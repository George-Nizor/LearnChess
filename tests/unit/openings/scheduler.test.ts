import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  DEFAULT_EASE,
  MIN_EASE,
  freshSrsState,
  isDue,
  masteryOf,
  onCorrect,
  onWrong,
  STEP_MINUTES,
} from '@/openings/scheduler';
import type { RepMove } from '@/openings/types';

const NOW = 1_700_000_000_000;

function freshOwnMove(over: Partial<RepMove> = {}): RepMove {
  const srs = freshSrsState(NOW);
  return {
    repertoireId: 1,
    fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    toFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
    san: 'e4',
    uci: 'e2e4',
    isOwnMove: true,
    weight: 1,
    deleted: false,
    learningStep: srs.learningStep ?? 0,
    learningDueAt: srs.learningDueAt ?? NOW,
    reviewIntervalDays: srs.reviewIntervalDays ?? null,
    reviewDueAt: srs.reviewDueAt ?? null,
    reviewEase: srs.reviewEase ?? DEFAULT_EASE,
    ...over,
  };
}

describe('SRS — learning phase', () => {
  it('first correct on a fresh own-move advances learning step 0 → 1, due in 10 min', () => {
    const move = freshOwnMove();
    const u = onCorrect(move, NOW);
    expect(u.learningStep).toBe(1);
    expect(u.learningDueAt).toBe(NOW + (STEP_MINUTES[1] ?? 0) * 60_000);
    expect(u.reviewIntervalDays).toBeUndefined();
  });

  it('second correct (step 1 → 2) due in 1 hour', () => {
    const move = freshOwnMove({ learningStep: 1 });
    const u = onCorrect(move, NOW);
    expect(u.learningStep).toBe(2);
    expect(u.learningDueAt).toBe(NOW + (STEP_MINUTES[2] ?? 0) * 60_000);
  });

  it('third correct (step 2 → 3) due in 8 hours', () => {
    const move = freshOwnMove({ learningStep: 2 });
    const u = onCorrect(move, NOW);
    expect(u.learningStep).toBe(3);
    expect(u.learningDueAt).toBe(NOW + (STEP_MINUTES[3] ?? 0) * 60_000);
  });

  it('correct on step 3 graduates to review interval = 1 day', () => {
    const move = freshOwnMove({ learningStep: 3 });
    const u = onCorrect(move, NOW);
    expect(u.learningStep).toBeNull();
    expect(u.learningDueAt).toBeNull();
    expect(u.reviewIntervalDays).toBe(1);
    expect(u.reviewDueAt).toBe(NOW + DAY_MS);
    expect(u.reviewEase).toBe(DEFAULT_EASE);
  });

  it('wrong in learning resets to step 0 + decreases ease', () => {
    const move = freshOwnMove({ learningStep: 2, reviewEase: 2.5 });
    const u = onWrong(move, NOW);
    expect(u.learningStep).toBe(0);
    expect(u.learningDueAt).toBe(NOW);
    expect(u.reviewEase).toBeCloseTo(2.3);
  });
});

describe('SRS — review phase', () => {
  it('correct in review multiplies interval by ease', () => {
    const move = freshOwnMove({
      learningStep: null,
      learningDueAt: null,
      reviewIntervalDays: 4,
      reviewEase: 2.5,
      reviewDueAt: NOW,
    });
    const u = onCorrect(move, NOW);
    expect(u.reviewIntervalDays).toBeCloseTo(10);
    expect(u.reviewDueAt).toBe(NOW + 10 * DAY_MS);
  });

  it('caps review interval at 100 days', () => {
    const move = freshOwnMove({
      learningStep: null,
      learningDueAt: null,
      reviewIntervalDays: 80,
      reviewEase: 2.5,
      reviewDueAt: NOW,
    });
    const u = onCorrect(move, NOW);
    expect(u.reviewIntervalDays).toBe(100);
  });

  it('wrong in deep review (interval > 1) marks for re-graduation, drops ease', () => {
    const move = freshOwnMove({
      learningStep: null,
      learningDueAt: null,
      reviewIntervalDays: 30,
      reviewEase: 2.0,
      reviewDueAt: NOW,
    });
    const u = onWrong(move, NOW);
    expect(u.learningStep).toBeNull();
    expect(u.learningDueAt).toBeNull();
    expect(u.reviewIntervalDays).toBe(0); // sentinel
    expect(u.reviewDueAt).toBe(NOW);
    expect(u.reviewEase).toBeCloseTo(1.8);
  });

  it('wrong in fresh review (interval == 1) bounces back to learning', () => {
    const move = freshOwnMove({
      learningStep: null,
      learningDueAt: null,
      reviewIntervalDays: 1,
      reviewEase: 2.5,
      reviewDueAt: NOW,
    });
    const u = onWrong(move, NOW);
    expect(u.learningStep).toBe(0);
    expect(u.learningDueAt).toBe(NOW);
  });

  it('ease floor is enforced at MIN_EASE after many wrongs', () => {
    let move = freshOwnMove({ reviewEase: DEFAULT_EASE });
    for (let i = 0; i < 20; i++) {
      const u = onWrong(move, NOW);
      move = { ...move, ...u };
    }
    expect(move.reviewEase).toBeGreaterThanOrEqual(MIN_EASE);
  });
});

describe('isDue', () => {
  it('opponent moves are never due', () => {
    const oppMove = freshOwnMove({ isOwnMove: false });
    expect(isDue(oppMove, NOW)).toBe(false);
  });

  it('soft-deleted moves are never due', () => {
    const move = freshOwnMove({ deleted: true });
    expect(isDue(move, NOW)).toBe(false);
  });

  it('own move with learningDueAt in the past is due', () => {
    const move = freshOwnMove({ learningDueAt: NOW - 1000 });
    expect(isDue(move, NOW)).toBe(true);
  });

  it('own move with learningDueAt in the future is NOT due', () => {
    const move = freshOwnMove({ learningDueAt: NOW + 1000 });
    expect(isDue(move, NOW)).toBe(false);
  });

  it('graduated move with reviewDueAt past is due', () => {
    const move = freshOwnMove({
      learningStep: null,
      learningDueAt: null,
      reviewIntervalDays: 7,
      reviewDueAt: NOW - 1,
    });
    expect(isDue(move, NOW)).toBe(true);
  });
});

describe('masteryOf buckets', () => {
  it('learning step → "learning"', () => {
    expect(masteryOf(freshOwnMove({ learningStep: 2 }))).toBe('learning');
  });

  it('graduated short interval → "short"', () => {
    expect(masteryOf(freshOwnMove({
      learningStep: null,
      learningDueAt: null,
      reviewIntervalDays: 3,
    }))).toBe('short');
  });

  it('graduated medium interval → "medium"', () => {
    expect(masteryOf(freshOwnMove({
      learningStep: null,
      learningDueAt: null,
      reviewIntervalDays: 14,
    }))).toBe('medium');
  });

  it('graduated long interval → "long"', () => {
    expect(masteryOf(freshOwnMove({
      learningStep: null,
      learningDueAt: null,
      reviewIntervalDays: 60,
    }))).toBe('long');
  });

  it('opponent move is "unseen"', () => {
    expect(masteryOf(freshOwnMove({ isOwnMove: false }))).toBe('unseen');
  });
});
