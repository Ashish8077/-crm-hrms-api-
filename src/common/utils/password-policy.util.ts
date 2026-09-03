export const PASSWORD_POLICY = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 128,
  rules: [
    {
      regex: /[A-Z]/,
      message: 'Password must contain at least one uppercase letter',
    },
    {
      regex: /[a-z]/,
      message: 'Password must contain at least one lowercase letter',
    },
    {
      regex: /[0-9]/,
      message: 'Password must contain at least one number',
    },
    {
      regex: /[^A-Za-z0-9]/,
      message: 'Password must contain at least one special character',
    },
  ],
} as const;

/**
 * Validates a password against the project-wide password policy.
 * Returns an empty array when the password is valid.
 */
export function validatePasswordPolicy(password: string): string[] {
  const violations: string[] = [];

  if (password.length < PASSWORD_POLICY.MIN_LENGTH) {
    violations.push(
      `Password must be at least ${PASSWORD_POLICY.MIN_LENGTH} characters`,
    );
  }

  for (const rule of PASSWORD_POLICY.rules) {
    if (!rule.regex.test(password)) {
      violations.push(rule.message);
    }
  }

  return violations;
}
