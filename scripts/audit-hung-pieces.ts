#!/usr/bin/env -S node --import tsx
/*
 * audit-hung-pieces.ts — sweep every line in OPENING_COURSES and flag any
 * move where the just-moved piece can be captured by the opponent on the
 * NEXT half-move for less material than the capturing piece. This is the
 * exact pattern that caused the Jobava London Nb5 blunder
 * (https://github.com/George-Nizor/LearnChess — see commit history): the
 * knight moved into a square attacked by an unprotected pawn, hanging
 * the knight outright.
 *
 * Heuristic: after each move, check whether the OPPONENT has a capture
 * targeting the destination square. If they do AND the captured piece is
 * worth more than the capturing piece, flag it as a hung-piece blunder.
 *
 * False-positive guard: skip captures where the moved piece IS defended
 * by another friendly piece — those are ordinary trades, not hangs.
 *
 * Run: ./.dev/wsl-run.sh tsx scripts/audit-hung-pieces.ts
 */

import { Chess } from 'chess.js';
import { OPENING_COURSES } from '../src/openings/lessons';

const PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100, // never trade the king
};

interface Hang {
  course: string;
  line: string;
  ply: number;
  san: string;
  capturedPiece: string;
  capturingPiece: string;
  capturingSan: string;
  fenBefore: string;
}

/**
 * Allowlist of (line-id, ply, san) tuples that are documented sacrifices.
 * Mirrors KNOWN_SACRIFICES in tests/unit/openings/hungPieces.test.ts —
 * keep the two in sync. Each entry needs a comment justifying why the
 * sacrifice is sound or famous.
 */
const KNOWN_SACRIFICES = new Set<string>([
  // Traxler 5...Bxf2+ — famous Karel Traxler bishop sacrifice (1890s).
  // Black drags the king to f2 and follows up with Nxe4+ + Qh4. After
  // 6.Kf1! (the new mainline as of commit 52bba8a) the sacrifice fails
  // and White is just up a piece. Allowlisted because the move IS a
  // sacrifice — the audit's depth-1 SEE can't see the bishop is
  // refused. Prose explains the refutation explicitly.
  'traxler-counterattack:10:Bxf2+',
  // Vienna Falkbeer-style 3...Nxe4 — Frankenstein-Dracula tactic.
  // After 4.Nxe4 d5 the bishop AND knight are forked, so Black recovers
  // the piece. Depth-1 SEE flags the knight as hung but the d5 fork
  // recovers material. Prose walks through the recovery explicitly.
  'vienna-falkbeer:6:Nxe4',
]);

const hangs: Hang[] = [];

for (const [openingId, course] of Object.entries(OPENING_COURSES)) {
  for (const line of course.lines) {
    const game = new Chess();
    // line.nodes[0] is the intro (no move); moves start at index 1
    for (let i = 1; i < line.nodes.length; i++) {
      const node = line.nodes[i];
      if (!node || !node.san) continue;
      const fenBefore = game.fen();
      const moveResult = game.move(node.san);
      if (!moveResult) continue; // shouldn't happen — module load already validated
      // Now it's the opponent's turn. Check captures targeting moveResult.to.
      // What the moving piece won by being played (0 if it was a non-capture)
      const ownGain = moveResult.captured ? PIECE_VALUES[moveResult.captured] ?? 0 : 0;
      const movedPieceValue = PIECE_VALUES[moveResult.piece] ?? 0;

      // Skip pawn moves entirely — pawn "hangs" in the opening are almost
      // always intentional gambits (Queen's Gambit c4, Vienna Gambit f4,
      // Falkbeer ...e4, etc.) where the prose explains the compensation.
      // We only care about minor- and major-piece blunders (the
      // Jobava Nb5 pattern).
      if (moveResult.piece === 'p') continue;

      const opponentMoves = game.moves({ verbose: true });
      const capturesOnDest = opponentMoves.filter((m) => m.to === moveResult.to && m.captured);
      for (const cap of capturesOnDest) {
        // Probe: if opponent captures, can we recapture? What's our gain?
        const probe = new Chess(game.fen());
        probe.move(cap.san);
        const ourRecaptures = probe.moves({ verbose: true }).filter((m) => m.to === cap.to);
        const bestRecaptureGain = ourRecaptures.length > 0
          ? Math.max(...ourRecaptures.map((r) => PIECE_VALUES[r.captured ?? 'p'] ?? 0))
          : 0;
        // Net material for the side that just moved (us):
        //   + what the move itself captured (ownGain)
        //   - what we lose when recaptured (movedPieceValue)
        //   + what we win back (bestRecaptureGain)
        // Note: bestRecaptureGain only counts the FIRST recapture; deeper SEE
        // (static exchange evaluation) would also subtract our recapturer's
        // value if it then gets recaptured. For a "hang" detector this is
        // good enough — real hangs flag at depth 1.
        const netForUs = ownGain - movedPieceValue + bestRecaptureGain;
        if (netForUs < 0) {
          const allowKey = `${line.id}:${i}:${node.san}`;
          if (KNOWN_SACRIFICES.has(allowKey)) break;
          hangs.push({
            course: openingId,
            line: line.id,
            ply: i,
            san: node.san,
            capturedPiece: moveResult.piece,
            capturingPiece: cap.piece,
            capturingSan: cap.san,
            fenBefore,
          });
          break; // one flag per move is enough
        }
      }
    }
  }
}

if (hangs.length === 0) {
  console.log('✓ No hung-piece blunders detected across all opening lines.');
  process.exit(0);
}

console.log(`\n✗ ${hangs.length} hung-piece blunder(s) detected:\n`);
for (const h of hangs) {
  console.log(`  [${h.course} → ${h.line}]  ply ${h.ply}: ${h.san}`);
  console.log(`    ${h.capturedPiece.toUpperCase()} hangs to ${h.capturingPiece.toUpperCase()} via ${h.capturingSan}`);
  console.log(`    FEN before: ${h.fenBefore}`);
  console.log('');
}
process.exit(1);
