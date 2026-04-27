/*
 * MiniBoardPreview — a static, dependency-free chess-board thumbnail used
 * by the Settings page to show what each board theme + piece set combo
 * looks like before the user commits to it.
 *
 * Why NOT a real chessground instance: the chessground board CSS targets the
 * <cg-board> element globally (via tag selector, not a scoped class). Mounting
 * 12+ chessground instances on Settings just to swap colors per card would
 * (a) require injecting per-card <link> tags whose rules clash on the same
 * element, and (b) cost a few MB of JS init for thumbnails. A static 8x8 CSS
 * grid with piece <img>s gives an identical visual at 1/100 the cost.
 *
 * The theme palettes mirror the colors in `public/board-themes/<id>.css` so
 * the preview accurately predicts what the live board will look like.
 *
 * Position: an Italian Game line at 5-ply (FEN below) chosen because it
 * shows every piece type for both colors, plus a small pawn structure.
 */
import type { ReactNode } from 'react';
import type { BoardThemeId } from '@/state/boardTheme';
import type { PieceSetId } from '@/state/pieceSet';

interface MiniBoardPreviewProps {
  /** Board palette to render. Defaults to brown if omitted. */
  boardTheme?: BoardThemeId;
  /** Piece set to render pieces from. Defaults to cburnett if omitted. */
  pieceSet?: PieceSetId;
  /** Pixel size of the square preview. Defaults to 160. */
  size?: number;
  /** Optional className to forward to the outer wrapper. */
  className?: string;
}

interface ThemePalette {
  light: string;
  dark: string;
}

// Mirrors the palettes in /public/board-themes/<id>.css. Kept in sync by
// hand — these CSS files are vendored from chessground and rarely change.
const PALETTES: Record<BoardThemeId, ThemePalette> = {
  brown: { light: '#f0d9b5', dark: '#b58863' },
  blue:  { light: '#dee3e6', dark: '#8ca2ad' },
  green: { light: '#ffffdd', dark: '#86a666' },
  wood:  { light: '#d8b887', dark: '#7a5230' },
  ic:    { light: '#ececec', dark: '#c1c18e' },
};

// Italian Game, 5-ply: 1.e4 e5 2.Nf3 Nc6 3.Bc4. Shows P/N/B/R/Q/K for both
// sides and a non-trivial pawn structure.
type PieceCode = 'wK' | 'wQ' | 'wR' | 'wB' | 'wN' | 'wP'
               | 'bK' | 'bQ' | 'bR' | 'bB' | 'bN' | 'bP';

// 8x8 grid in board orientation (rank 8 first → rank 1 last); '' = empty.
const POSITION: ReadonlyArray<ReadonlyArray<PieceCode | ''>> = [
  ['bR', 'bN', 'bB', 'bQ', 'bK', 'bB', '',   'bR'],
  ['bP', 'bP', 'bP', 'bP', '',   'bP', 'bP', 'bP'],
  ['',   '',   'bN', '',   '',   '',   '',   ''  ],
  ['',   '',   '',   '',   'bP', '',   '',   ''  ],
  ['',   '',   'wB', '',   'wP', '',   '',   ''  ],
  ['',   '',   '',   '',   '',   'wN', '',   ''  ],
  ['wP', 'wP', 'wP', 'wP', '',   'wP', 'wP', 'wP'],
  ['wR', 'wN', 'wB', 'wQ', 'wK', '',   '',   'wR'],
];

function pieceUrl(set: PieceSetId, code: PieceCode): string {
  return `/piece-sets/${set}/${code}.svg`;
}

export function MiniBoardPreview({
  boardTheme = 'brown',
  pieceSet = 'cburnett',
  size = 160,
  className,
}: MiniBoardPreviewProps): ReactNode {
  const { light, dark } = PALETTES[boardTheme];

  return (
    <div
      className={`relative overflow-hidden rounded-sm ring-1 ring-black/10 ${className ?? ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: 'repeat(8, 1fr)',
          gridTemplateRows: 'repeat(8, 1fr)',
        }}
      >
        {POSITION.flatMap((row, rIdx) =>
          row.map((piece, fIdx) => {
            // Standard chess coloring: a1 (rank 1, file a) is dark.
            // rIdx 0 = rank 8, rIdx 7 = rank 1 ⇒ rank = 8 - rIdx.
            // file = fIdx + 1 (a=1). Square is light when (rank + file) is even.
            const rank = 8 - rIdx;
            const file = fIdx + 1;
            const isLight = (rank + file) % 2 === 0;
            return (
              <div
                key={`${rIdx}-${fIdx}`}
                style={{ backgroundColor: isLight ? light : dark }}
                className="relative"
              >
                {piece && (
                  <img
                    src={pieceUrl(pieceSet, piece)}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute inset-0 h-full w-full select-none"
                    onError={(e) => {
                      // Graceful fallback: if a vendored piece is missing,
                      // hide the broken image rather than show a 404 icon.
                      e.currentTarget.style.visibility = 'hidden';
                    }}
                  />
                )}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
