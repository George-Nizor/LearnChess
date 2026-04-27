/// <reference types="vitest/importMeta" />
/*
 * Curated prose courses for the Learn-mode viewer.
 *
 * Pattern lifted from chessreps' Learn mode (see
 * docs/research/competitor-deep-dive.md §2). Each course has MULTIPLE
 * lines (chessreps' "X/N lines"), and each line is an ordered sequence
 * of LessonNodes — replayed left-to-right by the viewer with a
 * speech-bubble per node, board auto-advancing through opponent
 * replies, user clicking Next (or playing the move) to advance through
 * own-moves.
 *
 * Schema decision (see §6.2 of the deep-dive): we DON'T put prose on
 * RepMove rows. Instead courses live here as a versioned, code-reviewed
 * sidecar keyed by the same `openingId` (= Repertoire.sourceLabel) the
 * curated importer uses. Edit-without-touching-SRS-state is the win.
 *
 * Authoring rules (see §6.4 of the deep-dive):
 *   - 1-4 sentences per node. Hard cap.
 *   - Move references in **bold** (rendered to <strong> by the bubble).
 *   - Open with "Let's learn the X!" — exact template.
 *   - Name the move first ("**1.e4** — pawn to e4").
 *   - Then the strategic *why* ("controls e5/d5, frees bishop and queen").
 *   - One self-aware joke per opening intro is allowed; don't strain.
 *   - No headings, bullets, or markdown beyond bold.
 *   - Don't quote master games or stats.
 *
 * FEN authoring rules:
 *   - Every node's FEN is COMPUTED at module-load time by replaying SAN
 *     through chess.js, then normalised via normFen(). Hand-typed FENs
 *     are forbidden — the builder is the single source of truth.
 *   - The validator at the bottom (guarded by `import.meta.vitest`)
 *     re-derives every FEN at vitest-run time and asserts equality
 *     anyway, as a defence in depth.
 *
 * Mainlines must match `selectMainLine()` over book.ts so Learn lines
 * up with Drill. To re-derive: open book.ts, find the opening, walk
 * children picking heaviest weight at each step.
 */

import { Chess } from 'chess.js';
import { normFen } from './fen';

export interface LessonNode {
  /** Normalised FEN of the position AFTER the move (use normFen). */
  fen: string;
  /** SAN of the move that led here (omit for the starting position). */
  san?: string;
  /** Plain-English prose explaining the move and its idea. 1–4 sentences. */
  text: string;
}

/**
 * One distinct variation within an opening (e.g. "Giuoco Piano",
 * "Najdorf"). Lines are the unit users select and progress through
 * — chessreps' "X/N lines" semantics.
 */
export interface OpeningLine {
  /** Unique within an opening, e.g. 'giuoco-piano'. */
  id: string;
  /** Human name, e.g. 'Giuoco Piano'. */
  name: string;
  /** One-sentence description for the line picker. */
  description: string;
  /** Sequenced lesson nodes for this line. Always starts with the intro node. */
  nodes: LessonNode[];
}

export interface OpeningCourse {
  /** Matches the `sourceLabel` of the corresponding curated repertoire. */
  openingId: string;
  /** Course name, e.g. 'Italian Game'. */
  title: string;
  /** Short tagline shown on the course header card. */
  tagline: string;
  /** One or more lines; the first is treated as the default. */
  lines: OpeningLine[];
}

// FEN of the standard chess starting position, normalised.
const START_FEN_NORM = normFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

// ────────────────────────────────────────────────────────────────────────
// Authoring helpers
//
// `LineSpec` is the human-authored shape. `buildLine` runs the SAN
// sequence through chess.js to compute every FEN, so authors only ever
// type SAN — never FEN strings. This eliminates drift risk between
// hand-typed FENs and the chess.js replay path used at runtime.
// ────────────────────────────────────────────────────────────────────────

interface MoveSpec {
  san: string;
  text: string;
}

interface LineSpec {
  id: string;
  name: string;
  description: string;
  /** Intro prose shown on the starting position. */
  intro: string;
  /** Ordered list of moves for this line. */
  moves: MoveSpec[];
}

function buildLine(spec: LineSpec): OpeningLine {
  const game = new Chess();
  const nodes: LessonNode[] = [{ fen: START_FEN_NORM, text: spec.intro }];
  for (const m of spec.moves) {
    // chess.js throws on illegal SAN, which surfaces author errors at
    // module-load time with a clear stack trace.
    game.move(m.san);
    nodes.push({ fen: normFen(game.fen()), san: m.san, text: m.text });
  }
  return { id: spec.id, name: spec.name, description: spec.description, nodes };
}

// ────────────────────────────────────────────────────────────────────────
// Courses
// ────────────────────────────────────────────────────────────────────────

export const OPENING_COURSES: Record<string, OpeningCourse> = {
  // ====================================================================
  // ITALIAN GAME (white) — 4 lines
  // ====================================================================
  'italian-white': {
    openingId: 'italian-white',
    title: 'Italian Game',
    tagline: 'Old-school 1.e4 with the bishop staring down f7.',
    lines: [
      buildLine({
        id: 'giuoco-piano',
        name: 'Giuoco Piano',
        description: 'The classical mainline with c3 and d4 — most-played Italian since the 1500s.',
        intro: "Let's learn the Giuoco Piano! It's the oldest Italian Game line still played at the top level — Italian priests were analysing it in the 1500s, and somehow we're still arguing about the same lines. The plan is simple: build a pawn duo with c3 and d4, then attack on the kingside with the bishop on c4 already eyeing f7.",
        moves: [
          { san: 'e4', text: "**1.e4** — pawn to e4. The classical king's-pawn opening: it stakes a claim on the centre, opens the diagonal for the bishop on f1, and lets the queen out. Black's most popular reply is **1...e5**, which is what we're hoping for in the Italian." },
          { san: 'e5', text: "**1...e5** — Black mirrors. The two pawns now stare at each other in the middle of the board, and the fight is on for who gets to develop fastest and best." },
          { san: 'Nf3', text: "**2.Nf3** — knight to f3. Develops a piece, attacks the e5-pawn, and starts preparing to castle short. This move is so natural that the only real reason to skip it is if you're playing a gambit on purpose." },
          { san: 'Nc6', text: "**2...Nc6** — Black defends e5 and develops too. We're now in classical-opening territory; the next move is the one that names the system." },
          { san: 'Bc4', text: "**3.Bc4** — and there's the Italian Game. The bishop comes out to its best diagonal, eyeing the f7-pawn (which is only defended by the king). Every plan we make for the next few moves revolves around the pressure on f7." },
          { san: 'Bc5', text: "**3...Bc5** — the Giuoco Piano (\"quiet game\"). Black mirrors our bishop and the position is symmetrical. You've just reached one of the most-played positions in chess history. White's job now is to break the symmetry by grabbing space in the centre." },
          { san: 'c3', text: "**4.c3** — preparing **d4**. We don't push d4 immediately because Black's bishop on c5 would just trade off our centre pawn. Instead we build a pawn duo first: c3 supports d4, and after the inevitable exchanges the d-pawn is the one left standing." },
          { san: 'Nf6', text: "**4...Nf6** — Black develops and counter-attacks the e4-pawn. Both sides are now fully into the tactical phase. Our plan stays the same: push d4 next, force the centre open, and grab a lead in development." },
          { san: 'd4', text: "**5.d4** — the central break. We finally pull the trigger on the plan c3 was preparing. Black has to react: **5...exd4** is the principled reply, taking the pawn and forcing us to recapture in a way that defines the middlegame." },
          { san: 'exd4', text: "**5...exd4** — Black grabs the pawn. The central tension dissolves and we recapture next; the game is about to open up in our favour." },
          { san: 'cxd4', text: "**6.cxd4** — recapturing with the c-pawn. Now we have a beautiful classical pawn duo on d4 and e4 dominating the centre. Black's bishop on c5 is suddenly attacked by our d4-pawn, so they have to move it — and the most annoying square is b4, with check." },
          { san: 'Bb4+', text: "**6...Bb4+** — Black checks with the bishop, gaining a tempo before we can stabilise. You've reached the main tabiya of the Italian Game's classical attack. From here: meet the check (Nc3 or Bd2), finish development, castle, and use the centre and bishop on c4 to launch a kingside attack. The key squares to remember: **e5 and f7** — they were the targets all along." },
        ],
      }),
      buildLine({
        id: 'two-knights',
        name: 'Two Knights Defence',
        description: 'Black plays …Nf6 instead of …Bc5 — the door to the famous Fried Liver Attack.',
        intro: "Let's learn the Two Knights Defence! After 3.Bc4, Black skips the symmetrical bishop move and develops the knight instead — which gives White a chance to play the borderline-illegal-looking **4.Ng5**, jumping into f7 territory. This is the Fried Liver line: pure tactics, very fun, occasionally unsound.",
        moves: [
          { san: 'e4', text: "**1.e4** — same start as the Giuoco Piano. We're heading for **3.Bc4** and waiting to see if Black plays …Bc5 (Giuoco) or …Nf6 (Two Knights)." },
          { san: 'e5', text: "**1...e5** — Black mirrors. We have nothing to fear from a symmetrical centre because we'll move first." },
          { san: 'Nf3', text: "**2.Nf3** — natural development with a threat against e5. Black's options narrow down quickly." },
          { san: 'Nc6', text: "**2...Nc6** — defending the pawn and developing. Now comes the move that defines the Italian Game." },
          { san: 'Bc4', text: "**3.Bc4** — bishop to c4, eyeing f7 as always. Black's coming reply is the one that splits the Italian into Giuoco vs Two Knights." },
          { san: 'Nf6', text: "**3...Nf6** — the Two Knights Defence. Black counter-attacks our e4-pawn instead of mirroring our bishop, asking us a serious question: do we defend e4 quietly with d3, or do we go for the throat?" },
          { san: 'Ng5', text: "**4.Ng5** — knight to g5, double-attacking f7. This move violates every \"don't move the same piece twice in the opening\" rule, but it works because Black's f7-pawn is genuinely undefended. Black's only good reply is **4...d5** — the Fried Liver line." },
          { san: 'd5', text: "**4...d5** — the only move that doesn't lose. Black blocks our bishop's diagonal and offers a pawn to break the f7-attack. We must capture or our knight on g5 was wasted." },
          { san: 'exd5', text: "**5.exd5** — taking the pawn. Now Black has a critical decision: take back with the knight (the risky **5...Nxd5** allows the actual Fried Liver), or play **5...Na5** to chase our bishop and untangle slowly. The mainline is Na5." },
          { san: 'Na5', text: "**5...Na5** — knight to a5, attacking our bishop on c4 and stepping out of any nasty pins. This is the principled line; Black trades a tempo for safety." },
          { san: 'Bb5+', text: "**6.Bb5+** — bishop to b5 with check. We don't retreat to b3 because Black's plan would be …c6 hitting us anyway. The check forces Black to deal with us first. You've reached the main tabiya of the Two Knights — White is up a pawn for now, but Black has activity and ideas like **…c6** and **…h6** to chase our pieces back." },
        ],
      }),
      buildLine({
        id: 'evans-gambit',
        name: 'Evans Gambit',
        description: 'Sacrifice a pawn with 4.b4 to rip open the centre and rain pieces on Black\'s king.',
        intro: "Let's learn the Evans Gambit! Captain William Davies Evans invented it in 1827 on a ship, presumably because he had nothing else to do, and Garry Kasparov still uses it today. We sacrifice the b-pawn to lure Black's bishop offside, then crash through the centre with c3 and d4 a tempo faster than the Giuoco Piano allows.",
        moves: [
          { san: 'e4', text: "**1.e4** — open game start. The Evans needs the Italian setup to launch from, so the move-order is fixed for the first three moves." },
          { san: 'e5', text: "**1...e5** — Black accepts the open game. So far this is identical to the Giuoco Piano." },
          { san: 'Nf3', text: "**2.Nf3** — developing and pressuring e5. Standard." },
          { san: 'Nc6', text: "**2...Nc6** — defending and developing. We've reached the Italian's last common position before the gambit decision." },
          { san: 'Bc4', text: "**3.Bc4** — bishop to c4, the Italian setup. Now Black plays …Bc5 expecting a Giuoco Piano — and we surprise them." },
          { san: 'Bc5', text: "**3...Bc5** — Black goes into the Giuoco. Now for the move that turns this into something completely different." },
          { san: 'b4', text: "**4.b4** — the Evans Gambit! We offer the b-pawn to deflect Black's bishop. Why? Because once the bishop captures on b4, our **5.c3** kicks it again and we play d4 *with tempo*, ripping open the centre while Black's bishop is still wandering. Pure dynamics for a single pawn." },
          { san: 'Bxb4', text: "**4...Bxb4** — Black takes. Refusing the gambit (with **…Bb6** or **…Bd6**) is also possible but considered slightly worse. We've achieved the main goal: Black's bishop is now a target." },
          { san: 'c3', text: "**5.c3** — kicking the bishop and preparing d4. The bishop has to move again — usually back to a5, sometimes to e7 or c5. Every option costs Black tempo." },
          { san: 'Ba5', text: "**5...Ba5** — the most popular retreat, keeping the bishop on the long diagonal. Now we strike the centre." },
          { san: 'd4', text: "**6.d4** — the point of the gambit! We've built a huge pawn duo on d4 and e4, our pieces are about to swarm out, and Black is two tempi behind on development. You've reached the main tabiya of the Evans Gambit. From here: castle, play **Qb3** hitting f7, and look for sacrifices on f7 or e5. The pawn was a small price." },
        ],
      }),
      buildLine({
        id: 'italian-quiet',
        name: 'Italian Quiet System (4.d3)',
        description: 'The modern slow Italian — d3 instead of c3, building up before any pawn break.',
        intro: "Let's learn the Italian Quiet System! It's what most modern grandmasters play instead of the old c3-d4 mainline: **4.d3** keeps the centre stable, develops slowly, and aims for a long manoeuvring middlegame. Magnus Carlsen made this fashionable — it's also called the \"Giuoco Pianissimo\" (very quiet game), and yes that's a real chess term.",
        moves: [
          { san: 'e4', text: "**1.e4** — the king's-pawn opening. We're heading for the Italian, but with a quieter follow-up than the classical c3-d4." },
          { san: 'e5', text: "**1...e5** — Black mirrors. Standard reply that lets us reach the Italian." },
          { san: 'Nf3', text: "**2.Nf3** — developing and attacking e5. Forced moves still." },
          { san: 'Nc6', text: "**2...Nc6** — defending and developing. The familiar dance continues." },
          { san: 'Bc4', text: "**3.Bc4** — Italian Game declared. Bishop on its best diagonal, eyeing f7." },
          { san: 'Bc5', text: "**3...Bc5** — symmetrical bishop development. Black is happy with a slow game; we'll oblige with the modern setup." },
          { san: 'd3', text: "**4.d3** — the modern Italian. Instead of the loud **4.c3** intending d4, we just hold the centre and prepare a long manoeuvring battle. Plans: **c3, Nbd2, Bb3, h3, Re1, Nf1-g3** — the famous \"slow build\" that Carlsen has won countless games with." },
          { san: 'Nf6', text: "**4...Nf6** — Black develops naturally. Without the c3-d4 break to worry about, Black just gets pieces out and waits." },
          { san: 'c3', text: "**5.c3** — preparing a future d4 (we keep it as a long-term option) and giving the bishop on c4 a retreat square at b3. Slow, patient build-up." },
          { san: 'd6', text: "**5...d6** — Black supports the e5-pawn and prepares …Bg4 or …a6. The game is now positional; both sides will manoeuvre for 10+ moves before any real fireworks." },
          { san: 'Nbd2', text: "**6.Nbd2** — knight to d2, planning the famous **Nf1-Ng3** rerouting. This knight will travel to g3 (or e3) to support a future kingside attack. You've reached a classic Italian Quiet System tabiya. The plan: complete development, castle short, and only break with d4 when Black can't capture comfortably. Patience wins this opening." },
        ],
      }),
    ],
  },

  // ====================================================================
  // RUY LÓPEZ (white) — 4 lines
  // ====================================================================
  'ruylopez-white': {
    openingId: 'ruylopez-white',
    title: 'Ruy López (Spanish Game)',
    tagline: 'Bishop to b5, pinning the knight that defends e5 — old-school positional pressure.',
    lines: [
      buildLine({
        id: 'closed-spanish',
        name: 'Closed Spanish (Morphy)',
        description: 'The classical mainline through Morphy\'s a6, Ba4, Nf6, O-O, Be7 — the deep positional grind.',
        intro: "Let's learn the Closed Spanish! Named after the 16th-century Spanish priest Ruy López de Segura, who probably did not anticipate that 500 years later we'd still be playing this exact opening. The bishop on b5 pins Black's knight, the c6-knight defends e5, and we wage a long positional war over those squares.",
        moves: [
          { san: 'e4', text: "**1.e4** — pawn to e4, the open game. The Spanish demands a king's-pawn start." },
          { san: 'e5', text: "**1...e5** — Black mirrors. Without …e5 there's no Spanish, just other openings entirely." },
          { san: 'Nf3', text: "**2.Nf3** — knight develops and hits e5. Forced if we want a Spanish." },
          { san: 'Nc6', text: "**2...Nc6** — defending the e5-pawn and developing. Now for the move that names the opening." },
          { san: 'Bb5', text: "**3.Bb5** — bishop to b5, the Spanish move. We pin Black's c6-knight against the e5-pawn — if Black ever has to move the knight, e5 is hanging. Subtle, slow, and devastating over the long game." },
          { san: 'a6', text: "**3...a6** — the Morphy Defence (named after Paul Morphy, the 1850s American genius). Black asks our bishop a question: take the knight or retreat? The mainline is to retreat." },
          { san: 'Ba4', text: "**4.Ba4** — bishop retreats but stays on the diagonal aiming at c6. We've kept the pin alive without trading the bishop. The next phase is a slow development race." },
          { san: 'Nf6', text: "**4...Nf6** — Black develops naturally and hits e4. The standard plan; Black will look to play …Be7, …b5, and …d6 in some order." },
          { san: 'O-O', text: "**5.O-O** — castling short. We don't bother defending e4 just yet because if Black takes it (**5...Nxe4**), we play **6.d4** with a huge initiative — the Open Spanish. Most Black players don't take." },
          { san: 'Be7', text: "**5...Be7** — Black declines the gift, develops the bishop, and prepares to castle. The Closed Spanish is now in full bloom." },
          { san: 'Re1', text: "**6.Re1** — rook to e1, finally defending e4. Now Black's threats against the centre are gone, and we can play d4 at our leisure in coming moves. You've reached a true main tabiya of the Closed Ruy López. From here: Black plays **…b5, Bb3, …d6, …Na5** or **…O-O**, and we slowly fight for d5 and the kingside attack. Five-hour games await." },
        ],
      }),
      buildLine({
        id: 'berlin-defence',
        name: 'Berlin Defence',
        description: 'Black skips …a6 and plays the rock-solid …Nf6 — the line Kramnik used to dethrone Kasparov.',
        intro: "Let's learn the Berlin Defence! For most of the 20th century the Berlin was considered drawish and dull — until Vladimir Kramnik used it to take Kasparov's world title in 2000 with four straight draws. Now everyone plays it. We'll need to know our way around the famous \"Berlin Wall\" endgame.",
        moves: [
          { san: 'e4', text: "**1.e4** — the king's-pawn opening, our usual start." },
          { san: 'e5', text: "**1...e5** — Black accepts the open game." },
          { san: 'Nf3', text: "**2.Nf3** — natural development with pressure on e5." },
          { san: 'Nc6', text: "**2...Nc6** — defending e5 and developing. So far identical to every Spanish line." },
          { san: 'Bb5', text: "**3.Bb5** — Spanish bishop. The pin on c6 is the engine of the entire opening." },
          { san: 'Nf6', text: "**3...Nf6** — the Berlin Defence! Black skips …a6 entirely and develops the knight, attacking our e4-pawn directly. This is the move-order that defines the Berlin." },
          { san: 'O-O', text: "**4.O-O** — castling. The point: we let Black take e4, and the famous endgame begins. If Black declines with **…Bc5** or **…d6**, we transpose to slower lines, but the principled try is …Nxe4." },
          { san: 'Nxe4', text: "**4...Nxe4** — Black grabs the pawn. Now the dance: we play d4, Black has to deal with both the knight on e4 and the threat of d5." },
          { san: 'd4', text: "**5.d4** — central break with tempo. Black usually plays **5...Nd6** to attack our bishop and force a trade. The whole sequence leads to the Berlin endgame after **6.Bxc6 dxc6 7.dxe5 Nf5 8.Qxd8+ Kxd8** — Black has lost castling rights but has the bishop pair." },
          { san: 'Nd6', text: "**5...Nd6** — the Berlin Wall move. Black attacks our bishop on b5 and prepares the famous trade-off. We must take on c6 because retreating loses the d-file." },
          { san: 'Bxc6', text: "**6.Bxc6** — taking the knight. The structural concession (Black gets doubled c-pawns) is balanced by the bishop pair Black gets in return. A long endgame fight is brewing — you've reached the launching pad of the Berlin Wall. The plan from here: trade queens, push our kingside majority, and grind the bishop pair down. Famous Kramnik territory." },
        ],
      }),
      buildLine({
        id: 'exchange-spanish',
        name: 'Exchange Variation',
        description: 'Trade the bishop for the knight — White gets a clean structural plus and a quiet game.',
        intro: "Let's learn the Exchange Variation! It's the Spanish for people who don't want to memorise 25 moves of theory: we just trade the bishop for the knight, double Black's c-pawns, and head for an endgame where we're slightly better forever. Bobby Fischer made this line famous — he beat Spassky with it in their 1992 rematch.",
        moves: [
          { san: 'e4', text: "**1.e4** — the king's-pawn opening. Standard Spanish start." },
          { san: 'e5', text: "**1...e5** — Black mirrors." },
          { san: 'Nf3', text: "**2.Nf3** — develop, hit e5." },
          { san: 'Nc6', text: "**2...Nc6** — defend e5, develop. Familiar territory." },
          { san: 'Bb5', text: "**3.Bb5** — the Spanish bishop, pinning c6." },
          { san: 'a6', text: "**3...a6** — Morphy Defence. Black challenges the bishop to make a decision." },
          { san: 'Bxc6', text: "**4.Bxc6** — and we take! Most White players retreat to a4 keeping the pin, but the Exchange has its own logic: we damage Black's pawn structure permanently and head for an endgame. Black's pawns on the queenside become a long-term liability." },
          { san: 'dxc6', text: "**4...dxc6** — the recapture. Black takes with the d-pawn (recapturing with the b-pawn would block the bishop and weaken c6 even more). Black now has the bishop pair — that's the compensation for the doubled pawns — and a half-open d-file." },
          { san: 'O-O', text: "**5.O-O** — castling. We don't bother defending e4 because of the structural threat **6.Nxe5** if Black ever plays …Qxd1+ — we'd just keep our queen and Black's pawn on e5 falls. Solid and simple." },
          { san: 'f6', text: "**5...f6** — Black supports e5. This is the most popular reply; alternatives include …Bd6 or …Bg4. The pawn move blocks the bishop on c8 a bit but firmly holds the centre." },
          { san: 'd4', text: "**6.d4** — central break. We trade pieces, exchange queens if possible, and head straight for the famous Exchange endgame: White has 4 vs 3 on the kingside, Black has 4 vs 3 on the queenside, and our majority creates a passed pawn cleanly while Black's doubled c-pawns can't. You've reached the Fischer Exchange tabiya. Boring? Maybe. Winning? Frequently." },
        ],
      }),
      buildLine({
        id: 'open-spanish',
        name: 'Open Spanish',
        description: 'Black grabs the e4-pawn at move 5 — sharp tactics in the centre.',
        intro: "Let's learn the Open Spanish! In the Closed Spanish, Black politely declines our undefended e4-pawn at move 5. In the Open Spanish, Black just takes it. The result is wide-open lines, both kings exposed for a few critical moves, and serious tactical fireworks if either side miscalculates.",
        moves: [
          { san: 'e4', text: "**1.e4** — open game start." },
          { san: 'e5', text: "**1...e5** — Black mirrors, accepting the symmetric centre." },
          { san: 'Nf3', text: "**2.Nf3** — developing with a threat to e5." },
          { san: 'Nc6', text: "**2...Nc6** — defending and developing. Standard." },
          { san: 'Bb5', text: "**3.Bb5** — the Spanish bishop. The pin begins." },
          { san: 'a6', text: "**3...a6** — Morphy Defence, asking the bishop to commit." },
          { san: 'Ba4', text: "**4.Ba4** — bishop steps back, pin still alive. Now the standard development continues." },
          { san: 'Nf6', text: "**4...Nf6** — Black develops and hits e4. The pressure on our centre starts." },
          { san: 'O-O', text: "**5.O-O** — castling, casually leaving e4 \"undefended\" (it's not really — we have hidden tactics if Black takes). The principled try is to call our bluff." },
          { san: 'Nxe4', text: "**5...Nxe4** — Black grabs the pawn! The Open Spanish begins. Black has won material temporarily, but our development is about to surge ahead with d4." },
          { san: 'd4', text: "**6.d4** — the standard reply. We open the centre, attack e5, and prepare to recapture our pawn on e4 with serious tempo. Black's main move now is **6...b5** (chasing our bishop with a tempo before we can recapture) followed by **…d5** to support the e4-knight. You've reached the Open Spanish branching point. From here: **7.Bb3 d5 8.dxe5 Be6** is the classical setup, with both sides building towards a sharp middlegame. The Open isn't for the faint-hearted." },
        ],
      }),
    ],
  },

  // ====================================================================
  // SICILIAN DEFENCE (black) — 4 lines
  // ====================================================================
  'sicilian-black': {
    openingId: 'sicilian-black',
    title: 'Sicilian Defence',
    tagline: 'The most popular weapon against 1.e4 — and the most theory-heavy.',
    lines: [
      buildLine({
        id: 'najdorf',
        name: 'Najdorf',
        description: 'Black plays …a6 at move 5 — the most analysed line in chess history.',
        intro: "Let's learn the Najdorf! It's the Sicilian line that Bobby Fischer used to win the world title and that Garry Kasparov never stopped playing. **5...a6** looks innocent but it controls b5 and prepares **…b5** or **…e5** depending on what White does next. Welcome to the most theory-heavy variation in chess.",
        moves: [
          { san: 'e4', text: "**1.e4** — White grabs the centre with the king's-pawn, the most-played first move in chess. Now it's our turn, and instead of the symmetrical 1...e5 we're going to do something completely different." },
          { san: 'c5', text: "**1...c5** — the Sicilian. We don't fight White's e-pawn directly; instead we strike at d4 from the side. The c-pawn lever creates a half-open c-file the moment White plays d4, and that file becomes our highway for the rest of the game." },
          { san: 'Nf3', text: "**2.Nf3** — White's most popular move, developing and preparing the d4 break. We're heading into the Open Sicilian, the main battleground." },
          { san: 'd6', text: "**2...d6** — supporting an eventual …e5 and keeping flexible. This move-order is the gateway to both the Najdorf and the Dragon; we keep our knights and bishops uncommitted until White shows their hand." },
          { san: 'd4', text: "**3.d4** — White cracks open the centre. This is exactly what we wanted: we'll trade pawns next, pulling White's d-pawn off the board and opening the c-file." },
          { san: 'cxd4', text: "**3...cxd4** — we take. The c-file is now half-open for us and we've traded a wing pawn for a centre pawn — a small but durable gain." },
          { san: 'Nxd4', text: "**4.Nxd4** — White recaptures with the knight, the standard recapture. Their knight is centralised, but it's also a target." },
          { san: 'Nf6', text: "**4...Nf6** — developing and hitting the e4-pawn. White must defend it; the most popular move is **5.Nc3**." },
          { san: 'Nc3', text: "**5.Nc3** — White defends e4 and develops. We've reached the Open Sicilian crossroads — our next move decides the variation." },
          { san: 'a6', text: "**5...a6** — the Najdorf! A tiny pawn move with enormous consequences: it controls b5 (so White can't park a knight or bishop there) and prepares …b5 to launch a queenside expansion. Joining a very long club of Najdorf players." },
          { san: 'Bg5', text: "**6.Bg5** — one of White's main tries: pinning our f6-knight against the queen and signalling a fast kingside attack with f3, Qd2, and 0-0-0. You've reached a Najdorf tabiya — opposite-side castling and a race-to-mate is on the menu. Our plan: complete development with **…e6, …Be7, …0-0**, then counter-punch with **…b5** on the queenside." },
        ],
      }),
      buildLine({
        id: 'dragon',
        name: 'Dragon',
        description: 'Fianchetto the dark-squared bishop with …g6, …Bg7 — sharpest of all Sicilians.',
        intro: "Let's learn the Sicilian Dragon! The pawn structure looks like a dragon if you squint hard enough, and so does the level of carnage the opening produces. We fianchetto our dark-squared bishop and aim it down the long diagonal at White's queenside, while White typically castles long and tries to checkmate us first. Whoever attacks faster wins — usually within 25 moves.",
        moves: [
          { san: 'e4', text: "**1.e4** — White's classical opening." },
          { san: 'c5', text: "**1...c5** — the Sicilian. We refuse symmetry and fight for the centre asymmetrically." },
          { san: 'Nf3', text: "**2.Nf3** — White prepares d4. The Open Sicilian beckons." },
          { san: 'd6', text: "**2...d6** — flexible move that keeps both Najdorf and Dragon plans alive. Some Dragon players play **2...Nc6** instead, which is also fine." },
          { san: 'd4', text: "**3.d4** — White goes Open. Exactly what we're hoping for." },
          { san: 'cxd4', text: "**3...cxd4** — half-open c-file, gained pawn structurally. The Sicilian engine is humming." },
          { san: 'Nxd4', text: "**4.Nxd4** — White recaptures with the knight, the only sensible recapture." },
          { san: 'Nf6', text: "**4...Nf6** — develop, hit e4, force White to commit." },
          { san: 'Nc3', text: "**5.Nc3** — defending e4 with the knight. Now the move-order branches." },
          { san: 'g6', text: "**5...g6** — the Dragon! We commit the dark-squared bishop to the long diagonal. White's most popular response is **6.Be3** preparing the **Yugoslav Attack** with f3, Qd2, and O-O-O." },
          { san: 'Be3', text: "**6.Be3** — White prepares the Yugoslav Attack: f3, Qd2, Bh6, h4-h5 with mate ideas. We need to develop fast and attack first." },
          { san: 'Bg7', text: "**6...Bg7** — bishop to g7, the dragon's tongue. You've reached the Dragon tabiya. From here: **…O-O, …Nc6, …Bd7, …Rc8** — every piece points at White's queenside, and our rook on c8 will swing into c4 to crash through. The race is on; one tempo decides the game." },
        ],
      }),
      buildLine({
        id: 'sveshnikov',
        name: 'Sveshnikov',
        description: 'Black plays …e5 at move 5 — concedes the d5-square but gets dynamic piece play.',
        intro: "Let's learn the Sveshnikov Sicilian! Once considered a positional crime (Black voluntarily creates a giant hole on d5), the Sveshnikov became respectable thanks to Soviet GM Evgeny Sveshnikov in the 1970s and Magnus Carlsen used it to crush Caruana in their 2018 World Championship match. Modern theory has rehabilitated the structure completely.",
        moves: [
          { san: 'e4', text: "**1.e4** — White's first move." },
          { san: 'c5', text: "**1...c5** — the Sicilian." },
          { san: 'Nf3', text: "**2.Nf3** — White heads for the Open Sicilian." },
          { san: 'Nc6', text: "**2...Nc6** — Sveshnikov-bound. The knight on c6 is going to be a key piece in the coming structure." },
          { san: 'd4', text: "**3.d4** — White breaks open the centre, exactly as planned." },
          { san: 'cxd4', text: "**3...cxd4** — we take. Half-open c-file is established." },
          { san: 'Nxd4', text: "**4.Nxd4** — White recaptures." },
          { san: 'Nf6', text: "**4...Nf6** — develop and pressure e4." },
          { san: 'Nc3', text: "**5.Nc3** — defending e4, the standard reply." },
          { san: 'e5', text: "**5...e5** — and there's the Sveshnikov! This move looks insane: we kick the white knight on d4 but voluntarily create a permanent weakness on d5. White will plant a piece there forever, but we get the bishop pair, dynamic minor-piece play, and a clear pawn break with …d5 later." },
          { san: 'Ndb5', text: "**6.Ndb5** — knight jumps to b5, the principled reply. White threatens **Nd6+** which would be devastating — we must defend immediately." },
          { san: 'd6', text: "**6...d6** — defending the d6-square, blunting Nd6+. You've reached the main starting position of the Sveshnikov. From here: White plays **7.Bg5** pinning our knight, we eventually play **…a6** kicking the b5-knight back to a3, and we follow with **…b5** and **…Bb7** putting heavy pressure on White's centre. Long, complex, surprisingly drawable." },
        ],
      }),
      buildLine({
        id: 'closed-sicilian',
        name: 'Closed Sicilian',
        description: 'White avoids d4 entirely and plays Nc3, g3, Bg2 — slower fianchetto setup.',
        intro: "Let's learn the Closed Sicilian! When White plays **2.Nc3** instead of 2.Nf3, they're refusing to open the centre and heading for a slow positional game with **g3, Bg2, f4** and a kingside attack. As Black we set up symmetrically with our own fianchetto, develop calmly, and prepare a queenside expansion of our own.",
        moves: [
          { san: 'e4', text: "**1.e4** — White's first move." },
          { san: 'c5', text: "**1...c5** — Sicilian. We're ready for whatever White throws at us." },
          { san: 'Nc3', text: "**2.Nc3** — the Closed Sicilian! White is signalling a different game: no early d4, no open centre, just slow piece development. Boris Spassky was a famous practitioner." },
          { san: 'Nc6', text: "**2...Nc6** — developing the knight to its natural square. We mirror White's calm setup." },
          { san: 'g3', text: "**3.g3** — White prepares the kingside fianchetto, the signature move of the Closed Sicilian. The bishop on g2 will eye our queenside." },
          { san: 'g6', text: "**3...g6** — we mirror, preparing our own fianchetto. The position will be roughly symmetric for the next few moves." },
          { san: 'Bg2', text: "**4.Bg2** — bishop to g2, the long diagonal. Standard." },
          { san: 'Bg7', text: "**4...Bg7** — and we mirror once more. Both bishops eye the centre and the opposite-coloured wing." },
          { san: 'd3', text: "**5.d3** — White supports e4 and prepares the slow build-up. The classic Closed Sicilian setup is now visible: **f4, Nf3, O-O**, eventually pushing the f-pawn for a kingside attack." },
          { san: 'd6', text: "**5...d6** — supporting our centre, mirroring White's restraint. We're playing the Closed Sicilian to the letter." },
          { san: 'f4', text: "**6.f4** — White's main plan revealed: a slow kingside pawn storm with f4-f5 to come. Our reply is to expand on the queenside where we're going to attack. Plan: **…Rb8, …b5-b4** to chase White's c3-knight off and rip open the queenside. Both sides ignore the centre and race on opposite wings — whoever gets there first wins." },
        ],
      }),
    ],
  },

  // ====================================================================
  // CARO-KANN (black) — 4 lines
  // ====================================================================
  'carokann-black': {
    openingId: 'carokann-black',
    title: 'Caro-Kann Defence',
    tagline: 'Solid, structurally sound, and surprisingly hard to beat.',
    lines: [
      buildLine({
        id: 'classical',
        name: 'Classical Variation',
        description: 'The mainline with 4...Bf5 — get the light-squared bishop out before …e6.',
        intro: "Let's learn the Classical Caro-Kann! It was popularised in the 1880s by Horatio Caro and Marcus Kann, neither of whom was named Levy. It's the solid, structurally clean answer to 1.e4 — the chess equivalent of refusing to argue with someone on the internet. The Classical line gets our \"problem bishop\" out to f5 before we close the diagonal with …e6, which is the structural privilege the French Defence never gets.",
        moves: [
          { san: 'e4', text: "**1.e4** — White's classical opening move. Now we choose how to challenge that pawn — and instead of the cramped 1...e6 (the French) we'll play the move that doesn't lock our light-squared bishop in." },
          { san: 'c6', text: "**1...c6** — the move that names the opening. It looks modest, but it prepares **…d5** with full pawn support, so when we challenge the centre on the next move our d-pawn won't be hanging." },
          { san: 'd4', text: "**2.d4** — White grabs the whole centre. Exactly what we want them to do — now we strike." },
          { san: 'd5', text: "**2...d5** — challenging the centre with full backup. White must now choose: trade pawns (Exchange), push past (Advance), or defend with a knight (Classical / Tarrasch). All three are playable; the Classical is the main test." },
          { san: 'Nc3', text: "**3.Nc3** — White defends e4 with a knight. They're committing to the Classical Variation. Our move is forced if we want a clean game: capture on e4 and let White recapture with the knight." },
          { san: 'dxe4', text: "**3...dxe4** — taking. We don't worry about giving up the centre pawn; the structural exchange is fine for us, and we have a very specific plan for our light-squared bishop coming up." },
          { san: 'Nxe4', text: "**4.Nxe4** — White recaptures, knight to e4. They have a centralised knight and a small space advantage; we have a solid pawn structure and the bishop pair waiting in the wings." },
          { san: 'Bf5', text: "**4...Bf5** — and there's the move that defines the Classical Caro-Kann. We develop our \"problem bishop\" outside the pawn chain BEFORE playing …e6. White will kick the bishop next." },
          { san: 'Ng3', text: "**5.Ng3** — kicking the bishop. White spends a tempo to harass us, but the bishop is going to a good square anyway; this is the kind of \"win\" that doesn't really win anything." },
          { san: 'Bg6', text: "**5...Bg6** — bishop to g6, eyeing White's queenside and ready to retreat to h7 if poked. You've reached the main tabiya of the Classical Caro-Kann. The middlegame plan: complete development with **…Nf6, …e6, …Bd6** or **…Be7**, castle short, and slowly outplay White from a structurally sound position. White will probably play **6.h4** to chase the bishop and start a kingside attack — that's the famous \"Caro-Kann attacking line\" and we're ready for it." },
        ],
      }),
      buildLine({
        id: 'advance',
        name: 'Advance Variation',
        description: 'White locks the centre with 3.e5 — Black plays …Bf5 outside the pawn chain.',
        intro: "Let's learn the Advance Caro-Kann! When White plays **3.e5** they're trying to bury us in space — but we have the same trick available as in the French Advance, with a major bonus: we can still develop our light-squared bishop to f5. That single difference is why the Caro-Kann is structurally healthier than the French.",
        moves: [
          { san: 'e4', text: "**1.e4** — King's-pawn opening. We're heading for our trusty Caro-Kann setup." },
          { san: 'c6', text: "**1...c6** — preparing …d5 with support. Standard Caro-Kann move-order." },
          { san: 'd4', text: "**2.d4** — White grabs the centre. The natural reply, asking us if we really want to challenge it." },
          { san: 'd5', text: "**2...d5** — yes we do. The pawns face off, and White has three main choices: take, push past, or defend." },
          { san: 'e5', text: "**3.e5** — the Advance Variation. White locks the centre, gets a big space advantage, and dares us to find counterplay. The whole opening hinges on what we do with our c8-bishop." },
          { san: 'Bf5', text: "**3...Bf5** — and that's the answer! We develop the bishop OUTSIDE the pawn chain. In the French Defence, this bishop is stuck behind …e6 forever; in the Caro-Kann Advance we get it out for free. This single move is why the Caro-Kann is structurally healthier than the French." },
          { san: 'Nf3', text: "**4.Nf3** — White develops and prepares to challenge our bishop. The standard mainline; alternatives like **4.Nc3** (Short System) and **4.h4** (sharp) also exist." },
          { san: 'e6', text: "**4...e6** — supporting our d5-pawn and preparing development of the f8-bishop. Now we're building a French-like structure but with the c8-bishop already happily placed." },
          { san: 'Be2', text: "**5.Be2** — White develops the bishop modestly, planning O-O and slow play. The position is approximately equal; both sides have to manoeuvre carefully." },
          { san: 'Nd7', text: "**5...Nd7** — knight to d7, preparing **…Ne7** and **…c5** to break the centre. You've reached the main tabiya of the Advance Caro-Kann. The plan: complete development with **…Ne7, …Bg6** (re-routing the bishop if poked), castle short, and break with **…c5** at the right moment. Patient, solid, surprisingly winnable." },
        ],
      }),
      buildLine({
        id: 'exchange',
        name: 'Exchange Variation',
        description: 'White trades pawns at move 3 — symmetric structure, slow positional game.',
        intro: "Let's learn the Exchange Caro-Kann! When White plays **3.exd5 cxd5** the position becomes symmetrical and very calm — but symmetry doesn't mean draw. With careful piece play we can outmanoeuvre White from the slightly inferior side of nothing. This is one of the few Caro-Kann lines where Black plays for a win without taking risks.",
        moves: [
          { san: 'e4', text: "**1.e4** — the king's-pawn opening." },
          { san: 'c6', text: "**1...c6** — Caro-Kann setup, preparing …d5." },
          { san: 'd4', text: "**2.d4** — White takes the centre." },
          { san: 'd5', text: "**2...d5** — we strike back. Now White picks one of three plans." },
          { san: 'exd5', text: "**3.exd5** — the Exchange Variation. White just trades pawns, simplifying the position and aiming for a quiet positional game. This used to be considered a drawing weapon for White; modern theory says Black is fine." },
          { san: 'cxd5', text: "**3...cxd5** — we take with the c-pawn. The pawn structure is now symmetrical: both sides have pawns on d5/d4 and isolated half-files. The game becomes about piece activity and minor manoeuvring." },
          { san: 'Bd3', text: "**4.Bd3** — White's main move, developing the bishop to its best square and preparing **c3** with a small queenside fianchetto. Our reply mirrors theirs." },
          { san: 'Nc6', text: "**4...Nc6** — developing the knight to its natural square, eyeing the b4 outpost and supporting an eventual …e5 break." },
          { san: 'c3', text: "**5.c3** — White supports d4 and gives the bishop on d3 a retreat square. Standard manoeuvring." },
          { san: 'Nf6', text: "**5...Nf6** — developing the kingside knight, preparing castling. The position is calm but rich; both sides will manoeuvre carefully for many moves." },
          { san: 'Bf4', text: "**6.Bf4** — White develops the dark-squared bishop, completing the standard Exchange setup. You've reached the Exchange Caro-Kann tabiya. The plan: develop with **…Bg4** (pinning the f3-knight), play **…e6** and **…Bd6** to challenge the f4-bishop, castle short, and outplay White slowly. Boring? A little. Solid? Like granite." },
        ],
      }),
      buildLine({
        id: 'panov-botvinnik',
        name: 'Panov-Botvinnik Attack',
        description: 'White plays the IQP setup with c4 — sharp and tactical against the Caro-Kann.',
        intro: "Let's learn the Panov-Botvinnik Attack! When White plays **3.exd5 cxd5 4.c4** they're transposing the Caro-Kann into an Isolated Queen's Pawn (IQP) middlegame — sharp, tactical, and full of dynamic chances for both sides. Mikhail Botvinnik used this line to crush opponents in the 1940s; we'll need to know our defensive ideas.",
        moves: [
          { san: 'e4', text: "**1.e4** — the king's-pawn." },
          { san: 'c6', text: "**1...c6** — Caro-Kann start. We're ready for any of White's tries." },
          { san: 'd4', text: "**2.d4** — White grabs the centre." },
          { san: 'd5', text: "**2...d5** — we challenge. White's three options: Classical (Nc3), Advance (e5), or Exchange (exd5)." },
          { san: 'exd5', text: "**3.exd5** — Exchange-like start. But White isn't planning to play quietly..." },
          { san: 'cxd5', text: "**3...cxd5** — recapture. The pawn structure looks like the boring Exchange Caro-Kann — but White's next move changes everything." },
          { san: 'c4', text: "**4.c4** — the Panov! By offering an IQP (isolated queen pawn), White takes on a weakness in exchange for piece activity, central control, and tactical chances. Our job: develop carefully and either trade pieces (favouring Black) or blockade the d4-pawn." },
          { san: 'Nf6', text: "**4...Nf6** — developing and putting pressure on the c4-pawn indirectly through e4. Standard." },
          { san: 'Nc3', text: "**5.Nc3** — White develops, defending c4 indirectly (cxd5 Nxd5 hits c3) and preparing rapid development. Sharp position." },
          { san: 'e6', text: "**5...e6** — solid Caro-Kann move, supporting d5 and developing. Alternatives include the more ambitious **5...Nc6** or **5...g6** (Gruenfeld-style); …e6 is the rock-solid mainline." },
          { san: 'Nf3', text: "**6.Nf3** — White completes development. You've reached the Panov-Botvinnik tabiya. The plan: develop with **…Be7, …O-O, …b6, …Bb7** in some order, blockade White's potential isolated d-pawn on d4 with a piece on d5, and slowly grind into the endgame. The IQP is a long-term weakness if we survive the middlegame attack." },
        ],
      }),
    ],
  },

  // ====================================================================
  // FRENCH DEFENCE (black) — 1 line (Winawer mainline)
  // ====================================================================
  'french-black': {
    openingId: 'french-black',
    title: 'French Defence',
    tagline: 'Solid 1...e6 with a locked centre — slow counterplay and structural play.',
    lines: [
      buildLine({
        id: 'winawer',
        name: 'Winawer Variation',
        description: 'The sharpest French line — pin the c3-knight with …Bb4 and accept a damaged structure for activity.',
        intro: "Let's learn the French Winawer! It's the sharpest line in the French Defence: we pin White's c3-knight with **…Bb4**, force structural concessions, and accept doubled c-pawns in exchange for the bishop pair and dynamic piece play. Mikhail Botvinnik used this line for decades; it's complex, principled, and rewards good preparation.",
        moves: [
          { san: 'e4', text: "**1.e4** — White's king's-pawn opening, the most popular first move in chess. We're going to lock the centre." },
          { san: 'e6', text: "**1...e6** — the move that names the French Defence. It looks small but prepares **…d5** with full support — and accepts that our light-squared bishop will be temporarily locked behind the pawn chain." },
          { san: 'd4', text: "**2.d4** — White grabs the whole centre. Exactly what the French wants." },
          { san: 'd5', text: "**2...d5** — challenging the centre. White must commit." },
          { san: 'Nc3', text: "**3.Nc3** — White defends e4 with the knight, the most ambitious choice. This is the move-order that allows the Winawer." },
          { san: 'Bb4', text: "**3...Bb4** — the Winawer! We pin the c3-knight against the e4-pawn. White's centre is genuinely under threat — they have to do something concrete or lose the e-pawn." },
          { san: 'e5', text: "**4.e5** — White pushes past, the principled reply. The centre is now fixed with pawns on d4-e5 vs d5-e6. Our bishop on b4 is suddenly attacking nothing useful, but we have a plan." },
          { san: 'c5', text: "**4...c5** — striking the d4-pawn from the side. We refuse to let White have a comfortable centre; the c-file will become a key battleground for us." },
          { san: 'a3', text: "**5.a3** — White asks our bishop a question: take the knight or retreat? In the Winawer mainline, we take." },
          { san: 'Bxc3+', text: "**5...Bxc3+** — taking with check, forcing White to recapture with the b-pawn (the only legal recapture). White's queenside structure is now permanently damaged with doubled c-pawns." },
          { san: 'bxc3', text: "**6.bxc3** — forced recapture. White has the bishop pair and a strong central pawn duo, but we have a serious structural target on c3. You've reached the main Winawer tabiya. The plan: complete development with **…Ne7, …Nbc6, …Qa5**, castle short or long depending on circumstances, and pressure the c-pawns with **…Rc8** and queenside expansion. Strategically rich, tactically sharp, and a lot of fun." },
        ],
      }),
    ],
  },

  // ====================================================================
  // QUEEN'S GAMBIT DECLINED (white) — 1 line
  // ====================================================================
  'qgd-white': {
    openingId: 'qgd-white',
    title: "Queen's Gambit Declined",
    tagline: '1.d4 d5 2.c4 e6 — the bedrock classical opening for both sides.',
    lines: [
      buildLine({
        id: 'qgd-mainline',
        name: 'QGD Mainline (Bg5)',
        description: 'Pin the f6-knight with Bg5 and head for the classical Orthodox Variation.',
        intro: "Let's learn the QGD Mainline! It's the foundation of countless world-championship games — Capablanca, Alekhine, Botvinnik, Kasparov, Carlsen, all played this opening on both sides. We pin Black's f6-knight with **Bg5** and aim for slow, principled positional play. Solid, classy, and deceptively deep.",
        moves: [
          { san: 'd4', text: "**1.d4** — pawn to d4, the queen's-pawn opening. We're heading for one of the great classical openings." },
          { san: 'd5', text: "**1...d5** — Black mirrors. Now we challenge the centre with the famous gambit." },
          { san: 'c4', text: "**2.c4** — the Queen's Gambit. We \"offer\" the c-pawn (Black can't really take it safely, but it's a fair structural offer). Our plan: pressure d5, control the centre, develop classically." },
          { san: 'e6', text: "**2...e6** — Queen's Gambit Declined. Black supports d5 with the e-pawn, accepting a temporarily blocked light-squared bishop in exchange for solid structure." },
          { san: 'Nc3', text: "**3.Nc3** — developing the queenside knight, attacking d5 again. The natural choice in the QGD mainline." },
          { san: 'Nf6', text: "**3...Nf6** — Black develops and defends d5. The classical QGD position is taking shape." },
          { san: 'Bg5', text: "**4.Bg5** — pinning the f6-knight against the queen. This is the Orthodox QGD's signature move: the pin makes …dxc4 less attractive (because we can recapture with the c-pawn, freeing the centre), and it preps a future Nf3 + e3 setup." },
          { san: 'Be7', text: "**4...Be7** — Black develops the bishop, breaking the pin. The standard reply; the bishop on e7 also prepares castling." },
          { san: 'e3', text: "**5.e3** — modest pawn move that frees our king's-bishop and supports d4. The Orthodox setup is now visible: **Nf3, Bd3, O-O, Rc1**, all slowly building before any pawn break. You've reached the main Orthodox QGD position. The plan: complete development, double rooks on the c-file, and prepare the long-term break **e4** at exactly the right moment. Positional patience wins this opening." },
        ],
      }),
    ],
  },

  // ====================================================================
  // KING'S INDIAN DEFENCE (black) — 1 line
  // ====================================================================
  'kid-black': {
    openingId: 'kid-black',
    title: "King's Indian Defence",
    tagline: 'Hypermodern: invite a big white centre, then attack it.',
    lines: [
      buildLine({
        id: 'kid-classical',
        name: 'Classical KID',
        description: 'The mainline with …Bg7, …O-O, …d6 — invite the big centre and counterattack.',
        intro: "Let's learn the Classical King's Indian! It's the most romantic black opening against 1.d4: we let White build a huge pawn centre, fianchetto our bishop on g7, castle short, and then storm White's king with **…f5**. Bobby Fischer played it, Kasparov played it, and even Magnus Carlsen still uses it occasionally. Wild middlegames, opposite-side attacks, and racing pawn storms.",
        moves: [
          { san: 'd4', text: "**1.d4** — White's queen's-pawn opening. We're going to play hypermodernly." },
          { san: 'Nf6', text: "**1...Nf6** — developing the knight and not committing to a centre yet. The signature first move of the Indian Defences." },
          { san: 'c4', text: "**2.c4** — White grabs more central space. Standard reply, leading to all the great Indian openings." },
          { san: 'g6', text: "**2...g6** — preparing the fianchetto. We're committing to the King's Indian setup — bishop to g7 next." },
          { san: 'Nc3', text: "**3.Nc3** — White develops the queenside knight, controlling e4 and d5. The mainline." },
          { san: 'Bg7', text: "**3...Bg7** — bishop to g7, the King's Indian move. The bishop eyes the long diagonal and Black's queenside, supporting our future kingside attack from afar." },
          { san: 'e4', text: "**4.e4** — White grabs the whole centre with a classical pawn duo. We've achieved our hypermodern goal: White is overextended. Our job is to attack the centre before they consolidate." },
          { san: 'd6', text: "**4...d6** — supporting an eventual …e5 break (the heart of the King's Indian) and preparing development of the c8-bishop." },
          { san: 'Nf3', text: "**5.Nf3** — White's natural development. The Classical KID setup; alternatives like the Sämisch (5.f3) or Four Pawns (5.f4) are also serious." },
          { san: 'O-O', text: "**5...O-O** — castling kingside. We get our king to safety before the centre opens up." },
          { san: 'Be2', text: "**6.Be2** — White completes development modestly. The position is now in the famous Classical Mar del Plata setup. Your plan: play **…e5** challenging the centre, then if White closes with **d5**, launch the famous king's-side attack with **…Nh5, …f5, …f4, …g5** — pure violence aimed at the white king. Both sides race; the attack that lands first wins." },
        ],
      }),
    ],
  },

  // ====================================================================
  // LONDON SYSTEM (white) — 1 line
  // ====================================================================
  'london-white': {
    openingId: 'london-white',
    title: 'London System',
    tagline: 'Easy-to-learn 1.d4 system: Bf4, e3, c3, Nbd2 — same setup against everything.',
    lines: [
      buildLine({
        id: 'london-mainline',
        name: 'London System Mainline',
        description: 'Bf4 setup with e3 and c3 — the rock-solid pyramid that works against most defences.',
        intro: "Let's learn the London System! It's the opening for people who want results without spending months memorising theory. We set up the same pyramid against everything — **Bf4, e3, c3, Nbd2, Bd3** — and play for slow, simple positional chess. Magnus Carlsen plays it. So can you.",
        moves: [
          { san: 'd4', text: "**1.d4** — the queen's-pawn opening. The London is officially a 1.d4 system." },
          { san: 'd5', text: "**1...d5** — Black mirrors. The London works against this and against the Indian setups." },
          { san: 'Bf4', text: "**2.Bf4** — bishop to f4! This is the move that names the London. We get our \"problem bishop\" out before locking it in with e3, which is the structural privilege the London grants us over the older Colle System." },
          { san: 'Nf6', text: "**2...Nf6** — Black develops naturally. The most popular reply." },
          { san: 'e3', text: "**3.e3** — supporting d4 and preparing development. The c1-bishop is already out, so e3 doesn't trap anything." },
          { san: 'e6', text: "**3...e6** — Black develops the e-pawn, preparing …Bd6 or …Be7. The position is calm and roughly symmetric." },
          { san: 'Nf3', text: "**4.Nf3** — developing the kingside knight. Standard; the London system rolls on." },
          { san: 'Bd6', text: "**4...Bd6** — Black challenges our bishop on f4. We have to decide whether to trade or retreat." },
          { san: 'Bg3', text: "**5.Bg3** — bishop steps back to g3, keeping the pair. We avoid the trade because our bishop pair is one of the small advantages in this slow system." },
          { san: 'O-O', text: "**5...O-O** — Black castles. Calm developing moves continue on both sides." },
          { san: 'c3', text: "**6.c3** — supporting d4 and preparing **Nbd2** completing the famous London \"pyramid.\" You've reached the classic London tabiya. The plan: **Nbd2, Bd3, O-O, Rc1**, and slowly build a kingside attack with **Ne5** at some point. Simple, repeatable, and surprisingly hard to crack." },
        ],
      }),
    ],
  },

  // ====================================================================
  // ENGLISH OPENING (white) — 1 line
  // ====================================================================
  'english-white': {
    openingId: 'english-white',
    title: 'English Opening',
    tagline: '1.c4 — flexible flank approach. Often transposes; great move-order weapon.',
    lines: [
      buildLine({
        id: 'reversed-sicilian',
        name: 'Reversed Sicilian',
        description: 'Black plays …e5 — we get a Sicilian-like position with an extra tempo.',
        intro: "Let's learn the English Opening Reversed Sicilian! When Black plays **1...e5** in response to our **1.c4**, we get a Sicilian Defence position with the colours reversed and an extra tempo. If we know the Sicilian's ideas as Black, we can apply them now as White — with the bonus that being a tempo up makes everything easier.",
        moves: [
          { san: 'c4', text: "**1.c4** — the English Opening, named after the 19th-century English master Howard Staunton. We grab the d5-square and stay flexible — the move can transpose into almost anything depending on Black's reply." },
          { san: 'e5', text: "**1...e5** — Black plays a Reversed Sicilian. They want a classical e-pawn game; we'll happily oblige with the colours reversed." },
          { san: 'Nc3', text: "**2.Nc3** — developing and pressuring d5 (which Black can't easily play). Standard." },
          { san: 'Nf6', text: "**2...Nf6** — Black develops naturally. We continue to mirror Sicilian ideas with extra tempo." },
          { san: 'Nf3', text: "**3.Nf3** — pressuring the e5-pawn. Now Black has to make a structural decision." },
          { san: 'Nc6', text: "**3...Nc6** — defending e5 and developing. Symmetric position; both sides have completed minor-piece development on the kingside." },
          { san: 'g3', text: "**4.g3** — the English fianchetto, preparing **Bg2** for long-diagonal pressure on Black's queenside. This is the most popular continuation." },
          { san: 'Bb4', text: "**4...Bb4** — Black pins our knight on c3, mirroring a Sicilian Sveshnikov idea. Sharp." },
          { san: 'Bg2', text: "**5.Bg2** — completing the fianchetto. Bishop on g2 will exert long-diagonal pressure for the rest of the game." },
          { san: 'O-O', text: "**5...O-O** — Black castles. Both sides are developing fast." },
          { san: 'O-O', text: "**6.O-O** — castling. You've reached the classic English Reversed Sicilian setup. The plan: **Nd5** (jumping into the hole Black created with the Bb4 pin), **a3** challenging the bishop, and slowly outplaying Black with the small structural pluses an extra tempo gives us. Solid and surprisingly winning." },
        ],
      }),
    ],
  },

  // ====================================================================
  // SCANDINAVIAN DEFENCE (black) — 1 line
  // ====================================================================
  'scandinavian-black': {
    openingId: 'scandinavian-black',
    title: 'Scandinavian Defence',
    tagline: '1.e4 d5 — direct centre challenge. Easy to learn, still played by GMs.',
    lines: [
      buildLine({
        id: 'scandinavian-mainline',
        name: 'Mainline (Mieses Variation)',
        description: 'After …Qxd5 …Qa5, develop with …Nf6, …c6 — solid setup with a half-open d-file.',
        intro: "Let's learn the Scandinavian! It's the second-oldest recorded chess opening (the first game was in 1475!) and one of the easiest to learn — we challenge the centre directly with **1...d5**, take back with the queen if exchanged, and reroute it to a5 where it's safely placed and useful. Magnus Carlsen used this opening to beat Anand in the 2014 World Championship match.",
        moves: [
          { san: 'e4', text: "**1.e4** — White's classical opening." },
          { san: 'd5', text: "**1...d5** — and there's the Scandinavian! We challenge the centre directly. White must commit immediately: take or push past." },
          { san: 'exd5', text: "**2.exd5** — White takes, the standard reply. Now we have to recapture the pawn or lose it." },
          { san: 'Qxd5', text: "**2...Qxd5** — recapturing with the queen. \"But moving the queen early is bad!\" — only if it gets harassed productively. White can attack our queen with **3.Nc3**, but we have a safe square to retreat to." },
          { san: 'Nc3', text: "**3.Nc3** — developing with tempo, attacking our queen. Forced to a degree; we must move the queen." },
          { san: 'Qa5', text: "**3...Qa5** — the Mieses Variation, the mainline. Queen to a5 stays active, eyes White's queenside, and is genuinely well-placed. We've gained a tempo... no wait, we've lost two and they've gained one. But we have a clean structure to make up for it." },
          { san: 'd4', text: "**4.d4** — White grabs more centre. Standard, ambitious. Our plan now is calm development." },
          { san: 'Nf6', text: "**4...Nf6** — developing the knight, also pressuring e4 (which is now empty — we just keep the knight on a useful square). Solid." },
          { san: 'Nf3', text: "**5.Nf3** — White completes minor-piece development on the kingside. Calm moves continue." },
          { san: 'c6', text: "**5...c6** — supporting our queen on a5, controlling d5, and preparing **…Bf5** or **…Bg4**. You've reached the main Scandinavian Mieses tabiya. The plan: **…Bf5, …e6, …Be7, …O-O**, and slow development followed by careful manoeuvring. Black is fine; the early queen move is a long-term non-issue." },
        ],
      }),
    ],
  },

  // ====================================================================
  // PIRC DEFENCE (black) — 1 line
  // ====================================================================
  'pirc-black': {
    openingId: 'pirc-black',
    title: 'Pirc Defence',
    tagline: '1.e4 d6 with …g6/…Bg7 — hypermodern setup. Black invites a big centre to attack.',
    lines: [
      buildLine({
        id: 'pirc-classical',
        name: 'Classical Pirc',
        description: 'The mainline with …Nf6, …g6, …Bg7 — invite the centre, fianchetto, attack.',
        intro: "Let's learn the Classical Pirc Defence! It's the King's Indian Defence's cousin against 1.e4: we let White build a big centre, fianchetto our bishop on g7, and aim for **…c5** or **…e5** to break things open. Slovenian GM Vasja Pirc developed it in the 1940s; modern players love it as a low-theory option against e4 players who don't expect it.",
        moves: [
          { san: 'e4', text: "**1.e4** — White's king's-pawn opening. We're going hypermodern." },
          { san: 'd6', text: "**1...d6** — our flexible first move. We're committing to a King's-Indian-style setup but keeping our options open about move-order." },
          { san: 'd4', text: "**2.d4** — White grabs more centre, the standard reply. Their position now looks very imposing." },
          { san: 'Nf6', text: "**2...Nf6** — developing and starting to chip at e4. Standard Pirc / Modern move-order." },
          { san: 'Nc3', text: "**3.Nc3** — White defends e4 and develops. The Classical Pirc setup is now in motion." },
          { san: 'g6', text: "**3...g6** — preparing the fianchetto, the signature Pirc move. The bishop is heading to g7 to point at White's queenside." },
          { san: 'Nf3', text: "**4.Nf3** — White's most popular setup, the Classical Pirc. Alternative tries are **4.f4** (Austrian Attack — sharp) and **4.Be3** (150 Attack — slow positional)." },
          { san: 'Bg7', text: "**4...Bg7** — bishop to g7, the long-diagonal warrior. We're now committed to the kingside fianchetto and ready to castle." },
          { san: 'Be2', text: "**5.Be2** — White develops modestly, preparing castling. Calm, classical, and solid." },
          { san: 'O-O', text: "**5...O-O** — we castle. King safe; now we can think about counterplay." },
          { san: 'O-O', text: "**6.O-O** — White castles too. You've reached the main Classical Pirc tabiya. The plan: **…c6** (preparing …b5 expansion), **…b5, …Nbd7, …Bb7**, and slow queenside expansion combined with central counterplay via **…e5** or **…c5** at the right moment. The opening rewards patient manoeuvring." },
        ],
      }),
    ],
  },

  // ====================================================================
  // SLAV DEFENCE (black) — 1 line
  // ====================================================================
  'slav-black': {
    openingId: 'slav-black',
    title: 'Slav Defence',
    tagline: '1.d4 d5 2.c4 c6 — solid alternative to QGD that keeps the c8 bishop free.',
    lines: [
      buildLine({
        id: 'slav-mainline',
        name: 'Slav Mainline (Accepted)',
        description: 'Take the c-pawn at move 4 and play …Bf5 outside the chain — structurally healthy.',
        intro: "Let's learn the Slav Defence! It solves the QGD's biggest problem — the locked-in c8 bishop — by playing **…c6** instead of **…e6**. We can develop our light-squared bishop to f5 outside the pawn chain, and the position has a structurally clean feel. World champions Botvinnik, Smyslov, and Anand have all been Slav specialists.",
        moves: [
          { san: 'd4', text: "**1.d4** — White's queen's-pawn opening." },
          { san: 'd5', text: "**1...d5** — we mirror, fighting for the centre directly." },
          { san: 'c4', text: "**2.c4** — the Queen's Gambit. White offers the c-pawn." },
          { san: 'c6', text: "**2...c6** — the Slav Defence! We support d5 with the c-pawn (instead of …e6 which would lock our light-squared bishop). The bishop on c8 will get out to f5 in a few moves." },
          { san: 'Nf3', text: "**3.Nf3** — White's most flexible move, developing and avoiding any early commitments." },
          { san: 'Nf6', text: "**3...Nf6** — developing the knight to its natural square. Both sides are calmly developing." },
          { san: 'Nc3', text: "**4.Nc3** — White completes natural development. Now we have a key choice: defend d5 with …e6 (Semi-Slav) or take the c-pawn (Slav Accepted)." },
          { san: 'dxc4', text: "**4...dxc4** — Slav Accepted. We take the pawn, planning to hold it temporarily with **…b5** or just give it back for development. White's mainline reply is **5.a4** to prevent …b5." },
          { san: 'a4', text: "**5.a4** — the standard reply. White stops …b5 and prepares to recapture the c4-pawn at leisure with **e3** and **Bxc4**. We can't hold the pawn long-term, but we get a free move." },
          { san: 'Bf5', text: "**5...Bf5** — and there's the Slav payoff: bishop developed outside the pawn chain to its best square. This is what makes the Slav structurally healthier than the QGD — our light-squared bishop is genuinely happy." },
          { san: 'e3', text: "**6.e3** — White prepares **Bxc4** to recover the pawn. You've reached the main Slav tabiya. The plan: **…e6, …Nbd7, …Be7, …O-O**, complete development calmly, and play for an equal middlegame from a structurally sound position. White will recover the c4-pawn but we will have completed development with the bishop pair active." },
        ],
      }),
    ],
  },

  // ====================================================================
  // VIENNA GAME (white) — 1 line
  // ====================================================================
  'vienna-white': {
    openingId: 'vienna-white',
    title: 'Vienna Game',
    tagline: "1.e4 e5 2.Nc3 — flexible knight development, often leads to the King's Gambit family.",
    lines: [
      buildLine({
        id: 'vienna-gambit',
        name: 'Vienna Gambit',
        description: 'After 2.Nc3 Nf6 3.f4 — sacrifice the f-pawn for central activity and an early attack.',
        intro: "Let's learn the Vienna Gambit! When Black plays the natural **2...Nf6**, we offer the f-pawn with **3.f4** — a King's Gambit shape with the c3-knight already developed (which solves one of the Gambit's biggest problems). Black's best is to give the pawn back with **3...d5**; if they greedily take with **3...exf4**, our e4-pawn rolls forward and we get a huge attack.",
        moves: [
          { san: 'e4', text: "**1.e4** — the king's-pawn opening, our usual start." },
          { san: 'e5', text: "**1...e5** — Black mirrors, leading to a Vienna Game." },
          { san: 'Nc3', text: "**2.Nc3** — knight to c3, the move that defines the Vienna. We develop the queenside knight first (instead of the standard 2.Nf3), keeping our f-pawn free for an early **f4** push." },
          { san: 'Nf6', text: "**2...Nf6** — Black develops the kingside knight, the most popular reply. Now we spring the gambit." },
          { san: 'f4', text: "**3.f4** — the Vienna Gambit! We offer the f-pawn for central activity. If Black takes with **3...exf4** we play **4.e5** kicking the f6-knight and getting a huge centre. The principled (and best) reply is **3...d5** to give the pawn back immediately." },
          { san: 'd5', text: "**3...d5** — the modern best reply. Black returns the gambit pawn to liquidate our centre and equalize. This is the line a well-prepared opponent will play." },
          { san: 'fxe5', text: "**4.fxe5** — taking the e-pawn. Now Black has to deal with two threats: the e5-pawn pinning their f6-knight to their queen, and our pressure on d5." },
          { san: 'Nxe4', text: "**4...Nxe4** — Black takes our centre pawn. The position is now critical; we have a tactical reply." },
          { san: 'Nf3', text: "**5.Nf3** — developing with tempo. The knight defends the e5-pawn and prepares **Qe2** or **Bd3** to double-attack the e4-knight. Sharp tactics await." },
          { san: 'Bc5', text: "**5...Bc5** — Black develops aggressively, eyeing f2 and preparing castling. Standard mainline." },
          { san: 'd4', text: "**6.d4** — gaining central space and attacking the bishop. You've reached the main Vienna Gambit tabiya. From here: **…Bb4+** is common, then **c3** kicking the bishop and **Bd3** completing development. The Vienna Gambit gives us a sharp attacking position with active piece play." },
        ],
      }),
    ],
  },
};

// ────────────────────────────────────────────────────────────────────────
// Lookups
// ────────────────────────────────────────────────────────────────────────

export function courseFor(openingId: string): OpeningCourse | undefined {
  return OPENING_COURSES[openingId];
}

export function lineForCourse(courseId: string, lineId: string): OpeningLine | undefined {
  return OPENING_COURSES[courseId]?.lines.find((l) => l.id === lineId);
}

// ────────────────────────────────────────────────────────────────────────
// Self-validation — re-derives every node's FEN from chess.js and asserts
// it equals the builder's stored FEN. Runs only inside vitest (the
// `import.meta.vitest` guard is the standard idiom and is stripped from
// production bundles by Vite). Defence in depth — buildLine already
// computes FENs via chess.js, so this is mostly a sanity check.
// ────────────────────────────────────────────────────────────────────────
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe('OPENING_COURSES — every node FEN matches chess.js replay of SAN', () => {
    for (const course of Object.values(OPENING_COURSES)) {
      for (const line of course.lines) {
        it(`${course.openingId}/${line.id} replays cleanly`, () => {
          const game = new Chess();
          // Node 0 is the starting position — assert and continue.
          expect(line.nodes[0]!.fen).toBe(normFen(game.fen()));
          expect(line.nodes[0]!.san).toBeUndefined();

          for (let i = 1; i < line.nodes.length; i++) {
            const node = line.nodes[i]!;
            expect(node.san, `node ${i} of ${course.openingId}/${line.id} must have san`).toBeDefined();
            // chess.js throws on illegal SAN, which is itself a useful failure mode.
            game.move(node.san!);
            const expected = normFen(game.fen());
            expect(
              expected,
              `node ${i} of ${course.openingId}/${line.id} (san=${node.san}): expected ${expected} but lesson has ${node.fen}`,
            ).toBe(node.fen);
          }
        });
      }
    }
  });

  describe('OPENING_COURSES — content sanity', () => {
    for (const course of Object.values(OPENING_COURSES)) {
      for (const line of course.lines) {
        it(`${course.openingId}/${line.id} intro starts with "Let's learn"`, () => {
          expect(line.nodes[0]!.text.startsWith("Let's learn")).toBe(true);
        });
        it(`${course.openingId}/${line.id} has 8-14 ply (9-15 nodes)`, () => {
          expect(line.nodes.length).toBeGreaterThanOrEqual(9);
          expect(line.nodes.length).toBeLessThanOrEqual(15);
        });
        it(`${course.openingId}/${line.id} every node text is 1-4 sentences`, () => {
          for (const [i, node] of line.nodes.entries()) {
            // Rough sentence count: split on . ! ? followed by space-or-end, ignore trailing.
            const sentenceish = node.text.split(/[.!?](?=\s|$)/).filter((s) => s.trim().length > 0);
            expect(
              sentenceish.length,
              `node ${i} of ${course.openingId}/${line.id} has ${sentenceish.length} sentences (expected 1-4)`,
            ).toBeLessThanOrEqual(4);
            expect(sentenceish.length).toBeGreaterThanOrEqual(1);
          }
        });
      }
    }
  });
}
