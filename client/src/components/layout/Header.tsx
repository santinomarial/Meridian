import { MeridianWordmark } from "../ui/MeridianWordmark";
import { MaterialIcon } from "../ui/MaterialIcon";
import {
  headerButtonPrimary,
  headerButtonSecondary,
  iconButtonMutedClass,
  navButtonClass,
} from "../ui/styles";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import type { Collaborator } from "../../types";

const NAV_ITEMS = ["File", "Edit", "Selection", "View", "Go"] as const;

const MAX_VISIBLE_COLLABORATORS = 3;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function CollaboratorAvatar({ collaborator }: { collaborator: Collaborator }) {
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-surface text-[10px] font-bold text-on-primary"
      style={{ backgroundColor: collaborator.color }}
      title={collaborator.name}
    >
      {getInitials(collaborator.name)}
    </span>
  );
}

function OverflowAvatar({ count }: { count: number }) {
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-surface bg-surface-container-highest text-[10px] font-bold text-on-surface-variant"
      title={`${count} more collaborators`}
    >
      +{count}
    </span>
  );
}

export function Header() {
  const collaborators = useWorkspaceStore((state) => state.collaborators);
  const theme = useWorkspaceStore((state) => state.theme);
  const toggleTheme = useWorkspaceStore((state) => state.toggleTheme);

  const visibleCollaborators = collaborators.slice(0, MAX_VISIBLE_COLLABORATORS);
  const overflowCount = Math.max(0, collaborators.length - MAX_VISIBLE_COLLABORATORS);

  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between meridian-crisp-border border-b bg-surface px-3"
      role="banner"
    >
      <div className="flex min-h-0 min-w-0 items-center gap-4">
        <MeridianWordmark />
        <nav className="hidden items-center md:flex" aria-label="Main menu">
          {NAV_ITEMS.map((item) => (
            <button key={item} type="button" className={navButtonClass}>
              {item}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2.5">
        <span className="hidden h-8 items-center gap-1.5 rounded-md meridian-crisp-border border bg-surface-container px-2.5 text-xs sm:inline-flex">
          <MaterialIcon name="account_tree" className="text-[14px] text-primary" aria-hidden />
          <span className="text-on-surface-variant">branch:</span>
          <span className="font-semibold text-on-surface">main</span>
        </span>

        <div className="flex items-center px-0.5">
          <div className="flex -space-x-2">
            {visibleCollaborators.map((c) => (
              <CollaboratorAvatar key={c.id} collaborator={c} />
            ))}
            {overflowCount > 0 ? <OverflowAvatar count={overflowCount} /> : null}
          </div>
        </div>

        <button type="button" className={[headerButtonSecondary, "hidden sm:inline-flex"].join(" ")}>
          Live Session
        </button>

        <button type="button" className={headerButtonPrimary}>
          Share
        </button>

        <div className="flex items-center gap-px meridian-crisp-border border-l pl-2">
          <button
            type="button"
            onClick={toggleTheme}
            className={iconButtonMutedClass}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            <MaterialIcon
              name={theme === "dark" ? "light_mode" : "dark_mode"}
              className="text-[18px]"
              aria-hidden
            />
          </button>
          <button type="button" className={iconButtonMutedClass} aria-label="Notifications">
            <MaterialIcon name="notifications" className="text-[18px]" aria-hidden />
          </button>
          <button type="button" className={iconButtonMutedClass} aria-label="Account">
            <MaterialIcon name="account_circle" className="text-[18px]" aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}
