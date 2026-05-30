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
  { item: "search", icon: "search", label: "Search" },
  { item: "source-control", icon: "account_tree", label: "Source Control", panel: "collaboration" },
  { item: "run", icon: "play_arrow", label: "Run and Debug", panel: "bottom" },
  { item: "extensions", icon: "extension", label: "Extensions" },
];

const BOTTOM_ACTIVITIES = [
  { icon: "account_circle", label: "Account" },
  { icon: "settings", label: "Settings" },
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
  const isBottomPanelOpen = useWorkspaceStore((s) => s.isBottomPanelOpen);
  const setSelectedActivityItem = useWorkspaceStore((s) => s.setSelectedActivityItem);
  const togglePanel = useWorkspaceStore((s) => s.togglePanel);

  const openPanel = (panel: PanelKey): void => {
    if (breakpoint === "mobile") {
      useWorkspaceStore.setState({
        isExplorerOpen: panel === "explorer",
        isCollaborationPanelOpen: panel === "collaboration",
        isBottomPanelOpen: panel === "bottom",
      });
      return;
    }
    togglePanel(panel);
  };

  const handleTopActivityClick = (activity: TopActivityConfig): void => {
    setSelectedActivityItem(activity.item);
    if (!activity.panel) return;

    const isOpen =
      activity.panel === "explorer"
        ? isExplorerOpen
        : activity.panel === "collaboration"
          ? isCollaborationPanelOpen
          : isBottomPanelOpen;

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
        {BOTTOM_ACTIVITIES.map((a) => (
          <ActivityButton key={a.icon} icon={a.icon} label={a.label} />
        ))}
      </div>
    </nav>
  );
}
