/**
 * vendor-opening-names.ts
 *
 * Downloads the canonical opening name database from
 * `lichess-org/chess-openings` (CC0). Concatenates a.tsv ... e.tsv
 * (~3500 named ECO positions) and writes a single
 * `public/opening-names.json` keyed by NORMALISED FEN — so any caller
 * holding a chess.js position can look up the matching ECO + name + PGN.
 *
 * Upstream TSV header (verified 2026-04-27):
 *   eco \t name \t pgn
 *
 * (The repo used to ship a 5-column TSV with `uci` and `epd` columns. They
 * were dropped some time before April 2026 — we now compute the FEN
 * ourselves by replaying the PGN through chess.js, then normalise.)
 *
 * Run: `npm run vendor:opening-names`
 *
 * Idempotent — re-running overwrites the JSON with whatever's currently
 * upstream. Cheap, so no ETag caching needed.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { normFen } from '../src/openings/fen';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIR = join(REPO_ROOT, 'public');
const OUT_PATH = join(TARGET_DIR, 'opening-names.json');
const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';
const VOLUMES = ['a', 'b', 'c', 'd', 'e'] as const;

interface OpeningEntry {
  eco: string;
  name: string;
  pgn: string;
}

async function fetchVolume(letter: string): Promise<string | null> {
  const url = `${BASE}/${letter}.tsv`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[vendor-opening-names] ${letter}.tsv: HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`[vendor-opening-names] ${letter}.tsv: ${(err as Error).message}`);
    return null;
  }
}

function parseTsv(text: string, byFen: Record<string, OpeningEntry>): number {
  const lines = text.split(/\r?\n/);
  let added = 0;
  let sawHeader = false;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (!sawHeader) {
      sawHeader = true;     // skip header line
      continue;
    }
    const parts = raw.split('\t');
    if (parts.length < 3) continue;
    const eco = parts[0].trim();
    const name = parts[1].trim();
    const pgn = parts[2].trim();
    if (!eco || !name || !pgn) continue;

    // Replay the PGN through chess.js to derive the canonical FEN, then
    // normalise (drop half-move / full-move counters) so the key matches
    // the runtime `normFen()` shape used elsewhere in the app.
    let fenKey: string;
    try {
      const game = new Chess();
      game.loadPgn(pgn, { strict: false });
      fenKey = normFen(game.fen());
    } catch {
      continue;             // malformed PGN — skip the row
    }

    // First entry wins for a given FEN (later collisions are usually more
    // specific sub-name variants; the first canonical name in volume
    // order is the common one).
    if (byFen[fenKey] === undefined) {
      byFen[fenKey] = { eco, name, pgn };
      added++;
    }
  }
  return added;
}

async function main(): Promise<void> {
  if (!existsSync(TARGET_DIR)) mkdirSync(TARGET_DIR, { recursive: true });
  const byFen: Record<string, OpeningEntry> = {};
  let totalRows = 0;
  for (const v of VOLUMES) {
    const text = await fetchVolume(v);
    if (text === null) continue;
    const added = parseTsv(text, byFen);
    totalRows += added;
    console.log(`[vendor-opening-names] ${v}.tsv: +${added} entries (running ${totalRows})`);
  }
  if (totalRows === 0) {
    console.error('[vendor-opening-names] no rows downloaded — aborting');
    process.exitCode = 1;
    return;
  }
  // Pretty-print would balloon the file — write compact JSON.
  writeFileSync(OUT_PATH, JSON.stringify(byFen));
  console.log(`[vendor-opening-names] wrote ${OUT_PATH} (${Object.keys(byFen).length} unique FEN keys)`);
}

void main();
