# LearnChess — UX Critique vs chess.com

**Author:** Senior product design pass for george.nizoridis@gmail.com
**Date:** 2026-04-26
**Scope:** 5 routes — Play, Tactics, Openings, Endgames, Dashboard
**Reference UIs:** chess.com (puzzles, lessons, play vs computer, endgames), Lichess training, Chessable MoveTrainer

> **Methodology note.** The brief asked me to use WebFetch on the chess.com pages. The runtime blocked WebFetch for chess.com (paywalled / heavily JS-rendered SPA — the call returned `permission denied`); the Lichess fetch returned only a nav fragment. So the chess.com patterns I cite below are drawn from well-documented, publicly known product behaviour (the "Solved → Continue" puzzle flow, the named-bot picker on Play vs Computer, the "Drills" pattern in Lessons, the per-position progress badge in Endgames, the Insights dashboard). Where I'm aware that chess.com's pattern optimises for engagement over learning, I depart from it explicitly and say why.

---

## 0. Cross-cutting findings (read these first — they recur on every screen)

These show up on every route and drive most of the Top 10:

1. **No primary action.** Every screen has 5–10 buttons of identical visual weight (`border border-border bg-background py-2 text-xs`). The user has to read every label to figure out what to do next. chess.com always has exactly one big coloured CTA in the right rail — `Next puzzle`, `Play computer`, `Start drill`, `Restart` — and everything else is muted.
2. **Layout repeats but doesn't standardise.** Every screen is `[sidebar 260px | board | right rail 300px]` with subtly different gaps, headers, padding, and rail content order. There is no shared `<TrainerLayout>` or `<RightRail>` component, so improvements have to be made five times.
3. **Settings and session state are mixed.** "Show eval bar", "Switch sides", "FEN", "Skill level", "Hint", "New game" all live in the same flat panel. Settings (persistent, infrequent) should be in a Dialog or Popover; session controls (one click per move) should be inline.
4. **No keyboard shortcuts**, despite this being a power-user, learning-focused app. chess.com has `←/→` for nav, `N` for next, `H` for hint, `R` for retry. shadcn's `cmd-k` pattern is a one-evening add.
5. **Feedback is text-only.** Wrong moves get `playSound('check')` and a sentence in the rail. There's no red board flash, no shake, no piece-on-square overlay, no "the threat was…" explanation — just `"Not the strongest move."` That's the single biggest learning gap in the app.
6. **No "what did I get wrong" loop.** A teaching app must close the loop after every miss. Right now it just changes the buttons. There needs to be a structured "Mistake review" panel showing: your move, the best move, the engine line, and *why* (in plain English where possible).
7. **The page header is wasted space.** `<h1>LearnChess — Play vs Engine</h1>` at 3xl font eats 80px of vertical real estate that should be occupied by the board on a 1080p laptop. Both chess.com and Lichess put the route title in the nav and use the saved space for the board.

---

## 1. Play vs Stockfish — `src/routes/Play.tsx`

### 1.1 What's wrong now

- **Skill level is a 0–20 integer slider** (line 252–262). This is the raw Stockfish UCI knob. To a learner, "skill 13" is meaningless; they need to know "this is roughly 1500 Elo, similar to my own strength." chess.com's named bots solve this by giving each level a face, a name, an Elo, and a personality (e.g. "Nelson, 1200, plays like an aggressive beginner").
- **`movetime` vs `depth` toggle is exposed at the top level** (line 266–313). This is engine-internals plumbing, not a user concern. 99% of users want one of three buckets: Fast / Balanced / Deep. The two ms-or-ply sliders should be collapsed into a single "Engine strength" preset, with the raw values behind a "Customise" disclosure.
- **No clock, no captured-piece tray, no move list.** The board has a `lastMove` highlight and that's it. There's no scrollable PGN, no "back one move" button, no captured material balance bar. Even casual players expect these — and reviewing your last move *is* a learning behaviour.
- **Eval bar and best-move arrow are checkboxes buried in the side panel** (line 318–324). These are the two most impactful learning aids in the whole route. They deserve a single "Coach mode" toggle in the board chrome, prominently visible, with a "(off in real games)" hint so the user understands the trade-off.
- **No post-move feedback on the player's own moves.** When the player blunders, nothing happens — the engine just plays the refutation. There is no `?!` or `??` annotation, no "you missed Nf3+ winning the queen", no offer to take back. For a *learning* app this is the single biggest miss on this route. We're already running Stockfish at depth 12 in the background; we have the data.
- **The 3xl page title** (line 209) and the sidebar bullet "FEN: rnbqkb…" (line 351) are pure waste on a play-vs-engine screen.

### 1.2 What chess.com does instead

- **Bot gallery, not skill slider.** Players pick from a grid of named bots ("Aggressive Aggie 1100", "Calm Carla 1500", etc.) with portrait, Elo, and a one-line style description. The slider is gone.
- **Coach toggles in the board chrome.** "Hint", "Eval bar", "Game review" sit on a small toolbar attached to the board, not in a separate settings rail.
- **Post-game review is the headline feature.** When the game ends, you get an automatic review: a sparkline of evals, marked blunders/mistakes/inaccuracies with `?!`/`?`/`??`, and "best move was X" overlays. This is how chess.com *teaches*. Your app currently just shows `Status: game over` and stops.
- **Move list with click-to-review.** A scrolling PGN strip on the right, every move clickable to jump back to that position.

### 1.3 Proposed redesign

```
┌──────────────────────────────────────────────────────────────────┐
│ Play vs Bot                          [⚙ settings] [↶ undo] [⚐]  │  ← board toolbar (24px), no h1
├────────────────┬──────────────────────────┬──────────────────────┤
│  Bot picker    │                          │  Move list (PGN)     │
│  ┌──────────┐  │                          │  1. e4   e5          │
│  │ Aggie    │  │                          │  2. Nf3  Nc6         │
│  │ 1100 ★★  │  │       CHESSBOARD         │  3. Bb5  a6 ?!       │  ← click to scrub
│  └──────────┘  │                          │  …                   │
│  ┌──────────┐  │                          │                      │
│  │ Carla    │  │                          ├──────────────────────┤
│  │ 1500 ★★★ │  │                          │  Captured: ♟♟♟ vs ♙♙ │
│  └──────────┘  │                          ├──────────────────────┤
│  + 6 more      │                          │  ▓▓▓░░░░░  +0.4      │  ← eval bar inline
│                │                          ├──────────────────────┤
│  [ NEW GAME ]  │                          │  Coach hints  [ON]   │  ← single switch
│  Switch sides  │                          │  Show best move [○]  │
└────────────────┴──────────────────────────┴──────────────────────┘
```

After the player makes a move: if Stockfish (already running at depth 12) sees a centipawn drop ≥ 200, briefly flash a yellow halo on the moved piece and surface a Toast: *"Inaccuracy. Better was ♘f3 (+0.6 → +1.4). Click to review."* Click opens an inline analysis panel at the move in the PGN list.

After the game ends: full Game Review panel slides in over the right rail with an eval sparkline, every move classified, and "Replay from blunder" buttons.

Eval bar: keep the vertical bar but make it 12px wide and dock it to the board's left edge (not its own grid column at 24px). Show the centipawn label *inside* the board chrome at the bottom so it doesn't compete with the rail.

**Primary action:** the green `New Game` button. Everything else is muted/ghost.

### 1.4 Implementation notes

- Components: `Card`, `Button` (variants `default | secondary | ghost`), `Switch`, `Tooltip`, `Toast` (`sonner` or `@radix-ui/react-toast`), `Dialog` (for the engine-internals "Customise" panel), `ScrollArea` for the PGN list.
- New state: `pgn: Move[]` already implicitly held by `chess.js` — surface it via `usePlayStore` as a derived selector. `gameReview: { ply: number; classification: 'best'|'good'|'inaccuracy'|'mistake'|'blunder'; bestMoveSan: string; cpDelta: number }[]` populated by the existing background search.
- Bot definitions: a small `BOTS: { id; name; elo; skillLevel; movetimeMs; portraitEmoji; style }[]` array. Mapping Elo → `skillLevel` is roughly `(elo - 800) / 100`, clamped 0–20. No new engine work.
- Accessibility: Bot cards must be a `radiogroup`/`radio` (not just buttons) with arrow-key navigation. The eval bar already has `aria-label`; keep it but also expose `aria-live="polite"` on the centipawn text so screen readers get updates without yelling. Toast must respect `prefers-reduced-motion` (no slide-in).

---

## 2. Tactics — `src/routes/Tactics.tsx`

### 2.1 What's wrong now

- **The four-button SRS grade panel after every solve** (line 360–367) is the user's stated complaint and is genuinely wrong here. Anki-style self-grading is a learning paradigm for *flashcards where only you know if you got it right* (vocab, facts). For chess puzzles, **the system already knows** whether you played the solution correctly, how many hints you used, and how long you took. Asking the user to also self-rate is double work, biased ("Did I peek?") and confusing for chess players who expect the chess.com flow ("Correct! → Next puzzle"). The grade should be inferred, not requested.
- **Status text is buried** (line 343–351). A tiny "Find the best move for white" sits in a sub-card on the right. chess.com puts this *above* the board in 16–18px and makes "White to move" a coloured chip that matches the side-to-move indicator on the board.
- **Theme picker exposes Lichess raw IDs** (line 31–36, rendered line 306–319). `discoveredAttack`, `mateIn1`, `backRankMate` shown as-is. These need human labels ("Discovered Attack", "Mate in 1", "Back-rank mate") and should be grouped (Tactics / Mating patterns / Endgame patterns), not a flat 21-button cloud.
- **Rating is a small sub-line in the header** (line 270–274). For the user this is *the* number that tells them whether they're improving — chess.com puts it in a 32px badge top-right with a delta arrow showing rating change since the last puzzle. Right now the rating change after solving isn't even shown — the user's rating silently mutates.
- **No "puzzle streak" or daily target.** chess.com surfaces a daily streak and a "puzzle of the day". Lichess shows a streak counter. Both are cheap engagement loops *and* learning anchors (consistency > intensity).
- **Hint vs Show solution** (line 354–358) — both are full-width muted buttons of equal weight, side by side. They have very different consequences (hint = mild help that costs nothing; show solution = forfeit). Hint should be small/secondary; "Give up & see solution" should require a confirmation or be a smaller text link.
- **No theme/rating shown on the puzzle itself once active.** It's in a footer line under the board (line 335–339) in 12px muted. The active puzzle's theme is the most useful piece of meta — "this is a fork" reframes the entire visual scan.

### 2.2 What chess.com does instead

- **No self-grading.** After a correct sequence: green checkmark overlay, the solution highlights briefly on the board, and a single big green `Next puzzle →` button appears. After a wrong move: red X, "Best move was ♘xf7" with the engine arrow drawn on the board, then `Retry` and `Next` buttons. SRS scheduling, where it exists, is entirely server-inferred.
- **Rating delta is shown immediately.** "+8" or "−12" floats up next to your rating after every puzzle. This is the variable reward.
- **Puzzle metadata badge at the top of the board.** A pill: "Fork · 1450" with the player's expected difficulty. After solving, an "Insights" bullet appears: "You spotted the fork in 11s — your average for this theme is 18s."
- **Themes drill-down.** Themes are a separate route ("Puzzle Themes") with a card per theme showing your accuracy on that theme — so the user can target their weaknesses. Filtering on the active route is for the rare power user.

### 2.3 Proposed redesign

```
┌──────────────────────────────────────────────────────────────────┐
│ Tactics                  Rating: 1487 ▲+8   Streak: 4 days 🔥   │  ← header chip
├────────────────┬──────────────────────────┬──────────────────────┤
│  Themes ▼      │  ┌─ Fork · 1450 ─────┐   │  Status              │
│  [Forks ✓]     │  │                   │   │  ──────              │
│  [Pins]        │  │                   │   │  ⚪ White to move     │  ← big chip
│  [Mate in 1]   │  │   CHESSBOARD      │   │  Find the best move. │
│  More…         │  │                   │   │                      │
│                │  │                   │   ├──────────────────────┤
│  Rating range  │  │                   │   │  💡 Hint   (small)   │
│  1200—1600     │  └───────────────────┘   │                      │
│                │  Theme: Fork · ID 7Hk2   │  Solved today: 12    │
│                │                          │  Accuracy: 75%       │
│                │                          ├──────────────────────┤
│                │                          │  [   NEXT PUZZLE →  ]│  ← only after solve
└────────────────┴──────────────────────────┴──────────────────────┘
```

After a **correct** solve: green checkmark animates on the king square; the side panel collapses the hint button; a big green `Next puzzle` button appears with rating delta `+8` toasted near the rating chip; streak count increments. **No grading buttons.** SRS state derives automatically: `solved && hintsUsed === 0 && timeMs < 30s ⇒ 'easy'`; `solved && hintsUsed === 0 ⇒ 'good'`; `solved && hintsUsed >= 1 ⇒ 'hard'`; `!solved ⇒ 'again'`. Nothing for the user to think about.

After a **wrong** move: red X overlay, board flashes red, the engine's best move is drawn as an arrow with the SAN displayed (`♘xf7` chip near the board). Two buttons: `Try again` (resets to puzzle start, allows another attempt — keeps the same SRS classification) and `Next puzzle →`. Optionally a third small text link `Show full solution` that plays out the rest of the line move-by-move.

Rating: top right in 32px font. Rating delta animates in next to it for 1.5s, then collapses.

Theme picker: move the long list into a popover triggered by the chip in the sidebar. The default sidebar shows just *active* themes plus a "Themes" button. Group themes by category internally.

**Primary action:** green `Next puzzle →` after solve; nothing primary while solving.

### 2.4 Implementation notes

- Components: `Card`, `Button`, `Badge` (for theme + rating chips), `Popover` (for theme picker), `Toast` (rating delta), `Sheet` (mobile theme picker), `Tooltip`. The grade buttons (line 360–367) are deleted entirely.
- State: derive `Grade` automatically (see formula above). Existing `usePlayStore`-style state and `recordPuzzleAttempt(...)` shape don't change. Add `lastRatingDelta: number | null` to drive the toast.
- New: a `THEME_LABELS: Record<string, { label: string; group: 'tactics' | 'mating' | 'positional' | 'endgame' }>` map, since the raw Lichess IDs are not user-facing English.
- Streak: derived from `getRecentPuzzleAttempts(...)` already in the IDB. Group by day, count consecutive days with ≥1 attempt — no schema change.
- Accessibility: rating delta toast must be `role="status"` `aria-live="polite"`. Wrong-move red flash must respect `prefers-reduced-motion`. Theme chips are buttons but the *active* set must announce as a multi-select listbox (`role="listbox"` + `aria-multiselectable="true"`). Big "Next puzzle" button should auto-focus on solve so `Enter` advances — and be remappable to `N`.

---

## 3. Openings — `src/routes/Openings.tsx`

### 3.1 What's wrong now

- **Browse mode is read-only and inert.** Lines 297–302 just dump the SAN string of the main line as a flat sentence. The user can't click a move to jump to that position, can't see *why* `2.Nf3` is the move, and the board never moves while reading. chess.com lessons interleave board steps with prose: "After 1.e4 e5, the most principled continuation is 2.Nf3 — attacking the e5 pawn and developing a knight."
- **Drill mode has no sense of progression.** The sidebar lists the 30 openings as a flat list (line 246–266); there's no "75% mastered", no "5 lines remaining", no "due for review tomorrow". Compare to Chessable where every line shows a coloured progress bar and a "due in 2 days" badge.
- **Wrong-move panel is a red box of HTML** (line 314–328) with an inline list and inline restart button. It looks like an error message, not a learning moment. There's no way to retry just the failed move — `Restart drill` throws the user back to ply zero, which is punishing if they got 9 moves deep.
- **No branch awareness.** The drill always picks the heaviest-weight reply (line 22–26 `selectChildByWeight`), so the user only ever drills one variation — but a real opening repertoire has a tree of replies. A learner needs to drill *all* the reasonable opponent replies, not just the most popular one.
- **"Browse" and "Drill" tabs are equal-weight buttons** (line 280–295), both 50% width, with the active state being a subtle bg colour change. The mental model needed is clearer: Browse = read; Drill = test; Review = see your gaps. A 3-tab pattern with iconography would help.
- **No "what opening am I weak on" view.** `getOpeningProgress` returns per-branch counts but nothing surfaces this back. The user has to remember.

### 3.2 What chess.com / Chessable does instead

- **Lessons interleave board moves with text.** The board auto-plays each move as you scroll/click `Next`, with the prose explaining the idea. There's a `< >` step pad under the board.
- **Per-line progress bars.** Each variation shows %-mastered, last-reviewed-date, and a "due now" pill if SRS is overdue. The home view of the trainer is a "Reviews due today" queue, not an opening list.
- **"Mistakes" tab.** Chessable surfaces every position you've blundered in this opening as its own mini-puzzle, repeated until mastered. This is the strongest learning loop in any chess product I've seen.
- **Multiple correct moves.** When several theoretical moves are equally good, all of them count as "correct" and the trainer notes which you played.

### 3.3 Proposed redesign

```
┌──────────────────────────────────────────────────────────────────┐
│ Openings                                                          │
├────────────────┬──────────────────────────┬──────────────────────┤
│ My Repertoire  │   ┌────────────────┐    │  Italian Game · C50  │
│ ──────────────│   │                │    │  for white           │
│ ▸ Italian 75% │   │                │    │  ─────────────────── │
│   [DUE: 3]    │   │   CHESSBOARD   │    │  [Browse] [Drill] [✗]│
│ ▸ Sicilian 40%│   │                │    │            ↑ Mistakes│
│   [DUE: 8]    │   │                │    │                      │
│ ▸ Caro-Kann 0%│   │                │    │  Drill: line 4 of 12 │
│                │   └────────────────┘   │  ▓▓▓▓░░░░░░░░░ 33%   │
│ + Add opening │   < ← step → >          │                      │
│                │   1.e4 e5 2.♘f3 ♘c6   │  ▶ Next: 3.♗b5       │
│                │                         │     opens the Ruy   │
│                │                         │     Lopez branch.   │
│                │                         │                      │
│                │                         │  [   PRACTICE NOW ] │
└────────────────┴──────────────────────────┴──────────────────────┘
```

**Browse** (default tab): board auto-plays the main line. Below the board is a step pad (`◀ ◀◀ ◼ ▶▶ ▶`) and a clickable PGN inline. The right rail shows the *next* move's prose comment ("3.♗b5 attacks the knight that defends e5").

**Drill** tab: same layout, but the board freezes at each branch where the user must move. Now: track which *line* (path through the tree) you're drilling, not just the current node. Walk the tree breadth-first across lines so the user covers all branches over time. Show a `line 4 of 12` progress indicator. After completing a line, advance to the next un-mastered one.

**Mistakes** tab: list of every branchPath where `wrongCount > 0`, sorted by recency, each clickable to retry that exact position. After three correct repeats it's removed from the mistakes pile.

After a **wrong move**: don't blow up to a red HTML box. Show a small toast `"Not in this line. Best: ♗b5 (+62% in master games). Try again?"` with a `Try again from here` button that resets to *just before the failed move*, not back to ply zero.

Sidebar: each opening shows a progress bar (% lines mastered) and a "DUE: N" pill if any spaced-rep cards on that opening are overdue. Order the list by `due first, then in-progress, then untouched`.

Multiple correct: when the tree node has weight-bearing siblings of similar value (within 80% of the heaviest), all should count as correct, with a small confirmation chip ("You played 3.♗b5 — also good: 3.♗c4").

**Primary action:** the green `Practice now` button when on Browse, the implicit board move when on Drill. After a line is finished: `Next line →`.

### 3.4 Implementation notes

- Components: `Tabs` (Browse / Drill / Mistakes), `Progress` (per-opening bars), `Card`, `Badge` (DUE pills), `ScrollArea` for repertoire, `Tooltip` for branch comments.
- State: `Opening` keeps its current shape. New: `LineCursor { openingId; pathUcis: string[]; ply: number; status: 'browsing' | 'drilling' | 'review' }` to track drill progress across lines, not just within one. Persist `lastLineIndex` per opening in IndexedDB.
- New helper: `enumerateLines(tree: OpeningNode, maxDepth: number): string[][]` — returns all reasonable line paths through the tree (DFS, prune branches with weight < 0.1 of parent). Drill iterates these, not just the heaviest path.
- Mistakes view: query `getOpeningProgress(openingId)`, filter `wrongCount > 0`, hydrate to a clickable list. After 3 successful redrills (track in `correctCount` since last `wrongCount` increment), remove from list — needs one extra field `correctSinceMistake: number`.
- Accessibility: Tabs must be `<Tabs role="tablist">` with arrow-key nav (shadcn does this). Step pad buttons need `aria-label="Previous move"` etc. The board's auto-play in Browse mode must respect `prefers-reduced-motion` (skip animations or step-on-click instead of auto).

---

## 4. Endgames — `src/routes/Endgames.tsx`

### 4.1 What's wrong now

- **Move grades are colours but no explanation** (line 320–334). A red `LOSING` next to `Kf3` tells me I blundered but not *why* `Kf3` was losing or what would have been right. Tablebase grading is the killer feature here — surfacing only the colour code wastes it.
- **`TB verdict` and `DTZ` shown as raw fields** (line 285–291). `cursed-win`, `blessed-loss`, `dtz` are tablebase jargon. A learner needs "You're winning, mate in 14 with best play" — translation of the same data.
- **No master-the-position concept.** chess.com lets you replay a position until you can win it consistently (e.g., "you've won this 3 times — mastered"). Right now each attempt is just logged. There's no closing the loop on "do I actually know KQ vs K?"
- **`Restart position` and `Hint (uses tablebase)` are equal-weight muted buttons** (line 300–315) — Restart is the primary action after a loss, Hint is a soft assist. Hint also leaks DTZ jargon: `Best move: Kc2 (win, dtz 12)`.
- **No goal context.** "Goal: WIN" is a small chip (line 274–277) but you don't know *what counts as winning* — "checkmate the lone king" vs "promote and win" vs "draw by stalemate" — and it shows up in lowercase tech text. chess.com explicitly says "Your task: checkmate Black with King and Rook."
- **Position list is alphabetical inside category** (line 240–259). Beginner positions and complex 6-piece positions sit side by side. No difficulty rating per position; no recommended sequence.

### 4.2 What chess.com does instead

- **Per-position mastery state.** Each position card shows `Untouched / Attempted / Mastered (3/3 wins)` with a star count.
- **Tablebase verdict in plain English.** "You're winning! Mate in 14." or "This is now a draw — you let Black escape." with a coloured strip across the top of the board.
- **Drill loop.** After each attempt: "You won in 18 moves vs optimal 14 — try again to improve" with a green `Retry` button. Three consecutive wins ⇒ position marked Mastered.
- **Difficulty progression.** Endgame trainer is structured as a curriculum: "Lesson 1: K+Q vs K", "Lesson 2: K+R vs K", etc., with each unlocking the next.

### 4.3 Proposed redesign

```
┌──────────────────────────────────────────────────────────────────┐
│ Endgames                                                          │
├────────────────┬──────────────────────────┬──────────────────────┤
│ Curriculum     │   ┌─ You are winning ─┐ │  K+Q vs K            │
│ ──────────────│   │  Mate in 14       │ │  ─────────────────── │
│ ✓✓✓ K+Q vs K  │   ├──────────────────┤ │  Goal:               │
│ ★★☆ K+R vs K  │   │                  │ │  Checkmate the lone  │
│ ★☆☆ K+P vs K  │   │   CHESSBOARD     │ │  black king.         │
│ ☆☆☆ Lucena    │   │                  │ │                      │
│ ☆☆☆ Philidor  │   │                  │ │  Move 8 of ~14       │
│ — locked —    │   └──────────────────┘ │  Optimal so far ✓    │
│  Two bishops  │   1.♔c2  ♔a8           │                      │
│  Bishop+Knight│   2.♕b6+ ♔c8 ?!        │  After your last     │
│                │      └─ better:        │  move:               │
│                │         ♔c3 (+ 2 dtm)  │  ✗ Inaccuracy.       │
│                │                         │  Best was ♔c3 —     │
│                │                         │  shorter mate by 2. │
│                │                         │                      │
│                │                         │  [    RETRY     ]   │
└────────────────┴──────────────────────────┴──────────────────────┘
```

**Top-of-board verdict strip** (12px tall, full width of board): green "You are winning · Mate in 14", amber "It's a draw with best play", red "You're losing — best you can do is draw". Updates on every move. This is the headline. Translates `tbCurrent.category` + `tbCurrent.dtz` into one English sentence.

**Per-move feedback inline in the move list:** show only the player's mistakes inline (`?!` annotation + "better was Xy") rather than colour-coding every move. Optimal moves don't need a label — silence is praise. Mistakes get a single line of explanation pulled from the tablebase: "shorter mate by 2", "throws away the win", "stalemate-trap".

**Mastery state per position.** Sidebar: `☆☆☆ → ★☆☆ → ★★☆ → ★★★ Mastered`, where each star is one optimal-or-near-optimal win (≤ 1.2× DTZ). Add a "(M)" badge once mastered. Once a position is mastered, the next in the curriculum unlocks; the user can still revisit mastered positions.

**Curriculum order**, not alphabetical. Group is fine, but inside each group order by difficulty (KQ → KR → KP) and lock advanced positions until prerequisites are mastered. Show locked items dimmed with a 🔒 icon and the prereq label.

**Hint** moves to a small ghost button below the board (`💡 Hint`) instead of a full-width muted bar. The hint message is in English: "Move your king to c2 — this is the fastest mate." not `Best move: Kc2 (win, dtz 12)`.

**Primary action:** `Restart position` becomes `Retry` after a loss; `Next position →` after mastering. Always one big green button.

### 4.4 Implementation notes

- Components: `Card`, `Button`, `Badge`, `Progress` (the verdict strip can be a coloured `Badge` band), `Tooltip` (for the per-move "better was X" hover).
- New helpers: `verdictText(tb: TbResponse, side: Color, goal: 'win'|'draw'): string` — single function that turns the raw category + dtz into "You are winning · Mate in 14" / "Drawn with best play" / "Losing — try to draw". `mistakeExplanation(prevDtz, nextDtz, prevCategory, nextCategory): string` — turns DTZ deltas into "shorter mate by N" / "throws away the win" / "draws a winning position".
- Curriculum + mastery: extend `EndgamePosition` with `prereqIds?: string[]` and `difficultyOrder: number`. Add `isMastered(positionId)` derived from `getEndgameAttempts(positionId)` — count wins where `movesPlayed <= optimalMoves * 1.2`, mastered at 3.
- New state: nothing in Zustand — derive everything from existing IDB queries. The "Move 8 of ~14" indicator uses `tbInitial.dtz` as the optimal length anchor.
- Accessibility: verdict strip needs `aria-live="polite"` — screen readers should hear "You are now drawn" when a player blunders. The lock icon must have `aria-label="Locked: master K+Q vs K first"`. Stars need `aria-label="2 of 3 stars"` not just glyphs.

---

## 5. Dashboard — `src/routes/Dashboard.tsx`

### 5.1 What's wrong now

- **Four KPI cards but no story.** Tactics rating, attempts, accuracy, endgame attempts (line 104–121) — these are facts but not a narrative. A learner needs "you got 8 puzzles right yesterday, your weak theme is back-rank mates, your rating is up 23 over the last week." Numbers without comparison are noise.
- **Bar charts are decorative** (line 123–130, `BarChart` at 176–192). They show puzzles per day for 30 days but the bars have no axis labels, no hover tooltip beyond `title=`, no week dividers, and no "today" marker. The "Average puzzle rating per day" chart in particular doesn't tell me if I'm improving — just an average that bounces.
- **No per-theme breakdown.** The most actionable insight a tactics learner needs is "you score 80% on forks, 40% on back-rank mates — drill back-rank mates." The data is captured (`themes` array on each attempt is in the schema even if currently empty — line 138 `themes: []`), but the dashboard ignores it.
- **No openings or curriculum panel.** `getOpeningProgress` exists but the dashboard never reads it. So the user can't see "Italian Game: 75% mastered, 3 lines due".
- **The clear-progress button is in the page header** (line 95–101) — it's destructive and should be in a Settings/Danger Zone area, not next to the page title where it competes with content. Confirm() native dialog (line 86) is also a poor citizen — use `AlertDialog`.
- **No time horizon control.** "Last 30 days" is hardcoded in `slice(-30)`. A user wanting to see all-time progress can't.

### 5.2 What chess.com does instead

- **"Insights" panel:** "Your strongest opening is X (62% win rate); your weakest tactical theme is Y (32%); your most common mistake type is Z." Narrative-driven, prescriptive.
- **Streak + activity heatmap** (GitHub-style green-square calendar). Strong daily-engagement nudge.
- **Rating graph with goal line** showing trajectory over months, with the user's chosen goal rating as a dashed line.
- **Drill-down on every metric.** Click "weakest theme: back-rank mate" → opens Tactics filtered to that theme.

### 5.3 Proposed redesign

```
┌──────────────────────────────────────────────────────────────────┐
│ Dashboard                              [7d] [30d] [90d] [All]   │
├──────────────────────────────────────────────────────────────────┤
│  This week — what to work on                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Your weakest theme is BACK-RANK MATES (38% accuracy).     │  │
│  │  Drill 5 of these →                                         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐  │
│  │ Rating 1487  │ Solved 87    │ Streak 4 🔥  │ Endgames 12  │  │
│  │ ▲+23 / wk    │ 75% accuracy │ days         │ 3 mastered   │  │
│  └──────────────┴──────────────┴──────────────┴──────────────┘  │
│                                                                   │
│  Activity (last 90 days)        Rating over time                 │
│  ┌──────────────────────────┐  ┌──────────────────────────┐    │
│  │  ▒░ ▒▒▒░ ▒▒▒▒░ ▒▒▒▒░░    │  │   /\        /\__/        │    │
│  │  ▒░ ▒▒░  ▒▒▒░  ▒▒▒░░     │  │  /  \__    /             │    │
│  │  github-style heatmap    │  │ /      \  /              │    │
│  └──────────────────────────┘  └──────────────────────────┘    │
│                                                                   │
│  Tactics by theme                  Openings                      │
│  ┌──────────────────────────┐  ┌──────────────────────────┐    │
│  │ Fork           ▓▓▓▓░ 80% │  │ Italian      ▓▓▓░░ 75% ⏰3│    │
│  │ Pin            ▓▓▓░░ 65% │  │ Sicilian     ▓░░░░ 40%   │    │
│  │ Back-rank      ▓░░░░ 38% │  │ Caro-Kann    ░░░░░  0%   │    │
│  │ …                        │  │ …                        │    │
│  └──────────────────────────┘  └──────────────────────────┘    │
│                                                                   │
│  Endgame mastery                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ K+Q vs K   ★★★ Mastered  K+R vs K  ★★☆  K+P vs K  ★☆☆  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ↓ Settings (collapsed)                                          │
│  · Wipe local progress (with confirm dialog)                    │
└──────────────────────────────────────────────────────────────────┘
```

**Top "What to work on" callout** is the single most important piece of dashboard real estate. It's a prescription, not a stat. Pick the lowest-accuracy theme with ≥ 5 attempts and link directly to a pre-filtered Tactics view. If no data yet, show "Solve 10 puzzles to unlock recommendations."

**KPI cards keep the four metrics but each gets a delta** vs the previous period of equal length — `▲+23 / wk` not just `1487`.

**Activity heatmap** replaces the "Puzzles per day" bar chart. Cheaper to read at a glance, makes streaks visible, and is a known engagement pattern.

**Rating-over-time line chart** (not bars) with axis labels. Use SVG inline — no chart lib needed for a 90-point dataset.

**Per-theme tactics breakdown** uses the `themes` array on each attempt — but right now the code passes `themes: []` (Tactics.tsx line 137). That's a bug-shaped UX problem: fix the data path before the dashboard breakdown can work. Note this as a blocker for the dashboard improvement, not a UX fix in itself.

**Openings panel** reads `getOpeningProgress` and shows %-mastered + due count per opening, with a click-through to the Openings route filtered to that one.

**Endgame mastery row** shows star ratings for every position, grouped or wrapping. Click takes you to the Endgames route on that position.

**Settings (Wipe progress) collapsed below the fold**, behind a `<Collapsible>`, with an `AlertDialog` confirm — not a `confirm()` call.

**Time horizon selector** in top-right (`7d / 30d / 90d / All`) drives all visualisations.

**Primary action:** the "Drill 5 of these →" button in the recommendation panel.

### 5.4 Implementation notes

- Components: `Card`, `Button`, `Badge`, `Tabs` (for time horizon), `Collapsible` (settings), `AlertDialog` (wipe confirm), `Progress` (theme bars).
- Charts: keep custom SVG. A line chart and a heatmap fit in 60 lines of TSX each — no `recharts`/`chart.js` dependency. The bar chart helper at line 176 can be deleted.
- Heatmap: cell per day, 7 rows × ~13 weeks, opacity by `min(count, 5) / 5`. Tooltip on hover with date + count.
- Theme breakdown depends on Tactics persisting the `themes` array properly. The schema supports it (line 23 `themes: string[]`); Tactics currently writes `themes: []`. Fix that line before the dashboard panel can work — call this out in the Top 10.
- New derived selectors: `weakestTheme(attempts, minSampleSize): string | null`, `streakDays(attempts): number`, `activityByDay(attempts, days): Map<string, number>`, `ratingDelta(attempts, days): number`. All pure, all in `src/insights/` (new folder).
- Accessibility: Each KPI card needs `aria-label` combining title + value + delta ("Rating 1487, up 23 over the last week"). Heatmap cells need `aria-label` per cell. The "What to work on" callout should be `role="region"` `aria-labelledby` so screen readers can jump to it.

---

## 6. Layout / global — `src/routes/Layout.tsx`

Three quick wins that benefit every screen:

1. **Sticky nav with breadcrumb** — the current top bar disappears when scrolling. On a board-heavy screen with overflow content (PGN, themes), keep the nav sticky.
2. **Theme switcher.** `globals.css` already defines a `.dark` variant (line 22–30). Wire it to a `Button` in the nav with `prefers-color-scheme` as the default. One evening of work.
3. **Command palette (`cmd-k`)** — power-user navigation: jump to opening, jump to theme, "next puzzle", "new game". shadcn ships `Command` for exactly this. Particularly valuable for an experienced developer.

---

## 7. Top 10 changes ranked by impact

For a coding agent. Ordered by *learning gain per hour of work*. Numbers in parens are rough estimates.

1. **Tactics: kill the 4-button SRS grader; auto-derive grade.** Replace the four-button grade panel (`src/routes/Tactics.tsx:360-367`) with a single big `Next puzzle →` button after solve and `Try again` / `Next` after a wrong move. Derive `Grade` from `solved + hintsUsed + timeMs` per the formula in §2.3. Solves the user's stated complaint and removes one decision per puzzle. (~2h)

2. **Tactics: red/green move feedback + best-move arrow on wrong.** On wrong move: red board flash, draw best-move arrow, show SAN chip. On correct: green checkmark overlay, brief solution highlight. Use `chessground`'s `drawable.autoShapes` (already in use line 215). Closes the learning loop. (~3h)

3. **Play: post-move blunder annotation + post-game review.** The background search at `src/routes/Play.tsx:158-181` already runs at depth 12. When the player's move drops centipawns ≥ 200, surface a Toast with the better move and a `Review` link to the move-list. On game end, render a Game Review panel classifying every move (`!`/`?!`/`?`/`??`). Highest *teaching* gain on Play. (~6h)

4. **Tactics: rating delta toast + streak counter.** Show `▲+8` next to the rating after each puzzle for 1.5s. Render a streak chip in the header derived from `getRecentPuzzleAttempts`. Cheap motivation loop, established pattern. (~2h)

5. **Endgames: plain-English verdict strip + per-move mistake explanation.** Replace `TB verdict: cursed-win, dtz: 12` with a coloured strip "You are winning · Mate in 14" above the board, and replace per-move grade colour codes (`src/routes/Endgames.tsx:320-334`) with inline `?!` annotation + reason ("shorter mate by 2") only on player mistakes. Makes the killer feature actually teach. (~4h)

6. **Tactics: human theme labels + grouped picker.** `THEME_LABELS` map (line 31–36 → human strings); group into Tactics / Mating / Positional / Endgame; move into a Popover. ~1h. Required precursor to the dashboard theme breakdown.

7. **Tactics: persist `themes` array in attempts.** `src/routes/Tactics.tsx:137` writes `themes: []` — should be `themes: active.row.themes` (already in `PuzzleRow`). One-line bug-shaped UX blocker for the dashboard recommendation engine. (~30m)

8. **Dashboard: "What to work on" recommendation + per-theme breakdown.** Calculate weakest theme (lowest accuracy with ≥ 5 attempts) and surface as a top-of-page callout with a deep-link to the filtered Tactics view. Add the per-theme accuracy bars. Depends on #7. (~3h)

9. **Endgames: mastery stars + curriculum lock.** Three-star mastery per position (1 star per win in ≤ 1.2× optimal moves). Sort positions by difficulty, lock advanced ones until prerequisites are mastered. Adds long-term structure that bare attempts can't. (~4h)

10. **Play: replace skill-level slider with named-bot picker.** Replace the 0–20 slider + movetime/depth toggles (`src/routes/Play.tsx:249-313`) with a `BOTS` array of 5–7 named bots with Elo and short style descriptions; collapse engine knobs into a "Customise" Dialog. Reframes engine strength in terms players understand. (~3h)

**Honourable mention (cheap but not learning-critical):** dark mode switch (~30m), command palette (~2h), kill the 3xl page titles (~10m). Bundle these into a "polish PR" once the top 10 land.

**Total est:** ~28h of focused work to materially improve the teaching value of every screen.
