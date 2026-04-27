import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { normFen, STARTING_FEN_NORM } from '@/openings/fen';
import {
  OPENING_COURSES,
  courseFor,
  lineForCourse,
  type LessonNode,
} from '@/openings/lessons';

/*
 * Schema and content tests for the multi-line course model. Asserts the
 * structural invariants the UI relies on (every course has at least one
 * line, line ids are unique within a course, every line starts at the
 * standard starting position) and tests the public lookup API
 * (courseFor / lineForCourse).
 *
 * The replay test is LENIENT in the same style as
 * `tests/unit/chess/endgames.test.ts`: collect breakage rather than
 * throwing on the first illegal SAN, fail only if a meaningful number
 * of lines can't be replayed. This is friendlier when authoring lots
 * of new lines at once. (The lessons.ts builder also runs every move
 * through chess.js at module-load, so any illegal SAN throws even before
 * this test runs.)
 */

describe('OPENING_COURSES — schema invariants', () => {
  it('every course has at least one line', () => {
    for (const course of Object.values(OPENING_COURSES)) {
      expect(course.lines.length, `${course.openingId} has no lines`).toBeGreaterThanOrEqual(1);
    }
  });

  it('every course key matches its openingId field', () => {
    for (const [key, course] of Object.entries(OPENING_COURSES)) {
      expect(course.openingId, `key ${key}`).toBe(key);
    }
  });

  it('line ids are unique within each course', () => {
    for (const course of Object.values(OPENING_COURSES)) {
      const ids = course.lines.map((l) => l.id);
      const uniq = new Set(ids);
      expect(uniq.size, `${course.openingId}: duplicate line ids in ${ids.join(', ')}`).toBe(ids.length);
    }
  });

  it("every line's first node FEN is the starting position normalised", () => {
    for (const course of Object.values(OPENING_COURSES)) {
      for (const line of course.lines) {
        expect(line.nodes[0]!.fen, `${course.openingId}/${line.id}`).toBe(STARTING_FEN_NORM);
        expect(line.nodes[0]!.san, `${course.openingId}/${line.id} intro must have no san`).toBeUndefined();
      }
    }
  });
});

describe('OPENING_COURSES — chess.js replay (lenient)', () => {
  it('most lines replay cleanly through chess.js', () => {
    const broken: { courseId: string; lineId: string; ply: number; san: string; reason: string }[] = [];
    let totalLines = 0;
    let cleanLines = 0;
    for (const course of Object.values(OPENING_COURSES)) {
      for (const line of course.lines) {
        totalLines++;
        let lineClean = true;
        const game = new Chess(line.nodes[0]!.fen);
        for (let i = 1; i < line.nodes.length; i++) {
          const node: LessonNode = line.nodes[i]!;
          if (!node.san) {
            broken.push({ courseId: course.openingId, lineId: line.id, ply: i, san: '<missing>', reason: 'no SAN' });
            lineClean = false;
            break;
          }
          try {
            game.move(node.san);
            if (normFen(game.fen()) !== node.fen) {
              broken.push({ courseId: course.openingId, lineId: line.id, ply: i, san: node.san, reason: 'FEN drift after move' });
              lineClean = false;
              break;
            }
          } catch {
            broken.push({ courseId: course.openingId, lineId: line.id, ply: i, san: node.san, reason: 'illegal SAN' });
            lineClean = false;
            break;
          }
        }
        if (lineClean) cleanLines++;
      }
    }
    if (broken.length > 0) {
      // Surface the offenders for easy debugging while still allowing the
      // suite to pass when only a few lines need a fix.
      console.warn('[opening-lessons] broken nodes flagged:', broken);
    }
    // We require at least 80 fully-clean lines — the chessreps-quality
    // breadth target. The whole library should replay without errors;
    // the small slack absorbs the rare drift case.
    expect(cleanLines, `clean ${cleanLines}/${totalLines} lines`).toBeGreaterThanOrEqual(80);
    // And no line should be silently broken — the lenient threshold is for
    // the rare drift case, not authoring carelessness.
    expect(broken.length, `broken nodes:\n${broken.map((b) => `  ${b.courseId}/${b.lineId} ply ${b.ply} san=${b.san}: ${b.reason}`).join('\n')}`).toBe(0);
  });
});

describe('OPENING_COURSES — coverage of curated openings', () => {
  it('covers all top-4 openings the user studies first', () => {
    // These are the must-have multi-line courses promised in the spec.
    // Targets per the chessreps-breadth expansion: Italian 10, Sicilian 12,
    // Caro-Kann 8, Ruy López 10. We require ≥8 here (some slack for
    // future trims).
    const required = ['italian-white', 'sicilian-black', 'carokann-black', 'ruylopez-white'];
    for (const id of required) {
      const c = courseFor(id);
      expect(c, `${id} course missing`).toBeDefined();
      expect(c!.lines.length, `${id} should have at least 8 lines`).toBeGreaterThanOrEqual(8);
    }
  });

  it('every other curated opening has at least one line', () => {
    // Openings beyond the top 4 should still have a single mainline
    // course so every sidebar entry has Learn material.
    const others = ['french-black', 'qgd-white', 'kid-black', 'london-white', 'english-white', 'scandinavian-black', 'pirc-black', 'slav-black', 'vienna-white'];
    for (const id of others) {
      const c = courseFor(id);
      expect(c, `${id} course missing`).toBeDefined();
      expect(c!.lines.length, `${id} should have at least 1 line`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('lookups', () => {
  it('courseFor returns the matching course', () => {
    expect(courseFor('italian-white')?.title).toBe('Italian Game');
    expect(courseFor('does-not-exist')).toBeUndefined();
  });

  it('lineForCourse returns the matching line', () => {
    const giuoco = lineForCourse('italian-white', 'giuoco-piano');
    expect(giuoco?.name).toBe('Giuoco Piano');
    // Unknown line within a known course
    expect(lineForCourse('italian-white', 'does-not-exist')).toBeUndefined();
    // Unknown course
    expect(lineForCourse('does-not-exist', 'giuoco-piano')).toBeUndefined();
  });
});
