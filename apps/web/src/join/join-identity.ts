import { normalizeRoomShortCode } from "./path";

const JOIN_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const STORAGE_PREFIX = "scelta.join.";

export type StoredJoinIdentity = {
  joinKey: string;
  displayName: string;
  accessCode?: string;
};

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function isJoinKey(value: string): boolean {
  return JOIN_KEY_PATTERN.test(value);
}

export function createJoinKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

/**
 * Returns the storage namespace key for a room short code (`s.<SHORT_CODE>`).
 */
export function shortCodeStorageKey(shortCode: string): string {
  return `s.${normalizeRoomShortCode(shortCode)}`;
}

export function readJoinIdentity(storage: KeyValueStore, token: string): StoredJoinIdentity | null {
  const raw = storage.getItem(storageKey(token));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredJoinIdentity>;
    if (typeof parsed.joinKey !== "string" || parsed.joinKey.length === 0) {
      return null;
    }
    return {
      joinKey: parsed.joinKey,
      displayName: typeof parsed.displayName === "string" ? parsed.displayName : "",
      ...(typeof parsed.accessCode === "string" ? { accessCode: parsed.accessCode } : {}),
    };
  } catch {
    return null;
  }
}

export function writeJoinIdentity(
  storage: KeyValueStore,
  token: string,
  identity: StoredJoinIdentity,
): void {
  storage.setItem(storageKey(token), JSON.stringify(identity));
}

/**
 * Clears only the stored access code and display name while preserving the device `joinKey`.
 */
export function clearStoredAccessCode(
  storage: KeyValueStore,
  token: string,
  fallbackJoinKey?: string,
): void {
  const existing = readJoinIdentity(storage, token);
  const joinKey = existing?.joinKey ?? fallbackJoinKey;
  if (!joinKey) {
    return;
  }
  writeJoinIdentity(storage, token, { joinKey, displayName: "" });
}

/**
 * Reads an access code from query string (`?c=` first, falling back to `?code=`).
 */
export function readAccessCodeFromSearch(search: string): string {
  try {
    const params = new URLSearchParams(search);
    const raw = params.get("c") ?? params.get("code") ?? "";
    return raw.trim().toUpperCase();
  } catch {
    return "";
  }
}

/**
 * Returns true if `?c=` or `?code=` is present in the URL query string.
 */
export function hasAccessCodeInSearch(search: string): boolean {
  try {
    const params = new URLSearchParams(search);
    return params.has("c") || params.has("code");
  } catch {
    return false;
  }
}

/**
 * Strips `?c=` and `?code=` from the browser address bar using `history.replaceState`.
 */
export function stripAccessCodeFromUrl(): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    if (!hasAccessCodeInSearch(window.location.search)) {
      return;
    }
    window.history.replaceState(null, "", window.location.pathname);
  } catch {
    // Ignore in restricted environments where history.replaceState may be blocked.
  }
}

function storageKey(token: string): string {
  return `${STORAGE_PREFIX}${token}`;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
