import { describe, expect, it } from "vitest";
import {
  DISPLAY_NAME_MAX_LENGTH,
  JOIN_KEY_MAX_LENGTH,
  JOIN_KEY_MIN_LENGTH,
  canEnterRoom,
  canJoinRoom,
  extractBirthDayMonth,
  matchesRosterSearch,
  normalizeAccessCode,
  normalizeRosterSearchQuery,
  resolveRoomMaxParticipants,
  validateAccessCodeJoin,
  validateJoinIdentity,
  verifyBirthDayMonth,
} from "./join.js";

const validKey = "a".repeat(JOIN_KEY_MIN_LENGTH);

describe("canJoinRoom", () => {
  it("allows open and test rooms only", () => {
    expect(canJoinRoom("open")).toBe(true);
    expect(canJoinRoom("test")).toBe(true);
    expect(canJoinRoom("voting")).toBe(false);
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

describe("resolveRoomMaxParticipants", () => {
  it("uses explicit positive maxParticipants when provided, otherwise eligibleCount", () => {
    expect(resolveRoomMaxParticipants({ maxParticipants: 30, eligibleCount: 50 })).toBe(30);
    expect(resolveRoomMaxParticipants({ maxParticipants: null, eligibleCount: 50 })).toBe(50);
    expect(resolveRoomMaxParticipants({ maxParticipants: undefined, eligibleCount: 0 })).toBe(0);
    expect(resolveRoomMaxParticipants({ maxParticipants: 0, eligibleCount: 25 })).toBe(25);
  });
});

describe("canEnterRoom", () => {
  it("enforces room status, reentry bypass, entryOpen, and capacity limits", () => {
    expect(
      canEnterRoom({
        status: "draft",
        entryOpen: true,
        presentCount: 0,
        maxParticipants: 10,
        eligibleCount: 10,
      }),
    ).toEqual({ allowed: false, reason: "room_not_joinable" });

    expect(
      canEnterRoom({
        status: "open",
        entryOpen: false,
        presentCount: 0,
        maxParticipants: 10,
        eligibleCount: 10,
      }),
    ).toEqual({ allowed: false, reason: "entry_closed" });

    expect(
      canEnterRoom({
        status: "open",
        entryOpen: false,
        presentCount: 10,
        maxParticipants: 10,
        eligibleCount: 10,
        isReentry: true,
      }),
    ).toEqual({ allowed: true });

    expect(
      canEnterRoom({
        status: "open",
        entryOpen: true,
        presentCount: 10,
        maxParticipants: null,
        eligibleCount: 10,
      }),
    ).toEqual({ allowed: false, reason: "room_full" });

    expect(
      canEnterRoom({
        status: "open",
        entryOpen: true,
        presentCount: 9,
        maxParticipants: null,
        eligibleCount: 10,
      }),
    ).toEqual({ allowed: true });

    expect(
      canEnterRoom({
        status: "test",
        entryOpen: true,
        presentCount: 25,
        maxParticipants: null,
        eligibleCount: 0,
      }),
    ).toEqual({ allowed: true });
  });
});

describe("extractBirthDayMonth and verifyBirthDayMonth", () => {
  it("extracts UTC day and month from ISO strings and Date objects", () => {
    expect(extractBirthDayMonth("1985-03-09")).toEqual({ day: 9, month: 3 });
    expect(extractBirthDayMonth("1985-12-31T23:59:59.000Z")).toEqual({ day: 31, month: 12 });
    expect(extractBirthDayMonth(new Date(Date.UTC(1990, 6, 14)))).toEqual({ day: 14, month: 7 });
    expect(extractBirthDayMonth(null)).toBeNull();
    expect(extractBirthDayMonth("1990-02-30")).toBeNull();
  });

  it("allows entry when no stored birth date exists, and validates day/month when it does", () => {
    expect(verifyBirthDayMonth(null)).toEqual({ ok: true });
    expect(verifyBirthDayMonth(undefined, { birthDay: 1, birthMonth: 1 })).toEqual({ ok: true });

    expect(verifyBirthDayMonth("1992-08-25", {})).toEqual({
      ok: false,
      reason: "birth_date_required",
    });

    expect(verifyBirthDayMonth("1992-08-25", { birthDay: 0, birthMonth: 8 })).toEqual({
      ok: false,
      reason: "invalid_birth_day_month",
    });
    expect(verifyBirthDayMonth("1992-08-25", { birthDay: 25, birthMonth: 13 })).toEqual({
      ok: false,
      reason: "invalid_birth_day_month",
    });
    expect(verifyBirthDayMonth("1992-08-25", { birthDay: 25.5, birthMonth: 8 })).toEqual({
      ok: false,
      reason: "invalid_birth_day_month",
    });

    expect(verifyBirthDayMonth("1992-08-25", { birthDay: 24, birthMonth: 8 })).toEqual({
      ok: false,
      reason: "birth_date_mismatch",
    });

    expect(verifyBirthDayMonth("1992-08-25", { birthDay: 25, birthMonth: 8 })).toEqual({
      ok: true,
    });
  });
});

describe("normalizeRosterSearchQuery and matchesRosterSearch", () => {
  it("normalizes diacritics, casing, and whitespace and requires at least 2 characters", () => {
    expect(normalizeRosterSearchQuery("  João   Páulo  ")).toBe("joao paulo");
    expect(matchesRosterSearch("João Paulo Silva", "joao")).toBe(true);
    expect(matchesRosterSearch("João Paulo Silva", "PAU")).toBe(true);
    expect(matchesRosterSearch("João Paulo Silva", "j")).toBe(false);
    expect(matchesRosterSearch("João Paulo Silva", "  ")).toBe(false);
    expect(matchesRosterSearch("João Paulo Silva", "maria")).toBe(false);
  });
});
