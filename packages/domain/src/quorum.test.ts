import { describe, expect, it } from "vitest";
import { hasReachedQuorum, resolveQuorumRequired } from "./quorum.js";

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
});
