import { useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { MeridianWordmark } from "../ui/MeridianWordmark";
import { MaterialIcon } from "../ui/MaterialIcon";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";

/** Shared identity and scrolling behavior for every account entry point. */
export function AccountLayout({ children, action, introduction = false }: {
  children: ReactNode;
  action?: ReactNode;
  introduction?: boolean;
}) {
  const theme = useWorkspaceStore((state) => state.theme);
  const toggleTheme = useWorkspaceStore((state) => state.toggleTheme);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return (
    <div className="account-page h-dvh overflow-y-auto bg-background text-on-background" data-testid="account-layout">
      <div className="mx-auto flex min-h-full max-w-[1200px] flex-col px-6 sm:px-10">
        <header className="flex min-h-20 shrink-0 items-center justify-between gap-4 border-b meridian-crisp-border">
          <Link to="/" aria-label="Meridian home" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <MeridianWordmark />
          </Link>
          <div className="flex items-center gap-3 text-body-sm">
            {action}
            <button type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="flex h-11 w-11 items-center justify-center rounded text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <MaterialIcon name={theme === "dark" ? "light_mode" : "dark_mode"} aria-hidden />
            </button>
          </div>
        </header>
        <main className="flex flex-1 items-center py-10 sm:py-16">
          <div className={introduction ? "grid w-full items-center gap-14 lg:grid-cols-[1fr_400px] lg:gap-24" : "mx-auto w-full max-w-[400px]"}>
            {introduction && (
              <section className="hidden max-w-[480px] lg:block" aria-labelledby="account-introduction">
                <p className="mb-6 font-mono text-xs text-on-surface-variant">A shared code workspace</p>
                <h2 id="account-introduction" className="text-[56px] font-medium leading-[1.08] tracking-[-0.045em]">Write code<br />together.</h2>
                <p className="mt-6 max-w-[370px] text-base leading-7 text-on-surface-variant">
                  Open a file, invite your team, and work in the same editor. See changes as they happen and keep the conversation beside your code.
                </p>
                <div className="mt-12 border-t meridian-crisp-border pt-5 text-body-sm leading-6 text-on-surface-variant">
                  <span className="font-medium text-on-surface">A history you can return to.</span><br />
                  Save a version. Compare changes. Restore when you need to.
                </div>
              </section>
            )}
            <div className="account-form mx-auto w-full max-w-[400px]">{children}</div>
          </div>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t meridian-crisp-border py-5 text-xs text-on-surface-variant">
          <span>© {new Date().getFullYear()} Meridian</span>
          <span>Code. Conversation. A shared history.</span>
        </footer>
      </div>
    </div>
  );
}
