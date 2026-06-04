import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MaterialIcon } from "../components/ui/MaterialIcon";
import { getCurrentUser } from "../lib/api";
import type { ApiUser } from "../lib/apiTypes";

type LoadState = "loading" | "authenticated" | "unauthenticated";

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-dim px-4">
      {/* Meridian wordmark */}
      <div className="mb-8 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-primary">
          <MaterialIcon name="polymer" className="text-xl text-on-primary" aria-hidden />
        </div>
        <span className="text-xl font-bold text-on-surface">Meridian</span>
      </div>
      <div className="w-full max-w-sm rounded-xl border meridian-crisp-border bg-surface-container p-6 shadow-xl">
        {children}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <PageShell>
      <div className="flex flex-col items-center gap-3 py-4">
        <MaterialIcon
          name="autorenew"
          className="animate-spin text-[28px] text-on-surface-variant"
          aria-hidden
        />
        <p className="text-sm text-on-surface-variant">Checking your session…</p>
      </div>
    </PageShell>
  );
}

function UnauthenticatedState({ inviteId }: { inviteId: string }) {
  const navigate = useNavigate();

  return (
    <PageShell>
      <div className="mb-5 text-center">
        <MaterialIcon name="group_add" className="text-[36px] text-primary" aria-hidden />
        <h1 className="mt-2 text-base font-semibold text-on-surface">
          You've been invited to a workspace
        </h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Sign in or create an account to accept this invite and start collaborating.
        </p>
      </div>

      <button
        type="button"
        onClick={() => navigate("/")}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary/90 active:scale-[0.98]"
      >
        Sign In / Sign Up
        <MaterialIcon name="arrow_forward" className="text-[16px]" aria-hidden />
      </button>

      <p className="mt-4 text-center text-[10px] text-on-surface-variant/50">
        Invite ID: {inviteId}
      </p>
    </PageShell>
  );
}

function AuthenticatedState({ user, inviteId }: { user: ApiUser; inviteId: string }) {
  const navigate = useNavigate();

  return (
    <PageShell>
      <div className="mb-5 text-center">
        <MaterialIcon name="check_circle" className="text-[36px] text-primary" aria-hidden />
        <h1 className="mt-2 text-base font-semibold text-on-surface">Accept Invite</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          You're joining as{" "}
          <span className="font-semibold text-on-surface">{user.displayName}</span>.
        </p>
        {/*
         * TODO: call POST /invites/:token/accept when backend invite API is
         * available, then add the user as a WorkspaceMember with the invite's
         * role before navigating to the workspace.
         */}
        <p className="mt-2 text-[10px] text-on-surface-variant/60">
          Demo mode — invite acceptance is not yet persisted to the backend.
        </p>
      </div>

      <button
        type="button"
        onClick={() => navigate("/workspace")}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary/90 active:scale-[0.98]"
      >
        Go to Workspace
        <MaterialIcon name="arrow_forward" className="text-[16px]" aria-hidden />
      </button>

      <p className="mt-4 text-center text-[10px] text-on-surface-variant/50">
        Invite ID: {inviteId}
      </p>
    </PageShell>
  );
}

export function InvitePage() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [user, setUser] = useState<ApiUser | null>(null);

  const displayInviteId = inviteId ?? "unknown";

  useEffect(() => {
    let mounted = true;
    getCurrentUser()
      .then((u) => {
        if (!mounted) return;
        setUser(u);
        setLoadState("authenticated");
      })
      .catch(() => {
        if (!mounted) return;
        setLoadState("unauthenticated");
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loadState === "loading") {
    return <LoadingState />;
  }

  if (loadState === "unauthenticated" || user === null) {
    return <UnauthenticatedState inviteId={displayInviteId} />;
  }

  return <AuthenticatedState user={user} inviteId={displayInviteId} />;
}
