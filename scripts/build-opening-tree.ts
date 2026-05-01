#!/usr/bin/env -S node --import tsx
/*
 * build-opening-tree.ts — Tier-A content pipeline, step 1 of 2.
 *
 * Streams a PGN file (Lichess Masters DB or filtered standard DB)
 * and builds a frequency tree keyed by FEN. The output JSON is
 * consumed by `scripts/generate-opening-lines.ts` to produce
 * popularity-weighted LineSpec stubs for new opening lines.
 *
 * See docs/CONTENT_SOURCING_PLAN.md for the full pipeline design.
 *
 * Usage:
 *   ./.dev/wsl-run.sh tsx scripts/build-opening-tree.ts \
 *     --input /path/to/lichess-masters.pgn \
 *     --output public/opening-tree.json \
 *     --max-plies 20 \
 *     --min-elo 2200    # only used if input is the standard DB
 *
 * Recommended source: Lichess Masters DB from
 * https://database.lichess.org/ (CC0). See README inside the
 * Lichess open-database for the exact filename of the masters
 * dump (varies by month). Falls back to the standard DB filtered
 * by Elo if the masters dump isn't available.
 *
 * Output schema (gitignored — large):
 *   {
 *     "generatedAt": "2026-05-01T...",
 *     "totalGames": 4123456,
 *     "maxPlies": 20,
 *     "nodes": {
 *       "<normalised FEN>": {
 *         "totalGames": 12345,
 *         "moves": {
 *           "e4": { "count": 6789, "nextFen": "..." },
 *           "d4": { "count": 4321, "nextFen": "..." },
 *           ...
 *         }
 *       },
 *       ...
 *     }
 *   }
 *
 * Memory: holds the full tree in memory. Lichess Masters DB
 * (~4M games × 20 plies × ~3 moves per node) fits in ~3-6 GB.
 * Lower `--max-plies` if you hit OOM; opening-authoring rarely
 * needs more than 12-15 plies anyway.
 *
 * Performance: ~10-20k games/sec on a modern CPU. 4M games ≈
 * 5-10 min. Run on the cloud server (CPU + disk).
 *
 * STATUS: scaffolded with a working tree-building core. PGN
 * parsing uses chess.js's loadPgn for one-game-at-a-time so the
 * input must be split into individual games — the simplest way
 * is the streaming `--input -` mode that reads stdin and splits
 * on `\n\n` between games. For the actual Lichess dumps, use
 * `zstd -dc lichess-masters.pgn.zst | ... build-opening-tree.ts
 * --input -`.
 */

import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Chess } from 'chess.js';

interface MoveEdge {
  count: number;
  nextFen: string;
}
interface TreeNode {
  totalGames: number;
  moves: { [san: string]: MoveEdge };
}
interface TreeOutput {
  generatedAt: string;
  totalGames: number;
  maxPlies: number;
  minElo: number | null;
  nodes: { [fen: string]: TreeNode };
}

interface CliArgs {
  input: string;
  output: string;
  maxPlies: number;
  minElo: number | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback?: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx < 0) return fallback;
    return args[idx + 1];
  };
  const input = get('--input');
  const output = get('--output', 'public/opening-tree.json');
  const maxPlies = Number(get('--max-plies', '20'));
  const minEloRaw = get('--min-elo');
  const minElo = minEloRaw ? Number(minEloRaw) : null;
  if (!input) {
    console.error('Usage: build-opening-tree.ts --input <PGN file> [--output <json>] [--max-plies N] [--min-elo N]');
    process.exit(64);
  }
  return { input, output: output!, maxPlies, minElo };
}

/**
 * Normalise a FEN by stripping the halfmove and fullmove counters.
 * Two transpositions reach the same node; without this normalisation
 * we'd treat them as different positions (and the tree would explode
 * in size while losing transposition aggregation).
 */
function normFen(fen: string): string {
  const parts = fen.split(' ');
  return parts.slice(0, 4).join(' ');
}

/**
 * Stream-read PGN games from stdin (input === '-') or a file path.
 * Yields one PGN string per game. Naive splitter: assumes games are
 * separated by blank lines AFTER a result token (`1-0`, `0-1`,
 * `1/2-1/2`, `*`). Good enough for the Lichess dumps which are
 * uniformly formatted.
 */
async function* iterPgnGames(input: string): AsyncGenerator<string> {
  const stream = input === '-' ? process.stdin : createReadStream(input, { encoding: 'utf8' });
  if (input !== '-') stream.setEncoding('utf8');
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let current: string[] = [];
  for await (const line of rl) {
    current.push(line);
    // End of a game = a line that ends with a result token AND is
    // followed by a blank line. Easier: when we see `[Event ` AT
    // THE START of a line AND we already have content, the new
    // [Event header begins the NEXT game — yield what we have.
    if (line.startsWith('[Event ') && current.length > 1 && current.slice(0, -1).join('\n').includes('[Event ')) {
      // The previous game starts at our buffer start and ends just
      // before THIS [Event line.
      const prev = current.slice(0, -1).join('\n').trim();
      if (prev) yield prev;
      current = [line];
    }
  }
  const last = current.join('\n').trim();
  if (last) yield last;
}

/**
 * Extract Elo ratings from PGN headers. Returns null if either
 * side is missing or unparseable.
 */
function getEloHeaders(pgn: string): { white: number; black: number } | null {
  const w = /\[WhiteElo\s+"(\d+)"\]/i.exec(pgn);
  const b = /\[BlackElo\s+"(\d+)"\]/i.exec(pgn);
  if (!w || !b || !w[1] || !b[1]) return null;
  return { white: Number(w[1]), black: Number(b[1]) };
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.error(`Building opening tree from ${args.input} (max-plies=${args.maxPlies}, min-elo=${args.minElo ?? 'none'})…`);

  const tree = new Map<string, TreeNode>();
  let totalGames = 0;
  let acceptedGames = 0;
  let lastReportAt = Date.now();

  for await (const pgn of iterPgnGames(args.input)) {
    totalGames++;

    // Elo filter — only applied if the user asked for one.
    if (args.minElo !== null) {
      const elo = getEloHeaders(pgn);
      if (!elo || elo.white < args.minElo || elo.black < args.minElo) continue;
    }

    let game: Chess;
    try {
      game = new Chess();
      game.loadPgn(pgn);
    } catch {
      continue; // malformed PGN — skip silently
    }

    const moves = game.history();
    if (moves.length === 0) continue;
    acceptedGames++;

    // Walk the game replaying moves. At each ply, increment the edge
    // count from the pre-move FEN to the post-move FEN.
    const replay = new Chess();
    const cap = Math.min(moves.length, args.maxPlies);
    for (let i = 0; i < cap; i++) {
      const fenBefore = normFen(replay.fen());
      const moveResult = replay.move(moves[i]);
      if (!moveResult) break;
      const fenAfter = normFen(replay.fen());

      const node = tree.get(fenBefore) ?? { totalGames: 0, moves: {} };
      node.totalGames++;
      const edge = node.moves[moveResult.san] ?? { count: 0, nextFen: fenAfter };
      edge.count++;
      node.moves[moveResult.san] = edge;
      tree.set(fenBefore, node);
    }

    // Progress reporting every 10 sec
    if (Date.now() - lastReportAt > 10000) {
      console.error(`  …${totalGames.toLocaleString()} games scanned, ${acceptedGames.toLocaleString()} accepted, ${tree.size.toLocaleString()} unique positions`);
      lastReportAt = Date.now();
    }
  }

  console.error(`Done streaming. ${totalGames.toLocaleString()} games scanned, ${acceptedGames.toLocaleString()} accepted, ${tree.size.toLocaleString()} unique positions.`);

  // Emit
  const output: TreeOutput = {
    generatedAt: new Date().toISOString(),
    totalGames: acceptedGames,
    maxPlies: args.maxPlies,
    minElo: args.minElo,
    nodes: Object.fromEntries(tree),
  };
  await writeFile(args.output, JSON.stringify(output));
  const sizeMb = JSON.stringify(output).length / 1024 / 1024;
  console.error(`✓ Wrote ${tree.size.toLocaleString()} nodes (${sizeMb.toFixed(1)} MB) to ${args.output}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
