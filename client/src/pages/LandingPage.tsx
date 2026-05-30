import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MaterialIcon } from "../components/ui/MaterialIcon";

type AuthMode = "signup" | "signin";

function getPasswordStrengthScore(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  return score;
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

function PasswordStrength({ password }: { password: string }) {
  const score = getPasswordStrengthScore(password);
  const filled = password ? score : 2;

  return (
    <>
      <div className="mt-2 flex gap-1 px-1" aria-hidden>
        {[1, 2, 3, 4].map((segment) => (
          <div
            key={segment}
            className={[
              "h-1 flex-grow rounded-full transition-all",
              segment <= filled ? "bg-primary" : "bg-outline-variant",
            ].join(" ")}
          />
        ))}
      </div>
      <p className="px-1 text-[10px] italic text-on-surface-variant">
        Password must include 8+ characters and a symbol.
      </p>
    </>
  );
}

function AuthCard({
  mode,
  onModeChange,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setLoading(false);
  };

  const isSignUp = mode === "signup";

  return (
    <div className="glass-panel inner-glow flex w-full max-w-[420px] flex-col gap-8 rounded-xl p-8">
      <div className="space-y-2 text-center">
        <div className="mb-2 inline-flex items-center justify-center rounded border border-outline-variant/30 bg-surface-container-high px-2 py-0.5 uppercase text-primary-fixed-dim label-caps">
          {isSignUp ? "Start Coding" : "Welcome Back"}
        </div>
        <h1 className="text-headline-md font-semibold tracking-tight text-on-surface">
          {isSignUp ? "Create your workspace" : "Sign in to Meridian"}
        </h1>
        <p className="text-body-sm text-on-surface-variant">
          {isSignUp
            ? "Sign up to join the collaborative IDE environment."
            : "Enter your credentials to access your workspace."}
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        {isSignUp ? (
          <IconField
            id="name"
            label="Full Name"
            icon="person"
            placeholder="John Doe"
            value={name}
            onChange={setName}
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
          onChange={setEmail}
          autoComplete="email"
        />

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

        <button
          type="submit"
          disabled={loading}
          className="group mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-inverse-primary py-3 text-body-md font-semibold text-on-primary-fixed shadow-lg shadow-primary/10 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
        >
          {loading ? "Please wait…" : isSignUp ? "Create Account" : "Sign In"}
          {!loading ? (
            <MaterialIcon
              name="arrow_forward"
              className="text-lg transition-transform group-hover:translate-x-1"
              aria-hidden
            />
          ) : null}
        </button>
      </form>

      {isSignUp ? (
        <>
          <div className="relative flex items-center justify-center">
            <div className="absolute w-full border-t border-outline-variant" />
            <span className="relative bg-surface-dim px-4 text-outline label-caps">OR</span>
          </div>

          <button
            type="button"
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-outline-variant bg-surface-container-high py-3 text-body-md text-on-surface transition-colors hover:bg-surface-variant active:scale-[0.98]"
          >
            <MaterialIcon name="terminal" aria-hidden />
            Sign up with GitHub
          </button>
        </>
      ) : null}

      <div className="space-y-4 pt-2">
        <p className="text-center text-body-sm text-on-surface-variant">
          {isSignUp ? "Already have an account? " : "Don't have an account? "}
          <button
            type="button"
            onClick={() => onModeChange(isSignUp ? "signin" : "signup")}
            className="font-medium text-primary hover:underline"
          >
            {isSignUp ? "Log in" : "Sign up"}
          </button>
        </p>
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
  const [authMode, setAuthMode] = useState<AuthMode>("signup");

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
