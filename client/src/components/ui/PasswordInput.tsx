import { useState, type InputHTMLAttributes } from "react";
import { MaterialIcon } from "./MaterialIcon";

/** Shared by login, signup, and recovery; revealing text keeps its value intact. */
export function PasswordInput({
  label = "password",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & { label?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="group relative">
      <MaterialIcon name="lock" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant group-focus-within:text-primary" aria-hidden />
      <input
        {...props}
        type={visible ? "text" : "password"}
        placeholder="••••••••"
        className="w-full rounded-md border border-outline-variant bg-surface-container-lowest py-2.5 pl-10 pr-12 text-base text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/55 focus:border-primary focus:ring-2 focus:ring-primary/25 sm:text-body-md"
      />
      <button
        type="button"
        aria-label={`${visible ? "Hide" : "Show"} ${label}`}
        aria-controls={props.id}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-on-surface-variant hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <MaterialIcon name={visible ? "visibility_off" : "visibility"} className="text-lg" aria-hidden />
      </button>
    </div>
  );
}
