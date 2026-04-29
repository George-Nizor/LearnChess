/*
 * Test-mode session orchestration.
 *
 * Glues the question generator (testQuestions.ts) to the IDB
 * persistence (db.ts testCards store) and applies the same SM-2-lite
 * SRS schedule used for the move drill (scheduler.ts).
 *
 * Selection priority on each "next question":
 *   1. Cards in LEARNING phase that are due NOW (sub-day).
 *   2. Cards in REVIEW phase that are due NOW (multi-day).
 *   3. New questions never seen (treated as "due immediately" by
 *      the existing scheduler when the IDB row is absent).
 *
 * Within each priority bucket we sort by earliest dueAt so older
 * deadlines come up first - the same Bjork-style retrieval-practice
 * pacing the move drill uses.
 */

import { OPENING_COURSES } from './lessons';
import {
  generateQuestionsForCourse,
  type TestQuestion,
} from './testQuestions';
import {
  getTestCard,
  putTestCard,
  type TestCard,
} from './db';
import {
  STEP_MINUTES,
  MAX_REVIEW_INTERVAL_DAYS,
  DEFAULT_EASE,
  MIN_EASE,
  MIN_MS,
  DAY_MS,
} from './scheduler';

/**
 * Generate the question set for an opening. Cached per-opening so we
 * don't re-parse the prose every time the user switches questions.
 *
 * Cache key includes the opening's `lines.length` × node count so a
 * lesson edit invalidates the cache automatically.
 */
const questionCache = new Map<string, TestQuestion[]>();

export function questionsFor(openingId: string): TestQuestion[] {
  const cached = questionCache.get(openingId);
  if (cached) return cached;
  const course = OPENING_COURSES[openingId];
  if (!course) return [];
  const generated = generateQuestionsForCourse({ course, allCourses: OPENING_COURSES });
  questionCache.set(openingId, generated);
  return generated;
}

// ────────────────────────────────────────────────────────────────────
// Card scheduling (SM-2-lite, adapted from scheduler.ts for TestCard)
// ────────────────────────────────────────────────────────────────────

function freshCard(openingId: string, questionId: string, now: number): TestCard {
  return {
    openingId,
    questionId,
    learningStep: 0,
    learningDueAt: now,
    reviewIntervalDays: null,
    reviewDueAt: null,
    reviewEase: DEFAULT_EASE,
    attempts: 0,
    successes: 0,
    lastSeenAt: now,
  };
}

function applyCorrect(card: TestCard, now: number): TestCard {
  const next: TestCard = {
    ...card,
    attempts: card.attempts + 1,
    successes: card.successes + 1,
    lastSeenAt: now,
  };
  if (card.learningStep !== null) {
    const nextStep = card.learningStep + 1;
    if (nextStep < STEP_MINUTES.length) {
      const stepMin = STEP_MINUTES[nextStep] ?? 0;
      next.learningStep = nextStep;
      next.learningDueAt = now + stepMin * MIN_MS;
      return next;
    }
    // Graduate
    next.learningStep = null;
    next.learningDueAt = null;
    next.reviewIntervalDays = 1;
    next.reviewDueAt = now + DAY_MS;
    next.reviewEase = card.reviewEase || DEFAULT_EASE;
    return next;
  }
  // In review - multiply
  if (card.reviewIntervalDays !== null) {
    const ease = card.reviewEase || DEFAULT_EASE;
    const baseInterval = card.reviewIntervalDays === 0 ? 1 : card.reviewIntervalDays;
    let nextInterval = baseInterval * ease;
    if (nextInterval > MAX_REVIEW_INTERVAL_DAYS) nextInterval = MAX_REVIEW_INTERVAL_DAYS;
    next.reviewIntervalDays = nextInterval;
    next.reviewDueAt = now + nextInterval * DAY_MS;
    return next;
  }
  // Defensive: no SRS state -> reset to step 0
  next.learningStep = 0;
  next.learningDueAt = now;
  return next;
}

function applyWrong(card: TestCard, now: number): TestCard {
  const nextEase = Math.max(MIN_EASE, (card.reviewEase || DEFAULT_EASE) - 0.2);
  const next: TestCard = {
    ...card,
    attempts: card.attempts + 1,
    reviewEase: nextEase,
    lastSeenAt: now,
  };
  // In learning OR very fresh review - reset to step 0
  if (card.learningStep !== null || card.reviewIntervalDays === 1) {
    next.learningStep = 0;
    next.learningDueAt = now;
    next.reviewIntervalDays = null;
    next.reviewDueAt = null;
    return next;
  }
  // Deeper review - re-graduation
  next.learningStep = null;
  next.learningDueAt = null;
  next.reviewIntervalDays = 0;
  next.reviewDueAt = now;
  return next;
}

/** Was this card due at `now`? Cards with no IDB row are due immediately. */
function isCardDue(card: TestCard | undefined, now: number): boolean {
  if (!card) return true;
  if (card.learningDueAt !== null) return card.learningDueAt <= now;
  if (card.reviewDueAt !== null) return card.reviewDueAt <= now;
  return true;
}

// ────────────────────────────────────────────────────────────────────
// Public session API
// ────────────────────────────────────────────────────────────────────

export interface SessionStats {
  total: number;
  dueNow: number;
  attempted: number;
  successes: number;
}

/**
 * Pick the next question to ask the user. Returns null if no
 * questions exist OR if there are 0 due cards (unusual; we always
 * generate fresh cards as due, so this only happens after every
 * card has been graduated and pushed beyond `now`).
 */
export async function pickNextQuestion(openingId: string, now: number = Date.now()): Promise<{
  question: TestQuestion;
  card: TestCard | undefined;
} | null> {
  const questions = questionsFor(openingId);
  if (questions.length === 0) return null;

  // Load all cards for this opening so we can score in-memory
  // (cheap - typical opening has ~30-50 questions).
  const cardByQuestion = new Map<string, TestCard>();
  for (const q of questions) {
    const c = await getTestCard(openingId, q.id);
    if (c) cardByQuestion.set(q.id, c);
  }

  // Score: lower score = higher priority
  //   0..2 = due now, in priority order (learning < review < new)
  //   3 = not yet due
  // Within each bucket, sort by earliest dueAt.
  type Scored = { q: TestQuestion; c: TestCard | undefined; bucket: number; due: number };
  const scored: Scored[] = questions.map((q) => {
    const c = cardByQuestion.get(q.id);
    if (!c) return { q, c: undefined, bucket: 2, due: 0 };  // new = bucket 2
    const due = c.learningDueAt ?? c.reviewDueAt ?? 0;
    if (!isCardDue(c, now)) return { q, c, bucket: 3, due };
    if (c.learningDueAt !== null) return { q, c, bucket: 0, due: c.learningDueAt };
    return { q, c, bucket: 1, due: c.reviewDueAt ?? 0 };
  });
  scored.sort((a, b) => a.bucket - b.bucket || a.due - b.due);

  const pick = scored.find((s) => s.bucket <= 2);
  if (!pick) return null;
  return { question: pick.q, card: pick.c };
}

/**
 * Grade the user's answer and persist the updated SRS state.
 * `correct` controls which scheduler ladder is applied. Returns
 * the new card state for the caller to render "+ next due in X".
 */
export async function gradeAnswer(
  openingId: string,
  question: TestQuestion,
  correct: boolean,
  now: number = Date.now(),
): Promise<TestCard> {
  const existing = await getTestCard(openingId, question.id);
  const base = existing ?? freshCard(openingId, question.id, now);
  const next = correct ? applyCorrect(base, now) : applyWrong(base, now);
  await putTestCard(next);
  return next;
}

/** Compute summary stats for the Test tab header. */
export async function sessionStats(openingId: string, now: number = Date.now()): Promise<SessionStats> {
  const questions = questionsFor(openingId);
  let dueNow = 0;
  let attempted = 0;
  let successes = 0;
  for (const q of questions) {
    const c = await getTestCard(openingId, q.id);
    if (isCardDue(c, now)) dueNow++;
    if (c) {
      attempted += c.attempts;
      successes += c.successes;
    }
  }
  return { total: questions.length, dueNow, attempted, successes };
}
