import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keyboard behaviour every dialog needs: focus moves into it on open
 * (`initialFocus`, else the first focusable element), Tab/Shift+Tab stay
 * inside, Escape closes (unless `canClose` says no), and focus returns to
 * where it was when the dialog closes. */
export function useDialogFocus(
  panelRef: RefObject<HTMLElement | null>,
  { onClose, canClose = () => true, initialFocus }: {
    onClose: () => void;
    canClose?: () => boolean;
    initialFocus?: RefObject<HTMLElement | null>;
  },
) {
  // Latest callbacks without re-running the effect (which would steal focus).
  const latest = useRef({ onClose, canClose });
  useEffect(() => {
    latest.current = { onClose, canClose };
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const returnTo = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (latest.current.canClose()) {
          e.preventDefault();
          latest.current.onClose();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (returnTo && document.contains(returnTo)) returnTo.focus();
    };
  }, [panelRef, initialFocus]);
}
