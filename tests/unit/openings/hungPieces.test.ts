/*
 * Hung-piece regression test.
 *
 * Sweep every move in OPENING_COURSES and flag any move where the just-
 * moved piece can be captured by the opponent for net material loss
 * after one ply of recaptures. This is the exact pattern that caused
 * the Jobava London Nb5 blunder (2026-05-01) — a knight moved into a
 * square attacked by an unprotected pawn, hanging the knight outright.
 *
 * Heuristic (depth-1 SEE-lite):
 *   netForUs = ownGain - movedPieceValue + bestRecaptureGain
 * Flag when netForUs < 0.
 *
 * Pawn moves are skipped — early-game pawn "hangs" are almost always
 * intentional gambits (Queen's Gambit c4, Vienna Gambit f4, Falkbeer
 * 3...Nxe4 etc.) where the prose explains the compensation.
 *
 * The KNOWN_SACRIFICES allowlist below documents intentional piece
 * sacrifices that the heuristic flags as hangs but are explicit
 * tactical motifs the prose explains. Any new entry needs a comment
 * justifying why it's a sound sacrifice.
 */
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { OPENING_COURSES } from '@/openings/lessons';

const PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
};

interface Hang {
  course: string;
  line: string;
  ply: number;
  san: string;
  fenBefore: string;
}

/**
 * Allowlist of (line-id, ply, san) tuples that are documented sacrifices.
 * Each entry MUST have a comment explaining why it's sound or famous —
 * otherwise it's just hiding a bug.
 */
const KNOWN_SACRIFICES = new Set<string>([
  // Traxler Counterattack: 5...Bxf2+ is the famous Karel Traxler bishop
  // sacrifice from the 1890s. Black drags the king to f2 and follows up
  // with Nxe4+ + Qh4 for a king-hunt. The prose walks through this in
  // detail and notes that 6.Kf1! is the only winning defence.
  'traxler-counterattack:10:Bxf2+',
  // Vienna Falkbeer-style: 3...Nxe4 is the Frankenstein-Dracula tactic.
  // After 4.Nxe4 d5 the bishop AND knight are forked, so Black recovers
  // the piece (5.Bd3 dxe4 6.Bxe4 reaches an equal middlegame). The
  // sacrifice is short-term — depth-1 SEE flags it but full sequence
  // is sound. Prose explains the d5 fork explicitly.
  'vienna-falkbeer:6:Nxe4',
  // Vienna Frankenstein-Dracula full: same 3...Nxe4 sacrifice as the
  // vienna-falkbeer line above (different line walks the deeper move
  // sequence). After 4.Nxe4 d5 the d-pawn forks bishop + knight, Black
  // recovers the piece. Depth-1 SEE flags it but the tactic is sound.
  'vienna-frankenstein-dracula-full:6:Nxe4',
  // Vienna Frankenstein-Dracula full: 6.Nb5! is the documented critical
  // move — Black cannot play 6...Nxb5 because 7.Qxe5+ wins material
  // back (with check, Black cannot defend AND save the knight). Depth-1
  // SEE flags Nb5 as hung but the tactic justifies it. Black's
  // principled reply is 6...g6 attacking the queen, not capturing the
  // knight. Prose explains the threat explicitly.
  'vienna-frankenstein-dracula-full:11:Nb5',
  // Vienna Hamppe-Allgaier 7.Nxf7! — the famous knight sacrifice from
  // 1840s, Black takes (forced or stays a pawn down) and we get a
  // king-hunt with d4 + Bxf4 + Bc4+ + O-O-O. Theoretically equal at
  // engine-precise level, +1.5 to +2.5 in practical play. Documented
  // sacrifice; depth-1 SEE flags it as a hang but the king-hunt is the
  // compensation. Prose walks through the attack explicitly.
  'vienna-hamppe-allgaier:13:Nxf7',
]);

function findHangs(): Hang[] {
  const hangs: Hang[] = [];
  for (const [openingId, course] of Object.entries(OPENING_COURSES)) {
    for (const line of course.lines) {
      const game = new Chess();
      for (let i = 1; i < line.nodes.length; i++) {
        const node = line.nodes[i];
        if (!node || !node.san) continue;
        const fenBefore = game.fen();
        const moveResult = game.move(node.san);
        if (!moveResult) continue;
        if (moveResult.piece === 'p') continue;

        const ownGain = moveResult.captured ? PIECE_VALUES[moveResult.captured] ?? 0 : 0;
        const movedPieceValue = PIECE_VALUES[moveResult.piece] ?? 0;

        const opponentMoves = game.moves({ verbose: true });
        const capturesOnDest = opponentMoves.filter((m) => m.to === moveResult.to && m.captured);
        for (const cap of capturesOnDest) {
          const probe = new Chess(game.fen());
          probe.move(cap.san);
          const ourRecaptures = probe.moves({ verbose: true }).filter((m) => m.to === cap.to);
          const bestRecaptureGain = ourRecaptures.length > 0
            ? Math.max(...ourRecaptures.map((r) => PIECE_VALUES[r.captured ?? 'p'] ?? 0))
            : 0;
          const netForUs = ownGain - movedPieceValue + bestRecaptureGain;
          if (netForUs < 0) {
            const allowKey = `${line.id}:${i}:${node.san}`;
            if (!KNOWN_SACRIFICES.has(allowKey)) {
              hangs.push({
                course: openingId,
                line: line.id,
                ply: i,
                san: node.san,
                fenBefore,
              });
            }
            break;
          }
        }
      }
    }
  }
  return hangs;
}

describe('hung-piece audit', () => {
  it('no minor- or major-piece move hangs material across all opening lines', () => {
    const hangs = findHangs();
    if (hangs.length > 0) {
      const report = hangs
        .map((h) => `  [${h.course} → ${h.line}] ply ${h.ply}: ${h.san}\n    FEN: ${h.fenBefore}`)
        .join('\n');
      expect.fail(
        `${hangs.length} hung-piece blunder(s) detected. Either fix the move or add to KNOWN_SACRIFICES with justification:\n${report}`,
      );
    }
    expect(hangs).toHaveLength(0);
  });
});
