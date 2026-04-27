/*
 * LearnChess logo — a stylised knight silhouette inside a rounded square that
 * evokes a chessboard tile. The knight is drawn in the theme accent colour;
 * the tile uses muted/border so the shape reads on both themes without two
 * separate SVGs.
 *
 * Why a knight: it's the most distinctive chess piece in silhouette (every
 * other piece reads as "blob with a topper" at 32px). The angular L-shape
 * also doubles as a subtle wordmark — knight = "learning to think two moves
 * ahead". Distinctive at 32px, recognisable down to 16px (favicon).
 *
 * Sizing: pass `size` in CSS px. The viewBox is fixed (32×32) and everything
 * scales together. We expose three preset sizes via the API contract (32 /
 * 48 / 64) but any positive number works.
 */
interface LogoProps {
  size?: number;
  className?: string;
  'aria-label'?: string;
  /** Render decorative-only? Defaults to false (uses role="img"). */
  decorative?: boolean;
}

export function Logo({
  size = 32,
  className,
  'aria-label': ariaLabel = 'LearnChess',
  decorative = false,
}: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...(decorative
        ? { 'aria-hidden': true, focusable: false }
        : { role: 'img', 'aria-label': ariaLabel })}
    >
      {/* Tile — board-square evoking rounded rect, uses muted token so it
          reads in both themes. The 1.5px border picks up the theme border. */}
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="6.5"
        fill="var(--color-muted)"
        stroke="var(--color-border-strong)"
        strokeWidth="1.25"
      />

      {/* Knight silhouette — hand-tuned path. The negative-space "eye" reads
          even at 16px. Filled with the accent colour so the brand identity
          comes from the highlight, not the wrapper. */}
      <path
        d="
          M 11.2 23.8
          L 21.6 23.8
          C 21.95 23.8 22.2 23.55 22.2 23.2
          L 22.2 22.2
          C 22.2 18.0 21.0 14.6 18.6 12.0
          C 19.55 11.55 20.1 11.0 20.4 10.3
          C 20.6 9.85 20.55 9.45 20.25 9.05
          L 19.6 8.2
          C 19.4 7.95 19.05 7.95 18.85 8.2
          L 18.0 9.25
          L 17.0 8.4
          C 15.5 7.15 13.6 7.0 11.95 8.0
          C 10.0 9.15 8.6 11.05 8.05 13.45
          L 7.7 15.1
          C 7.6 15.55 7.85 16.0 8.3 16.05
          L 9.55 16.2
          L 10.5 14.4
          C 10.7 14.05 11.15 13.95 11.5 14.15
          C 11.85 14.35 11.95 14.8 11.75 15.15
          L 10.6 17.25
          C 9.5 19.25 9.15 21.55 9.6 23.2
          C 9.7 23.55 10.0 23.8 10.35 23.8
          Z
        "
        fill="var(--color-accent)"
      />

      {/* Knight's eye — small punched hole. Uses the tile fill so it tracks
          the theme. */}
      <circle cx="17.4" cy="11.0" r="0.85" fill="var(--color-muted)" />

      {/* Base plinth — a thin bar under the knight grounds the silhouette
          and reads as the board edge. */}
      <rect
        x="9.0"
        y="24.5"
        width="14"
        height="2.0"
        rx="0.6"
        fill="var(--color-accent)"
        opacity="0.85"
      />
    </svg>
  );
}
