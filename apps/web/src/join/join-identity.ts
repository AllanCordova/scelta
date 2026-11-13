const JOIN_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const STORAGE_PREFIX = "scelta.join.";

export type StoredJoinIdentity = {
  joinKey: string;
  displayName: string;
};

type KeyValueStore = {
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
