import { describe, expect, it } from "vitest";
import { nextRoundPlan } from "./rounds.js";

const tallies = [
  { candidateId: "a", votes: 4 },
  { candidateId: "b", votes: 3 },
  { candidateId: "c", votes: 2 },
];

describe("nextRoundPlan", () => {
  it("returns winners when absolute majority is met", () => {
    const outcome = nextRoundPlan({
      roundNumber: 1,
      preset: "ipb_society_board",
      tallies: [
        { candidateId: "a", votes: 6 },
        { candidateId: "b", votes: 2 },
      ],
    });

    expect(outcome).toEqual({ kind: "winners", winnerIds: ["a"] });
  });

  it("opens society runoff of top 2 after second ballot", () => {
    const outcome = nextRoundPlan({
      roundNumber: 2,
      preset: "ipb_society_board",
      tallies,
    });

    expect(outcome).toEqual({
      kind: "next_round",
      candidateIds: ["a", "b"],
      reason: "No absolute majority after two ballots; runoff of top 2",
    });
  });

  it("limits local officer ballots to most voted after second round", () => {
    const outcome = nextRoundPlan({
      roundNumber: 2,
      preset: "ipb_local_officers",
      tallies,
      vacancies: 1,
    });

    expect(outcome.kind).toBe("next_round");
    if (outcome.kind === "next_round") {
      expect(outcome.candidateIds).toEqual(["a", "b"]);
    }
  });
});
