/*
 * IndexedDB layer for endgame Learn-mode progress.
 *
 * Mirrors `src/openings/db.ts`'s `lessonProgress` store. Why a separate
 * database (rather than reusing `learnchess-openings`)? The opening rep
 * uses an autoincrement integer key (`repertoireId`), but endgame
 * positions are identified by a string id (e.g. `lucena`). A new DB
 * keeps the key-paths cleanly typed and makes resets independent.
 *
 * Note: tablebase-graded play attempts continue to live in the existing
 * `endgameAttempts` store inside `src/persistence/db.ts`. This file only
 * tracks Learn-mode discovery.
 */

import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';

/** Per-position Learn-mode progress.
 *
 * `discoveredNodeIdx` is the furthest lesson node the user has reached
 * (0-indexed); used to compute the "Lines learned X/N" chip. */
export interface EndgameLessonProgress {
  positionId: string;
  discoveredNodeIdx: number;
  lastSeenAt: number;
}

interface EndgamesDBSchema extends DBSchema {
  endgameLessonProgress: {
    key: string;
    value: EndgameLessonProgress;
  };
}

const DB_NAME = 'learnchess-endgames';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<EndgamesDBSchema>> | null = null;

export function endgamesDB(): Promise<IDBPDatabase<EndgamesDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<EndgamesDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('endgameLessonProgress')) {
          db.createObjectStore('endgameLessonProgress', { keyPath: 'positionId' });
        }
      },
    });
  }
  return dbPromise;
}

export async function getEndgameLessonProgress(
  positionId: string,
): Promise<EndgameLessonProgress | undefined> {
  const db = await endgamesDB();
  return db.get('endgameLessonProgress', positionId);
}

/** Bump `discoveredNodeIdx` to `nodeIdx` if we haven't seen that far yet. */
export async function markEndgameLessonNodeVisited(
  positionId: string,
  nodeIdx: number,
): Promise<void> {
  const db = await endgamesDB();
  const existing = await db.get('endgameLessonProgress', positionId);
  if (existing && existing.discoveredNodeIdx >= nodeIdx) {
    await db.put('endgameLessonProgress', { ...existing, lastSeenAt: Date.now() });
    return;
  }
  await db.put('endgameLessonProgress', {
    positionId,
    discoveredNodeIdx: Math.max(existing?.discoveredNodeIdx ?? -1, nodeIdx),
    lastSeenAt: Date.now(),
  });
}

export async function resetEndgameLessonProgress(positionId: string): Promise<void> {
  const db = await endgamesDB();
  await db.delete('endgameLessonProgress', positionId);
}

/** All learn-mode progress rows. Used to compute course-wide "Lines learned"
 *  totals across positions in a course. */
export async function listEndgameLessonProgress(): Promise<EndgameLessonProgress[]> {
  const db = await endgamesDB();
  return db.getAll('endgameLessonProgress');
}
