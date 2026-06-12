export type PasswordRequirement = { label: string; met: boolean };

const RULES: Array<{ label: string; test: (p: string) => boolean }> = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "1 uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "1 lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "1 number", test: (p) => /\d/.test(p) },
  { label: "1 special character", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function getPasswordRequirements(password: string): PasswordRequirement[] {
  return RULES.map((r) => ({ label: r.label, met: r.test(password) }));
}

export function getPasswordStrengthScore(password: string): number {
  if (!password) return 0;
  return RULES.filter((r) => r.test(password)).length;
}
