const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;

export type AccountField = "name" | "email" | "password";
export type AccountIssue = { field: AccountField; code: "required" | "invalid" };

export type NewAccount = {
  name: string;
  email: string;
  password: string;
};

export function validateNewAccount(
  input: NewAccount,
): { ok: true; value: NewAccount } | { ok: false; issues: AccountIssue[] } {
  const issues: AccountIssue[] = [];
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const password = input.password;

  if (!name) {
    issues.push({ field: "name", code: "required" });
  } else if (name.length > MAX_NAME_LENGTH) {
    issues.push({ field: "name", code: "invalid" });
  }

  if (!email) {
    issues.push({ field: "email", code: "required" });
  } else if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    issues.push({ field: "email", code: "invalid" });
  }

  if (!password) {
    issues.push({ field: "password", code: "required" });
  } else if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    issues.push({ field: "password", code: "invalid" });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: { name, email, password } };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
