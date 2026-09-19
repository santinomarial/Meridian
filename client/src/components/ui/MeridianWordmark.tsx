type MeridianWordmarkProps = { className?: string; compactOnSmallScreens?: boolean };

export function MeridianWordmark({ className, compactOnSmallScreens = false }: MeridianWordmarkProps) {
  return (
    <span className={["inline-flex items-center gap-2", className].filter(Boolean).join(" ")}>
      <svg viewBox="0 0 20 20" className="h-7 w-7 shrink-0 text-brand" fill="none" aria-hidden="true">
        <path d="M4 15V5L10 11L16 5V15" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={[
        "text-[18px] font-semibold leading-none tracking-[-0.025em] text-on-surface",
        compactOnSmallScreens ? "max-[359px]:sr-only" : "",
      ].join(" ")}>Meridian</span>
    </span>
  );
}
