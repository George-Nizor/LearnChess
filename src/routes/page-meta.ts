/*
 * Page-meta context — owned by `Layout.tsx`, consumed by every trainer route.
 *
 * Each trainer route used to render a 3xl `<h1>` eating ~80 px above the
 * board. We removed the H1 entirely; the route name lives in the nav (the
 * active NavLink is highlighted) and any short page meta ("30 curated
 * positions · graded vs Lichess Syzygy 7-piece tablebase") is published via
 * `usePageSubtitle` so it can render under the nav without duplicating
 * layout per route.
 *
 * Routes call `usePageSubtitle('text')` once. The Layout subscribes to the
 * latest value via context. Empty string clears the slot.
 *
 * This file is split out from `Layout.tsx` so `react-refresh/only-export-
 * components` is satisfied (the rule forbids mixing components and non-
 * component exports in the same module under HMR).
 */
import { createContext, useContext, useEffect } from 'react';

export interface PageMetaContextValue {
  subtitle: string;
  setSubtitle: (next: string) => void;
}

export const PageMetaContext = createContext<PageMetaContextValue | null>(null);

export function usePageSubtitle(subtitle: string): void {
  // Only depend on the (stable) setter — the `subtitle` state in the
  // provider also flows through `ctx`, but reading it here would re-run the
  // effect on every keystroke from sibling routes and cause a setState
  // ping-pong with the provider's re-renders.
  const ctx = useContext(PageMetaContext);
  const setter = ctx?.setSubtitle;
  useEffect(() => {
    if (!setter) return;
    setter(subtitle);
    return () => {
      setter('');
    };
  }, [setter, subtitle]);
}
