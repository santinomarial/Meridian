import type { HTMLAttributes, ReactNode } from "react";
import { MERIDIAN_VERSION } from "../../constants/version";
import { MaterialIcon } from "../ui/MaterialIcon";
import { transitionBase } from "../ui/styles";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import type { LanguageMode } from "../../types";

const LANGUAGE_LABELS: Record<LanguageMode, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  go: "Go",
  rust: "Rust",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  java: "Java",
  cpp: "C++",
  c: "C",
  markdown: "Markdown",
  yaml: "YAML",
  sql: "SQL",
  shell: "Shell",
  plaintext: "Plain Text",
};

function StatusBarSegment({ children, className, ...rest }: HTMLAttributes<HTMLSpanElement> & { children?: ReactNode }) {
  return (
    <span
      className={[
        "inline-flex h-full items-center gap-1 px-2.5",
        transitionBase,
        "hover:bg-surface-container-highest/80",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </span>
  );
}

export function StatusBar() {
  const cursorPosition = useWorkspaceStore((s) => s.cursorPosition);
  const activeFileId = useWorkspaceStore((s) => s.activeFileId);
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const diagnosticCounts = useWorkspaceStore((s) => s.diagnosticCounts);
  const saveStatus = useWorkspaceStore((s) => s.saveStatus);

  const activeTab = openTabs.find((t) => t.fileId === activeFileId);
  const languageLabel = activeTab ? LANGUAGE_LABELS[activeTab.language] : "Plain Text";

  return (
    <footer
      className="flex h-[22px] shrink-0 items-center justify-between border-t meridian-crisp-border bg-surface-container-high px-0.5 font-mono text-[12px] leading-none text-on-surface-variant"
      role="contentinfo"
      aria-label="Status bar"
    >
      <div className="flex h-full min-w-0 items-center overflow-x-auto">
        <StatusBarSegment title="Errors and warnings in the active file">
          <MaterialIcon
            name="error_outline"
            className={[
              "text-[12px]",
              diagnosticCounts.errors > 0 ? "text-error" : "text-on-surface-variant",
            ].join(" ")}
            aria-hidden
          />
          <span className="tabular-nums">{diagnosticCounts.errors}</span>
          <MaterialIcon
            name="warning_amber"
            className={[
              "ml-0.5 text-[12px]",
              diagnosticCounts.warnings > 0 ? "text-tertiary" : "text-on-surface-variant",
            ].join(" ")}
            aria-hidden
          />
          <span className="tabular-nums">{diagnosticCounts.warnings}</span>
        </StatusBarSegment>
      </div>
      <div className="flex h-full shrink-0 items-center">
        <StatusBarSegment className="tabular-nums">
          Ln {cursorPosition.line}, Col {cursorPosition.column}
        </StatusBarSegment>
        <StatusBarSegment className="hidden md:inline-flex">Spaces: 4</StatusBarSegment>
        <StatusBarSegment className="hidden lg:inline-flex">UTF-8</StatusBarSegment>
        <StatusBarSegment className="hidden sm:inline-flex">{languageLabel}</StatusBarSegment>
        <StatusBarSegment
          data-testid="save-status"
          data-save-status={saveStatus}
          className={
            saveStatus === "error"
              ? "text-error"
              : saveStatus === "unsaved"
                ? "text-tertiary"
                : undefined
          }
        >
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "error"
              ? "Save failed"
              : saveStatus === "unsaved"
                ? "Unsaved"
                : "Saved"}
        </StatusBarSegment>
        <StatusBarSegment className="tabular-nums text-on-surface-variant/80">
          Meridian v{MERIDIAN_VERSION}
        </StatusBarSegment>
      </div>
    </footer>
  );
}
