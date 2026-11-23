export const ROOM_SHORT_CODE_LENGTH = 6;
export const ROOM_SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const ROOM_SHORT_CODE_PATTERN = new RegExp(`^[${ROOM_SHORT_CODE_ALPHABET}]{${ROOM_SHORT_CODE_LENGTH}}$`);

type GlobalWithCrypto = {
  crypto?: {
    getRandomValues(array: Uint8Array): Uint8Array;
  };
};

function defaultRandomBytes(size: number): Uint8Array {
  const cryptoApi = (globalThis as GlobalWithCrypto).crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("Web Crypto API is unavailable to generate room short code");
  }
  return cryptoApi.getRandomValues(new Uint8Array(size));
}

/** Normalizes user input by trimming, uppercasing, and stripping spaces or hyphens. */
export function normalizeRoomShortCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "");
}

/** Validates that a normalized code is exactly 6 characters from the unambiguous alphabet. */
export function isValidRoomShortCode(code: string): boolean {
  return ROOM_SHORT_CODE_PATTERN.test(code);
}

/** Generates a 6-character room short code using rejection sampling to avoid modulo bias. */
export function generateRoomShortCode(
  randomBytesFn: (size: number) => Uint8Array = defaultRandomBytes,
): string {
  const alphabetLength = ROOM_SHORT_CODE_ALPHABET.length;
  const maxValidByte = Math.floor(256 / alphabetLength) * alphabetLength;
  let code = "";

  while (code.length < ROOM_SHORT_CODE_LENGTH) {
    const remaining = ROOM_SHORT_CODE_LENGTH - code.length;
    const bytes = randomBytesFn(remaining);
    for (let i = 0; i < bytes.length && code.length < ROOM_SHORT_CODE_LENGTH; i += 1) {
      const byte = bytes[i];
      if (byte === undefined || byte >= maxValidByte) {
        continue;
      }
      code += ROOM_SHORT_CODE_ALPHABET[byte % alphabetLength];
    }
  }

  return code;
}
