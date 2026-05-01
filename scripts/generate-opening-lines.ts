#!/usr/bin/env -S node --import tsx
/*
 * generate-opening-lines.ts — Tier-A content pipeline, step 2 of 2.
 *
 * Reads the frequency tree from `build-opening-tree.ts` and emits
 * popularity-weighted LineSpec stubs for new opening lines. Output
 * is a TypeScript module exporting `LineSpec[]` that gets imported
 * by `src/openings/lessons.ts` and merged with hand-authored lines.
 *
 * See docs/CONTENT_SOURCING_PLAN.md for the full pipeline design.
 *
 * Usage:
 *   ./.dev/wsl-run.sh tsx scripts/generate-opening-lines.ts \
 *     --tree public/opening-tree.json \
 *     --targets scripts/opening-targets.json \
 *     --output src/openings/generated-lines.ts
 *
 * The targets config drives generation. Example
 * (`scripts/opening-targets.json`):
 *   {
 *     "london-white": {
 *       "rootMoves": ["d4", "d5", "Bf4"],
 *       "branchPlies": 8,
 *       "maxBranchesPerNode": 3,
 *       "minFrequencyPct": 5
 *     }
 *   }
 *
 * For each opening:
 *   1. Walk the tree to the root position via `rootMoves`.
 *   2. BFS-expand: at each node, pick the top `maxBranchesPerNode`
 *      moves with frequency >= `minFrequencyPct`.
 *   3. Each leaf path becomes one LineSpec.
 *   4. Generate factual prose from move frequencies (no
 *      tactical/eval/historical claims — those need human review).
 *
 * STATUS: scaffolded with working tree-walk + LineSpec emit.
 * Prose templating is intentionally minimal — generated lines
 * are STUBS for human review, not finished content.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { Chess } from 'chess.js';

interface MoveEdge {
  count: number;
  nextFen: string;
}
interface TreeNode {
  totalGames: number;
  moves: { [san: string]: MoveEdge };
}
interface TreeFile {
  generatedAt: string;
  totalGames: number;
  maxPlies: number;
  minElo: number | null;
  nodes: { [fen: string]: TreeNode };
}

interface OpeningTarget {
  rootMoves: string[];
  branchPlies: number;
  maxBranchesPerNode: number;
  minFrequencyPct: number;
}
type TargetsFile = { [openingId: string]: OpeningTarget };

interface CliArgs {
  tree: string;
  targets: string;
  output: string;
}

interface GeneratedMove {
  san: string;
  text: string;
}
interface GeneratedLine {
  id: string;
  openingId: string;
  name: string;
  description: string;
  intro: string;
  moves: GeneratedMove[];
  /** Provenance — counted at the tabiya position. */
  generated: { source: 'lichess-masters'; gamesAtTabiya: number };
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback?: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx < 0) return fallback;
    return args[idx + 1];
  };
  return {
    tree: get('--tree', 'public/opening-tree.json')!,
    targets: get('--targets', 'scripts/opening-targets.json')!,
    output: get('--output', 'src/openings/generated-lines.ts')!,
  };
}

function normFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/**
 * Walk down the tree along `rootMoves`. Return the FEN reached
 * AND the chess.js Chess instance at that point (for further
 * walking) AND the count of games that played the full root.
 */
function walkToRoot(
  tree: TreeFile,
  rootMoves: string[],
): { fen: string; game: Chess; gamesAtRoot: number } | null {
  const game = new Chess();
  let fen = normFen(game.fen());
  let gamesAtRoot = 0;
  for (const san of rootMoves) {
    const node = tree.nodes[fen];
    if (!node) return null;
    const edge = node.moves[san];
    if (!edge) return null;
    gamesAtRoot = edge.count;
    game.move(san);
    fen = normFen(game.fen());
  }
  return { fen, game, gamesAtRoot };
}

/**
 * BFS from the root position, picking the top-N moves at each
 * node above the frequency threshold. Each leaf path becomes
 * one generated line.
 *
 * Termination per branch: depth reached, OR no more moves above
 * the threshold (we hit a position with no popular continuation).
 */
function expandBranches(
  tree: TreeFile,
  rootFen: string,
  rootGame: Chess,
  branchPlies: number,
  maxBranchesPerNode: number,
  minFrequencyPct: number,
): { game: Chess; movesPlayed: { san: string; pctAtNode: number; nextFen: string }[]; gamesAtTabiya: number }[] {
  interface Frontier {
    game: Chess;
    movesPlayed: { san: string; pctAtNode: number; nextFen: string }[];
    gamesAtCurrent: number;
  }
  const initial: Frontier = {
    game: new Chess(rootGame.fen()),
    movesPlayed: [],
    gamesAtCurrent: tree.nodes[rootFen]?.totalGames ?? 0,
  };

  const completed: { game: Chess; movesPlayed: Frontier['movesPlayed']; gamesAtTabiya: number }[] = [];
  const queue: Frontier[] = [initial];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.movesPlayed.length >= branchPlies) {
      completed.push({ game: cur.game, movesPlayed: cur.movesPlayed, gamesAtTabiya: cur.gamesAtCurrent });
      continue;
    }
    const fen = normFen(cur.game.fen());
    const node = tree.nodes[fen];
    if (!node || node.totalGames === 0) {
      completed.push({ game: cur.game, movesPlayed: cur.movesPlayed, gamesAtTabiya: cur.gamesAtCurrent });
      continue;
    }
    const sortedMoves = Object.entries(node.moves)
      .map(([san, edge]) => ({ san, count: edge.count, nextFen: edge.nextFen, pct: (edge.count / node.totalGames) * 100 }))
      .sort((a, b) => b.count - a.count)
      .filter((m) => m.pct >= minFrequencyPct)
      .slice(0, maxBranchesPerNode);

    if (sortedMoves.length === 0) {
      completed.push({ game: cur.game, movesPlayed: cur.movesPlayed, gamesAtTabiya: cur.gamesAtCurrent });
      continue;
    }

    for (const m of sortedMoves) {
      const childGame = new Chess(cur.game.fen());
      const result = childGame.move(m.san);
      if (!result) continue;
      const nextNode = tree.nodes[normFen(childGame.fen())];
      queue.push({
        game: childGame,
        movesPlayed: [...cur.movesPlayed, { san: m.san, pctAtNode: m.pct, nextFen: m.nextFen }],
        gamesAtCurrent: nextNode?.totalGames ?? 0,
      });
    }
  }

  return completed;
}

/**
 * Auto-generate prose for a line. STRICTLY factual — only states
 * frequency data that's literally in the tree. No tactical claims,
 * no eval claims, no historical claims. Human review will replace
 * with real teaching prose.
 */
function generateLine(
  openingId: string,
  rootMoves: string[],
  branch: { game: Chess; movesPlayed: { san: string; pctAtNode: number; nextFen: string }[]; gamesAtTabiya: number },
  branchIdx: number,
): GeneratedLine {
  const allMoves = [...rootMoves, ...branch.movesPlayed.map((m) => m.san)];
  const linePathStr = allMoves
    .map((san, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}.${san}` : san))
    .join(' ');

  // Make a stable line id from the move sequence
  const moveSlug = allMoves.map((s) => s.replace(/[+#=]/g, '')).join('-').toLowerCase();
  const id = `${openingId}-gen-${moveSlug}`.slice(0, 80);

  const name = `Generated: ${linePathStr.slice(0, 50)}`;

  const description = `Auto-generated from Lichess Masters DB at ${branch.gamesAtTabiya.toLocaleString()} master games. STUB — needs human review.`;

  const intro = `Auto-generated stub — needs human review before shipping. Move sequence reaches a position played in ${branch.gamesAtTabiya.toLocaleString()} master games. Replace this prose with a real introduction explaining the line's IDEAS (not just the moves).`;

  // Per-move prose: replay in a fresh game so we have move numbers right
  const replayGame = new Chess();
  const moves: GeneratedMove[] = [];
  for (let i = 0; i < rootMoves.length; i++) {
    const san = rootMoves[i];
    replayGame.move(san);
    const moveNum = Math.floor(i / 2) + 1;
    const prefix = i % 2 === 0 ? `**${moveNum}.${san}**` : `**${moveNum}...${san}**`;
    moves.push({ san, text: `${prefix} — opening sequence.` });
  }
  for (const branchMove of branch.movesPlayed) {
    const i = moves.length;
    const moveNum = Math.floor(i / 2) + 1;
    const prefix = i % 2 === 0 ? `**${moveNum}.${branchMove.san}**` : `**${moveNum}...${branchMove.san}**`;
    moves.push({
      san: branchMove.san,
      text: `${prefix} — played in ${branchMove.pctAtNode.toFixed(1)}% of master games at this position.`,
    });
    replayGame.move(branchMove.san);
  }

  // Tabiya prose (the last move's text gets extended)
  if (moves.length > 0) {
    const last = moves[moves.length - 1];
    last.text +=
      ` Auto-generated tabiya stub: position reached in ${branch.gamesAtTabiya.toLocaleString()} master games.` +
      ' Common deviations, key squares, and tactical themes need human authoring before this line ships.';
  }

  return {
    id: `${id}-${branchIdx}`,
    openingId,
    name,
    description,
    intro,
    moves,
    generated: { source: 'lichess-masters', gamesAtTabiya: branch.gamesAtTabiya },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.error(`Loading tree from ${args.tree}…`);
  const tree = JSON.parse(await readFile(args.tree, 'utf8')) as TreeFile;
  console.error(`Loading targets from ${args.targets}…`);
  const targets = JSON.parse(await readFile(args.targets, 'utf8')) as TargetsFile;

  const allLines: GeneratedLine[] = [];
  for (const [openingId, target] of Object.entries(targets)) {
    console.error(`Processing ${openingId} (rootMoves=[${target.rootMoves.join(',')}])…`);
    const root = walkToRoot(tree, target.rootMoves);
    if (!root) {
      console.error(`  ✗ Could not walk root moves in tree — skipping`);
      continue;
    }
    const branches = expandBranches(
      tree,
      root.fen,
      root.game,
      target.branchPlies,
      target.maxBranchesPerNode,
      target.minFrequencyPct,
    );
    console.error(`  ${branches.length} branches generated`);
    for (let i = 0; i < branches.length; i++) {
      allLines.push(generateLine(openingId, target.rootMoves, branches[i], i));
    }
  }

  // Emit a TypeScript module that re-exports the generated lines.
  // The output uses LineSpec-compatible shape; lessons.ts is responsible
  // for importing + merging with hand-authored lines.
  const ts = `/*
 * AUTO-GENERATED — do not edit by hand.
 * Generated by scripts/generate-opening-lines.ts on ${new Date().toISOString()}.
 * Source: Lichess Masters DB (CC0).
 * See docs/CONTENT_SOURCING_PLAN.md for the pipeline.
 *
 * These are STUBS — every line in this file needs human review
 * before shipping. The 'generated' flag on each line marks it as
 * draft so the Drill mode can de-prioritise and the Learn view
 * can show a "needs review" badge.
 */

export interface GeneratedLineSpec {
  id: string;
  openingId: string;
  name: string;
  description: string;
  intro: string;
  moves: { san: string; text: string }[];
  generated: { source: 'lichess-masters'; gamesAtTabiya: number };
}

export const GENERATED_LINES: GeneratedLineSpec[] = ${JSON.stringify(allLines, null, 2)};
`;

  await writeFile(args.output, ts);
  console.error(`✓ Wrote ${allLines.length} generated line stubs to ${args.output}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
