/*
 * Endgame curriculum — five courses grouped by piece-set category.
 *
 * Pattern lifted from lichess `lila/modules/practice`: a "study" is a
 * named container of "chapters" (positions). We don't move the position
 * data — `src/chess/endgames/positions.ts` stays canonical and is
 * REFERENCED here only. That keeps the tablebase tests, FEN validation,
 * and historical attempt records (`endgameAttempts.positionId`) stable.
 *
 * Course order roughly tracks pedagogical difficulty (lone king mates →
 * structural pawn endings → rook endgames → minor-piece nuance →
 * miscellaneous fortresses). Within a course, simpler/foundational
 * positions come first; each lesson explicitly bridges to the next.
 */

import { ENDGAMES, type EndgamePosition } from '@/chess/endgames/positions';
import type { EndgameCourse } from './types';

interface CourseSpec {
  id: string;
  name: string;
  description: string;
  category: EndgamePosition['category'];
}

const COURSE_SPECS: readonly CourseSpec[] = [
  {
    id: 'pawn-endgames',
    name: 'Pawn endgames',
    description: 'Opposition, triangulation, and the small structural calculations that decide every other endgame.',
    category: 'pawn',
  },
  {
    id: 'rook-endgames',
    name: 'Rook endgames',
    description: 'The most common endgame in practice. Master Lucena and Philidor first; everything else is variation.',
    category: 'rook',
  },
  {
    id: 'minor-piece-endgames',
    name: 'Minor-piece endgames',
    description: 'Bishop vs knight tradeoffs, opposite-coloured-bishop draws, and the famous bishop+knight mate.',
    category: 'minor',
  },
  {
    id: 'queen-endgames',
    name: 'Queen endgames',
    description: 'Lone-king mates, queen-vs-pawn races, and queen-vs-rook conversion technique.',
    category: 'queen',
  },
  {
    id: 'misc-endgames',
    name: 'Miscellaneous endgames',
    description: 'Studies, mutual zugzwangs, and other edge cases that resist neat categorisation.',
    category: 'misc',
  },
] as const;

/** All curated endgame courses, in pedagogical order. */
export const ENDGAME_COURSES: readonly EndgameCourse[] = COURSE_SPECS.map((spec) => ({
  ...spec,
  positions: ENDGAMES.filter((p) => p.category === spec.category),
})).filter((c): c is EndgameCourse => c.positions.length > 0);

export function courseById(id: string): EndgameCourse | undefined {
  return ENDGAME_COURSES.find((c) => c.id === id);
}

/** Find which course owns a given position id. Returns `undefined` if the
 *  position is not in any curated course (e.g. removed from the curriculum). */
export function courseForPosition(positionId: string): EndgameCourse | undefined {
  return ENDGAME_COURSES.find((c) => c.positions.some((p) => p.id === positionId));
}
