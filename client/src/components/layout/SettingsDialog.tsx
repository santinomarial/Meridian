import { useEffect, useState } from "react";
import { MaterialIcon } from "../ui/MaterialIcon";
import { toast } from "../ui/Toast";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { forgotPassword, updateProfile } from "../../lib/api";

/**
 * Real settings panel. Everything here is backed by actual state or backend
 * calls — there are no placeholder controls:
 *  - Display name: persisted via PATCH /users/:id
 *  - Email: shown read-only (changing the login email is not supported yet)
 *  - Theme: real, persisted toggle
 *  - Password: triggers the real password-reset email flow
 */
export function SettingsDialog() {
  const isOpen = useWorkspaceStore((s) => s.isSettingsOpen);
  // The body mounts fresh each time the dialog opens, so its local state is
  // seeded from the current user on mount — no syncing effect required.
  if (!isOpen) return null;
  return <SettingsDialogBody />;
}

function SettingsDialogBody() {
  const setSettingsOpen = useWorkspaceStore((s) => s.setSettingsOpen);
  const currentUser = useWorkspaceStore((s) => s.currentUser);
  const setCurrentUser = useWorkspaceStore((s) => s.setCurrentUser);
  const theme = useWorkspaceStore((s) => s.theme);
  const toggleTheme = useWorkspaceStore((s) => s.toggleTheme);
  const addNotification = useWorkspaceStore((s) => s.addNotification);

  const [displayName, setDisplayName] = useState(currentUser?.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setSettingsOpen]);

  const trimmedName = displayName.trim();
  const canSaveName =
    currentUser !== null && trimmedName.length > 0 && trimmedName !== currentUser.displayName;

  const handleSaveName = async (): Promise<void> => {
    if (currentUser === null || !canSaveName) return;
    setSaving(true);
    try {
      const updated = await updateProfile(currentUser.id, { displayName: trimmedName });
      setCurrentUser({
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
      });
      addNotification({ icon: "badge", text: "Display name updated" });
      toast("Profile updated.", "success");
    } catch {
      toast("Could not update profile — try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordReset = async (): Promise<void> => {
    if (currentUser === null) return;
    try {
      await forgotPassword({ email: currentUser.email });
    } catch {
      // The endpoint always returns success to avoid leaking account existence;
      // a network failure is the only real error and is non-fatal here.
    }
    setResetSent(true);
    toast("Password reset email sent if the account exists.", "info");
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      data-testid="settings-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSettingsOpen(false);
      }}
    >
      <div className="w-full max-w-md rounded-xl border meridian-crisp-border bg-surface-container shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b meridian-crisp-border px-4 py-3">
          <div className="flex items-center gap-2">
            <MaterialIcon name="settings" className="text-[18px] text-primary" aria-hidden />
            <h2 className="text-sm font-semibold text-on-surface">Settings</h2>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="rounded p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="Close settings"
            data-testid="settings-close"
          >
            <MaterialIcon name="close" className="text-[18px]" aria-hidden />
          </button>
        </div>

        <div className="space-y-5 px-4 py-4">
          {/* Profile */}
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
              Profile
            </h3>
            {currentUser !== null ? (
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="settings-display-name"
                    className="mb-1 block text-xs text-on-surface-variant"
                  >
                    Display name
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="settings-display-name"
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="min-w-0 flex-1 rounded-md border meridian-crisp-border bg-surface-container-lowest px-2.5 py-1.5 text-sm text-on-surface outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
                      data-testid="settings-display-name"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveName()}
                      disabled={!canSaveName || saving}
                      className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-40"
                      data-testid="settings-save-name"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-on-surface-variant">Email</label>
                  <div
                    className="rounded-md border meridian-crisp-border bg-surface-container-highest px-2.5 py-1.5 text-sm text-on-surface-variant"
                    data-testid="settings-email"
                  >
                    {currentUser.email}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-on-surface-variant">
                Sign in to manage your profile. Profile settings are unavailable in offline
                demo mode.
              </p>
            )}
          </section>

          {/* Appearance */}
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
              Appearance
            </h3>
            <div className="flex items-center justify-between rounded-md border meridian-crisp-border bg-surface-container-lowest px-2.5 py-2">
              <span className="text-sm text-on-surface">Theme</span>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex items-center gap-1.5 rounded-md bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container-highest"
                data-testid="settings-theme-toggle"
              >
                <MaterialIcon
                  name={theme === "dark" ? "dark_mode" : "light_mode"}
                  className="text-[14px]"
                  aria-hidden
                />
                {theme === "dark" ? "Dark" : "Light"}
              </button>
            </div>
          </section>

          {/* Security */}
          {currentUser !== null ? (
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Security
              </h3>
              <div className="flex items-center justify-between rounded-md border meridian-crisp-border bg-surface-container-lowest px-2.5 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-on-surface">Password</div>
                  <div className="text-[11px] text-on-surface-variant">
                    We'll email you a secure reset link.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handlePasswordReset()}
                  disabled={resetSent}
                  className="shrink-0 rounded-md bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container-highest disabled:opacity-50"
                  data-testid="settings-reset-password"
                >
                  {resetSent ? "Email sent" : "Reset password"}
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
