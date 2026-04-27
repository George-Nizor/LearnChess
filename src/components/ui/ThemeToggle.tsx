/*
 * Theme toggle — toggles `.dark` on <html>. Persists choice to localStorage
 * under `learnchess.theme` ("light" | "dark"); first-load default reads
 * `prefers-color-scheme`. The actual class flip happens in a tiny inline
 * script in `index.html` (zero-FOUC at boot); this component owns the
 * runtime toggle.
 *
 * Accessibility:
 *   - `aria-pressed` reflects "dark mode is active".
 *   - Single button, single label that swaps based on state.
 *   - Sun/moon SVG is decorative (label conveys intent).
 *   - 200ms colour transitions on body/surfaces are CSS-driven (globals.css).
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'learnchess.theme';

type Theme = 'light' | 'dark';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    // localStorage may be disabled (private mode); the class swap still works.
  }
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  // Listen for OS-level theme changes when the user has not made an explicit
  // choice. If they have, our localStorage entry takes precedence.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent): void => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return;
      } catch {
        // ignore — fall through to apply OS preference
      }
      const next: Theme = e.matches ? 'dark' : 'light';
      applyTheme(next);
      setTheme(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  }, [theme]);

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={
        'inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-elevated text-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
        (className ?? '')
      }
    >
      {isDark ? (
        // Sun icon — shows when in dark mode (the action it would trigger).
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      ) : (
        // Moon icon — shows when in light mode.
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
