import { hashPassword } from "../auth/password.js";
import { EmailAlreadyUsedError, type UserRepository } from "./user-repository.js";

/**
 * Creates the operator account once. An email that already exists keeps its
 * password and role, so a member cannot be promoted by restarting the API.
 */
export async function ensureBootstrapAdmin(
  users: UserRepository,
  account: { name: string; email: string; password: string },
): Promise<void> {
  const email = account.email.trim().toLowerCase();
  const existing = await users.findByEmail(email);
  if (existing) {
    return;
  }

  const passwordHash = await hashPassword(account.password);
  try {
    await users.insertUser({
      name: account.name.trim() || "Administrador",
      email,
      passwordHash,
      role: "admin",
    });
  } catch (error) {
    if (error instanceof EmailAlreadyUsedError) {
      return;
    }
    throw error;
  }
}
