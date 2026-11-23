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
      nullVotes: 0,
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
      nullVotes: 0,
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
    expect(empty.nullVotes).toBe(0);
  });

  it("counts null/blank votes in totalVotes and threshold", () => {
    const tally = tallyRoundVotes(candidates, ["cand-1", "cand-1", null, null]);
    expect(tally).toEqual({
      totalVotes: 4,
      nullVotes: 2,
      threshold: 3,
      outcome: "no_majority",
      winnerId: null,
      winnerName: null,
      standings: [
        { candidateId: "cand-1", displayName: "Paulo", votes: 2 },
        { candidateId: "cand-2", displayName: "Silas", votes: 0 },
      ],
    });
  });

  it("throws when a ballot references an unknown candidate", () => {
    expect(() => tallyRoundVotes(candidates, ["unknown"])).toThrow(
      "Ballot references an unknown candidate",
    );
  });

  it("breaks a 3rd-round tie automatically in favor of the oldest candidate when birth dates are available", () => {
    const candidatesWithAge = [
      { id: "cand-young", displayName: "Jovem", birthDate: "2008-05-10" },
      { id: "cand-old", displayName: "Veterano", birthDate: "2005-02-01" },
    ];
    const tally = tallyRoundVotes(candidatesWithAge, ["cand-young", "cand-old"], {
      roundNumber: 3,
    });
    expect(tally).toEqual({
      totalVotes: 2,
      nullVotes: 0,
      threshold: 2,
      outcome: "elected",
      winnerId: "cand-old",
      winnerName: "Veterano",
      standings: [
        { candidateId: "cand-young", displayName: "Jovem", votes: 1 },
        { candidateId: "cand-old", displayName: "Veterano", votes: 1 },
      ],
      tieBreakReason: "age",
    });
  });

  it("marks tieBreakRequired in 3rd round when tied candidates lack birthDate or have equal birthDate", () => {
    const tally = tallyRoundVotes(candidates, ["cand-1", "cand-2"], { roundNumber: 3 });
    expect(tally).toEqual({
      totalVotes: 2,
      nullVotes: 0,
      threshold: 2,
      outcome: "no_majority",
      winnerId: null,
      winnerName: null,
      standings: [
        { candidateId: "cand-1", displayName: "Paulo", votes: 1 },
        { candidateId: "cand-2", displayName: "Silas", votes: 1 },
      ],
      tieBreakRequired: true,
      tiedCandidates: [
        { id: "cand-1", displayName: "Paulo", birthDate: null },
        { id: "cand-2", displayName: "Silas", birthDate: null },
      ],
    });
  });

  it("honors winnerOverrideId when admin resolves a 3rd-round tie", () => {
    const tally = tallyRoundVotes(candidates, ["cand-1", "cand-2"], {
      roundNumber: 3,
      winnerOverrideId: "cand-2",
      tieBreakReason: "admin_tiebreak",
    });
    expect(tally).toEqual({
      totalVotes: 2,
      nullVotes: 0,
      threshold: 2,
      outcome: "elected",
      winnerId: "cand-2",
      winnerName: "Silas",
      standings: [
        { candidateId: "cand-1", displayName: "Paulo", votes: 1 },
        { candidateId: "cand-2", displayName: "Silas", votes: 1 },
      ],
      tieBreakReason: "admin_tiebreak",
    });
  });

  it("combines online ballots and paper tally with voteOrigin breakdown and paper-adjusted majority", () => {
    const tally = tallyRoundVotes(candidates, ["cand-1", "cand-2", null], {
      paperTally: {
        ballotCount: 5,
        blankVotes: 1,
        nullVotes: 1,
        candidateVotes: { "cand-1": 3, "cand-2": 0 },
      },
    });

    // Majority base = 3 online ballots + 3 paper valid + 1 paper blank = 7 -> threshold = 4
    expect(tally).toEqual({
      totalVotes: 7,
      nullVotes: 3,
      threshold: 4,
      outcome: "elected",
      winnerId: "cand-1",
      winnerName: "Paulo",
      standings: [
        { candidateId: "cand-1", displayName: "Paulo", votes: 4, onlineVotes: 1, paperVotes: 3 },
        { candidateId: "cand-2", displayName: "Silas", votes: 1, onlineVotes: 1, paperVotes: 0 },
      ],
      voteOrigin: {
        online: { ballots: 3, candidateVotes: 2, blankVotes: 1 },
        paper: { ballots: 5, candidateVotes: 3, blankVotes: 1, nullVotes: 1 },
      },
    });
  });

  it("elects a winner from paper votes even when online ballots are split or empty", () => {
    const tally = tallyRoundVotes(candidates, ["cand-1", "cand-2"], {
      paperTally: {
        ballotCount: 2,
        blankVotes: 0,
        nullVotes: 0,
        candidateVotes: { "cand-2": 2 },
      },
    });

    expect(tally.outcome).toBe("elected");
    expect(tally.winnerId).toBe("cand-2");
    expect(tally.totalVotes).toBe(4);
    expect(tally.threshold).toBe(3);
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
