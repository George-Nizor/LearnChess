/*
 * LearnChess logo — a literal rook silhouette in the foreground colour. No
 * tile, no accent, no "brand mark" gimmickry. The user has now asked three
 * times for "just a standard chess piece like the king or rook" — so this
 * is exactly that, drawn as a single connected fill so the silhouette holds
 * together at favicon sizes.
 *
 * Why a rook rather than a knight or king:
 *   - The rook reads as "chess" instantly even at 16px (battlements + plinth)
 *   - It's the most architecturally distinctive silhouette — no other piece
 *     has the crenellated top
 *   - Symmetric → looks intentional next to wordmark text
 *
 * Sizing: pass `size` in CSS px. The viewBox is fixed (32×32) and everything
 * scales together. Default 28 reads as a comfortable inline glyph beside
 * 16-18px brand text.
 */
interface LogoProps {
  size?: number;
  className?: string;
  'aria-label'?: string;
  /** Render decorative-only? Defaults to false (uses role="img"). */
  decorative?: boolean;
}

export function Logo({
  size = 28,
  className,
  'aria-label': ariaLabel = 'LearnChess',
  decorative = false,
}: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...(decorative
        ? { 'aria-hidden': true, focusable: false }
        : { role: 'img', 'aria-label': ariaLabel })}
    >
      {/* Rook silhouette — battlements + neck + body + plinth, drawn as a
          single path so it stays connected at any size. Uses currentColor so
          the surrounding text colour controls it (light theme = ink, dark
          theme = paper). */}
      <path
        d="
          M 7 5
          L 11 5
          L 11 7.5
          L 13.5 7.5
          L 13.5 5
          L 18.5 5
          L 18.5 7.5
          L 21 7.5
          L 21 5
          L 25 5
          L 25 10
          L 23 12
          L 23 21
          L 25 23
          L 25 27
          L 7 27
          L 7 23
          L 9 21
          L 9 12
          L 7 10
          Z
        "
      />
    </svg>
  );
}
