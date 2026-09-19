import type { HTMLAttributes } from "react";

type MaterialIconProps = HTMLAttributes<HTMLSpanElement> & {
  name: string;
};

export function MaterialIcon({ name, className, ...props }: MaterialIconProps) {
  const labelled = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined;
  return (
    <span
      aria-hidden={labelled ? undefined : true}
      role={labelled ? "img" : undefined}
      {...props}
      className={["material-symbols-outlined", className].filter(Boolean).join(" ")}
    >
      {name}
    </span>
  );
}
