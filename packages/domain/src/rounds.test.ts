import { describe, expect, it } from "vitest";
import { nextRoundPlan, resolveNextRoundCandidateIds } from "./rounds.js";

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

  it("keeps all candidates on second ballot when first ballot has no majority", () => {
    expect(
      nextRoundPlan({
        roundNumber: 1,
        preset: "ipb_society_board",
        tallies,
      }),
    ).toEqual({
      kind: "next_round",
      candidateIds: ["a", "b", "c"],
      reason: "No absolute majority; open another ballot",
    });

    expect(
      nextRoundPlan({
        roundNumber: 1,
        preset: "ipb_local_officers",
        tallies,
      }),
    ).toEqual({
      kind: "next_round",
      candidateIds: ["a", "b", "c"],
      reason: "No majority; open another ballot",
    });
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

  it("returns inconclusive for custom preset without majority", () => {
    expect(
      nextRoundPlan({
        roundNumber: 2,
        preset: "custom",
        tallies,
      }),
    ).toEqual({
      kind: "inconclusive",
      reason: "Custom preset requires explicit runoff configuration",
    });
  });
});

describe("resolveNextRoundCandidateIds", () => {
  it("keeps all candidates on round 1 or after round 1 without majority", () => {
    expect(
      resolveNextRoundCandidateIds({
        preset: "ipb_society_board",
        previousRoundNumber: null,
        previousOutcome: null,
        eligibleCandidateIds: ["a", "b", "c"],
        previousTallies: [],
      }),
    ).toEqual({ ok: true, candidateIds: ["a", "b", "c"] });

    expect(
      resolveNextRoundCandidateIds({
        preset: "ipb_society_board",
        previousRoundNumber: 1,
        previousOutcome: "no_majority",
        eligibleCandidateIds: ["a", "b", "c"],
        previousTallies: tallies,
      }),
    ).toEqual({ ok: true, candidateIds: ["a", "b", "c"] });
  });

  it("narrows to top 2 after round 2 for ipb_society_board and ipb_local_officers", () => {
    expect(
      resolveNextRoundCandidateIds({
        preset: "ipb_society_board",
        previousRoundNumber: 2,
        previousOutcome: "no_majority",
        eligibleCandidateIds: ["a", "b", "c"],
        previousTallies: tallies,
      }),
    ).toEqual({ ok: true, candidateIds: ["a", "b"] });

    expect(
      resolveNextRoundCandidateIds({
        preset: "ipb_local_officers",
        previousRoundNumber: 2,
        previousOutcome: "no_majority",
        eligibleCandidateIds: ["a", "b", "c"],
        previousTallies: tallies,
      }),
    ).toEqual({ ok: true, candidateIds: ["a", "b"] });
  });

  it("allows admin-selected candidate subset for ipb_local_officers and rejects invalid subsets", () => {
    expect(
      resolveNextRoundCandidateIds({
        preset: "ipb_local_officers",
        previousRoundNumber: 2,
        previousOutcome: "no_majority",
        eligibleCandidateIds: ["a", "b", "c"],
        previousTallies: tallies,
        requestedCandidateIds: ["a", "b"],
      }),
    ).toEqual({ ok: true, candidateIds: ["a", "b"] });

    expect(
      resolveNextRoundCandidateIds({
        preset: "ipb_local_officers",
        previousRoundNumber: 2,
        previousOutcome: "no_majority",
        eligibleCandidateIds: ["a", "b", "c"],
        previousTallies: tallies,
        requestedCandidateIds: [],
      }),
    ).toEqual({ ok: false, reason: "invalid_candidate_subset" });

    expect(
      resolveNextRoundCandidateIds({
        preset: "ipb_local_officers",
        previousRoundNumber: 2,
        previousOutcome: "no_majority",
        eligibleCandidateIds: ["a", "b", "c"],
        previousTallies: tallies,
        requestedCandidateIds: ["a", "unknown"],
      }),
    ).toEqual({ ok: false, reason: "invalid_candidate_subset" });

    expect(
      resolveNextRoundCandidateIds({
        preset: "ipb_society_board",
        previousRoundNumber: 2,
        previousOutcome: "no_majority",
        eligibleCandidateIds: ["a", "b", "c"],
        previousTallies: tallies,
        requestedCandidateIds: ["a", "c"],
      }),
    ).toEqual({ ok: false, reason: "invalid_candidate_subset" });
  });

  it("rejects opening another round after a winner is already elected", () => {
    expect(
      resolveNextRoundCandidateIds({
        preset: "ipb_society_board",
        previousRoundNumber: 1,
        previousOutcome: "elected",
        eligibleCandidateIds: ["a", "b"],
        previousTallies: [
          { candidateId: "a", votes: 3 },
          { candidateId: "b", votes: 1 },
        ],
      }),
    ).toEqual({ ok: false, reason: "winner_already_elected" });
  });
});
