import { registerDecorator, type ValidationOptions } from 'class-validator';

const RULES = [
  { label: 'at least 8 characters', test: (p: string) => p.length >= 8 },
  { label: '1 uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: '1 lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: '1 number', test: (p: string) => /\d/.test(p) },
  { label: '1 special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

/** Returns the labels of unmet password rules.  Empty array means the password is valid. */
export function validatePasswordPolicy(password: string): string[] {
  return RULES.filter((r) => !r.test(password)).map((r) => r.label);
}

/** class-validator decorator enforcing the shared password policy. */
export function IsStrongPassword(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: (object as { constructor: new (...args: unknown[]) => unknown }).constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && validatePasswordPolicy(value).length === 0;
        },
        defaultMessage(): string {
          return `$property must contain: at least 8 characters, 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character`;
        },
      },
    });
  };
}
