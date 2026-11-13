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
  | "already_voted"
  | "invalid_candidate";

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
  if (input.roomStatus !== "open" && input.roomStatus !== "voting") {
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
