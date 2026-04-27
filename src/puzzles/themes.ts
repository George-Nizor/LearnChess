/*
 * Human-friendly labels and grouping for Lichess puzzle theme slugs.
 *
 * Source vocabulary: github.com/lichess-org/lila/blob/master/translation/source/puzzleTheme.xml
 *
 * Why this lives here and not as a JSON file: the canonical Lichess vocab is
 * a closed set (~70 keys) that changes maybe once a year. A typed object lets
 * us narrow types in the picker UI and lets ESLint flag typos.
 */

export type ThemeGroup = 'tactics' | 'mating' | 'positional' | 'endgame' | 'phase' | 'special';

export interface ThemeMeta {
  label: string;
  group: ThemeGroup;
}

export const THEME_META: Record<string, ThemeMeta> = {
  // Phases
  opening:           { label: 'Opening',            group: 'phase' },
  middlegame:        { label: 'Middlegame',         group: 'phase' },
  endgame:           { label: 'Endgame',            group: 'phase' },

  // Tactical motifs
  fork:              { label: 'Fork',               group: 'tactics' },
  pin:               { label: 'Pin',                group: 'tactics' },
  skewer:            { label: 'Skewer',             group: 'tactics' },
  discoveredAttack:  { label: 'Discovered attack',  group: 'tactics' },
  doubleCheck:       { label: 'Double check',       group: 'tactics' },
  hangingPiece:      { label: 'Hanging piece',      group: 'tactics' },
  trappedPiece:      { label: 'Trapped piece',      group: 'tactics' },
  capturingDefender: { label: 'Capturing defender', group: 'tactics' },
  exposedKing:       { label: 'Exposed king',       group: 'tactics' },
  attackingF2F7:     { label: 'Attacking f2/f7',    group: 'tactics' },
  kingsideAttack:    { label: 'Kingside attack',    group: 'tactics' },
  queensideAttack:   { label: 'Queenside attack',   group: 'tactics' },
  sacrifice:         { label: 'Sacrifice',          group: 'tactics' },
  attraction:        { label: 'Attraction',         group: 'tactics' },
  deflection:        { label: 'Deflection',         group: 'tactics' },
  interference:      { label: 'Interference',       group: 'tactics' },
  intermezzo:        { label: 'Intermezzo (Zwischenzug)', group: 'tactics' },
  clearance:         { label: 'Clearance',          group: 'tactics' },
  defensiveMove:     { label: 'Defensive move',     group: 'tactics' },
  quietMove:         { label: 'Quiet move',         group: 'tactics' },
  zugzwang:          { label: 'Zugzwang',           group: 'tactics' },
  xRayAttack:        { label: 'X-ray attack',       group: 'tactics' },
  advancedPawn:      { label: 'Advanced pawn',      group: 'tactics' },
  collinearMove:     { label: 'Collinear move',     group: 'tactics' },

  // Mating patterns
  mate:              { label: 'Checkmate',          group: 'mating' },
  mateIn1:           { label: 'Mate in 1',          group: 'mating' },
  mateIn2:           { label: 'Mate in 2',          group: 'mating' },
  mateIn3:           { label: 'Mate in 3',          group: 'mating' },
  mateIn4:           { label: 'Mate in 4',          group: 'mating' },
  mateIn5:           { label: 'Mate in 5+',         group: 'mating' },
  anastasiaMate:     { label: "Anastasia's mate",   group: 'mating' },
  arabianMate:       { label: 'Arabian mate',       group: 'mating' },
  backRankMate:      { label: 'Back-rank mate',     group: 'mating' },
  bodenMate:         { label: "Boden's mate",       group: 'mating' },
  cornerMate:        { label: 'Corner mate',        group: 'mating' },
  doubleBishopMate:  { label: 'Double bishop mate', group: 'mating' },
  dovetailMate:      { label: 'Dovetail mate',      group: 'mating' },
  hookMate:          { label: 'Hook mate',          group: 'mating' },
  killBoxMate:       { label: 'Kill-box mate',      group: 'mating' },
  smotheredMate:     { label: 'Smothered mate',     group: 'mating' },
  vukovicMate:       { label: 'Vukovic mate',       group: 'mating' },
  pillsburysMate:    { label: "Pillsbury's mate",   group: 'mating' },
  morphysMate:       { label: "Morphy's mate",      group: 'mating' },
  operaMate:         { label: 'Opera mate',         group: 'mating' },
  swallowstailMate:  { label: 'Swallowtail mate',   group: 'mating' },
  triangleMate:      { label: 'Triangle mate',      group: 'mating' },
  blindSwineMate:    { label: 'Blind-swine mate',   group: 'mating' },
  balestraMate:      { label: 'Balestra mate',      group: 'mating' },

  // Endgame types
  rookEndgame:       { label: 'Rook endgame',       group: 'endgame' },
  pawnEndgame:       { label: 'Pawn endgame',       group: 'endgame' },
  bishopEndgame:     { label: 'Bishop endgame',     group: 'endgame' },
  knightEndgame:     { label: 'Knight endgame',     group: 'endgame' },
  queenEndgame:      { label: 'Queen endgame',      group: 'endgame' },
  queenRookEndgame:  { label: 'Queen + rook endgame', group: 'endgame' },

  // Positional / outcome
  equality:          { label: 'Equality',           group: 'positional' },
  advantage:         { label: 'Advantage',          group: 'positional' },
  crushing:          { label: 'Crushing',           group: 'positional' },
  short:             { label: 'Short (≤ 3 moves)',  group: 'positional' },
  long:              { label: 'Long (≥ 4 moves)',   group: 'positional' },
  veryLong:          { label: 'Very long (≥ 6 moves)', group: 'positional' },
  oneMove:           { label: 'One-mover',          group: 'positional' },

  // Special moves
  castling:          { label: 'Castling',           group: 'special' },
  enPassant:         { label: 'En passant',         group: 'special' },
  promotion:         { label: 'Promotion',          group: 'special' },
  underPromotion:    { label: 'Underpromotion',     group: 'special' },
  discoveredCheck:   { label: 'Discovered check',   group: 'special' },

  // Origin
  master:            { label: 'Master game',        group: 'special' },
  masterVsMaster:    { label: 'Master vs master',   group: 'special' },
  superGM:           { label: 'Super-GM',           group: 'special' },
};

export const GROUP_LABELS: Record<ThemeGroup, string> = {
  tactics:    'Tactical motifs',
  mating:     'Checkmate patterns',
  positional: 'Outcome / length',
  endgame:    'Endgame piece set',
  phase:      'Game phase',
  special:    'Special',
};

export function labelFor(slug: string): string {
  return THEME_META[slug]?.label ?? slug;
}

export function groupFor(slug: string): ThemeGroup {
  return THEME_META[slug]?.group ?? 'special';
}

/** Group an array of theme slugs by their meta group, preserving input order within each group. */
export function groupThemes(slugs: readonly string[]): Map<ThemeGroup, string[]> {
  const out = new Map<ThemeGroup, string[]>();
  for (const slug of slugs) {
    const g = groupFor(slug);
    const arr = out.get(g) ?? [];
    arr.push(slug);
    out.set(g, arr);
  }
  return out;
}
