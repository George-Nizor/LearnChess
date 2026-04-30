# Resume plan — pick up here next session

> Last touched 2026-04-30 (overnight). Most recent landings:
> Phase 1b + Phase 1c of the engagement-first deviation design.
>
> **Phase 1b (commit `777c255`)**: lifted the 15 inline "Common
> deviations: …" callouts on the 5 Pirc tabiyas into navigable,
> drillable sibling lines. Schema-only — added `parentLineId` +
> `deviationFromMove` to `OpeningLine`/`LineSpec`. Each deviation
> shares its parent's lead-up plies, then branches with the
> alternative White move + 1-3 plies of response, ending at a
> tabiya summary node with the standard structured sections.
>
> **Phase 1c (commit `084ab9d`)**: line-picker UI tweak — deviations
> sort immediately after their parent, render with a left-indent
> + thin violet border + small "Deviation" pill, tooltip names the
> parent + branching ply. Drill weight for deviation edges is
> `0.012` (≈¼ of a mainline lesson edge) so they show up in
> rotation without flooding. New structural-invariant tests pin
> the deviation schema (parent exists, deviationFromMove is
> consistent, lead-up plies match the parent, branching ply
> differs).
>
> **Top priority for the next session: Phase 1d — roll branched
> lines to the remaining 12 openings.** The Pirc deviations are
> the gold template; replicate the recipe per opening (3 deviations
> per existing tabiya × 12 remaining openings ≈ 36 × ~3 = ~100
> short sibling lines, each 12-16 plies, ~½-day authoring per
> opening). The `Common deviations: …` prose for the other 12
> openings does NOT exist yet — it has to be authored from scratch
> using the deep-rewrite recipe in the file's header comment.
>
> Earlier landings still relevant:
>   - Phase 1a (commit `92a7466`): `'common-deviation'` schema
>     added to the prose parser + violet "If they deviate" pill in
>     `LessonBubble`, plus deviation prose authored on all 5 Pirc
>     tabiyas as proof of pattern. The inline prose is **kept**
>     for now — Phase 1b lifted it into branched lines but the
>     pill is still useful as a fallback for tabiyas that don't
>     yet have branched deviation siblings, and for any "common
>     mistake" prose we add later.
>   - QA pass: 25 factual fixes across the 96 tabiyas + Stockfish-
>     backed eval audit + chess.js tactical verification (commits
>     `d382b62` / `c98c72d` / `6facc2f`).
>   - Docker deploy stack ready (`af5868c`): `Dockerfile`,
>     `docker-compose.yml`, `deploy/nginx.conf`, `deploy/Caddyfile`.
>   - GitHub readiness + Play tab squish fix + expansion-plan
>     authoring (`563fe0a`): README, LICENSE (GPL-3.0), CI workflow.
>   - Phase 1+2+3 amplifier features (`ae49c12` / `7e93662` /
>     `d149149`): structured speech bubble + on-board overlays +
>     pawn skeleton + Test mode SRS + inline puzzle solver.
>
> 136 tests pass; main is clean.

---

## Where we left off

Two big landings shipped in the previous session:

1. **Puzzles tab on every Openings course** (`4faab94`).
   New fourth tab alongside Learn / Drill / Explore. Shows opening-specific
   puzzle count + theme breakdown + 6 sample positions, with a
   "Train all in Tactics →" CTA that cross-links to
   `/tactics?opening=<slug>`. Lives in `src/routes/OpeningsPuzzlesView.tsx`.

2. **Pirc Defence — 5 lessons rewritten ideas-first** (`4e8f708`).
   Every move now teaches the strategic *why*, not just the move name.
   See the commit message for the per-line scope. The user picked Pirc
   first as a template; remaining 12 openings follow the same recipe.

---

## Next steps (priority order)

### 0. Home-lab deployment  (NEW — see `docs/DEPLOY.md`)

User wants persistent hosting on their network. Templates and notes
ready to drop in: Caddy config, nginx config, Dockerfile,
pre-deploy verification checklist. Nothing wired up to the build
yet — pick the path (Caddy is recommended) and:
1. Add a `Dockerfile` + `deploy/nginx.conf` to the repo.
2. Add a `docker-compose.yml` for the home-lab box.
3. Set up the LAN DNS (`chess.home.lan` or similar) + cert.
4. Cron `npm run vendor:engine` + `npm run build:puzzles` monthly to
   refresh the puzzle DB and keep the engine up to date.

### 1. Roll the depth-pass to the remaining 11 openings  (HIGH PRIORITY — user explicit ask)

**Goal:** every opening has the same ideas-first lesson quality as Pirc.

**Recipe per opening** (proven on Pirc — replicate exactly):
- Each move node: 2-3 dense sentences. Move name + strategic *why* + key
  squares + tactical/positional theme. Hard cap of 4 sentences.
- Final tabiya node per line: break the 4-sentence cap on purpose. Treat
  it as the "end of chapter" plan paragraph (5-7 sentences). Always name
  2-3 key squares, 2-3 plans, 1-2 traps to remember.
- Intro: 3-4 sentence scene-setter. Line character + what to expect.
  Keep the "Let's learn the X!" template.
- Move references in `**bold**` throughout.
- Authoring rules in `src/openings/lessons.ts` header comment still apply.

**Suggested order (nav order, easiest first):**
1. ~~Italian Game~~ — DONE in `86514e6` (10 lines including the rare ones)
2. Ruy Lopez (3 lines) — Closed Spanish + Berlin + Exchange
3. Sicilian Defence (4 lines) — Najdorf, Dragon, Taimanov, Closed
4. French Defence (4 lines) — Winawer, Classical, Tarrasch, Advance
5. Caro-Kann (4 lines) — Classical, Advance, Exchange, Panov
6. Queen's Gambit Declined (4 lines)
7. King's Indian Defence (4 lines)
8. Slav Defence (3 lines)
9. English Opening (3 lines)
10. London System (3 lines)
11. Vienna Game (3 lines)
12. Scandinavian (3 lines)

Total remaining: ~36 lines. Each opening is independent and ships as
its own commit. **Italian Game is the gold template** — same recipe.

**Tip for the next session:** open
`src/openings/lessons.ts` line ~1855 for the Pirc block as the gold
template. Don't rewrite without rereading it first. Voice consistency
matters.

**Verification per opening:**
- `npm run typecheck` — chess.js validates every SAN at module load
- `npm run test -- --run tests/unit/openings/lessons.test.ts` —
  re-derives every FEN and asserts equality
- Drive the route in the preview at
  `http://localhost:5180/openings?course=<id>` and Next-arrow through
  the line to spot-check rendering

### 2. Upgrade Puzzles tab from informational sample to inline solver  (MEDIUM)

Right now the Puzzles tab shows mini-board cards that link OUT to
`/tactics`. A more seamless UX: render the puzzle solver INSIDE the
tab so the user never leaves the opening's context.

**Refactor required:**
- Extract the puzzle-solving UI (board + status sidebar + Hint /
  Show Solution / Next puzzle / rating) from `src/routes/Tactics.tsx`
  into a reusable `<PuzzleSolver>` component.
- Tactics.tsx imports it (replaces ~600 lines of inline JSX).
- `OpeningsPuzzlesView.tsx` mounts it scoped to the opening's slug.
- Pass theme + rating filters as props so the Openings tab can
  default-narrow to e.g. "Pirc + middlegame" while Tactics keeps
  full filter chrome.

**Watch out for:**
- The `recordAttempt` flow + IDB persistence stays shared (one user
  rating, one progress log) — don't fork the SRS state by accident.
- The `'revealed'` SolveStatus fix (commit `2674059`) lives in
  Tactics.tsx state. Make sure the extracted component carries it.

### 3. Per-line Puzzles filtering  (LOW — polish)

Currently the Puzzles tab queries by opening slug only
(`Pirc_Defense%`). Lichess actually tags at line granularity for
popular variations (`Pirc_Defense_Austrian_Attack`,
`Sicilian_Defense_Najdorf_Variation`, etc).

**Plan:**
- When a specific line is selected in the Openings tab line picker,
  derive a more specific slug if it matches a known Lichess sub-tag.
- Build a small mapping table from our line ids
  (e.g. `pirc-austrian` → `Pirc_Defense_Austrian_Attack`) — only
  populate where Lichess has matches; fall back to the parent slug.
- Verify in the puzzle DB which sub-slugs actually exist; some lines
  won't have enough tagged puzzles to be worth it.

---

## Outstanding bugs / cleanup spotted but not addressed

- **Mobile/narrow viewport (<700px) layout** — Play page eval bar
  shows alone with no board. The whole responsive layout pass is
  beyond a debug session; needs a dedicated UX pass with breakpoints
  defined per route.
- **Italian drill produces one rare move pair** — `e4 e5 Nf3 Nc6
  Bc4 Nf6 Ng5 Bc5` (Two Knights with `…Bc5`?) showed up once in 60
  drills. Investigate whether the lessons.ts "Two Knights Defence"
  line accidentally includes a duplicated/wrong SAN. Low impact.
- **Hardcoded `MiniBoardPreview` position** — only renders Italian
  Game 5-ply. If we want catalogue cards to show each opening's
  characteristic position, this needs to accept a FEN.

---

## Resume command

To pick up:

```bash
cd /workspace/dev_projects_master/_PersonalProjects/LearnChess
git status   # should be clean on main
git log --oneline -10   # confirm last commit is 4e8f708 (Pirc rewrite)
./.dev/wsl-run.sh npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Then in Claude:
> Read docs/RESUME.md and pick up where we left off. Start with item 1 —
> deep-rewrite the Italian Game lessons using the Pirc block in
> src/openings/lessons.ts as the template. Use the Claude Preview MCP
> to verify each line renders cleanly before committing.

---

## Repo state at last commit

- Branch: `main`
- Last commit: `86514e6` (Italian Game deep-rewrite) + this RESUME/DEPLOY commit
- Tests: 105 passing, 7 IDB-skipped
- Typecheck: clean (strict + exactOptionalPropertyTypes)
- Lint: clean (max-warnings 0)
- Production build: 148 MB dist (engine 85 MB + puzzles 55 MB + JS/CSS 7 MB)
- Dev server: 5180 (still running at session end — stop with `mcp__Claude_Preview__preview_stop`)
