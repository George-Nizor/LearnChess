/**
 * vendor-piece-sets.ts
 *
 * Downloads chess piece SVGs from the Lichess `lila` repository (GPL-3.0,
 * compatible with our project licence) into `public/piece-sets/<set>/`.
 *
 * Each set is a folder of 12 SVGs named `{w,b}{P,N,B,R,Q,K}.svg`. The
 * accompanying CSS in `public/piece-sets/<set>.css` references these URLs
 * via background-image — chessground only needs the .cg-wrap piece.* rules
 * to be filled in to render the pieces.
 *
 * Run: `npm run vendor:piece-sets`
 *   or `wsl -- bash -lc './.dev/wsl-run.sh npm run vendor:piece-sets'`
 *
 * Idempotent — already-downloaded files are skipped.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIR = join(REPO_ROOT, 'public', 'piece-sets');
const BASE = 'https://raw.githubusercontent.com/lichess-org/lila/master/public/piece';

const SETS = ['cburnett', 'merida', 'alpha', 'pirouetti', 'tatiana'] as const;
const PIECES = [
  'wK','wQ','wR','wB','wN','wP',
  'bK','bQ','bR','bB','bN','bP',
] as const;

async function fetchOne(set: string, piece: string): Promise<boolean> {
  const url = `${BASE}/${set}/${piece}.svg`;
  const dir = join(TARGET_DIR, set);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const dst = join(dir, `${piece}.svg`);
  if (existsSync(dst)) return true;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[vendor-piece-sets] ${set}/${piece}: HTTP ${res.status}`);
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dst, buf);
    return true;
  } catch (err) {
    console.warn(`[vendor-piece-sets] ${set}/${piece}: ${(err as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  if (!existsSync(TARGET_DIR)) mkdirSync(TARGET_DIR, { recursive: true });
  let total = 0;
  let ok = 0;
  for (const set of SETS) {
    for (const p of PIECES) {
      total++;
      if (await fetchOne(set, p)) ok++;
    }
    console.log(`[vendor-piece-sets] ${set}: done`);
  }
  console.log(`[vendor-piece-sets] ${ok}/${total} SVGs available`);
  if (ok === 0) {
    console.warn('[vendor-piece-sets] no downloads succeeded — alternate piece sets will fall back to cburnett at runtime');
  }
}

void main();
