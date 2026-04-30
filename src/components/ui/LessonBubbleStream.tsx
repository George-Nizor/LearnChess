/*
 * LessonBubbleStream — chat-style streaming bubble renderer.
 *
 * Splits a single lesson-node text into multiple short bubbles and
 * staggers them in. The user reads one chunk at a time instead of
 * facing a wall of prose. Mirrors the way an in-person tutor would
 * actually deliver an explanation: one idea per beat.
 *
 * Splitting strategy:
 *   - parseProse() already classifies the text into sections
 *     (intro, white-plan, black-plan, key-squares, tactical-theme,
 *     verdict, common-mistake, common-deviation, flat). Each
 *     STRUCTURED section becomes one bubble.
 *   - The intro / flat sections are further split by sentence into
 *     ~1-2 sentence bubbles, so a paragraph with five sentences
 *     becomes 3-4 bubbles instead of one wall.
 *
 * Animation:
 *   - Each bubble fades + slides in with a 90 ms delay per index, so
 *     the user sees the stream materialise over ~0.5 s for a typical
 *     5-bubble node. Under prefers-reduced-motion all bubbles render
 *     instantly.
 *   - The whole thread re-mounts when `nodeKey` changes, replaying
 *     the streaming animation for the new node. Bubble keys are
 *     prefixed with `nodeKey` so React's reconciler discards the old
 *     thread cleanly.
 *
 * Bubble visual:
 *   - Each bubble is a rounded rectangle with the section's coloured
 *     accent header pill (re-uses the SECTION_STYLES from LessonBubble
 *     to stay consistent).
 *   - Subtle left-border accent in the section colour ties the bubble
 *     to its header pill.
 */
import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import {
  parseProse,
  parseInline,
  type InlineSpan,
  type ProseSection,
  type SectionKind,
} from '@/openings/proseParser';

interface LessonBubbleStreamProps {
  /** Lesson-node text. */
  text: string;
  /**
   * Identity for the current node. Streaming replays whenever this
   * changes — usually `${lineId}-${nodeIdx}`.
   */
  nodeKey: string;
  /** Optional className passed to the outer wrapper. */
  className?: string;
}

interface SectionStyle {
  label: string;
  pillClass: string;
  borderClass: string;
}

const SECTION_STYLES: Partial<Record<SectionKind, SectionStyle>> = {
  'white-plan': {
    label: "White's plan",
    pillClass: 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300',
    borderClass: 'border-l-emerald-500/60',
  },
  'black-plan': {
    label: "Black's plan",
    pillClass: 'bg-sky-500/15 text-sky-700 ring-1 ring-sky-500/30 dark:text-sky-300',
    borderClass: 'border-l-sky-500/60',
  },
  'key-squares': {
    label: 'Key squares',
    pillClass: 'bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/30 dark:text-amber-300',
    borderClass: 'border-l-amber-500/60',
  },
  'tactical-theme': {
    label: 'Tactical theme',
    pillClass: 'bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30 dark:text-rose-300',
    borderClass: 'border-l-rose-500/60',
  },
  'verdict': {
    label: 'Modern theory',
    pillClass: 'bg-zinc-500/15 text-zinc-700 ring-1 ring-zinc-500/30 dark:text-zinc-300',
    borderClass: 'border-l-zinc-500/50',
  },
  'common-mistake': {
    label: 'Common mistake',
    pillClass: 'bg-orange-500/15 text-orange-700 ring-1 ring-orange-500/30 dark:text-orange-300',
    borderClass: 'border-l-orange-500/60',
  },
  'common-deviation': {
    label: 'If they deviate',
    pillClass: 'bg-violet-500/15 text-violet-700 ring-1 ring-violet-500/30 dark:text-violet-300',
    borderClass: 'border-l-violet-500/60',
  },
};

/** A single bubble chunk — either a section-tagged block or a plain
    sentence-group from intro/flat content. */
interface BubbleChunk {
  key: string;
  /** Optional section header — present only on structured sections. */
  header?: SectionStyle;
  /** Inline spans for the body. */
  spans: InlineSpan[];
}

/** Split flat/intro prose into 1-2 sentence chunks.
 *
 * Naive splitters fail on chess prose because of move notation like
 * "1.e4" — the period after "1" looks like a sentence end. We avoid
 * that by splitting on the pattern "[.!?] WS+ Capital" — i.e. a
 * period (or ! / ?) followed by whitespace AND a capital letter that
 * starts the next sentence. "1.e4" survives because the period is
 * followed by a lowercase "e".
 *
 * Bold-token boundaries are NEVER split (we re-parse each chunk's
 * inline spans independently so bold pairing is preserved).
 */
function splitSentences(body: string, perChunk = 2): string[] {
  const trimmed = body.trim();
  if (trimmed.length === 0) return [];
  const sentences: string[] = [];
  // Sentence-end pattern: period / ! / ? followed by 1+ whitespace and
  // a capital letter (or "..." opener for a follow-on, or " — " em-dash
  // continuation we treat as in-sentence). Lookbehind not used because
  // the negative case (digit before the period) is handled by the
  // lowercase-letter-after constraint already.
  const splitRe = /(?<=[.!?])\s+(?=[A-Z"'(“—…])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = splitRe.exec(trimmed)) !== null) {
    const slice = trimmed.slice(last, m.index).trim();
    if (slice.length > 0) sentences.push(slice);
    last = splitRe.lastIndex;
  }
  const tail = trimmed.slice(last).trim();
  if (tail.length > 0) sentences.push(tail);

  // Group every `perChunk` sentences into one bubble.
  const chunks: string[] = [];
  for (let i = 0; i < sentences.length; i += perChunk) {
    chunks.push(sentences.slice(i, i + perChunk).join(' '));
  }
  return chunks;
}

function buildChunks(sections: ProseSection[], nodeKey: string): BubbleChunk[] {
  const out: BubbleChunk[] = [];
  let idx = 0;
  for (const sec of sections) {
    if (sec.kind === 'flat' || sec.kind === 'intro') {
      // Sentence-group split for narrative prose.
      const groups = splitSentences(sec.body, 2);
      for (const g of groups) {
        out.push({
          key: `${nodeKey}-c-${idx++}`,
          spans: parseInline(g),
        });
      }
      continue;
    }
    const style = SECTION_STYLES[sec.kind];
    if (!style) {
      out.push({
        key: `${nodeKey}-c-${idx++}`,
        spans: sec.spans,
      });
      continue;
    }
    // Structured section — keep as a single bubble even if long, since
    // the labelled pill anchors the cognitive slot. Splitting would lose
    // that anchoring.
    out.push({
      key: `${nodeKey}-c-${idx++}`,
      header: style,
      spans: sec.spans,
    });
  }
  return out;
}

function renderSpans(spans: InlineSpan[], keyPrefix: string): ReactNode[] {
  return spans.map((span, i) => {
    if (span.type === 'text') {
      return <span key={`${keyPrefix}-t-${i}`}>{span.text}</span>;
    }
    const t = span.token!;
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

export function LessonBubbleStream({ text, nodeKey, className }: LessonBubbleStreamProps) {
  const reduce = useReducedMotion();
  const sections = parseProse(text);
  const chunks = buildChunks(sections, nodeKey);

  // Stagger delay: 90 ms between bubbles, but capped so a 7-bubble
  // tabiya doesn't take a full second.
  const delayFor = (i: number) => (reduce ? 0 : Math.min(0.09 * i, 0.6));

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      {chunks.map((chunk, i) => (
        <motion.div
          key={chunk.key}
          initial={reduce ? { opacity: 1 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: delayFor(i), ease: [0.22, 1, 0.36, 1] }}
          className={`rounded-xl border-l-2 bg-elevated/80 px-4 py-2.5 text-[14px] leading-6 shadow-sm backdrop-blur-sm ${
            chunk.header ? chunk.header.borderClass : 'border-l-border-strong/50'
          }`}
        >
          {chunk.header && (
            <div className="mb-1 flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chunk.header.pillClass}`}
              >
                {chunk.header.label}
              </span>
            </div>
          )}
          <p className="text-foreground/90">{renderSpans(chunk.spans, chunk.key)}</p>
        </motion.div>
      ))}
    </div>
  );
}
