import type { ReactNode } from "react";
import { MaterialIcon } from "./MaterialIcon";

type EmptyStateProps = {
  icon: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={[
        "flex flex-col items-center justify-center gap-2 px-6 py-8 text-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <MaterialIcon
        name={icon}
        className="text-[36px] text-on-surface-variant opacity-40"
      />
      <p className="text-body-md font-medium text-on-surface">{title}</p>
      {description ? (
        <p className="max-w-[220px] text-label-md leading-relaxed text-on-surface-variant">
          {description}
        </p>
      ) : null}
      {action}
    </div>
  );
}
