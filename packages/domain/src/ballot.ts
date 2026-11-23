import type { RoomStatus } from "./room.js";

const CANDIDATE_NAME_MAX_LENGTH = 120;
const MAX_CANDIDATES_PER_ROOM = 50;

export type CandidateValidationError =
  | "empty_name"
  | "name_too_long"
  | "duplicate_name"
  | "too_many_candidates";

export type BallotCastCheckInput = {
  roomStatus: RoomStatus;
  roundStatus: "pending" | "open" | "closed" | "restarted";
  isParticipantPresent: boolean;
  hasAlreadyVoted: boolean;
  isCandidateEligible: boolean;
};

export type BallotRejectionReason =
  | "room_not_open"
  | "round_not_open"
  | "participant_not_present"
  | "access_code_revoked"
  | "already_voted"
  | "invalid_candidate"
  | "too_many_marks"
  | "duplicate_candidate_mark";

export type BallotMarksRejectionReason =
  | "invalid_vacancies"
  | "too_many_marks"
  | "duplicate_candidate_mark"
  | "invalid_candidate";

export type BallotMarksValidationInput = {
  candidateIds: readonly string[];
  vacancies: number;
  eligibleCandidateIds: readonly string[];
};

export type ValidateBallotMarksResult =
  | { ok: true; candidateIds: string[] }
  | { ok: false; reason: BallotMarksRejectionReason };

export function validateCandidateNames(
  rawNames: readonly string[],
): { ok: true; value: string[] } | { ok: false; error: CandidateValidationError } {
  if (rawNames.length > MAX_CANDIDATES_PER_ROOM) {
    return { ok: false, error: "too_many_candidates" };
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawNames) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: "empty_name" };
    }
    if (trimmed.length > CANDIDATE_NAME_MAX_LENGTH) {
      return { ok: false, error: "name_too_long" };
    }

    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: "duplicate_name" };
    }
    seen.add(key);
    normalized.push(trimmed);
  }

  return { ok: true, value: normalized };
}

export function canCastBallot(
  input: BallotCastCheckInput,
): { ok: true } | { ok: false; reason: BallotRejectionReason } {
  if (input.roomStatus !== "open" && input.roomStatus !== "test") {
    return { ok: false, reason: "room_not_open" };
  }

  if (input.roundStatus !== "open") {
    return { ok: false, reason: "round_not_open" };
  }

  if (!input.isParticipantPresent) {
    return { ok: false, reason: "participant_not_present" };
  }

  if (input.hasAlreadyVoted) {
    return { ok: false, reason: "already_voted" };
  }

  if (!input.isCandidateEligible) {
    return { ok: false, reason: "invalid_candidate" };
  }

  return { ok: true };
}

/**
 * Validates the set of marked candidates on a ballot for an N-vacancy scrutiny.
 * An empty list represents a blank ballot. Duplicate marks and marks above N are rejected.
 */
export function validateBallotMarks(
  input: BallotMarksValidationInput,
): ValidateBallotMarksResult {
  if (!Number.isInteger(input.vacancies) || input.vacancies < 1) {
    return { ok: false, reason: "invalid_vacancies" };
  }

  if (input.candidateIds.length > input.vacancies) {
    return { ok: false, reason: "too_many_marks" };
  }

  const eligibleSet = new Set(input.eligibleCandidateIds);
  const seen = new Set<string>();

  for (const candidateId of input.candidateIds) {
    if (seen.has(candidateId)) {
      return { ok: false, reason: "duplicate_candidate_mark" };
    }
    if (!eligibleSet.has(candidateId)) {
      return { ok: false, reason: "invalid_candidate" };
    }
    seen.add(candidateId);
  }

  return { ok: true, candidateIds: [...input.candidateIds] };
}
