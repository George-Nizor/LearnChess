# Opening Trainers — Reverse-Engineering Brief

**Compiled:** 2026-04-26
**Purpose:** Steal the best ideas from existing chess opening trainers so we can build a local-first clone for personal use. Three references: **chessdriller** (open-source, the actual Chessable analogue), **chessreps** (closed-source, modern UX), **Chessable** (commercial gold standard).
**Note:** The user requested research on `litrainer` assuming it was an opening-rep trainer. It is not — it is a Lichess **post-game blunder** trainer (analyses your own losses with Stockfish and replays your mistakes as puzzles). Its mode mechanics and data model are not transferable to opening-rep training, so the actual open-source reference for our brief is **chessdriller** (`gtim/chessdriller`). litrainer is documented briefly for completeness.

---

## 1. TL;DR + Recommended Pattern

Build the data model around **immutable Move records keyed by `(repForWhite, fromFen, toFen)`** — a flat table, not a tree — so transpositions automatically deduplicate. Each Move owns its own SRS state (`learningStep`, `learningDueTime`, `reviewInterval`, `reviewEase`, `reviewDueDate`). On top of that table, ship **three modes**: **Learn** (auto-play through a line with commentary, no input required), **Drill** (board waits for the user's rep move, opponent auto-replies with the heaviest reply, **wrong move auto-reverts after 250 ms with no penalty count**, and the "Show answer" button starts pulsing after 2 wrong tries), and **Test** (same as Drill but with a streak counter and no Show-answer escape hatch). SRS is Anki-style SM-2-lite with **learning steps `[0, 10 min, 1 h, 8 h]` then graduate to a 1-day review interval that multiplies by `ease` (default 2.5) on each correct review, capped at 100 days**; wrong answer resets to learning step 0 and decreases ease by 0.2 (floor 1.3). This is exactly chessdriller's algorithm and it works.

---

## 2. chessdriller — The Open-Source Reference

**Repo:** [github.com/gtim/chessdriller](https://github.com/gtim/chessdriller) — MIT-style, by Tim (gtim). Self-describes as "a free and libre alternative to the spaced-repetition features of Chessable, ChessTempo, Chessmadra, ChessHQ, Chess Position Trainer, Bookup, Listudy, etc."

### 2.1 Tech stack (for context only — we do NOT swap)

- SvelteKit + TypeScript + JavaScript mix
- Prisma ORM on **SQLite**
- Lichess OAuth (Lucia auth)
- chessground for board UI, chess.js for move logic
- GSAP for feedback animations
- Vitest + Docker

### 2.2 Data model — copy this almost verbatim

The Prisma schema (`prisma/schema.prisma`) is ~10 models. The two that matter:

```prisma
model Move {
  id Int @id @default(autoincrement())
  user User @relation( fields: [userId], references: [id] )
  userId Int
  repForWhite Boolean              // is this part of the White rep or Black rep?
  fromFen String                   // position BEFORE the move
  toFen String                     // position AFTER the move
  moveSan String                   // e.g. "Nf3"
  pgns Pgn[]                       // back-refs to source PGNs
  studies LichessStudy[]           // back-refs to Lichess studies
  ownMove Boolean                  // true = my rep move (drill it); false = opponent move (auto-played)
  learningDueTime DateTime? @default(now())   // SRS: when to show next during learning
  learningStep Int? @default(0)               // SRS: which learning step are we on
  reviewDueDate DateTime?                     // SRS: when to show next after graduation
  reviewInterval Float?                       // SRS: current interval in days
  reviewEase Float?                           // SRS: SM-2 ease factor
  deleted Boolean @default(false)
  history StudyHistory[]
  @@unique([ userId, repForWhite, fromFen, toFen ])
}

model StudyHistory {
  id Int @id @default(autoincrement())
  user User @relation( fields: [userId], references: [id] )
  userId Int
  move Move @relation( fields: [moveId], references: [id] )
  moveId Int
  studiedAt DateTime @default(now())
  incorrectGuessSan String?        // null if correct
}
```

Critical observations:

- **Flat table, not a tree.** Each move is `(fromFen, toFen)` — a directed edge. Transpositions automatically dedupe because the same `fromFen` always produces the same Move row regardless of which line led there.
- **`repForWhite` boolean** separates White rep from Black rep so the same FEN can have different rep moves depending on which side you're studying.
- **`ownMove` flag** distinguishes "my rep move" (drill candidate) from "opponent's move" (auto-played). On import, the parser walks the PGN tree and alternates.
- **`pgns` and `studies` many-to-many** track which sources contributed each move. This is what enables soft-deletion when a PGN is removed: if the move is referenced by another source, keep it; otherwise mark `deleted = true`. See `src/lib/movesUtil.js` `orphanMoveSoftDeletionsQueries()`.
- **No comments / weights / frequencies stored.** Pure move-list. Comments and weights live in the source PGN/study and are not surfaced in drill mode. This is a feature, not a bug — keeps the data model trivial.
- **`LichessStudy` and `Pgn` models** store the raw source so the Move table can be regenerated.

### 2.3 SRS algorithm — verbatim from `src/routes/api/study/move/+server.js`

Anki SM-2-lite with **two phases**: learning (sub-day, step-based) and review (days, multiplicative).

```js
const step_minutes = [0, 10, 60, 8*60];   // 0 min, 10 min, 1 hr, 8 hr
const Max_Review_Interval = 100;          // days
```

**On correct, in learning (`learningStep < 3`):** advance one step, set `learningDueTime = now + step_minutes[next] * 60_000`, increment `learningStep`.

**On correct, graduating from learning (`learningStep == 3` after increment, or learningStep was already 3):**
```js
update.reviewInterval = 1;                                  // 1 day
update.reviewDueDate = date_in_n_days(1);
update.reviewEase = move.reviewEase || 2.5;                 // SM-2 default
update.learningDueTime = null;
update.learningStep = null;
```

**On correct, in review (due):**
```js
update.reviewInterval = move.reviewInterval * move.reviewEase;
if (update.reviewInterval > Max_Review_Interval) update.reviewInterval = Max_Review_Interval;
update.reviewDueDate = date_in_n_days(update.reviewInterval);
```

**On wrong, in learning OR `reviewInterval == 1`:**
```js
update.learningDueTime = new Date();         // immediately due again
update.learningStep = 0;
update.reviewDueDate = null;
update.reviewInterval = null;
update.reviewEase = move.reviewEase ? Math.max(1.3, move.reviewEase - 0.2) : null;
```

**On wrong, in review (`reviewInterval > 1`):**
```js
update.learningDueTime = null;
update.learningStep = null;
update.reviewInterval = 0;                   // sentinel: needs re-graduation
update.reviewDueDate = new Date();
update.reviewEase = move.reviewEase ? Math.max(1.3, move.reviewEase - 0.2) : null;
```

**Selection of next due move** lives in `src/lib/scheduler.ts`:

```ts
export function moveIsDue( move: Move, now: Date ) {
  if ( ! move.ownMove ) return false;          // never drill opponent moves
  if ( move.learningDueTime ) return move.learningDueTime <= now;
  if ( move.reviewDueDate )   return move.reviewDueDate   <= now;
  throw new Error( 'invalid move state' );
}
```

`getLineForStudy()` does a BFS from the starting position, looking for due continuations, randomising tied options (`shuffleArray`, `randomElement`). Includes alternative branches via `includeBranches()`. Falls back to `randomNextMove()` for opponent replies.

### 2.4 Drill UX — the wrong-move semantic we want to copy

From `src/lib/StudyBoard.svelte` and `src/routes/study/+page.svelte`:

- User logs in, opens `/study`. Server picks a due line via `getLineForStudy()`. Board renders the start position. Board input enabled.
- User makes a move. `checkMove()` fires.
- **Correct move:** advance `last_move_ix`, POST `/api/study/move` with `{moveId, correct: true}`, server returns updated SRS interval. If interval grew, an animated "stamp" floats up from the destination square (GSAP). Then after **`Delay_before_opponent_move = 250 ms`**, `playOpponentMove()` runs — the opponent's reply auto-plays from the line.
- **Wrong move:**
  1. `chess.undo()` reverts internal state.
  2. `chessground.set({ fen: chess.fen(), lastMove: undefined })` — board snaps back, no last-move highlight.
  3. **`setTimeout(allowBoardInput, 250)`** (`Delay_before_wrong_move_undo`) — board input re-enabled after 250 ms so the user can immediately try again.
  4. `num_wrongs_this_move++`. Played-branches set is cleared.
  5. POST `/api/study/move` with `{correct: false, incorrectGuessSan: ...}` — SRS state updated server-side.
  6. **No strike count, no death penalty.** The user just keeps trying.
  7. After **`num_wrongs_this_move >= 2 && num_wrongs_this_move % 3 == 1`**, the "Show answer" button pulses (GSAP keyframe `1 → 1.15 → 0.98 → 1` over 400 ms). Pressing it reveals the correct move.

ASCII flow:

```
   user moves
       |
       v
   correct? --no--> chess.undo() -> board snaps back -> wait 250ms
       |                                  |
       |                                  v
       |                            num_wrongs++
       |                            POST /api/study/move (correct=false)
       |                            if num_wrongs >= 2: pulse "Show answer"
       |                            board re-enabled (try again)
       |
       yes
       |
       v
   POST /api/study/move (correct=true)
   show interval-grew stamp animation
   wait 250ms
   playOpponentMove() — auto-play opponent's reply from the line
       |
       v
   end of line? --yes--> wait 500ms -> studyNextLine()
       |
       no
       v
   loop
```

### 2.5 Repertoire authoring

Two import paths, both feeding the same `Move` table:

1. **Lichess Study sync** (`LichessStudy` model). User pastes/connects a study; server fetches PGN via Lichess API, parses tree (`src/lib/pgnParsing.js`), inserts each unique edge as a Move. Re-syncs on study update; diffs via `compareMovesLists()`; `LichessStudyUpdate` records what was added/removed.
2. **PGN upload** (`Pgn` model). User uploads a `.pgn` file. Same parser. Same dedup.

User chooses `repForWhite: true | false` per study/PGN at import time.

Sharing? **No.** Repertoires are per-user, stored privately. The TODO mentions tree-view visualisation but no sharing.

### 2.6 Notable TODOs (from `TODO.md`) that confirm the design intent

- "Add visual feedback for incorrect moves (shake, flash)" — they recognize the bare snap-back is too subtle.
- "Identify 'leeches' by tracking lapses" — Anki-style leech detection, not yet built.
- "Track user Lichess games and alert on out-of-repertoire moves" — closes the loop with real play.
- "Refine move ease calculations and interval increases" — they themselves flag the algorithm as imperfect.
- "Address line-scheduling transposition issues" — the BFS scheduler doesn't always pick the optimal next line when multiple lines transpose.

### 2.7 Key file paths in chessdriller

| Concern | Path |
|---|---|
| Data model | `prisma/schema.prisma` |
| SRS update math | `src/routes/api/study/move/+server.js` |
| Due-move selection | `src/lib/scheduler.ts` (`getLineForStudy`, `moveIsDue`, `bfsDueContinuation`) |
| Move/edge dedup utilities | `src/lib/movesUtil.js` |
| PGN parsing | `src/lib/pgnParsing.js` |
| Lichess study fetch | `src/lib/lichessStudy.js` |
| Drill page | `src/routes/study/+page.svelte` (state) + `src/lib/StudyBoard.svelte` (board logic) |
| Move-attempt API | `src/routes/api/study/move/+server.js` |
| Line-fetch API | `src/routes/api/study/+server.ts` |
| Feedback animations | `src/lib/MoveFeedbackStamp.svelte` |

---

## 3. chessreps — The Modern Closed-Source Reference

**Site:** [chessreps.com](https://www.chessreps.com), about page, [changelog](https://www.chessreps.com/changelog), iOS + Android apps. Closed source, no public clone exists.

### 3.1 Marketing positioning

"The Duolingo for chess." "Reps = Repetitions + Repertoire." "Science-backed spaced repetition." Sells itself on **practical reps over theoretical depth** — the lines are **mined from real moves in millions of Lichess games**, not from grandmaster theory books. Heaviest replies first.

### 3.2 Modes (four of them)

- **Learn Mode** — first exposure. Plays through your openings with smart, instructive hints and "memorable explanations" (mnemonics). User clicks through; system reveals each move with commentary.
- **Practice Mode** — pure recall, no hints. Lines are drawn from a "cohort" sized to your **confidence score**. Mastered lines rotate out, weak lines come back more often.
- **Drill Mode** — same recall but with leaderboard pressure, faster pacing.
- **Time Trials** — 60-second blitz; correct answers add seconds; clock speeds up. Pure speed test.

Other modes mentioned in marketing: **Puzzles** (tactical positions taken from real games where the trained opening was played) and **Dojo** (practice your full repertoire end-to-end across all openings).

### 3.3 Wrong-move semantics (the critical detail)

From the changelog (early 2025): **"When you mess up in drill mode, it automatically undoes the incorrect move so you don't have to press the back button yourself."**

So: same auto-revert as chessdriller, no death penalty. The "consequence" is that the **line resurfaces more often** in the cohort. There is no streak-loss in Practice/Learn — the streak/strike system only exists in **Time Trials and leaderboard Drill** where the clock is the loss condition.

### 3.4 Mastery / cohort logic

"Practice mode now creates a cohort of lines based on your confidence score, gradually introducing new lines as you master the current ones." This is **not classic SM-2**; it is closer to a **bandit-style sliding window**:

- Each line has a `confidence` score (0–1, derived from recent correct/total).
- A working set of N lines is maintained.
- A line with high confidence drops out; a new unseen line drops in.
- Wrong answers raise that line's appearance probability.

This is simpler than SM-2 and easier to tune. **For our v1, prefer the chessdriller SM-2 approach** (well-defined intervals, predictable due dates), but expose `confidence = correct / max(total, 5)` as a UI metric for the user.

### 3.5 Repertoire authoring

Course Creator supports:
- **PGN upload** (paste or file).
- **Lichess Study import**.
- **Curated starter courses** (Ruy Lopez, King's Gambit, etc. — these are the marketing entry points).

ChessFlare comparison blog says chessreps is "more drill-oriented" — authoring is functional but the product centre of gravity is consumption.

### 3.6 What chessreps brags about

- Lichess-mined real-opponent move frequencies (heavy reply first).
- Auto-undo on wrong move.
- Cohort-based gradual introduction.
- Drill hints (small nudges in Learn mode).
- AI response speed slider (fast for warm-up, slow for thinking).
- Mobile-first PWA, pin to homescreen.
- Leaderboards, streaks (gamification layer).
- Smart line selection (their term for SRS).

---

## 4. Chessable — Commercial Gold Standard

Only the differences worth knowing — full reverse-engineering is overkill.

- **Granular learn-then-quiz cadence:** read commentary on a single move → repeat the move → read more commentary → repeat → at end, repeat the whole sequence. **Much finer-grained than chessdriller's "play the whole line" drill.** Worth copying for our **Learn** mode: surface chunks of 2–3 moves at a time before testing.
- **Up to two "Key Moves" per variation** — bookmarks that let you start drilling from the middle of a line, skipping book moves you already know.
- **Course-as-product:** repertoires are commercial content (chess books digitised). Authoring tools exist but are secondary. Not relevant to our personal-use clone.
- **No auto-undo** (or very subtle): Chessable shows the wrong move in red, requires the user to click "Show answer" or "Try again". Slower, more deliberate. **chessdriller and chessreps are both better here.**
- **Variation tree on the side panel** with colour-coded mastery (green = solid, yellow = wobbly, red = forgotten). Lift this UI directly.
- **Comment rendering is rich** — diagrams in commentary, embedded videos. Out of scope for v1.

---

## 5. Synthesis — Concrete Spec for Our Trainer

Stack already locked: TypeScript, React 19, chess.js, chessground, IndexedDB, sqlite-wasm. This spec maps cleanly onto those.

### 5.1 Data model (sqlite-wasm)

```sql
CREATE TABLE repertoire (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rep_for_white INTEGER NOT NULL,        -- 1 = White rep, 0 = Black rep
  created_at INTEGER NOT NULL,
  source_kind TEXT NOT NULL              -- 'pgn' | 'lichess_study' | 'manual'
);

CREATE TABLE source_pgn (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repertoire_id INTEGER NOT NULL REFERENCES repertoire(id) ON DELETE CASCADE,
  filename TEXT,
  raw_pgn TEXT NOT NULL,
  imported_at INTEGER NOT NULL
);

-- The core: one row per (repertoire, position-before, position-after).
-- Transpositions automatically dedupe on the unique constraint.
CREATE TABLE move (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repertoire_id INTEGER NOT NULL REFERENCES repertoire(id) ON DELETE CASCADE,
  from_fen TEXT NOT NULL,                -- position BEFORE this move (incl. side-to-move)
  to_fen TEXT NOT NULL,                  -- position AFTER this move
  san TEXT NOT NULL,                     -- e.g. "Nf3"
  uci TEXT NOT NULL,                     -- e.g. "g1f3" (for chessground)
  is_own_move INTEGER NOT NULL,          -- 1 = my rep move (drillable); 0 = opponent move (auto-played)
  comment TEXT,                          -- optional, from PGN {curly braces}
  weight REAL,                           -- optional, opponent-move popularity 0..1 (heaviest reply chosen by default)
  deleted INTEGER NOT NULL DEFAULT 0,
  -- SRS state (only meaningful if is_own_move = 1)
  learning_step INTEGER DEFAULT 0,       -- 0..3, or NULL when graduated
  learning_due_at INTEGER,               -- unix ms, NULL when graduated
  review_interval_days REAL,             -- NULL until graduated
  review_ease REAL DEFAULT 2.5,          -- SM-2 ease factor
  review_due_at INTEGER,                 -- unix ms, NULL when in learning
  UNIQUE(repertoire_id, from_fen, to_fen)
);
CREATE INDEX move_due_idx ON move(repertoire_id, is_own_move, learning_due_at, review_due_at) WHERE deleted = 0;

-- Many-to-many: which PGN(s) contributed each move (so we can soft-delete safely).
CREATE TABLE move_source (
  move_id INTEGER NOT NULL REFERENCES move(id) ON DELETE CASCADE,
  source_pgn_id INTEGER NOT NULL REFERENCES source_pgn(id) ON DELETE CASCADE,
  PRIMARY KEY (move_id, source_pgn_id)
);

-- Append-only history. Powers stats, leech detection, and the user's progress chart.
CREATE TABLE study_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  move_id INTEGER NOT NULL REFERENCES move(id) ON DELETE CASCADE,
  studied_at INTEGER NOT NULL,
  was_correct INTEGER NOT NULL,
  incorrect_guess_san TEXT
);
```

Notes:
- **`from_fen` is the position-before-the-move including side-to-move and castling rights.** That's our position hash. No Zobrist — FEN strings are short, indexable, and chess.js produces them for free. Strip the half-move counter and full-move number from the FEN before hashing to avoid spurious dedup misses on transpositions.
- **No tree.** The `move` table is a directed graph. The "tree view" UI is computed at render time by walking edges from `startpos`.
- **`weight`** is filled at import time from the Lichess Opening Explorer (one batched lookup per opponent-move FEN) so the auto-played opponent move can be the most popular reply, not whatever happened to be in the PGN.

### 5.2 Three modes

#### Learn Mode (first-time exposure)

- Auto-plays through the line move-by-move.
- Each move animation: **300 ms slide**, then a **400 ms pause** before the next.
- If the move has a `comment`, show it in a side panel and **pause auto-play**; user clicks "Continue" to advance.
- No board input. Pure observation.
- Steal Chessable's chunking: at end of every 2–3 own-moves, **insert a mini-quiz** — board waits, user replays the last 2–3 own-moves they just saw. Wrong → re-show, no SRS impact. Right → continue.
- Marks every move along the line as "introduced" (creates Move row with `learning_step = 0`, `learning_due_at = now()`).

#### Drill Mode (the daily SRS workhorse — copy chessdriller exactly)

- Pick next due line via BFS from the starting position, prioritising moves where `learning_due_at <= now` (urgent) over `review_due_at <= now`.
- Render board, opponent's clock implicit only.
- User must play the rep move (`is_own_move = 1`) at every own-turn position.
- **On correct:**
  1. Update SRS state (formulas in §2.3 above) — write to `move` and append to `study_history`.
  2. If `review_interval_days` grew, animate a small "+N days" stamp at the destination square (GSAP-equivalent in framer-motion: 400 ms scale-in then fade).
  3. Wait 250 ms, then auto-play opponent's reply (heaviest `weight` reply if multiple exist; if the user is in a known sub-tree they've drilled before, prefer the variation they've seen most).
  4. End of line → wait 500 ms → fetch next due line.
- **On wrong:**
  1. `chess.undo()` to revert game state.
  2. `chessground.set({ fen, lastMove: undefined })` — board snaps back, no last-move highlight, **brief 200 ms red flash on the destination square** (improvement over chessdriller, which has no flash).
  3. Wait 250 ms, then re-enable board input.
  4. Increment in-memory `wrongs_this_attempt`. **No streak penalty in Drill mode.**
  5. Update SRS state (wrong-answer branch from §2.3): step back to `learning_step = 0`, ease minus 0.2 (floor 1.3). Append to `study_history` with `was_correct = 0` and `incorrect_guess_san = "Bf4"`.
  6. After `wrongs_this_attempt >= 2`, the **"Show answer"** button starts pulsing (scale 1 → 1.1 → 1, 600 ms loop). Click reveals the correct move with an arrow + auto-play it on the board, then proceeds. Counts as wrong.
  7. **No "you fail this line" cutoff.** Loop until correct or until user clicks Show Answer.

#### Test Mode (no safety net — proves you actually know it)

- Same as Drill, **but**:
  - **No "Show answer" button.** No auto-undo of the wrong move (the wrong move stays played, line is marked failed).
  - **Streak counter** at the top, increments per fully-completed line, resets to 0 on any wrong move.
  - No SRS update on wrong move (Test is for self-assessment, not training — don't pollute the SRS state with test failures unless the user opts in).
  - On line failure, show a "Replay correct line" button that runs Learn-mode auto-play through the line.
  - On `N` consecutive correct lines (default `N = 5`), show a "Mastered: <opening name>" toast and offer to add a new opening to the rep.

### 5.3 Wrong-move retry semantics (summary table)

| Mode | Wrong move action | SRS impact | Retry allowed | Streak impact |
|---|---|---|---|---|
| Learn | Mini-quiz only: undo, re-show animated correct move | None | Implicit re-show | N/A |
| Drill | Auto-undo after 250 ms, board re-enabled, red flash on destination, "Show answer" pulses after 2 wrongs | Reset to learning step 0; ease −0.2 (floor 1.3) | Yes, unlimited | N/A (no streak in Drill) |
| Test | Wrong move stays played, line marked failed, "Replay correct line" button | None (Test is read-only) | No (advance to next line) | Resets to 0 |

### 5.4 Repertoire authoring (v1 scope)

- **PGN upload** drag-and-drop. Parse with `chess.js` `loadPgn()`, walk variations recursively, insert each unique edge as a `move` row, dedupe on `(repertoire_id, from_fen, to_fen)`.
- **Lichess Study import** by ID. One-shot fetch from `https://lichess.org/api/study/{id}.pgn` (no auth required for public studies). Same parser.
- **No manual board-builder in v1.** TODO for v2.
- **No sharing** in v1 — local-first, IndexedDB.

### 5.5 Visual / interaction patterns to lift

- **Arrow rendering:** chessground native `drawable.shapes` for the "Show answer" hint arrow (green) and Learn-mode commentary arrows from PGN `[%cal Gb1c3]` annotations.
- **Square highlighting:** brief red flash (200 ms, opacity 0.5 → 0) on the destination of a wrong move; persistent green highlight on the correct move when revealed via "Show answer".
- **Mistake feedback animation:** 250 ms snap-back undo, no slide animation (instant revert reads as "that didn't happen" rather than "you played that and it was undone").
- **Mode transition:** simple tab switch in a single React component tree; all three modes share the same chessground instance, only handler logic differs.
- **Side panel — variation tree** (Chessable-inspired): show the current line as a vertical list of moves with the user's position bolded; colour each own-move by mastery (`learning_*` → grey, `review_interval < 7` → orange, `< 30` → yellow, `>= 30` → green). Click any move to jump to that position in Learn mode.
- **Stats card:** moves due today / total moves in rep / current streak / avg ease — match chessdriller's `stats` object shape.

### 5.6 Out of scope for v1

- Leech detection (track lapses, suggest re-learning).
- Cross-device sync (IndexedDB is local-only by design).
- Sharing/publishing repertoires.
- Out-of-repertoire alert on real Lichess games (chessdriller TODO).
- Full Chessable-style commentary with embedded videos.
- Time Trials / leaderboard mode (chessreps gamification — fun but not core).

---

## Appendix A — litrainer (for the record)

**Repo:** [github.com/JamarTG/litrainer](https://github.com/JamarTG/litrainer). Open source, MIT-ish.

**What it actually is:** a **post-game blunder trainer** for Lichess players. Pull your last games, run Stockfish 17 over them, classify every move (`blunder | mistake | inaccuracy | good | excellent | best | book | great`), surface every blunder as a tactical-style puzzle where you try to find the move you should have played.

**Why it doesn't fit our brief:** no repertoire concept, no SRS, no Learn/Drill/Test split. It's a "review your own losses" tool, adjacent to but distinct from opening repertoire training. The Reduxified architecture (`src/state/`), feature-based folders (`src/features/{chessboard,panel,training-session,analysis-engine}`), and chessground + Stockfish-as-worker integration patterns are reasonable references for **our engine layer**, not our trainer.

**Tech stack** (matches our stack closely): TypeScript, React, Tailwind, react-chessground, Stockfish 17 WASM, Redux Toolkit, Lichess API.

**What we can lift from it:**
- The Stockfish-as-Web-Worker integration pattern (matches our R1/R2/R8 from `stack.md`).
- Move classification taxonomy (could be reused if we add a "review your last drill session" feature: "your wrong moves were 60% blunders, 30% inaccuracies, 10% reasonable alternatives outside your rep").

---

## Sources

- [github.com/JamarTG/litrainer](https://github.com/JamarTG/litrainer) — litrainer repo
- [github.com/gtim/chessdriller](https://github.com/gtim/chessdriller) — chessdriller repo
- [chessdriller.org](https://chessdriller.org/) — hosted instance
- [chessreps.com](https://www.chessreps.com/) and [/about](https://www.chessreps.com/about), [/changelog](https://www.chessreps.com/changelog)
- [chessable.com/movetrainer](https://www.chessable.com/movetrainer/) — MoveTrainer overview
- [chessflare.com/resources/chessflare-vs-chessreps](https://chessflare.com/resources/chessflare-vs-chessreps) — comparison
- [Andy Matuschak's notes on Chessable MoveTrainer](https://notes.andymatuschak.org/zDr94hP6bG3jJYrdYy8B5hx)
- [Anki SM-2 algorithm explainer](https://faqs.ankiweb.net/what-spaced-repetition-algorithm)
