import { describe, expect, it } from "vitest";
import {
  DISPLAY_NAME_MAX_LENGTH,
  JOIN_KEY_MAX_LENGTH,
  JOIN_KEY_MIN_LENGTH,
  canJoinRoom,
  normalizeAccessCode,
  validateAccessCodeJoin,
  validateJoinIdentity,
} from "./join.js";

const validKey = "a".repeat(JOIN_KEY_MIN_LENGTH);

describe("canJoinRoom", () => {
  it("allows open and voting rooms only", () => {
    expect(canJoinRoom("open")).toBe(true);
    expect(canJoinRoom("voting")).toBe(true);
    expect(canJoinRoom("draft")).toBe(false);
    expect(canJoinRoom("closed")).toBe(false);
    expect(canJoinRoom("cancelled")).toBe(false);
    expect(canJoinRoom("paused")).toBe(false);
    expect(canJoinRoom("")).toBe(false);
  });
});

describe("validateJoinIdentity", () => {
  it("trims the display name and keeps the join key", () => {
    const result = validateJoinIdentity({
      displayName: "  Ana Maria  ",
      joinKey: validKey,
    });

    expect(result).toEqual({
      ok: true,
      value: { displayName: "Ana Maria", joinKey: validKey },
    });
  });

  it("accepts a name at the length limit and a long join key", () => {
    const result = validateJoinIdentity({
      displayName: "á".repeat(DISPLAY_NAME_MAX_LENGTH),
      joinKey: `key_${"A".repeat(JOIN_KEY_MAX_LENGTH - 4)}`,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a blank name and a short or padded key together", () => {
    const result = validateJoinIdentity({
      displayName: "   ",
      joinKey: "short",
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "displayName", code: "required" },
        { field: "joinKey", code: "out_of_range" },
      ],
    });
  });

  it("rejects an oversized name, control characters, and a key with spaces", () => {
    const longName = validateJoinIdentity({
      displayName: "a".repeat(DISPLAY_NAME_MAX_LENGTH + 1),
      joinKey: validKey,
    });
    expect(longName).toEqual({
      ok: false,
      errors: [{ field: "displayName", code: "out_of_range" }],
    });

    const control = validateJoinIdentity({
      displayName: "Ana\nMaria",
      joinKey: validKey,
    });
    expect(control).toEqual({
      ok: false,
      errors: [{ field: "displayName", code: "invalid" }],
    });

    const paddedKey = validateJoinIdentity({
      displayName: "Ana",
      joinKey: ` ${validKey} `,
    });
    expect(paddedKey).toEqual({
      ok: false,
      errors: [{ field: "joinKey", code: "invalid" }],
    });
  });

  it("rejects a missing key and a key that is too long", () => {
    const missing = validateJoinIdentity({ displayName: "Ana", joinKey: "   " });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors).toEqual([{ field: "joinKey", code: "required" }]);
    }

    const tooLong = validateJoinIdentity({
      displayName: "Ana",
      joinKey: "a".repeat(JOIN_KEY_MAX_LENGTH + 1),
    });
    expect(tooLong).toEqual({
      ok: false,
      errors: [{ field: "joinKey", code: "out_of_range" }],
    });
  });
});

describe("validateAccessCodeJoin", () => {
  const validKey = "a".repeat(JOIN_KEY_MIN_LENGTH);

  it("normalizes and accepts a 6-character access code with a valid join key", () => {
    expect(normalizeAccessCode("  a7k9m2 ")).toBe("A7K9M2");
    expect(validateAccessCodeJoin({ code: "  a7k9m2 ", joinKey: validKey })).toEqual({
      ok: true,
      value: { code: "A7K9M2", joinKey: validKey },
    });
  });

  it("rejects empty, wrong-length, or non-alphanumeric access codes", () => {
    expect(validateAccessCodeJoin({ code: "   ", joinKey: validKey })).toEqual({
      ok: false,
      errors: [{ field: "code", code: "required" }],
    });
    expect(validateAccessCodeJoin({ code: "ABC", joinKey: validKey })).toEqual({
      ok: false,
      errors: [{ field: "code", code: "out_of_range" }],
    });
    expect(validateAccessCodeJoin({ code: "AB-123", joinKey: validKey })).toEqual({
      ok: false,
      errors: [{ field: "code", code: "invalid" }],
    });
  });
});
