import {
  hasAbsoluteMajority,
  selectTopCandidates,
  type TallyEntry,
} from "./majority.js";
import type { RoundResult } from "./quorum.js";
import { canOpenRound, type RoomStatus } from "./room.js";

export type RulesPreset =
  | "ipb_local_officers"
  | "ipb_society_board"
  | "custom";

export type RestartRoundRejectionReason =
  | "room_not_open"
  | "round_not_open"
  | "winner_already_elected";

export function canRestartRound(
  roomStatus: RoomStatus,
  roundStatus: string,
  roundOutcome: RoundResult | null,
): { ok: true } | { ok: false; reason: RestartRoundRejectionReason } {
  if (!canOpenRound(roomStatus)) {
    return { ok: false, reason: "room_not_open" };
  }
  if (roundOutcome === "elected") {
    return { ok: false, reason: "winner_already_elected" };
  }
  if (roundStatus !== "open") {
    return { ok: false, reason: "round_not_open" };
  }
  return { ok: true };
}

export type RoundOutcome =
  | { kind: "winners"; winnerIds: string[] }
  | { kind: "next_round"; candidateIds: string[]; reason: string }
  | { kind: "inconclusive"; reason: string };

export type NextRoundPlan = {
  roundNumber: number;
  tallies: TallyEntry[];
  preset: RulesPreset;
  vacancies?: number;
};

export type ResolveNextRoundInput = {
  preset: RulesPreset;
  previousRoundNumber: number | null;
  previousOutcome: RoundResult | null;
  eligibleCandidateIds: readonly string[];
  previousTallies: readonly TallyEntry[];
  requestedCandidateIds?: readonly string[];
  vacancies?: number;
};

export type NextRoundRejectionReason =
  | "winner_already_elected"
  | "invalid_candidate_subset";

export type ResolveNextRoundResult =
  | { ok: true; candidateIds: string[] }
  | { ok: false; reason: NextRoundRejectionReason };

/**
 * Decide winners or next-round candidate subset from IPB-oriented presets.
 * Round numbers are 1-based.
 */
export function nextRoundPlan(input: NextRoundPlan): RoundOutcome {
  const vacancies = input.vacancies ?? 1;
  const majority = hasAbsoluteMajority(input.tallies, vacancies);

  if (majority.winnerIds.length >= vacancies) {
    return { kind: "winners", winnerIds: majority.winnerIds.slice(0, vacancies) };
  }

  if (input.preset === "ipb_society_board") {
    if (input.roundNumber >= 2) {
      return {
        kind: "next_round",
        candidateIds: selectTopCandidates(input.tallies, 2),
        reason: "No absolute majority after two ballots; runoff of top 2",
      };
    }

    return {
      kind: "next_round",
      candidateIds: input.tallies.map((entry) => entry.candidateId),
      reason: "No absolute majority; open another ballot",
    };
  }

  if (input.preset === "ipb_local_officers") {
    if (input.roundNumber >= 2) {
      const limit = Math.max(vacancies * 2, vacancies + 1);
      return {
        kind: "next_round",
        candidateIds: selectTopCandidates(input.tallies, limit),
        reason:
          "No majority after second ballot; limit further ballots to most voted",
      };
    }

    return {
      kind: "next_round",
      candidateIds: input.tallies.map((entry) => entry.candidateId),
      reason: "No majority; open another ballot",
    };
  }

  return {
    kind: "inconclusive",
    reason: "Custom preset requires explicit runoff configuration",
  };
}

/**
 * Resolve which candidates remain eligible when opening the next round.
 */
export function resolveNextRoundCandidateIds(
  input: ResolveNextRoundInput,
): ResolveNextRoundResult {
  if (input.previousOutcome === "elected") {
    return { ok: false, reason: "winner_already_elected" };
  }

  const eligibleSet = new Set(input.eligibleCandidateIds);

  if (input.requestedCandidateIds !== undefined) {
    if (input.requestedCandidateIds.length === 0) {
      return { ok: false, reason: "invalid_candidate_subset" };
    }

    const seen = new Set<string>();
    for (const candidateId of input.requestedCandidateIds) {
      if (!eligibleSet.has(candidateId) || seen.has(candidateId)) {
        return { ok: false, reason: "invalid_candidate_subset" };
      }
      seen.add(candidateId);
    }

    if (
      input.preset === "ipb_society_board" &&
      input.previousOutcome === "no_majority" &&
      input.previousRoundNumber !== null &&
      input.previousRoundNumber >= 2
    ) {
      const expectedTopTwo = selectTopCandidates([...input.previousTallies], 2);
      if (
        expectedTopTwo.length !== input.requestedCandidateIds.length ||
        !expectedTopTwo.every((id) => seen.has(id))
      ) {
        return { ok: false, reason: "invalid_candidate_subset" };
      }
    }

    return { ok: true, candidateIds: [...input.requestedCandidateIds] };
  }

  if (
    input.eligibleCandidateIds.length === 0 ||
    input.previousRoundNumber === null ||
    input.previousOutcome !== "no_majority"
  ) {
    return { ok: true, candidateIds: [...input.eligibleCandidateIds] };
  }

  const plan = nextRoundPlan({
    roundNumber: input.previousRoundNumber,
    tallies: [...input.previousTallies],
    preset: input.preset,
    ...(input.vacancies === undefined ? {} : { vacancies: input.vacancies }),
  });

  if (plan.kind === "winners") {
    return { ok: false, reason: "winner_already_elected" };
  }

  if (plan.kind === "next_round") {
    return { ok: true, candidateIds: plan.candidateIds };
  }

  return { ok: true, candidateIds: [...input.eligibleCandidateIds] };
}
