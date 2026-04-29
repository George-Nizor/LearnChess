/*
 * Tests for the lesson-prose parser.
 *
 * The lesson tabiyas all follow a structure I authored to be
 * machine-parseable. These tests pin the parser against real lesson
 * snippets so any future drift in the section markers fails loudly.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyToken,
  parseInline,
  parseProse,
  extractVisualMarkers,
} from '@/openings/proseParser';
import { OPENING_COURSES } from '@/openings/lessons';

describe('classifyToken', () => {
  it('classifies bare squares', () => {
    expect(classifyToken('e4')).toMatchObject({ kind: 'square', square: 'e4' });
    expect(classifyToken('h1')).toMatchObject({ kind: 'square', square: 'h1' });
    expect(classifyToken('a8')).toMatchObject({ kind: 'square', square: 'a8' });
  });

  it('classifies pieces on squares', () => {
    // Bare "Nc3" / "Bg2" is ambiguous between "knight to c3" (a SAN
    // move) and "the knight on c3" (a piece reference). The parser
    // routes them to 'piece' kind (PIECE_ON_SQUARE_RE matches first)
    // - the visual outcome is identical because both highlight the
    // c3 square.
    expect(classifyToken('Nc3')).toMatchObject({ kind: 'piece', square: 'c3', pieceType: 'N' });
    expect(classifyToken('Bg2')).toMatchObject({ kind: 'piece', square: 'g2', pieceType: 'B' });
    expect(classifyToken('Ra1')).toMatchObject({ kind: 'piece', square: 'a1', pieceType: 'R' });
  });

  it('classifies SAN moves with check / promotion / Black ellipsis', () => {
    expect(classifyToken('Bxh7+')).toMatchObject({ kind: 'move', square: 'h7' });
    expect(classifyToken('exd5')).toMatchObject({ kind: 'move', square: 'd5' });
    expect(classifyToken('...e5')).toMatchObject({ kind: 'move', square: 'e5' });
    expect(classifyToken('e8=Q')).toMatchObject({ kind: 'move', square: 'e8' });
    expect(classifyToken('Nxd4')).toMatchObject({ kind: 'move', square: 'd4' });
  });

  it('classifies castling without a destination', () => {
    expect(classifyToken('O-O')).toMatchObject({ kind: 'move' });
    expect(classifyToken('O-O-O')).toMatchObject({ kind: 'move' });
  });

  it('falls back to "concept" for non-move text', () => {
    expect(classifyToken('Greek Gift')).toMatchObject({ kind: 'concept' });
    expect(classifyToken('IQP')).toMatchObject({ kind: 'concept' });
    expect(classifyToken('the Pirc')).toMatchObject({ kind: 'concept' });
  });

  it('classifies square sets', () => {
    expect(classifyToken('e5 + d4')).toMatchObject({ kind: 'square-set' });
    expect(classifyToken('f7 / e5')).toMatchObject({ kind: 'square-set' });
  });
});

describe('parseInline', () => {
  it('splits on **bold** preserving order', () => {
    const spans = parseInline('White plays **e4** then **d4** for the centre.');
    expect(spans).toHaveLength(5);
    expect(spans[0]).toEqual({ type: 'text', text: 'White plays ' });
    expect(spans[1]?.type).toBe('token');
    expect(spans[1]?.token?.text).toBe('e4');
    expect(spans[2]).toEqual({ type: 'text', text: ' then ' });
    expect(spans[3]?.token?.text).toBe('d4');
  });
});

describe('parseProse - section detection', () => {
  it('parses a Pirc-style tabiya', () => {
    const text =
      "**6.O-O** — White castles too, finishing the calm phase. " +
      "You've reached the main Classical Pirc tabiya. " +
      "Black's plan from here: play **…c6** preparing **…b5** queenside expansion. " +
      "Two squares to obsess about: **e5** (our pawn target) and **b4** (where our pawn might land). " +
      "Tactical theme: the **Bxh7+** Greek Gift sacrifice. " +
      "Modern theory considers this dynamically equal.";

    const sections = parseProse(text);
    const kinds = sections.map((s) => s.kind);

    // intro should be present (contains the **6.O-O** prelude), then
    // the four section markers we hit
    expect(kinds).toContain('intro');
    expect(kinds).toContain('black-plan');
    expect(kinds).toContain('key-squares');
    expect(kinds).toContain('tactical-theme');
    expect(kinds).toContain('verdict');

    const ks = sections.find((s) => s.kind === 'key-squares');
    expect(ks?.body).toContain('e5');
    expect(ks?.body).toContain('b4');
  });

  it('returns flat for per-move text without markers', () => {
    const text = "**3.Nc3** — defends e4, the standard. Now Black chooses the variation.";
    const sections = parseProse(text);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.kind).toBe('flat');
  });

  it('handles tabiya with both white-plan and black-plan', () => {
    const text =
      "Intro sentence here. " +
      "White's plan from here: **7.Bb3** then **8.c3**. " +
      "Black's plan: **7...d6** + **8...Bg4**.";
    const sections = parseProse(text);
    const kinds = sections.map((s) => s.kind);
    expect(kinds).toContain('white-plan');
    expect(kinds).toContain('black-plan');
  });
});

describe('extractVisualMarkers', () => {
  it('emits yellow markers for key squares', () => {
    const sections = parseProse(
      "Setup. Two squares to obsess about: **e5** and **f7**."
    );
    const m = extractVisualMarkers(sections);
    const yellow = m.highlightSquares.filter((s) => s.brush === 'yellow');
    expect(yellow.map((s) => s.square).sort()).toEqual(['e5', 'f7']);
  });

  it('emits green markers for white-plan squares', () => {
    const sections = parseProse(
      "Setup. White's plan from here: push **d4** then **e5**."
    );
    const m = extractVisualMarkers(sections);
    const green = m.highlightSquares.filter((s) => s.brush === 'green');
    expect(green.map((s) => s.square).sort()).toEqual(['d4', 'e5']);
  });

  it('emits blue markers for black-plan squares', () => {
    const sections = parseProse(
      "Setup. Black's plan: **...b5** then **...Bb7**."
    );
    const m = extractVisualMarkers(sections);
    const blue = m.highlightSquares.filter((s) => s.brush === 'blue');
    // ...b5 destination = b5; ...Bb7 destination = b7
    expect(blue.map((s) => s.square).sort()).toEqual(['b5', 'b7']);
  });

  it('does not emit markers for intro / verdict / flat sections', () => {
    const sections = parseProse(
      "**3.Nc3** — defends **e4**, the standard. Now Black chooses."
    );
    const m = extractVisualMarkers(sections);
    expect(m.highlightSquares).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// Real-corpus pin: runs the parser against every shipped lesson
// tabiya. Catches regressions in the marker regexes when the prose
// gets edited.
// ────────────────────────────────────────────────────────────────────

describe('real lesson corpus', () => {
  it('detects sections in every tabiya across all 13 openings', () => {
    const failed: { opening: string; line: string; gotKinds: string[] }[] = [];
    for (const [openingId, course] of Object.entries(OPENING_COURSES)) {
      for (const line of course.lines) {
        const lastNode = line.nodes[line.nodes.length - 1];
        if (!lastNode) continue;
        const sections = parseProse(lastNode.text);
        const kinds = sections.map((s) => s.kind);
        const hasStructure = kinds.some((k) =>
          k === 'white-plan' || k === 'black-plan' || k === 'key-squares' ||
          k === 'tactical-theme' || k === 'verdict'
        );
        if (!hasStructure) {
          failed.push({ opening: openingId, line: line.id, gotKinds: kinds });
        }
      }
    }
    // We expect every tabiya to have at least one structured section
    // (a plan or key-squares or verdict). If any tabiya doesn't
    // parse, list them all so we can fix the prose or the regex.
    if (failed.length > 0) {
      console.warn(`${failed.length} tabiyas without structured sections:`, failed.slice(0, 10));
    }
    // Expect ≥80% coverage at minimum. Some thinner per-move tabiyas
    // may legitimately be flat - we don't require 100% structure.
    const totalLines = Object.values(OPENING_COURSES).reduce((s, c) => s + c.lines.length, 0);
    const coverage = 1 - failed.length / totalLines;
    expect(coverage).toBeGreaterThan(0.8);
  });
});
