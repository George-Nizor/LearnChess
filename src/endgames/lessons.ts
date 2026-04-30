/// <reference types="vitest/importMeta" />
/*
 * Curated prose lessons for endgame Learn mode.
 *
 * Pattern lifted from `src/openings/lessons.ts` — same speech-bubble
 * voice, same FEN validator at the bottom. The conceptual model is
 * borrowed from lichess `lila/modules/practice` (a "study" with a
 * "summary text" per chapter); see `docs/research/competitor-deep-dive.md`
 * §5.1 for the prior-art write-up.
 *
 * Each lesson walks an instructive optimal-or-near-optimal line move by
 * move with one prose node per ply. The intro node has no `san` (it's
 * the starting position); every subsequent node carries the SAN of the
 * move that led to it. Total length stays in the 5–10 node window so
 * the lesson is one bite-sized scroll.
 *
 * Authoring rules (mirrors openings/lessons.ts):
 *   - Intro begins "Let's learn …" — exact template.
 *   - 1-4 sentences per node. Hard cap.
 *   - Move references in **bold** (rendered to <strong> by the bubble).
 *   - One self-aware joke per intro is allowed; don't strain.
 *   - No headings, bullets, or markdown beyond bold.
 *
 * FEN authoring rules:
 *   - Every node's FEN is normalised via `normFen()` so it uses the
 *     same convention as openings — half-move clock + full-move number
 *     stripped.
 *   - All FENs in this file are validated at vitest run time by replaying
 *     the SAN sequence through chess.js and comparing. If a node ever
 *     drifts from `parent + san`, the test fails loudly with the
 *     offending (positionId, ply, san) tuple.
 */

import { Chess } from 'chess.js';
import { normFen } from '@/openings/fen';
import type { EndgameLesson } from './types';

export const ENDGAME_LESSONS: Record<string, EndgameLesson> = {
  // ====================================================================
  // KPK (kpk-001) — winning the opposition.
  // Start: 8/8/8/4k3/8/3K4/3P4/8 w
  // White: K d3, P d2; Black: K e5. White to move.
  // Winning sequence: 1.Ke3 (direct opposition) Kf5 2.Kd4 Kf6 3.d3 Ke6
  //   4.Ke4 Kd6 5.d4 — king escorts the pawn forward.
  // Note: 1.Kd4 is illegal (kings would be adjacent to e5). White MUST
  // start with Ke3 to take direct opposition with black-to-move.
  // 10 nodes total (9 plies + intro).
  // ====================================================================
  'kpk-001': {
    positionId: 'kpk-001',
    title: 'King and Pawn vs King — winning the opposition',
    tagline: 'Push the pawn only when your king has reached the queening square.',
    nodes: [
      {
        fen: normFen('8/8/8/4k3/8/3K4/3P4/8 w - - 0 1'),
        text: "Let's learn the king-and-pawn ending — it looks trivial (one extra pawn, surely we just push it?) but the lone king draws an alarming number of these by parking in front of the pawn. The trick is to lead with the **king**, not the pawn. We need to seize the **opposition** — kings face-to-face an odd number of squares apart, opponent to move — and shoulder Black off the queening square.",
      },
      {
        fen: normFen('8/8/8/4k3/8/4K3/3P4/8 b - - 1 1'),
        san: 'Ke3',
        text: "**1.Ke3** — taking the **direct opposition**. Both kings now stand on the **e-file**, two squares apart, with Black to move. That's textbook opposition: whoever has the move has to step aside, and it's Black's turn.",
      },
      {
        fen: normFen('8/8/8/5k2/8/4K3/3P4/8 w - - 2 2'),
        san: 'Kf5',
        text: "**1...Kf5** — Black has to give way. Stepping right (or left) lets us **outflank** by jumping diagonally to the opposite side. Either retreat loses the same way.",
      },
      {
        fen: normFen('8/8/8/5k2/3K4/8/3P4/8 b - - 3 2'),
        san: 'Kd4',
        text: "**2.Kd4** — the **outflanking** jump. We slide diagonally toward the side Black just abandoned, gaining ground on the queenside while Black's king is stranded on the kingside.",
      },
      {
        fen: normFen('8/8/5k2/8/3K4/8/3P4/8 w - - 4 3'),
        san: 'Kf6',
        text: "**2...Kf6** — Black hurries back to defend the pawn's path. The race is on: can Black's king reach the queening square before our pawn does?",
      },
      {
        fen: normFen('8/8/5k2/8/3K4/3P4/8/8 b - - 0 3'),
        san: 'd3',
        text: "**3.d3** — a useful **waiting move**. The pawn nudges forward one square, our king stays put, and Black has to commit. We're not pushing for tempo; we're pushing because the king has cleared the way.",
      },
      {
        fen: normFen('8/8/4k3/8/3K4/3P4/8/8 w - - 1 4'),
        san: 'Ke6',
        text: "**3...Ke6** — Black tries to take the opposition back by stepping in front of our king. Almost — but it's still our move, and we have a clean way to flip the opposition.",
      },
      {
        fen: normFen('8/8/4k3/8/4K3/3P4/8/8 b - - 2 4'),
        san: 'Ke4',
        text: "**4.Ke4** — direct opposition again, this time with **Black** to move. Same e-file, two squares apart, and Black has to step aside. Watch how our king keeps inching toward the queening square while Black has to retreat.",
      },
      {
        fen: normFen('8/8/3k4/8/4K3/3P4/8/8 w - - 3 5'),
        san: 'Kd6',
        text: "**4...Kd6** — Black gives ground again. With Black off the e-file, the **e5/d5** squares around our pawn are safe for our king to occupy.",
      },
      {
        fen: normFen('8/8/3k4/8/3PK3/8/8/8 b - - 0 5'),
        san: 'd4',
        text: "**5.d4** — finally pushing with full king support. The pawn is shielded by our king on **e4**, and Black's king has been driven away. From here the pawn marches up: **5...Ke6 6.d5+ Kd6 7.Kd4** — and the queening square belongs to White.",
      },
    ],
  },

  // ====================================================================
  // LUCENA (lucena) — building the bridge.
  // Start: 1K1k4/1P6/8/8/8/8/r7/2R5 w
  // White: K b8, P b7, R c1; Black: K d8, R a2.
  // Optimal: 1.Rc4 Ra1 2.Rd4+ Ke7 3.Kc7 Rc1+ 4.Kb6 Rb1+ — and on the
  // next move the bridge interposes (5.Kc6 Rc1+ 6.Rc4!).
  // 9 nodes (8 plies + intro). Stops just before the actual interpose
  // because the prose sells the punchline.
  // ====================================================================
  'lucena': {
    positionId: 'lucena',
    title: 'Lucena Position — building the bridge',
    tagline: 'The bridge is the single most useful trick in rook endgames.',
    nodes: [
      {
        fen: normFen('1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1'),
        text: "Let's learn the **Lucena Position** — the position every rook endgame book opens with, named after Luis Ramirez de Lucena who wrote it down in 1497 (and almost certainly stole it from someone earlier). The pawn is one square from queening but our king is stuck in front of it. The technique is the **bridge**: we use our rook as a shield while the king escapes.",
      },
      {
        fen: normFen('1K1k4/1P6/8/8/2R5/8/r7/8 b - - 1 1'),
        san: 'Rc4',
        text: "**1.Rc4!** — the bridge-building move. The rook drops to the **fourth rank**, exactly where it'll need to be to block checks later. This is THE move of the Lucena: it doesn't look like much, but every other plan fails.",
      },
      {
        fen: normFen('1K1k4/1P6/8/8/2R5/8/8/r7 w - - 2 2'),
        san: 'Ra1',
        text: "**1...Ra1** — Black has nothing better than to wait. The black king is paralysed (it can't approach the b7-pawn or get checked into oblivion), so the rook just shuffles.",
      },
      {
        fen: normFen('1K1k4/1P6/8/8/3R4/8/8/r7 b - - 3 2'),
        san: 'Rd4+',
        text: "**2.Rd4+** — checking with tempo. Black's king must step away from **d8**, which means abandoning the queening square. Wherever it goes, our king has time to crawl out.",
      },
      {
        fen: normFen('1K6/1P2k3/8/8/3R4/8/8/r7 w - - 4 3'),
        san: 'Ke7',
        text: "**2...Ke7** — Black has to move; **e7** keeps the king close enough to threaten the pawn. Now we make our move.",
      },
      {
        fen: normFen('8/1PK1k3/8/8/3R4/8/8/r7 b - - 5 3'),
        san: 'Kc7',
        text: "**3.Kc7** — out of the box! Our king finally escapes the prison of b8. Black's only resource is to start checking — every check will be blocked by our perfectly placed rook on the fourth rank.",
      },
      {
        fen: normFen('8/1PK1k3/8/8/3R4/8/8/2r5 w - - 6 4'),
        san: 'Rc1+',
        text: "**3...Rc1+** — Black checks along the c-file (the rook on **d4** doesn't block this one). Our king has to step away from **c7**, but each step toward **c6** brings us closer to the bridge.",
      },
      {
        fen: normFen('8/1P2k3/1K6/8/3R4/8/8/2r5 b - - 7 4'),
        san: 'Kb6',
        text: "**4.Kb6** — sidestepping the check. Black will check again from **b1**, then we walk to **c6**, and eventually our rook on **d4** plugs the b-file with **Rb4**. The bridge is complete and the pawn promotes.",
      },
      {
        fen: normFen('8/1P2k3/1K6/8/3R4/8/8/1r6 w - - 8 5'),
        san: 'Rb1+',
        text: "**4...Rb1+** — one more check, then the bridge does its work. After **5.Kc6 Rc1+ 6.Rc4!** the rook *interposes* on **c4**, blocking the check while supporting the pawn. Black has no way to stop **b8=Q** next move. You've just queened a pawn from a position that looks impossible. That's the bridge.",
      },
    ],
  },

  // ====================================================================
  // PHILIDOR (philidor) — third-rank defence.
  // Start: 5k2/8/4K3/4P3/r7/8/8/3R4 b
  // White: K e6, P e5, R d1; Black: K f8, R a4. Black to move.
  // Defence: 1...Ra6+! 2.Kd5 Kf7 3.Re1 Ra5+ 4.Kd4 — White can't make
  // progress with rook on rank 6 (or rank 5 once the king retreats).
  // 6 nodes (5 plies + intro). Demonstrates the third-rank-then-checks
  // technique without the back-rank twist (which the prose summarises).
  // ====================================================================
  'philidor': {
    positionId: 'philidor',
    title: 'Philidor Position — third-rank defence',
    tagline: 'Rook on the third rank until the pawn moves; then check from behind.',
    nodes: [
      {
        fen: normFen('5k2/8/4K3/4P3/r7/8/8/3R4 b - - 0 1'),
        text: "Let's learn the **Philidor Position** — the defensive twin of Lucena, named after François-André Danican Philidor (yes, the same Philidor who said the pawns are the soul of chess). The white pawn is on **e5**, one rank away from the magic sixth. Our defensive rule is brutally simple: **rook on the third rank until the pawn advances**, then check from behind.",
      },
      {
        fen: normFen('5k2/8/r3K3/4P3/8/8/8/3R4 w - - 1 2'),
        san: 'Ra6+',
        text: "**1...Ra6+!** — the rook lifts to the **sixth rank** (which is the third rank from Black's perspective). This is the entire idea of the Philidor defence: the rook denies the white king any approach square while the pawn is still on **e5**. Without king support, the pawn can never safely advance.",
      },
      {
        fen: normFen('5k2/8/r7/3KP3/8/8/8/3R4 b - - 2 2'),
        san: 'Kd5',
        text: "**2.Kd5** — White can't stay on rank 6 (the rook attacks the whole rank), so the king retreats. We've already won the defensive argument: any time White tries to push, the **e5-pawn** has no escort.",
      },
      {
        fen: normFen('8/5k2/r7/3KP3/8/8/8/3R4 w - - 3 3'),
        san: 'Kf7',
        text: "**2...Kf7** — Black centralises. Bringing the king close serves two roles: blocking the pawn's path and supporting the rook for the back-rank checks if White ever pushes.",
      },
      {
        fen: normFen('8/5k2/r7/3KP3/8/8/8/4R3 b - - 4 3'),
        san: 'Re1',
        text: "**3.Re1** — White shuffles the rook, hoping for a tempo. We just keep the third-rank rook in place and wait. If White ever plays **e6+**, we drop the rook to **a1** and check the king to death from behind.",
      },
      {
        fen: normFen('8/5k2/8/r2KP3/8/8/8/4R3 w - - 5 4'),
        san: 'Ra5+',
        text: "**3...Ra5+** — checking back. With the white king on **d5**, our rook delivers a side-check that gains a tempo and shows White can't make progress. After any retreat (say **4.Kd4**), Black plays **Ra6** again and we're back to the third-rank fortress. The position is a textbook draw — Philidor's contribution to chess endings, more than two centuries old and still bulletproof.",
      },
    ],
  },

  // ====================================================================
  // KQK (kqk-001) — basic mate.
  // Start: 8/8/8/4k3/8/8/4K3/4Q3 w
  // White: K e2, Q e1; Black: K e5.
  // Confining technique: 1.Qb4 (rank-4 cordon) Ke6
  //   2.Kd3 Kf7 3.Qd4 Ke8 — herding toward the back rank.
  // (Kd6/Ke7 are illegal after 1.Qb4 because the b4-f8 diagonal locks
  // them out; Kd7 illegal after 3.Qd4 because the d-file is sealed.)
  // 7 nodes (6 plies + intro). Lesson explains the mating principle in
  // the closing prose rather than playing all the way out.
  // ====================================================================
  'kqk-001': {
    positionId: 'kqk-001',
    title: 'King and Queen vs King — basic mate',
    tagline: "Herd with the queen, mate with the king's help.",
    nodes: [
      {
        fen: normFen('8/8/8/4k3/8/8/4K3/4Q3 w - - 0 1'),
        text: "Let's learn the **king-and-queen mate** — the first mate every player learns, and the one most often botched into stalemate. The technique: keep the queen at a **safe distance** from the lone king, march your own king up to support, and herd the lone king to the edge of the board. Never let the queen come too close, or you'll stalemate by accident.",
      },
      {
        fen: normFen('8/8/8/4k3/1Q6/8/4K3/8 b - - 1 1'),
        san: 'Qb4',
        text: "**1.Qb4** — the queen swings to a **safe square** on the 4th rank. From **b4** the queen rakes the entire 4th rank (taking away **d4, e4, f4**), the b-file, and a long diagonal — without coming anywhere near the lone king. Black's king is now confined to ranks 5-8.",
      },
      {
        fen: normFen('8/8/4k3/8/1Q6/8/4K3/8 w - - 2 2'),
        san: 'Ke6',
        text: "**1...Ke6** — Black retreats. The lone king has no good moves: every attempt to come down to rank 4 walks into the queen, and the **b4-f8** diagonal cuts off **d6** too.",
      },
      {
        fen: normFen('8/8/4k3/8/1Q6/3K4/8/8 b - - 3 2'),
        san: 'Kd3',
        text: "**2.Kd3** — bring our king up. The queen does the herding; the king does the **escorting**. Without our king's help, the queen can never deliver mate (and might stalemate trying).",
      },
      {
        fen: normFen('8/5k2/8/8/1Q6/3K4/8/8 w - - 4 3'),
        san: 'Kf7',
        text: "**2...Kf7** — Black retreats further (the **b4-f8** diagonal still cuts off **e7** and **d6**). The lone king has the ridiculous task of running from a queen + king team; sooner or later it hits an edge.",
      },
      {
        fen: normFen('8/5k2/8/8/3Q4/3K4/8/8 b - - 5 3'),
        san: 'Qd4',
        text: "**3.Qd4** — re-applying the grip from a square closer to the king. Watch how the queen NEVER moves to a square adjacent to the lone king — that would either stalemate or lose the queen.",
      },
      {
        fen: normFen('4k3/8/8/8/3Q4/3K4/8/8 w - - 6 4'),
        san: 'Ke8',
        text: "**3...Ke8** — Black runs for the back rank (the **f6/g7** diagonal of our queen is now toxic too). From here the technique repeats: queen at a safe distance, king walks up, until the lone king is fully boxed in on the edge. A typical mate: queen pins the king on the back rank while our king controls the escape squares — for example **Qd8#** with our king on **e6**. Always count squares before each queen move; if the lone king has zero legal moves and isn't in check, that's stalemate (not mate), and you've blown a winning position.",
      },
    ],
  },

  // ====================================================================
  // KRK (krk-001) — box-and-ladder mate.
  // Start: 8/8/8/4k3/8/8/4K3/4R3 w
  // White: K e2, R e1; Black: K e5.
  // Sequence: 1.Rb1 Kd5 2.Rb5+ Kc6 3.Ke3 Kc7 4.Kd4 — king escort builds
  // the box; rook cuts off the rank as soon as it's safe.
  // 8 nodes (7 plies + intro).
  // ====================================================================
  'krk-001': {
    positionId: 'krk-001',
    title: 'King and Rook vs King — box and ladder',
    tagline: 'Cut the king off with the rook; walk yours up; shrink the box.',
    nodes: [
      {
        fen: normFen('8/8/8/4k3/8/8/4K3/4R3 w - - 0 1'),
        text: "Let's learn the **king-and-rook mate** — slower than the queen mate (no knight's-move shortcut), but the technique is geometric and reliable. The plan: the rook **cuts off** a rank or file, the lone king is trapped on one side of the line, then our king walks up to drive it to the edge. The book calls it the **ladder mate** for a reason.",
      },
      {
        fen: normFen('8/8/8/4k3/8/8/4K3/1R6 b - - 1 1'),
        san: 'Rb1',
        text: "**1.Rb1** — moving the rook out of our king's way first. From the e-file the rook was tripping over our own king on **e2**. On the b-file it has a clear shot at **rank 5** as soon as it's needed.",
      },
      {
        fen: normFen('8/8/8/3k4/8/8/4K3/1R6 w - - 2 2'),
        san: 'Kd5',
        text: "**1...Kd5** — Black centralises. The lone king has no targets, so it just tries to claim as much space as possible.",
      },
      {
        fen: normFen('8/8/8/1R1k4/8/8/4K3/8 b - - 3 2'),
        san: 'Rb5+',
        text: "**2.Rb5+** — the **cut-off** check. The rook drops to **rank 5**, slicing the board in two: the lone king is now exiled to ranks 6-8. We don't need to chase the king with the rook; we need to chase it with our **own king**, using the rook as a fence.",
      },
      {
        fen: normFen('8/8/2k5/1R6/8/8/4K3/8 w - - 4 3'),
        san: 'Kc6',
        text: "**2...Kc6** — Black has to come off the 5th rank (the rook attacked it). Whichever way Black runs, our king walks toward it and the box shrinks.",
      },
      {
        fen: normFen('8/8/2k5/1R6/8/4K3/8/8 b - - 5 3'),
        san: 'Ke3',
        text: "**3.Ke3** — escorting the rook. The king and rook together can drive the lone king; alone, the rook can only check (and a king can dodge a single rook forever).",
      },
      {
        fen: normFen('8/2k5/8/1R6/8/4K3/8/8 w - - 6 4'),
        san: 'Kc7',
        text: "**3...Kc7** — the lone king sidesteps further away. Doesn't matter where it goes; the noose tightens either way.",
      },
      {
        fen: normFen('8/2k5/8/1R6/3K4/8/8/8 b - - 7 4'),
        san: 'Kd4',
        text: "**4.Kd4** — sliding our king toward Black's. Repeat: walk the king up, slide the rook one rank closer when safe, walk the king up. Eventually Black's king hits the back rank and is mated by **Rb8#** with our king on **c6** controlling the escape squares.",
      },
    ],
  },
};

export function endgameLessonFor(positionId: string): EndgameLesson | undefined {
  return ENDGAME_LESSONS[positionId];
}

// ====================================================================
// Self-validation — re-derives every node's FEN from chess.js and
// asserts it equals the hand-authored FEN. Runs only inside vitest
// (the `import.meta.vitest` guard is the standard Vite idiom and is
// stripped from production bundles by Vite). If a node ever drifts
// from `parent + san`, the test fails loudly with the offending
// (positionId, ply, san) tuple.
// ====================================================================
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe('ENDGAME_LESSONS — every node FEN matches chess.js replay of SAN', () => {
    for (const lesson of Object.values(ENDGAME_LESSONS)) {
      it(`${lesson.positionId} replays cleanly`, () => {
        const game = new Chess(lesson.nodes[0]!.fen);
        expect(normFen(game.fen())).toBe(lesson.nodes[0]!.fen);
        expect(lesson.nodes[0]!.san).toBeUndefined();

        for (let i = 1; i < lesson.nodes.length; i++) {
          const node = lesson.nodes[i]!;
          expect(node.san, `node ${i} of ${lesson.positionId} must have san`).toBeDefined();
          // chess.js throws on illegal SAN, which is itself a useful failure mode.
          game.move(node.san!);
          const expected = normFen(game.fen());
          expect(
            expected,
            `node ${i} of ${lesson.positionId} (san=${node.san}): expected ${expected} but lesson has ${node.fen}`,
          ).toBe(node.fen);
        }
      });
    }
  });

  describe('ENDGAME_LESSONS — content sanity', () => {
    for (const lesson of Object.values(ENDGAME_LESSONS)) {
      it(`${lesson.positionId} intro starts with "Let's learn"`, () => {
        expect(lesson.nodes[0]!.text.startsWith("Let's learn")).toBe(true);
      });
      it(`${lesson.positionId} has 5-10 nodes`, () => {
        expect(lesson.nodes.length).toBeGreaterThanOrEqual(5);
        expect(lesson.nodes.length).toBeLessThanOrEqual(10);
      });
      it(`${lesson.positionId} every node text is 1-4 sentences`, () => {
        for (const [i, node] of lesson.nodes.entries()) {
          const sentenceish = node.text.split(/[.!?](?=\s|$)/).filter((s) => s.trim().length > 0);
          expect(
            sentenceish.length,
            `node ${i} of ${lesson.positionId} has ${sentenceish.length} sentences (expected 1-4)`,
          ).toBeLessThanOrEqual(4);
          expect(sentenceish.length).toBeGreaterThanOrEqual(1);
        }
      });
    }
  });
}
