import { MaterialIcon } from "./MaterialIcon";
import { getPasswordRequirements, getPasswordStrengthScore } from "../../lib/passwordPolicy";

export function PasswordStrength({ password }: { password: string }) {
  const score = getPasswordStrengthScore(password);
  const reqs = getPasswordRequirements(password);

  return (
    <>
      <div className="mt-2 flex gap-1 px-1" aria-hidden>
        {[1, 2, 3, 4, 5].map((seg) => (
          <div
            key={seg}
            className={[
              "h-1 flex-grow rounded-full transition-all",
              seg <= score ? "bg-primary" : "bg-outline-variant",
            ].join(" ")}
          />
        ))}
      </div>
      <ul className="mt-2 space-y-0.5 px-1" aria-label="Password requirements">
        {reqs.map((req) => (
          <li
            key={req.label}
            className={[
              "flex items-center gap-1.5 text-[11px]",
              req.met ? "text-primary" : "text-on-surface-variant",
            ].join(" ")}
          >
            <MaterialIcon
              name={req.met ? "check_circle" : "radio_button_unchecked"}
              className="text-[13px]"
              aria-hidden
            />
            {req.label}
          </li>
        ))}
      </ul>
    </>
  );
}
