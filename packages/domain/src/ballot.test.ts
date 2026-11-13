import { describe, expect, it } from "vitest";
import { canCastBallot, validateCandidateNames } from "./ballot.js";

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
    expect(canCastBallot({ ...validInput, roomStatus: "voting" })).toEqual({ ok: true });
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
