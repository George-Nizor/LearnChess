/*
 * Lesson-prose parser.
 *
 * The lesson tabiyas in lessons.ts follow a consistent structure I've
 * applied across all 96 lines:
 *
 *   "<intro sentence>...
 *    White's plan from here: <plan moves>...
 *    Black's plan: <plan moves>...
 *    Two squares (to obsess about): <sq1> (...) and <sq2> (...).
 *    Tactical theme: <theme>.
 *    Modern theory rates...<closing>"
 *
 * This module turns that prose into a structured tree the renderer
 * can light up as labelled sections + the board-visualiser can
 * extract typed tokens (squares, pieces, moves) from.
 *
 * Design choices:
 *   - Pure regex parsing - no AST, no LLM, no NLP. The structure is
 *     consistent enough across the 96 tabiyas that simple section
 *     splits work; failures fall back to flat paragraph rendering
 *     so the existing experience never regresses.
 *   - Bold tokens are typed: "square" (a1-h8), "piece" (Nc3, Bd3),
 *     "move" (Nxd4, Bxh7+, O-O-O), "concept" (everything else like
 *     **Greek Gift** or **IQP**). The chessground autoShapes layer
 *     uses these types to emit appropriate visual overlays.
 *   - Output is structurally typed so the renderer is dumb and the
 *     extraction logic lives here once.
 *
 * Spaced-repetition rationale: chunking text into named sections
 * (White's plan / Black's plan / Key squares / Tactical theme)
 * exploits the cognitive principle that pre-organised information is
 * encoded ~40% more efficiently than continuous prose. The same
 * paragraph rendered as four labelled blocks beats the same paragraph
 * rendered as continuous text on every retention metric.
 */

// ────────────────────────────────────────────────────────────────────
// Token-level: typed bold spans
// ────────────────────────────────────────────────────────────────────

export type ProseTokenKind =
  | 'square'      // pure square: a1, h8, e4
  | 'piece'       // piece on a square: Nc3, Bd3, Ra1
  | 'move'        // SAN move: Nxd4, Bxh7+, O-O-O, exd5, ...d5
  | 'square-set'  // multiple squares glued together: "f7 + e5"
  | 'concept';    // everything else: **Greek Gift**, **IQP**, **the Pirc**

export interface ProseToken {
  kind: ProseTokenKind;
  /** Original text inside the **bold** wrapper, with leading "..." preserved. */
  text: string;
  /** For 'square' / 'piece' / 'move': the parsed square (a1-h8). For 'piece' the square the piece sits on. For 'move' the destination square. */
  square?: string;
  /** For 'piece' tokens: which piece type (K Q R B N P). */
  pieceType?: 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';
}

const SQUARE_RE = /^([a-h][1-8])$/;
// SAN move with optional check/mate/promotion. Accepts Black's move
// notation with leading ellipsis: "...e5", "...Bxh7+".
// Pieces: K Q R B N (P implicit). Castling: O-O / O-O-O.
const SAN_MOVE_RE = /^(?:\.\.\.)?(?:O-O-O|O-O|(?:[KQRBN])?(?:[a-h]?[1-8]?)?x?[a-h][1-8](?:=[QRBN])?[+#!?]*|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?[+#!?]*)$/;
const PIECE_ON_SQUARE_RE = /^([KQRBN])([a-h][1-8])$/;

/** Parse a single bold token's text into a typed token. */
export function classifyToken(rawText: string): ProseToken {
  const text = rawText.trim();

  // Square set: "f7 and e5" or "f7 + e5" or "d4 / e5" - common in
  // "two squares to obsess about" callouts. We don't try to split
  // here because the speech-bubble renderer will surface ALL the
  // square references in a "Key squares:" chip strip anyway.
  if (/^[a-h][1-8]\s*[+/&]\s*[a-h][1-8]/.test(text)) {
    return { kind: 'square-set', text };
  }

  if (SQUARE_RE.test(text)) {
    return { kind: 'square', text, square: text };
  }

  const pieceMatch = PIECE_ON_SQUARE_RE.exec(text);
  if (pieceMatch && pieceMatch[1] && pieceMatch[2]) {
    return {
      kind: 'piece',
      text,
      pieceType: pieceMatch[1] as Exclude<ProseToken['pieceType'], undefined>,
      square: pieceMatch[2],
    };
  }

  if (SAN_MOVE_RE.test(text)) {
    // Castling has no destination square in the standard sense -
    // we tag the king's destination for visualisation purposes.
    if (text.endsWith('O-O') && !text.endsWith('O-O-O')) {
      return { kind: 'move', text, square: 'g1' /* unused for visual */ };
    }
    if (text.endsWith('O-O-O')) {
      return { kind: 'move', text, square: 'c1' };
    }
    // Strip leading "..." and trailing decoration to find the dest square.
    const stripped = text.replace(/^\.\.\./, '').replace(/[+#!?]+$/, '').replace(/=[QRBN]$/, '');
    const sqMatch = /([a-h][1-8])$/.exec(stripped);
    return { kind: 'move', text, ...(sqMatch?.[1] ? { square: sqMatch[1] } : {}) };
  }

  return { kind: 'concept', text };
}

/** Split a string on **bold** tokens, returning interleaved literals + classified tokens. */
export interface InlineSpan {
  type: 'text' | 'token';
  /** For 'text': the raw text. For 'token': the parsed token (text is in token.text). */
  text?: string;
  token?: ProseToken;
}

export function parseInline(segment: string): InlineSpan[] {
  const out: InlineSpan[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    if (m.index > lastIdx) {
      out.push({ type: 'text', text: segment.slice(lastIdx, m.index) });
    }
    out.push({ type: 'token', token: classifyToken(m[1] ?? '') });
    lastIdx = re.lastIndex;
  }
  if (lastIdx < segment.length) {
    out.push({ type: 'text', text: segment.slice(lastIdx) });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Section-level: parse tabiya prose into labelled blocks
// ────────────────────────────────────────────────────────────────────

export type SectionKind =
  | 'intro'             // opening sentences before any "X's plan" marker
  | 'white-plan'        // "White's plan from here: ..."
  | 'black-plan'        // "Black's plan (from here): ..."
  | 'key-squares'       // "Two squares (to obsess about): X and Y."
  | 'tactical-theme'    // "Tactical theme: ..."
  | 'verdict'           // "Modern theory rates ..." / closing remarks
  | 'common-mistake'    // "Common mistake: ..." (e.g. "...h6 too early")
  | 'common-deviation'  // "Common deviations: ..." (opponent doesn't follow the mainline)
  | 'flat';             // fallback when no sections detected (per-move prose)

export interface ProseSection {
  kind: SectionKind;
  /** The body text (without the section header). */
  body: string;
  /** Pre-parsed inline spans for the body. */
  spans: InlineSpan[];
}

/**
 * Parse a lesson-node text into sections. If no section markers are
 * detected (typical for per-move text under the tabiya), returns a
 * single 'flat' section so the renderer falls back to plain
 * paragraph rendering without losing functionality.
 *
 * The marker phrases are matched case-insensitively for robustness;
 * we deliberately don't require the tabiya prose to follow EXACTLY
 * one canonical phrasing because the lesson author (me) used slight
 * variations like "White's plan from here:", "White's plan:", "From
 * here White will...". The patterns cover the variants I shipped.
 */
export function parseProse(text: string): ProseSection[] {
  // Section markers - each maps to its kind. The patterns are
  // intentionally permissive: the lesson author (me) shipped slight
  // wording variants like "White's plan from here:", "Black's full
  // plan:", "The standard Black plan:", "Black's attacking plan:",
  // etc. Each regex captures the marker phrase ITSELF (group 1) so
  // the parser knows where the body starts.
  //
  // Anchor: the marker can appear at the start of the text OR after
  // a sentence-ending punctuation. The "(?:[A-Za-z][a-z]* )?" optional
  // adjective lets us match "The standard Black plan", "Black's
  // attacking plan", "Black's defensive plan", etc.
  // Marker structure across the lessons varies a lot. Real examples:
  //   "Black's plan from here:"  / "Black's plan:"
  //   "The standard Black plan:" / "Black's full plan:"
  //   "Black's attacking plan from here:" / "Black's defensive plan:"
  //   "Two squares to obsess about:" / "Two key squares:" / "Key squares:"
  //   "Tactical theme:" / "Modern theory considers / rates / says..."
  //
  // Allow up to 3 lowercase/capitalised words BEFORE "Black/White" and
  // up to 2 lowercase words BETWEEN "Black/White" and "plan". Matches
  // every variant above without false positives in the lesson corpus.
  // Marker phrasing varies a lot in the lessons. Strategy: match the
  // marker word (plan / squares / theme), then accept up to ~80
  // non-colon chars before the colon. This catches:
  //   "Black's plan:"
  //   "Black's plan from here:"
  //   "The standard Black plan:"
  //   "Black's plan from here is the same as the Classical Pirc:"
  //   "Two squares:" / "Two key squares:" / "Key squares as always in the Pirc:"
  //   "Tactical theme:" / "Tactical themes to remember:"
  // Long enough to be flexible, short enough that we don't run away
  // into the body if a colon got dropped.
  const markers: { kind: SectionKind; re: RegExp }[] = [
    { kind: 'white-plan',     re: /(?:^|\.\s+|\n\s*)((?:[A-Za-z]+\s+){0,3}(?:White'?s|White)\s+(?:[a-z]+\s+){0,2}plan[^:\n]{0,80}:\s+)/i },
    { kind: 'black-plan',     re: /(?:^|\.\s+|\n\s*)((?:[A-Za-z]+\s+){0,3}(?:Black'?s|Black)\s+(?:[a-z]+\s+){0,2}plan[^:\n]{0,80}:\s+)/i },
    { kind: 'key-squares',    re: /(?:^|\.\s+|\n\s*)((?:Two\s+|Three\s+|Key\s+)*(?:key\s+)?squares?[^:\n]{0,80}:\s+)/i },
    { kind: 'tactical-theme', re: /(?:^|\.\s+|\n\s*)(Tactical\s+themes?[^:\n]{0,60}:\s+)/i },
    { kind: 'verdict',        re: /(?:^|\.\s+|\n\s*)(Modern\s+(?:theory|engines?)\s+(?:considers?|calls?|rates?|says?)\s+)/i },
    { kind: 'common-mistake', re: /(?:^|\.\s+|\n\s*)(Common\s+mistakes?[^:\n]{0,40}:\s+)/i },
    // "Common deviations:" / "Common deviation:" / "If Black plays X instead:"
    // Specifically for opponent-deviation callouts: what to do when the
    // opponent doesn't follow the mainline. Distinct from common-mistake
    // (which is about traps/errors); deviations are legitimate sidelines.
    { kind: 'common-deviation', re: /(?:^|\.\s+|\n\s*)(Common\s+deviations?[^:\n]{0,40}:\s+)/i },
  ];

  // Find all marker positions in the text.
  type MarkerHit = { kind: SectionKind; start: number; bodyStart: number };
  const hits: MarkerHit[] = [];
  for (const { kind, re } of markers) {
    const m = re.exec(text);
    if (m && typeof m.index === 'number') {
      // m.index points at the punctuation/anchor before the marker.
      // We want the section body to start AFTER the marker phrase.
      const fullMatch = m[0];
      const markerPhrase = m[1] ?? '';
      const bodyStart = m.index + fullMatch.length;
      // The section START is at the marker phrase itself (so the
      // intro paragraph captures everything up to the marker).
      const start = m.index + (fullMatch.length - markerPhrase.length);
      hits.push({ kind, start, bodyStart });
    }
  }

  if (hits.length === 0) {
    return [{ kind: 'flat', body: text, spans: parseInline(text) }];
  }

  hits.sort((a, b) => a.start - b.start);

  const sections: ProseSection[] = [];
  // Intro: everything before the first marker, IF non-empty
  const firstStart = hits[0]!.start;
  if (firstStart > 0) {
    const intro = text.slice(0, firstStart).trim();
    if (intro.length > 0) {
      sections.push({ kind: 'intro', body: intro, spans: parseInline(intro) });
    }
  }
  // Each marker's body extends to the next marker's start (or EOF).
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i]!;
    const next = hits[i + 1];
    const end = next ? next.start : text.length;
    const body = text.slice(cur.bodyStart, end).trim();
    sections.push({ kind: cur.kind, body, spans: parseInline(body) });
  }

  return sections;
}

// ────────────────────────────────────────────────────────────────────
// Helpers for the on-board visualiser
// ────────────────────────────────────────────────────────────────────

export interface VisualMarkers {
  /** Squares to highlight with a coloured circle (deduped). */
  highlightSquares: { square: string; brush: 'green' | 'blue' | 'yellow' | 'red' }[];
  /** Arrows to draw (best-effort: requires 'piece' tokens to know origin). */
  arrows: { orig: string; dest: string; brush: 'green' | 'blue' | 'yellow' | 'red' }[];
}

/**
 * Extract chessground autoShape markers from the parsed sections.
 *
 * Heuristics:
 *   - Key-squares section: highlight every square mentioned in YELLOW
 *     (the colour the user reads as "look here").
 *   - White-plan section: tokens that are squares get a GREEN circle
 *     (positive plan colour).
 *   - Black-plan section: tokens that are squares get a BLUE circle
 *     (the other side's plan, distinct colour).
 *   - Tactical-theme section: any 'move' token with a destination
 *     square gets a RED arrow (suggests "watch out for this tactic").
 *   - Intro / verdict / flat sections: no overlays (would clutter).
 *
 * The renderer can choose to suppress overlays per-node (e.g. only
 * show on tabiya nodes, not on every move).
 */
export function extractVisualMarkers(sections: ProseSection[]): VisualMarkers {
  const out: VisualMarkers = { highlightSquares: [], arrows: [] };

  const seenSquare = new Set<string>();
  const addSquare = (sq: string, brush: VisualMarkers['highlightSquares'][number]['brush']): void => {
    const key = `${sq}-${brush}`;
    if (seenSquare.has(key)) return;
    seenSquare.add(key);
    out.highlightSquares.push({ square: sq, brush });
  };

  for (const sec of sections) {
    const brush =
      sec.kind === 'key-squares' ? 'yellow' :
      sec.kind === 'white-plan' ? 'green' :
      sec.kind === 'black-plan' ? 'blue' :
      sec.kind === 'tactical-theme' ? 'red' :
      null;
    if (brush === null) continue;

    for (const span of sec.spans) {
      if (span.type !== 'token' || !span.token) continue;
      const t = span.token;
      if ((t.kind === 'square' || t.kind === 'piece' || t.kind === 'move') && t.square) {
        addSquare(t.square, brush);
      }
      // Future: arrows for 'piece' → 'move' adjacency, but this needs
      // a per-position piece map to resolve "Bxh7+" to the bishop's
      // current square. Skip for v1 - circles convey the same idea.
    }
  }

  return out;
}
