import { describe, expect, it } from "vitest";
import { hasAbsoluteMajority, selectTopCandidates, tallyRoundVotes } from "./majority.js";

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

describe("tallyRoundVotes", () => {
  const candidates = [
    { id: "cand-1", displayName: "Paulo" },
    { id: "cand-2", displayName: "Silas" },
  ];

  it("elects a candidate who reaches strictly more than 50% of votes", () => {
    const tally = tallyRoundVotes(candidates, ["cand-1", "cand-2", "cand-1"]);
    expect(tally).toEqual({
      totalVotes: 3,
      threshold: 2,
      outcome: "elected",
      winnerId: "cand-1",
      winnerName: "Paulo",
      standings: [
        { candidateId: "cand-1", displayName: "Paulo", votes: 2 },
        { candidateId: "cand-2", displayName: "Silas", votes: 1 },
      ],
    });
  });

  it("reports no_majority when votes are split 50/50 or no ballots were cast", () => {
    const split = tallyRoundVotes(candidates, ["cand-1", "cand-2"]);
    expect(split).toEqual({
      totalVotes: 2,
      threshold: 2,
      outcome: "no_majority",
      winnerId: null,
      winnerName: null,
      standings: [
        { candidateId: "cand-1", displayName: "Paulo", votes: 1 },
        { candidateId: "cand-2", displayName: "Silas", votes: 1 },
      ],
    });

    const empty = tallyRoundVotes(candidates, []);
    expect(empty.outcome).toBe("no_majority");
    expect(empty.winnerId).toBeNull();
    expect(empty.totalVotes).toBe(0);
  });

  it("throws when a ballot references an unknown candidate", () => {
    expect(() => tallyRoundVotes(candidates, ["unknown"])).toThrow(
      "Ballot references an unknown candidate",
    );
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
