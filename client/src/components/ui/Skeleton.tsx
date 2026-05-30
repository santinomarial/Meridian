type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={["animate-pulse rounded bg-surface-container-high", className]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
    />
  );
}

type EditorSkeletonProps = {
  className?: string;
};

export function EditorSkeleton({ className }: EditorSkeletonProps) {
  return (
    <div
      className={[
        "flex h-full min-h-0 flex-1 flex-col gap-3 bg-surface p-6",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Loading editor"
      aria-busy
    >
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-3 w-2/5" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-3/5" />
      <Skeleton className="h-3 w-2/5" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-1/3" />
      <div className="mt-auto flex gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-32" />
      </div>
    </div>
  );
}

type PanelSkeletonProps = {
  rows?: number;
  className?: string;
};

export function PanelSkeleton({ rows = 6, className }: PanelSkeletonProps) {
  return (
    <div
      className={["space-y-2 p-3", className].filter(Boolean).join(" ")}
      aria-label="Loading panel"
      aria-busy
    >
      {Array.from({ length: rows }, (_, index) => {
        const widthClass = ["w-[55%]", "w-[67%]", "w-[79%]"][index % 3];
        return (
          <div key={index} className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
            <Skeleton className={["h-3", widthClass].join(" ")} />
          </div>
        );
      })}
    </div>
  );
}
