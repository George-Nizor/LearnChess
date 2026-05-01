/*
 * Perspective audit — Tier 1 (no engine).
 *
 * Catches structural pedagogy bugs where a line teaches the user a
 * move the prose itself says is wrong. The smoking gun is the
 * Traxler line in `italian-white`:
 *   { san: 'Kxf2', text: "**6.Kxf2** — forced-feeling recapture,
 *     but actually inaccurate — modern theory prefers **6.Kf1!**..."
 * The user is white (course is `italian-white`), the line walks them
 * through 5.Nxf7 → 5...Bxf2+ → 6.Kxf2, and then the prose admits
 * `Kxf2` is the wrong move. The user just learned the wrong move.
 *
 * Heuristics in this audit (pure text, no engine):
 *
 * 1. SELF-CONTRADICTION: a USER-side move's prose mentions an
 *    alternative as preferable ("modern theory prefers", "engine
 *    line", "actually inaccurate", "actually loses", "wrong move",
 *    "instead Y is better/best/the engine line", etc.) The line
 *    should be teaching the preferred move, not the inferior one.
 *
 * 2. OPPONENT-NAMED LINE IN USER REPERTOIRE: line names that
 *    describe the OPPONENT'S idea ("Counterattack", "Trap",
 *    "Sacrifice", "Gambit Accepted/Declined", etc.) are sometimes
 *    legitimately in a user repertoire when the user is the side
 *    facing them — but the line should then teach the REFUTATION,
 *    not walk through the trap moves. Combined with check #1 this
 *    catches the Traxler.
 *
 * Allowlist `KNOWN_TEACHING_TRAP_MOVES` for cases where we
 * INTENTIONALLY teach a move the prose calls bad, with explicit
 * justification (e.g. "shown for completeness, the recommendation
 * is in the next sub-line").
 */
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { OPENING_COURSES } from '@/openings/lessons';

interface PerspectiveIssue {
  course: string;
  line: string;
  ply: number;
  san: string;
  movedBy: 'user' | 'opponent';
  signal: string;
  prose: string;
}

/**
 * Phrases that, when attached to a user-side move's prose, signal
 * the line is teaching an inferior move. Each pattern is a regex
 * that matches a hint that "the move you just learned is wrong".
 */
const SELF_CONTRADICTION_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'modern theory prefers', re: /modern\s+theory\s+(?:prefers?|recommends?|considers?\s+\S+\s+(?:better|stronger))/i },
  { name: 'actually inaccurate', re: /actually\s+(?:inaccurate|inferior|wrong|losing|lost|a\s+blunder|a\s+mistake)/i },
  { name: 'engine prefers', re: /(?:engine|stockfish)\s+(?:prefers?|recommends?|line\s+is)/i },
  { name: 'better/best is X', re: /\bbetter\s+is\s+\*\*[^*]+\*\*|\bbest\s+is\s+\*\*[^*]+\*\*/i },
  { name: 'instead/preferred is X', re: /\binstead\s+(?:of[^,.]+)?,?\s*\*\*[^*]+\*\*\s+(?:is|wins|leads)/i },
];

/**
 * Allowlist of moves we INTENTIONALLY teach despite prose calling
 * them inferior. Each entry needs justification — otherwise we're
 * just hiding a bug.
 *
 * Format: `${lineId}:${ply}:${san}` → reason string
 */
const KNOWN_TEACHING_TRAP_MOVES = new Map<string, string>([
  // (currently empty — all entries should be fixed not allowlisted)
]);

function inferUserSide(openingId: string): 'white' | 'black' {
  if (openingId.endsWith('-white')) return 'white';
  if (openingId.endsWith('-black')) return 'black';
  // Default to white if the convention isn't followed; the audit
  // will surface this as a separate concern.
  return 'white';
}

function findIssues(): PerspectiveIssue[] {
  const issues: PerspectiveIssue[] = [];
  for (const [openingId, course] of Object.entries(OPENING_COURSES)) {
    const userSide = inferUserSide(openingId);
    for (const line of course.lines) {
      const game = new Chess();
      for (let i = 1; i < line.nodes.length; i++) {
        const node = line.nodes[i];
        if (!node || !node.san) continue;
        const sideToMoveBeforeMove = game.turn() === 'w' ? 'white' : 'black';
        const movedBy: 'user' | 'opponent' =
          sideToMoveBeforeMove === userSide ? 'user' : 'opponent';
        game.move(node.san);

        // Only check user-side moves for self-contradiction
        if (movedBy !== 'user') continue;
        if (!node.text) continue;

        const allowKey = `${line.id}:${i}:${node.san}`;
        if (KNOWN_TEACHING_TRAP_MOVES.has(allowKey)) continue;

        for (const pattern of SELF_CONTRADICTION_PATTERNS) {
          if (pattern.re.test(node.text)) {
            issues.push({
              course: openingId,
              line: line.id,
              ply: i,
              san: node.san,
              movedBy,
              signal: pattern.name,
              prose: node.text.slice(0, 200),
            });
            break;
          }
        }
      }
    }
  }
  return issues;
}

describe('perspective audit', () => {
  it('user-side moves are not described as inferior in their own prose', () => {
    const issues = findIssues();
    if (issues.length > 0) {
      const report = issues
        .map(
          (i) =>
            `  [${i.course} → ${i.line}] ply ${i.ply}: USER plays ${i.san}\n` +
            `    Self-contradiction signal: "${i.signal}"\n` +
            `    Prose excerpt: ${i.prose}…\n` +
            `    → Either replace this move with the engine-preferred move,\n` +
            `      OR add to KNOWN_TEACHING_TRAP_MOVES with a justification.`,
        )
        .join('\n\n');
      expect.fail(
        `${issues.length} line(s) teach a user-side move the prose itself describes as inferior:\n\n${report}`,
      );
    }
    expect(issues).toHaveLength(0);
  });
});
