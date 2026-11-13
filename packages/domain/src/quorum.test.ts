import { describe, expect, it } from "vitest";
import {
  canPublishWinner,
  closeRoundOutcome,
  evaluateQuorum,
  hasReachedQuorum,
  resolveQuorumRequired,
} from "./quorum.js";

describe("resolveQuorumRequired", () => {
  it("returns absolute quorum", () => {
    expect(
      resolveQuorumRequired({
        eligibleCount: 100,
        quorumValue: 34,
        quorumUnit: "absolute",
      }),
    ).toBe(34);
  });

  it("ceils percent quorum (one third of 100)", () => {
    expect(
      resolveQuorumRequired({
        eligibleCount: 100,
        quorumValue: 100 / 3,
        quorumUnit: "percent",
      }),
    ).toBe(34);
  });

  it("ceils a percent of a smaller eligible list", () => {
    expect(
      resolveQuorumRequired({
        eligibleCount: 10,
        quorumValue: 34,
        quorumUnit: "percent",
      }),
    ).toBe(4);
  });

  it("ignores the eligible list when the unit is absolute", () => {
    expect(
      resolveQuorumRequired({
        eligibleCount: 0,
        quorumValue: 5,
        quorumUnit: "absolute",
      }),
    ).toBe(5);
  });

  it("returns zero when a percent quorum has no eligible list", () => {
    expect(
      resolveQuorumRequired({
        eligibleCount: 0,
        quorumValue: 34,
        quorumUnit: "percent",
      }),
    ).toBe(0);
  });

  it("rejects negative or out-of-range percent quorum values", () => {
    expect(() =>
      resolveQuorumRequired({
        eligibleCount: 10,
        quorumValue: -1,
        quorumUnit: "absolute",
      }),
    ).toThrow("quorumValue must be >= 0");
    expect(() =>
      resolveQuorumRequired({
        eligibleCount: 10,
        quorumValue: 101,
        quorumUnit: "percent",
      }),
    ).toThrow("percent quorumValue must be <= 100");
  });
});

describe("hasReachedQuorum", () => {
  it("is true when present meets required", () => {
    expect(
      hasReachedQuorum({
        presentCount: 34,
        eligibleCount: 100,
        quorumValue: 33.34,
        quorumUnit: "percent",
      }),
    ).toBe(true);
  });

  it("is false when present is below required", () => {
    expect(
      hasReachedQuorum({
        presentCount: 10,
        eligibleCount: 100,
        quorumValue: 34,
        quorumUnit: "absolute",
      }),
    ).toBe(false);
  });

  it("meets an absolute quorum without an eligible list", () => {
    expect(
      hasReachedQuorum({
        presentCount: 5,
        eligibleCount: 0,
        quorumValue: 5,
        quorumUnit: "absolute",
      }),
    ).toBe(true);
    expect(
      hasReachedQuorum({
        presentCount: 4,
        eligibleCount: 999,
        quorumValue: 5,
        quorumUnit: "absolute",
      }),
    ).toBe(false);
  });

  it("is false one person below a percent threshold", () => {
    expect(
      hasReachedQuorum({
        presentCount: 3,
        eligibleCount: 10,
        quorumValue: 34,
        quorumUnit: "percent",
      }),
    ).toBe(false);
  });

  it("does not treat an empty percent list as quorum", () => {
    expect(
      hasReachedQuorum({
        presentCount: 0,
        eligibleCount: 0,
        quorumValue: 34,
        quorumUnit: "percent",
      }),
    ).toBe(false);
    expect(
      evaluateQuorum({
        presentCount: 8,
        eligibleCount: 0,
        quorumValue: 34,
        quorumUnit: "percent",
      }),
    ).toEqual({
      presentCount: 8,
      eligibleCount: 0,
      requiredCount: 0,
      quorumMet: false,
    });
  });
});

describe("round quorum gate", () => {
  it("marks a short round failed and leaves a met round untallied", () => {
    expect(closeRoundOutcome(false)).toBe("failed_quorum");
    expect(closeRoundOutcome(true)).toBeNull();
  });

  it("publishes only an elected round", () => {
    expect(canPublishWinner("elected")).toBe(true);
    expect(canPublishWinner(null)).toBe(false);
    expect(canPublishWinner("failed_quorum")).toBe(false);
    expect(canPublishWinner("no_majority")).toBe(false);
  });
});
