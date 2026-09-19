import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { MaterialIcon } from "../components/ui/MaterialIcon";
import { AccountLayout } from "../components/layout/AccountLayout";
import { PasswordStrength } from "../components/ui/PasswordStrength";
import {
  ApiError,
  forgotPassword,
  login,
  register,
  resendEmailVerification,
} from "../lib/api";
import { getAuthErrorMessage } from "../lib/authErrors";
import { getPasswordRequirements } from "../lib/passwordPolicy";

type AuthMode = "signup" | "signin" | "forgot";

/**
 * Returns a safe in-app redirect target from the ?redirect= query param.
 * Only same-origin relative paths are allowed (must start with a single "/")
 * to prevent open-redirects to external sites.
 */
function getSafeRedirect(): string {
  const target = new URLSearchParams(window.location.search).get("redirect");
  if (target !== null && target.startsWith("/") && !target.startsWith("//")) {
    return target;
  }
  return "/workspace";
}

type IconFieldProps = {
  id: string;
  name?: string;
  label: string;
  icon: string;
  type?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
};

function IconField({
  id,
  name,
  label,
  icon,
  type = "text",
  placeholder,
  value,
  onChange,
  autoComplete,
}: IconFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-body-sm font-medium text-on-surface">
        {label}
      </label>
      <div className="group relative">
        <MaterialIcon
          name={icon}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant transition-colors group-focus-within:text-primary"
          aria-hidden
        />
        <input
          id={id}
          name={name ?? id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full rounded-md border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-4 text-body-md text-on-surface outline-none transition-all placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-2 focus:ring-primary/25"
        />
      </div>
    </div>
  );
}


function AuthCard({
  mode,
  onModeChange,
  initialEmail = "",
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode, email?: string) => void;
  initialEmail?: string;
}) {
  const navigate = useNavigate();
  const prevModeRef = useRef<AuthMode | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [previewResetUrl, setPreviewResetUrl] = useState<string | null>(null);
  const [verificationPendingEmail, setVerificationPendingEmail] = useState<string | null>(null);
  const [previewVerificationUrl, setPreviewVerificationUrl] = useState<string | null>(null);
  const [verificationDeliveryFailed, setVerificationDeliveryFailed] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);

  // Keep email when switching signin ↔ forgot so the forgot-password form is pre-filled.
  // Clear email for all other transitions (entering/leaving signup).
  useEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = mode;
    if (prevMode === null || prevMode === mode) return;
    const keepEmail =
      (prevMode === "signin" && mode === "forgot") ||
      (prevMode === "forgot" && mode === "signin");
    // Intentional reset of form fields on auth-mode transitions.
    setName("");
    setPassword("");
    setConfirmPassword("");
    setError(null);
    setForgotSuccess(false);
    setVerificationPendingEmail(null);
    setPreviewVerificationUrl(null);
    setVerificationDeliveryFailed(false);
    setVerificationNotice(null);
    if (!keepEmail) {
      setEmail("");
    }
  }, [mode]);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (mode === "forgot") {
      setLoading(true);
      setPreviewResetUrl(null);
      try {
        const result = await forgotPassword({ email });
        if (result.previewResetUrl) {
          setPreviewResetUrl(result.previewResetUrl);
        }
        // A completed request uses generic copy without revealing account existence.
        setForgotSuccess(true);
      } catch {
        setError("Unable to send reset link right now. Please try again later.");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === "signup") {
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
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        const result = await register({ email, password, displayName: name });
        if (result.verificationRequired === true) {
          setVerificationPendingEmail(result.user.email);
          setPreviewVerificationUrl(result.previewVerificationUrl ?? null);
          setVerificationDeliveryFailed(!result.emailDelivered);
          return;
        }
      } else {
        await login({ email, password });
      }
      navigate(getSafeRedirect());
    } catch (err) {
      if (
        mode === "signin" &&
        err instanceof ApiError &&
        err.status === 403 &&
        /email verification required/i.test(err.message)
      ) {
        setVerificationPendingEmail(email.trim().toLowerCase());
        setVerificationDeliveryFailed(false);
        return;
      }
      setError(getAuthErrorMessage(err, { invalidCredentialsFor401: mode === "signin" }));
    } finally {
      setLoading(false);
    }
  };

  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";

  const handleResendVerification = async (): Promise<void> => {
    if (verificationPendingEmail === null) return;
    setResendingVerification(true);
    setVerificationNotice(null);
    try {
      const result = await resendEmailVerification(verificationPendingEmail);
      setPreviewVerificationUrl(result.previewVerificationUrl ?? null);
      setVerificationDeliveryFailed(false);
      setVerificationNotice("Check your inbox for a new verification link.");
    } catch (err) {
      setVerificationNotice(getAuthErrorMessage(err));
    } finally {
      setResendingVerification(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-7" data-testid="auth-card">
      <div className="space-y-2">
        <h1 className="text-[28px] font-medium tracking-tight text-on-surface">
          {isSignUp ? "Create an account" : isForgot ? "Forgot your password?" : "Log in"}
        </h1>
        <p className="text-body-sm text-on-surface-variant">
          {isSignUp
            ? "Your first workspace is ready when you are."
            : isForgot
              ? "Enter your email and we'll send you a reset link."
              : "Pick up where you and your team left off."}
        </p>
      </div>

      {verificationPendingEmail !== null ? (
        <div
          className="rounded-md border border-outline-variant/40 bg-surface-container-low px-4 py-5 text-center"
          data-testid="verification-pending"
        >
          <MaterialIcon name="mark_email_unread" className="mb-3 text-4xl text-primary" aria-hidden />
          <h2 className="text-body-md font-semibold text-on-surface">Verify your email</h2>
          <p className="mt-2 text-body-sm text-on-surface-variant">
            {previewVerificationUrl !== null
              ? "Email verification is enabled locally. Use the preview link below."
              : verificationDeliveryFailed
                ? "Your account is ready, but we couldn’t send the email. Try requesting a new link."
                : `We sent a verification link to ${verificationPendingEmail}.`}
          </p>
          {previewVerificationUrl !== null ? (
            <a
              href={previewVerificationUrl}
              className="mt-3 inline-block break-all text-body-sm text-accent underline underline-offset-2"
              data-testid="verification-preview-link"
            >
              Open verification link
            </a>
          ) : null}
          {verificationNotice !== null ? (
            <p className="mt-3 text-xs text-on-surface-variant" role="status">
              {verificationNotice}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              disabled={resendingVerification}
              onClick={() => void handleResendVerification()}
              className="rounded-md btn-primary px-4 py-2.5 text-body-sm font-semibold disabled:opacity-60"
              data-testid="resend-verification"
            >
              {resendingVerification ? "Sending…" : "Resend verification link"}
            </button>
            <button
              type="button"
              onClick={() => {
                setVerificationPendingEmail(null);
                setPreviewVerificationUrl(null);
                onModeChange("signin", verificationPendingEmail);
              }}
              className="text-body-sm text-accent hover:underline"
              data-testid="verification-back-to-login"
            >
              Back to Log in
            </button>
          </div>
        </div>
      ) : isForgot && forgotSuccess ? (
        <div className="rounded-md border border-outline-variant/40 bg-surface-container-low px-4 py-5 text-center" data-testid="forgot-success">
          <MaterialIcon name="mark_email_read" className="mb-3 text-4xl text-primary" aria-hidden />
          <p className="text-body-sm text-on-surface">
            {previewResetUrl
              ? "No email provider is configured locally. Use this reset link:"
              : "If an account exists for this email, a reset link has been sent."}
          </p>
          {previewResetUrl ? (
            <a
              href={previewResetUrl}
              className="mt-3 inline-block break-all text-body-sm text-accent underline underline-offset-2"
              data-testid="forgot-preview-link"
            >
              Open reset link
            </a>
          ) : null}
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={handleSubmit}
          autoComplete="on"
          noValidate
          data-testid="auth-form"
        >
          {isSignUp ? (
            <IconField
              id="name"
              label="Full Name"
              icon="person"
              placeholder="Your name"
              value={name}
              onChange={(v) => setName(v)}
              autoComplete="name"
            />
          ) : null}

          <IconField
            id="email"
            name={isForgot ? "email" : "username"}
            label="Email Address"
            icon="alternate_email"
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={(v) => setEmail(v)}
            autoComplete={isForgot ? "email" : "username"}
          />

          {!isForgot ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="password" className="text-body-sm font-medium text-on-surface">
                  Password
                </label>
                {!isSignUp ? (
                  <button
                    type="button"
                    onClick={() => onModeChange("forgot", email)}
                    className="text-body-sm text-accent hover:underline"
                    data-testid="forgot-password-link"
                  >
                    Forgot password?
                  </button>
                ) : null}
              </div>
              <div className="group relative">
                <MaterialIcon
                  name="lock"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant transition-colors group-focus-within:text-primary"
                  aria-hidden
                />
                <input
                  id="password"
                  name="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  className="w-full rounded-md border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-4 text-body-md text-on-surface outline-none transition-all placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-2 focus:ring-primary/25"
                />
              </div>
              {isSignUp ? <PasswordStrength password={password} /> : null}
            </div>
          ) : null}

          {isSignUp ? (
            <div className="space-y-1.5">
              <label
                htmlFor="confirm-password"
                className="text-body-sm font-medium text-on-surface"
              >
                Confirm Password
              </label>
              <div className="group relative">
                <MaterialIcon
                  name="lock"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant transition-colors group-focus-within:text-primary"
                  aria-hidden
                />
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="w-full rounded-md border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-4 text-body-md text-on-surface outline-none transition-all placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-2 focus:ring-primary/25"
                />
              </div>
            </div>
          ) : null}

          {error !== null ? (
            <div role="alert" className="rounded-md bg-error/10 px-3 py-2 text-[12px] text-error" data-testid="auth-error">
              <p>{error}</p>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            data-testid="auth-submit"
            className="group mt-4 flex w-full items-center justify-center gap-2 rounded-md btn-primary py-3 text-body-md font-semibold transition-colors disabled:opacity-60"
          >
            {loading
              ? isSignUp
                ? "Creating account…"
                : isForgot
                  ? "Sending…"
                  : "Logging in…"
              : isSignUp
                ? "Create account"
                : isForgot
                  ? "Send reset link"
                  : "Log in"}
            {!loading ? (
              <MaterialIcon
                name="arrow_forward"
                className="text-lg transition-transform group-hover:translate-x-1"
                aria-hidden
              />
            ) : null}
          </button>
        </form>
      )}

      <div className="space-y-4 pt-2">
        {isForgot ? (
          <p className="text-center text-body-sm text-on-surface-variant">
            <button
              type="button"
              onClick={() => onModeChange("signin")}
              className="text-accent hover:underline"
              data-testid="back-to-login"
            >
              Back to Log in
            </button>
          </p>
        ) : (
          <p className="text-center text-body-sm text-on-surface-variant">
            {isSignUp ? "Already have an account? " : "Don't have an account? "}
            <button
              type="button"
              onClick={() => onModeChange(isSignUp ? "signin" : "signup")}
              className="text-accent hover:underline"
              data-testid={isSignUp ? "switch-to-login" : "switch-to-signup"}
            >
              {isSignUp ? "Log in" : "Sign up"}
            </button>
          </p>
        )}
        {isSignUp ? (
          <p className="text-center text-[11px] leading-relaxed text-on-surface-variant">
            Invite teammates after you create your account.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isForgotRoute = location.pathname === "/forgot-password";
  const [standardAuthMode, setStandardAuthMode] = useState<Exclude<AuthMode, "forgot">>(
    "signin",
  );
  const authMode: AuthMode = isForgotRoute ? "forgot" : standardAuthMode;
  const initialEmail =
    typeof location.state === "object" &&
    location.state !== null &&
    "email" in location.state &&
    typeof location.state.email === "string"
      ? location.state.email
      : "";

  const handleModeChange = (mode: AuthMode, email = ""): void => {
    if (mode === "forgot") {
      navigate(
        { pathname: "/forgot-password", search: location.search },
        { state: { email } },
      );
      return;
    }
    setStandardAuthMode(mode);
    if (isForgotRoute) {
      navigate({ pathname: "/", search: location.search }, { replace: true });
    }
  };

  return (
    <AccountLayout introduction={!isForgotRoute} action={
      <button type="button" onClick={() => handleModeChange(authMode === "signin" ? "signup" : "signin")}
        className="min-h-11 rounded px-2 font-medium text-on-surface hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {authMode === "signin" ? "Create account" : "Log in"}
      </button>
    }>
      <AuthCard key={isForgotRoute ? "forgot" : "standard"} mode={authMode} onModeChange={handleModeChange} initialEmail={initialEmail} />
    </AccountLayout>
  );
}
