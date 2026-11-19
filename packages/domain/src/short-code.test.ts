import { describe, expect, it } from "vitest";
import {
  ROOM_SHORT_CODE_ALPHABET,
  ROOM_SHORT_CODE_LENGTH,
  generateRoomShortCode,
  isValidRoomShortCode,
  normalizeRoomShortCode,
} from "./short-code.js";

describe("room short code", () => {
  it("normalizes lowercase, whitespace, and hyphens", () => {
    expect(normalizeRoomShortCode("  a7k-9m2 ")).toBe("A7K9M2");
    expect(normalizeRoomShortCode("ab c - d e f")).toBe("ABCDEF");
    expect(normalizeRoomShortCode("  x2y3z4\t")).toBe("X2Y3Z4");
  });

  it("validates exact 6-char codes from the unambiguous alphabet", () => {
    expect(isValidRoomShortCode("A7K9M2")).toBe(true);
    expect(isValidRoomShortCode("ABCDEF")).toBe(true);
    expect(isValidRoomShortCode("234567")).toBe(true);

    // Excludes ambiguous characters 0, O, 1, I
    expect(isValidRoomShortCode("A7K9M0")).toBe(false);
    expect(isValidRoomShortCode("A7K9MO")).toBe(false);
    expect(isValidRoomShortCode("A7K9M1")).toBe(false);
    expect(isValidRoomShortCode("A7K9MI")).toBe(false);

    // Rejects lowercase, hyphens, and wrong lengths
    expect(isValidRoomShortCode("a7k9m2")).toBe(false);
    expect(isValidRoomShortCode("A7K-9M")).toBe(false);
    expect(isValidRoomShortCode("A7K9M")).toBe(false);
    expect(isValidRoomShortCode("A7K9M23")).toBe(false);
    expect(isValidRoomShortCode("")).toBe(false);
  });

  it("generates valid 6-char codes from default crypto", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateRoomShortCode();
      expect(code).toHaveLength(ROOM_SHORT_CODE_LENGTH);
      expect(isValidRoomShortCode(code)).toBe(true);
    }
  });

  it("maps deterministic randomBytesFn bytes cleanly into the alphabet", () => {
    const code = generateRoomShortCode((size) => {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) {
        bytes[i] = i;
      }
      return bytes;
    });

    expect(code).toBe(ROOM_SHORT_CODE_ALPHABET.slice(0, ROOM_SHORT_CODE_LENGTH));
    expect(isValidRoomShortCode(code)).toBe(true);
  });
});
