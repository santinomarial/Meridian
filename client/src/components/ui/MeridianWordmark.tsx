type MeridianWordmarkProps = {
  className?: string;
};

export function MeridianWordmark({ className }: MeridianWordmarkProps) {
  return (
    <span
      className={["inline-flex items-center gap-2", className].filter(Boolean).join(" ")}
    >
      <span
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border border-outline-variant/80 bg-surface-container-lowest shadow-sm"
        aria-hidden
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-primary" fill="none">
          <path
            d="M4 14L10 4L16 14"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7 11H13"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="font-black tracking-[-0.02em] text-[17px] leading-none text-on-surface">
        Meridian
      </span>
    </span>
  );
}
