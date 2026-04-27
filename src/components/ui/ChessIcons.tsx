/*
 * ChessIcons — minimal, single-colour SVG icons used across LearnChess.
 *
 * Conventions (mirroring Logo.tsx):
 *   - 24×24 viewBox (matches lucide / heroicons grid)
 *   - currentColor for stroke + fill so icons inherit the text colour
 *   - 1.6 stroke-width tuned for 16–24px rendering
 *   - decorative by default (aria-hidden); labels next to the icon stay
 *     the accessible name
 *
 * Why hand-crafted: the brief calls for "minimal style as Logo.tsx". Lucide
 * has no quality rooks/knights/pawns, so the chess-piece icons are bespoke.
 * The mode icons (Learn/Drill/Explore/Test) and result symbols (Check / Cross
 * / Hint / Star / Flag) are also bespoke for visual consistency — one icon
 * set with one drawing style is worth more than mixing libraries for the
 * sake of saving a few stroked paths.
 */
import type { ReactNode } from 'react';

export interface ChessIconProps {
  size?: number;
  className?: string;
  /** Override the default decorative-only behaviour (adds role="img" + label). */
  'aria-label'?: string;
}

interface SvgWrapperProps extends ChessIconProps {
  children: ReactNode;
}

/**
 * Shared SVG shell. Uses an explicit conditional spread so we don't pass
 * `aria-label: undefined` under `exactOptionalPropertyTypes: true`.
 */
function SvgShell({ size = 18, className, 'aria-label': ariaLabel, children }: SvgWrapperProps) {
  const a11y = ariaLabel
    ? ({ role: 'img' as const, 'aria-label': ariaLabel })
    : ({ 'aria-hidden': true as const, focusable: false as const });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...a11y}
    >
      {children}
    </svg>
  );
}

// ── Mode icons ──────────────────────────────────────────────────────────

/** Learn — open book. */
export function LearnIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M3 5.5C3 4.67 3.67 4 4.5 4H10c1.1 0 2 .9 2 2v13" />
      <path d="M21 5.5C21 4.67 20.33 4 19.5 4H14c-1.1 0-2 .9-2 2v13" />
      <path d="M3 5.5v13.5h7c.55 0 1 .45 1 1" />
      <path d="M21 5.5v13.5h-7c-.55 0-1 .45-1 1" />
    </SvgShell>
  );
}

/** Drill — target / bullseye. */
export function DrillIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </SvgShell>
  );
}

/** Explore — compass. */
export function ExploreIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2.1 5.4-5.4 2.1 2.1-5.4z" fill="currentColor" stroke="none" />
    </SvgShell>
  );
}

/** Test — clipboard with check. */
export function TestIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4v-1h6v1" />
      <path d="M9 13l2 2 4-4" />
    </SvgShell>
  );
}

/**
 * Puzzles — concentric target. Used on the Openings detail page's
 * Puzzles tab where users find tactics drawn from games of the
 * opening they're studying. Reads as "aim / find the move" without
 * looking like a sniper sight (no crosshair lines).
 */
export function PuzzlesIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </SvgShell>
  );
}

// ── Chess piece icons (single-colour silhouettes, hand-tuned) ───────────

/** Pawn — ball + body + base. */
export function PawnIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <circle cx="12" cy="6.5" r="2.4" fill="currentColor" stroke="none" />
      <path d="M9.6 10.5h4.8c.4 0 .7.3.7.7 0 .4-.3.7-.7.7H9.6c-.4 0-.7-.3-.7-.7 0-.4.3-.7.7-.7z" fill="currentColor" stroke="none" />
      <path d="M10 12.4l-1.6 5.6h7.2L14 12.4z" fill="currentColor" stroke="none" />
      <rect x="6.5" y="18" width="11" height="2" rx="0.5" fill="currentColor" stroke="none" />
    </SvgShell>
  );
}

/** Rook — castle silhouette. */
export function RookIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M6 4v3h2V5h2v2h4V5h2v2h2V4z" fill="currentColor" stroke="none" />
      <path d="M7 7l-.7 1.4h11.4L17 7z" fill="currentColor" stroke="none" />
      <rect x="7.5" y="9" width="9" height="8" fill="currentColor" stroke="none" />
      <path d="M6 18l1-1h10l1 1z" fill="currentColor" stroke="none" />
      <rect x="5.5" y="18.5" width="13" height="2" rx="0.4" fill="currentColor" stroke="none" />
    </SvgShell>
  );
}

/** Knight — L-shaped horse head. */
export function KnightIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M9 5c4 .4 6.6 3 6.4 11H6c0-3.6 4-2.6 3.2-8.4
               c-.4 1.2-1.6 1.8-2.4 1.4-.6-.3-.4-1.4 0-2 .6-1 2.6-3.5 2.6-3.5
               s.7-.7.8-1.3c.2-.4.6-.6 1-.6.4 0 .8.3.8.7" fill="currentColor" stroke="none" />
      <circle cx="8.4" cy="8" r="0.55" fill="#fff" />
      <rect x="5" y="16.5" width="11.4" height="2" rx="0.4" fill="currentColor" stroke="none" />
    </SvgShell>
  );
}

/** Bishop — mitre + body. */
export function BishopIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <circle cx="12" cy="4.5" r="1.3" fill="currentColor" stroke="none" />
      <path d="M12 6c-2.6 0-4.8 3-4.8 6.6 0 2 1 3.4 2 4.4h5.6c1-1 2-2.4 2-4.4C16.8 9 14.6 6 12 6z" fill="currentColor" stroke="none" />
      <path d="M10 11.5h4" stroke="#fff" strokeWidth={1.1} />
      <rect x="7" y="17" width="10" height="2" rx="0.4" fill="currentColor" stroke="none" />
      <rect x="6" y="19.4" width="12" height="1.6" rx="0.4" fill="currentColor" stroke="none" />
    </SvgShell>
  );
}

/** Queen — five-spoke crown. */
export function QueenIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M5 8l1.6 8h10.8L19 8l-3 4.5L13.6 6 12 11.5 10.4 6 8 12.5z" fill="currentColor" stroke="none" />
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="5.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="5.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="7" r="1" fill="currentColor" stroke="none" />
      <rect x="5.5" y="16.5" width="13" height="2" rx="0.4" fill="currentColor" stroke="none" />
      <rect x="4.5" y="19" width="15" height="2" rx="0.4" fill="currentColor" stroke="none" />
    </SvgShell>
  );
}

/** King — crown topped by a cross. */
export function KingIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M12 3v3M10.5 4.5h3" strokeWidth={1.8} />
      <path d="M7 11c-2 0-3 1.5-2 3 .8 1.2 2 1.8 2 1.8h10s1.2-.6 2-1.8c1-1.5 0-3-2-3-2 0-3.5 1-5 3-1.5-2-3-3-5-3z" fill="currentColor" stroke="none" />
      <rect x="6" y="16" width="12" height="2" rx="0.4" fill="currentColor" stroke="none" />
      <rect x="5" y="18.5" width="14" height="2" rx="0.4" fill="currentColor" stroke="none" />
    </SvgShell>
  );
}

// ── Course-category icons ───────────────────────────────────────────────

/** Mating — sword over crown. */
export function MateIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M5 19l8-8" />
      <path d="M14 5h5v5" />
      <path d="M19 5l-6 6" />
      <path d="M3 21l3-3 3 3-3 3z" fill="currentColor" stroke="none" />
    </SvgShell>
  );
}

/** Defence — shield. */
export function DefenceIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M12 3l8 3v6c0 4.5-3.5 8-8 9.5C7.5 20 4 16.5 4 12V6z" />
      <path d="M9 12l2 2 4-4" />
    </SvgShell>
  );
}

/** Open game — arrow / opening fan. */
export function OpenGameIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M12 21V8" />
      <path d="M12 8l-5 5" />
      <path d="M12 8l5 5" />
      <path d="M5 4h14" strokeWidth={2} />
    </SvgShell>
  );
}

/** Closed game — lock. */
export function ClosedGameIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </SvgShell>
  );
}

// ── Result symbols ──────────────────────────────────────────────────────

/** Correct — check mark. */
export function CheckIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M5 12.5l4 4L19 7" strokeWidth={2.2} />
    </SvgShell>
  );
}

/** Wrong — X. */
export function CrossIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M6 6l12 12M18 6L6 18" strokeWidth={2.2} />
    </SvgShell>
  );
}

/** Hint — lightbulb. */
export function HintIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5c1 1 1.5 2 1.5 3h5c0-1 .5-2 1.5-3A6 6 0 0 0 12 3z" />
    </SvgShell>
  );
}

/** Mastery — five-point star. */
export function StarIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M12 3l2.7 5.5 6 .9-4.4 4.3 1 6L12 17l-5.4 2.8 1-6L3.3 9.4l6-.9z" fill="currentColor" />
    </SvgShell>
  );
}

/** Line complete — checkered flag. */
export function FlagIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <path d="M5 21V4" strokeWidth={2} />
      <path d="M5 4h13l-2 4 2 4H5" />
      <path d="M5 6h3v2H5zM8 4h3v2H8zM11 6h3v2h-3zM14 4h3v2h-3zM5 10h3v2H5zM8 8h3v2H8zM11 10h3v2h-3zM14 8h3v2h-3z" fill="currentColor" stroke="none" />
    </SvgShell>
  );
}

/** Settings — gear. Used in the Layout nav top-right. */
export function SettingsIcon(props: ChessIconProps) {
  return (
    <SvgShell {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </SvgShell>
  );
}
