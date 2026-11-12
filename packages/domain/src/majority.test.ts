import { describe, expect, it } from "vitest";
import { hasAbsoluteMajority, selectTopCandidates } from "./majority.js";

describe("hasAbsoluteMajority", () => {
  it("requires more than half of votes", () => {
    const result = hasAbsoluteMajority([
      { candidateId: "a", votes: 6 },
      { candidateId: "b", votes: 5 },
    ]);

    expect(result.threshold).toBe(6);
    expect(result.winnerIds).toEqual(["a"]);
  });

  it("returns no winner on tie below threshold", () => {
    const result = hasAbsoluteMajority([
      { candidateId: "a", votes: 5 },
      { candidateId: "b", votes: 5 },
    ]);

    expect(result.threshold).toBe(6);
    expect(result.winnerIds).toEqual([]);
  });
});

describe("selectTopCandidates", () => {
  it("returns the highest vote getters", () => {
    expect(
      selectTopCandidates(
        [
          { candidateId: "a", votes: 3 },
          { candidateId: "b", votes: 9 },
          { candidateId: "c", votes: 5 },
        ],
        2,
      ),
    ).toEqual(["b", "c"]);
  });
});
