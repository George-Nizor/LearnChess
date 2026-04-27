/*
 * Curated practical endgames. Each position is hand-picked for instructional
 * value. The `goal` field is what the player must achieve from this side; the
 * tablebase grades whether the played continuation matches optimal play.
 *
 * All positions are <= 7 pieces so they fall within Syzygy 7-man coverage.
 * `expected.category` is the tablebase verdict for the side to move.
 */

export type EndgameGoal = 'win' | 'draw';

export interface EndgamePosition {
  id: string;
  name: string;
  fen: string;
  side: 'w' | 'b';
  goal: EndgameGoal;
  category: 'pawn' | 'rook' | 'minor' | 'queen' | 'misc';
  description: string;
}

export const ENDGAMES: EndgamePosition[] = [
  // K + P vs K — winning
  {
    id: 'kpk-001',
    name: 'King and Pawn vs King — winning the opposition',
    fen: '8/8/8/4k3/8/3K4/3P4/8 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'pawn',
    description: 'White wins by taking the opposition and shouldering the king away. Push the pawn only when the king has secured the queening square.',
  },
  {
    id: 'kpk-002',
    name: 'King and Pawn vs King — drawn, wrong opposition',
    fen: '8/8/8/3k4/8/3K4/3P4/8 b - - 0 1',
    side: 'b',
    goal: 'draw',
    category: 'pawn',
    description: 'Black to move holds the draw by keeping the opposition.',
  },

  // Lucena & Philidor — rook endgames
  {
    id: 'lucena',
    name: 'Lucena Position — building the bridge',
    fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'rook',
    description: 'Classic Lucena. White wins by checking on the third rank, then sliding the rook over to shield the king from checks while it escapes the queening square.',
  },
  {
    id: 'philidor',
    name: 'Philidor Position — third-rank defence',
    fen: '5k2/8/4K3/4P3/r7/8/8/3R4 b - - 0 1',
    side: 'b',
    goal: 'draw',
    category: 'rook',
    description: 'Black draws by keeping the rook on the third rank until the pawn advances; then drops to the back rank and checks the king from behind.',
  },

  // Q vs P endgames
  {
    id: 'qvp-rook-pawn',
    name: 'Queen vs rook pawn on 7th — drawn',
    fen: '8/8/8/8/1k6/8/p7/2K3Q1 w - - 0 1',
    side: 'w',
    goal: 'draw',
    category: 'queen',
    description: 'Rook-pawn (a/h-file) on 7th saves a draw against a queen if the strong king is far enough — stalemate trap.',
  },
  {
    id: 'qvp-central',
    name: 'Queen vs central pawn on 7th — winning',
    fen: '8/8/8/8/1k6/8/3p4/3K2Q1 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'queen',
    description: 'Central pawn on 7th is winning. Push the king closer one tempo at a time using checks to force the defending king in front of the pawn.',
  },

  // K + Q vs K
  {
    id: 'kqk-001',
    name: 'King and Queen vs King — basic mate',
    fen: '8/8/8/4k3/8/8/4K3/4Q3 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'queen',
    description: 'Drive the lone king to the edge with the knight-move queen technique, never letting it move to the centre.',
  },

  // K + R vs K
  {
    id: 'krk-001',
    name: 'King and Rook vs King — box and ladder',
    fen: '8/8/8/4k3/8/8/4K3/4R3 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'rook',
    description: 'Use the rook to build a box that shrinks each move, supported by the king.',
  },

  // K + 2B vs K
  {
    id: 'k2bk-001',
    name: 'King and Two Bishops vs King',
    fen: '8/8/8/4k3/8/8/4K3/3BB3 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'minor',
    description: 'Drive to a corner of the colour the bishops control. Slow but always winning.',
  },

  // Wrong-rook-pawn-and-bishop draw
  {
    id: 'wrong-bishop',
    name: 'Wrong bishop and rook pawn — drawn',
    fen: '7k/8/8/8/8/8/P7/4KB2 w - - 0 1',
    side: 'w',
    goal: 'draw',
    category: 'minor',
    description: 'Light-squared bishop with an a-pawn that promotes on a dark square — black draws by reaching the corner.',
  },

  // Opposite-coloured bishops
  {
    id: 'ocb-fortress',
    name: 'Opposite-coloured bishops — fortress draw',
    fen: '8/8/3k4/3P4/3K4/3B4/8/4b3 b - - 0 1',
    side: 'b',
    goal: 'draw',
    category: 'minor',
    description: 'Opposite-coloured bishops are notoriously drawish even down a pawn or two. Black blockades on the dark squares.',
  },

  // Rook + pawn vs rook — short side defence
  {
    id: 'rp-short-side',
    name: 'Rook and pawn vs rook — short-side defence',
    fen: '5rk1/8/8/8/8/4P3/4K3/3R4 b - - 0 1',
    side: 'b',
    goal: 'draw',
    category: 'rook',
    description: 'Defend from the long side; use the rook to harass the white king from the side it does not have.',
  },

  // Knight vs Pawn — Réti-style draws
  {
    id: 'reti',
    name: 'Réti study — diagonal kingmarch',
    fen: '7K/8/k1P5/7p/8/8/8/8 w - - 0 1',
    side: 'w',
    goal: 'draw',
    category: 'pawn',
    description: 'White draws by marching the king on a diagonal that simultaneously chases the black pawn and supports the c-pawn.',
  },

  // K + N + P vs K — winning if pawn isn't a/h
  {
    id: 'knp-vs-k',
    name: 'Knight + pawn vs lone king',
    fen: '8/8/8/3k4/8/4N3/4P3/4K3 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'minor',
    description: 'Push the pawn supported by the knight; trade the knight for any black resource if needed.',
  },

  // K + B + P vs K — wrong colour bishop
  {
    id: 'kbp-wrong-colour',
    name: 'Bishop + rook-pawn — wrong colour bishop',
    fen: '7k/8/8/8/8/8/P7/4KB2 b - - 0 1',
    side: 'b',
    goal: 'draw',
    category: 'minor',
    description: 'When the bishop does not control the queening square of a rook-pawn, the lone king draws by reaching the corner.',
  },

  // Stalemate trick — Q vs Q endgame
  {
    id: 'qq-stalemate',
    name: 'Queen vs queen — stalemate trap',
    fen: '7k/5K1Q/8/8/8/8/8/q7 b - - 0 1',
    side: 'b',
    goal: 'draw',
    category: 'queen',
    description: 'Black is in deep trouble but can sometimes wriggle out with a stalemate. Look for it.',
  },

  // K+P vs K+P — pawn race
  {
    id: 'pawn-race',
    name: 'Pawn race — counting tempo',
    fen: '8/p7/8/8/8/8/7P/k6K w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'pawn',
    description: 'Both sides race a passed pawn. Count tempi precisely.',
  },

  // K+R vs K+P
  {
    id: 'kr-vs-kp',
    name: 'Rook vs pawn — stop and capture',
    fen: '8/8/8/4k3/4p3/8/8/3RK3 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'rook',
    description: 'Win by cutting off the king and capturing the pawn before promotion.',
  },

  // K+B vs K+P drawing technique
  {
    id: 'kb-vs-kp',
    name: 'Bishop sacrifice for the pawn — draw',
    fen: '8/8/2k5/2p5/8/8/8/2KB4 b - - 0 1',
    side: 'b',
    goal: 'draw',
    category: 'minor',
    description: 'Black can hold by trading the bishop for the pawn — KB+K alone is a draw.',
  },

  // King and minor pieces — N+B mate (the famous one)
  {
    id: 'nbk-mate',
    name: 'Knight + Bishop vs King — corner of bishop colour',
    fen: '8/8/8/4k3/8/8/4K3/B6N w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'minor',
    description: 'The infamous N+B mate. Drive the king to a corner of the bishop\'s colour. Use the W-manoeuvre.',
  },

  // Triangulation
  {
    id: 'triangulation',
    name: 'Triangulation — pawn endgame zugzwang',
    fen: '8/8/4k3/8/3PK3/8/8/8 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'pawn',
    description: 'Use king triangulation to lose a tempo and force black into zugzwang.',
  },

  // Trebuchet
  {
    id: 'trebuchet',
    name: 'Trebuchet — mutual zugzwang',
    fen: '8/8/4k3/4p3/4P3/4K3/8/8 w - - 0 1',
    side: 'w',
    goal: 'draw',
    category: 'pawn',
    description: 'Mutual zugzwang: whoever moves first loses material.',
  },

  // KQK vs lone king starting from the centre
  {
    id: 'kqk-edge',
    name: 'King and Queen — drive to the edge',
    fen: '8/8/3k4/8/8/3K4/3Q4/8 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'queen',
    description: 'Use queen + king cooperation, never giving the king a flight square through the centre.',
  },

  // Outflanking
  {
    id: 'outflank',
    name: 'King and Pawn — outflanking',
    fen: '8/8/8/3k4/8/3P4/3K4/8 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'pawn',
    description: 'White outflanks by moving the king diagonally to seize the opposition.',
  },

  // R + 2P vs R
  {
    id: 'rpp-vs-r',
    name: 'Rook and connected passers vs rook',
    fen: '8/8/8/4k3/8/3PP3/8/2K1R3 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'rook',
    description: 'Connected passed pawns plus rook against rook is a routine win — keep them coordinated.',
  },

  // KQ vs KR — Philidor
  {
    id: 'kq-vs-kr',
    name: 'Queen vs Rook — Philidor’s position',
    fen: '8/8/8/8/4k3/8/4r3/4K2Q w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'queen',
    description: 'Queen wins against rook by gradually forcing zugzwangs near the king. Slow but sure.',
  },

  // KQ vs KP — beware stalemate
  {
    id: 'kq-vs-kp-bishop-pawn',
    name: 'Queen vs bishop pawn on 7th — winning',
    fen: '8/8/8/8/1k6/8/2p5/2K3Q1 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'queen',
    description: 'Bishop pawn (c/f) on 7th is winning, but watch for the stalemate trick.',
  },

  // Stamma's mate-like coordination
  {
    id: 'kbn-corner',
    name: 'Bishop + Knight — herding to the right corner',
    fen: '4k3/8/8/8/8/8/4K3/4BN2 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'minor',
    description: 'The W-manoeuvre with the knight is the only way to deny the king the wrong corner.',
  },

  // Distant opposition
  {
    id: 'distant-opposition',
    name: 'Distant opposition — winning a pawn endgame',
    fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'pawn',
    description: 'Take the distant opposition first, then advance — the e-pawn promotes.',
  },

  // K + B + P vs K — right colour bishop
  {
    id: 'kbp-right-colour',
    name: 'Bishop + pawn — right colour bishop',
    fen: '8/8/8/4k3/8/3P4/4K3/4B3 w - - 0 1',
    side: 'w',
    goal: 'win',
    category: 'minor',
    description: 'Right-coloured bishop supports the pawn’s promotion square — clean win.',
  },
];

export function endgameById(id: string): EndgamePosition | undefined {
  return ENDGAMES.find((p) => p.id === id);
}
