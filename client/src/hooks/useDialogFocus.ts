import { useLayoutEffect, useRef } from "react";

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex], [contenteditable='true']";

/** Keep keyboard interaction in the topmost modal and return focus on dismissal. */
export function useDialogFocus() {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    const isTopmost = () => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      return dialogs[dialogs.length - 1] === dialog;
    };
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") &&
        element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
    const focusFirst = () => (controls()[0] ?? dialog).focus({ preventScroll: true });
    const onFocus = (event: FocusEvent) => {
      if (isTopmost() && !dialog.contains(event.target as Node)) focusFirst();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !isTopmost()) return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!first || !dialog.contains(active) || active === dialog ||
          (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        event.stopPropagation();
        (event.shiftKey ? last ?? dialog : first ?? dialog).focus();
      }
    };

    if (isTopmost()) focusFirst();
    document.addEventListener("focusin", onFocus);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("keydown", onKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  return ref;
}
