import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';

/*
 * IndexedDB primer for users coming from SQL/Postgres:
 *  - IndexedDB is a schema-versioned object store. Stores are like tables; each
 *    row is a JS object addressed by a key. You upgrade schemas in the
 *    `upgrade(db, oldVersion, newVersion)` callback below.
 *  - Indexes are named secondary keys you can query by (think Postgres indexes).
 *  - All reads/writes are async and run inside transactions — `idb` wraps the
 *    raw API in promises so we can use async/await.
 *  - There is no SQL. Queries are getAll/get/cursor over a store + index.
 *
 * Why we use idb here and sqlite-wasm for puzzles:
 *  - idb: small writes/reads (per-puzzle attempt history, user rating). Native
 *    durable storage, survives reload, no in-memory copy needed.
 *  - sqlite-wasm: read-only, indexed query over the bundled puzzle DB. Right
 *    tool for "give me 20 fork puzzles in rating 1400-1600".
 */

interface PuzzleAttempt {
  puzzleId: string;
  rating: number;
  themes: string[];
  attemptedAt: number;
  solved: boolean;
  timeMs: number;
  hintsUsed: number;
}

interface SrCard {
  puzzleId: string;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  dueAt: number;
  lastReviewedAt: number;
}

interface UserRating {
  pillar: 'tactics' | 'endgames';
  rating: number;
  rd: number;
  updatedAt: number;
}

interface EndgameAttempt {
  positionId: string;
  attemptedAt: number;
  result: 'win' | 'draw' | 'loss';
  movesPlayed: number;
  optimalMoves: number;
}

interface OpeningProgress {
  openingId: string;
  color: 'w' | 'b';
  branchPath: string;
  correctCount: number;
  wrongCount: number;
  lastDrilledAt: number;
}

interface LearnChessDB extends DBSchema {
  puzzleAttempts: {
    key: string;
    value: PuzzleAttempt;
    indexes: { 'by-attemptedAt': number };
  };
  srCards: {
    key: string;
    value: SrCard;
    indexes: { 'by-dueAt': number };
  };
  userRating: {
    key: 'tactics' | 'endgames';
    value: UserRating;
  };
  endgameAttempts: {
    key: string;
    value: EndgameAttempt;
    indexes: { 'by-positionId': string; 'by-attemptedAt': number };
  };
  openingProgress: {
    key: string;
    value: OpeningProgress;
    indexes: { 'by-openingId': string };
  };
}

const DB_NAME = 'learnchess';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<LearnChessDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<LearnChessDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LearnChessDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('puzzleAttempts')) {
          const store = db.createObjectStore('puzzleAttempts', { keyPath: 'puzzleId' });
          store.createIndex('by-attemptedAt', 'attemptedAt');
        }
        if (!db.objectStoreNames.contains('srCards')) {
          const store = db.createObjectStore('srCards', { keyPath: 'puzzleId' });
          store.createIndex('by-dueAt', 'dueAt');
        }
        if (!db.objectStoreNames.contains('userRating')) {
          db.createObjectStore('userRating', { keyPath: 'pillar' });
        }
        if (!db.objectStoreNames.contains('endgameAttempts')) {
          const store = db.createObjectStore('endgameAttempts', { autoIncrement: true });
          store.createIndex('by-positionId', 'positionId');
          store.createIndex('by-attemptedAt', 'attemptedAt');
        }
        if (!db.objectStoreNames.contains('openingProgress')) {
          const store = db.createObjectStore('openingProgress', { keyPath: 'branchPath' });
          store.createIndex('by-openingId', 'openingId');
        }
      },
    });
  }
  return dbPromise;
}

export async function recordPuzzleAttempt(attempt: PuzzleAttempt): Promise<void> {
  const db = await getDB();
  await db.put('puzzleAttempts', attempt);
}

/**
 * Every puzzle id the user has ever attempted (whether solved or not).
 * Used by the Tactics selector to skip already-played puzzles, mirroring
 * Lichess's `round` lookup in PuzzleSelector.scala. Loaded once into an
 * in-memory Set at session start; the Set is then mutated as the user
 * plays.
 */
export async function getAttemptedPuzzleIds(): Promise<string[]> {
  const db = await getDB();
  return db.getAllKeys('puzzleAttempts');
}

export async function getRecentPuzzleAttempts(limit = 50): Promise<PuzzleAttempt[]> {
  const db = await getDB();
  const all: PuzzleAttempt[] = [];
  const tx = db.transaction('puzzleAttempts');
  const idx = tx.store.index('by-attemptedAt');
  for await (const cursor of idx.iterate(null, 'prev')) {
    all.push(cursor.value);
    if (all.length >= limit) break;
  }
  return all;
}

export async function upsertSrCard(card: SrCard): Promise<void> {
  const db = await getDB();
  await db.put('srCards', card);
}

export async function getDueSrCards(now = Date.now(), limit = 100): Promise<SrCard[]> {
  const db = await getDB();
  const tx = db.transaction('srCards');
  const idx = tx.store.index('by-dueAt');
  const out: SrCard[] = [];
  for await (const cursor of idx.iterate(IDBKeyRange.upperBound(now))) {
    out.push(cursor.value);
    if (out.length >= limit) break;
  }
  return out;
}

export async function getUserRating(pillar: 'tactics' | 'endgames'): Promise<UserRating | undefined> {
  const db = await getDB();
  return db.get('userRating', pillar);
}

export async function setUserRating(rating: UserRating): Promise<void> {
  const db = await getDB();
  await db.put('userRating', rating);
}

export async function recordEndgameAttempt(attempt: EndgameAttempt): Promise<void> {
  const db = await getDB();
  await db.add('endgameAttempts', attempt);
}

export async function getEndgameAttempts(positionId?: string): Promise<EndgameAttempt[]> {
  const db = await getDB();
  if (positionId === undefined) {
    return db.getAll('endgameAttempts');
  }
  return db.getAllFromIndex('endgameAttempts', 'by-positionId', positionId);
}

export async function recordOpeningProgress(p: OpeningProgress): Promise<void> {
  const db = await getDB();
  await db.put('openingProgress', p);
}

export async function getOpeningProgress(openingId: string): Promise<OpeningProgress[]> {
  const db = await getDB();
  return db.getAllFromIndex('openingProgress', 'by-openingId', openingId);
}

export async function clearAll(): Promise<void> {
  const db = await getDB();
  const stores = ['puzzleAttempts', 'srCards', 'userRating', 'endgameAttempts', 'openingProgress'] as const;
  await Promise.all(stores.map((s) => db.clear(s)));
}

export type { PuzzleAttempt, SrCard, UserRating, EndgameAttempt, OpeningProgress };
