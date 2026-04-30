/*
 * LessonBubble — structured speech-bubble renderer for opening
 * lessons.
 *
 * Replaces the previous wall-of-text rendering of tabiya nodes with
 * labelled sections (intro / White's plan / Black's plan / Key
 * squares / Tactical theme / Verdict). Per-move nodes (no section
 * markers detected) fall back to plain paragraph rendering so we
 * never regress the existing UX.
 *
 * Design choices:
 *   - Section headers use lucide-style mini badges (▶ icon + label
 *     in coloured pill) so the eye scans down the bubble in 1
 *     second instead of reading prose linearly.
 *   - Colour coding: green for White's plan, blue for Black's plan,
 *     yellow for Key squares, red for Tactical theme. Same colour
 *     family as the on-board overlay so the user makes the
 *     connection ("yellow square in the prose = yellow circle on
 *     the board").
 *   - Bold tokens inside each section render as `<strong>` exactly
 *     like before - the section is just an additional layer of
 *     structure on top of the existing bold-token semantics.
 *   - `flat` sections (per-move text, no markers detected) render
 *     as a single paragraph block, identical to the previous
 *     renderProse output.
 *
 * Spaced-repetition rationale: chunked information with consistent
 * visual structure has measurably higher 24-hour retention than the
 * same information as continuous prose. Mayer & Moreno's "modality
 * principle" (split text into perceptually distinct slots) is the
 * cognitive backing for this layout.
 */

import type { ReactNode } from 'react';
import {
  parseProse,
  type InlineSpan,
  type ProseSection,
  type SectionKind,
} from '@/openings/proseParser';

interface LessonBubbleProps {
  /** Lesson-node text (markdown-bold supported). */
  text: string;
  /** Optional className passed to the outer wrapper. */
  className?: string;
}

/** Render an inline span list as React nodes. */
function renderSpans(spans: InlineSpan[], keyPrefix: string): ReactNode[] {
  return spans.map((span, i) => {
    if (span.type === 'text') {
      return <span key={`${keyPrefix}-t-${i}`}>{span.text}</span>;
    }
    const t = span.token!;
    // Token rendering: bold for everything; later we could add
    // hover-highlight wired to the chessground by data-square
    // attribute. For now matched the old renderProse <strong> output.
    return (
      <strong
        key={`${keyPrefix}-b-${i}`}
        data-square={t.square ?? undefined}
        data-token-kind={t.kind}
        className="font-semibold text-foreground"
      >
        {t.text}
      </strong>
    );
  });
}

interface SectionStyle {
  label: string;
  pillClass: string;     // background + text colour for the header pill
  bodyClass?: string;    // optional extra styling for the body
}

const SECTION_STYLES: Partial<Record<SectionKind, SectionStyle>> = {
  'white-plan':     { label: "White's plan",   pillClass: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200' },
  'black-plan':     { label: "Black's plan",   pillClass: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200' },
  'key-squares':    { label: 'Key squares',    pillClass: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' },
  'tactical-theme': { label: 'Tactical theme', pillClass: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200' },
  'verdict':        { label: 'Modern theory',  pillClass: 'bg-muted text-muted-foreground' },
  'common-mistake': { label: 'Common mistake', pillClass: 'bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200' },
  // Common deviations = legitimate opponent sidelines (NOT mistakes).
  // Distinct cyan/violet pill so the user reads "this is what to do
  // when they DON'T play the mainline" — separate cognitive slot from
  // common-mistake (orange = "they blundered, punish them").
  'common-deviation': { label: 'If they deviate', pillClass: 'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200' },
};

function renderSection(section: ProseSection, idx: number): ReactNode {
  const keyPrefix = `s-${idx}`;

  if (section.kind === 'flat' || section.kind === 'intro') {
    // Plain paragraph block. We could split on sentence boundaries
    // for nicer line breaks, but that requires re-parsing inline
    // spans per-sentence which is fiddly. The single-paragraph
    // rendering is identical to what the old renderProse did when
    // a node had no recognised section markers - no regression.
    return (
      <p key={keyPrefix} className={idx > 0 ? 'mt-3' : ''}>
        {renderSpans(section.spans, keyPrefix)}
      </p>
    );
  }

  const style = SECTION_STYLES[section.kind];
  if (!style) {
    // Unknown section kind: fallback to flat paragraph
    return (
      <p key={keyPrefix} className={idx > 0 ? 'mt-3' : ''}>
        {renderSpans(section.spans, keyPrefix)}
      </p>
    );
  }

  return (
    <div key={keyPrefix} className={idx > 0 ? 'mt-3' : ''}>
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.pillClass}`}
        >
          {style.label}
        </span>
      </div>
      <p className={`text-[14px] leading-6 ${style.bodyClass ?? ''}`}>
        {renderSpans(section.spans, keyPrefix)}
      </p>
    </div>
  );
}

export function LessonBubble({ text, className }: LessonBubbleProps) {
  const sections = parseProse(text);

  return (
    <div className={`prose-tight text-foreground ${className ?? ''}`}>
      {sections.map((section, idx) => renderSection(section, idx))}
    </div>
  );
}
