import { useCallback, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Logo } from '@/components/ui/Logo';
import { PageShell } from '@/components/ui/PageShell';
import { PageTransition } from '@/components/ui/PageTransition';
import { SetupBanner } from '@/components/ui/SetupBanner';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import {
  SettingsIcon,
  BookIcon,
  FlagIcon,
  TargetIcon,
  SearchIcon,
  GamepadIcon,
  BarChartIcon,
  type ChessIconProps,
} from '@/components/ui/ChessIcons';
import { PageMetaContext, type PageMetaContextValue } from './page-meta';

// Nav order reflects priority: learning chess (openings → endgames → tactics)
// comes before analysis tools and free play. Dashboard sits last because it's
// a passive view, not a primary action. Each rail item shows an icon by
// default and slides out a label pill on hover (Discord-style). Icons were
// chosen for instant readability:
//   - Openings → BOOK (study)
//   - Endgames → FLAG (finish line)
//   - Tactics → TARGET (puzzle / aim)
//   - Analysis → SEARCH (magnifying glass)
//   - Play → GAMEPAD (vs engine)
//   - Dashboard → BAR CHART (stats)
type NavIcon = (props: ChessIconProps) => React.ReactNode;
const NAV: ReadonlyArray<{ to: string; label: string; Icon: NavIcon }> = [
  { to: '/openings', label: 'Openings', Icon: BookIcon },
  { to: '/endgames', label: 'Endgames', Icon: FlagIcon },
  { to: '/tactics', label: 'Tactics', Icon: TargetIcon },
  { to: '/analysis', label: 'Analysis', Icon: SearchIcon },
  { to: '/play', label: 'Play', Icon: GamepadIcon },
  { to: '/dashboard', label: 'Dashboard', Icon: BarChartIcon },
];

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
      <div className="surface-transition flex h-screen flex-row">
        {/* Vertical icon rail — replaces the previous top header. Saves
            ~64 px of vertical real estate so the board can be the page's
            visual focus. Each nav item is icon-only; the label appears
            as a tooltip on hover (browser native + the visually-hidden
            label is still announced by screen readers). */}
        <aside
          aria-label="Primary navigation"
          // `relative z-50` so the hover-label pills (which are children
          // of nav buttons inside this aside) win the stacking-context
          // race against route content like the Stockfish eval bar
          // (which uses its own positioned wrappers with z-10 / z-20).
          // backdrop-blur was creating an isolated stacking context that
          // capped child z-index; explicit `relative z-50` lifts the
          // whole rail above any same-document positioned content.
          className="relative z-50 flex w-14 shrink-0 flex-col items-center gap-2 border-r border-border bg-muted/30 px-1.5 py-3 backdrop-blur"
        >
          {/* Brand mark — clicks to home/index. */}
          <NavLink
            to="/"
            end
            className="group flex h-10 w-10 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="LearnChess home"
            title="LearnChess"
          >
            <Logo size={28} decorative />
          </NavLink>

          {/* Divider */}
          <span aria-hidden className="my-1 h-px w-6 bg-border" />

          {/* Nav items. The active state shows the amber accent. On hover
              a label pill slides out to the right of the rail (Discord-
              style) so the user can see the route name. The pill uses
              `pointer-events-none` so it can't intercept clicks. */}
          <nav aria-label="Primary" className="flex flex-1 flex-col items-center gap-1">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                aria-label={label}
                className={({ isActive }) =>
                  `group relative flex h-10 w-10 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    isActive
                      ? 'bg-accent text-accent-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`
                }
              >
                <Icon size={18} />
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-full z-50 ml-2 origin-left scale-95 rounded-md border border-border bg-elevated px-2.5 py-1 text-xs font-medium text-foreground opacity-0 shadow-lg transition-all duration-150 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {label}
                </span>
              </NavLink>
            ))}
          </nav>

          {/* Divider */}
          <span aria-hidden className="my-1 h-px w-6 bg-border" />

          {/* Theme toggle + Settings — bottom of the rail. */}
          <div className="flex flex-col items-center gap-1">
            <ThemeToggle />
            <NavLink
              to="/settings"
              aria-label="Settings"
              title="Settings"
              className={({ isActive }) =>
                `flex h-10 w-10 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`
              }
            >
              <SettingsIcon size={18} />
            </NavLink>
          </div>
        </aside>

        {/* Main column — banner + optional subtitle strip + route. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <SetupBanner />

          {/* Subtitle strip — only takes space when a route sets it. */}
          <AnimatePresence initial={false}>
            {subtitle && (
              <motion.div
                key={subtitle}
                aria-live="polite"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: subtitleAnim, ease: 'easeOut' }}
                className="shrink-0 border-b border-border/60 bg-background/40 py-1 text-xs text-muted-foreground"
              >
                <PageShell pad={false}>{subtitle}</PageShell>
              </motion.div>
            )}
          </AnimatePresence>

          <main className="min-h-0 flex-1">
            <PageTransition pageKey={location.pathname}>
              <Outlet />
            </PageTransition>
          </main>
        </div>
      </div>
    </PageMetaContext.Provider>
  );
}
