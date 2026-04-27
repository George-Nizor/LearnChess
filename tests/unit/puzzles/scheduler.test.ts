import { describe, expect, it } from 'vitest';
import { DEFAULT_EASE, DAY_MS, MIN_EASE, isDue, nextCard } from '@/puzzles/scheduler';

describe('SR scheduler', () => {
  it('first "good" review schedules 1 day out', () => {
    const card = nextCard({ puzzleId: 'p1', grade: 'good', now: 0 });
    expect(card.repetitions).toBe(1);
    expect(card.intervalDays).toBe(1);
    expect(card.dueAt).toBe(DAY_MS);
    expect(card.easeFactor).toBeCloseTo(DEFAULT_EASE);
  });

  it('first "easy" jumps to 4 days', () => {
    const card = nextCard({ puzzleId: 'p1', grade: 'easy', now: 0 });
    expect(card.intervalDays).toBe(4);
    expect(card.easeFactor).toBeGreaterThan(DEFAULT_EASE);
  });

  it('"again" resets repetitions and interval', () => {
    const initial = nextCard({ puzzleId: 'p1', grade: 'good', now: 0 });
    const after = nextCard({ card: initial, puzzleId: 'p1', grade: 'again', now: DAY_MS });
    expect(after.repetitions).toBe(0);
    expect(after.intervalDays).toBe(0);
    expect(after.easeFactor).toBeLessThan(initial.easeFactor);
  });

  it('ease floor is enforced at MIN_EASE', () => {
    let card = nextCard({ puzzleId: 'p1', grade: 'again', now: 0 });
    for (let i = 0; i < 20; i++) {
      card = nextCard({ card, puzzleId: 'p1', grade: 'again', now: i * DAY_MS });
    }
    expect(card.easeFactor).toBeGreaterThanOrEqual(MIN_EASE);
  });

  it('mature cards expand by ease factor', () => {
    let card = nextCard({ puzzleId: 'p1', grade: 'good', now: 0 });
    card = nextCard({ card, puzzleId: 'p1', grade: 'good', now: DAY_MS });
    expect(card.intervalDays).toBe(6);
    card = nextCard({ card, puzzleId: 'p1', grade: 'good', now: 7 * DAY_MS });
    expect(card.intervalDays).toBe(Math.round(6 * card.easeFactor));
  });

  it('isDue is true for cards past their dueAt', () => {
    const c = nextCard({ puzzleId: 'p1', grade: 'good', now: 0 });
    expect(isDue(c, DAY_MS - 1)).toBe(false);
    expect(isDue(c, DAY_MS)).toBe(true);
    expect(isDue(c, DAY_MS + 1)).toBe(true);
  });
});
