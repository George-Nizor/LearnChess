/*
 * PageTransition — a route-keyed fade for the <Outlet />.
 *
 * 2026-04-27 update: dropped `mode="wait"`. The previous version waited for
 * the outgoing page to finish fading before mounting the new one — that
 * created a blank moment where chessground was unmounted, then re-mounted.
 * The new mode lets old + new overlap; the fade still works but the board
 * never disappears completely. We also dropped the duration to 120ms so
 * any residual cross-fade is barely perceptible.
 *
 * Reduced-motion: useReducedMotion() flips this to a 0ms instant swap so
 * vestibular-disorder users aren't punished for visiting routes.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

interface PageTransitionProps {
  /** A unique key per route — typically `location.pathname`. */
  pageKey: string;
  children: ReactNode;
}

export function PageTransition({ pageKey, children }: PageTransitionProps) {
  const reduce = useReducedMotion();
  const duration = reduce ? 0 : 0.12;

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={pageKey}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration, ease: 'easeOut' }}
        style={{ height: '100%', minHeight: 0 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
