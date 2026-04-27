import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { OPENINGS, openingById, selectMainLine, type OpeningNode } from '@/chess/openings/book';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function visit(node: OpeningNode, expectedFen: string, path: string[] = []): void {
  expect(node.fen, `node ${path.join(' > ')}`).toBe(expectedFen);
  for (const child of node.children ?? []) {
    const game = new Chess(node.fen);
    expect(() => {
      game.move({ from: child.uci.slice(0, 2), to: child.uci.slice(2, 4), promotion: child.uci.length >= 5 ? (child.uci[4] as 'q' | 'r' | 'b' | 'n') : 'q' });
    }, `child ${child.san} from ${path.join(' > ')}`).not.toThrow();
    expect(child.fen, `child fen for ${child.san}`).toBe(game.fen());
    visit(child, child.fen, [...path, child.san]);
  }
}

describe('Opening book', () => {
  it('every opening has a synthetic root at the starting position', () => {
    for (const o of OPENINGS) {
      expect(o.tree.fen, `${o.id}`).toBe(STARTING_FEN);
      expect(o.tree.children?.length ?? 0, `${o.id} has at least one first move`).toBeGreaterThan(0);
    }
  });

  it('every node in the tree has a legal move from its parent fen', () => {
    for (const o of OPENINGS) {
      visit(o.tree, STARTING_FEN, [o.name]);
    }
  });

  it('main line walks at least 4 ply for every opening', () => {
    for (const o of OPENINGS) {
      const line = selectMainLine(o.tree);
      // line[0] is the synthetic root, then real moves
      expect(line.length - 1, `${o.id} mainline plies`).toBeGreaterThanOrEqual(4);
    }
  });

  it('openingById returns the matching opening', () => {
    expect(openingById('italian-white')?.eco).toBe('C50');
    expect(openingById('does-not-exist')).toBeUndefined();
  });
});
