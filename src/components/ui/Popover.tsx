/*
 * Popover — small headless popover for dropdowns.
 *
 * Stripped-down rewrite (2026-04-30): the previous version had a
 * click-outside handler + focus management that interacted badly with
 * React 19 strict mode and React Router's render flow, leaving the
 * panel closing immediately after open in some cases. This version
 * keeps only the essentials:
 *   - Renders into a portal on document.body so ancestor overflow
 *     doesn't clip the panel.
 *   - Positioned via the trigger's bounding rect (recomputed on
 *     resize / scroll).
 *   - ESC closes; click-outside detection is handled cooperatively
 *     by the caller's onClose (typically via a backdrop or a "click
 *     outside" custom hook in the future) — for now, click the
 *     trigger again or press ESC to close.
 *   - Trigger is rendered by the caller; this component renders ONLY
 *     the panel.
 *
 * Future: re-add click-outside via a backdrop overlay element rather
 * than a global listener — sidesteps the listener-timing fragility.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps<TElement extends HTMLElement = HTMLElement> {
  /** Whether the popover panel is shown. Controlled by the caller. */
  open: boolean;
  /** Called when the popover requests dismissal (ESC, backdrop click). */
  onClose: () => void;
  /** Ref to the button that opens this popover. Used to position the
      panel and to return focus on close. */
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
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, triggerRef]);

  // Position the panel directly under the trigger using its bounding
  // rect. We portal the panel into <body> so it isn't clipped by any
  // ancestor's `overflow: hidden`. Recompute on resize and scroll.
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    const updatePosition = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ top: rect.bottom + 4, left: rect.left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, triggerRef]);

  // Tab focus trap — Tab/Shift+Tab loop within the panel only.
  const onKeyDownPanel = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
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
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open || position === null) return null;
  return createPortal(
    <>
      {/* Backdrop — invisible click target. Catches clicks outside the
          panel and closes the popover. Sits BELOW the panel (z-40 vs
          z-50) so panel clicks aren't intercepted. */}
      <button
        type="button"
        aria-label="Close popover"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      {/* The dialog needs onKeyDown for the Tab focus trap. Lint flags
          role="dialog" as non-interactive but a focus-trapping dialog
          is a legitimate keyboard surface — the role is correct. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="false"
        {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        onKeyDown={onKeyDownPanel}
        style={{ top: position.top, left: position.left }}
        className={
          'popover-fade fixed z-50 rounded-md border border-border bg-elevated shadow-2xl ' +
          (className ?? '')
        }
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
