#!/usr/bin/env -S node --import tsx
/*
 * generate-opening-lines.ts — content-prioritisation tool (re-purposed
 * 2026-05-01 from the original "auto-generate draft LineSpecs" design).
 *
 * Reads the frequency tree from `build-opening-tree.ts` and emits a
 * MARKDOWN REPORT per opening listing the most-played positions and
 * suggested move sequences from real master games. The report is the
 * AUTHORING BACKLOG for hand-writing new lines into
 * src/openings/lessons.ts — NOT something that ships to the app.
 *
 * Why this changed: an earlier design wrote draft LineSpec stubs with
 * placeholder prose into src/openings/generated-lines.ts, which were
 * auto-merged into the courses with a "Draft" badge. The user pushed
 * back: shipped content should be polished and hand-authored. The
 * pipeline's job is to surface WHAT to write, not to write itself.
 *
 * See docs/CONTENT_SOURCING_PLAN.md for the full pipeline design.
 *
 * Usage:
 *   ./.dev/wsl-run.sh tsx scripts/generate-opening-lines.ts \
 *     --tree public/opening-tree.json \
 *     --targets scripts/opening-targets.json \
 *     --output docs/research/opening-backlog/
 *
 * Output: one markdown file per opening in --output dir, e.g.:
 *   docs/research/opening-backlog/london-white.md
 *   docs/research/opening-backlog/vienna-white.md
 *
 * Each report lists the top-N most-played positions reachable from
 * the opening's root, with frequencies and the move sequences to
 * reach them. Authors use the report to pick which lines to write.
 *
 * STATUS: scaffolded with working tree-walk + markdown emit.
 * Run on the cloud server after building the opening tree from
 * the Lichess Masters DB.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

interface BacklogEntry {
  /** Move sequence from the start position to the suggested tabiya. */
  movesPath: string[];
  /** Number of master games that reach this position. */
  gamesAtTabiya: number;
  /** % at each branch point (joined as a description). */
  pctAtBranches: number[];
  /** What to play next at the tabiya, sorted by frequency. */
  topContinuations: { san: string; pct: number; count: number }[];
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
    output: get('--output', 'docs/research/opening-backlog/')!,
  };
}

function normFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

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
 * BFS from the root position. Each leaf path becomes one backlog entry
 * with frequency data attached.
 */
function expandBranches(
  tree: TreeFile,
  rootFen: string,
  rootGame: Chess,
  branchPlies: number,
  maxBranchesPerNode: number,
  minFrequencyPct: number,
): BacklogEntry[] {
  interface Frontier {
    game: Chess;
    movesPath: string[];
    pctAtBranches: number[];
    gamesAtCurrent: number;
  }
  const initial: Frontier = {
    game: new Chess(rootGame.fen()),
    movesPath: [],
    pctAtBranches: [],
    gamesAtCurrent: tree.nodes[rootFen]?.totalGames ?? 0,
  };

  const completed: BacklogEntry[] = [];
  const queue: Frontier[] = [initial];

  const buildBacklogEntry = (cur: Frontier): BacklogEntry => {
    const fenAtTabiya = normFen(cur.game.fen());
    const tabiyaNode = tree.nodes[fenAtTabiya];
    const topContinuations: BacklogEntry['topContinuations'] = tabiyaNode
      ? Object.entries(tabiyaNode.moves)
          .map(([san, edge]) => ({ san, count: edge.count, pct: (edge.count / tabiyaNode.totalGames) * 100 }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
      : [];
    return {
      movesPath: cur.movesPath,
      gamesAtTabiya: cur.gamesAtCurrent,
      pctAtBranches: cur.pctAtBranches,
      topContinuations,
    };
  };

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.movesPath.length >= branchPlies) {
      completed.push(buildBacklogEntry(cur));
      continue;
    }
    const fen = normFen(cur.game.fen());
    const node = tree.nodes[fen];
    if (!node || node.totalGames === 0) {
      completed.push(buildBacklogEntry(cur));
      continue;
    }
    const sortedMoves = Object.entries(node.moves)
      .map(([san, edge]) => ({ san, count: edge.count, nextFen: edge.nextFen, pct: (edge.count / node.totalGames) * 100 }))
      .sort((a, b) => b.count - a.count)
      .filter((m) => m.pct >= minFrequencyPct)
      .slice(0, maxBranchesPerNode);

    if (sortedMoves.length === 0) {
      completed.push(buildBacklogEntry(cur));
      continue;
    }

    for (const m of sortedMoves) {
      const childGame = new Chess(cur.game.fen());
      const result = childGame.move(m.san);
      if (!result) continue;
      const nextNode = tree.nodes[normFen(childGame.fen())];
      queue.push({
        game: childGame,
        movesPath: [...cur.movesPath, m.san],
        pctAtBranches: [...cur.pctAtBranches, m.pct],
        gamesAtCurrent: nextNode?.totalGames ?? 0,
      });
    }
  }

  return completed;
}

function formatMovesPath(rootMoves: string[], branchMoves: string[]): string {
  const all = [...rootMoves, ...branchMoves];
  return all
    .map((san, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}.${san}` : san))
    .join(' ');
}

function buildReport(openingId: string, target: OpeningTarget, entries: BacklogEntry[], totalGamesScanned: number): string {
  const lines: string[] = [];
  lines.push(`# Authoring backlog: ${openingId}`);
  lines.push('');
  lines.push(`> Generated by \`scripts/generate-opening-lines.ts\` from the Lichess Masters DB.`);
  lines.push(`> Total master games in source: ${totalGamesScanned.toLocaleString()}.`);
  lines.push(`> Root moves: ${target.rootMoves.join(' ')}.`);
  lines.push(`> Branch depth: ${target.branchPlies} plies past root, top ${target.maxBranchesPerNode} continuations per node, ≥${target.minFrequencyPct}% frequency cutoff.`);
  lines.push('');
  lines.push(`## How to use this report`);
  lines.push('');
  lines.push(`Each entry below is a SUGGESTED LINE TO AUTHOR — a position that's actually reached in master games with non-trivial frequency. The "top continuations" tell you what move to teach next at the tabiya. Pick entries by gamesAtTabiya (popularity) + pedagogical value (does it teach a concrete pattern?), write the line into \`src/openings/lessons.ts\` using \`buildLine({ ... })\`, and run \`npm run audit:hung\` + \`npm test\` before committing.`);
  lines.push('');
  lines.push(`## Suggested lines (sorted by master-game frequency)`);
  lines.push('');

  // Sort entries by gamesAtTabiya descending
  const sorted = [...entries].sort((a, b) => b.gamesAtTabiya - a.gamesAtTabiya);

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const movesStr = formatMovesPath(target.rootMoves, e.movesPath);
    lines.push(`### ${i + 1}. \`${movesStr}\``);
    lines.push('');
    lines.push(`- **Games at tabiya**: ${e.gamesAtTabiya.toLocaleString()}`);
    if (e.pctAtBranches.length > 0) {
      const branchPctsStr = e.pctAtBranches.map((p) => `${p.toFixed(1)}%`).join(' → ');
      lines.push(`- **Branch frequencies**: ${branchPctsStr}`);
    }
    if (e.topContinuations.length > 0) {
      lines.push(`- **Top continuations at this tabiya** (what masters play next):`);
      for (const c of e.topContinuations) {
        lines.push(`  - \`${c.san}\` — ${c.count.toLocaleString()} games (${c.pct.toFixed(1)}%)`);
      }
    } else {
      lines.push(`- **Top continuations at this tabiya**: (none — position rarely reached past this depth in the dataset)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.error(`Loading tree from ${args.tree}…`);
  const tree = JSON.parse(await readFile(args.tree, 'utf8')) as TreeFile;
  console.error(`Loading targets from ${args.targets}…`);
  const targets = JSON.parse(await readFile(args.targets, 'utf8')) as TargetsFile;

  await mkdir(args.output, { recursive: true });

  for (const [openingId, target] of Object.entries(targets)) {
    if (openingId.startsWith('_')) continue; // skip JSON-comment keys
    console.error(`Processing ${openingId}…`);
    const root = walkToRoot(tree, target.rootMoves);
    if (!root) {
      console.error(`  ✗ Could not walk root moves in tree — skipping`);
      continue;
    }
    const entries = expandBranches(
      tree,
      root.fen,
      root.game,
      target.branchPlies,
      target.maxBranchesPerNode,
      target.minFrequencyPct,
    );
    const report = buildReport(openingId, target, entries, tree.totalGames);
    const outPath = join(args.output, `${openingId}.md`);
    await writeFile(outPath, report);
    console.error(`  ✓ Wrote ${entries.length} backlog entries → ${outPath}`);
  }

  console.error('Done. Use the reports as your authoring backlog.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
