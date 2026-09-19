import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { AccountLayout } from "../components/layout/AccountLayout";
import { MaterialIcon } from "../components/ui/MaterialIcon";
import { PasswordInput } from "../components/ui/PasswordInput";
import { PasswordStrength } from "../components/ui/PasswordStrength";
import { resetPassword } from "../lib/api";
import { getAuthErrorMessage } from "../lib/authErrors";
import { getPasswordRequirements } from "../lib/passwordPolicy";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (loading) return;
    setError(null);

    const unmet = getPasswordRequirements(password).filter((r) => !r.met);
    if (unmet.length > 0) {
      setError(
        `Password must include: ${unmet.map((r) => r.label.toLowerCase()).join(", ")}.`,
      );
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await resetPassword({ token: token ?? "", password });
      setSuccess(true);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AccountLayout>

      <div
        className="flex w-full flex-col gap-7"
        data-testid="reset-password-card"
      >
        {success ? (
          <SuccessView />
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-[28px] font-medium tracking-tight text-on-surface">
                Choose a new password
              </h1>
              <p className="text-body-sm text-on-surface-variant">
                Enter a strong password to secure your account.
              </p>
            </div>

            <form
              className="space-y-4"
              onSubmit={handleSubmit}
              autoComplete="on"
              noValidate
              data-testid="reset-password-form"
            >
              <PasswordField
                id="new-password"
                label="New Password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
              />
              {password ? <PasswordStrength password={password} /> : null}

              <PasswordField
                id="confirm-password"
                label="Confirm Password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
              />

              {error !== null ? (
                <div
                  role="alert"
                  className="rounded-md bg-error/10 px-3 py-2 text-[12px] text-error"
                  data-testid="reset-error"
                >
                  <p>{error}</p>
                  {/* Invalid/expired token: offer a way back to the forgot form */}
                  {isTokenError(error) ? (
                    <Link
                      to="/forgot-password"
                      className="mt-1 block text-accent hover:underline"
                      data-testid="back-to-forgot"
                    >
                      Request a new reset link
                    </Link>
                  ) : null}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                data-testid="reset-submit"
                className="group mt-4 flex w-full items-center justify-center gap-2 rounded-md btn-primary py-3 text-body-md font-semibold transition-colors disabled:opacity-60"
              >
                {loading ? "Resetting…" : "Reset password"}
                {!loading ? (
                  <MaterialIcon
                    name="arrow_forward"
                    className="text-lg transition-transform group-hover:translate-x-1"
                    aria-hidden
                  />
                ) : null}
              </button>
            </form>
          </>
        )}
      </div>
    </AccountLayout>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SuccessView() {
  return (
    <div className="space-y-6 text-center" data-testid="reset-success">
      <div>
        <MaterialIcon
          name="check_circle"
          className="mb-3 text-5xl text-primary"
          aria-hidden
        />
        <h2 className="text-headline-md font-semibold text-on-surface">
          Password updated
        </h2>
        <p className="mt-2 text-body-sm text-on-surface-variant">
          Log in with your new password to return to your workspace.
        </p>
      </div>
      <Link
        to="/"
        data-testid="back-to-login"
        className="inline-flex items-center gap-2 rounded-md btn-primary px-6 py-3 text-body-md font-semibold transition-colors"
      >
        <MaterialIcon name="login" className="text-lg" aria-hidden />
        Log in
      </Link>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-body-sm font-medium text-on-surface">
        {label}
      </label>
      <PasswordInput
        id={id}
        name={id}
        label={label.toLowerCase()}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
      />
    </div>
  );
}

function isTokenError(message: string): boolean {
  return message.toLowerCase().includes("invalid") || message.toLowerCase().includes("expired");
}
