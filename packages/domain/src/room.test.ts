import { describe, expect, it } from "vitest";
import { canOpenRound, findPreset, validateCreateRoom } from "./room.js";

describe("validateCreateRoom", () => {
  it("pre-fills quorum, majority, and round behavior from the local officers preset", () => {
    const result = validateCreateRoom({
      title: "  Eleição de presbíteros  ",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        title: "Eleição de presbíteros",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 34,
        quorumUnit: "percent",
        eligibleCount: 0,
        status: "draft",
        majorityRule: "absolute_majority",
        roundBehavior: findPreset("ipb_local_officers").roundBehavior,
      },
    });
  });

  it("pre-fills society board quorum above half of the eligible list", () => {
    const result = validateCreateRoom({
      title: "Diretoria UPA",
      roomType: "upa_board",
      rulesPreset: "ipb_society_board",
      status: "open",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.quorumValue).toBe(51);
      expect(result.value.quorumUnit).toBe("percent");
      expect(result.value.status).toBe("open");
      expect(result.value.roundBehavior).toContain("top two");
    }
  });

  it("keeps an explicit absolute quorum when the admin overrides the preset", () => {
    const result = validateCreateRoom({
      title: "Assembleia",
      roomType: "custom",
      rulesPreset: "ipb_local_officers",
      quorumValue: 12,
      quorumUnit: "absolute",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.quorumValue).toBe(12);
      expect(result.value.quorumUnit).toBe("absolute");
      expect(result.value.majorityRule).toBe("absolute_majority");
    }
  });

  it("rejects a percent quorum outside 1–100", () => {
    const result = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "custom",
      quorumValue: 101,
      quorumUnit: "percent",
    });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "quorumValue", code: "out_of_range" }],
    });
  });

  it("rejects a zero or negative absolute quorum", () => {
    const result = validateCreateRoom({
      title: "Assembleia",
      roomType: "deacon",
      rulesPreset: "custom",
      quorumValue: 0,
      quorumUnit: "absolute",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([{ field: "quorumValue", code: "out_of_range" }]);
    }
  });

  it("requires quorum when the custom preset has no default", () => {
    const result = validateCreateRoom({
      title: "Assembleia",
      roomType: "custom",
      rulesPreset: "custom",
    });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "quorumValue", code: "required" }],
    });
  });

  it("accepts an explicit percent quorum and a custom preset with an absolute quorum", () => {
    const percent = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      quorumValue: 60,
      quorumUnit: "percent",
    });
    expect(percent.ok).toBe(true);
    if (percent.ok) {
      expect(percent.value.quorumValue).toBe(60);
      expect(percent.value.quorumUnit).toBe("percent");
    }

    const custom = validateCreateRoom({
      title: "Assembleia",
      roomType: "custom",
      rulesPreset: "custom",
      quorumValue: 10,
      quorumUnit: "absolute",
    });
    expect(custom.ok).toBe(true);
    if (custom.ok) {
      expect(custom.value.majorityRule).toBe("absolute_majority");
      expect(custom.value.roundBehavior).toContain("not opened automatically");
    }
  });

  it("rejects a negative absolute quorum and an oversized title", () => {
    const negative = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "custom",
      quorumValue: -1,
      quorumUnit: "absolute",
    });
    expect(negative.ok).toBe(false);

    const longTitle = validateCreateRoom({
      title: "a".repeat(201),
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
    });
    expect(longTitle.ok).toBe(false);
  });

  it("stores an eligible count only when the admin sends one", () => {
    const omitted = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
    });
    expect(omitted.ok && omitted.value.eligibleCount).toBe(0);

    const set = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_society_board",
      eligibleCount: 80,
    });
    expect(set.ok && set.value.eligibleCount).toBe(80);
    if (set.ok) {
      expect(set.value.quorumUnit).toBe("percent");
    }
  });

  it("rejects an eligible count outside 0–100000", () => {
    const negative = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      eligibleCount: -1,
    });
    expect(negative.ok).toBe(false);
    if (!negative.ok) {
      expect(negative.errors).toEqual([{ field: "eligibleCount", code: "out_of_range" }]);
    }

    const fractional = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      eligibleCount: 1.5,
    });
    expect(fractional.ok).toBe(false);

    const maxAllowed = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      eligibleCount: 100_000,
    });
    expect(maxAllowed.ok && maxAllowed.value.eligibleCount).toBe(100_000);

    const aboveMax = validateCreateRoom({
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      eligibleCount: 100_001,
    });
    expect(aboveMax).toEqual({
      ok: false,
      errors: [{ field: "eligibleCount", code: "out_of_range" }],
    });
  });

  it("allows a round only in an open or voting room", () => {
    expect(canOpenRound("open")).toBe(true);
    expect(canOpenRound("voting")).toBe(true);
    expect(canOpenRound("draft")).toBe(false);
    expect(canOpenRound("closed")).toBe(false);
    expect(canOpenRound("cancelled")).toBe(false);
  });

  it("rejects a blank title", () => {
    const result = validateCreateRoom({
      title: "   ",
      roomType: "pastor",
      rulesPreset: "ipb_local_officers",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: "title", code: "required" });
    }
  });
});
