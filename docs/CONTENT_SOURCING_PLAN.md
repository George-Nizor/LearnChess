# Content sourcing plan — going from 5 → 25 lines per opening

> Why: chessreps.com has 28 named London lines, we have 5. The gap
> isn't theory mainlines (we cover those) — it's the "common moves
> people actually play" content like the chessreps **G7 Heist**
> (`1.d4 d5 2.Bf4 e6 3.e3 Bd6 4.Qg4 Bxf4 5.Qxg7 Qf6 6.Qxf6 Nxf6
> 7.exf4`). Black's `4...Bxf4` is a blunder but it's the most-
> common move, so the trap line is high-value to teach. We need a
> pipeline that surfaces these systematically without scraping
> proprietary sources.
>
> **2026-05-01 design pivot.** An earlier version of this plan had
> the pipeline writing draft `LineSpec` stubs with placeholder prose
> directly into the courses (with a "Draft" badge). User feedback:
> shipped content should be polished and hand-authored — the
> pipeline's job is to surface WHAT to write, not to ship draft
> content. The current design (re-purposed in commit after `f0cefa4`)
> keeps the data side of the pipeline but emits a MARKDOWN BACKLOG
> per opening instead of LineSpec stubs. Authors use the backlog as
> a research aid and hand-write the lines into `lessons.ts`.
>
> First milestone delivered: London course went from 7 lines to 16
> by hand-authoring the patterns the pipeline would have surfaced
> (G7 trap, ...f6 punishment, Bf5 + ...b5 trap, vs ...c5 main, vs
> ...g6, vs ...e6+...c5, vs ...Bg4, vs ...c6 Slav-style, vs ...b6
> Queen Indian-style). All audit-clean.

## Sources matrix — what's legally usable

| Source | Licence | Volume | Useful for | Notes |
|---|---|---|---|---|
| Lichess Masters DB | CC0 | ~4M+ master games | Tier A (popularity-weighted lines) | The real frequency-of-play data; computable into our own opening tree |
| Lichess Standard DB | CC0 | ~6B+ all games | Tier A (filtered to high-Elo) | Massive; filter by player Elo ≥ 2200 if masters dump unavailable |
| Lichess puzzle DB (already shipped) | CC0 | ~5.8M positions | Tier B (trap-line auto-discovery) | Each puzzle has `OpeningTags`; mine for opening-tagged tactical motifs |
| Lichess Studies (public+CC) | CC-BY-SA when marked | varies | Tier C (manual lift) | Top community studies often have 100+ variations per opening |
| Wikipedia / Wikibooks chess pages | CC-BY-SA | well-curated | Tier C (named traps + brief prose) | "List of chess traps" + per-opening pages; great for line names + 1-2 sentence stubs |
| GitHub PGN repertoires | varies (often MIT/CC) | varies | Tier C (selective lift) | Search `github.com` for `<opening name> repertoire pgn`; check licence per repo |
| chessreps.com / chess.com / chessable | proprietary | huge | OFF-LIMITS | Cannot scrape; reference only for "what density looks like" |
| ChessBase / 365chess | ToS-restricted | huge | OFF-LIMITS | Don't scrape |

## Tier A — Lichess Masters DB → popularity-weighted lines

The biggest win. Mechanical, CC0-clean, scales to every opening
we ship. The chessreps "G7 Heist" is exactly this class: it's
popular because Black's `Bxf4` is the most-played reply to
`Qg4` *despite being a blunder*. Master-game frequency surfaces
the trap automatically.

### Pipeline

Three scripts, each running independently:

```
scripts/build-opening-tree.ts        # PGN → frequency tree JSON
        ↓
public/opening-tree.json             # Move-frequency tree (gitignored — big)
        ↓
scripts/generate-opening-lines.ts    # tree → LineSpec stubs
        ↓
src/openings/generated-lines.ts      # auto-generated LineSpec[] (committed)
        ↓
src/openings/lessons.ts              # imports + merges generated + hand-authored
```

### Step 1 — Build the frequency tree (`build-opening-tree.ts`)

Input: a PGN file (or stream). Output: a tree keyed by FEN, with
each node listing `{ moves: { [san]: count }, totalGames: N }`.

```typescript
interface TreeNode {
  fen: string;
  totalGames: number;
  moves: { [san: string]: { count: number; nextFen: string } };
}
type Tree = Map<string, TreeNode>;
```

Pipeline:
1. Stream-parse PGN games (use `pgn-parser` or `@mliebelt/pgn-parser`).
2. For each game, walk the first ~20 plies maintaining the FEN.
3. For each FEN encountered, increment `moves[san].count`.
4. Track `totalGames` per node so we can report frequencies.
5. Output a JSON tree (gitignored, ~50-200 MB depending on input).

Considerations:
- Use the FEN with `0 1` move counters stripped so transpositions
  collapse to the same node.
- Cap depth at 20 plies (deeper isn't useful for opening
  authoring).
- For 4M master games this takes ~5-10 min on a server. Run on
  the cloud server (CPU + disk) and commit the OUTPUT JSON.

### Step 2 — Generate LineSpec stubs (`generate-opening-lines.ts`)

Input: the frequency tree + a config file specifying which
openings to generate lines for. Output: a TypeScript module
exporting `LineSpec[]`.

```typescript
// scripts/opening-targets.json — config drives generation
{
  "london-white": {
    "rootMoves": ["d4", "d5", "Bf4"],   // entry into the London
    "branchPlies": 8,                    // walk this many plies past root
    "maxBranchesPerNode": 3,             // top-N most-common moves per node
    "minFrequencyPct": 5                 // skip moves played in <5% of games
  },
  "italian-white": {
    "rootMoves": ["e4", "e5", "Nf3", "Nc6", "Bc4"],
    "branchPlies": 8,
    "maxBranchesPerNode": 3,
    "minFrequencyPct": 5
  }
}
```

For each opening:
1. Walk to the root position via `rootMoves`.
2. BFS-expand: at each node, pick the top N moves by frequency.
3. For each leaf path, emit one LineSpec.
4. Generate prose from a TEMPLATE (deterministic, fact-grounded):

```
intro: "Let's learn the {LINE_NAME}! After {ROOT_MOVES} this is
played in {N}% of master games. The plan: {auto-generated from
the move sequence}."

per-move:
"**{ply}.{san}** — {san_description}. Played in {N}% of master
games at this position."

tabiya:
"You've reached the main {LINE_NAME} tabiya. {pawn-structure
summary}. Common deviations from this point: {top-2 alternative
moves with their frequencies}."
```

**Important: auto-generated prose is FACTUAL ONLY.** No tactical
claims, no eval claims, no historical claims — those need a human
(or the audit pipeline + Stockfish) to validate. Auto-generated
prose says "X% of masters play this" because that fact is
literally in the data.

### Step 3 — Merge into `lessons.ts`

`src/openings/generated-lines.ts` exports a typed `LineSpec[]`.
`src/openings/lessons.ts` imports it and merges with hand-authored
lines. Hand-authored lines TAKE PRIORITY when there's an id
collision — generated lines are stubs to enrich, not to replace.

Generated lines are tagged with a metadata field:

```typescript
interface LineSpec {
  // ... existing fields ...
  /** Was this line auto-generated from the Lichess Masters DB?
      Generated lines are LOWER quality than hand-authored; the
      Drill weighting de-prioritises them, and the Learn view
      shows a "auto-generated stub — improve me" badge. */
  generated?: { source: 'lichess-masters'; generatedAt: string; gamesAtTabiya: number };
}
```

### Quality gates for generated lines

Every generated line MUST pass the existing audits:
- chess.js validates SAN at module load
- `tests/unit/openings/hungPieces.test.ts` — no piece blunders
- `tests/unit/openings/perspective.test.ts` — no user-side
  inferior-move teaching
- `tests/unit/openings/lessons.test.ts` — FEN derivation matches

Generated lines that FAIL these are dropped from the output (or
quarantined to a separate review file). The generator never
ships a line that fails an audit.

Once `npm run audit:engine` is wired up (see
`docs/CONTENT_AUDIT_PLAN.md`), generated lines also get the
Stockfish baseline check.

### First milestone: London 5 → 20 lines

Run the pipeline against the Lichess Masters DB targeting the
London. Generate ~15 popularity-weighted Tier-A lines covering:
- Top 3 Black 2nd-move responses each with top 3 White 4th-move
  continuations: 9 base lines
- Each branched 1-2 ply further at top response: ~15-20 total
- The G7 Heist will appear naturally because `4...Bxf4` is the
  most-common reply to `4.Qg4` despite being a blunder

Combined with our existing 5 hand-authored mainlines and any
Tier-B/C additions, the London course goes from 5 → ~25 lines.

## Tier B — Puzzle DB trap mining (sketch)

Our shipped puzzle DB has `OpeningTags` per puzzle. For each
opening:

1. Query puzzles tagged with the opening (e.g. `London`).
2. Filter for puzzles where the FAILING move (the move the
   puzzle says is wrong) is a common opponent move per the
   Tier-A frequency tree (≥5% frequency at that ply).
3. For each match, the position + puzzle solution = a "trap line"
   stub. The puzzle's failing move is the opponent's common
   mistake; the puzzle solution is what the user should play.
4. Generate prose: "Black often plays X here (Y% of master
   games), but it walks into Z winning material."

Estimated yield: 3-5 trap lines per opening. The G7 Heist would
also surface here if it's tagged in the puzzle DB.

Implementation: ~1 dedicated session after Tier A lands. The
puzzle DB schema is already documented in
`docs/research/puzzle-db.md`.

## Tier C — Wikipedia / Wikibook curation (sketch)

For each opening, scrape the Wikipedia page's "Variations" and
"Common traps" sections (CC-BY-SA, attribution required). Each
named trap becomes a line stub:
- Line name: lifted from Wikipedia (e.g. "Légal Trap",
  "Frankenstein-Dracula Variation")
- Move sequence: lifted from Wikipedia's algebraic notation
- Prose: 1-2 sentence summary written in our voice, Wikipedia
  attribution in a footer comment

Implementation: mostly manual with a tooling assist (a script
that scrapes the Wikipedia page and emits a draft `LineSpec`
for human review). Estimated: 2-5 named-tradition lines per
opening, ~30 min/opening of human review.

Attribution: bottom of `lessons.ts` gets a "Sources & attribution"
comment block listing every Wikipedia / Wikibooks page we lifted
from, with their CC-BY-SA notice.

## Integration milestones (recommended order)

1. **Tier A pipeline** — `build-opening-tree.ts` +
   `generate-opening-lines.ts` + `generated-lines.ts` integration.
   First run on the London for proof of concept. **(this commit)**
2. **Tier A roll** — re-run pipeline against all 13 openings;
   merge generated lines; review + accept high-quality ones.
3. **Tier B trap mining** — puzzle-DB sweep for opening-tagged
   tactical motifs.
4. **Tier C manual curation** — Wikipedia lift for named
   classical lines we don't already cover.

Each milestone is one dedicated session; full plan delivers
~20-30 lines per opening (vs current 5-12).

## What this plan deliberately doesn't do

- **No prose copying.** Auto-generation is FACTUAL ONLY (move
  frequencies). All teaching prose is either (a) template-driven
  from facts the data supports, or (b) human-authored. We never
  copy explanatory prose from any source.
- **No commercial-source scraping.** chessreps, chess.com,
  chessable, ChessBase, 365chess — all off-limits.
- **No replacing hand-authored lines.** Generated lines are
  ADDITIVE. The 142 hand-authored lines stay as the
  authoritative version of those positions.
- **No relying on auto-generated prose in production.** Every
  generated line gets a human review pass before its `generated`
  flag is removed from `LineSpec`. The Drill mode de-prioritises
  ungated generated lines so the user mostly sees high-quality
  hand-authored content.

## Quality bar for accepting a generated line

A generated line graduates from "auto-stub" to "shipped" when:
1. ✓ Passes all Tier-1 audits (SAN / hung-pieces / perspective)
2. ✓ A human has reviewed the prose and either approved or
   rewritten it
3. ✓ Stockfish baseline shows no eval surprises (Tier-2, future)
4. ✓ The line teaches a real practical pattern (not a meaningless
   transposition)

Until then it's a stub: visible in the line picker with a "draft"
badge, low Drill weighting, included in the corpus for
testing/auditing but not the user's primary repertoire.
