import { MaterialIcon } from "../ui/MaterialIcon";
import {
  focusRing,
  iconButtonClass,
  panelSectionLabel,
  transitionBase,
} from "../ui/styles";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";

const PANEL_TABS = [
  { id: "terminal" as const, label: "TERMINAL" },
  { id: "output" as const, label: "OUTPUT" },
  { id: "debug" as const, label: "DEBUG CONSOLE" },
  { id: "ai" as const, label: "AI ASSISTANT", icon: "bolt" },
];

const TERMINAL_LINES = [
  { text: "meridian-app@0.1.0 start", className: "font-medium text-on-surface-variant" },
  { text: "$ npm run start:dev", className: "text-on-surface-variant/90" },
  { text: "[10:42:01 AM] Starting compilation in watch mode...", className: "mt-1.5 text-on-surface" },
  { text: "[10:42:05 AM] Found 0 errors. Watching for file changes.", className: "text-on-surface" },
  { text: "Ready on http://localhost:3000", className: "mt-1 font-medium text-primary" },
];

function PanelTabButton({
  label,
  icon,
  isActive,
  onSelect,
}: {
  label: string;
  icon?: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      onClick={onSelect}
      aria-selected={isActive}
      className={[
        "flex h-8 shrink-0 items-center gap-1 border-b-2 px-3 text-[10px] font-bold uppercase tracking-wide",
        transitionBase,
        focusRing,
        isActive
          ? "border-primary text-on-surface"
          : "border-transparent text-on-surface-variant hover:text-on-surface",
      ].join(" ")}
    >
      {icon ? <MaterialIcon name={icon} className="text-[12px]" aria-hidden /> : null}
      {label}
    </button>
  );
}

function TerminalContent() {
  return (
    <div className="flex-1 space-y-0.5 overflow-y-auto p-3 font-mono text-[12px] leading-[1.55]">
      {TERMINAL_LINES.map((line) => (
        <p key={line.text} className={line.className}>
          {line.text}
        </p>
      ))}
      <span className="ml-0.5 inline-block h-3 w-1 bg-secondary align-middle" aria-hidden />
    </div>
  );
}

function AiSidebar() {
  return (
    <aside className="flex w-[11.5rem] shrink-0 flex-col meridian-crisp-border border-l bg-surface-container-low p-2.5">
      <div className="mb-2 flex items-baseline justify-between gap-1">
        <span className={panelSectionLabel}>Meridian AI</span>
        <span className="text-[9px] tabular-nums text-on-surface-variant">v0.1</span>
      </div>
      <div className="rounded-md meridian-crisp-border border bg-surface-container-lowest p-2 text-[11px] leading-snug">
        <p className="mb-2 text-on-surface-variant">
          Missing JWT verification step.
        </p>
        <button
          type="button"
          className={[
            "w-full rounded py-1 text-[9px] font-bold uppercase tracking-wide text-on-primary bg-primary",
            transitionBase,
            "hover:bg-primary-container",
            focusRing,
          ].join(" ")}
        >
          Insert
        </button>
      </div>
      <p className="mt-2 text-center text-[9px] text-on-surface-variant">
        <kbd className="rounded meridian-crisp-border border px-1 font-mono">⌘I</kbd> deep dive
      </p>
    </aside>
  );
}

type BottomPanelProps = {
  mode?: "inline" | "overlay";
  onClose?: () => void;
};

export function BottomPanel({ mode = "inline", onClose }: BottomPanelProps) {
  const isBottomPanelOpen = useWorkspaceStore((s) => s.isBottomPanelOpen);
  const activeTerminalTab = useWorkspaceStore((s) => s.activeTerminalTab);
  const setActiveTerminalTab = useWorkspaceStore((s) => s.setActiveTerminalTab);
  const togglePanel = useWorkspaceStore((s) => s.togglePanel);

  const handleClose = (): void => {
    if (onClose) onClose();
    else togglePanel("bottom");
  };

  if (mode === "inline" && !isBottomPanelOpen) return null;

  const mainContent = () => {
    switch (activeTerminalTab) {
      case "terminal":
        return <TerminalContent />;
      case "output":
        return (
          <div className="flex-1 p-3 font-mono text-[12px] leading-[1.55] text-on-surface-variant">
            <p>[Output] Build tasks will appear here.</p>
          </div>
        );
      case "debug":
        return (
          <div className="flex-1 p-3 font-mono text-[12px] leading-[1.55] text-on-surface-variant">
            <p>[Debug] Debugger not attached.</p>
          </div>
        );
      case "ai":
        return (
          <div className="flex-1 p-3 text-[12px] text-on-surface-variant">
            Responses appear in the Meridian AI sidebar.
          </div>
        );
    }
  };

  return (
    <section
      className={[
        "flex flex-col bg-surface-container-lowest",
        mode === "inline" ? "h-[11rem] shrink-0 meridian-crisp-border border-t" : "h-full min-h-0",
      ].join(" ")}
      aria-label="Bottom panel"
    >
      <div className="flex h-8 shrink-0 items-stretch meridian-crisp-border border-b bg-surface-container-low">
        <div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label="Panel tabs">
          {PANEL_TABS.map((tab) => (
            <PanelTabButton
              key={tab.id}
              label={tab.label}
              icon={tab.icon}
              isActive={activeTerminalTab === tab.id}
              onSelect={() => setActiveTerminalTab(tab.id)}
            />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-px meridian-crisp-border border-l px-1.5">
          <button type="button" className={iconButtonClass} aria-label="Add panel tab">
            <MaterialIcon name="add" className="text-[16px]" aria-hidden />
          </button>
          {mode === "inline" ? (
            <button type="button" onClick={handleClose} className={iconButtonClass} aria-label="Collapse panel">
              <MaterialIcon name="keyboard_arrow_up" className="text-[16px]" aria-hidden />
            </button>
          ) : null}
          <button type="button" onClick={handleClose} className={iconButtonClass} aria-label="Close panel">
            <MaterialIcon name="close" className="text-[16px]" aria-hidden />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden" role="tabpanel">
        {mainContent()}
        <AiSidebar />
      </div>
    </section>
  );
}
