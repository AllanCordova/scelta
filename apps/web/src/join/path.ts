export type JoinRouteTarget =
  | { mode: "token"; token: string }
  | { mode: "shortCode"; shortCode: string };

/**
 * Normalizes a room short code by trimming, uppercasing, and stripping spaces or hyphens.
 */
export function normalizeRoomShortCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "");
}

/**
 * Extracts the invite token from a `/join/:token` path, or returns `null`.
 */
export function joinTokenFromPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const match = /^\/join\/([^/]+)$/.exec(path);
  const raw = match?.[1];
  if (!raw) {
    return null;
  }

  try {
    const token = decodeURIComponent(raw);
    return token.length > 0 ? token : null;
  } catch {
    return raw;
  }
}

/**
 * Extracts and normalizes the room short code from a `/s/:shortCode` path, or returns `null`.
 */
export function shortCodeFromPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const match = /^\/s\/([^/]+)$/.exec(path);
  const raw = match?.[1];
  if (!raw) {
    return null;
  }

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }

  const normalized = normalizeRoomShortCode(decoded);
  return normalized.length > 0 ? normalized : null;
}

/**
 * Resolves a voter join route target from either `/join/:token` or `/s/:shortCode`.
 */
export function joinTargetFromPath(pathname: string): JoinRouteTarget | null {
  const token = joinTokenFromPath(pathname);
  if (token) {
    return { mode: "token", token };
  }

  const shortCode = shortCodeFromPath(pathname);
  if (shortCode) {
    return { mode: "shortCode", shortCode };
  }

  return null;
}
