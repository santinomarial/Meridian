import { MaterialIcon } from "../ui/MaterialIcon";
import { focusRing, transitionBase } from "../ui/styles";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import type { ActivityItem, PanelKey } from "../../types";

type TopActivityConfig = {
  item: ActivityItem;
  icon: string;
  label: string;
  panel?: PanelKey;
};

const TOP_ACTIVITIES: TopActivityConfig[] = [
  { item: "explorer", icon: "folder_copy", label: "Explorer", panel: "explorer" },
  { item: "collaboration", icon: "group", label: "Collaboration", panel: "collaboration" },
];

function ActivityButton({
  icon,
  label,
  selected = false,
  onClick,
}: {
  icon: string;
  label: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      className={[
        "flex w-full items-center justify-center border-l-2 py-2",
        transitionBase,
        focusRing,
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
      ].join(" ")}
    >
      <MaterialIcon name={icon} className="text-[20px]" aria-hidden />
    </button>
  );
}

export function ActivityBar() {
  const breakpoint = useBreakpoint();
  const selectedActivityItem = useWorkspaceStore((s) => s.selectedActivityItem);
  const isExplorerOpen = useWorkspaceStore((s) => s.isExplorerOpen);
  const isCollaborationPanelOpen = useWorkspaceStore((s) => s.isCollaborationPanelOpen);
  const isTerminalOpen = useWorkspaceStore((s) => s.isTerminalOpen);
  const setSelectedActivityItem = useWorkspaceStore((s) => s.setSelectedActivityItem);
  const togglePanel = useWorkspaceStore((s) => s.togglePanel);
  const toggleTerminal = useWorkspaceStore((s) => s.toggleTerminal);
  const setSettingsOpen = useWorkspaceStore((s) => s.setSettingsOpen);

  const openPanel = (panel: PanelKey): void => {
    if (breakpoint === "mobile") {
      useWorkspaceStore.setState({
        isExplorerOpen: panel === "explorer",
        isCollaborationPanelOpen: panel === "collaboration",
      });
      return;
    }
    togglePanel(panel);
  };

  const handleTopActivityClick = (activity: TopActivityConfig): void => {
    setSelectedActivityItem(activity.item);
    if (!activity.panel) return;

    const isOpen =
      activity.panel === "explorer" ? isExplorerOpen : isCollaborationPanelOpen;

    if (breakpoint === "mobile") {
      if (isOpen) togglePanel(activity.panel);
      else openPanel(activity.panel);
      return;
    }
    togglePanel(activity.panel);
  };

  return (
    <nav
      className="meridian-panel flex w-12 shrink-0 flex-col meridian-crisp-border border-r py-2.5"
      aria-label="Activity bar"
    >
      <div className="flex w-full flex-col gap-0.5">
        {TOP_ACTIVITIES.map((activity) => (
          <ActivityButton
            key={activity.item}
            icon={activity.icon}
            label={activity.label}
            selected={selectedActivityItem === activity.item}
            onClick={() => handleTopActivityClick(activity)}
          />
        ))}
      </div>
      <div className="mt-auto flex w-full flex-col gap-0.5 pb-0.5">
        <ActivityButton
          icon="terminal"
          label="Toggle Terminal"
          selected={isTerminalOpen}
          onClick={toggleTerminal}
        />
        <ActivityButton
          icon="settings"
          label="Settings"
          onClick={() => setSettingsOpen(true)}
        />
      </div>
    </nav>
  );
}
