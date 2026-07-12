import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MaterialIcon } from "../components/ui/MaterialIcon";
import { PasswordStrength } from "../components/ui/PasswordStrength";
import { ApiError, login, register, forgotPassword } from "../lib/api";
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

function LandingHeader({ onGetStarted }: { onGetStarted: () => void }) {
  const navLinks = ["Docs", "Pricing", "Changelog"] as const;

  return (
    <header className="fixed top-0 z-50 flex w-full items-center justify-between border-b border-outline-variant bg-surface-dim/80 px-6 py-3 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-primary">
          <MaterialIcon name="polymer" className="text-xl text-on-primary" aria-hidden />
        </div>
        <span className="text-display-lg font-bold text-on-surface">Meridian</span>
      </div>
      <nav className="hidden gap-6 md:flex" aria-label="Site">
        {navLinks.map((link) => (
          <a
            key={link}
            href="#"
            className="text-body-md text-on-surface-variant transition-colors duration-200 hover:text-primary"
          >
            {link}
          </a>
        ))}
      </nav>
      <button
        type="button"
        onClick={onGetStarted}
        className="rounded-lg bg-primary-container px-4 py-1.5 text-body-md font-medium text-on-primary-container transition-all hover:opacity-90 active:scale-95"
      >
        Get Started
      </button>
    </header>
  );
}

type IconFieldProps = {
  id: string;
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
      <label htmlFor={id} className="label-caps ml-1 text-on-surface-variant">
        {label}
      </label>
      <div className="group relative">
        <MaterialIcon
          name={icon}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-outline transition-colors group-focus-within:text-primary"
          aria-hidden
        />
        <input
          id={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-4 text-body-md text-on-surface outline-none transition-all placeholder:text-outline-variant focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>
    </div>
  );
}


function AuthCard({
  mode,
  onModeChange,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
}) {
  const navigate = useNavigate();
  const prevModeRef = useRef<AuthMode>(mode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgotLink, setShowForgotLink] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);

  // Keep email when switching signin ↔ forgot so the forgot-password form is pre-filled.
  // Clear email for all other transitions (entering/leaving signup).
  useEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = mode;
    const keepEmail =
      (prevMode === "signin" && mode === "forgot") ||
      (prevMode === "forgot" && mode === "signin");
    // Intentional reset of form fields on auth-mode transitions.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName("");
    setPassword("");
    setConfirmPassword("");
    setError(null);
    setShowForgotLink(false);
    setForgotSuccess(false);
    if (!keepEmail) {
      setEmail("");
    }
  }, [mode]);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setShowForgotLink(false);

    if (mode === "forgot") {
      setLoading(true);
      try {
        await forgotPassword({ email });
      } catch {
        setError("Unable to send reset link right now. Please try again later.");
      } finally {
        setLoading(false);
      }
      // Always show the generic success — never reveal whether the email exists.
      setForgotSuccess(true);
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
        await register({ email, password, displayName: name });
      } else {
        await login({ email, password });
      }
      navigate(getSafeRedirect());
    } catch (err) {
      setError(getAuthErrorMessage(err, { invalidCredentialsFor401: mode === "signin" }));
      if (mode === "signin" && err instanceof ApiError && err.status === 401) {
        setShowForgotLink(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";

  return (
    <div className="glass-panel inner-glow flex w-full max-w-[420px] flex-col gap-8 rounded-xl p-8" data-testid="auth-card">
      <div className="space-y-2 text-center">
        <div className="mb-2 inline-flex items-center justify-center rounded border border-outline-variant/30 bg-surface-container-high px-2 py-0.5 uppercase text-primary-fixed-dim label-caps">
          {isSignUp ? "Start Coding" : isForgot ? "Reset Password" : "Welcome Back"}
        </div>
        <h1 className="text-headline-md font-semibold tracking-tight text-on-surface">
          {isSignUp ? "Create your workspace" : isForgot ? "Forgot your password?" : "Log in"}
        </h1>
        <p className="text-body-sm text-on-surface-variant">
          {isSignUp
            ? "Sign up to join the collaborative IDE environment."
            : isForgot
              ? "Enter your email and we'll send you a reset link."
              : "Enter your credentials to access your workspace."}
        </p>
      </div>

      {isForgot && forgotSuccess ? (
        <div className="rounded-lg bg-primary/10 px-4 py-5 text-center" data-testid="forgot-success">
          <MaterialIcon name="mark_email_read" className="mb-3 text-4xl text-primary" aria-hidden />
          <p className="text-body-sm text-on-surface">
            If an account exists for this email, a reset link has been sent.
          </p>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit} noValidate data-testid="auth-form">
          {isSignUp ? (
            <IconField
              id="name"
              label="Full Name"
              icon="person"
              placeholder="John Doe"
              value={name}
              onChange={(v) => setName(v)}
              autoComplete="name"
            />
          ) : null}

          <IconField
            id="email"
            label="Email Address"
            icon="alternate_email"
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={(v) => setEmail(v)}
            autoComplete="email"
          />

          {!isForgot ? (
            <div className="space-y-1.5">
              <label htmlFor="password" className="label-caps ml-1 text-on-surface-variant">
                Password
              </label>
              <div className="group relative">
                <MaterialIcon
                  name="lock"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-outline transition-colors group-focus-within:text-primary"
                  aria-hidden
                />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-4 text-body-md text-on-surface outline-none transition-all placeholder:text-outline-variant focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              {isSignUp ? <PasswordStrength password={password} /> : null}
            </div>
          ) : null}

          {isSignUp ? (
            <div className="space-y-1.5">
              <label
                htmlFor="confirm-password"
                className="label-caps ml-1 text-on-surface-variant"
              >
                Confirm Password
              </label>
              <div className="group relative">
                <MaterialIcon
                  name="lock"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-outline transition-colors group-focus-within:text-primary"
                  aria-hidden
                />
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-4 text-body-md text-on-surface outline-none transition-all placeholder:text-outline-variant focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          ) : null}

          {error !== null ? (
            <div role="alert" className="rounded-lg bg-error/10 px-3 py-2 text-[12px] text-error" data-testid="auth-error">
              <p>{error}</p>
              {showForgotLink ? (
                <button
                  type="button"
                  onClick={() => onModeChange("forgot")}
                  className="mt-1 text-primary hover:underline"
                  data-testid="forgot-password-link"
                >
                  Forgot password?
                </button>
              ) : null}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            data-testid="auth-submit"
            className="group mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-inverse-primary py-3 text-body-md font-semibold text-on-primary-fixed shadow-lg shadow-primary/10 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
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
              className="font-medium text-primary hover:underline"
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
              className="font-medium text-primary hover:underline"
              data-testid={isSignUp ? "switch-to-login" : "switch-to-signup"}
            >
              {isSignUp ? "Log in" : "Sign up"}
            </button>
          </p>
        )}
        {isSignUp ? (
          <p className="text-center text-[11px] leading-relaxed text-outline">
            By creating an account, you agree to our{" "}
            <a href="#" className="text-on-surface-variant underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="text-on-surface-variant underline">
              Privacy Policy
            </a>
            .
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LandingFooter() {
  const links = ["Privacy Policy", "Terms of Service", "Status"] as const;

  return (
    <footer className="relative z-10 flex w-full flex-col items-center justify-between gap-4 border-t border-outline-variant bg-surface-container-lowest/50 px-8 py-6 backdrop-blur-sm md:flex-row">
      <div className="flex items-center gap-6">
        <span className="text-on-surface-variant label-caps">© 2024 Meridian Systems Inc.</span>
      </div>
      <div className="flex gap-6">
        {links.map((link) => (
          <a
            key={link}
            href="#"
            className="text-body-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            {link}
          </a>
        ))}
      </div>
    </footer>
  );
}

export function LandingPage() {
  const navigate = useNavigate();
  const [authMode, setAuthMode] = useState<AuthMode>("signin");

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");

    html.classList.add("dark");
    html.style.colorScheme = "dark";

    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevRootOverflow = root?.style.overflow ?? "";
    const prevRootHeight = root?.style.height ?? "";

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (root) {
      root.style.overflow = "auto";
      root.style.height = "auto";
      root.style.minHeight = "100%";
    }

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      if (root) {
        root.style.overflow = prevRootOverflow;
        root.style.height = prevRootHeight;
        root.style.minHeight = "";
      }
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-background text-body-md text-on-background selection:bg-primary-container selection:text-on-primary-container">
      <AmbientBackground />
      <LandingHeader onGetStarted={() => navigate("/workspace")} />

      <main className="relative z-10 mt-12 flex flex-grow items-center justify-center p-6">
        <AuthCard mode={authMode} onModeChange={setAuthMode} />
      </main>

      <LandingFooter />
    </div>
  );
}
