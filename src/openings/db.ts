/*
 * IndexedDB layer for opening repertoires.
 *
 * Schema:
 *   - `repertoires`   — keyed by `id` (autoincrement)
 *   - `repMoves`      — keyed by compound `[repertoireId, fromFen, toFen]`
 *   - `repAttempts`   — keyed by autoincrement `id`, indexed by `repertoireId` + `studiedAt`
 *   - `lineProgress`  — keyed by compound `[repertoireId, lineId]`
 *
 * IDB note: a compound `keyPath` like `['repertoireId', 'fromFen', 'toFen']`
 * gives us free uniqueness on the move-graph edge — `db.put()` upserts. This
 * is the mechanism that dedupes transpositions across multiple PGNs.
 *
 * Schema history:
 *   v1 — initial: repertoires, repMoves, repAttempts.
 *   v2 — add `lessonProgress` (per-repertoire — single line per opening).
 *   v3 — replace `lessonProgress` with `lineProgress` (per-line within a
 *        course; supports the multiple-lines-per-opening UX). Pre-launch
 *        user data, so the v2 store is dropped outright.
 *   v4 — add `testCards` for the Test-mode SRS scheduler. Test questions
 *        are auto-generated from each tabiya's parsed sections (key
 *        squares + plans + tactical themes); answering grades the card
 *        with the same SM-2-lite ladder the move drill uses.
 */

import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { Repertoire, RepMove, MoveAttempt } from './types';

/** Per-line Learn-mode progress. Composite key `[repertoireId, lineId]`. */
export interface LineProgress {
  repertoireId: number;
  /** Matches `OpeningLine.id` from src/openings/lessons.ts. */
  lineId: string;
  /** Furthest lesson node reached in this specific line (0-indexed). */
  discoveredNodeIdx: number;
  /** True if user has reached the last node of this line at least once. */
  completed: boolean;
  lastSeenAt: number;
}

/**
 * Test-mode SRS card. Composite key `[openingId, questionId]`.
 *
 * Mirrors the SM-2-lite scheduler used for repMoves (learning step
 * 0..3 then review interval scaling by ease, default 2.5, floor 1.3).
 * The same `onCorrect` / `onWrong` from `scheduler.ts` advances these
 * cards' state - we just adapt the field shape.
 */
export interface TestCard {
  /** Matches OPENING_COURSES key, e.g. 'pirc-black'. */
  openingId: string;
  /** Stable content-derived question ID (see testQuestions.ts). */
  questionId: string;
  /** Learning ladder step (0..3) or null when graduated. */
  learningStep: number | null;
  /** When learning, when this card is next due. */
  learningDueAt: number | null;
  /** Review interval in days; null until graduated; 0 sentinel = needs re-graduation. */
  reviewIntervalDays: number | null;
  /** When in review, when this card is next due. */
  reviewDueAt: number | null;
  /** Ease factor (default 2.5, floor 1.3). */
  reviewEase: number;
  /** Total times answered (success + fail). */
  attempts: number;
  /** Correct answer count (for accuracy display). */
  successes: number;
  /** Last-attempted timestamp for "recent activity" sorting. */
  lastSeenAt: number;
}

interface OpeningsDBSchema extends DBSchema {
  repertoires: {
    key: number;
    value: Repertoire;
    indexes: { 'by-name': string };
  };
  repMoves: {
    key: [number, string, string];           // [repertoireId, fromFen, toFen]
    value: RepMove;
    indexes: {
      'by-rep': number;
      'by-rep-from': [number, string];        // for "what moves are legal from this position in this rep?"
      'by-due-learning': [number, number];    // [repertoireId, learningDueAt]
      'by-due-review':   [number, number];    // [repertoireId, reviewDueAt]
    };
  };
  repAttempts: {
    key: number;
    value: MoveAttempt;
    indexes: { 'by-rep': number; 'by-rep-studied': [number, number] };
  };
  lineProgress: {
    key: [number, string];                    // [repertoireId, lineId]
    value: LineProgress;
    indexes: { 'by-rep': number };
  };
  testCards: {
    key: [string, string];                    // [openingId, questionId]
    value: TestCard;
    indexes: {
      'by-opening': string;
      'by-due-learning': [string, number];    // [openingId, learningDueAt]
      'by-due-review':   [string, number];    // [openingId, reviewDueAt]
    };
  };
}

const DB_NAME = 'learnchess-openings';
const DB_VERSION = 4;                // v4 adds testCards store

let dbPromise: Promise<IDBPDatabase<OpeningsDBSchema>> | null = null;

export function openingsDB(): Promise<IDBPDatabase<OpeningsDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OpeningsDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('repertoires')) {
          const store = db.createObjectStore('repertoires', { keyPath: 'id', autoIncrement: true });
          store.createIndex('by-name', 'name');
        }
        if (!db.objectStoreNames.contains('repMoves')) {
          const store = db.createObjectStore('repMoves', { keyPath: ['repertoireId', 'fromFen', 'toFen'] });
          store.createIndex('by-rep', 'repertoireId');
          store.createIndex('by-rep-from', ['repertoireId', 'fromFen']);
          store.createIndex('by-due-learning', ['repertoireId', 'learningDueAt']);
          store.createIndex('by-due-review',   ['repertoireId', 'reviewDueAt']);
        }
        if (!db.objectStoreNames.contains('repAttempts')) {
          const store = db.createObjectStore('repAttempts', { keyPath: 'id', autoIncrement: true });
          store.createIndex('by-rep', 'repertoireId');
          store.createIndex('by-rep-studied', ['repertoireId', 'studiedAt']);
        }
        // v3: drop the old single-line lessonProgress store and replace with
        // per-line lineProgress. Pre-launch users have no real data to lose.
        // The store name isn't in the typed schema union (we removed it), so
        // cast through the raw IDB type for the legacy delete + existence check.
        const rawDb = db as unknown as IDBPDatabase;
        if (rawDb.objectStoreNames.contains('lessonProgress')) {
          rawDb.deleteObjectStore('lessonProgress');
        }
        if (!db.objectStoreNames.contains('lineProgress')) {
          const store = db.createObjectStore('lineProgress', { keyPath: ['repertoireId', 'lineId'] });
          store.createIndex('by-rep', 'repertoireId');
        }
        // v4: testCards store for the Test-mode SRS scheduler. The
        // composite key [openingId, questionId] is unique per question;
        // the openingId index supports "show me all test cards for the
        // Pirc"; the by-due indexes support "what's due NOW for this
        // opening" without scanning every card.
        if (!db.objectStoreNames.contains('testCards')) {
          const store = db.createObjectStore('testCards', { keyPath: ['openingId', 'questionId'] });
          store.createIndex('by-opening', 'openingId');
          store.createIndex('by-due-learning', ['openingId', 'learningDueAt']);
          store.createIndex('by-due-review',   ['openingId', 'reviewDueAt']);
        }
      },
    });
  }
  return dbPromise;
}

// ──────────── Line progress (per-line Learn-mode tracking) ──────────────

export async function getLineProgress(repertoireId: number, lineId: string): Promise<LineProgress | undefined> {
  const db = await openingsDB();
  return db.get('lineProgress', [repertoireId, lineId]);
}

/**
 * Bump `discoveredNodeIdx` if `nodeIdx` is further than what's recorded.
 * `lineLength` is the total node count for this line — when the user
 * reaches the last node we mark the line `completed`.
 */
export async function markLineNodeVisited(
  repertoireId: number,
  lineId: string,
  nodeIdx: number,
  lineLength: number,
): Promise<void> {
  const db = await openingsDB();
  const existing = await db.get('lineProgress', [repertoireId, lineId]);
  const newIdx = Math.max(existing?.discoveredNodeIdx ?? -1, nodeIdx);
  // A line is "completed" when the user has reached the last node at least once.
  const completed = (existing?.completed ?? false) || newIdx >= lineLength - 1;
  await db.put('lineProgress', {
    repertoireId,
    lineId,
    discoveredNodeIdx: newIdx,
    completed,
    lastSeenAt: Date.now(),
  });
}

/** Set of `lineId`s the user has completed for a given repertoire. */
export async function linesCompletedFor(repertoireId: number): Promise<Set<string>> {
  const db = await openingsDB();
  const rows = await db.getAllFromIndex('lineProgress', 'by-rep', repertoireId);
  return new Set(rows.filter((r) => r.completed).map((r) => r.lineId));
}

/** All progress rows for a repertoire (used to render per-line badges in the picker). */
export async function listLineProgress(repertoireId: number): Promise<LineProgress[]> {
  const db = await openingsDB();
  return db.getAllFromIndex('lineProgress', 'by-rep', repertoireId);
}

export async function resetLineProgress(repertoireId: number, lineId: string): Promise<void> {
  const db = await openingsDB();
  await db.delete('lineProgress', [repertoireId, lineId]);
}

// ──────────── Test cards (Test-mode SRS) ─────────────────────────────────

/**
 * Get a single test card by its composite key, or undefined if the
 * user has never answered this question.
 */
export async function getTestCard(openingId: string, questionId: string): Promise<TestCard | undefined> {
  const db = await openingsDB();
  return db.get('testCards', [openingId, questionId]);
}

/** Persist a test card (insert or update). */
export async function putTestCard(card: TestCard): Promise<void> {
  const db = await openingsDB();
  await db.put('testCards', card);
}

/** All test cards for a given opening. Used to compute "X due now". */
export async function listTestCards(openingId: string): Promise<TestCard[]> {
  const db = await openingsDB();
  return db.getAllFromIndex('testCards', 'by-opening', openingId);
}

// ──────────── Repertoires ────────────────────────────────────────────────

export async function listRepertoires(): Promise<Repertoire[]> {
  const db = await openingsDB();
  return db.getAll('repertoires');
}

export async function getRepertoire(id: number): Promise<Repertoire | undefined> {
  const db = await openingsDB();
  return db.get('repertoires', id);
}

export async function findRepertoireBySource(sourceKind: Repertoire['sourceKind'], sourceLabel: string): Promise<Repertoire | undefined> {
  const all = await listRepertoires();
  return all.find((r) => r.sourceKind === sourceKind && r.sourceLabel === sourceLabel);
}

export async function createRepertoire(rep: Omit<Repertoire, 'id'>): Promise<number> {
  const db = await openingsDB();
  return db.add('repertoires', rep as Repertoire);
}

export async function deleteRepertoire(id: number): Promise<void> {
  const db = await openingsDB();
  const tx = db.transaction(['repertoires', 'repMoves', 'repAttempts'], 'readwrite');
  await tx.objectStore('repertoires').delete(id);
  // delete moves
  for await (const cursor of tx.objectStore('repMoves').index('by-rep').iterate(id)) {
    await cursor.delete();
  }
  // delete attempts
  for await (const cursor of tx.objectStore('repAttempts').index('by-rep').iterate(id)) {
    await cursor.delete();
  }
  await tx.done;
}

// ──────────── Moves ──────────────────────────────────────────────────────

export async function putMove(move: RepMove): Promise<void> {
  const db = await openingsDB();
  await db.put('repMoves', move);
}

export async function bulkPutMoves(moves: RepMove[]): Promise<void> {
  if (moves.length === 0) return;
  const db = await openingsDB();
  const tx = db.transaction('repMoves', 'readwrite');
  await Promise.all(moves.map((m) => tx.store.put(m)));
  await tx.done;
}

export async function getMove(repertoireId: number, fromFen: string, toFen: string): Promise<RepMove | undefined> {
  const db = await openingsDB();
  return db.get('repMoves', [repertoireId, fromFen, toFen]);
}

/** Children of a position in a repertoire — i.e. all known moves from `fromFen`. */
export async function movesFrom(repertoireId: number, fromFen: string): Promise<RepMove[]> {
  const db = await openingsDB();
  const tx = db.transaction('repMoves');
  const idx = tx.store.index('by-rep-from');
  const out: RepMove[] = [];
  for await (const cursor of idx.iterate(IDBKeyRange.only([repertoireId, fromFen]))) {
    if (!cursor.value.deleted) out.push(cursor.value);
  }
  return out;
}

/** All moves in a repertoire (for tree-walking, stats, etc.). */
export async function allMoves(repertoireId: number): Promise<RepMove[]> {
  const db = await openingsDB();
  return (await db.getAllFromIndex('repMoves', 'by-rep', repertoireId)).filter((m) => !m.deleted);
}

// ──────────── Attempts ───────────────────────────────────────────────────

export async function recordAttempt(attempt: MoveAttempt): Promise<void> {
  const db = await openingsDB();
  await db.add('repAttempts', attempt);
}

export async function recentAttempts(repertoireId: number, limit = 100): Promise<MoveAttempt[]> {
  const db = await openingsDB();
  const tx = db.transaction('repAttempts');
  const idx = tx.store.index('by-rep-studied');
  const out: MoveAttempt[] = [];
  for await (const cursor of idx.iterate(IDBKeyRange.bound([repertoireId, 0], [repertoireId, Date.now()]), 'prev')) {
    out.push(cursor.value);
    if (out.length >= limit) break;
  }
  return out;
}
