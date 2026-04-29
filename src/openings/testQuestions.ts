/*
 * Test-question generator for Openings.
 *
 * Each tabiya we wrote is a structured paragraph (white-plan,
 * black-plan, key-squares, tactical-theme, verdict). The proseParser
 * already splits the prose into typed sections; this module turns
 * those sections into TYPED test questions a learner can answer.
 *
 * Two question kinds, intentionally minimal for v1:
 *
 *   1. square-click — "Click a key square in this position"
 *      Generated from key-squares sections. Correct = any square the
 *      lesson named.
 *
 *   2. multiple-choice — "What's Black's plan here?"
 *      Generated from white-plan / black-plan / tactical-theme sections.
 *      Correct = this opening's prose for that section.
 *      Distractors = the same section from a different opening's
 *      tabiya (intentionally - so the user has to RECOGNISE the
 *      opening's character, not just remember a phrase).
 *
 * Spaced-repetition rationale (Bjork's "desirable difficulties"):
 * questions that force the learner to RETRIEVE produce stronger
 * traces than questions that just present information. Multiple-
 * choice is the lowest-friction retrieval format that still demands
 * active recognition. The "wrong choices come from sibling openings"
 * design adds DESIRABLE confusion - the learner must distinguish
 * "Pirc Black's plan" from "KID Black's plan", which forces deeper
 * encoding of what makes each opening distinct.
 *
 * Question IDs are content-derived hashes so the SRS state survives
 * lesson edits unless the section text itself changes.
 */

import { parseProse, type ProseSection } from './proseParser';
import type { OpeningCourse, OpeningLine, LessonNode } from './lessons';

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export type TestQuestionKind = 'square-click' | 'multiple-choice';

export interface TestQuestionBase {
  /** Stable content-derived ID. Survives lesson edits unless THIS question's text changed. */
  id: string;
  kind: TestQuestionKind;
  openingId: string;
  lineId: string;
  /** Index into the line's nodes array for the position the question is asked from. */
  nodeIdx: number;
  /** FEN of the position to render (stripped of move-counters via the line's stored fen). */
  fen: string;
  /** Board orientation when rendering. Matches the player side (the side studying this opening). */
  orientation: 'white' | 'black';
  /** Short prompt shown above the board. */
  prompt: string;
  /** One-paragraph explanation shown after the user answers (correct OR wrong). */
  explanation: string;
}

export interface SquareClickQuestion extends TestQuestionBase {
  kind: 'square-click';
  /** Squares that count as correct. The user clicks ONE; if it matches, correct. */
  correctSquares: string[];
}

export interface MultipleChoiceQuestion extends TestQuestionBase {
  kind: 'multiple-choice';
  /** The four answer choices, shuffled deterministically per question. */
  choices: string[];
  /** Index into `choices` of the correct answer. */
  correctIndex: number;
}

export type TestQuestion = SquareClickQuestion | MultipleChoiceQuestion;

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/** Extract every square reference from a section's typed spans. Deduped. */
function extractSquaresFromSection(section: ProseSection): string[] {
  const out = new Set<string>();
  for (const span of section.spans) {
    if (span.type !== 'token' || !span.token) continue;
    const t = span.token;
    if (t.square && /^[a-h][1-8]$/.test(t.square)) {
      out.add(t.square);
    }
  }
  return [...out];
}

/**
 * Trim a section body to a one-clause snippet suitable as a
 * multiple-choice answer. Drops the leading "play / push / preparing"
 * fillers so the answer focuses on the substantive plan moves.
 *
 * Example: "play **…c6** preparing **…b5** queenside expansion, then
 *  **…Nbd7, …Bb7, …b5**, slowly building queenside pressure..."
 * → "play …c6 preparing …b5 queenside expansion, then …Nbd7, …Bb7,
 *    …b5, slowly building queenside pressure"
 *
 * We keep ~140 chars so the choice fits a clickable button without
 * truncation. Strips the markdown-bold wrappers because the choice
 * is rendered as plain text.
 */
function snippetForChoice(body: string): string {
  const stripped = body.replace(/\*\*([^*]+)\*\*/g, '$1');
  // Take the first sentence-ish - up to the first period that ends
  // a clause (followed by space + capital), capped at 140 chars.
  const firstSentence = stripped.split(/(?<=[.;])\s+(?=[A-Z…])/)[0] ?? stripped;
  if (firstSentence.length <= 140) return firstSentence.trim();
  // Long sentence - truncate at a word boundary.
  const cut = firstSentence.slice(0, 140);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

/**
 * Deterministic content hash for stable question IDs. Keeps SRS state
 * intact as long as the section text is unchanged. djb2-style, 32-bit.
 */
function hashId(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  // Unsigned hex
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Mulberry32 PRNG seeded by a string (via hashId). For deterministic shuffles. */
function seededRng(seed: string): () => number {
  let a = parseInt(hashId(seed), 16) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle in place using the provided rng. */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// ────────────────────────────────────────────────────────────────────
// Question generator
// ────────────────────────────────────────────────────────────────────

/**
 * Generate the set of test questions for a single opening course.
 * For each line's FINAL tabiya node, generates up to 3 questions:
 *   - 1 square-click (if the tabiya names key squares)
 *   - 1 multiple-choice for each of black-plan / white-plan / tactical-theme
 *     (only when present in the parsed sections)
 *
 * For multiple-choice DISTRACTORS we sample from sibling openings'
 * tabiyas of the same section kind. Caller passes the full course
 * registry so the generator can pull cross-opening choices.
 */
export interface GenerateOpts {
  course: OpeningCourse;
  /** Other courses used as distractor pools. Same shape as course. */
  allCourses: Record<string, OpeningCourse>;
}

export function generateQuestionsForCourse({ course, allCourses }: GenerateOpts): TestQuestion[] {
  const questions: TestQuestion[] = [];
  const playerSide = course.openingId.endsWith('-black') ? 'black' : 'white';

  // Pre-build distractor pools from OTHER openings' tabiyas, keyed by
  // section kind. Caller will draw 3 random distractors per question.
  const distractorPool: Record<'white-plan' | 'black-plan' | 'tactical-theme', string[]> = {
    'white-plan': [],
    'black-plan': [],
    'tactical-theme': [],
  };
  for (const [otherId, otherCourse] of Object.entries(allCourses)) {
    if (otherId === course.openingId) continue;
    for (const otherLine of otherCourse.lines) {
      const lastNode = otherLine.nodes[otherLine.nodes.length - 1];
      if (!lastNode) continue;
      const sections = parseProse(lastNode.text);
      for (const sec of sections) {
        if (sec.kind === 'white-plan' || sec.kind === 'black-plan' || sec.kind === 'tactical-theme') {
          distractorPool[sec.kind].push(snippetForChoice(sec.body));
        }
      }
    }
  }

  for (const line of course.lines) {
    const lastNodeIdx = line.nodes.length - 1;
    const lastNode = line.nodes[lastNodeIdx];
    if (!lastNode) continue;
    const sections = parseProse(lastNode.text);

    questions.push(...generateQuestionsForLine({
      course, line, lastNodeIdx, lastNode, sections, playerSide, distractorPool,
    }));
  }

  return questions;
}

function generateQuestionsForLine(args: {
  course: OpeningCourse;
  line: OpeningLine;
  lastNodeIdx: number;
  lastNode: LessonNode;
  sections: ProseSection[];
  playerSide: 'white' | 'black';
  distractorPool: Record<'white-plan' | 'black-plan' | 'tactical-theme', string[]>;
}): TestQuestion[] {
  const { course, line, lastNodeIdx, lastNode, sections, playerSide, distractorPool } = args;
  const out: TestQuestion[] = [];
  const baseSeed = `${course.openingId}|${line.id}|${lastNodeIdx}`;
  const fen = lastNode.fen;

  // ─── Q1: square-click from key-squares
  const keyS = sections.find((s) => s.kind === 'key-squares');
  if (keyS) {
    const squares = extractSquaresFromSection(keyS);
    if (squares.length > 0) {
      const id = hashId(`${baseSeed}|sq-click|${squares.join(',')}`);
      out.push({
        id,
        kind: 'square-click',
        openingId: course.openingId,
        lineId: line.id,
        nodeIdx: lastNodeIdx,
        fen,
        orientation: playerSide,
        prompt: `Click a key square in this ${line.name} tabiya.`,
        correctSquares: squares,
        explanation: `The lesson named ${formatList(squares)} as the key squares - the structural anchors the rest of the middlegame revolves around.`,
      });
    }
  }

  // ─── Q2: multi-choice for each plan section
  const planSections: { kind: 'white-plan' | 'black-plan' | 'tactical-theme'; promptVerb: string }[] = [
    { kind: 'black-plan',     promptVerb: "What's Black's plan" },
    { kind: 'white-plan',     promptVerb: "What's White's plan" },
    { kind: 'tactical-theme', promptVerb: "What's the recurring tactical theme" },
  ];

  for (const { kind, promptVerb } of planSections) {
    const sec = sections.find((s) => s.kind === kind);
    if (!sec) continue;
    const correctSnippet = snippetForChoice(sec.body);
    if (correctSnippet.length < 12) continue;  // too short, skip

    // Pull 3 distractors from sibling openings of the same kind.
    const pool = distractorPool[kind].filter((s) => s !== correctSnippet);
    if (pool.length < 3) continue;
    const rng = seededRng(`${baseSeed}|mc|${kind}`);
    const distractors = shuffle([...pool], rng).slice(0, 3);

    // Shuffle the four choices and remember the correct index.
    const choices = shuffle([correctSnippet, ...distractors], rng);
    const correctIndex = choices.indexOf(correctSnippet);

    const id = hashId(`${baseSeed}|mc|${kind}|${correctSnippet}`);
    out.push({
      id,
      kind: 'multiple-choice',
      openingId: course.openingId,
      lineId: line.id,
      nodeIdx: lastNodeIdx,
      fen,
      orientation: playerSide,
      prompt: `${promptVerb} in the ${line.name}?`,
      choices,
      correctIndex,
      explanation: `The lesson identifies the ${kind.replace('-', ' ')} as: ${correctSnippet}`,
    });
  }

  return out;
}

/** "a, b, and c" with Oxford comma. */
function formatList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}
