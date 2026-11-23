import { describe, expect, it } from "vitest";
import { canCastBallot, validateBallotMarks, validateCandidateNames } from "./ballot.js";

describe("validateCandidateNames", () => {
  it("trims candidate names and preserves order", () => {
    expect(validateCandidateNames(["  Paulo  ", "Silas", "Barnabé "])).toEqual({
      ok: true,
      value: ["Paulo", "Silas", "Barnabé"],
    });
  });

  it("rejects blank, duplicate, oversized, or excessive candidate names", () => {
    expect(validateCandidateNames(["Paulo", "   "])).toEqual({
      ok: false,
      error: "empty_name",
    });
    expect(validateCandidateNames(["Paulo", "paulo"])).toEqual({
      ok: false,
      error: "duplicate_name",
    });
    expect(validateCandidateNames(["a".repeat(121)])).toEqual({
      ok: false,
      error: "name_too_long",
    });
    expect(
      validateCandidateNames(Array.from({ length: 51 }, (_, index) => `Candidato ${index}`)),
    ).toEqual({
      ok: false,
      error: "too_many_candidates",
    });
  });
});

describe("canCastBallot", () => {
  const validInput = {
    roomStatus: "open" as const,
    roundStatus: "open" as const,
    isParticipantPresent: true,
    hasAlreadyVoted: false,
    isCandidateEligible: true,
  };

  it("allows an eligible present participant to cast one vote in an open round", () => {
    expect(canCastBallot(validInput)).toEqual({ ok: true });
    expect(canCastBallot({ ...validInput, roomStatus: "test" })).toEqual({ ok: true });
  });

  it("rejects a second vote attempt", () => {
    expect(canCastBallot({ ...validInput, hasAlreadyVoted: true })).toEqual({
      ok: false,
      reason: "already_voted",
    });
  });

  it("rejects voting when room or round is not open, voter is absent, or candidate is ineligible", () => {
    expect(canCastBallot({ ...validInput, roomStatus: "draft" })).toEqual({
      ok: false,
      reason: "room_not_open",
    });
    expect(canCastBallot({ ...validInput, roundStatus: "closed" })).toEqual({
      ok: false,
      reason: "round_not_open",
    });
    expect(canCastBallot({ ...validInput, isParticipantPresent: false })).toEqual({
      ok: false,
      reason: "participant_not_present",
    });
    expect(canCastBallot({ ...validInput, isCandidateEligible: false })).toEqual({
      ok: false,
      reason: "invalid_candidate",
    });
  });
});

describe("validateBallotMarks", () => {
  const eligible = ["c1", "c2", "c3", "c4", "c5", "c6"];

  it("allows blank ballots (0 marks), partial marks, and up to N distinct eligible marks", () => {
    expect(
      validateBallotMarks({ candidateIds: [], vacancies: 5, eligibleCandidateIds: eligible }),
    ).toEqual({ ok: true, candidateIds: [] });

    expect(
      validateBallotMarks({
        candidateIds: ["c1", "c3"],
        vacancies: 5,
        eligibleCandidateIds: eligible,
      }),
    ).toEqual({ ok: true, candidateIds: ["c1", "c3"] });

    expect(
      validateBallotMarks({
        candidateIds: ["c1", "c2", "c3", "c4", "c5"],
        vacancies: 5,
        eligibleCandidateIds: eligible,
      }),
    ).toEqual({ ok: true, candidateIds: ["c1", "c2", "c3", "c4", "c5"] });
  });

  it("rejects more than N marks, duplicate marks, ineligible candidates, and invalid vacancies", () => {
    expect(
      validateBallotMarks({
        candidateIds: ["c1", "c2", "c3", "c4", "c5", "c6"],
        vacancies: 5,
        eligibleCandidateIds: eligible,
      }),
    ).toEqual({ ok: false, reason: "too_many_marks" });

    expect(
      validateBallotMarks({
        candidateIds: ["c1", "c2", "c1"],
        vacancies: 5,
        eligibleCandidateIds: eligible,
      }),
    ).toEqual({ ok: false, reason: "duplicate_candidate_mark" });

    expect(
      validateBallotMarks({
        candidateIds: ["c1", "unknown"],
        vacancies: 5,
        eligibleCandidateIds: eligible,
      }),
    ).toEqual({ ok: false, reason: "invalid_candidate" });

    expect(
      validateBallotMarks({
        candidateIds: [],
        vacancies: 0,
        eligibleCandidateIds: eligible,
      }),
    ).toEqual({ ok: false, reason: "invalid_vacancies" });

    expect(
      validateBallotMarks({
        candidateIds: ["c1"],
        vacancies: 1.5,
        eligibleCandidateIds: eligible,
      }),
    ).toEqual({ ok: false, reason: "invalid_vacancies" });
  });
});
