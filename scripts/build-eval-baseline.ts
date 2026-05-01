#!/usr/bin/env -S node --import tsx
/*
 * build-eval-baseline.ts — Phase 2 audit pipeline (Tier 2 from
 * docs/CONTENT_AUDIT_PLAN.md).
 *
 * Runs Stockfish on every tabiya FEN + every USER-side move's
 * pre-move FEN across all opening lines, writes the result to
 * `tests/fixtures/eval-baseline.json`. The companion test
 * `tests/unit/openings/evalAudit.test.ts` reads that baseline at
 * test time (no engine at test time → fast CI), and compares to
 * claims in the prose:
 *   - Eval claims: prose says "+0.30 for White at master level" →
 *     baseline must agree within 50cp at depth 22.
 *   - User-move quality: every USER move must appear in the
 *     engine's top-3 at depth 22 (multipv-3) — otherwise we're
 *     teaching a move the engine considers inferior. This is what
 *     would have caught the Traxler `6.Kxf2` walk independently
 *     of the prose self-contradiction (which the perspective audit
 *     already catches).
 *
 * Run:
 *   ./.dev/wsl-run.sh tsx scripts/build-eval-baseline.ts
 *
 * Re-run: weekly via CI cron, OR after any content edit to
 * src/openings/lessons.ts. The output JSON is committed so reviews
 * see eval drift in PR diffs.
 *
 * Implementation notes:
 *
 * Stockfish in Node is fiddly. The npm `stockfish` package bundles
 * a WASM build that's designed primarily for browser use; piping
 * UCI commands via stdin/stdout requires the native binary OR the
 * `stockfish` package's Node entrypoint. We use the latter via
 * dynamic import — it spawns a Web Worker shim that talks UCI.
 *
 * For each FEN the routine:
 *   1. uci → wait for `uciok`
 *   2. setoption name MultiPV value 3
 *   3. ucinewgame
 *   4. position fen <FEN>
 *   5. go depth <DEPTH>
 *   6. accumulate `info ... multipv N ... pv MOVE` lines
 *   7. on `bestmove` — emit a result with top-3 moves + scores
 *
 * Default depth is 22 (matches Analysis route's SEARCH_DEPTH).
 * Total expected runtime: ~140 tabiyas * ~3s/eval = ~7min on a
 * modern laptop, ~3min on a server.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Chess } from 'chess.js';

import { OPENING_COURSES } from '../src/openings/lessons.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUTPUT_PATH = join(REPO_ROOT, 'tests/fixtures/eval-baseline.json');

const SEARCH_DEPTH = 22;
const MULTIPV = 3;

interface EvalResult {
  fen: string;
  depth: number;
  /** Top-N moves with their evaluations (in centipawns from white's POV). */
  topMoves: { uci: string; san: string; cp: number | null; mate: number | null }[];
  /** ISO timestamp of when this eval was generated. */
  evaluatedAt: string;
}

interface BaselineEntry {
  course: string;
  line: string;
  /** Ply index in line.nodes; matches `node` index. */
  ply: number;
  san: string;
  /** Side to move BEFORE this ply (so we can tell if it's the user's move). */
  sideToMove: 'white' | 'black';
  /** True if this ply was made by the side the course is intended for. */
  isUserMove: boolean;
  /** FEN BEFORE the move (so the eval shows what the engine recommends). */
  fenBefore: string;
  /** FEN AFTER the move (final tabiya position for the last node). */
  fenAfter: string;
  /** Engine eval at the position BEFORE the move. */
  evalBefore: EvalResult;
}

function inferUserSide(openingId: string): 'white' | 'black' {
  if (openingId.endsWith('-white')) return 'white';
  if (openingId.endsWith('-black')) return 'black';
  return 'white';
}

interface Engine {
  evaluate(fen: string, depth: number): Promise<EvalResult>;
  shutdown(): void;
}

/**
 * Lazy Stockfish engine wrapper. Adapts the npm `stockfish` package's
 * Worker-style API to a Promise-based UCI bridge.
 */
async function loadStockfish(): Promise<Engine> {
  // Dynamic import so this script doesn't crash if stockfish isn't
  // installed (e.g. in environments where we just want to read the
  // baseline without regenerating it).
  // @ts-expect-error — no types ship with the package
  const stockfishMod: unknown = await import('stockfish');
  const factory = (stockfishMod as { default?: unknown }).default ?? stockfishMod;
  const stockfishFactory = factory as () => unknown;
  const sf = stockfishFactory() as {
    postMessage: (s: string) => void;
    onmessage: ((s: string) => void) | null;
  };

  const send = (cmd: string): void => {
    sf.postMessage(cmd);
  };

  // Wait for `uciok` once at boot, then for `bestmove` per evaluate() call.
  const waitFor = (predicate: (line: string) => boolean): Promise<string[]> =>
    new Promise((resolve) => {
      const buffer: string[] = [];
      sf.onmessage = (line: string): void => {
        buffer.push(line);
        if (predicate(line)) {
          sf.onmessage = null;
          resolve(buffer);
        }
      };
    });

  send('uci');
  await waitFor((l) => l.includes('uciok'));
  send(`setoption name MultiPV value ${MULTIPV}`);
  send('isready');
  await waitFor((l) => l.includes('readyok'));

  return {
    async evaluate(fen: string, depth: number): Promise<EvalResult> {
      send('ucinewgame');
      send(`position fen ${fen}`);
      send(`go depth ${depth}`);
      const lines = await waitFor((l) => l.startsWith('bestmove'));

      // Collect the LAST `info` line for each multipv index — chessground
      // evaluation is deepest there. UCI emits info as depth grows; we
      // want the deepest depth's multipv breakdown.
      type InfoLine = { multipv: number; cp: number | null; mate: number | null; pv: string[]; depth: number };
      const byMultiPv = new Map<number, InfoLine>();
      for (const line of lines) {
        if (!line.startsWith('info')) continue;
        const tokens = line.split(' ');
        const get = (key: string): string | undefined => {
          const idx = tokens.indexOf(key);
          return idx >= 0 ? tokens[idx + 1] : undefined;
        };
        const multipvStr = get('multipv');
        const depthStr = get('depth');
        if (!multipvStr || !depthStr) continue;
        const mp = Number(multipvStr);
        const lineDepth = Number(depthStr);
        const cpStr = get('cp');
        const mateStr = get('mate');
        const pvStartIdx = tokens.indexOf('pv');
        const pv = pvStartIdx >= 0 ? tokens.slice(pvStartIdx + 1) : [];
        const cur = byMultiPv.get(mp);
        if (!cur || cur.depth < lineDepth) {
          byMultiPv.set(mp, {
            multipv: mp,
            cp: cpStr !== undefined ? Number(cpStr) : null,
            mate: mateStr !== undefined ? Number(mateStr) : null,
            pv,
            depth: lineDepth,
          });
        }
      }

      const game = new Chess(fen);
      const sideToMove = game.turn();
      const topMoves: EvalResult['topMoves'] = [];
      for (const mp of [...byMultiPv.keys()].sort((a, b) => a - b)) {
        const info = byMultiPv.get(mp)!;
        const uci = info.pv[0] ?? '';
        if (!uci) continue;
        let san = '';
        try {
          const probe = new Chess(fen);
          const move = probe.move({
            from: uci.slice(0, 2),
            to: uci.slice(2, 4),
            promotion: uci.length > 4 ? uci.slice(4) : undefined,
          });
          san = move?.san ?? uci;
        } catch {
          san = uci;
        }
        // Stockfish reports cp/mate from the side-to-move's POV; flip
        // sign for black so the baseline is uniformly "from white's POV".
        const cp = info.cp !== null ? (sideToMove === 'b' ? -info.cp : info.cp) : null;
        const mate = info.mate !== null ? (sideToMove === 'b' ? -info.mate : info.mate) : null;
        topMoves.push({ uci, san, cp, mate });
      }

      return {
        fen,
        depth,
        topMoves,
        evaluatedAt: new Date().toISOString(),
      };
    },
    shutdown(): void {
      send('quit');
    },
  };
}

async function main(): Promise<void> {
  console.log(`Building eval baseline (depth ${SEARCH_DEPTH}, multipv ${MULTIPV})…`);
  let engine: Engine;
  try {
    engine = await loadStockfish();
  } catch (e) {
    console.error('Failed to load Stockfish.', e);
    console.error('Run `npm install` to ensure the stockfish dep is installed.');
    process.exit(1);
  }

  const entries: BaselineEntry[] = [];
  let processed = 0;
  let totalUserMoves = 0;
  for (const course of Object.values(OPENING_COURSES)) {
    for (const line of course.lines) {
      const userSide = inferUserSide(course.openingId);
      const game = new Chess();
      for (let i = 1; i < line.nodes.length; i++) {
        const node = line.nodes[i];
        if (!node || !node.san) continue;
        const fenBefore = game.fen();
        const sideBeforeMove = game.turn() === 'w' ? 'white' : 'black';
        const isUserMove = sideBeforeMove === userSide;
        const moveResult = game.move(node.san);
        if (!moveResult) continue;
        if (isUserMove) totalUserMoves++;

        // To keep the run tractable we eval ONLY user-side moves'
        // pre-move positions PLUS the final tabiya position. Opponent
        // moves are deterministic given the line; the user-side moves
        // are what the audit cares about.
        const isLastNode = i === line.nodes.length - 1;
        if (!isUserMove && !isLastNode) continue;

        const evalBefore = await engine.evaluate(fenBefore, SEARCH_DEPTH);
        entries.push({
          course: course.openingId,
          line: line.id,
          ply: i,
          san: node.san,
          sideToMove: sideBeforeMove,
          isUserMove,
          fenBefore,
          fenAfter: game.fen(),
          evalBefore,
        });
        processed++;
        if (processed % 10 === 0) {
          console.log(`  …${processed} positions evaluated`);
        }
      }
    }
  }

  engine.shutdown();

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      {
        depth: SEARCH_DEPTH,
        multipv: MULTIPV,
        generatedAt: new Date().toISOString(),
        positions: entries,
      },
      null,
      2,
    ),
  );

  console.log(`✓ Wrote ${entries.length} positions (covering ${totalUserMoves} user-side moves) to ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
