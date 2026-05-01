/*
 * Curated offline opening book.
 *
 * Each opening is a tree of moves rooted at the INITIAL position. The drill
 * loop auto-plays opponent moves (heaviest weight) until it's the user's turn,
 * then waits for input. Wrong move => surface alternatives. Right move =>
 * advance, auto-play opponent's heaviest reply, repeat until end of variation.
 *
 * For openings the user plays as black, the tree's root.children begin with
 * White's move 1 (auto-played at drill start).
 *
 * All FENs are computed by chess.js inside makeOpening — never hand-typed.
 *
 * Lichess Opening Explorer requires auth as of April 2026 (CLAUDE.md), so
 * this curated tree replaces it for v1. Coverage is intentionally narrower
 * than chessable / chessreps; weights are approximate master frequencies.
 *
 * To add a new opening: write its move sequence as nested NodeSpec entries.
 * The builder validates every move via chess.js — invalid SAN throws at
 * module load with a clear stack trace.
 */

import { Chess } from 'chess.js';

export interface OpeningNode {
  uci: string;
  san: string;
  fen: string;
  weight?: number;
  comment?: string;
  children?: OpeningNode[];
}

export interface Opening {
  id: string;
  name: string;
  eco: string;
  forColor: 'w' | 'b';
  category: 'open' | 'semi-open' | 'closed' | 'flank' | 'indian';
  description: string;
  /** Synthetic root at the initial position. Its `children` are White's first moves. */
  tree: OpeningNode;
}

interface NodeSpec {
  san: string;
  weight?: number;
  comment?: string;
  children?: NodeSpec[];
}

interface OpeningSpec {
  id: string;
  name: string;
  eco: string;
  forColor: 'w' | 'b';
  category: Opening['category'];
  description: string;
  tree: NodeSpec[];
}

/** Linear chain helper: chain('e4','e5','Nf3') => one e4 node nesting e5 nesting Nf3. */
function chain(...sans: string[]): NodeSpec {
  const [first, ...rest] = sans;
  if (first === undefined) throw new Error('chain() requires at least one move');
  if (rest.length === 0) return { san: first };
  return { san: first, children: [chain(...rest)] };
}

function buildNode(spec: NodeSpec, parentFen: string): OpeningNode {
  const game = new Chess(parentFen);
  const move = game.move(spec.san);
  const node: OpeningNode = {
    uci: move.from + move.to + (move.promotion ?? ''),
    san: move.san,
    fen: game.fen(),
  };
  if (spec.weight !== undefined) node.weight = spec.weight;
  if (spec.comment !== undefined) node.comment = spec.comment;
  if (spec.children !== undefined) node.children = spec.children.map((c) => buildNode(c, game.fen()));
  return node;
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function makeOpening(spec: OpeningSpec): Opening {
  const tree: OpeningNode = {
    uci: '',
    san: '(start)',
    fen: STARTING_FEN,
    children: spec.tree.map((c) => buildNode(c, STARTING_FEN)),
  };
  return {
    id: spec.id,
    name: spec.name,
    eco: spec.eco,
    forColor: spec.forColor,
    category: spec.category,
    description: spec.description,
    tree,
  };
}

const SPECS: OpeningSpec[] = [
  // ====================================================================
  // ITALIAN GAME (white) — drilled from 1.e4
  // ====================================================================
  {
    id: 'italian-white',
    name: 'Italian Game',
    eco: 'C50',
    forColor: 'w',
    category: 'open',
    description: 'Classical 1.e4 opening with Bc4 hitting f7. Goal: open lines, fast development.',
    tree: [{
      san: 'e4', weight: 100, children: [
        { san: 'e5', weight: 60, children: [
          { san: 'Nf3', weight: 100, children: [
            { san: 'Nc6', weight: 80, children: [
              { san: 'Bc4', weight: 100, children: [
                { san: 'Bc5', weight: 50, comment: 'Giuoco Piano', children: [
                  { san: 'c3', weight: 60, children: [
                    { san: 'Nf6', weight: 70, children: [
                      { san: 'd4', weight: 60, children: [
                        { san: 'exd4', weight: 80, children: [
                          { san: 'cxd4', weight: 90, children: [
                            { san: 'Bb4+', weight: 70 },
                          ]},
                        ]},
                      ]},
                      { san: 'd3', weight: 30, comment: 'Italian quiet system' },
                    ]},
                  ]},
                  { san: 'O-O', weight: 30 },
                ]},
                { san: 'Nf6', weight: 40, comment: 'Two Knights', children: [
                  { san: 'Ng5', weight: 50, children: [
                    { san: 'd5', weight: 95, children: [
                      { san: 'exd5', weight: 95, children: [
                        { san: 'Na5', weight: 50, comment: 'Main line', children: [
                          { san: 'Bb5+', weight: 80 },
                        ]},
                      ]},
                    ]},
                  ]},
                  { san: 'd4', weight: 30, comment: 'Scotch Gambit shape', children: [
                    { san: 'exd4', weight: 100 },
                  ]},
                ]},
              ]},
            ]},
            { san: 'Nf6', weight: 15, comment: 'Petroff', children: [
              { san: 'Nxe5', weight: 100, children: [
                { san: 'd6', weight: 100, children: [
                  { san: 'Nf3', weight: 100 },
                ]},
              ]},
            ]},
          ]},
        ]},
        { san: 'c5', weight: 25, comment: 'Sicilian (transposes to Sicilian opening)', children: [
          { san: 'Nf3', weight: 100 },
        ]},
        { san: 'e6', weight: 8, comment: 'French (transposes)', children: [
          { san: 'd4', weight: 100 },
        ]},
        { san: 'c6', weight: 5, comment: 'Caro-Kann (transposes)', children: [
          { san: 'd4', weight: 100 },
        ]},
      ],
    }],
  },

  // ====================================================================
  // RUY LOPEZ (white)
  // ====================================================================
  {
    id: 'ruylopez-white',
    name: 'Ruy López (Spanish Game)',
    eco: 'C60',
    forColor: 'w',
    category: 'open',
    description: 'Classical 1.e4 e5 Nf3 Nc6 Bb5 — pin the knight, control e5.',
    tree: [{
      san: 'e4', weight: 100, children: [
        { san: 'e5', weight: 60, children: [
          { san: 'Nf3', weight: 100, children: [
            { san: 'Nc6', weight: 90, children: [
              { san: 'Bb5', weight: 100, children: [
                { san: 'a6', weight: 70, comment: 'Morphy Defence', children: [
                  { san: 'Ba4', weight: 80, children: [
                    { san: 'Nf6', weight: 80, children: [
                      { san: 'O-O', weight: 90, children: [
                        { san: 'Be7', weight: 70, comment: 'Closed Ruy', children: [
                          { san: 'Re1', weight: 90, children: [
                            { san: 'b5', weight: 95, children: [
                              { san: 'Bb3', weight: 100, children: [
                                { san: 'd6', weight: 90 },
                              ]},
                            ]},
                          ]},
                        ]},
                        { san: 'Nxe4', weight: 30, comment: 'Open Ruy' },
                      ]},
                    ]},
                  ]},
                  { san: 'Bxc6', weight: 20, comment: 'Exchange', children: [
                    { san: 'dxc6', weight: 100, children: [
                      { san: 'O-O', weight: 60 },
                    ]},
                  ]},
                ]},
                { san: 'Nf6', weight: 25, comment: 'Berlin Defence', children: [
                  { san: 'O-O', weight: 90, children: [
                    { san: 'Nxe4', weight: 80, comment: 'Berlin Wall', children: [
                      { san: 'd4', weight: 100 },
                    ]},
                  ]},
                ]},
              ]},
            ]},
          ]},
        ]},
      ],
    }],
  },

  // ====================================================================
  // SCOTCH GAME (white) — drilled from 1.e4 e5 2.Nf3 Nc6 3.d4
  // ====================================================================
  {
    id: 'scotch-white',
    name: 'Scotch Game',
    eco: 'C44',
    forColor: 'w',
    category: 'open',
    description: '1.e4 e5 Nf3 Nc6 d4 — strike the centre on move 3, open the position fast.',
    tree: [{
      san: 'e4', weight: 100, children: [
        { san: 'e5', weight: 70, children: [
          { san: 'Nf3', weight: 100, children: [
            { san: 'Nc6', weight: 80, children: [
              { san: 'd4', weight: 100, children: [
                { san: 'exd4', weight: 90, children: [
                  { san: 'Nxd4', weight: 70, comment: 'Scotch proper', children: [
                    { san: 'Nf6', weight: 60, comment: 'Schmidt Variation', children: [
                      { san: 'Nxc6', weight: 80, children: [
                        { san: 'bxc6', weight: 90, children: [
                          { san: 'e5', weight: 95 },
                        ]},
                      ]},
                    ]},
                    { san: 'Bc5', weight: 30, comment: 'Classical Variation', children: [
                      { san: 'Be3', weight: 90 },
                    ]},
                    { san: 'Qh4', weight: 5, comment: 'Steinitz Variation', children: [
                      { san: 'Nb5', weight: 100 },
                    ]},
                  ]},
                  { san: 'c3', weight: 20, comment: 'Göring Gambit', children: [
                    { san: 'dxc3', weight: 70, children: [
                      { san: 'Nxc3', weight: 100 },
                    ]},
                  ]},
                  { san: 'Bc4', weight: 10, comment: 'Scotch Gambit', children: [
                    { san: 'Bc5', weight: 60 },
                  ]},
                ]},
              ]},
            ]},
          ]},
        ]},
      ],
    }],
  },

  // ====================================================================
  // SICILIAN DEFENCE (black) — opp plays e4, we reply c5
  // ====================================================================
  {
    id: 'sicilian-black',
    name: 'Sicilian Defence',
    eco: 'B20',
    forColor: 'b',
    category: 'semi-open',
    description: 'Asymmetric reply to 1.e4 — most popular weapon at every level. Fights for the centre with c5.',
    tree: [{
      san: 'e4', weight: 100, children: [
        { san: 'c5', weight: 100, children: [
          { san: 'Nf3', weight: 70, children: [
            { san: 'd6', weight: 50, comment: 'Najdorf-bound', children: [
              { san: 'd4', weight: 95, children: [
                { san: 'cxd4', weight: 100, children: [
                  { san: 'Nxd4', weight: 100, children: [
                    { san: 'Nf6', weight: 100, children: [
                      { san: 'Nc3', weight: 95, children: [
                        { san: 'a6', weight: 80, comment: 'Najdorf', children: [
                          { san: 'Be3', weight: 30, comment: 'English Attack' },
                          { san: 'Bg5', weight: 40, comment: 'Main line' },
                          { san: 'Be2', weight: 20 },
                        ]},
                        { san: 'g6', weight: 15, comment: 'Dragon', children: [
                          { san: 'Be3', weight: 80 },
                        ]},
                      ]},
                    ]},
                  ]},
                ]},
              ]},
            ]},
            { san: 'Nc6', weight: 30, children: [
              { san: 'd4', weight: 95, children: [
                { san: 'cxd4', weight: 100, children: [
                  { san: 'Nxd4', weight: 100, children: [
                    { san: 'Nf6', weight: 70 },
                    { san: 'g6', weight: 30, comment: 'Accelerated Dragon' },
                  ]},
                ]},
              ]},
            ]},
            { san: 'e6', weight: 20, comment: 'Taimanov / Kan', children: [
              { san: 'd4', weight: 90, children: [
                { san: 'cxd4', weight: 100, children: [
                  { san: 'Nxd4', weight: 100, children: [
                    { san: 'a6', weight: 50, comment: 'Kan' },
                    { san: 'Nc6', weight: 40, comment: 'Taimanov' },
                  ]},
                ]},
              ]},
            ]},
          ]},
          { san: 'Nc3', weight: 20, comment: 'Closed Sicilian', children: [
            { san: 'Nc6', weight: 60, children: [
              { san: 'g3', weight: 70, children: [
                { san: 'g6', weight: 80 },
              ]},
            ]},
          ]},
        ]},
      ],
    }],
  },

  // ====================================================================
  // FRENCH DEFENCE (black)
  // ====================================================================
  {
    id: 'french-black',
    name: 'French Defence',
    eco: 'C00',
    forColor: 'b',
    category: 'semi-open',
    description: 'Solid 1.e4 e6 followed by ...d5. Locked centre, slow counterplay.',
    tree: [{
      san: 'e4', weight: 100, children: [
        { san: 'e6', weight: 100, children: [
          { san: 'd4', weight: 90, children: [
            { san: 'd5', weight: 100, children: [
              { san: 'Nc3', weight: 40, comment: 'Classical / Winawer', children: [
                { san: 'Bb4', weight: 55, comment: 'Winawer', children: [
                  { san: 'e5', weight: 80, children: [
                    { san: 'c5', weight: 90, children: [
                      { san: 'a3', weight: 90, children: [
                        { san: 'Bxc3+', weight: 100, children: [
                          { san: 'bxc3', weight: 100 },
                        ]},
                      ]},
                    ]},
                  ]},
                ]},
                { san: 'Nf6', weight: 35, comment: 'Classical', children: [
                  { san: 'Bg5', weight: 60, children: [
                    { san: 'Be7', weight: 70 },
                  ]},
                  { san: 'e5', weight: 30, comment: 'Steinitz', children: [
                    { san: 'Nfd7', weight: 90 },
                  ]},
                ]},
              ]},
              { san: 'Nd2', weight: 30, comment: 'Tarrasch', children: [
                { san: 'Nf6', weight: 50, children: [
                  { san: 'e5', weight: 80, children: [
                    { san: 'Nfd7', weight: 90 },
                  ]},
                ]},
                { san: 'c5', weight: 40, children: [
                  { san: 'exd5', weight: 80, children: [
                    { san: 'Qxd5', weight: 70 },
                  ]},
                ]},
              ]},
              { san: 'e5', weight: 20, comment: 'Advance — locks centre', children: [
                { san: 'c5', weight: 90, children: [
                  { san: 'c3', weight: 80, children: [
                    { san: 'Nc6', weight: 95 },
                  ]},
                ]},
              ]},
              { san: 'exd5', weight: 10, comment: 'Exchange', children: [
                { san: 'exd5', weight: 100 },
              ]},
            ]},
          ]},
        ]},
      ],
    }],
  },

  // ====================================================================
  // CARO-KANN DEFENCE (black)
  // ====================================================================
  {
    id: 'carokann-black',
    name: 'Caro-Kann Defence',
    eco: 'B10',
    forColor: 'b',
    category: 'semi-open',
    description: 'Solid 1.e4 c6 prepares ...d5. Less cramped than the French.',
    tree: [{
      san: 'e4', weight: 100, children: [
        { san: 'c6', weight: 100, children: [
          { san: 'd4', weight: 90, children: [
            { san: 'd5', weight: 100, children: [
              { san: 'Nc3', weight: 50, comment: 'Main / Classical', children: [
                { san: 'dxe4', weight: 90, children: [
                  { san: 'Nxe4', weight: 100, children: [
                    { san: 'Bf5', weight: 60, comment: 'Classical', children: [
                      { san: 'Ng3', weight: 90, children: [
                        { san: 'Bg6', weight: 100 },
                      ]},
                    ]},
                    { san: 'Nd7', weight: 30, comment: 'Karpov' },
                    { san: 'Nf6', weight: 10, comment: 'Steinitz' },
                  ]},
                ]},
              ]},
              { san: 'e5', weight: 30, comment: 'Advance', children: [
                { san: 'Bf5', weight: 80, children: [
                  { san: 'Nf3', weight: 50 },
                  { san: 'Nd2', weight: 25 },
                ]},
              ]},
              { san: 'exd5', weight: 20, comment: 'Exchange', children: [
                { san: 'cxd5', weight: 100, children: [
                  { san: 'Bd3', weight: 70 },
                  { san: 'c4', weight: 30, comment: 'Panov Attack', children: [
                    { san: 'Nf6', weight: 95 },
                  ]},
                ]},
              ]},
            ]},
          ]},
        ]},
      ],
    }],
  },

  // ====================================================================
  // QUEEN'S GAMBIT DECLINED (white)
  // ====================================================================
  {
    id: 'qgd-white',
    name: "Queen's Gambit Declined",
    eco: 'D30',
    forColor: 'w',
    category: 'closed',
    description: '1.d4 d5 2.c4 e6 — solid, classical foundation of countless world-championship games.',
    tree: [{
      san: 'd4', weight: 100, children: [
        { san: 'd5', weight: 50, children: [
          { san: 'c4', weight: 100, children: [
            { san: 'e6', weight: 50, comment: 'QGD', children: [
              { san: 'Nc3', weight: 60, children: [
                { san: 'Nf6', weight: 80, children: [
                  { san: 'Bg5', weight: 50, comment: 'Mainline pin', children: [
                    { san: 'Be7', weight: 90, children: [
                      { san: 'e3', weight: 70 },
                    ]},
                  ]},
                  { san: 'cxd5', weight: 30, comment: 'Exchange', children: [
                    { san: 'exd5', weight: 100, children: [
                      { san: 'Bg5', weight: 60 },
                    ]},
                  ]},
                ]},
              ]},
              { san: 'Nf3', weight: 40, children: [
                { san: 'Nf6', weight: 70, children: [
                  { san: 'g3', weight: 50, comment: 'Catalan' },
                ]},
              ]},
            ]},
            { san: 'c6', weight: 30, comment: 'Slav (transposes)', children: [
              { san: 'Nf3', weight: 80 },
            ]},
            { san: 'dxc4', weight: 20, comment: 'QG Accepted', children: [
              { san: 'Nf3', weight: 90, children: [
                { san: 'Nf6', weight: 80 },
              ]},
            ]},
          ]},
        ]},
        { san: 'Nf6', weight: 35, comment: 'Indian defences', children: [
          { san: 'c4', weight: 100 },
        ]},
        { san: 'd6', weight: 5, comment: 'Old Indian', children: [
          { san: 'c4', weight: 100 },
        ]},
      ],
    }],
  },

  // ====================================================================
  // KING'S INDIAN DEFENCE (black)
  // ====================================================================
  {
    id: 'kid-black',
    name: "King's Indian Defence",
    eco: 'E60',
    forColor: 'b',
    category: 'indian',
    description: 'Hypermodern: invite a big white centre, then attack it. 1.d4 Nf6 2.c4 g6.',
    tree: [{
      san: 'd4', weight: 70, children: [
        { san: 'Nf6', weight: 100, children: [
          { san: 'c4', weight: 80, children: [
            { san: 'g6', weight: 100, children: [
              { san: 'Nc3', weight: 80, children: [
                { san: 'Bg7', weight: 100, children: [
                  { san: 'e4', weight: 80, comment: 'Classical centre', children: [
                    { san: 'd6', weight: 100, children: [
                      { san: 'Nf3', weight: 70, comment: 'Classical', children: [
                        { san: 'O-O', weight: 100, children: [
                          { san: 'Be2', weight: 80, children: [
                            { san: 'e5', weight: 80 },
                          ]},
                        ]},
                      ]},
                      { san: 'f3', weight: 25, comment: 'Sämisch', children: [
                        { san: 'O-O', weight: 80 },
                      ]},
                    ]},
                  ]},
                ]},
              ]},
              { san: 'Nf3', weight: 20, children: [
                { san: 'Bg7', weight: 100, children: [
                  { san: 'g3', weight: 50, comment: 'Fianchetto KID' },
                ]},
              ]},
            ]},
          ]},
          { san: 'Nf3', weight: 20, children: [
            { san: 'g6', weight: 100 },
          ]},
        ]},
      ],
      // Against 1.Nf3 transpose intent
    }, {
      san: 'Nf3', weight: 15, children: [
        { san: 'Nf6', weight: 100, children: [
          { san: 'c4', weight: 80, children: [
            { san: 'g6', weight: 100 },
          ]},
        ]},
      ],
    }, {
      san: 'c4', weight: 10, comment: 'English transposing', children: [
        { san: 'Nf6', weight: 100 },
      ],
    }],
  },

  // ====================================================================
  // LONDON SYSTEM (white)
  // ====================================================================
  {
    id: 'london-white',
    name: 'London System',
    eco: 'D02',
    forColor: 'w',
    category: 'closed',
    description: 'Easy to learn 1.d4 system: Bf4, e3, c3, Nbd2 against most defences.',
    tree: [{
      san: 'd4', weight: 100, children: [
        { san: 'd5', weight: 50, children: [
          { san: 'Bf4', weight: 100, children: [
            { san: 'Nf6', weight: 60, children: [
              { san: 'e3', weight: 90, children: [
                { san: 'e6', weight: 50, children: [
                  { san: 'Nf3', weight: 80, children: [
                    { san: 'Bd6', weight: 50 },
                    { san: 'c5', weight: 40 },
                  ]},
                ]},
                { san: 'c5', weight: 35, children: [
                  { san: 'c3', weight: 90 },
                ]},
              ]},
            ]},
            { san: 'c5', weight: 40, children: [
              { san: 'e3', weight: 80, children: [
                { san: 'Nc6', weight: 60 },
              ]},
            ]},
          ]},
        ]},
        { san: 'Nf6', weight: 40, children: [
          { san: 'Bf4', weight: 100, children: [
            { san: 'g6', weight: 50 },
            { san: 'd5', weight: 30 },
          ]},
        ]},
      ],
    }],
  },

  // ====================================================================
  // ENGLISH OPENING (white)
  // ====================================================================
  {
    id: 'english-white',
    name: 'English Opening',
    eco: 'A10',
    forColor: 'w',
    category: 'flank',
    description: '1.c4 — flexible flank approach. Often transposes; great move-order weapon.',
    tree: [{
      san: 'c4', weight: 100, children: [
        { san: 'e5', weight: 30, comment: 'Reversed Sicilian', children: [
          { san: 'Nc3', weight: 90, children: [
            { san: 'Nf6', weight: 80, children: [
              { san: 'Nf3', weight: 70 },
              { san: 'g3', weight: 30 },
            ]},
            { san: 'Nc6', weight: 15 },
          ]},
        ]},
        { san: 'Nf6', weight: 40, children: [
          { san: 'Nc3', weight: 60, children: [
            { san: 'e5', weight: 30 },
            { san: 'g6', weight: 30 },
            { san: 'c5', weight: 30, comment: 'Symmetrical' },
          ]},
          { san: 'Nf3', weight: 35, children: [
            { san: 'g6', weight: 60 },
          ]},
        ]},
        { san: 'c5', weight: 20, comment: 'Symmetrical', children: [
          { san: 'Nf3', weight: 60 },
          { san: 'Nc3', weight: 30 },
        ]},
        { san: 'e6', weight: 10, comment: 'Agincourt', children: [
          { san: 'Nf3', weight: 70 },
        ]},
      ],
    }],
  },

  // ====================================================================
  // SCANDINAVIAN DEFENCE (black)
  // ====================================================================
  {
    id: 'scandinavian-black',
    name: 'Scandinavian Defence',
    eco: 'B01',
    forColor: 'b',
    category: 'semi-open',
    description: '1.e4 d5 — direct centre challenge. Easy to learn, still played by GMs.',
    tree: [{
      san: 'e4', weight: 100, children: [
        { san: 'd5', weight: 100, children: [
          { san: 'exd5', weight: 90, children: [
            { san: 'Qxd5', weight: 70, comment: 'Main line', children: [
              { san: 'Nc3', weight: 100, children: [
                { san: 'Qa5', weight: 70, comment: 'Mieses', children: [
                  { san: 'd4', weight: 80, children: [
                    { san: 'Nf6', weight: 90, children: [
                      { san: 'Nf3', weight: 80, children: [
                        { san: 'c6', weight: 80 },
                      ]},
                    ]},
                  ]},
                ]},
                { san: 'Qd6', weight: 25 },
                { san: 'Qd8', weight: 5 },
              ]},
            ]},
            { san: 'Nf6', weight: 30, comment: 'Modern Variation — gambit', children: [
              { san: 'd4', weight: 60, children: [
                { san: 'Nxd5', weight: 60 },
              ]},
              { san: 'c4', weight: 30 },
            ]},
          ]},
        ]},
      ],
    }],
  },

  // ====================================================================
  // PIRC DEFENCE (black)
  // ====================================================================
  {
    id: 'pirc-black',
    name: 'Pirc Defence',
    eco: 'B07',
    forColor: 'b',
    category: 'semi-open',
    description: '1.e4 d6 with ...g6 / ...Bg7 — hypermodern setup. Black invites a big centre to attack.',
    tree: [{
      san: 'e4', weight: 100, children: [
        { san: 'd6', weight: 100, children: [
          { san: 'd4', weight: 90, children: [
            { san: 'Nf6', weight: 100, children: [
              { san: 'Nc3', weight: 80, children: [
                { san: 'g6', weight: 100, children: [
                  { san: 'Nf3', weight: 50, comment: 'Classical', children: [
                    { san: 'Bg7', weight: 100, children: [
                      { san: 'Be2', weight: 60, children: [
                        { san: 'O-O', weight: 100 },
                      ]},
                      { san: 'h3', weight: 30 },
                    ]},
                  ]},
                  { san: 'f4', weight: 30, comment: 'Austrian Attack', children: [
                    { san: 'Bg7', weight: 100, children: [
                      { san: 'Nf3', weight: 90, children: [
                        { san: 'O-O', weight: 90 },
                      ]},
                    ]},
                  ]},
                  { san: 'Be3', weight: 20, comment: '150 Attack', children: [
                    { san: 'Bg7', weight: 100 },
                  ]},
                ]},
              ]},
            ]},
          ]},
        ]},
      ],
    }],
  },

  // ====================================================================
  // SLAV DEFENCE (black)
  // ====================================================================
  {
    id: 'slav-black',
    name: 'Slav Defence',
    eco: 'D10',
    forColor: 'b',
    category: 'closed',
    description: '1.d4 d5 2.c4 c6 — solid alternative to QGD that keeps the c8 bishop free.',
    tree: [{
      san: 'd4', weight: 100, children: [
        { san: 'd5', weight: 100, children: [
          { san: 'c4', weight: 80, children: [
            { san: 'c6', weight: 100, children: [
              { san: 'Nf3', weight: 60, children: [
                { san: 'Nf6', weight: 90, children: [
                  { san: 'Nc3', weight: 60, children: [
                    { san: 'dxc4', weight: 60, comment: 'Slav accepted', children: [
                      { san: 'a4', weight: 80, children: [
                        { san: 'Bf5', weight: 90 },
                      ]},
                    ]},
                    { san: 'a6', weight: 25, comment: 'Chebanenko' },
                    { san: 'e6', weight: 15, comment: 'Semi-Slav' },
                  ]},
                  { san: 'e3', weight: 25 },
                ]},
              ]},
              { san: 'Nc3', weight: 30, children: [
                { san: 'Nf6', weight: 80, children: [
                  { san: 'Nf3', weight: 80 },
                  { san: 'e3', weight: 15 },
                ]},
              ]},
              { san: 'cxd5', weight: 10, comment: 'Exchange', children: [
                { san: 'cxd5', weight: 100, children: [
                  { san: 'Nc3', weight: 70 },
                ]},
              ]},
            ]},
          ]},
        ]},
      ],
    }],
  },

  // ====================================================================
  // VIENNA GAME (white) — chess.com beginner staple
  // ====================================================================
  {
    id: 'vienna-white',
    name: 'Vienna Game',
    eco: 'C25',
    forColor: 'w',
    category: 'open',
    description: '1.e4 e5 2.Nc3 — flexible knight development, often leads to the King\'s Gambit family.',
    tree: [{
      san: 'e4', weight: 100, children: [
        { san: 'e5', weight: 60, children: [
          { san: 'Nc3', weight: 100, children: [
            { san: 'Nf6', weight: 60, children: [
              { san: 'f4', weight: 50, comment: 'Vienna Gambit', children: [
                { san: 'd5', weight: 80, comment: 'Best — accept the centre', children: [
                  { san: 'fxe5', weight: 90, children: [
                    { san: 'Nxe4', weight: 100, children: [
                      { san: 'Nf3', weight: 60 },
                      { san: 'Qf3', weight: 30 },
                    ]},
                  ]},
                ]},
                { san: 'exf4', weight: 15, comment: 'Risky — falls behind' },
              ]},
              { san: 'Bc4', weight: 30 },
              { san: 'g3', weight: 15 },
            ]},
            { san: 'Nc6', weight: 30, children: [
              { san: 'f4', weight: 50, children: [
                { san: 'exf4', weight: 80 },
              ]},
              { san: 'Bc4', weight: 30, children: [
                { san: 'Bc5', weight: 70 },
              ]},
            ]},
            { san: 'Bc5', weight: 10 },
          ]},
        ]},
        { san: 'c5', weight: 25, comment: 'Sicilian transposes', children: [
          { san: 'Nf3', weight: 100 },
        ]},
      ],
    }],
  },
];

export const OPENINGS: Opening[] = SPECS.map(makeOpening);

export function openingById(id: string): Opening | undefined {
  return OPENINGS.find((o) => o.id === id);
}

/** Walk children picking the heaviest weight at each step until no children. */
export function selectMainLine(node: OpeningNode): OpeningNode[] {
  const acc: OpeningNode[] = [node];
  let cur: OpeningNode = node;
  while (cur.children && cur.children.length > 0) {
    const next = cur.children.reduce<OpeningNode>((best, c) => ((c.weight ?? 0) > (best.weight ?? 0) ? c : best), cur.children[0]!);
    acc.push(next);
    cur = next;
  }
  return acc;
}

// keep the chain helper exported for tests/extensions
export { chain };
