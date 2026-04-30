import { afterEach, describe, expect, it } from 'vitest';
import {
  endgamesDB,
  getEndgameLessonProgress,
  markEndgameLessonNodeVisited,
  resetEndgameLessonProgress,
  listEndgameLessonProgress,
} from '@/endgames/db';

/**
 * Skip the whole suite when the test environment doesn't ship a working
 * IndexedDB (happy-dom doesn't always — see the existing openings/db,
 * which has no test counterpart for the same reason). When IDB IS
 * available, exercise the real upgrade + put + get path.
 */
const HAS_IDB = typeof indexedDB !== 'undefined';

afterEach(async () => {
  if (!HAS_IDB) return;
  // Wipe between tests so they don't interfere via the singleton db handle.
  const db = await endgamesDB();
  await db.clear('endgameLessonProgress');
});

describe.skipIf(!HAS_IDB)('endgames/db — endgameLessonProgress', () => {
  it('returns undefined when no progress recorded for a position', async () => {
    expect(await getEndgameLessonProgress('lucena')).toBeUndefined();
  });

  it('records the discoveredNodeIdx on first mark', async () => {
    await markEndgameLessonNodeVisited('lucena', 3);
    const lp = await getEndgameLessonProgress('lucena');
    expect(lp?.discoveredNodeIdx).toBe(3);
    expect(lp?.positionId).toBe('lucena');
    expect(typeof lp?.lastSeenAt).toBe('number');
  });

  it('only bumps discoveredNodeIdx forward, never backward', async () => {
    await markEndgameLessonNodeVisited('lucena', 5);
    await markEndgameLessonNodeVisited('lucena', 2);  // earlier — should not regress
    const lp = await getEndgameLessonProgress('lucena');
    expect(lp?.discoveredNodeIdx).toBe(5);
  });

  it('updates lastSeenAt even when not advancing the index', async () => {
    await markEndgameLessonNodeVisited('lucena', 5);
    const first = await getEndgameLessonProgress('lucena');
    await new Promise((r) => setTimeout(r, 5));
    await markEndgameLessonNodeVisited('lucena', 5);
    const second = await getEndgameLessonProgress('lucena');
    expect(second?.lastSeenAt).toBeGreaterThanOrEqual(first!.lastSeenAt);
  });

  it('isolates progress per positionId', async () => {
    await markEndgameLessonNodeVisited('lucena', 4);
    await markEndgameLessonNodeVisited('philidor', 1);
    expect((await getEndgameLessonProgress('lucena'))?.discoveredNodeIdx).toBe(4);
    expect((await getEndgameLessonProgress('philidor'))?.discoveredNodeIdx).toBe(1);
  });

  it('listEndgameLessonProgress returns every recorded position', async () => {
    await markEndgameLessonNodeVisited('lucena', 4);
    await markEndgameLessonNodeVisited('philidor', 1);
    const all = await listEndgameLessonProgress();
    const ids = new Set(all.map((p) => p.positionId));
    expect(ids.has('lucena')).toBe(true);
    expect(ids.has('philidor')).toBe(true);
  });

  it('resetEndgameLessonProgress deletes a single position record', async () => {
    await markEndgameLessonNodeVisited('lucena', 4);
    await resetEndgameLessonProgress('lucena');
    expect(await getEndgameLessonProgress('lucena')).toBeUndefined();
  });
});
