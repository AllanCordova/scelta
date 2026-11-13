import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "scelta_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function sessionExpiry(now = Date.now()): Date {
  return new Date(now + SESSION_MAX_AGE_SECONDS * 1000);
}

export function readSessionToken(cookieHeader: string | string[] | undefined): string | undefined {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join(";") : cookieHeader;
  if (!header) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) {
      continue;
    }

    const value = part.slice(separator + 1).trim();
    if (!value) {
      return undefined;
    }

    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  return serializeCookie(encodeURIComponent(token), SESSION_MAX_AGE_SECONDS, secure);
}

export function clearSessionCookieHeader(secure: boolean): string {
  return serializeCookie("", 0, secure);
}

function serializeCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}
