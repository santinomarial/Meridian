import { useNavigate } from "react-router-dom";
import { MeridianWordmark } from "../ui/MeridianWordmark";
import { MaterialIcon } from "../ui/MaterialIcon";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";

/**
 * Full-page gate when the API cannot be reached. Replaces the old silent mock
 * workspace so users never confuse Alice/Bob demo files with a real session.
 */
export function BackendUnavailableGate() {
  const navigate = useNavigate();
  const theme = useWorkspaceStore((s) => s.theme);
  const toggleTheme = useWorkspaceStore((s) => s.toggleTheme);
  const retryWorkspaceLoad = useWorkspaceStore((s) => s.retryWorkspaceLoad);
  const setSettingsOpen = useWorkspaceStore((s) => s.setSettingsOpen);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-surface-container-lowest"
      data-testid="backend-unavailable-gate"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b meridian-crisp-border bg-surface px-4">
        <MeridianWordmark />
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="theme-toggle"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            onClick={toggleTheme}
          >
            <MaterialIcon
              name={theme === "dark" ? "light_mode" : "dark_mode"}
              className="text-[18px]"
              aria-hidden
            />
          </button>
          <button
            type="button"
            aria-label="Settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            onClick={() => setSettingsOpen(true)}
          >
            <MaterialIcon name="settings" className="text-[18px]" aria-hidden />
          </button>
        </div>
      </header>

      <div
        className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
        role="alert"
        data-testid="backend-unavailable-banner"
      >
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-error/10 text-error">
          <MaterialIcon name="cloud_off" className="text-[28px]" aria-hidden />
        </span>
        <div className="max-w-md space-y-2">
          <h1 className="text-lg font-semibold text-on-surface">Can&apos;t reach Meridian</h1>
          <p className="text-sm leading-relaxed text-on-surface-variant">
            The workspace server is unavailable. Your files are not loaded until the connection
            is restored — we won&apos;t open a local demo workspace.
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            data-testid="backend-retry-button"
            className="btn-primary inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold"
            onClick={() => retryWorkspaceLoad()}
          >
            <MaterialIcon name="refresh" className="text-[16px]" aria-hidden />
            Try again
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border meridian-crisp-border bg-surface-container px-3.5 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-high"
            onClick={() => navigate("/", { replace: true })}
          >
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}
