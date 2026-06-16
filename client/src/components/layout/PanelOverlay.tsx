import { useEffect, useRef, type ReactNode } from "react";
import { focusRing, transitionBase } from "../ui/styles";

type PanelOverlayProps = {
  children: ReactNode;
  onClose: () => void;
  side: "left" | "right";
  label: string;
};

export function PanelOverlay({ children, onClose, side, label }: PanelOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const panelPositionClass =
    side === "left"
      ? "left-0 top-0 h-full w-[min(240px,88vw)] border-r border-outline-variant"
      : "right-0 top-0 ml-auto h-full w-[min(240px,88vw)] border-l border-outline-variant";

  return (
    <div className="fixed inset-0 z-40 flex" role="presentation">
      <button
        type="button"
        className={["absolute inset-0 bg-on-surface/40", transitionBase, focusRing].join(" ")}
        aria-label={`Close ${label}`}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={[
          "meridian-panel relative z-50 flex flex-col shadow-xl outline-none",
          panelPositionClass,
          transitionBase,
        ].join(" ")}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
