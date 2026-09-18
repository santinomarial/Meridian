import type { ReactNode } from "react";
import type { LanguageMode } from "../types";

/**
 * Compact language marks shown next to filenames (tree, tabs, breadcrumb).
 * Brand-colored glyphs read clearly at ~14–16px — better than generic Material icons.
 */

const TYPESCRIPT_ICON_COLOR = "#3178C6";

const SIZE = 16;

type IconProps = {
  language: LanguageMode;
  fileName?: string;
  className?: string;
  size?: number;
};

function Badge({
  label,
  bg,
  fg = "#fff",
  size = SIZE,
  className,
}: {
  label: string;
  bg: string;
  fg?: string;
  size?: number;
  className?: string;
}) {
  const fontSize = label.length > 2 ? size * 0.42 : size * 0.52;
  return (
    <span
      className={["inline-flex shrink-0 items-center justify-center rounded-[3px] font-bold leading-none", className]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        color: fg,
        fontSize,
        fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif",
      }}
      aria-hidden
    >
      {label}
    </span>
  );
}

function SvgShell({
  size,
  className,
  children,
  viewBox = "0 0 16 16",
}: {
  size: number;
  className?: string;
  children: ReactNode;
  viewBox?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      className={["shrink-0", className].filter(Boolean).join(" ")}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function FileLanguageIcon({
  language,
  fileName,
  className,
  size = SIZE,
}: IconProps) {
  switch (language) {
    case "typescript":
      return <Badge label="TS" bg={TYPESCRIPT_ICON_COLOR} size={size} className={className} />;
    case "javascript":
      return <Badge label="JS" bg="#F7DF1E" fg="#000" size={size} className={className} />;
    case "python":
      return (
        <SvgShell size={size} className={className}>
          <path
            fill="#3776AB"
            d="M7.9 1C5.4 1 5.5 2.1 5.5 2.1v1.2h2.5v.4H4.1S2 3.6 2 6.5c0 2.9 1.6 2.8 1.6 2.8h1v-1.3S4.5 6.2 6.3 6.2h2.5c1.6 0 1.5-1 1.5-1V2.4S10.5 1 7.9 1zm-1.5 1a.6.6 0 1 1 0 1.2.6.6 0 0 1 0-1.2z"
          />
          <path
            fill="#FFD43B"
            d="M8.1 15c2.5 0 2.4-1.1 2.4-1.1v-1.2H8V12.3h3.9s2.1.1 2.1-2.8c0-2.9-1.6-2.8-1.6-2.8h-1v1.3s.1 1.8-1.7 1.8H7.2c-1.6 0-1.5 1-1.5 1v2.8S5.5 15 8.1 15zm1.5-1a.6.6 0 1 1 0-1.2.6.6 0 0 1 0 1.2z"
          />
        </SvgShell>
      );
    case "go":
      return (
        <SvgShell size={size} className={className} viewBox="0 0 16 16">
          <rect width="16" height="16" rx="3" fill="#00ADD8" />
          <text
            x="8"
            y="11.2"
            textAnchor="middle"
            fill="#fff"
            fontSize="7"
            fontWeight="700"
            fontFamily="Geist, ui-sans-serif, system-ui, sans-serif"
          >
            Go
          </text>
        </SvgShell>
      );
    case "rust":
      return <Badge label="RS" bg="#DEA584" fg="#000" size={size} className={className} />;
    case "java":
      return <Badge label="JV" bg="#B07219" size={size} className={className} />;
    case "cpp":
      return <Badge label="C++" bg="#00599C" size={size} className={className} />;
    case "c":
      return <Badge label="C" bg="#6B7280" size={size} className={className} />;
    case "html":
      return <Badge label="HTML" bg="#E34C26" size={size} className={className} />;
    case "css":
      return <Badge label="CSS" bg="#563D7C" size={size} className={className} />;
    case "json":
      return <Badge label="{}" bg="#CBCB41" fg="#111" size={size} className={className} />;
    case "yaml":
      return <Badge label="YML" bg="#CB171E" size={size} className={className} />;
    case "markdown":
      return <Badge label="MD" bg="#083FA1" size={size} className={className} />;
    case "sql":
      return <Badge label="SQL" bg="#e38c00" fg="#111" size={size} className={className} />;
    case "shell":
      return <Badge label="SH" bg="#4EAA25" size={size} className={className} />;
    case "plaintext":
    default:
      if (fileName?.startsWith(".")) {
        return <Badge label="·" bg="#64748B" size={size} className={className} />;
      }
      return <Badge label="TXT" bg="#64748B" size={size} className={className} />;
  }
}
