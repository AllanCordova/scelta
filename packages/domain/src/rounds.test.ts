import { describe, expect, it } from "vitest";
import {
  canDeclineRound,
  canRestartRound,
  evaluateMultiVacancyProgress,
  nextRoundPlan,
  resolveNextRoundCandidateIds,
} from "./rounds.js";

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

    expect(outcome).toEqual({ kind: "winners", winnerIds: ["a"], remainingVacancies: 0 });
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
      remainingVacancies: 1,
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
      remainingVacancies: 1,
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
      remainingVacancies: 1,
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
      expect(outcome.remainingVacancies).toBe(1);
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
      remainingVacancies: 1,
      reason: "Custom preset requires explicit runoff configuration",
    });
  });

  describe("multi-vacancy officer plans (5 vacancies)", () => {
    it("returns winners when all 5 vacancies are filled", () => {
      const outcome = nextRoundPlan({
        roundNumber: 1,
        preset: "ipb_local_officers",
        vacancies: 5,
        totalBallots: 100,
        tallies: [
          { candidateId: "c1", votes: 90 },
          { candidateId: "c2", votes: 85 },
          { candidateId: "c3", votes: 80 },
          { candidateId: "c4", votes: 75 },
          { candidateId: "c5", votes: 70 },
          { candidateId: "c6", votes: 60 },
        ],
      });

      expect(outcome).toEqual({
        kind: "winners",
        winnerIds: ["c1", "c2", "c3", "c4", "c5"],
        remainingVacancies: 0,
      });
    });

    it("plans next scrutiny for 1 remaining vacancy with only unelected candidates when 4 of 5 are elected", () => {
      const outcome = nextRoundPlan({
        roundNumber: 1,
        preset: "ipb_local_officers",
        vacancies: 5,
        totalBallots: 100,
        tallies: [
          { candidateId: "c1", votes: 85 },
          { candidateId: "c2", votes: 80 },
          { candidateId: "c3", votes: 70 },
          { candidateId: "c4", votes: 60 },
          { candidateId: "c5", votes: 50 },
          { candidateId: "c6", votes: 42 },
          { candidateId: "c7", votes: 30 },
        ],
      });

      expect(outcome).toEqual({
        kind: "next_round",
        candidateIds: ["c5", "c6", "c7"],
        electedCandidateIds: ["c1", "c2", "c3", "c4"],
        remainingVacancies: 1,
        reason:
          "Partial election; open another ballot for remaining vacancies with unelected candidates",
      });
    });

    it("plans a runoff exclusively among tied candidates when more than N reach majority and tie on the 5th vacancy", () => {
      const outcome = nextRoundPlan({
        roundNumber: 1,
        preset: "ipb_local_officers",
        vacancies: 5,
        totalBallots: 100,
        tallies: [
          { candidateId: "c1", votes: 90 },
          { candidateId: "c2", votes: 85 },
          { candidateId: "c3", votes: 80 },
          { candidateId: "c4", votes: 75 },
          { candidateId: "c5", votes: 60 },
          { candidateId: "c6", votes: 60 },
          { candidateId: "c7", votes: 45 },
        ],
      });

      expect(outcome).toEqual({
        kind: "next_round",
        candidateIds: ["c5", "c6"],
        electedCandidateIds: ["c1", "c2", "c3", "c4"],
        remainingVacancies: 1,
        isLastVacancyTieRunoff: true,
        reason: "Tie on the last vacancy; runoff among tied candidates",
      });
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

  it("rejects opening a 4th round when 3 rounds have already been held without a winner", () => {
    expect(
      resolveNextRoundCandidateIds({
        preset: "ipb_society_board",
        previousRoundNumber: 3,
        previousOutcome: "no_majority",
        eligibleCandidateIds: ["a", "b"],
        previousTallies: [
          { candidateId: "a", votes: 1 },
          { candidateId: "b", votes: 1 },
        ],
      }),
    ).toEqual({ ok: false, reason: "max_rounds_reached" });
  });

  it("supports multi-vacancy partial election next round with only unelected candidates", () => {
    const resolved = resolveNextRoundCandidateIds({
      preset: "ipb_local_officers",
      previousRoundNumber: 1,
      previousOutcome: "elected",
      eligibleCandidateIds: ["c1", "c2", "c3", "c4", "c5", "c6", "c7"],
      previousTallies: [],
      vacancies: 5,
      remainingVacancies: 1,
      alreadyElectedCandidateIds: ["c1", "c2", "c3", "c4"],
    });

    expect(resolved).toEqual({ ok: true, candidateIds: ["c5", "c6", "c7"] });
  });

  it("restricts next round exclusively to tied candidates on a last-vacancy tie", () => {
    const autoResolved = resolveNextRoundCandidateIds({
      preset: "ipb_local_officers",
      previousRoundNumber: 1,
      previousOutcome: "elected",
      eligibleCandidateIds: ["c1", "c2", "c3", "c4", "c5", "c6", "c7"],
      previousTallies: [],
      vacancies: 5,
      remainingVacancies: 1,
      alreadyElectedCandidateIds: ["c1", "c2", "c3", "c4"],
      lastVacancyTieCandidateIds: ["c5", "c6"],
    });
    expect(autoResolved).toEqual({ ok: true, candidateIds: ["c5", "c6"] });

    const invalidOverride = resolveNextRoundCandidateIds({
      preset: "ipb_local_officers",
      previousRoundNumber: 1,
      previousOutcome: "elected",
      eligibleCandidateIds: ["c1", "c2", "c3", "c4", "c5", "c6", "c7"],
      previousTallies: [],
      vacancies: 5,
      remainingVacancies: 1,
      alreadyElectedCandidateIds: ["c1", "c2", "c3", "c4"],
      lastVacancyTieCandidateIds: ["c5", "c6"],
      requestedCandidateIds: ["c5", "c7"],
    });
    expect(invalidOverride).toEqual({ ok: false, reason: "invalid_candidate_subset" });
  });
});

describe("evaluateMultiVacancyProgress", () => {
  it("accumulates elected candidates across closed rounds and ignores annulled/declined rounds", () => {
    const progress = evaluateMultiVacancyProgress(5, [
      { status: "closed", outcome: "elected", winnerCandidateIds: ["c1", "c2"] },
      { status: "restarted", outcome: "annulled", winnerCandidateIds: ["c9"] },
      { status: "closed", outcome: "declined", winnerCandidateIds: ["c8"] },
      { status: "closed", outcome: "no_majority", winnerCandidateIds: [] },
      { status: "closed", outcome: "elected", winnerCandidateIds: ["c3", "c4"] },
    ]);

    expect(progress).toEqual({
      totalVacancies: 5,
      electedCandidateIds: ["c1", "c2", "c3", "c4"],
      remainingVacancies: 1,
      isComplete: false,
    });

    const complete = evaluateMultiVacancyProgress(5, [
      { status: "closed", outcome: "elected", winnerCandidateIds: ["c1", "c2", "c3", "c4"] },
      { status: "closed", outcome: "elected", winnerCandidateId: "c5" },
    ]);
    expect(complete).toEqual({
      totalVacancies: 5,
      electedCandidateIds: ["c1", "c2", "c3", "c4", "c5"],
      remainingVacancies: 0,
      isComplete: true,
    });
  });
});

describe("canRestartRound", () => {
  it("allows restarting an open round in an open or test room", () => {
    expect(canRestartRound("open", "open", null)).toEqual({ ok: true });
    expect(canRestartRound("test", "open", null)).toEqual({ ok: true });
  });

  it("rejects restarting when room is not open, round is closed, or winner is elected", () => {
    expect(canRestartRound("draft", "open", null)).toEqual({
      ok: false,
      reason: "room_not_open",
    });
    expect(canRestartRound("open", "closed", "no_majority")).toEqual({
      ok: false,
      reason: "round_not_open",
    });
    expect(canRestartRound("open", "closed", "elected")).toEqual({
      ok: false,
      reason: "winner_already_elected",
    });
  });
});

describe("canDeclineRound", () => {
  it("allows declining only a closed round with an elected winner in an open or test room", () => {
    expect(canDeclineRound("open", "closed", "elected")).toEqual({ ok: true });
    expect(canDeclineRound("test", "closed", "elected")).toEqual({ ok: true });
  });

  it("rejects declining when room is not open, round is not closed, or no winner was elected", () => {
    expect(canDeclineRound("draft", "closed", "elected")).toEqual({
      ok: false,
      reason: "room_not_open",
    });
    expect(canDeclineRound("open", "open", null)).toEqual({
      ok: false,
      reason: "round_not_closed",
    });
    expect(canDeclineRound("open", "closed", "no_majority")).toEqual({
      ok: false,
      reason: "winner_not_elected",
    });
  });
});
