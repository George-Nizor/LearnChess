/*
 * PageTransition — a route-keyed wrapper that forces a clean unmount/remount
 * on every route change.
 *
 * History of this file:
 *   - v1 (pre-2026-04-27): framer-motion AnimatePresence with mode="wait"
 *     and a 200ms cross-fade. Caused chessground to unmount-then-remount
 *     between routes, creating a visible "blank board" moment.
 *   - v2 (2026-04-27): dropped mode="wait", kept the cross-fade at 120ms.
 *     This let old + new motion.divs coexist briefly. BUG: both motion.divs
 *     render <Outlet />, and <Outlet /> reads location from React Router
 *     context — so BOTH render the NEW route. Two chessground instances
 *     mount simultaneously, then one is destroyed when the outgoing
 *     motion.div finally exits. Depending on commit ordering, the surviving
 *     chessground could end up with detached event listeners and refuse
 *     to respond to pointerdown until F5.
 *   - v3 (this file, 2026-04-30): drop the animation library entirely.
 *     The `key={pageKey}` prop is what does the work — React unmounts the
 *     previous subtree completely (running every cleanup, including
 *     chessground.destroy()) BEFORE mounting the new one. There is never
 *     a moment where two route trees coexist in the DOM, so chessground
 *     can never end up in a partially-destroyed state.
 *
 * I tried to keep a short CSS keyframe fade-in for visual polish but it
 * interacts badly with the parent layout (gets stuck at opacity 0 in some
 * navigation flows). The instant swap is barely perceptible — under
 * 16ms in practice — and a hard guarantee against the bug recurring is
 * worth more than 120ms of fade.
 */
import type { ReactNode } from 'react';

interface PageTransitionProps {
  /** A unique key per route — typically `location.pathname`. */
  pageKey: string;
  children: ReactNode;
}

export function PageTransition({ pageKey, children }: PageTransitionProps) {
  return (
    <div key={pageKey} className="h-full min-h-0">
      {children}
    </div>
  );
}
