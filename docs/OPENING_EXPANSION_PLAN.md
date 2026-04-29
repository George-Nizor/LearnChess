# Opening course expansion plan

> Why this doc exists: when you said "let's get all of the opening
> courses built with as many lines as possible and well written
> tutorials", I went DEPTH-first (rewriting prose on the existing
> lines) when you asked for BREADTH (more lines + opponent variation
> handling). This doc owns that gap and lays out exactly what's
> missing per opening so the next pass can fill it in.

## Where things stand (2026-04-29)

13 openings, 96 named tabiyas — but the line count per opening is
uneven. Several are stubs:

| Opening | Lines | Verdict |
|---|---|---|
| Sicilian Defence | 12 | Reasonable coverage |
| Italian Game | 10 | Reasonable coverage |
| Ruy López | 10 | Reasonable coverage |
| French Defence | 8 | Has gaps |
| Caro-Kann | 8 | Has gaps |
| Queen's Gambit Declined | 8 | Has gaps |
| King's Indian Defence | 8 | Has gaps |
| Slav Defence | 6 | **Thin** |
| English Opening | 6 | **Thin** |
| Pirc Defence | 5 | **Thin** |
| Vienna Game | 5 | **Thin** |
| Scandinavian | 5 | **Thin** |
| London System | 5 | **Thin** |

And critically: **no opening course currently teaches "what if the
opponent deviates here"**. Every line is a single mainline sequence
with a tabiya summary. Real chess players need to handle
deviations — the lesson should branch when the opponent plays
something other than the expected move.

## What's missing per opening

The list below is what each course needs in addition to (or
extending) what's already shipped. For thin courses the priority is
adding lines; for richer courses the priority is opponent-deviation
content within existing lines.

### Pirc Defence (5 → ~9 lines)

Currently has Classical, Austrian Attack, 150 Attack, Byrne System,
Classical Deep Plan. Missing:

- **Sämisch / 4.f3 setup** — White prepares Be3, Qd2, O-O-O slow
- **4.Bf4** sideline — quieter than Byrne, Tartakower-flavoured
- **3.f3 / Pribyl / Ufimtsev move-orders** — when White plays 3.f3
  before Nc3
- **Modern Defence move-order** (1.e4 g6 2.d4 Bg7) — same
  structures but White can't play Nc3 + e4 + f4 cleanly
- **2.Nf3 d6 3.d4 Nf6 4.Nc3 g6** — same tabiya reached via
  different move-order; teach the transposition

Plus opponent deviations within existing lines:
- Classical: what if White plays 5.h3 before Be2?
- Austrian: what if 6.e5 dxe5 7.fxe5 instead of 6.Bd3?
- 150 Attack: what if White delays O-O-O with 6.h4 first?

### Vienna Game (5 → ~8 lines)

Currently has Vienna Gambit, Mieses Variation, Vienna Bishop
Sacrifice, Vienna Falkbeer, Vienna Stanley. Missing:

- **Frankenstein-Dracula full mainline** — 3.Bc4 Nxe4 4.Qh5 Nd6
  5.Bb3 Nc6 6.Nb5 g6 7.Qf3 — pure tactical melee
- **Vienna Game with 2...Nc6** — Schmidt Defence
- **King's Gambit transposition** — when White plays 3.Bc4 then 4.f4
- **3.g3 setup against 2...Bc5** — different from the 2...Nf6 g3 line

### Scandinavian Defence (5 → ~8 lines)

Currently has Mainline Mieses, Modern Mieses (3...Qd6), Modern
Variation (3...Nf6), Icelandic Gambit, Portuguese. Missing:

- **3...Qa5 with 4.Nf3** vs 4.d4 — modest but legitimate try
- **Marshall Variation** (3.Nc3 Qd8) — passive but solid
- **Mainline 3...Qd5 4.d4 Nf6 5.Nf3 Bg4** — the Bg4 line specifically
- **3.Nc3 Qa5 4.b4!?** — wing gambit
- **3.exd5 Qxd5 4.d4 Nf6 5.Nf3 c6 6.Bc4** — line where White avoids Bd2

### London System (5 → ~9 lines)

Currently has Mainline, vs KID, vs Slav, vs Benoni, Bxc7 trick.
Missing:

- **vs Dutch Defence** (1.d4 f5 2.Bf4) — early Bf4 vs Dutch shapes
- **vs Modern / King's Indian Setup with ...c5** — slightly
  different from KID-style
- **Anti-London ...c5 + ...Qb6** specifically — most common
  practical question
- **Jobava London (2.Nc3 + 3.Bf4)** — variant choice
- **vs Owen Defence + irregular Black setups**

### English Opening (6 → ~10 lines)

Currently has Reversed Sicilian, Symmetrical Hedgehog, Anglo-Indian,
Anglo-Reti, English vs Slav, Carls-Bremen. Missing:

- **English Botvinnik System** (g3 + Bg2 + e4 setup)
- **Mikenas-Carls Variation** (1.c4 Nf6 2.Nc3 e6 3.e4)
- **English Defence** (1.c4 b6) — when Black plays Owen-style
- **Symmetrical with c5 + Nc6 — open Sicilian-mirror**
- **Anti-English: 1.c4 e5 2.g3 Nf6 3.Bg2 c6** (English Botvinnik
  with reverse sides)

### Slav Defence (6 → ~9 lines)

Currently has Mainline (Accepted), Quiet Slav, Chebanenko, Semi-Slav
Meran, Semi-Slav Botvinnik, Exchange. Missing:

- **Anti-Meran setups** — 5.Bg5 dxc4 6.e4 — Botvinnik System
  alternative
- **Slav Triangle** (3...c6 4.Nf3 e6 5.Bg5 dxc4) — modern approach
- **Slow Slav** with 4.e3 — White declines challenge
- **Schlechter Slav** (...g6 fianchetto) — covered by Quiet Slav
  but deserves its own line
- **Anti-Slav Tolush-Geller Gambit**

### French Defence (8 → ~12 lines)

Currently has Winawer, Winawer Poisoned Pawn, Classical Steinitz,
Tarrasch Open, Tarrasch Closed, Advance Milner-Barry, Exchange,
McCutcheon. Missing:

- **Rubinstein Variation** (3...dxe4) — taking on e4 immediately
- **King's Indian Attack vs French** (2.Qe2 or 2.d3 setups)
- **Wing Gambit vs French** (2.b3 or 2.b4)
- **Hecht-Reefschläger (2.f4)** — Diemer-Duhm-Gambit cousin

### Caro-Kann (8 → ~12 lines)

Currently has Classical, Advance, Exchange, Panov-Botvinnik, Two
Knights, Bronstein-Larsen, Karpov, Modern. Missing:

- **Fantasy Variation** (3.f3) — Tal's favourite
- **Goldman / Spike Attack** (3.Nc3 dxe4 4.Nxe4 g6) — odd but
  played
- **Classical Mainline 4...Nf6** with **5.Nxf6+ exf6** — Modern
  but specific to e6/f6 recapture
- **Advance with 4.Nc3 e6** — alternative to 4.Nf3
- **Anti-Caro 1.e4 c6 2.c4** — English-flavoured anti-Caro
- **Closed Caro 1.e4 c6 2.d3** — KIA-flavoured

### Queen's Gambit Declined (8 → ~12 lines)

Currently has Mainline (Bg5), Tartakower, Lasker, Cambridge Springs,
Orthodox, Vienna, Catalan Open, Catalan Closed. Missing:

- **Triangle System / Anti-Meran** (3.Nf3 Nf6 4.Nc3 c6) — chooses
  between Slav and Semi-Slav
- **QGD Exchange Variation** (5.cxd5 exd5 6.Bg5) — minority attack
  structure
- **Manhattan Variation** (5.Bf4) — modern alternative to Bg5
- **Ragozin Variation** (4...Bb4) — Nimzo-Indian-flavoured QGD
- **Vienna Variation 5...Bb4** — pin alternative

### King's Indian Defence (8 → ~12 lines)

Currently has Classical, Mar del Plata, Petrosian, Bayonet, Sämisch,
Four Pawns, Fianchetto, Makogonov. Missing:

- **Averbakh System** (5.Be2 then Bg5) — pinning ideas
- **Saemisch Panno** (5.f3 Nc6) — knight reroute
- **Classical Main Line (Glek Variation 9.Nd2)** — Bayonet
  alternative
- **Anti-KID 1.d4 Nf6 2.Bg5** (Trompowsky) — sidesteps KID
  entirely

### Italian Game (10 → ~13 lines)

Currently has Giuoco Piano, Two Knights, Evans Gambit, Italian
Quiet, Hungarian Defence, Italian Gambit, Möller Attack, Two Knights
Fritz, Two Knights Modern, Traxler. Missing:

- **Greco Attack** (Fried Liver mainline 6.Nxf7) — currently the
  Two Knights Fritz line goes a different direction
- **Italian Game Anti-Fried-Liver 4.d4** transposition tricks
- **Steinitz Defence Deferred** in Italian (3...Nf6 4.d3 d6)

### Ruy López (10 → ~13 lines)

Currently has Closed Spanish (Morphy), Berlin Defence, Exchange
Variation, Open Spanish, Marshall Attack, Anti-Marshall (8.h3),
Steinitz Defence, Schliemann, Bird's Defence, Cozio Defence.
Missing:

- **Smyslov Variation** (3...g6) — fianchetto alternative to Cozio
- **Norwegian Variation** (3...Nge7 4.Nc3 g6) — Cozio-with-c3
- **Closed Ruy with 11.h3 — full Breyer/Zaitsev mainline**
- **Marshall Attack mainline 12.d3 alternatives** — currently
  shown one side only

### Sicilian Defence (12 → ~15 lines)

Currently has Najdorf, Dragon, Sveshnikov, Closed Sicilian,
Scheveningen, Kan, Taimanov, Accelerated Dragon, Hyperaccelerated
Dragon, Rossolimo, Najdorf English Attack, Alapin. Missing:

- **Smith-Morra Gambit** (2.d4) — very common at club level
- **Grand Prix Attack** (2.Nc3 + 3.f4) — popular anti-Sicilian
- **Moscow Variation** (3.Bb5+ vs 2...d6) — counterpart to Rossolimo
- **Najdorf Poisoned Pawn** (6.Bg5 e6 7.f4 Qb6) — sharp specific line

## Opponent-deviation content

This is the bigger gap. Every line currently teaches the MAINLINE.
Real games branch at every move and the lesson should help with
that. Three approaches, in order of complexity:

### 1. Final-tabiya "common deviations" callout (cheapest)

Add a new section type to the parsed prose: after the tabiya plan
summary, list 2-4 common opponent deviations from the mainline
with one-line responses. Render as a yellow-pill section labelled
"Common deviations". Schema-compatible — just a new section regex
in `src/openings/proseParser.ts`.

```
Common deviations
- If White plays 7.h3 instead of 7.Be2 → respond with …h6 + …Re8,
  same Closed-Spanish setup
- If White plays 7.Re1 → respond with …b5 first to chase the
  bishop before castling
```

Effort: ~4-6 lines per tabiya × 96 tabiyas = a couple of authoring
sessions per dozen openings.

### 2. Per-move "if instead" branches (medium)

For each ply in a line, allow an array of alternatives the OPPONENT
might play with a one-paragraph response. These render as expandable
"What if?" boxes in the Learn view. Storage:

```ts
interface MoveSpec {
  san: string;
  text: string;
  // NEW:
  alternatives?: { san: string; response: string; explanation: string }[];
}
```

Effort: 2-3 alternatives per opponent move × ~10 opponent moves
per line × 96 lines = significant authoring lift, but each
alternative is short.

### 3. True branching tree per line (most complex)

Each line becomes a tree, not a linear sequence. The drill walks
the tree pseudo-randomly weighted by frequency. The Learn view
renders the active path with siblings as "What if?" branches.

Effort: schema migration + rewrite of drill / line picker /
Learn view. Probably 1-2 weeks of work spread over dev sessions.
Worth it if we go full breadth.

## Recommended sequence for the next pass

1. **Implement option 1 (deviation callouts)** first — cheapest,
   biggest immediate user-value, no schema migration. Add the new
   section to `proseParser.ts`, render as a new pill in
   `LessonBubble.tsx`, then author 2-3 deviations per existing
   tabiya.
2. **Add 2-4 lines per thin opening** (Pirc, Vienna, Scandinavian,
   London) — bring everyone up to ~8-9 lines minimum. Each new
   line uses the existing schema; just append to `lessons.ts` +
   the move-graph in `book.ts`.
3. **Address richer-opening gaps** (Sicilian Smith-Morra, KID
   Averbakh, Caro-Kann Fantasy, French Rubinstein, etc.) one
   opening at a time.
4. **Then consider option 2 or 3** for true branching only if the
   user demand is there. Many courses on Chessable/Listudy stop at
   linear lines + deviation callouts and that's been fine.

## Authoring scaffold

The pattern that's worked for the existing 96 tabiyas:

- `LineSpec.intro`: 3-4 sentence scene-setter, "Let's learn the X!"
  template, one self-aware joke allowed.
- `MoveSpec.text`: per-move explanation, 2-4 dense sentences with
  WHY + key squares + tactical/positional theme. Hard cap of 4 sentences.
- Final tabiya node breaks the 4-sentence cap on purpose: 5-9
  sentence "end of chapter" plan paragraph with named White's plan,
  Black's plan, key squares, tactical theme, modern theory eval.
- All move references in `**bold**`. The parser turns these into
  on-board square highlights.

The structured-section header phrases the parser already
recognises (in `src/openings/proseParser.ts`):

- "White's plan from here:" / "White's plan:" / "The standard
  White plan:" / "The standard Black plan:"
- "Two squares to obsess about:" / "Two key squares:"
- "Tactical theme:"
- "Modern theory rates ..." / "Modern theory considers ..."
- "Common mistake:" *(parser already accepts this; not yet
  authored)*

Extending with "Common deviations:" is a one-line addition to the
markers regex.

## Quality gates that already exist

- `tests/unit/openings/proseParser.test.ts` — pins parser against
  real corpus; 100% structure coverage.
- `tests/unit/openings/contentAudit.test.ts` — audits every text
  string for markdown / dev-marker / token integrity issues.
- `tests/unit/openings/lessons.test.ts` — re-derives every FEN
  and asserts equality (chess.js validates SAN at module load too).
- `scripts/verify-tactics.ts` — chess.js verification of forcing-
  sequence claims.
- `scripts/verify-tabiya-evals.md` — Stockfish-backed tabiya eval
  audit procedure.

Any new line shipped goes through these without extra work; the
content audits + parser tests pin every authored tabiya.
