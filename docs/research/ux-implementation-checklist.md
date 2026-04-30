# LearnChess — UX Implementation Checklist

**Date:** 2026-04-26
**Source:** `docs/research/ux-critique.md`
**Audience:** coding agent — one-line specs only.
**Stack constraints:** Tailwind v4, shadcn (`button`, `card`, `dialog`, `slider`, `tooltip` available), chessground, React 19 + TS strict, WCAG AA, chess.com vibe.

---

## TL;DR — top 5 by impact-per-effort

1. **[P0] Tactics: persist `themes` array** — `src/routes/Tactics.tsx:152` change `themes: []` to `themes: active.row.themes`. 30s edit; unblocks the entire Dashboard recommendation engine.
2. **[P0] Endgames: plain-English verdict strip + kill DTZ jargon** — `src/routes/Endgames.tsx:261-291` replace the 4-cell grid (TB verdict / DTZ raw text) with a single coloured `Badge` strip docked to the top of the board: "You are winning · Mate in 14". Translates the killer feature into something a learner reads.
3. **[P0] Play: collapse engine knobs into a 3-bucket preset** — `src/routes/Play.tsx:249-313` replace the 0-20 skill slider + movetime/depth toggles with three `Button` cards: Beginner (skill 3, 600ms) / Intermediate (skill 10, 1200ms) / Strong (skill 18, 2000ms). Raw knobs go behind a `Dialog` triggered by a small "Customise" link. Removes the single biggest source of jargon on Play.
4. **[P1] Dashboard: "What to work on" callout** — `src/routes/Dashboard.tsx:103` insert a top-of-page `Card` showing weakest theme (lowest accuracy, n>=5) with a deep-link button to the filtered Tactics view. Depends on #1.
5. **[P1] Layout: kill the 3xl page titles** — every screen has `<h1 class="text-3xl font-semibold">…</h1>` eating 60-80px above the board (`Play.tsx:209`, `Tactics.tsx:325`, `Openings.tsx:213`, `Endgames.tsx:219`, `Dashboard.tsx:94`). Move route name into nav active state (`Layout.tsx:19-32`); replace `<h1>` blocks with a 24px board toolbar holding the meta + status. Reclaims 80px on every laptop screen for ~10min work.

---

## Cross-cutting changes

Apply once, benefit five times. Do these as their own PR before the per-screen work — they unblock the rest.

- **[P0] Plain-English jargon translation map** — new file `src/copy/labels.ts`:
  - `THEME_LABELS: Record<string, { label: string; group: 'tactics'|'mating'|'positional'|'endgame' }>` — `discoveredAttack` → "Discovered attack", `mateIn1` → "Mate in 1", `backRankMate` → "Back-rank mate", etc. Used by `Tactics.tsx:362` filter chips and Dashboard.
  - `STRENGTH_PRESETS: { label: string; elo: number; skill: number; movetimeMs: number; description: string }[]` — used by `Play.tsx`. Three buckets only.
  - `TB_VERDICT_TO_TEXT(category, dtz, side, goal): string` — turns `cursed-win` / `dtz: 12` into "You are winning · Mate in 14". Used by `Endgames.tsx`.
  - `MISTAKE_EXPLANATION(prevDtz, nextDtz, prevCat, nextCat): string` — "shorter mate by 2", "throws away the win", "lets opponent draw".
  - `formatBranchPath(uciPath): string` — converts UCI string to readable SAN sequence for Openings progress.

- **[P0] `<TrainerLayout>` shared shell** — new file `src/components/TrainerLayout.tsx`:
  - Props: `left: ReactNode`, `board: ReactNode`, `right: ReactNode`, `boardToolbar?: ReactNode`, `meta?: ReactNode` (replaces the per-screen `<h1>`).
  - Grid: `grid grid-cols-1 gap-4 md:grid-cols-[260px_minmax(0,1fr)_300px]`. Padding `p-4 md:p-6`.
  - Replaces the duplicated grid in `Play.tsx:224`, `Tactics.tsx:333`, `Openings.tsx:217`, `Endgames.tsx:223`. Same gaps, padding, scroll behaviour.

- **[P1] One-primary-CTA-per-panel rule** — audit each right rail. Exactly one `<Button>` (no `variant`, defaults to filled accent, `size="lg"` for the headline action). Everything else is `variant="ghost"` or `variant="outline"` or `variant="link"`. Today every button is `border border-border bg-background py-2 text-xs` — flat hierarchy.

- **[P1] Board overlay feedback helper** — new file `src/chess/board/feedback.ts`:
  - `arrowShape(uci, brush): DrawShape` — wraps the orig/dest split.
  - `squareShape(square, brush): DrawShape` — single-square highlight.
  - `flashBoard(api, color: 'red'|'green', durationMs)` — calls `api.setShapes` with `paleRed`/`paleGreen` brushes on every occupied square for `durationMs`, respects `prefers-reduced-motion`.
  - Used by Tactics wrong/correct, Play blunder, Endgames mistake, Openings wrong.

- **[P2] Settings vs session-controls split** — anything persistent (eval bar, best-move arrow, board theme, sound on/off) moves to a settings `Dialog` triggered by a gear `Button` in the board toolbar. Anything per-move (Hint, Restart, Switch sides, New game, Next puzzle) stays inline.

- **[P2] Keyboard shortcuts** — `src/hooks/useKeyboardShortcuts.ts`. `N` = next puzzle / new game; `R` = retry / restart; `H` = hint; `←/→` = step through PGN where it exists; `?` opens a `Dialog` listing them.

- **[P2] Dark mode toggle** — wire `Layout.tsx` header to a shadcn `Button` toggling `document.documentElement.classList.toggle('dark')`. Default to `prefers-color-scheme`. CSS already supports it (`globals.css`).

---

## 1. Play — `src/routes/Play.tsx`

### Status

- PENDING — none of the critique items have been applied. Skill slider, movetime/depth toggles, eval-bar checkbox, FEN line, 3xl title all still present.

### Pending

**P0**

- **[P0] Replace skill slider + movetime/depth with 3 strength preset cards** — `Play.tsx:249-313`. Render `STRENGTH_PRESETS` as a `radiogroup` of three shadcn `Card`s. Each card shows portrait emoji, label ("Beginner"), Elo ("~800"), and a one-liner. Active card uses `ring-2 ring-accent`. State: `selectedPresetId` in `usePlayStore`; derive `skillLevel` + `engineMovetime` from it. Engine knobs move into a `Dialog` triggered by a small `Button variant="link"` reading "Customise engine" below the cards.
- **[P0] Add post-move blunder annotation toast** — `Play.tsx:158-181` already runs depth-12 search on player's turn. Add a *previous-position* baseline eval: when the player moves and the new eval drops by >=200cp from the baseline (player's POV), call `toast(...)` with the better SAN move and a "Review" link. Use `sonner` (`pnpm add sonner`) mounted in `Layout.tsx`. Respect `prefers-reduced-motion`. New state: `previousEvalCp: number | null` in `usePlayStore` to anchor the delta.
- **[P0] Game Review panel on game over** — when `isGameOver` flips true, slide a `Card` over the right rail (use shadcn `Sheet` from the right) listing every player move with classification (`!`/`?!`/`?`/`??`) and a "Replay from blunder" button per row. Data source: re-run engine search at depth 12 over each ply of the saved PGN. New state: `gameReview: { ply, classification, bestSan, cpDelta }[]` in `usePlayStore`. Single primary `Button`: "New game".

**P1**

- **[P1] Move list (PGN) in right rail** — `Play.tsx:247` add a `ScrollArea` showing `1. e4 e5 2. Nf3 Nc6 …` with each ply a `<button>` that calls `usePlayStore.jumpToPly(n)` (new action — already-trivial because `chess.js` keeps history). Move-classification annotations (`?!` etc.) inline with each ply.
- **[P1] Captured material tray** — small row above the move list: `♟♟♟ vs ♙♙` derived from `chess.js` `history` + initial position. Pure derived selector; no new state.
- **[P1] Coach toggles consolidated** — replace the two checkboxes (`Play.tsx:316-325`) with a single shadcn `Switch` labelled "Coach mode" + a `Tooltip` describing what it does. Internally toggles both `showEvalBar` and `showBestArrow`.
- **[P1] Eval bar inline with board** — keep eval bar but reduce to `w-3` (12px) and place inside the board toolbar's left edge, not its own grid column. Centipawn label moves *under* the board in 12px font, not floating in the bar.
- **[P1] Engine status to a tooltip** — `Play.tsx:210-212` "Stockfish 18 NNUE · skill X" should not be in the page header. Move to a small status indicator in the board toolbar (a green dot + `Tooltip`). On error, surface as a `Toast`.

**P2**

- **[P2] Drop the FEN line entirely** — `Play.tsx:351`. Pure power-user noise. Behind a "View FEN" `Button` in the settings `Dialog` if needed.
- **[P2] Bot personalities (post-MVP)** — when ready, expand `STRENGTH_PRESETS` into 6-7 named bots with portraits and styles ("Aggie 1100, attacks aggressively"). Same data shape, just longer list. Render as a horizontally scrolling `radiogroup` in the left rail.
- **[P2] Undo/takeback** — `Button` in the board toolbar; calls `chess.js` `undo()` twice (player + engine ply). Disable mid-engine-think.

---

## 2. Tactics — `src/routes/Tactics.tsx`

### Status

- DONE this session — 4-button SRS grader removed (was at line 360-367 in critique snapshot, now gone), single `Next puzzle` CTA at `Tactics.tsx:464-477`, big status card at `Tactics.tsx:399-441`, green arrow on wrong via `autoShapes` brush `'green'` at `Tactics.tsx:249-255`, expected SAN displayed at `Tactics.tsx:430-432`.
- DONE — auto-derived grade (`recordAttempt` at `Tactics.tsx:137-162` infers `solved/again` from `solved`).
- DONE — last rating delta surfaced inline in status card (`Tactics.tsx:419-422` and `434-437`).
- PENDING — themes still raw IDs, theme picker is flat, no streak counter, rating delta only inline (no top-right badge), Hint/Show solution still equal weight, themes array bug, no rating-rating-band chip animation.

### Pending

**P0**

- **[P0] Persist `themes` on each attempt** — `Tactics.tsx:152` change `themes: []` to `themes: active.row.themes ?? []`. One-line fix; everything in Dashboard recommendations depends on this.
- **[P0] Human theme labels** — `Tactics.tsx:362` use `THEME_LABELS[t]?.label ?? t` from `src/copy/labels.ts`. Strip the camelCase IDs from the user's view.

**P1**

- **[P1] Themes picker → grouped Popover** — `Tactics.tsx:359-378` move the 21-button cloud into a shadcn `Popover` triggered by a "Themes" `Button` showing active count ("Themes (3)"). Inside, group by `THEME_LABELS[t].group` (Tactics / Mating / Positional / Endgame), each as a section with a header. Active themes shown as `Badge`s above the picker so user sees state without opening.
- **[P1] Rating chip top-right with delta animation** — `Tactics.tsx:326-330` move into a `Badge` (`text-2xl font-semibold`) in a top-of-board toolbar. On solve, the `lastRatingDelta` floats up next to it for 1.5s with `animate-in slide-in-from-bottom-1 fade-in` then collapses. Respect `prefers-reduced-motion`.
- **[P1] Streak counter chip** — derive from `getRecentPuzzleAttempts(...)` already loaded at `Tactics.tsx:100-103`. Group by ISO date, count consecutive days with >=1 attempt ending today. Render as `Badge` next to rating: "Streak 4 days". Logic in new `src/insights/streak.ts`.
- **[P1] Hint shrunk; Show solution as text link** — `Tactics.tsx:444-461` Hint becomes a small ghost `Button size="sm"` with a lightbulb icon. "Show solution" becomes a `Button variant="link"` with confirmation `Dialog` ("This counts as a wrong answer. Continue?").
- **[P1] Active puzzle theme chip on the board** — `Tactics.tsx:390-394` replace "Puzzle id · rating" with a chess.com-style pill above the board: `<Badge>Fork · 1450</Badge>`. The puzzle ID (debug-only) moves behind the `Tooltip` on the badge or removed.
- **[P1] Big status card auto-focuses Next button on solve** — already wraps Next in onKeyDown for Enter (`Tactics.tsx:467-472`); add an `useEffect` on status change that calls `nextButtonRef.current?.focus()` so `Enter` advances without manual focus.

**P2**

- **[P2] "Try again" alongside Next on wrong** — `Tactics.tsx:463-477` add a secondary `Button variant="outline"` "Try again" before the green Next, resetting `active.ply = 0` without re-recording the attempt. Keep Next as the primary action.
- **[P2] Solved-today + accuracy chips** — `Tactics.tsx:479-491` already shows session counts. Add a small "today only" version next to the streak chip (derived from same attempts list).
- **[P2] Red board flash on wrong** — call `flashBoard(apiRef.current, 'red', 300)` in the wrong branch of `handlePlayerMove` (`Tactics.tsx:194`). Respect `prefers-reduced-motion`.
- **[P2] Green checkmark overlay on solve** — small `<svg>` absolutely positioned over the board centre, fades in then out over 1s. CSS animation, not a new lib.

---

## 3. Openings — `src/routes/Openings.tsx`

### Status

- PENDING — all critique items still standing. Browse mode still dumps a SAN sentence (`Openings.tsx:270-275`), drill wrong-state still a red HTML box (`Openings.tsx:287-302`), no progress bars, no Mistakes tab, no branch awareness, equal-weight Browse/Drill buttons.

### Pending

**P0**

- **[P0] Browse mode: clickable PGN with auto-stepping board** — `Openings.tsx:270-275` replace the flat sentence with a row of clickable `<button>`s, one per ply. Clicking ply N sets the board to that ply's FEN. New state: `browsePly: number`. Add a step pad below the board: shadcn `Button`s with `aria-label="Previous move"`/`"Next move"`/`"Start"`/`"End"` arrow icons. `←/→` keys advance. Auto-play is OFF by default (respect `prefers-reduced-motion`); manual step only. Selector reads `browseLine[browsePly].fen`.
- **[P0] Drill wrong-state: small toast, partial reset** — `Openings.tsx:287-302` replace the red HTML block with a `Toast`: "Not in this line. Best: ♗b5". Two buttons: `Try again from here` (resets to `cur.fen` *before* the failed move — needs new `prevFen` field on `DrillState`) and `Next line →`. Today's `Restart drill` throws back to ply zero, which is punishing.
- **[P0] Tabs primitive for Browse / Drill / Mistakes** — `Openings.tsx:253-268` replace the two equal `Button`s with shadcn `Tabs` (`<TabsList>`/`<TabsTrigger>`/`<TabsContent>`). Three tabs: `Browse` (default), `Drill`, `Mistakes`. Mistakes tab queries `getOpeningProgress(openingId)` for `wrongCount > 0`.

**P1**

- **[P1] Per-opening progress bar in sidebar** — `Openings.tsx:222-237` for each opening item add a `<Progress>` (shadcn) showing `% lines mastered`. Compute from `getOpeningProgress(openingId)`: `mastered / totalLines`. Add a `Badge` "DUE: N" if any branchPath has `wrongCount > 0` and `correctSinceMistake < 3`.
- **[P1] Repertoire ordering: due → in-progress → untouched** — `Openings.tsx:222` replace the alphabetical `items.map` with sort by computed status. Categories still group, but inside each category sort by progress.
- **[P1] `enumerateLines` helper for breadth-first drill** — new `src/chess/openings/lines.ts` exports `enumerateLines(tree, maxDepth=12, weightThresh=0.1): string[][]`. Drill iterates these instead of always picking the heaviest reply (`Openings.tsx:23-27`). Track current line index in new state `LineCursor { openingId, lineIdx, ply }` persisted in IndexedDB. Show "Line 4 of 12" indicator + `Progress` bar in the right rail.
- **[P1] Multi-correct moves** — `Openings.tsx:101-103` after `candidates.find((c) => c.uci === move.uci)`, also accept any candidate whose `weight >= 0.8 * maxWeight`. On accept: small `Badge` "Also good: 3.♗c4" if user played a non-heaviest variant.

**P2**

- **[P2] Mistakes tab implementation** — list `getOpeningProgress(openingId)` rows where `wrongCount > 0`, ordered by `lastDrilledAt` desc. Each row is a `Card` with the branch path (formatted via `formatBranchPath`), a "Retry this position" `Button` that reconstructs the FEN from the path. Needs new field `correctSinceMistake: number` on `OpeningProgress`; remove from list when reaches 3.
- **[P2] Branch comments inline in right rail during Browse** — `Openings.tsx:270` for the *next* ply, render `currentNode.comment` if present in a small `Card` ("3.♗b5 attacks the knight that defends e5"). Becomes the "lesson" text.

---

## 4. Endgames — `src/routes/Endgames.tsx`

### Status

- PENDING — all critique items still standing. `TB verdict: cursed-win` and raw `DTZ` still surfaced (`Endgames.tsx:272-279`), per-move grade is colour-only no explanation (`Endgames.tsx:313-319`), Hint leaks DTZ jargon (`Endgames.tsx:195`), no mastery state, no curriculum lock, alphabetical position list (`Endgames.tsx:240-247`).

### Pending

**P0**

- **[P0] Plain-English verdict strip above the board** — replace the 4-cell grid at `Endgames.tsx:261-291` with a single full-width `Badge` band docked to the top of the board column (h-8, full width). Class `flex items-center justify-center text-sm font-semibold rounded-t-md`, colour by category: green `bg-emerald-100 text-emerald-900` for win, amber `bg-amber-100 text-amber-900` for draw, red `bg-red-100 text-red-900` for loss. Text from `TB_VERDICT_TO_TEXT(tbCurrent.category, tbCurrent.dtz, position.side, position.goal)`. `aria-live="polite"` so screen readers hear changes.
- **[P0] Plain-English Hint** — `Endgames.tsx:189-196` replace `Best move: Kc2 (win, dtz 12)` with `"Move your king to c2 — fastest mate."` (or "draws", "saves the game"). Format from `TB_VERDICT_TO_TEXT` + the SAN. Hint button shrinks to ghost `Button size="sm"` below the board.
- **[P0] Per-move feedback: silence on optimal, inline reason on mistake** — `Endgames.tsx:307-322` move list. Drop the colour-coded `optimal/good/inaccuracy/losing` badges on every move. For `optimal`/`good`: nothing. For `inaccuracy`: append `?!` after SAN. For `losing`: append `??` and a one-line reason from `MISTAKE_EXPLANATION(prevDtz, nextDtz, prevCat, nextCat)` ("shorter mate by 2", "throws away the win"). Compact, readable, only highlights what matters.

**P1**

- **[P1] Mastery stars + curriculum order in sidebar** — `Endgames.tsx:224-247` for each position render `★★☆` glyphs (with `aria-label="2 of 3 stars"`). Compute via new helper `mastery(positionId)`: count wins where `movesPlayed <= optimalMoves * 1.2`, mastered at 3. Sort each category by new `difficultyOrder: number` field on `EndgamePosition` (extend type). After a category's prereqs are mastered, unlock the next; locked items render dimmed (`opacity-50`) with a `🔒` icon and `aria-label="Locked: master K+Q vs K first"`.
- **[P1] "Move N of ~M" indicator** — right rail under the verdict strip: "Move 8 of ~14" where M = `tbInitial.dtz` at start. Anchors progress for the user.
- **[P1] Goal restated in plain English** — `Endgames.tsx:261-265` replace the `<div>Goal: WIN</div>` with `position.goalDescription` (new field on `EndgamePosition`): "Checkmate the lone black king." for K+Q vs K, etc. Single sentence, sentence case, 14px.

**P2**

- **[P2] Auto `Retry` after loss** — `Endgames.tsx:297-303` change the button label dynamically: `playing` → "Restart position", `lost` → "Retry", `won` → "Next position →" (advances to next unlocked position in curriculum), `drawn` (when goal=win) → "Retry".
- **[P2] Engine `getStatus` typing fix** — `Endgames.tsx:100` calls `engineRef.current.getStatus()` — verify `StockfishEngine` exposes this; if not, switch to a ready-flag in state. (Out of scope for UX, but flag if it's a bug.)

---

## 5. Dashboard — `src/routes/Dashboard.tsx`

### Status

- PENDING — all critique items still standing. Four KPI cards but no deltas (`Dashboard.tsx:104-121`), bar charts decorative (`Dashboard.tsx:123-130`, `176-192`), no per-theme breakdown, no openings panel, `confirm()` native dialog (`Dashboard.tsx:86`), Wipe button in page header (`Dashboard.tsx:95-101`), hardcoded 30-day window (`Dashboard.tsx:125-128`).

### Pending

**P0**

- **[P0] "What to work on" callout** — insert at `Dashboard.tsx:103` (above the KPI grid) as a full-width `Card` with `bg-accent/10 border-accent/40`. Shows "Your weakest theme is BACK-RANK MATES (38% accuracy)." with a primary `Button` "Drill 5 of these →" linking to `/tactics?themes=backRankMate`. New helper `weakestTheme(attempts, minSampleSize=5)` in `src/insights/recommendations.ts` returning `{ theme, accuracy, n } | null`. If null → "Solve 10 puzzles to unlock recommendations." Depends on Tactics #1.
- **[P0] Replace `confirm()` with `AlertDialog`** — `Dashboard.tsx:86` wrap `clearAll()` in shadcn `AlertDialog` with destructive styling. Move the trigger out of the page header (`Dashboard.tsx:95-101`) into a `Collapsible` "Settings" section at the bottom of the page.

**P1**

- **[P1] KPI deltas** — `Dashboard.tsx:104-121` each card adds a delta line. Rating: `▲+23 / wk` (compare current rating to rating 7d ago). Solved: `+12 / wk`. Accuracy: `+5pp / wk`. Endgame attempts: `+3 / wk`. New helper `kpiDeltas(attempts, days=7)` in `src/insights/`. Up arrow `▲` + `text-emerald-600`, down arrow `▼` + `text-red-600`.
- **[P1] Per-theme accuracy bars** — replace the second bar chart (`Dashboard.tsx:127-129`) with a `Card` titled "Tactics by theme". Inside: list of top-10 themes by attempt count, each row `<Progress value={accuracy} />` with theme label (humanised via `THEME_LABELS`) and `n` count. Sorted ascending by accuracy so the weakest is on top. Each row is a `Button variant="link"` linking to filtered Tactics.
- **[P1] Time horizon `Tabs`** — `Dashboard.tsx:93` add `Tabs` `[7d|30d|90d|All]` to the right of the page meta. Drives all charts and KPI deltas via a `range: 7|30|90|null` state.
- **[P1] Activity heatmap** — replace the first bar chart (`Dashboard.tsx:124-126`) with a 7-row × ~13-week SVG heatmap. Cell colour: `opacity-{ Math.min(count, 5) * 20 }` over `bg-emerald-500`. `<title>` per cell for native tooltip. `aria-label="2026-04-12: 4 puzzles"` per cell. ~60 lines of TSX, no chart lib.
- **[P1] Rating-over-time line chart** — replace the existing `BarChart` for daily rating (`Dashboard.tsx:127-129`) with an inline SVG line chart. ~50 lines. Axis labels (date + rating). Optional dashed goal line at 1800.
- **[P1] Openings panel** — new `Card` titled "Openings" reading `getOpeningProgress(...)` (currently never called from Dashboard). Each opening: name, `<Progress>` for `% lines mastered`, optional `Badge` "Due 3" if mistakes outstanding. Click → `/openings?id=<openingId>`.
- **[P1] Endgame mastery row** — replace the wins/draws/losses table at `Dashboard.tsx:132-162` with a chip row: each position renders `★★★ K+Q vs K` (mastered) / `★☆☆ K+R vs K` (in progress). Click → `/endgames?id=<positionId>`. Reuses the `mastery()` helper from Endgames #4.

**P2**

- **[P2] KPI cards keyboard- and screen-reader-friendly** — each card needs `aria-label` combining title + value + delta ("Tactics rating 1487, up 23 over the last week").
- **[P2] Heatmap `prefers-reduced-motion`** — disable any cell-pulse animation if added later.
- **[P2] Drop the `BarChart` helper** — `Dashboard.tsx:176-192`. Once both charts are replaced, delete the function.

---

## 6. Layout — `src/routes/Layout.tsx`

### Status

- PENDING — all 3 quick wins from critique §6 still standing. Top bar not sticky, no theme switcher, no command palette.

### Pending

- **[P1] Sticky nav** — `Layout.tsx:14` change `<header className="border-b border-border bg-muted/40">` to `... sticky top-0 z-40 backdrop-blur bg-muted/80`. Board-heavy screens benefit from always-visible nav.
- **[P1] Mount `<Toaster />` from sonner** — `Layout.tsx:36` (above `<Outlet />`) so all routes can call `toast(...)`. Required by Play blunder annotation, Tactics rating delta, Openings wrong move.
- **[P1] Active route shown as page meta** — currently the active `NavLink` lights up at `Layout.tsx:23-29`. Combined with the cross-cutting "kill 3xl titles" change, this becomes the page's only title. No code change here, just confirms there's nowhere else the page name needs to live.
- **[P2] Dark mode toggle in nav** — small `Button variant="ghost" size="icon"` next to the nav with sun/moon icon; toggles `document.documentElement.classList.toggle('dark')`. Persist in localStorage.
- **[P2] Command palette `cmd-k`** — add shadcn `Command` + `Dialog` triggered by `cmd-k`. Commands: "Go to Play / Tactics / Openings / Endgames / Dashboard"; "New game"; "Next puzzle"; "Hint"; "Toggle dark mode". One evening; high power-user gain.

---

## Skip / defer

Be opinionated. These critique items aren't worth doing now.

- **Bot personalities with portrait emojis and named bios (`Aggie 1100`)** — fun but cosmetic; the strength-preset cards already solve the jargon problem. Defer until after the top 5 land. *Reason: the value is engagement-flavoured, not learning-flavoured. Three preset buckets close the actionable gap with 80% less work.*
- **Undo/takeback in Play** — chess.com offers it but it teaches the wrong habit. Defer indefinitely; if added, gate it behind a setting that defaults off. *Reason: a learning app should let you feel mistakes, not unmake them. Game review post-game is the right teaching moment.*
- **Lessons-style interleaved board+prose for Openings Browse** — would require authored content per opening. The current `comment` field on `OpeningNode` is empty for most positions. Defer until someone authors the comments. *Reason: scope explosion (content authoring vs UI work).*
- **Daily puzzle of the day / leaderboards / multiplayer** — engagement loops for a paid product. Out of scope for a local-first learning app. *Reason: scope.*
- **Eval bar `aria-live="polite"` on every cp tick** — would scream every 200ms during engine search. Make it `aria-live="off"` on the bar; only the post-move classification toast is `polite`. *Reason: critique §1.4 actually contradicts itself here; live regions on continuously updating values are an a11y antipattern.*
- **Auto-play board animation in Openings Browse** — defer in favour of step-on-click. `prefers-reduced-motion` users would need the manual mode anyway, so build that first. *Reason: avoid building two interaction modes.*

---

## Ship checklist — when is the redesign "done"?

The redesign ships when *every* item below is checked. Anything in P2 above is bonus polish, not part of "done".

- [ ] Cross-cutting: `src/copy/labels.ts` exists with `THEME_LABELS`, `STRENGTH_PRESETS`, `TB_VERDICT_TO_TEXT`, `MISTAKE_EXPLANATION`, `formatBranchPath`.
- [ ] Cross-cutting: `<TrainerLayout>` used by all 4 trainer routes. Single source of grid/padding/scroll.
- [ ] Cross-cutting: every screen has at most ONE filled `Button` (variant=default) on screen at a time. Audit by greping for `bg-accent`.
- [ ] Cross-cutting: no `<h1 class="text-3xl">` exists on any trainer route.
- [ ] Cross-cutting: `<Toaster />` mounted in `Layout.tsx`.
- [ ] **Play**: 3 strength preset cards visible; raw movetime/depth/skill knobs only inside a `Dialog`. Blunder toast fires when player drops 200cp+ vs previous eval. Game Review `Sheet` opens on game over.
- [ ] **Tactics**: `themes` array persisted on every attempt (`Tactics.tsx:152` reads `active.row.themes`). Theme picker is a grouped `Popover` using `THEME_LABELS`. Rating chip top-right with delta animation. Streak chip beside it. Hint is small ghost; Show solution is a `link` with confirm.
- [ ] **Openings**: `Tabs` for Browse/Drill/Mistakes. Browse has clickable PGN + step pad. Drill wrong shows `Toast` with "Try again from here" (not full reset). Sidebar shows per-opening `<Progress>` and DUE pills. Drill walks `enumerateLines`, not just heaviest path.
- [ ] **Endgames**: verdict strip docked above board with plain-English text. Per-move list shows `?!`/`??` only on mistakes with one-line reasons. Hint says "Move your king to c2 — fastest mate." not raw DTZ. Sidebar has stars + curriculum lock.
- [ ] **Dashboard**: "What to work on" callout at top. KPI cards have weekly deltas. Per-theme accuracy bars present. Activity heatmap replaces the puzzles-per-day bar chart. Rating line chart replaces the avg-rating bar chart. Openings + Endgame mastery panels present. Wipe button in `Collapsible` settings section with `AlertDialog` confirm.
- [ ] **Layout**: nav sticky + backdrop-blur. (Dark mode + cmd-k are nice-to-have, not blocker.)
- [ ] **A11y smoke test**: Tab through every screen → all interactive elements reachable, focus rings visible. Run axe DevTools → zero criticals.
- [ ] **Visual regression**: at 1080p laptop, the board occupies >=520px square on every trainer route.

When all the above are checked, the redesign is done. Ship it.
