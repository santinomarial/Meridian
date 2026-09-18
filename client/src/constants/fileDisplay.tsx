import type { LanguageMode } from "../types";

const LABELS: Partial<Record<LanguageMode, string>> = {
  typescript: "TS", javascript: "JS", python: "PY", go: "Go", rust: "RS",
  java: "JV", cpp: "C++", c: "C", html: "HTML", css: "CSS", json: "{}",
  yaml: "YML", markdown: "MD", sql: "SQL", shell: "SH",
};

/** Neutral language marks retain readable labels across both workspace themes. */
export function FileLanguageIcon({ language, fileName, className, size = 16 }: {
  language: LanguageMode;
  fileName?: string;
  className?: string;
  size?: number;
}) {
  const label = LABELS[language] ?? (fileName?.startsWith(".") ? "·" : "TXT");
  return (
    <span className={["inline-flex shrink-0 items-center justify-center rounded-[3px] border meridian-crisp-border bg-surface-container-high font-bold leading-none text-on-surface", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size, fontSize: size * (label.length > 2 ? 0.42 : 0.52) }} aria-hidden>
      {label}
    </span>
  );
}
