# Content audit plan — opening course quality assurance

> Why this doc: one-shot agent authoring of 142 opening lines (96
> mainlines + 46 deviations) shipped real bugs that escaped review:
> Jobava London `6.Nb5??` hangs to `axb5`, Evans-d6 `6.Nxe5??` hangs
> to `dxe5`, and the Traxler line in `italian-white` teaches White
> the *inferior* `6.Kxf2` (the prose itself calls it "inaccurate")
> instead of the correct `6.Kf1!`. We need a layered audit that
> catches these classes of bug automatically and surfaces the rest
> for human review.

## What kinds of bugs exist in opening content?

Categorised by detection difficulty:

### Tier 1 — fully automatable (chess.js, no engine)
- **Illegal SAN** — chess.js validates at module load. ✓ already done.
- **Hung pieces (depth-1 SEE)** — a piece moves into a square where
  the opponent wins material on the recapture chain. ✓ done in
  `tests/unit/openings/hungPieces.test.ts` (commit `39129dd`).
- **Tactical-claim mismatch** — prose says "Nxd6+" but the position
  doesn't have check; "Bxh7+" doesn't exist as a legal move; "+0.50
  for White" but the position has a queen hanging.
- **Square-reference consistency** — prose says "the **e5-knight**"
  but no knight is on e5 at that ply.
- **Perspective mismatch** — line is in a `*-white` course (user is
  white) but the line teaches Black's tactical idea / sacrifice
  (e.g. Traxler `Bxf2+` is Black's move; it shouldn't be the
  "user move" of a white-repertoire line).

### Tier 2 — needs Stockfish (deeper but still automatable)
- **Eval-claim mismatch** — prose says "+0.30 for White" but engine
  says "-0.50". Done manually once via
  `scripts/verify-tabiya-evals.md`; needs to become CI-protected.
- **Inferior-move teaching** — line plays move X for the user side
  when engine says move Y is much better (>50cp difference). The
  Traxler `6.Kxf2` vs `6.Kf1!` is exactly this: the line walks the
  user (White) through the inferior move.
- **Mid-line blunders beyond depth-1 SEE** — pieces that look safe
  for one ply but lose material in 2-3 ply combinations.

### Tier 3 — needs theory cross-reference (hard to fully automate)
- **Move popularity** — our chosen mainline is rarely played at
  master level (Lichess Explorer game frequency).
- **Misnamed lines** — "Lasker Defence" labelled on a position
  that isn't actually the Lasker Defence (real Lasker is
  4...Bxb4 5.c3 Ba5 6.O-O d6, our line called it 4...d6).
- **Missing common transpositions** — line claims to be the only
  way to reach a position when other move-orders also reach it.

### Tier 4 — needs human judgement
- **Pedagogy quality** — does the prose actually teach the IDEAS
  (vs. just describe the moves)?
- **Voice consistency** — does the prose use "we/our" for the user
  side and "they/their" for the opponent uniformly?
- **Historical claims** — "Vasja Pirc popularised it in the 1940s"
  — verifying these requires a reputable encyclopedia.

## Layered audit architecture

Every audit is one of:
- a **vitest unit test** that fails CI on regression (Tier 1 tests
  that don't need engine — fast, deterministic),
- a **scripts/audit-*.ts** runner that emits a flagged report (Tier
  2/3 that's slow or non-deterministic; manually invoked or run
  weekly on CI), or
- a **manual review checklist** (Tier 4).

Bugs caught get fixed in source. Known intentional exceptions
(documented sacrifices, named theory moves we deliberately deviate
from) go in an explicit allowlist with justification, NOT a silent
exclusion. The allowlist forces every exception to be defended.

## Phase 1 — Tier 1 audits (no engine, instant CI)

| Audit | Status | File |
|---|---|---|
| Illegal SAN | ✓ done | chess.js validates at module load |
| Hung pieces | ✓ done | `tests/unit/openings/hungPieces.test.ts` |
| Tactical-claim mismatch | TODO | `tests/unit/openings/tacticalClaims.test.ts` |
| Square-reference consistency | TODO | `tests/unit/openings/squareRefs.test.ts` |
| Perspective mismatch | TODO | `tests/unit/openings/perspective.test.ts` |

**Tactical-claim audit**: parse every prose section for "+", "#",
"!", "??" markers attached to a SAN. For each, walk to that ply,
verify the claim:
- "+" → the position after that move has check
- "#" → checkmate
- "??" → engine eval drops > 200cp from best move (TIER 2)
- "Bxh7+" → the move is legal at that ply AND is check

**Square-reference audit**: parse every bold piece reference
(e.g. **Nc3**, **Bd3**) and verify the named piece is actually on
that square at the ply where the prose appears. Catches
hallucinated piece positions ("the e5-knight" when no knight is on
e5).

**Perspective audit**: this is the Traxler-class fix. For each
line, infer the user side from the course's `openingId`
(`*-white` → user=white, `*-black` → user=black). Then for every
USER ply in the line:
1. Verify the move played is among the engine's top-3 choices, OR
2. Verify the line is allowlisted in `KNOWN_INFERIOR_TEACHING` with
   a justification (e.g. "Traxler intentionally walks user through
   the inaccurate Kxf2 to teach the lesson — fix this by switching
   to the safe Bxf7+ refutation").

## Phase 2 — Stockfish-backed audits (slow, run weekly + on content
change)

**Eval-claim audit**: for every prose mention of "+X.XX" or
"-X.XX" or "equal" or "winning", parse the claim, run Stockfish at
depth-22 on the relevant position, compare. Flag mismatches > 50cp.

**Top-N move audit**: for every USER move in every line, run
Stockfish at depth-22 multipv-3, check that the played move appears
in the top-3. If not, flag. The user should not be taught moves
that aren't engine-approved, with the documented sacrifice
allowlist.

**Pipeline**:
1. `scripts/build-eval-baseline.ts` — runs Stockfish on every
   tabiya FEN + every USER move's preceding position, writes
   `tests/fixtures/eval-baseline.json` (cached, committed).
2. `tests/unit/openings/evalAudit.test.ts` — reads the baseline,
   compares to claims in prose. Fast (no engine at test time).
3. CI job runs `build-eval-baseline.ts` weekly OR on content
   changes (path filter on `src/openings/`), commits the diff for
   review.

This pattern keeps the eval data versioned in git (so changes are
reviewable) without requiring Stockfish at every test run.

## Phase 3 — Theory cross-reference (semi-auto, weekly)

**Move-popularity audit**: cross-reference each line against the
Lichess Opening Explorer — for each tabiya position, pull the
top-5 moves at master level. Flag if our line uses a move outside
that top-5.

Caveat: as of April 2026 Lichess Opening Explorer requires auth
for anonymous calls. Either:
- Use the **offline opening book** built from the Lichess PGN
  dump (already a planned data pipeline per `CLAUDE.md`).
- OR use **chessbook.com**'s public theory data via web scrape.
- OR use the puzzle DB's `OpeningTags` field to spot-check
  popular openings.

The offline opening book is the most reliable; ship it as part
of the build pipeline (`scripts/build-opening-book.ts`).

## Phase 4 — Manual review checklists

For each opening course (13 total):
- [ ] Read every tabiya prose: does it teach the IDEAS, not just
      describe the moves?
- [ ] Voice check: "we/our" used for user side throughout?
- [ ] Historical claims: cross-reference with a reputable
      encyclopedia (Hooper & Whyld, Encyclopedia of Chess Openings,
      or chess.com / lichess wiki).
- [ ] Pedagogical sequence: do the lines build on each other? Is
      the simplest line first?

These are 13 × 30-60 min reviews — best done as a dedicated pass
after the automated audits are green.

## Implementation order (recommended)

1. **Phase 1 perspective audit** — catches the Traxler-class
   structural issue. Fast to implement, fixes the most user-
   visible bug class. **(this commit)**
2. **Phase 1 square-reference audit** — catches hallucinated piece
   positions. No engine needed.
3. **Phase 1 tactical-claim audit** — catches "Bxh7+" claims when
   the move isn't check.
4. **Phase 2 eval-baseline pipeline** — biggest investment, most
   trustworthy long-term protection. Run on the cloud server
   (where Stockfish has CPU budget) once a week.
5. **Phase 3 theory cross-reference** — depends on the offline
   opening book pipeline being built.
6. **Phase 4 manual review** — once 1-3 are green.

## What automation cannot do

A perspective audit can flag "this line teaches Black's move in a
white-repertoire", but it can't tell the author whether to:
- (a) move the line to a black-repertoire course where Black's
      move is the user move, or
- (b) rewrite the line so the user (white) plays the
      counter / refutation, with Black's move shown as the opponent.

Both are valid responses; the choice depends on what we want the
course to teach. The audit surfaces the question; the human picks
the answer.

Same for inferior-move teaching: when the line walks the user
through `6.Kxf2` (inaccurate per prose), the human decides whether
to:
- (a) replace with `6.Kf1!` (engine-approved, what the user should
      actually play),
- (b) keep `6.Kxf2` for pedagogical reasons (showing what NOT to
      do) AND mark the line explicitly as a "common-mistake" line,
      or
- (c) split into two lines: one teaching the trap, one teaching
      the refutation.

The audit's job is to never let these decisions be silent.

## Quality gate

A line is "audit-clean" when:
1. ✓ all SAN legal
2. ✓ no hung pieces (or in `KNOWN_SACRIFICES` allowlist)
3. ✓ no tactical-claim mismatches
4. ✓ no square-reference mismatches
5. ✓ perspective consistent (or in `KNOWN_INFERIOR_TEACHING`
      allowlist with justification)
6. ✓ engine evals match claims within 50cp
7. ✓ user-side moves are engine top-3 (or allowlisted)
8. ✓ Lichess Explorer master games show ≥ 5 games at the tabiya
      position (popularity floor)

Items 1-2 are CI-enforced today. Items 3-5 should be CI-enforced
after Phase 1 lands. Items 6-8 are weekly background audits.
