import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AccountLayout } from "../components/layout/AccountLayout";
import { MaterialIcon } from "../components/ui/MaterialIcon";
import { verifyEmail } from "../lib/api";
import { getAuthErrorMessage } from "../lib/authErrors";

type VerificationState = "ready" | "verifying" | "verified" | "error";

export function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<VerificationState>("ready");
  const [error, setError] = useState<string | null>(null);

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
    <AccountLayout>
      <div
        className="w-full text-left"
        data-testid="verify-email-card"
      >
        {state === "verified" ? (
          <div data-testid="verify-email-success">
            <MaterialIcon name="verified" className="text-3xl text-primary" aria-hidden />
            <h1 className="mt-3 text-headline-md font-semibold text-on-surface">
              Email verified
            </h1>
            <p className="mt-2 text-body-sm text-on-surface-variant">
              You’re signed in. Your workspace is ready.
            </p>
            <button
              type="button"
              onClick={() => navigate("/workspace", { replace: true })}
              className="mt-6 inline-flex items-center gap-2 rounded-md btn-primary px-6 py-3 text-body-md font-semibold"
              data-testid="open-workspace"
            >
              Open Workspace
              <MaterialIcon name="arrow_forward" className="text-lg" aria-hidden />
            </button>
          </div>
        ) : (
          <div>
            <MaterialIcon name="mark_email_read" className="text-3xl text-primary" aria-hidden />
            <h1 className="mt-3 text-headline-md font-semibold text-on-surface">
              Confirm your email
            </h1>
            <p className="mt-2 text-body-sm text-on-surface-variant">
              Verify this address to finish creating your account.
            </p>

            {error !== null ? (
              <div
                className="mt-4 rounded-md bg-error/10 px-3 py-2 text-xs text-error"
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
              className="mt-6 w-full rounded-md btn-primary px-4 py-3 text-body-md font-semibold disabled:opacity-60"
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
    </AccountLayout>
  );
}
