/*
 * PageShell — shared route gutter / max-width wrapper.
 *
 * Replaces the ad-hoc `mx-auto max-w-7xl p-6` repeated across every route.
 * Routes that are off-limits in this pass keep using their inline classes;
 * the Layout uses PageShell for the subtitle bar so the gutter stays
 * pixel-aligned with whatever the route renders.
 *
 * Variants:
 *   - `wide` (default) — 7xl, used by trainer routes
 *   - `narrow` — 3xl, used by error/loading panels
 */
import type { ReactNode } from 'react';

interface PageShellProps {
  children: ReactNode;
  className?: string;
  width?: 'narrow' | 'wide';
  /** When false, drop vertical padding (used inside the nav for the
      subtitle bar so the bar aligns with the nav's own padding). */
  pad?: boolean;
}

export function PageShell({ children, className, width = 'wide', pad = true }: PageShellProps) {
  const max = width === 'narrow' ? 'max-w-3xl' : 'max-w-7xl';
  const padding = pad ? 'px-6 py-6' : 'px-6';
  return (
    <div className={`mx-auto ${max} ${padding} ${className ?? ''}`}>{children}</div>
  );
}
