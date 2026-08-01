import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { MaterialIcon } from "../components/ui/MaterialIcon";
import { verifyEmail } from "../lib/api";
import { getAuthErrorMessage } from "../lib/authErrors";

type VerificationState = "ready" | "verifying" | "verified" | "error";

export function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<VerificationState>("ready");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    let theme: "light" | "dark" = "dark";
    try {
      if (localStorage.getItem("meridian-theme") === "light") theme = "light";
    } catch {
      // localStorage unavailable; retain the dark default.
    }
    html.classList.toggle("dark", theme === "dark");
    html.style.colorScheme = theme;
  }, []);

  const handleVerify = async (): Promise<void> => {
    if (state === "verifying" || state === "verified") return;
    setState("verifying");
    setError(null);
    try {
      await verifyEmail({ token: token ?? "" });
      setState("verified");
    } catch (err) {
      setError(getAuthErrorMessage(err));
      setState("error");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-on-background">
      <div
        className="glass-panel inner-glow w-full max-w-[420px] rounded-xl p-8 text-center"
        data-testid="verify-email-card"
      >
        <div className="mb-7 flex items-center justify-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary">
            <MaterialIcon name="polymer" className="text-xl text-on-primary" aria-hidden />
          </div>
          <span className="text-display-lg font-bold text-on-surface">Meridian</span>
        </div>

        {state === "verified" ? (
          <div data-testid="verify-email-success">
            <MaterialIcon name="verified" className="text-5xl text-primary" aria-hidden />
            <h1 className="mt-3 text-headline-sm font-semibold text-on-surface">
              Email verified
            </h1>
            <p className="mt-2 text-body-sm text-on-surface-variant">
              Your account is active and a secure session has been created.
            </p>
            <button
              type="button"
              onClick={() => navigate("/workspace", { replace: true })}
              className="mt-6 inline-flex items-center gap-2 rounded-lg btn-primary px-6 py-3 text-body-md font-semibold"
              data-testid="open-workspace"
            >
              Open Workspace
              <MaterialIcon name="arrow_forward" className="text-lg" aria-hidden />
            </button>
          </div>
        ) : (
          <div>
            <MaterialIcon name="mark_email_read" className="text-5xl text-primary" aria-hidden />
            <h1 className="mt-3 text-headline-sm font-semibold text-on-surface">
              Confirm your email
            </h1>
            <p className="mt-2 text-body-sm text-on-surface-variant">
              Complete verification to activate your Meridian account. The link can be used only once.
            </p>

            {error !== null ? (
              <div
                className="mt-4 rounded-lg bg-error/10 px-3 py-2 text-xs text-error"
                role="alert"
                data-testid="verify-email-error"
              >
                {error}
              </div>
            ) : null}

            <button
              type="button"
              disabled={state === "verifying" || token === undefined}
              onClick={() => void handleVerify()}
              className="mt-6 w-full rounded-lg btn-primary px-4 py-3 text-body-md font-semibold disabled:opacity-60"
              data-testid="verify-email-submit"
            >
              {state === "verifying" ? "Verifying…" : "Verify email"}
            </button>
            {state === "error" ? (
              <Link
                to="/"
                className="mt-4 inline-block text-body-sm text-accent hover:underline"
                data-testid="request-new-verification"
              >
                Log in to request a new link
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
