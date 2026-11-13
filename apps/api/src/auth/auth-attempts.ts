const WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;
/** Caps password hashing per client, so rotating the email cannot skip the limit. */
export const MAX_LOGIN_CLIENT_ATTEMPTS = 20;
const MAX_REGISTER_ATTEMPTS = 20;

type AttemptBucket = {
  count: number;
  windowStartedAt: number;
};

const attempts = new Map<string, AttemptBucket>();

export function isClientLimited(kind: "login" | "register", clientKey: string, now = Date.now()): boolean {
  const bucket = currentBucket(storageKey(kind, clientKey), now);
  if (!bucket) {
    return false;
  }

  const limit = kind === "login" ? MAX_LOGIN_FAILURES : MAX_REGISTER_ATTEMPTS;
  return bucket.count >= limit;
}

export function recordClientAttempt(kind: "login" | "register", clientKey: string, now = Date.now()): void {
  const key = storageKey(kind, clientKey);
  const bucket = currentBucket(key, now);
  if (!bucket) {
    attempts.set(key, { count: 1, windowStartedAt: now });
    return;
  }

  bucket.count += 1;
}

/**
 * Reserves one guess for this account before password verification.
 * The counter is per account, so a different account logging in cannot clear it.
 * The increment happens before any await, so overlapping guesses cannot all pass the check.
 */
export function takeLoginAttempt(accountKey: string, now = Date.now()): boolean {
  return takeAttempt(loginAccountKey(accountKey), MAX_LOGIN_FAILURES, now);
}

/** Reserves one password check for this client, independent of the email. */
export function takeLoginClientAttempt(clientKey: string, now = Date.now()): boolean {
  return takeAttempt(loginClientKey(clientKey), MAX_LOGIN_CLIENT_ATTEMPTS, now);
}

/** Gives back a reserved account guess when login fails before the password is checked. */
export function releaseLoginAttempt(accountKey: string, now = Date.now()): void {
  releaseAttempt(loginAccountKey(accountKey), now);
}

/** Gives back a reserved client guess when this request did not spend a password check. */
export function releaseLoginClientAttempt(clientKey: string, now = Date.now()): void {
  releaseAttempt(loginClientKey(clientKey), now);
}

export function clearLoginAccountAttempts(accountKey: string): void {
  attempts.delete(loginAccountKey(accountKey));
}

export function clearClientAttempts(kind: "login" | "register", clientKey: string): void {
  attempts.delete(storageKey(kind, clientKey));
}

export function resetAuthAttempts(): void {
  attempts.clear();
}

function takeAttempt(key: string, limit: number, now: number): boolean {
  const bucket = currentBucket(key, now);
  if (bucket && bucket.count >= limit) {
    return false;
  }

  if (!bucket) {
    attempts.set(key, { count: 1, windowStartedAt: now });
    return true;
  }

  bucket.count += 1;
  return true;
}

function releaseAttempt(key: string, now: number): void {
  const bucket = currentBucket(key, now);
  if (!bucket) {
    return;
  }

  bucket.count -= 1;
  if (bucket.count <= 0) {
    attempts.delete(key);
  }
}

function loginAccountKey(accountKey: string): string {
  return storageKey("login", `account:${accountKey}`);
}

function loginClientKey(clientKey: string): string {
  return storageKey("login", `client:${clientKey}`);
}

function storageKey(kind: "login" | "register", clientKey: string): string {
  return `${kind}:${clientKey}`;
}

function currentBucket(key: string, now: number): AttemptBucket | undefined {
  const bucket = attempts.get(key);
  if (!bucket) {
    return undefined;
  }

  if (now - bucket.windowStartedAt > WINDOW_MS) {
    attempts.delete(key);
    return undefined;
  }

  return bucket;
}
