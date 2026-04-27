/*
 * Popover — small headless popover used by the Tactics theme picker.
 *
 * Why we built our own (instead of pulling in Radix/Headless UI):
 *   - We already use framer-motion; the open/close animation is one
 *     <AnimatePresence> away.
 *   - The overhead of a fully-headless library (theming layers, portal
 *     mounting, virtualisation) is wasted on a single dropdown trigger.
 *   - Our a11y surface here is small but specific (aria-expanded,
 *     aria-controls, ESC, focus trap, click-outside), and we want to
 *     understand every line of it.
 *
 * Behaviour:
 *   - Trigger button is rendered by the caller; this component renders
 *     ONLY the popover panel itself (positioned absolutely under the
 *     trigger) and wires up the open/close lifecycle.
 *   - When `open` flips true: the first focusable element inside the
 *     panel receives focus. Tab/Shift+Tab cycle within the panel.
 *   - ESC closes; click outside closes. The trigger ref is excluded
 *     from "outside" so the trigger's own onClick toggles cleanly.
 *
 * The caller owns:
 *   - The open state (controlled component).
 *   - The trigger button (so they can render it however they like and
 *     wire `aria-expanded` / `aria-controls` to match the panel id).
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

interface PopoverProps<TElement extends HTMLElement = HTMLElement> {
  /** Whether the popover panel is shown. Controlled by the caller. */
  open: boolean;
  /** Called when the popover requests dismissal (ESC, outside click, focus escape). */
  onClose: () => void;
  /** Ref to the button that opens this popover — needed for outside-click and
      so focus can return to it on close. Generic over the element type so the
      caller can pass `useRef<HTMLButtonElement>(null)` without an unsafe cast
      (RefObject is invariant in its type parameter). */
  triggerRef: RefObject<TElement | null>;
  /** Stable id used for the trigger's `aria-controls` and the panel's `id`. */
  panelId?: string;
  /** Panel content. */
  children: ReactNode;
  /** Additional classes for the panel. Width / max-height usually go here. */
  className?: string;
  /** Optional accessible label for the panel (announced by screen readers). */
  'aria-label'?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary, details';

export function Popover<TElement extends HTMLElement = HTMLElement>({
  open,
  onClose,
  triggerRef,
  panelId: externalId,
  children,
  className,
  'aria-label': ariaLabel,
}: PopoverProps<TElement>) {
  const reduce = useReducedMotion();
  const generatedId = useId();
  const panelId = externalId ?? generatedId;
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ESC handler — registered globally so the user doesn't have to focus
  // anything inside the panel for ESC to work.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        // Return focus to the trigger button so keyboard users don't end
        // up on <body>.
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, triggerRef]);

  // Click-outside handler.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    // mousedown so we close before the next click event fires on something else
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, onClose, triggerRef]);

  // Focus the first focusable inside the panel when it opens.
  useEffect(() => {
    if (!open) return;
    // Wait one frame so framer-motion has mounted the panel children.
    const id = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusables[0];
      if (first) first.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // Focus trap — Tab/Shift+Tab loop within the panel only.
  const onKeyDownPanel = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    const insidePanel = active !== null && panel.contains(active);
    if (e.shiftKey) {
      if (active === first || !insidePanel) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  const duration = reduce ? 0 : 0.15;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="false"
          {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
          onKeyDown={onKeyDownPanel}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration, ease: 'easeOut' }}
          className={
            'absolute left-0 z-30 mt-1 rounded-md border border-border bg-elevated shadow-lg ' +
            (className ?? '')
          }
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
