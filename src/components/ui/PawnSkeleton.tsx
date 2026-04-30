/*
 * PawnSkeleton — minimal pawns-only board diagram.
 *
 * Many opening ideas are PAWN ideas: the Hedgehog, the IQP, the
 * Maroczy Bind, opposite-side castling pawn races, the locked-French
 * centre. Showing the full board with all pieces forces the user to
 * mentally filter out everything except the pawns. A 144x144 px
 * diagram showing only the pawns compresses three sentences of
 * structural prose into one glance.
 *
 * Spaced-repetition rationale (per cognitive-load research): pictures
 * are processed in parallel to text, giving the brain TWO encoding
 * paths for the same idea. Concepts encoded both visually and verbally
 * are recalled ~30% better at 1-week retention. The pawn skeleton
 * specifically exploits this dual-coding effect for structural
 * concepts that are hard to express in prose.
 *
 * Implementation: parse the placement field of the FEN, render an
 * 8x8 CSS grid with the same palette as the active board theme, and
 * draw a unicode pawn glyph at each pawn square (♙ for white, ♟ for
 * black). No chessground - this is a static lightweight diagram and
 * mounting a full chessground for 5 KB of pawns is overkill.
 */

import { useMemo } from 'react';
import { useBoardTheme, type BoardThemeId } from '@/state/boardTheme';

interface PawnSkeletonProps {
  /** Full FEN or just the placement portion (everything before the first space). */
  fen: string;
  /** Pixel size of the square diagram. Defaults to 144 (matches a 18px square × 8). */
  size?: number;
  /** Orientation - 'white' = white at bottom (default), 'black' = mirrored. */
  orientation?: 'white' | 'black';
  /** Optional className for layout integration. */
  className?: string;
  /** Optional accessible label; defaults to "Pawn structure". */
  'aria-label'?: string;
}

interface PalettePair {
  light: string;
  dark: string;
}

// Same palette table as MiniBoardPreview - kept in sync with
// /public/board-themes/<id>.css. Pawn skeletons should match the
// active board theme so they read as "the same board, just stripped
// down".
const PALETTES: Record<BoardThemeId, PalettePair> = {
  brown: { light: '#f0d9b5', dark: '#b58863' },
  blue:  { light: '#dee3e6', dark: '#8ca2ad' },
  green: { light: '#ffffdd', dark: '#86a666' },
  wood:  { light: '#d8b887', dark: '#7a5230' },
  ic:    { light: '#ececec', dark: '#c1c18e' },
};

/** Parse the placement portion of a FEN into an 8x8 char grid. Empty squares = ''. */
function parsePlacement(fen: string): string[][] {
  const placement = fen.split(' ')[0] ?? fen;
  const ranks = placement.split('/');
  const grid: string[][] = [];
  for (const rank of ranks) {
    const row: string[] = [];
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) row.push('');
      } else {
        row.push(ch);
      }
    }
    // Defensive: pad/truncate to 8 in case of malformed input
    while (row.length < 8) row.push('');
    grid.push(row.slice(0, 8));
  }
  while (grid.length < 8) grid.push(['', '', '', '', '', '', '', '']);
  return grid.slice(0, 8);
}

export function PawnSkeleton({
  fen,
  size = 144,
  orientation = 'white',
  className,
  'aria-label': ariaLabel = 'Pawn structure',
}: PawnSkeletonProps) {
  const theme = useBoardTheme((s) => s.theme);
  const palette = PALETTES[theme];

  // Parse FEN once per render. The grid is rank-8-first by FEN
  // convention; we'll iterate it directly for white-orientation, and
  // reverse it for black-orientation.
  const grid = useMemo(() => parsePlacement(fen), [fen]);

  const oriented = orientation === 'white' ? grid : [...grid].reverse().map((r) => [...r].reverse());

  const sq = size / 8;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{
        width: size,
        height: size,
        display: 'grid',
        gridTemplateColumns: `repeat(8, ${sq}px)`,
        gridTemplateRows: `repeat(8, ${sq}px)`,
        borderRadius: 4,
        overflow: 'hidden',
        boxShadow: '0 0 0 1px var(--color-border-strong)',
      }}
    >
      {oriented.flatMap((row, rankIdx) =>
        row.map((piece, fileIdx) => {
          // FEN starts with rank 8 in row 0. White orientation:
          //   row 0 = rank 8, row 7 = rank 1
          // Square colour: a1 (rank 1, file a) is dark. With white
          // orientation a1 is bottom-left (row 7, col 0).
          const fileForColor = orientation === 'white' ? fileIdx : 7 - fileIdx;
          const rankForColor = orientation === 'white' ? 7 - rankIdx : rankIdx;
          const isLight = (fileForColor + rankForColor) % 2 === 1;
          const bg = isLight ? palette.light : palette.dark;

          // Only render PAWNS - that's the whole point of this component.
          // Other pieces are intentionally omitted.
          const pawnGlyph =
            piece === 'P' ? '♙' :
            piece === 'p' ? '♟' :
            null;

          return (
            <div
              key={`${rankIdx}-${fileIdx}`}
              style={{
                background: bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: sq * 0.85,
                lineHeight: 1,
                // White pawn glyph: render filled black so it reads
                // on light squares. Black pawn glyph: render in deep
                // ink. Both look distinct against either palette.
                color: piece === 'P' ? '#fafaf7' : '#1a1a1a',
                textShadow: piece === 'P'
                  ? '0 0 1px #1a1a1a, 0 0 1px #1a1a1a'  // outline so white pawn reads on light squares
                  : 'none',
                userSelect: 'none',
              }}
            >
              {pawnGlyph}
            </div>
          );
        }),
      )}
    </div>
  );
}
