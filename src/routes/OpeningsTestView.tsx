/*
 * OpeningsTestView - the fifth tab on the Openings detail page
 * (after Learn / Drill / Explore / Puzzles).
 *
 * Goal: convert the lessons we've written from "read once, drill,
 * forget" into genuine retention via active retrieval. The drill
 * tests MOVE memorisation; this tab tests UNDERSTANDING (where
 * the key squares are, what each side's plan is, what the
 * tactical theme is).
 *
 * Question types (auto-generated from the parsed tabiya prose):
 *   - square-click   "Click a key square"   - user clicks a square
 *   - multiple-choice "What's Black's plan?" - user picks 1 of 4
 *
 * SRS scheduling: every answer grades a TestCard with the same SM-2
 * ladder used for moves (learning steps 0-3 then review intervals
 * scaled by ease 2.5, floor 1.3). The session API is in
 * `src/openings/testSession.ts`.
 *
 * Design notes:
 *   - The board is interactive ONLY for square-click questions; for
 *     multiple-choice it's view-only (board provides context but the
 *     answer is verbal).
 *   - Answer feedback is immediate and rich: green/red banner,
 *     correct answer highlighted (or wrong choice + correct one for
 *     multi-choice), the lesson's explanation paragraph displayed.
 *   - Spaced-repetition principle "test-enhanced learning": the act
 *     of retrieving (clicking / picking) produces stronger memory
 *     than re-reading. We always SHOW the explanation after every
 *     answer to convert wrong answers into corrective feedback
 *     (Anderson's "elaborative feedback effect").
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chessground } from '@/chess/board';
import type { Repertoire } from '@/openings';
import type { TestQuestion, MultipleChoiceQuestion, SquareClickQuestion } from '@/openings/testQuestions';
import { gradeAnswer, pickNextQuestion, sessionStats } from '@/openings/testSession';
import type { Square } from '@/chess/rules';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import { motion, AnimatePresence } from 'framer-motion';

interface TestViewProps {
  repertoire: Repertoire;
}

interface AnswerState {
  question: TestQuestion;
  answer: { kind: 'square'; square: string } | { kind: 'choice'; index: number };
  correct: boolean;
}

interface Stats {
  total: number;
  dueNow: number;
  attempted: number;
  successes: number;
}

export function OpeningsTestView({ repertoire }: TestViewProps): ReactNode {
  const openingId = repertoire.sourceLabel ?? '';

  // Current question + the prior card state at the time we picked it.
  // (We don't actually use the prior card except to display "first
  // attempt" hints in v1.)
  const [current, setCurrent] = useState<TestQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [answered, setAnswered] = useState<AnswerState | null>(null);
  const [stats, setStats] = useState<Stats>({ total: 0, dueNow: 0, attempted: 0, successes: 0 });

  // Reentrancy guard - don't double-pick when the user mashes Next.
  const advancingRef = useRef(false);

  const refreshStats = useCallback(async () => {
    setStats(await sessionStats(openingId));
  }, [openingId]);

  const loadNext = useCallback(async () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    try {
      setLoading(true);
      setAnswered(null);
      const picked = await pickNextQuestion(openingId);
      setCurrent(picked?.question ?? null);
    } finally {
      setLoading(false);
      advancingRef.current = false;
    }
  }, [openingId]);

  // Initial load - pick the first question + compute stats
  useEffect(() => {
    void loadNext();
    void refreshStats();
  }, [loadNext, refreshStats]);

  const handleSubmit = useCallback(async (answer: AnswerState['answer']) => {
    if (!current) return;
    let correct = false;
    if (current.kind === 'square-click' && answer.kind === 'square') {
      correct = current.correctSquares.includes(answer.square);
    } else if (current.kind === 'multiple-choice' && answer.kind === 'choice') {
      correct = answer.index === current.correctIndex;
    }
    setAnswered({ question: current, answer, correct });
    await gradeAnswer(openingId, current, correct);
    await refreshStats();
  }, [current, openingId, refreshStats]);

  // ─── No questions case (opening has no parseable tabiya structure)
  if (!loading && current === null && stats.total === 0) {
    return (
      <div className="rounded-md border border-border bg-elevated/40 p-6 text-sm">
        <h3 className="text-base font-semibold">No test questions yet</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The Test tab auto-generates questions from each line's tabiya
          prose (key squares, plans, tactical themes). This opening
          doesn't have any structured tabiyas yet, so there are no
          questions to ask.
        </p>
      </div>
    );
  }

  // ─── All cards graduated case (everything is scheduled in the future)
  if (!loading && current === null && stats.total > 0) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-6 text-sm dark:border-emerald-800 dark:bg-emerald-950/30">
        <h3 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">All caught up</h3>
        <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
          You've answered every question that's due right now. Come
          back later for spaced-repetition reviews. Total questions
          for this opening: {stats.total}; accuracy so far: {stats.attempted > 0 ? `${Math.round((stats.successes / stats.attempted) * 100)}%` : '—'}.
        </p>
      </div>
    );
  }

  // The board column is the same fixed size as on Learn / Drill /
  // Explore — no chrome above or below it. Stats bar lives inside
  // QuestionCard's sidebar so the board stays in place when the user
  // tabs between modes.
  return (
    <div className="h-full min-h-0">
      {current && (
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id + (answered ? '-graded' : '')}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="h-full min-h-0"
          >
            <QuestionCard
              question={current}
              answered={answered}
              stats={stats}
              onSubmit={(a) => { void handleSubmit(a); }}
              onNext={() => { void loadNext(); }}
            />
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Stats bar
// ────────────────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: Stats }) {
  const accuracy = stats.attempted > 0 ? Math.round((stats.successes / stats.attempted) * 100) : null;
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-elevated/40 p-3 text-xs">
      <div>
        <span className="text-muted-foreground">Due now</span>{' '}
        <span className="font-mono font-semibold text-foreground">{stats.dueNow}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Total questions</span>{' '}
        <span className="font-mono font-semibold text-foreground">{stats.total}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Attempted</span>{' '}
        <span className="font-mono font-semibold text-foreground">{stats.attempted}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Accuracy</span>{' '}
        <span className="font-mono font-semibold text-foreground">{accuracy === null ? '—' : `${accuracy}%`}</span>
      </div>
      <div className="ml-auto text-[11px] text-muted-foreground">
        Spaced-repetition: harder questions come back sooner
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Question card (board + prompt + interactive answer area)
// ────────────────────────────────────────────────────────────────────

interface QuestionCardProps {
  question: TestQuestion;
  answered: AnswerState | null;
  stats: Stats;
  onSubmit: (answer: AnswerState['answer']) => void;
  onNext: () => void;
}

function QuestionCard({ question, answered, stats, onSubmit, onNext }: QuestionCardProps): ReactNode {
  // Board overlay markers - depend on question state and kind
  const autoShapes = useMemo<DrawShape[]>(() => {
    if (!answered) return [];
    if (question.kind === 'square-click' && answered.answer.kind === 'square') {
      const shapes: DrawShape[] = [];
      // Highlight the user's clicked square in red if wrong, green if correct
      shapes.push({
        orig: answered.answer.square as Square,
        brush: answered.correct ? 'green' : 'red',
      });
      // If wrong, also show the correct squares in green
      if (!answered.correct) {
        for (const sq of question.correctSquares) {
          if (sq !== answered.answer.square) {
            shapes.push({ orig: sq as Square, brush: 'green' });
          }
        }
      }
      return shapes;
    }
    return [];
  }, [answered, question]);

  const cgConfig = useMemo<Config>(() => ({
    fen: question.fen,
    orientation: question.orientation,
    viewOnly: true,
    coordinates: true,
    animation: { enabled: false, duration: 0 },
    movable: {
      free: false,
      dests: new Map(),
      showDests: false,
    },
    drawable: { enabled: false, visible: true, autoShapes },
  } satisfies Config), [question, autoShapes]);

  // Click-overlay handler for square-click questions. Chessground's
  // own `events.select` callback only fires when piece movement is
  // enabled, which it isn't here (the board is read-only context for
  // a verbal answer in MC mode, and a click target in square-click
  // mode). A transparent overlay on top of the board with our own
  // x/y → square math works in every config without fighting
  // chessground's internal selection model.
  const handleBoardClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (question.kind !== 'square-click' || answered !== null) return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const sq = rect.width / 8;
    const fileIdx = Math.floor(x / sq);   // 0..7 from left
    const rankIdx = Math.floor(y / sq);   // 0..7 from top
    if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return;
    // Map screen coords → board square based on orientation.
    // White orientation: top-left = a8, bottom-right = h1. So
    //   file = 'a' + fileIdx, rank = 8 - rankIdx.
    // Black orientation: top-left = h1, bottom-right = a8. Flipped on
    // both axes:
    //   file = 'h' - fileIdx, rank = 1 + rankIdx.
    const file = question.orientation === 'white'
      ? String.fromCharCode('a'.charCodeAt(0) + fileIdx)
      : String.fromCharCode('h'.charCodeAt(0) - fileIdx);
    const rank = question.orientation === 'white'
      ? 8 - rankIdx
      : 1 + rankIdx;
    onSubmit({ kind: 'square', square: `${file}${rank}` });
  }, [question, answered, onSubmit]);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_360px]">
      {/* Click-overlay wrapper. Treated as a button because it captures
          click events to register the answer. Keyboard users can still
          answer via the multi-choice path; a click-to-square chess board
          is inherently a pointer interaction and the static-element lint
          rules don't account for that gracefully. We still expose a role
          + label so screen readers announce the prompt. */}
      <div
        onClick={handleBoardClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); }}
        role={question.kind === 'square-click' && answered === null ? 'button' : undefined}
        tabIndex={question.kind === 'square-click' && answered === null ? 0 : -1}
        aria-label={question.kind === 'square-click' && answered === null ? 'Click a square to answer' : undefined}
        className={`cg-board-fit ${question.kind === 'square-click' && answered === null ? 'cursor-crosshair' : ''}`}
      >
        <Chessground config={cgConfig} />
      </div>

      <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto">
        {/* Stats bar — moved here from the route-level top so it doesn't
            shift the board's vertical position. Pinned at the top of the
            sidebar instead. */}
        <div className="shrink-0">
          <StatsBar stats={stats} />
        </div>

        <div className="rounded-md border border-border bg-elevated p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {question.kind === 'square-click' ? 'Click a square' : 'Multiple choice'}
          </div>
          <p className="mt-1 text-sm font-semibold text-foreground">{question.prompt}</p>
        </div>

        {question.kind === 'multiple-choice' && (
          <MultipleChoiceArea question={question} answered={answered} onSubmit={onSubmit} />
        )}

        {question.kind === 'square-click' && answered === null && (
          <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
            Click any square on the board to answer.
          </div>
        )}

        {answered && (
          <FeedbackPanel
            question={answered.question}
            correct={answered.correct}
          />
        )}

        {answered && (
          <button
            type="button"
            onClick={onNext}
            className="shrink-0 rounded-md bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"
          >
            Next question →
          </button>
        )}
      </aside>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Multiple-choice answer area
// ────────────────────────────────────────────────────────────────────

interface MCAreaProps {
  question: MultipleChoiceQuestion;
  answered: AnswerState | null;
  onSubmit: (answer: AnswerState['answer']) => void;
}

function MultipleChoiceArea({ question, answered, onSubmit }: MCAreaProps): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      {question.choices.map((choice, i) => {
        const isCorrect = i === question.correctIndex;
        const isSelected = answered?.answer.kind === 'choice' && answered.answer.index === i;
        // After answering: green for correct (always shown), red for
        // wrong selection, neutral for unselected wrong options.
        let cls = 'rounded-md border px-3 py-2 text-left text-xs transition-colors ';
        if (answered) {
          if (isCorrect) {
            cls += 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100';
          } else if (isSelected && !isCorrect) {
            cls += 'border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-100';
          } else {
            cls += 'border-border bg-background text-muted-foreground';
          }
        } else {
          cls += 'border-border bg-background text-foreground hover:border-accent hover:bg-muted';
        }
        return (
          <button
            key={i}
            type="button"
            disabled={answered !== null}
            onClick={() => onSubmit({ kind: 'choice', index: i })}
            className={cls}
          >
            <span className="mr-2 font-mono font-semibold text-muted-foreground">
              {String.fromCharCode(65 + i)}.
            </span>
            {choice}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Feedback panel
// ────────────────────────────────────────────────────────────────────

interface FeedbackProps {
  question: TestQuestion;
  correct: boolean;
}

function FeedbackPanel({ question, correct }: FeedbackProps): ReactNode {
  return (
    <div
      role="status"
      className={`rounded-md border p-4 text-sm ${
        correct
          ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100'
          : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
      }`}
    >
      <p className="text-base font-semibold">
        {correct ? '✓ Correct' : "Not quite — let's review"}
      </p>
      <p className="mt-2 text-xs leading-relaxed opacity-90">{question.explanation}</p>
      {/* SRS hint: tell the user when they'll see this card again */}
      <p className="mt-3 text-[11px] uppercase tracking-wide opacity-70">
        {correct ? 'Next review scheduled' : "We'll bring this back soon"}
      </p>
    </div>
  );
}

// Defensive unused-import shim for SquareClickQuestion type (kept
// here so future contributors see what the parts are).
void (null as SquareClickQuestion | null);
