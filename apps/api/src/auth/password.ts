import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: SCRYPT_N,
  r: SCRYPT_R,
  p: SCRYPT_P,
  maxmem: 64 * 1024 * 1024,
};

let dummyHash: Promise<string> | undefined;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scryptKey(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (!parsed) {
    await scryptKey(password, "scelta-dummy-salt");
    return false;
  }

  const derived = await scryptKey(password, parsed.salt);
  if (derived.length !== parsed.key.length) {
    return false;
  }

  return timingSafeEqual(derived, parsed.key);
}

/** Spends a hash when the email does not exist, so login timing does not reveal accounts. */
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("not-a-real-password");
  return dummyHash;
}

function parsePasswordHash(stored: string): { salt: string; key: Buffer } | undefined {
  const parts = stored.split("$");
  if (parts.length !== 6) {
    return undefined;
  }

  const algorithm = parts[0];
  const cost = parts[1];
  const blockSize = parts[2];
  const parallel = parts[3];
  const salt = parts[4];
  const key = parts[5];
  if (
    algorithm !== "scrypt" ||
    cost !== String(SCRYPT_N) ||
    blockSize !== String(SCRYPT_R) ||
    parallel !== String(SCRYPT_P) ||
    !salt ||
    !key
  ) {
    return undefined;
  }

  const decoded = Buffer.from(key, "base64url");
  if (decoded.length !== KEY_LENGTH) {
    return undefined;
  }

  return { salt, key: decoded };
}

function scryptKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived);
    });
  });
}
