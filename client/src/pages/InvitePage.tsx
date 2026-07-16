import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MaterialIcon } from "../components/ui/MaterialIcon";
import { acceptInvite, getCurrentUser, getInvite } from "../lib/api";
import type { ApiInviteDetails, ApiUser } from "../lib/apiTypes";

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

function PrimaryButton({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function UnauthenticatedState({
  invite,
  inviteId,
}: {
  invite: ApiInviteDetails | null;
  inviteId: string;
}) {
  const navigate = useNavigate();
  // Send the user to auth with a redirect back here, so after signing in they
  // land on this invite page (now authenticated) and can accept in one step.
  const goToAuth = (): void => {
    navigate(`/?redirect=${encodeURIComponent(`/invite/${inviteId}`)}`);
  };

  return (
    <PageShell>
      <div className="mb-5 text-center">
        <MaterialIcon name="group_add" className="text-[36px] text-primary" aria-hidden />
        <h1 className="mt-2 text-base font-semibold text-on-surface">
          {invite !== null
            ? `You've been invited to "${invite.workspaceName}"`
            : "You've been invited to a workspace"}
        </h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          {invite !== null
            ? `${invite.invitedByName} invited you to collaborate as ${invite.role.toLowerCase()}.`
            : "Sign in or create an account to accept this invite and start collaborating."}
        </p>
      </div>

      <PrimaryButton onClick={goToAuth}>
        Sign In / Sign Up
        <MaterialIcon name="arrow_forward" className="text-[16px]" aria-hidden />
      </PrimaryButton>

      <p className="mt-4 text-center text-[10px] text-on-surface-variant/50">
        Sign in, then reopen this invite link to join the workspace.
      </p>
    </PageShell>
  );
}

function AuthenticatedState({
  user,
  invite,
  inviteId,
}: {
  user: ApiUser;
  invite: ApiInviteDetails | null;
  inviteId: string;
}) {
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRealInvite = invite !== null && !invite.expired && !invite.used;

  const handleAccept = async (): Promise<void> => {
    if (!isRealInvite) {
      navigate("/workspace");
      return;
    }
    setAccepting(true);
    setError(null);
    try {
      const acceptedInvite = await acceptInvite(inviteId);
      navigate(`/workspace/${encodeURIComponent(acceptedInvite.workspaceId)}`);
    } catch {
      setError(
        "Could not accept this invite. It may have expired, already been used, or been sent to a different email.",
      );
      setAccepting(false);
    }
  };

  return (
    <PageShell>
      <div className="mb-5 text-center">
        <MaterialIcon
          name={
            invite?.expired === true || invite?.used === true
              ? "schedule"
              : "check_circle"
          }
          className="text-[36px] text-primary"
          aria-hidden
        />
        <h1 className="mt-2 text-base font-semibold text-on-surface">
          {invite !== null ? `Join "${invite.workspaceName}"` : "Accept Invite"}
        </h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          You're joining as{" "}
          <span className="font-semibold text-on-surface">{user.displayName}</span>
          {invite !== null ? (
            <>
              {" "}
              with <span className="font-semibold text-on-surface">
                {invite.role.toLowerCase()}
              </span>{" "}
              access, invited by {invite.invitedByName}.
            </>
          ) : (
            "."
          )}
        </p>
        {invite?.expired === true ? (
          <p className="mt-2 text-xs text-error">
            This invite has expired. Ask for a new invite link.
          </p>
        ) : null}
        {invite?.used === true ? (
          <p className="mt-2 text-xs text-error">
            This invite has already been used. Ask for a new invite link.
          </p>
        ) : null}
        {invite === null ? (
          <p className="mt-2 text-[10px] text-on-surface-variant/60">
            This invite link could not be verified — you can still open your own
            workspace.
          </p>
        ) : null}
        {error !== null ? <p className="mt-2 text-xs text-error">{error}</p> : null}
      </div>

      <PrimaryButton
        onClick={() => void handleAccept()}
        disabled={accepting || invite?.expired === true || invite?.used === true}
      >
        {accepting ? "Joining…" : isRealInvite ? "Accept & Open Workspace" : "Go to Workspace"}
        <MaterialIcon name="arrow_forward" className="text-[16px]" aria-hidden />
      </PrimaryButton>
    </PageShell>
  );
}

export function InvitePage() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [user, setUser] = useState<ApiUser | null>(null);
  const [invite, setInvite] = useState<ApiInviteDetails | null>(null);

  const displayInviteId = inviteId ?? "unknown";

  useEffect(() => {
    let mounted = true;

    async function load(): Promise<void> {
      // Resolve both requests before showing an actionable screen. Otherwise a
      // fast auth response can briefly render a generic button that skips the
      // still-loading invite acceptance request.
      const inviteRequest =
        inviteId !== undefined ? getInvite(inviteId) : Promise.resolve(null);
      const [inviteResult, userResult] = await Promise.allSettled([
        inviteRequest,
        getCurrentUser(),
      ]);
      if (!mounted) return;

      setInvite(inviteResult.status === "fulfilled" ? inviteResult.value : null);
      if (userResult.status === "fulfilled") {
        setUser(userResult.value);
        setLoadState("authenticated");
      } else {
        setLoadState("unauthenticated");
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [inviteId]);

  if (loadState === "loading") {
    return <LoadingState />;
  }

  if (loadState === "unauthenticated" || user === null) {
    return <UnauthenticatedState invite={invite} inviteId={displayInviteId} />;
  }

  return <AuthenticatedState user={user} invite={invite} inviteId={displayInviteId} />;
}
