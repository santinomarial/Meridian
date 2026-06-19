import { useEffect, useState } from "react";

export type ToastKind = "info" | "error" | "success";

type ToastItem = {
  id: string;
  message: string;
  kind: ToastKind;
};

type Listener = (toasts: ToastItem[]) => void;

const listeners = new Set<Listener>();
let _queue: ToastItem[] = [];

function broadcast(): void {
  const snapshot = [..._queue];
  listeners.forEach((l) => l(snapshot));
}

// The imperative `toast()` API is intentionally co-located with its
// <ToastContainer>; only affects Fast Refresh DX, not runtime behavior.
// eslint-disable-next-line react-refresh/only-export-components
export function toast(message: string, kind: ToastKind = "info"): void {
  const id = crypto.randomUUID();
  _queue = [..._queue, { id, message, kind }];
  broadcast();
  window.setTimeout(() => {
    _queue = _queue.filter((t) => t.id !== id);
    broadcast();
  }, 3500);
}

const KIND_CLASSES: Record<ToastKind, string> = {
  info: "bg-surface-container-high text-on-surface border-outline/30",
  error: "bg-surface-container-high text-error border-error/30",
  success: "bg-surface-container-high text-primary border-primary/30",
};

const KIND_ICONS: Record<ToastKind, string> = {
  info: "info",
  error: "error_outline",
  success: "check_circle",
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-8 left-1/2 z-[9999] flex -translate-x-1/2 flex-col-reverse items-center gap-2"
      aria-live="polite"
      aria-atomic="false"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            "pointer-events-auto flex min-w-[200px] max-w-sm items-center gap-2 rounded-md border px-3.5 py-2.5 text-sm shadow-xl",
            "meridian-crisp-border",
            KIND_CLASSES[t.kind],
          ].join(" ")}
          role="status"
        >
          <span className="material-symbols-outlined shrink-0 text-[16px]">{KIND_ICONS[t.kind]}</span>
          <span className="leading-snug">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
