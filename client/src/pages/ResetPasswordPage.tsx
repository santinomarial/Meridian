import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { MaterialIcon } from "../components/ui/MaterialIcon";
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

  // Match landing: respect the user's saved light/dark preference.
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

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-body-md text-on-background">
      <AmbientBackground />

      <div
        className="glass-panel inner-glow relative z-10 flex w-full max-w-[420px] flex-col gap-8 rounded-xl p-8"
        data-testid="reset-password-card"
      >
        {/* Branding */}
        <div className="flex items-center justify-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary">
            <MaterialIcon name="polymer" className="text-xl text-on-primary" aria-hidden />
          </div>
          <span className="text-display-lg font-bold text-on-surface">Meridian</span>
        </div>

        {success ? (
          <SuccessView />
        ) : (
          <>
            <div className="space-y-2 text-center">
              <div className="mb-2 inline-flex items-center justify-center rounded border border-outline-variant/50 bg-surface-container px-2 py-0.5 uppercase text-on-surface-variant label-caps">
                Reset Password
              </div>
              <h1 className="text-headline-md font-semibold tracking-tight text-on-surface">
                Choose a new password
              </h1>
              <p className="text-body-sm text-on-surface-variant">
                Enter a strong password to secure your account.
              </p>
            </div>

            <form
              className="space-y-4"
              onSubmit={handleSubmit}
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
                  className="rounded-lg bg-error/10 px-3 py-2 text-[12px] text-error"
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
                className="group mt-4 flex w-full items-center justify-center gap-2 rounded-lg btn-primary py-3 text-body-md font-semibold shadow-lg shadow-primary/15 transition-all active:scale-[0.98] disabled:opacity-60"
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
    </div>
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
        <h2 className="text-headline-sm font-semibold text-on-surface">
          Password updated!
        </h2>
        <p className="mt-2 text-body-sm text-on-surface-variant">
          Your password has been reset successfully. You can now log in with
          your new password.
        </p>
      </div>
      <Link
        to="/"
        data-testid="back-to-login"
        className="inline-flex items-center gap-2 rounded-lg btn-primary px-6 py-3 text-body-md font-semibold transition-all active:scale-[0.98]"
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
      <label htmlFor={id} className="label-caps ml-1 text-on-surface-variant">
        {label}
      </label>
      <div className="group relative">
        <MaterialIcon
          name="lock"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant transition-colors group-focus-within:text-primary"
          aria-hidden
        />
        <input
          id={id}
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          autoComplete={autoComplete}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-4 text-body-md text-on-surface outline-none transition-all placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-2 focus:ring-primary/25"
        />
      </div>
    </div>
  );
}

function AmbientBackground() {
  const primaryRef = useRef<HTMLDivElement>(null);
  const secondaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const x = event.clientX / window.innerWidth;
      const y = event.clientY / window.innerHeight;
      if (primaryRef.current) {
        primaryRef.current.style.transform = `translate(${x * 20}px, ${y * 20}px)`;
      }
      if (secondaryRef.current) {
        secondaryRef.current.style.transform = `translate(${-x * 30}px, ${-y * 30}px)`;
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        ref={primaryRef}
        className="absolute -left-[10%] -top-[20%] h-[60%] w-[60%] rounded-full bg-primary/5 blur-[120px]"
      />
      <div
        ref={secondaryRef}
        className="absolute -right-[10%] top-[40%] h-[50%] w-[50%] rounded-full bg-secondary/5 blur-[100px]"
      />
    </div>
  );
}

function isTokenError(message: string): boolean {
  return message.toLowerCase().includes("invalid") || message.toLowerCase().includes("expired");
}
