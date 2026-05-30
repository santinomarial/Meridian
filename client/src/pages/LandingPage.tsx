import { useEffect, useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MaterialIcon } from "../components/ui/MaterialIcon";
import { focusRing, transitionBase } from "../components/ui/styles";

type AuthTab = "signup" | "signin" | "trial";

const FEATURES = [
  {
    icon: "bolt",
    title: "OT engine from scratch",
    description: "Conflict-free merges with a purpose-built operational transform core.",
  },
  {
    icon: "groups",
    title: "30+ concurrent users, zero drops",
    description: "Scale live sessions without frame loss or reconnect storms.",
  },
  {
    icon: "ads_click",
    title: "Live cursors, presence, history",
    description: "See who is where, replay edits, and audit every keystroke.",
  },
] as const;

const AVATAR_SWATCHES = [
  "#3525cd",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = Record<string, string>;

function getPasswordStrength(password: string): {
  score: number;
  label: string;
} {
  if (!password) {
    return { score: 0, label: "" };
  }

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const normalized = Math.min(4, Math.max(1, Math.ceil(score * 0.8)));
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  return { score: normalized, label: labels[normalized] ?? "" };
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

async function simulateSubmit(ms = 900): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type TextFieldProps = {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete?: string;
  required?: boolean;
};

function TextField({
  id,
  label,
  type = "text",
  value,
  onChange,
  error,
  autoComplete,
  required,
}: TextFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-label-md font-medium text-on-surface">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={[
          "w-full rounded-lg border bg-white px-3 py-2.5 text-body-md text-on-surface outline-none",
          transitionBase,
          focusRing,
          error
            ? "border-error focus-visible:ring-error/40"
            : "border-outline-variant focus-visible:border-primary",
        ].join(" ")}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-label-md text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete?: string;
  showStrength?: boolean;
};

function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  autoComplete,
  showStrength = false,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const strength = getPasswordStrength(value);

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-label-md font-medium text-on-surface">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [error ? `${id}-error` : null, showStrength ? `${id}-strength` : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          className={[
            "w-full rounded-lg border bg-white py-2.5 pl-3 pr-11 text-body-md text-on-surface outline-none",
            transitionBase,
            focusRing,
            error
              ? "border-error focus-visible:ring-error/40"
              : "border-outline-variant focus-visible:border-primary",
          ].join(" ")}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className={[
            "absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-on-surface-variant",
            transitionBase,
            "hover:bg-surface-container hover:text-on-surface",
            focusRing,
          ].join(" ")}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          <MaterialIcon name={visible ? "visibility_off" : "visibility"} className="text-[20px]" />
        </button>
      </div>
      {showStrength && value ? (
        <div id={`${id}-strength`} className="mt-2 space-y-1">
          <div className="flex gap-1" aria-hidden>
            {[1, 2, 3, 4].map((segment) => (
              <span
                key={segment}
                className={[
                  "h-1 flex-1 rounded-full transition-colors duration-200",
                  strength.score >= segment
                    ? strength.score <= 1
                      ? "bg-error"
                      : strength.score === 2
                        ? "bg-amber-500"
                        : strength.score === 3
                          ? "bg-primary"
                          : "bg-emerald-500"
                    : "bg-outline-variant/60",
                ].join(" ")}
              />
            ))}
          </div>
          <p className="text-label-md text-on-surface-variant">
            Password strength: <span className="font-medium text-on-surface">{strength.label}</span>
          </p>
        </div>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-label-md text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PrimaryButton({
  children,
  loading,
  type = "submit",
}: {
  children: string;
  loading: boolean;
  type?: "submit" | "button";
}) {
  return (
    <button
      type={type}
      disabled={loading}
      className={[
        "flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-body-md font-bold text-on-primary",
        transitionBase,
        focusRing,
        "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
      ].join(" ")}
    >
      {loading ? (
        <>
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-on-primary/30 border-t-on-primary"
            aria-hidden
          />
          <span>Please wait…</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

function AuthTabs({
  active,
  onChange,
}: {
  active: AuthTab;
  onChange: (tab: AuthTab) => void;
}) {
  const tabs: { id: AuthTab; label: string }[] = [
    { id: "signup", label: "Sign up" },
    { id: "signin", label: "Sign in" },
    { id: "trial", label: "Free Trial" },
  ];

  return (
    <div
      className="mb-8 flex rounded-lg border border-outline-variant/80 bg-surface-container-low p-1"
      role="tablist"
      aria-label="Authentication"
    >
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={[
              "flex-1 rounded-md px-3 py-2 text-label-md font-semibold sm:text-body-md",
              transitionBase,
              focusRing,
              selected
                ? "bg-white text-on-surface shadow-sm"
                : "text-on-surface-variant hover:text-on-surface",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function SignUpForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const termsId = useId();

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = "Enter your name.";
    if (!email.trim()) next.email = "Enter your email.";
    else if (!EMAIL_PATTERN.test(email)) next.email = "Enter a valid email address.";
    if (!password) next.password = "Enter a password.";
    else if (password.length < 8) next.password = "Use at least 8 characters.";
    else if (getPasswordStrength(password).score < 2)
      next.password = "Choose a stronger password.";
    if (!confirmPassword) next.confirmPassword = "Confirm your password.";
    else if (confirmPassword !== password) next.confirmPassword = "Passwords do not match.";
    if (!acceptedTerms) next.terms = "Accept the terms to continue.";
    return next;
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    await simulateSubmit();
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label="Sign up">
      <TextField
        id="signup-name"
        label="Name"
        value={name}
        onChange={setName}
        error={errors.name}
        autoComplete="name"
      />
      <TextField
        id="signup-email"
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        error={errors.email}
        autoComplete="email"
      />
      <PasswordField
        id="signup-password"
        label="Password"
        value={password}
        onChange={setPassword}
        error={errors.password}
        autoComplete="new-password"
        showStrength
      />
      <PasswordField
        id="signup-confirm"
        label="Confirm password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        error={errors.confirmPassword}
        autoComplete="new-password"
      />
      <div>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            id={termsId}
            type="checkbox"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            className={["mt-0.5 h-4 w-4 rounded border-outline-variant text-primary", focusRing].join(
              " ",
            )}
          />
          <span className="text-label-md text-on-surface-variant">
            I agree to the{" "}
            <a href="#" className="font-medium text-primary hover:underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="font-medium text-primary hover:underline">
              Privacy Policy
            </a>
          </span>
        </label>
        {errors.terms ? (
          <p className="mt-1.5 text-label-md text-error" role="alert">
            {errors.terms}
          </p>
        ) : null}
      </div>
      <PrimaryButton loading={loading}>Create account</PrimaryButton>
    </form>
  );
}

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const rememberId = useId();

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!email.trim()) next.email = "Enter your email.";
    else if (!EMAIL_PATTERN.test(email)) next.email = "Enter a valid email address.";
    if (!password) next.password = "Enter your password.";
    return next;
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    await simulateSubmit();
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label="Sign in">
      <TextField
        id="signin-email"
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        error={errors.email}
        autoComplete="email"
      />
      <PasswordField
        id="signin-password"
        label="Password"
        value={password}
        onChange={setPassword}
        error={errors.password}
        autoComplete="current-password"
      />
      <div className="flex items-center justify-between gap-3">
        <a
          href="#"
          className="text-label-md font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm"
        >
          Forgot password?
        </a>
        <label htmlFor={rememberId} className="flex cursor-pointer items-center gap-2">
          <input
            id={rememberId}
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            className={["h-4 w-4 rounded border-outline-variant text-primary", focusRing].join(" ")}
          />
          <span className="text-label-md text-on-surface-variant">Remember me</span>
        </label>
      </div>
      <PrimaryButton loading={loading}>Sign in</PrimaryButton>
    </form>
  );
}

function FreeTrialForm() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [avatarColor, setAvatarColor] = useState<string>(AVATAR_SWATCHES[0]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!displayName.trim()) next.displayName = "Enter a display name.";
    else if (displayName.trim().length < 2)
      next.displayName = "Use at least 2 characters.";
    return next;
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    await simulateSubmit(500);
    navigate("/workspace");
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5" aria-label="Free trial">
      <TextField
        id="trial-name"
        label="Display name"
        value={displayName}
        onChange={setDisplayName}
        error={errors.displayName}
        autoComplete="nickname"
      />

      <div>
        <p className="mb-3 text-label-md font-medium text-on-surface">Avatar color</p>
        <div className="flex items-center gap-4">
          <span
            className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-outline-variant/50 text-lg font-bold text-white shadow-md"
            style={{ backgroundColor: avatarColor }}
            aria-hidden
          >
            {getInitials(displayName)}
          </span>
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Choose avatar color"
          >
            {AVATAR_SWATCHES.map((color) => {
              const selected = avatarColor === color;
              return (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Color ${color}`}
                  onClick={() => setAvatarColor(color)}
                  className={[
                    "h-9 w-9 rounded-full border-2 transition-transform duration-200",
                    focusRing,
                    selected
                      ? "scale-110 border-on-surface ring-2 ring-primary/40 ring-offset-2"
                      : "border-transparent hover:scale-105",
                  ].join(" ")}
                  style={{ backgroundColor: color }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <PrimaryButton loading={loading}>Start free session</PrimaryButton>
    </form>
  );
}

export function LandingPage() {
  const [activeTab, setActiveTab] = useState<AuthTab>("signup");

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevRootOverflow = root?.style.overflow ?? "";
    const prevRootHeight = root?.style.height ?? "";

    html.style.overflow = "auto";
    body.style.overflow = "auto";
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
    <div className="min-h-screen bg-white text-on-surface">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <section
          className="flex flex-1 flex-col justify-between bg-[#0f0e17] px-6 py-10 text-white sm:px-10 lg:min-h-screen lg:max-w-[50%] lg:px-14 lg:py-14"
          aria-labelledby="landing-headline"
        >
          <div>
            <span className="inline-flex items-center gap-2.5">
              <span
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-white/10"
                aria-hidden
              >
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-white" fill="none">
                  <path
                    d="M4 14L10 4L16 14"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M7 11H13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </span>
              <span className="font-black tracking-tight text-headline-md text-white">Meridian</span>
            </span>
            <h1
              id="landing-headline"
              className="mt-8 max-w-lg font-black tracking-tight text-white text-[clamp(2rem,5vw,2.75rem)] leading-[1.15]"
            >
              Code together, ship faster
            </h1>
            <p className="mt-4 max-w-md text-body-md leading-relaxed text-white/75">
              Real-time collaborative editing with sub-10ms sync. No setup required.
            </p>

            <ul className="mt-10 space-y-6">
              {FEATURES.map((feature) => (
                <li key={feature.title} className="flex gap-4">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/10 text-primary-container">
                    <MaterialIcon name={feature.icon} className="text-[24px] text-white" />
                  </span>
                  <div>
                    <p className="font-semibold text-body-md text-white">{feature.title}</p>
                    <p className="mt-1 text-label-md leading-relaxed text-white/60">
                      {feature.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-12 text-label-md text-white/40 lg:mt-16">
            Trusted by 2,400+ engineering teams shipping together this week
          </p>
        </section>

        <section
          className="flex flex-1 flex-col justify-center px-6 py-10 sm:px-10 lg:min-h-screen lg:max-w-[50%] lg:px-14 lg:py-14"
          aria-label="Get started"
        >
          <div className="mx-auto w-full max-w-md">
            <h2 className="mb-2 font-bold text-headline-md text-on-surface">Welcome</h2>
            <p className="mb-8 text-body-md text-on-surface-variant">
              Create an account, sign in, or jump straight into a free session.
            </p>

            <AuthTabs active={activeTab} onChange={setActiveTab} />

            <div role="tabpanel">
              {activeTab === "signup" ? <SignUpForm /> : null}
              {activeTab === "signin" ? <SignInForm /> : null}
              {activeTab === "trial" ? <FreeTrialForm /> : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
