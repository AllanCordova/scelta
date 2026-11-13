const PLACEHOLDER_ADMIN_PASSWORD = "dev-admin-password";
const MIN_PRODUCTION_PASSWORD_LENGTH = 12;

export function assertAdminAccountConfig(
  nodeEnv: string,
  email: string | undefined,
  password: string | undefined,
): void {
  const hasEmail = Boolean(email);
  const hasPassword = Boolean(password);
  if (hasEmail !== hasPassword) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must both be set");
  }

  if (nodeEnv !== "production") {
    return;
  }

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required in production");
  }

  if (password.length < MIN_PRODUCTION_PASSWORD_LENGTH || password === PLACEHOLDER_ADMIN_PASSWORD) {
    throw new Error(
      "ADMIN_PASSWORD must be a unique secret of at least 12 characters in production",
    );
  }
}
