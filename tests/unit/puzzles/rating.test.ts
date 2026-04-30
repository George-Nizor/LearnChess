import { describe, expect, it } from 'vitest';
import { INITIAL_USER_RATING, ratingBand, updateRating } from '@/puzzles/rating';

describe('Glicko-lite rating', () => {
  it('starts at 1500 ± 350', () => {
    expect(INITIAL_USER_RATING.rating).toBe(1500);
    expect(INITIAL_USER_RATING.rd).toBe(350);
  });

  it('rating increases on a win', () => {
    const after = updateRating(INITIAL_USER_RATING, 1500, 50, 1);
    expect(after.rating).toBeGreaterThan(1500);
    expect(after.rd).toBeLessThan(350);
  });

  it('rating decreases on a loss', () => {
    const after = updateRating(INITIAL_USER_RATING, 1500, 50, 0);
    expect(after.rating).toBeLessThan(1500);
  });

  it('beating a much higher-rated puzzle moves rating more', () => {
    const easy = updateRating(INITIAL_USER_RATING, 1200, 50, 1);
    const hard = updateRating(INITIAL_USER_RATING, 1900, 50, 1);
    expect(hard.rating - 1500).toBeGreaterThan(easy.rating - 1500);
  });

  it('rating deviation has a floor (>= 50)', () => {
    let user = INITIAL_USER_RATING;
    for (let i = 0; i < 200; i++) user = updateRating(user, 1500, 50, 1);
    expect(user.rd).toBeGreaterThanOrEqual(50);
  });

  it('partial credit moves rating less than a full win', () => {
    const partial = updateRating(INITIAL_USER_RATING, 1500, 50, 0.5);
    const full = updateRating(INITIAL_USER_RATING, 1500, 50, 1);
    expect(full.rating - 1500).toBeGreaterThan(partial.rating - 1500);
  });

  it('ratingBand maps to descriptive labels', () => {
    expect(ratingBand(800)).toBe('beginner');
    expect(ratingBand(1300)).toBe('novice');
    expect(ratingBand(1600)).toBe('intermediate');
    expect(ratingBand(1900)).toBe('advanced');
    expect(ratingBand(2200)).toBe('expert');
    expect(ratingBand(2400)).toBe('master');
  });
});
