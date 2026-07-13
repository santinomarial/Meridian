import { getFileIconClassName, getFileIconName } from "../../constants/fileDisplay";
import { MaterialIcon } from "../ui/MaterialIcon";
import { focusRing, transitionBase } from "../ui/styles";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import type { OpenTab } from "../../types";

function EditorTab({
  tab,
  isActive,
  onSelect,
  onClose,
}: {
  tab: OpenTab;
  isActive: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <li
      role="presentation"
      className={[
        "group flex h-9 shrink-0 items-stretch meridian-crisp-border border-r",
        transitionBase,
        isActive
          ? "z-[1] -mb-px border-b border-b-surface-container-lowest bg-surface-container-lowest text-on-surface shadow-[inset_0_2px_0_0_var(--color-primary)]"
          : "bg-transparent text-on-surface-variant hover:bg-surface-container",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => onSelect(tab.fileId)}
        className={["flex h-full min-w-0 items-center gap-1.5 px-3", focusRing].join(" ")}
        role="tab"
        aria-selected={isActive}
      >
        <MaterialIcon
          name={getFileIconName(tab.language)}
          className={["shrink-0 text-[15px]", getFileIconClassName(tab.language, tab.name)].join(" ")}
          aria-hidden
        />
        <span className="max-w-[152px] truncate text-[13px]">{tab.name}</span>
      </button>
      <div className="relative flex w-7 shrink-0 items-center justify-center">
        {tab.dirty ? (
          <span
            className="h-1.5 w-1.5 rounded-full bg-primary group-hover:hidden group-focus-within:hidden"
            aria-hidden
          />
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.fileId);
          }}
          className={[
            "inline-flex h-5 w-5 items-center justify-center rounded text-on-surface-variant/80",
            transitionBase,
            "hover:bg-surface-container-high hover:text-on-surface",
            focusRing,
            tab.dirty ? "absolute" : "",
            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          ].join(" ")}
          aria-label={`Close ${tab.name}`}
        >
          <MaterialIcon name="close" className="text-[13px]" aria-hidden />
        </button>
      </div>
    </li>
  );
}

export function EditorTabs() {
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const activeFileId = useWorkspaceStore((s) => s.activeFileId);
  const setActiveFile = useWorkspaceStore((s) => s.setActiveFile);
  const closeTab = useWorkspaceStore((s) => s.closeTab);

  const handleClose = (fileId: string): void => {
    const tab = useWorkspaceStore.getState().openTabs.find((item) => item.fileId === fileId);
    if (tab?.dirty && !window.confirm(`Close ${tab.name} without saving your changes?`)) {
      return;
    }
    closeTab(fileId);
  };

  if (!openTabs.length) return null;

  return (
    <div className="shrink-0 overflow-x-auto meridian-crisp-border border-b bg-surface-container-low">
      <ul className="flex h-9 min-w-min" role="tablist" aria-label="Open editors">
        {openTabs.map((tab) => (
          <EditorTab
            key={tab.fileId}
            tab={tab}
            isActive={activeFileId === tab.fileId}
            onSelect={setActiveFile}
            onClose={handleClose}
          />
        ))}
      </ul>
    </div>
  );
}
