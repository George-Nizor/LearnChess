import { useCallback, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Logo } from '@/components/ui/Logo';
import { PageShell } from '@/components/ui/PageShell';
import { PageTransition } from '@/components/ui/PageTransition';
import { SetupBanner } from '@/components/ui/SetupBanner';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { SettingsIcon } from '@/components/ui/ChessIcons';
import { PageMetaContext, type PageMetaContextValue } from './page-meta';

// Nav order reflects priority: learning chess (openings → endgames → tactics)
// comes before analysis tools and free play. Dashboard sits last because it's
// a passive view, not a primary action.
const NAV = [
  { to: '/openings', label: 'Openings', end: false },
  { to: '/endgames', label: 'Endgames', end: false },
  { to: '/tactics', label: 'Tactics', end: false },
  { to: '/analysis', label: 'Analysis', end: false },
  // Match both '/' and '/play' so the highlight follows the user when
  // they land on the index OR the canonical /play URL.
  { to: '/play', label: 'Play', end: false },
  { to: '/dashboard', label: 'Dashboard', end: false },
] as const;

export function Layout() {
  const [subtitle, setSubtitleState] = useState<string>('');
  const setSubtitle = useCallback((next: string) => setSubtitleState(next), []);
  const ctxValue = useMemo<PageMetaContextValue>(
    () => ({ subtitle, setSubtitle }),
    [subtitle, setSubtitle],
  );

  const location = useLocation();
  const reduce = useReducedMotion();
  const subtitleAnim = reduce ? 0 : 0.18;

  return (
    <PageMetaContext.Provider value={ctxValue}>
      <div className="surface-transition flex h-screen flex-col">
        <SetupBanner />
        <header className="border-b border-border bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
          <PageShell pad={false} className="flex items-center justify-between gap-4 py-3">
            {/* Brand: logo + display-font wordmark. The whole pair links to
                Play (the home/index route) for the usual nav convention. */}
            <NavLink
              to="/"
              end
              className="group inline-flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="LearnChess home"
            >
              <Logo size={32} decorative />
              <span className="font-display text-lg font-semibold tracking-tight text-foreground">
                LearnChess
              </span>
            </NavLink>

            <div className="flex items-center gap-2">
              <nav aria-label="Primary" className="flex flex-wrap gap-1">
                {NAV.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={'end' in item ? item.end : false}
                    className={({ isActive }) =>
                      `rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-accent text-accent-foreground shadow-sm'
                          : 'text-foreground hover:scale-[1.02] hover:bg-muted'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </nav>
              <div className="ml-1 flex items-center gap-1 border-l border-border pl-2">
                <ThemeToggle />
                <NavLink
                  to="/settings"
                  aria-label="Settings"
                  title="Settings"
                  className={({ isActive }) =>
                    `inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      isActive ? 'bg-accent text-accent-foreground' : 'bg-elevated'
                    }`
                  }
                >
                  <SettingsIcon size={18} />
                </NavLink>
              </div>
            </div>
          </PageShell>

          {/* Subtitle strip — slides + fades in when text changes. We key the
              motion.div on the subtitle string so AnimatePresence can run
              an exit on the previous one. Empty string collapses the slot. */}
          <AnimatePresence initial={false}>
            {subtitle && (
              <motion.div
                key={subtitle}
                aria-live="polite"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: subtitleAnim, ease: 'easeOut' }}
                className="border-t border-border/60 bg-background/40 py-1.5 text-xs text-muted-foreground"
              >
                <PageShell pad={false}>{subtitle}</PageShell>
              </motion.div>
            )}
          </AnimatePresence>
        </header>

        <main className="min-h-0 flex-1">
          <PageTransition pageKey={location.pathname}>
            <Outlet />
          </PageTransition>
        </main>
      </div>
    </PageMetaContext.Provider>
  );
}
