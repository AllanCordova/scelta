import { apiUrl } from "../api-url";
import type { SessionUser, UserRole } from "./types";

export class AuthRequestError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string) {
    super(errorCode);
    this.errorCode = errorCode;
  }
}

export async function currentSession(): Promise<SessionUser | null> {
  const response = await fetch(apiUrl("/v1/auth/me"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as { user?: unknown };
  return isSessionUser(body.user) ? body.user : null;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  return sendCredentials("/v1/auth/login", { email, password });
}

export async function register(name: string, email: string, password: string): Promise<SessionUser> {
  return sendCredentials("/v1/auth/register", { name, email, password });
}

export async function logout(): Promise<void> {
  const response = await fetch(apiUrl("/v1/auth/logout"), {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new AuthRequestError("logout_failed");
  }
}

async function sendCredentials(
  path: string,
  payload: { name?: string; email: string; password: string },
): Promise<SessionUser> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as { user?: unknown; error?: string };
  if (!response.ok || !isSessionUser(body.user)) {
    throw new AuthRequestError(body.error ?? "unknown");
  }
  return body.user;
}

function isSessionUser(value: unknown): value is SessionUser {
  if (!value || typeof value !== "object") {
    return false;
  }

  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    typeof user.name === "string" &&
    typeof user.email === "string" &&
    isUserRole(user.role)
  );
}

function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "member";
}
