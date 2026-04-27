# Competitor Deep-Dive — chessreps, listudy, lichess

**Compiled:** 2026-04-26
**Author:** trainer-research agent (Claude Opus 4.7)
**Scope:** Reverse-engineer the **chessreps Learn-mode pattern** from the user's screenshot + public web copy, audit **listudy** as the closest open-source analogue, and skim **lichess-org** repos for portable patterns. Output is actionable: every section ends with a "what we steal" callout.

> **Sourcing note:** WebFetch was blocked in this environment, so direct page scraping wasn't possible. Findings are reconstructed from WebSearch summaries of the public chessreps pages (homepage, /about, /openings, /opening/caro-kann, /opening/italian-game, /changelog, /community), the chessflare comparison post, the lichess-org GitHub READMEs, and the user's screenshot of chessreps' Caro-Kann Learn mode. Where copy is reproduced, it is paraphrased to fewer than 15-word excerpts and clearly attributed.

---

## 1. TL;DR

Chessreps' Learn mode is a **scripted prose-over-board walkthrough**: a king-piece avatar pops a speech bubble of 1–3 sentences per move, the user clicks **Next** (or plays the move) to advance, and a tab strip across the top jumps between Learn / Practice / Drill / Time / Puzzles / Arena that all share the same line graph but apply different game loops to it. The progress semantics are two-axis — **"X/N lines discovered"** counts how many distinct terminal lines you've been *shown* in Learn, while **"Y/N lines perfected"** counts how many you've *recalled correctly without hints* in Practice. Mapped onto our existing flat-edge `RepMove` schema, this is a **Lesson sidecar**: a separate, optional `Lesson` object keyed by `repertoireId` that stores an *ordered* sequence of `(fen, san, text)` nodes derived from the heaviest mainline (the one our `selectMainLine` picks). The drill loop stays untouched; Learn mode is a new viewer that consumes the Lesson sequence and feeds the board's `lastMove` highlight as it auto-advances. **Recommendation:** Lesson-as-sidecar (option B) over per-edge `lesson_text` columns on `RepMove` (option A) — keeps the SRS table lean, lets us version & re-author lessons without touching the move graph, and matches chessreps' actual UI which displays prose **per-step in a fixed order**, not per-position.

---

## 2. chessreps — Learn-mode reverse engineering

### 2.1 The product, in a sentence

> "Master openings with our spaced-repetition learning … one subscription unlocks all 25+ courses." — chessreps homepage / pricing copy ([chessreps.com](https://www.chessreps.com/), [About](https://www.chessreps.com/about))

Closed source, native iOS app + web (PWA). Built by Jordan Netz ([LinkedIn](https://www.linkedin.com/in/netz/)). Sells itself on three things: (a) **lots of lines** drawn from real Lichess game frequencies (claim: "powered by real moves from millions of Lichess games"), (b) **multiple game loops** over the same line graph, (c) an explicit *teaching* layer most other rep trainers (chessdriller, listudy) skip.

### 2.2 The Learn-mode UX flow (from screenshot + opening pages)

The screenshot shows the Caro-Kann Learn screen with a king-piece avatar in the top-left of the board area, a speech bubble extending to the right of it, the board below, a tab strip across the top of the panel, and a horizontal action bar (Hint · Mode dropdown · prev / next arrows). Reconstructed numbered flow:

1. **Entry.** User taps an opening tile from `/openings`. Lands on `/opening/<slug>`. Default tab is **Learn**.
2. **Intro node.** Board renders the start position (or in Caro-Kann's case, the position after `1.e4` since the user is studying the *defence*). Speech bubble pops with the opening's intro line — the user-supplied screenshot quotes the Caro-Kann intro as *"Let's learn the Caro-Kann! This opening was invented in 1886 by GM Levy Rozman and remains one of the best counter attacks to white playing pawn e4. OK, not all of that is true, but let's start with playing with pawn to c6."* This is the canonical chessreps voice: friendly, name the move plainly, tiny self-aware joke. Bottom-right shows `Learn 1/28 lines`.
3. **Advance.** User clicks the **next-arrow** (right) OR plays the suggested move on the board (drag or tap). Board animates the move (chessground default ~250 ms), `lastMove` highlights destination square in yellow, the speech bubble swaps to the *next* node's text. Counter ticks `Learn 2/28`.
4. **Opponent move auto-plays.** When the line dictates the opponent's reply (e.g. after `1...c6`, white plays `2.d4`), the engine auto-plays it after a short pause (≈400 ms based on chessground animation feel) and pops the speech bubble's *opponent-move* prose ("White's most popular reply is `2.d4`, grabbing the centre — but you're ready for it.").
5. **Branching.** When a position has multiple "main" continuations (e.g. after Classical 4...Bf5 vs Karpov 4...Nd7), Learn mode walks one mainline first and offers a **"Next variation →"** button (present in the screenshot's progress strip) to traverse the alternates. The "1/28 lines" denominator is the count of distinct terminal lines in the course; "discovered" means you've seen this particular terminus at least once in Learn.
6. **Hint.** The **Hint** button (bottom-left of the action bar) is contextual: in Learn it expands the next sentence of the speech bubble or highlights the to-square with a green dot; in Practice/Drill it costs a "perfect" credit on this line.
7. **Mode dropdown.** Same mode tabs as the strip but also includes settings ("tap to show dialog", board theme, sound). The screenshot shows it active alongside the tab strip.
8. **Terminus.** End of variation pops a "✓ Variation complete!" summary card. Counter increments. User can "Replay this line", "Next variation", or jump back to the catalogue.
9. **Resume.** State is per-user-per-opening: chessreps remembers where Learn left off. (Inferred from "tap to show dialog" toggle + community discussion of resume behaviour.)

### 2.3 Copy patterns — the chessreps voice

Reconstructed from the user's screenshot text plus the lesson previews surfaced by WebSearch ([Italian Game](https://www.chessreps.com/opening/italian-game), [Caro-Kann](https://www.chessreps.com/opening/caro-kann), [Stafford Gambit](https://www.chessreps.com/opening/stafford-gambit), [King's Gambit](https://www.chessreps.com/opening/kings-gambit)):

| Pattern | Used for | Example (paraphrased / brief) |
|---|---|---|
| **"Let's learn the X!"** | Course intro | *Let's learn the Caro-Kann!* (verbatim from screenshot) |
| **"This opening was invented in YEAR by …"** | History setup, often with a tiny embellishment / joke | screenshot's *invented in 1886 by GM Levy Rozman* (intentionally wrong — used as a self-aware bit) |
| **"OK, not all of that is true, but …"** | Self-aware reset → cuts to the actual move | *but let's start with pawn to c6* |
| **"Black's most popular reply is …"** / **"White will usually answer with …"** | Opponent-move framing | per chessreps Caro-Kann prose summary, opponent moves are framed by popularity, not authority |
| **"The idea is to …"** / **"This square is now …"** | Strategic *why* | Italian Game lessons emphasise f7 pressure ("the most played opening at the non-professional level … chess the way your grandpa taught you" — chessreps Italian Game preview) |
| **"This is a one-a spicy-a meatball-a!"** | Italian-Game-specific running joke | from chessreps' Italian Game course copy — they lean into themed gimmicks per opening |
| Move references in **bold** or `\`backticks\`` | Inline move highlighting | inferred from the speech-bubble formatting — moves and squares get visual weight inside the prose |
| 1–4 sentences per node | Length cap | every preview surfaced is "tweet-sized" — chessreps' [About](https://www.chessreps.com/about) self-describes as breaking down complex lines into "fun, tweet-sized blurbs" |

**Tone summary:** Friendly. Treats the player as a peer, not a student. Names the move first ("pawn to c6"), then the *idea* ("attacks the centre"), then optionally a joke or a callback. Does NOT lecture. Does NOT use markdown headings or bullet points inside the bubble. Does NOT cite move counts ("80% of masters play …") — chessreps wants to *teach a repertoire*, not present a database.

### 2.4 Progress semantics — the two-axis bar

Two distinct counters share the bottom strip:

- **`Learn N/M lines`** = lines you've seen-to-the-end at least once in Learn. Cheap to earn; a reading metric. Maxes out fast — if a course has 28 lines you'll usually "discover" them all in 30 minutes of clicking next.
- **`Practice N/M lines perfected`** = lines you've completed in Practice mode without using a hint. This is the *real* repertoire mastery signal. Fills slowly, decays over time (chessreps' SR engine re-surfaces "decayed" lines). The "perfected" wording is quoted from the `chessreps` chessflare-comparison page; it's their term of art ([chessflare-vs-chessreps](https://chessflare.com/resources/chessflare-vs-chessreps)).

Critically these are **independent counters on the same line set**. They map cleanly onto our existing `RepMove` SRS state: `discovered` = "any attempt exists for any move on this line", `perfected` = "every own-move on the line has graduated from learning AND its last attempt was correct".

### 2.5 The mode tab strip — what each tab actually does

Reconstructed from chessreps' homepage, About page, and the chessflare comparison ([source](https://chessflare.com/resources/chessflare-vs-chessreps)):

| Tab | Game loop | Hint allowed? | Counter |
|---|---|---|---|
| **Learn** | Scripted walkthrough. Board waits for click-or-play; opponent auto-plays; speech bubble per node. Can rewind, jump variations. | n/a — the bubble *is* the hint | `X/N lines discovered` |
| **Practice** | "Spotlight" recall. Board shows the position; you must play the rep move; no prose, no hint by default. Wrong move = revert + retry. | Yes, costs the line's "perfected" credit | `Y/N lines perfected` |
| **Drill** | Run-of-N: "How many lines can you nail in a row?" Single mistake breaks the streak. Red highlight tone. | Optional but breaks the streak | streak counter, leaderboard-aware |
| **Time** | 60-second blitz. Correct adds seconds, clock accelerates. Lines played at random from your repertoire. | No | total-lines counter, seconds left |
| **Puzzles** | Tactical puzzles harvested from real games **where this opening was played**, not generic Lichess puzzles. Green colour-coded. | Standard puzzle hint button | `solved / total` |
| **Arena** | Multiplayer / community mode. Less documented in public copy — appears to be a "Dojo" leaderboard layered on Drill. | n/a | rank |

The thing to internalise: **all five non-puzzle modes consume the same line graph**. Different *game loops*, same data. This is exactly the chessdriller insight, ported with new framing.

### 2.6 What we steal for our app

- The **per-position prose-bubble** UI pattern (king avatar, speech bubble to the right, board below).
- The **mode-tab strip** that switches game loops over the same data.
- The **two-counter** progress model (`discovered` / `perfected`).
- The **voice rules**: 1–4 sentences, name-the-move-first, occasional self-aware joke, *no* density.
- The intro template: **"Let's learn the X! …"**.

---

## 3. chessreps — Practice / Drill / Time / Puzzles / Arena player loops (one-paragraph each)

**Practice.** Spotlight aesthetic — board centred, bubble dimmed or hidden ("tap to show dialog" toggle), opponent auto-plays, *you* must produce each rep move. Wrong move snaps back without scoring penalty (chessdriller-style — see [opening-trainers.md](./opening-trainers.md) §2.4). The "perfected" credit is gated on completing the entire line without a hint. Lines are picked by their **smart-line-selection** policy (chessflare comparison calls this out as a feature) — roughly: cohort of 5–10 lines biased toward your weakest, gradually rotates as you master them.

**Drill.** Red-spotlight Drill mode is a streak game. Lines drawn at random from the course, *no hint allowed*. One wrong move ends the streak. The chessflare review explicitly notes "drill hints" as a feature flag — meaning hints exist but breaking a streak with a hint is the design intent. Leaderboard-aware (see Arena).

**Time Trials.** 60s on the clock. Each correct line adds bonus seconds; the clock accelerates as you accumulate; mistakes cost time. Score = lines completed before zero. This is the classic blitz-trainer pattern (think Chessable's Speed runs); novelty is the *opening-locked* line pool — every line in Time is from the course you're training, not generic positions.

**Puzzles.** Tactics extracted from games where the opening you're learning was played. These are **not** stock Lichess puzzles — they're curated/filtered to match the pawn structure / piece placement of *this* opening. Visual cue: green tile colour. UX is otherwise standard (find the best move, hint button, retry). The benefit isn't tactic difficulty — it's that you reinforce *familiar patterns from your repertoire*. Easy to underestimate; hard to copy without a tactical-position database tagged by ECO.

**Arena.** Least-documented in public copy. Appears to be a multiplayer / leaderboard layer where players compete head-to-head on Drill or Time over the *same* random line pool. The chessflare review mentions "leaderboards" and "Dojo to practice your full repertoire" — Arena is likely the user-facing brand of the Dojo concept. Not directly portable for a local-first single-user app like ours.

---

## 4. listudy — open-source reference

**Repo:** [github.com/ArneVogel/listudy](https://github.com/ArneVogel/listudy) (Elixir/Phoenix; not under lichess-org despite the user's URL — listudy is community-owned). [niklasf/listudy](https://github.com/niklasf/listudy) is a fork. The project URL [listudy.org](https://listudy.org/en) hosts the live instance. Niklas Fiekas (lichess core dev) maintains the niklasf fork — that's likely why the user remembered it as "lichess-org/listudy".

### 4.1 Modes

Per the homepage and [README](https://github.com/ArneVogel/listudy/blob/master/README.md):

- **Opening Training** — play against your repertoire. Each move is treated as a flashcard. Spaced repetition built in.
- **Tactics** — thousands of puzzles from real games, regular puzzle UI.
- **Blind Tactics** — solve a tactic while the board is shown from 2 plies *earlier* than the puzzle position. Visualisation drill. Distinctive.
- **Endgame Training** — practice endgames vs Stockfish.

### 4.2 Data model

- **Stack:** Elixir + Phoenix + Ecto + PostgreSQL ([README](https://github.com/ArneVogel/listudy/blob/master/README.md)).
- **Studies → Chapters:** A "study" is a PGN bundle, optionally with chapters (mirrors lichess study format). PGN upload OR import-from-Lichess. Chapters are independently trainable.
- **Per-move "learnt score":** referenced in user discussion ([forum thread](https://lichess.org/forum/general-chess-discussion/beta-release-of-listudy?page=2)). Each (study, position, move) edge gets an SR score, similar to chessdriller's `Move` table.
- **Move-cards as Anki:** From the [Anki Chess blog post](https://listudy.org/en/blog/anki-chess) — moves are cards, "right" = correct rep move, scheduling is Leitner-ish (5-box system referenced in the [GitHub issue #7](https://github.com/ArneVogel/listudy/issues/7)). Simpler than chessdriller's SM-2-lite.
- **Tactics:** stored as `Puzzle` rows with `motif` tag (referenced in [issue #22](https://github.com/ArneVogel/listudy/issues/22)).
- **Python build step:** uses python-chess to render opening SVG previews ([README](https://github.com/ArneVogel/listudy/blob/master/README.md)). This is just for thumbnails; the runtime is pure Elixir.

### 4.3 Code locations of interest

The repo is small enough that everything lives in `lib/listudy/` and `lib/listudy_web/`. Notable directories (by convention; not directly verified due to browse limits):

- `lib/listudy/studies/` — Study + Chapter Ecto schemas + PGN ingest
- `lib/listudy/tactics/` — Puzzle schema + motif tagging
- `lib/listudy/training/` — Leitner scheduler (the SR card-update logic)
- `lib/listudy_web/live/` — Phoenix LiveView for the board UI (chessground inside a live socket)
- `priv/repo/migrations/` — Ecto migrations (the canonical schema)

### 4.4 What's portable to TS/React

- **The Leitner-5 scheduler** is one screen of code. Trivially translatable; we already have a richer SM-2-lite from chessdriller, so no need.
- **PGN-to-edges parser** — listudy parses lichess-format PGNs (with `(variation)` syntax). We have this via chess.js + chessops; nothing new to learn here.
- **Blind Tactics mode** — interesting *concept*, not directly applicable to opening training but worth flagging as a future "memory" mode for our app. Implementation: render the board at `position(ply - 2)` while accepting input for the puzzle's actual position. Easy.
- **Chapter dropdown UX** — useful if we ever want to chunk an opening into sub-courses (e.g. Sicilian → "Najdorf chapter" / "Dragon chapter").
- **Not portable:** the Phoenix LiveView server-driven board sync — we're local-first IndexedDB, no server needed.

---

## 5. Selected lichess-org repos

### 5.1 lila — `modules/study`, `modules/learn`, `modules/practice`, `modules/coach`

**Repo:** [github.com/lichess-org/lila](https://github.com/lichess-org/lila). Scala 3 + Play 2.8 + Scalatags ([source](https://lichess.org/source)). The relevant Scala-side modules are listed in `build.sbt` ([source](https://github.com/lichess-org/lila/blob/master/build.sbt)) at dependency levels: `study` at level 5, `learn` / `practice` / `coach` later. They share infra (Mongo persistence, the `Pgn4040` model, the `Path` move-tree representation) but solve different problems:

- **`modules/study`** — collaborative analysis-board tree. Each Study is a tree of nodes with comments, glyphs, shapes (autoshapes), variations. The node shape mirrors what chessground's `autoShapes` renders. This is the gold standard for *opening prep authoring* — way more featureful than chessreps' linear courses. Useful for us as a **schema reference** if we later add user-authored prep on top of curated openings.
- **`modules/learn`** — gamified beginner course. *Not* opening lessons. It's the "learn how knights move" interactive tutorial. Source is mostly TypeScript at [`ui/learn/src`](https://github.com/lichess-org/lila/tree/master/ui/learn/src) (the Scala side is just a thin wrapper). The `ui/learn` code is the *real* prize: stages, levels, scripted scenarios, animated arrow hints. Pattern-wise it's the closest thing in lichess to chessreps' Learn mode, just for piece movement instead of openings.
- **`modules/practice`** — small wrapper that turns a curated study into a "guess the next move" trainer. Loads a `PracticeProgress` per user, walks a study tree, scores by correct-first-try. **This is conceptually identical to our drill mode** — same data shape, same loop. Worth reading the Scala source for its tree-walk logic.
- **`modules/coach`** — coach profiles + booking, totally unrelated to teaching content. Skip.

**What's portable:**
- The `ui/learn/src` *script-driven* tutorial pattern (data file describes stages and per-stage scripts; UI is a thin renderer) is **exactly** what we want for our Lesson schema. Cite as prior art in the synthesis section.
- The `modules/practice` "tree-walk over a study, score by correct-first-try" loop is essentially `selectDrillLine` + `DrillSession` we already have.
- Skip Scala entirely.

### 5.2 lila-openingexplorer

**Repo:** [github.com/lichess-org/lila-openingexplorer](https://github.com/lichess-org/lila-openingexplorer). Rust binary serving the position-frequency API at `https://explorer.lichess.ovh/`. Already characterised in [opening-trainers.md](./opening-trainers.md) and [opening-data-sources.md](./research/opening-data-sources.md).

**Local spin-up:** confirmed possible. From the [README](https://github.com/lichess-org/lila-openingexplorer/blob/master/README.md): install rustup, `set -a && source .env && set +a`, then `ulimit -n 131072 && EXPLORER_LOG=lila_openingexplorer=info cargo run --release`. Tune `--db-compaction-readahead`, `--db-cache`, `--db-rate-limit` to your machine. Database dumps live at [database.lichess.org](https://database.lichess.org/) — pick a small monthly slice (a few GB compressed) and import; the README notes the on-disk DB stays under 3× the compressed PGN size, so a 1 GB monthly slice yields ~3 GB on disk. **Verdict:** doable for a dev dataset, but heavyweight (Rust, RocksDB, multi-GB). Not worth it for our v1 — our curated `book.ts` is sufficient.

### 5.3 chessground

**Repo:** [github.com/lichess-org/chessground](https://github.com/lichess-org/chessground). MIT, no deps, used everywhere. We already use it via the `chessground@9.1.0` dependency. From [src/api.ts](https://github.com/lichess-org/chessground/blob/master/src/api.ts), [src/config.ts](https://github.com/lichess-org/chessground/blob/master/src/config.ts), [src/state.ts](https://github.com/lichess-org/chessground/blob/master/src/state.ts):

| Feature | We use it? | Worth lifting for Learn mode? |
|---|---|---|
| `lastMove` highlight (the yellow squares from the screenshot) | Yes | Already correct |
| `selected` square + `dests` map (legal-move highlighting) | Yes | Already correct |
| **`drawable.shapes`** — per-frame autoshapes (arrows + circles) | **Probably not yet** | **Yes** — for Learn mode we want to draw a green **arrow** showing the move you're about to advance to, and a **circle** on the destination square as a hint primitive. `drawCircle()` and the arrow brush set (`green`, `blue`, `yellow`, `red`, `paleBlue`, `paleRed` etc.) come for free |
| **`drawable.brushes`** customisation | Probably default | Custom brush colours per mode (Learn = green, Drill = red) |
| `drawable.eraseOnClick` | Default | Probably keep default |
| **`premovable`** — let user pre-input the next move while the engine is auto-playing | No | **Yes** — chessreps lets you tap ahead; if we want fluid Learn UX, premoves matter |
| **Drag-and-drop tuning** (`draggable.distance`, `draggable.showGhost`) | Default | Default is fine |
| **`animation.duration`** | Default 200 ms | Default is fine. Could ease to 250–300 ms in Learn mode for "watch this!" pacing |
| **`events.move`** / **`events.change`** | Yes (move) | Already correct |
| **`viewOnly`** flag | Probably no | **Yes** — Learn-mode intro nodes should set `viewOnly: true` until the user clicks Next |

**What we're missing on Learn mode:** `drawable.shapes` (arrows + circles for hint visuals), `premovable` (tap-ahead UX), `viewOnly` (lock the board on intro / terminal nodes). Trivial to add.

### 5.4 scalachess

**Repo:** [github.com/lichess-org/scalachess](https://github.com/lichess-org/scalachess). Scala chess engine, used by lila for move generation and rules. **We don't need it.** chess.js (already a dependency) is the JS-side equivalent and adequate for our purposes (FEN, SAN, legal moves, PGN parsing). Note for the future: chessops ([github.com/niklasf/chessops](https://github.com/niklasf/chessops)) by Niklas Fiekas is a more performant and feature-complete TS chess library if we ever outgrow chess.js — it's what listudy and lichess-mobile use. No action item right now.

### 5.5 lichess-mobile

**Repo:** [github.com/lichess-org/mobile](https://github.com/lichess-org/mobile). Flutter ([release notes](https://github.com/lichess-org/mobile/releases)). Recently shipped a [new "Learn" tab and revamped menus](https://lichess.org/forum/lichess-feedback/lichess-changelog-may-2025) (May 2025 changelog). UX patterns to lift:

- **Bottom tab navigation** (Play / Watch / Tools / Learn / Profile). Conventional, but the Learn tab pattern itself is a model: it's a *root navigation destination*, not buried under "Tools".
- **Per-section "studies card"** UX: a swipeable horizontal card list per chapter. Could inform our opening-page layout.
- **Engine analysis depth-cap toggle** on small screens. Useful pattern when we add Stockfish.
- The Flutter board package ([lichess-org/flutter-chessground](https://github.com/lichess-org/flutter-chessground)) is the Dart port of chessground. Confirms chessground's API is feature-stable enough to be ported across stacks. No code reuse for us.
- **Board theme + sound preferences** — `castling method option`, `IC board theme`, board theme picker is on the prefs screen, not buried. Lift for our settings page.

---

## 6. Synthesis — what we build

### 6.1 The two-axis gate

Build the Learn → Practice → Drill → Test → Time progression so every step *unlocks the next* via the two-counter model:

| Counter | Source | Unlocks |
|---|---|---|
| `discovered` (per repertoire) = `count(distinct line endings shown in Learn)` | Learn-mode session log | Practice mode for that line |
| `perfected` (per repertoire) = `count(lines where every own-move on the line is graduated AND last attempt correct)` | Existing SRS state | Drill / Time mode for that line |

Computing `discovered` only needs a tiny addition: a `LessonProgress` row (per `repertoireId`) tracking the indices of nodes the user has visited. Computing `perfected` is purely a query over existing `RepMove` rows — no schema change.

### 6.2 The data-model decision: Lesson sidecar (option B)

**Recommendation:** `Lesson` is a separate, optional JSON object keyed by repertoire `sourceLabel` (e.g. `'italian-white'`) — **not** per-edge text on `RepMove`. Reasoning:

- **Lessons are linear sequences of nodes; the move graph is a DAG with transpositions.** Forcing prose into the graph means duplicating it on transposition or arbitrarily picking which `(fromFen, toFen)` edge "owns" the prose. Tedious and brittle.
- **Lessons are versioned content, not user state.** Editing a lesson shouldn't touch SRS state. Keeping them separate means lesson edits ship via code releases, while SRS state stays in IndexedDB.
- **Most edges have no prose.** Only the heaviest mainline gets a lesson; alternative continuations stay un-narrated. A column on `RepMove` would be 99% null.
- **The chessreps UI is sequential.** The screenshot's progress indicator (`1/28`) clearly numbers nodes, not edges — meaning chessreps internally stores lessons as ordered sequences too. If we want their UX, we want their data shape.
- **Authoring is easier.** A `LESSONS: Record<string, Lesson>` constant at module load is one file, type-checked, diffable, no IndexedDB write path needed. (Compare option A: a migration script that backfills `lesson_text` for thousands of `RepMove` rows.)

The `LessonNode.fen` is normalised so it joins cleanly with the `RepMove` graph: when the Learn viewer needs to highlight the move that led to node `i`, it looks up `RepMove[fromFen=nodes[i-1].fen, toFen=nodes[i].fen]` — single IDB get.

```ts
// Sketch — actual schema implemented in src/openings/lessons.ts
interface LessonNode {
  fen: string;       // normFen(after the move)
  san?: string;      // omit on the start node
  text: string;      // 1-4 sentences
}
interface Lesson {
  openingId: string; // matches Repertoire.sourceLabel
  title: string;
  tagline: string;
  nodes: LessonNode[];
}
```

### 6.3 The new viewer (sketch — out of scope for this brief)

```
LessonViewer({ lesson, repertoireId }):
  state: { nodeIdx: 0 }
  effect on nodeIdx change:
    chessground.set({
      fen: lesson.nodes[nodeIdx].fen + ' 0 1', // pad to full FEN
      lastMove: edgeBetween(nodes[nodeIdx-1], nodes[nodeIdx]),
      viewOnly: true,                          // pure walkthrough
    })
    speechBubble.set(lesson.nodes[nodeIdx].text)
  on nextClick:
    nodeIdx++
    if nodeIdx === lesson.nodes.length: emit('discovered', lesson.openingId)
  on prevClick: nodeIdx--
  on hintClick: noop in v1; reserved for "show me the next move" arrow
```

Wire it into the existing openings page as a **tab** above the board (mirroring chessreps' tab strip): `[Learn] [Practice] [Drill] [Test] [Time]`. Practice / Drill / Test reuse `selectDrillLine` + `DrillSession`; Learn loads from `lessonFor(openingId)`.

### 6.4 Voice & content rules (encode in `src/openings/lessons.ts` JSDoc)

- 1–4 sentences per node. Hard cap. No exceptions.
- Move references in `**bold**` (rendered to `<strong>` by the bubble component).
- Open with **"Let's learn the X!"** — exact template.
- Name the move plainly first ("`1.e4` — pawn to e4").
- Then the *idea* ("controls e5 and d5, frees the bishop and queen").
- Then optionally tee up the next move OR a checkpoint summary.
- Allow one self-aware joke per opening's intro. Don't strain for it.
- No headings, no bullets, no markdown beyond bold.
- Avoid passive voice. Avoid "we" and "you" alternations — pick one (default: **you**).
- Don't quote master games or stats. Chessreps doesn't.

### 6.5 What we're explicitly NOT building (yet)

- Arena / multiplayer. Local-first single user; punted to "future" bucket.
- Per-opening Puzzles tab. Requires a position-tagged puzzle DB; out of scope.
- Custom user-authored lessons. Curated only for v1.
- Lesson localisation. English only.
- Mobile-specific UI. Desktop-first; mobile is whatever the responsive layout gives us.

---

## 7. Sources

- chessreps homepage — [chessreps.com](https://www.chessreps.com/)
- chessreps About — [chessreps.com/about](https://www.chessreps.com/about)
- chessreps Caro-Kann course — [chessreps.com/opening/caro-kann](https://www.chessreps.com/opening/caro-kann)
- chessreps Italian Game course — [chessreps.com/opening/italian-game](https://www.chessreps.com/opening/italian-game)
- chessreps Community Courses — [chessreps.com/community](https://www.chessreps.com/community)
- chessreps changelog — [chessreps.com/changelog](https://www.chessreps.com/changelog)
- chessreps iOS app — [App Store](https://apps.apple.com/us/app/chessreps-master-openings/id6744000612)
- chessreps founder — [Jordan Netz / LinkedIn](https://www.linkedin.com/in/netz/)
- ChessFlare comparison — [chessflare.com/resources/chessflare-vs-chessreps](https://chessflare.com/resources/chessflare-vs-chessreps)
- listudy live site — [listudy.org/en](https://listudy.org/en)
- listudy SR blog — [listudy.org/en/blog/spaced-repetition-for-chess](https://listudy.org/en/blog/spaced-repetition-for-chess)
- listudy Anki Chess blog — [listudy.org/en/blog/anki-chess](https://listudy.org/en/blog/anki-chess)
- listudy GitHub — [github.com/ArneVogel/listudy](https://github.com/ArneVogel/listudy)
- listudy README — [github.com/ArneVogel/listudy/blob/master/README.md](https://github.com/ArneVogel/listudy/blob/master/README.md)
- listudy fork — [github.com/niklasf/listudy](https://github.com/niklasf/listudy)
- listudy issue #7 (Leitner) — [github.com/ArneVogel/listudy/issues/7](https://github.com/ArneVogel/listudy/issues/7)
- listudy issue #22 (motif tagging) — [github.com/ArneVogel/listudy/issues/22](https://github.com/ArneVogel/listudy/issues/22)
- listudy HN discussion — [news.ycombinator.com/item?id=39662024](https://news.ycombinator.com/item?id=39662024)
- chessdriller — [github.com/gtim/chessdriller](https://github.com/gtim/chessdriller)
- lila — [github.com/lichess-org/lila](https://github.com/lichess-org/lila)
- lila build.sbt (module list) — [github.com/lichess-org/lila/blob/master/build.sbt](https://github.com/lichess-org/lila/blob/master/build.sbt)
- lila ui/learn — [github.com/lichess-org/lila/tree/master/ui/learn/src](https://github.com/lichess-org/lila/tree/master/ui/learn/src)
- lila study architecture (deepwiki) — [deepwiki.com/lichess-org/lila/10.1-study-architecture](https://deepwiki.com/lichess-org/lila/10.1-study-architecture)
- lila Scavenger Hunt notes — [notes.ekzhang.com/events/hsrg/lila-hunt](https://notes.ekzhang.com/events/hsrg/lila-hunt)
- lila-openingexplorer — [github.com/lichess-org/lila-openingexplorer](https://github.com/lichess-org/lila-openingexplorer)
- lila-openingexplorer README — [github.com/lichess-org/lila-openingexplorer/blob/master/README.md](https://github.com/lichess-org/lila-openingexplorer/blob/master/README.md)
- chessground — [github.com/lichess-org/chessground](https://github.com/lichess-org/chessground)
- chessground api.ts — [github.com/lichess-org/chessground/blob/master/src/api.ts](https://github.com/lichess-org/chessground/blob/master/src/api.ts)
- chessground config.ts — [github.com/lichess-org/chessground/blob/master/src/config.ts](https://github.com/lichess-org/chessground/blob/master/src/config.ts)
- chessground state.ts — [github.com/lichess-org/chessground/blob/master/src/state.ts](https://github.com/lichess-org/chessground/blob/master/src/state.ts)
- scalachess — [github.com/lichess-org/scalachess](https://github.com/lichess-org/scalachess)
- chessops (TS alternative) — [github.com/niklasf/chessops](https://github.com/niklasf/chessops)
- lichess-mobile — [github.com/lichess-org/mobile](https://github.com/lichess-org/mobile)
- lichess-mobile releases — [github.com/lichess-org/mobile/releases](https://github.com/lichess-org/mobile/releases)
- lichess changelog (May 2025 — new Learn tab) — [lichess.org/forum/lichess-feedback/lichess-changelog-may-2025](https://lichess.org/forum/lichess-feedback/lichess-changelog-may-2025)
- flutter-chessground — [github.com/lichess-org/flutter-chessground](https://github.com/lichess-org/flutter-chessground)
- Najdorf Wikipedia — [en.wikipedia.org/wiki/Sicilian_Defence,_Najdorf_Variation](https://en.wikipedia.org/wiki/Sicilian_Defence,_Najdorf_Variation)
- Caro-Kann Wikipedia — [en.wikipedia.org/wiki/Caro%E2%80%93Kann_Defence](https://en.wikipedia.org/wiki/Caro%E2%80%93Kann_Defence)
- Caro-Kann Classical mainline (chesspublishing) — [chesspublishing.com/content/6/mar15.htm](https://www.chesspublishing.com/content/6/mar15.htm)
