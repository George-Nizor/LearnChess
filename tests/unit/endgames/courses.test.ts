import { describe, expect, it } from 'vitest';
import { ENDGAMES } from '@/chess/endgames/positions';
import {
  ENDGAME_COURSES,
  courseById,
  courseForPosition,
} from '@/endgames/courses';

describe('ENDGAME_COURSES', () => {
  it('groups every curated position into exactly one course', () => {
    const positionsAcrossCourses = ENDGAME_COURSES.flatMap((c) => c.positions);
    expect(positionsAcrossCourses.length).toBe(ENDGAMES.length);
    const ids = new Set(positionsAcrossCourses.map((p) => p.id));
    expect(ids.size).toBe(ENDGAMES.length);
  });

  it('every course has at least one position (empty categories pruned)', () => {
    for (const c of ENDGAME_COURSES) {
      expect(c.positions.length, `${c.id}`).toBeGreaterThan(0);
    }
  });

  it("each course's positions all share its declared category", () => {
    for (const c of ENDGAME_COURSES) {
      for (const p of c.positions) {
        expect(p.category, `${p.id} in course ${c.id}`).toBe(c.category);
      }
    }
  });

  it('REFERENCES (not clones) the underlying ENDGAMES entries', () => {
    // Object identity check — confirms we didn't accidentally deep-copy
    // and so create two sources of truth for the position data.
    for (const c of ENDGAME_COURSES) {
      for (const p of c.positions) {
        expect(ENDGAMES.includes(p), `${p.id}`).toBe(true);
      }
    }
  });

  it('courseById returns the course with that id', () => {
    expect(courseById('pawn-endgames')?.category).toBe('pawn');
    expect(courseById('does-not-exist')).toBeUndefined();
  });

  it('courseForPosition returns the owning course', () => {
    expect(courseForPosition('lucena')?.id).toBe('rook-endgames');
    expect(courseForPosition('kpk-001')?.id).toBe('pawn-endgames');
    expect(courseForPosition('does-not-exist')).toBeUndefined();
  });
});
