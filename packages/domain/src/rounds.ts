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

export type DeclineRoundRejectionReason =
  | "room_not_open"
  | "round_not_closed"
  | "winner_not_elected";

export function canDeclineRound(
  roomStatus: RoomStatus,
  roundStatus: string,
  roundOutcome: RoundResult | null,
): { ok: true } | { ok: false; reason: DeclineRoundRejectionReason } {
  if (!canOpenRound(roomStatus)) {
    return { ok: false, reason: "room_not_open" };
  }
  if (roundStatus !== "closed") {
    return { ok: false, reason: "round_not_closed" };
  }
  if (roundOutcome !== "elected") {
    return { ok: false, reason: "winner_not_elected" };
  }
  return { ok: true };
}

export type RoundOutcome =
  | { kind: "winners"; winnerIds: string[]; remainingVacancies: number }
  | {
      kind: "next_round";
      candidateIds: string[];
      reason: string;
      remainingVacancies: number;
      electedCandidateIds?: string[];
      isLastVacancyTieRunoff?: boolean;
    }
  | {
      kind: "inconclusive";
      reason: string;
      remainingVacancies: number;
      electedCandidateIds?: string[];
    };

export type NextRoundPlan = {
  roundNumber: number;
  tallies: readonly TallyEntry[];
  preset: RulesPreset;
  vacancies?: number;
  blankVotes?: number;
  totalBallots?: number;
  alreadyElectedCandidateIds?: readonly string[];
};

export type ResolveNextRoundInput = {
  preset: RulesPreset;
  previousRoundNumber: number | null;
  previousOutcome: RoundResult | null;
  eligibleCandidateIds: readonly string[];
  previousTallies: readonly TallyEntry[];
  requestedCandidateIds?: readonly string[];
  vacancies?: number;
  remainingVacancies?: number;
  lastVacancyTieCandidateIds?: readonly string[];
  alreadyElectedCandidateIds?: readonly string[];
  previousTotalBallots?: number;
  previousBlankVotes?: number;
};

export type NextRoundRejectionReason =
  | "winner_already_elected"
  | "invalid_candidate_subset"
  | "max_rounds_reached";

export type ResolveNextRoundResult =
  | { ok: true; candidateIds: string[] }
  | { ok: false; reason: NextRoundRejectionReason };

export type MultiVacancyRoundSnapshot = {
  status: string;
  outcome: RoundResult | null;
  winnerCandidateId?: string | null;
  winnerCandidateIds?: readonly string[];
};

export type MultiVacancyProgress = {
  totalVacancies: number;
  electedCandidateIds: string[];
  remainingVacancies: number;
  isComplete: boolean;
};

function normalizeVacancies(vacancies: number | undefined): number {
  return typeof vacancies === "number" && Number.isInteger(vacancies) && vacancies >= 1
    ? vacancies
    : 1;
}

/**
 * Computes cumulative multi-vacancy election progress across closed elected rounds.
 * Annulled, restarted, and declined rounds are excluded automatically.
 */
export function evaluateMultiVacancyProgress(
  totalVacancies: number,
  rounds: readonly MultiVacancyRoundSnapshot[],
): MultiVacancyProgress {
  const safeTotal = normalizeVacancies(totalVacancies);
  const electedSet = new Set<string>();

  for (const round of rounds) {
    if (round.status !== "closed" || round.outcome !== "elected") {
      continue;
    }
    const ids =
      round.winnerCandidateIds && round.winnerCandidateIds.length > 0
        ? round.winnerCandidateIds
        : round.winnerCandidateId
          ? [round.winnerCandidateId]
          : [];
    for (const id of ids) {
      electedSet.add(id);
    }
  }

  const electedCandidateIds = [...electedSet];
  const remainingVacancies = Math.max(0, safeTotal - electedCandidateIds.length);
  return {
    totalVacancies: safeTotal,
    electedCandidateIds,
    remainingVacancies,
    isComplete: remainingVacancies === 0,
  };
}

/**
 * Decide winners or next-round candidate subset from IPB-oriented presets,
 * supporting both single-vacancy and N-vacancy officer elections.
 * Round numbers are 1-based.
 */
export function nextRoundPlan(input: NextRoundPlan): RoundOutcome {
  const vacancies = normalizeVacancies(input.vacancies);
  const alreadyElectedSet = new Set(input.alreadyElectedCandidateIds ?? []);
  const majority = hasAbsoluteMajority(
    input.tallies,
    vacancies,
    input.blankVotes ?? 0,
    input.totalBallots,
  );

  const newlyElectedIds = majority.winnerIds;
  const remainingVacancies = majority.remainingVacancies;

  if (remainingVacancies === 0 && majority.lastVacancyTieCandidateIds.length === 0) {
    return {
      kind: "winners",
      winnerIds: newlyElectedIds,
      remainingVacancies: 0,
    };
  }

  if (majority.lastVacancyTieCandidateIds.length > 0) {
    return {
      kind: "next_round",
      candidateIds: majority.lastVacancyTieCandidateIds,
      ...(newlyElectedIds.length > 0 ? { electedCandidateIds: newlyElectedIds } : {}),
      remainingVacancies,
      isLastVacancyTieRunoff: true,
      reason: "Tie on the last vacancy; runoff among tied candidates",
    };
  }

  const excludedIds = new Set([...alreadyElectedSet, ...newlyElectedIds]);
  const unelectedTallies = input.tallies.filter((entry) => !excludedIds.has(entry.candidateId));
  const unelectedCandidateIds = unelectedTallies.map((entry) => entry.candidateId);

  if (unelectedCandidateIds.length === 0) {
    return {
      kind: "inconclusive",
      ...(newlyElectedIds.length > 0 ? { electedCandidateIds: newlyElectedIds } : {}),
      remainingVacancies,
      reason: "No unelected candidates remain for the open vacancies",
    };
  }

  if (newlyElectedIds.length > 0) {
    return {
      kind: "next_round",
      candidateIds: unelectedCandidateIds,
      electedCandidateIds: newlyElectedIds,
      remainingVacancies,
      reason: "Partial election; open another ballot for remaining vacancies with unelected candidates",
    };
  }

  if (input.preset === "ipb_society_board") {
    if (input.roundNumber >= 3) {
      return {
        kind: "inconclusive",
        remainingVacancies,
        reason: "Maximum of 3 ballots reached; tie-break by age required",
      };
    }

    if (input.roundNumber >= 2) {
      return {
        kind: "next_round",
        candidateIds: selectTopCandidates(unelectedTallies, 2),
        remainingVacancies,
        reason: "No absolute majority after two ballots; runoff of top 2",
      };
    }

    return {
      kind: "next_round",
      candidateIds: unelectedCandidateIds,
      remainingVacancies,
      reason: "No absolute majority; open another ballot",
    };
  }

  if (input.preset === "ipb_local_officers") {
    if (vacancies === 1 && input.roundNumber >= 3) {
      return {
        kind: "inconclusive",
        remainingVacancies,
        reason: "Maximum of 3 ballots reached; tie-break by age required",
      };
    }

    if (input.roundNumber >= 2) {
      const limit = Math.max(remainingVacancies * 2, remainingVacancies + 1);
      return {
        kind: "next_round",
        candidateIds: selectTopCandidates(unelectedTallies, limit),
        remainingVacancies,
        reason:
          "No majority after second ballot; limit further ballots to most voted",
      };
    }

    return {
      kind: "next_round",
      candidateIds: unelectedCandidateIds,
      remainingVacancies,
      reason: "No majority; open another ballot",
    };
  }

  return {
    kind: "inconclusive",
    remainingVacancies,
    reason: "Custom preset requires explicit runoff configuration",
  };
}

/**
 * Resolve which candidates remain eligible when opening the next round.
 */
export function resolveNextRoundCandidateIds(
  input: ResolveNextRoundInput,
): ResolveNextRoundResult {
  const remainingVacancies =
    input.remainingVacancies !== undefined
      ? input.remainingVacancies
      : input.previousOutcome === "elected"
        ? 0
        : normalizeVacancies(input.vacancies);

  if (remainingVacancies <= 0) {
    return { ok: false, reason: "winner_already_elected" };
  }

  const alreadyElectedSet = new Set(input.alreadyElectedCandidateIds ?? []);
  const availableCandidateIds = input.eligibleCandidateIds.filter(
    (id) => !alreadyElectedSet.has(id),
  );
  const availableSet = new Set(availableCandidateIds);

  const isMultiVacancyFlow =
    (input.vacancies !== undefined && input.vacancies > 1) ||
    (input.alreadyElectedCandidateIds !== undefined && input.alreadyElectedCandidateIds.length > 0) ||
    (input.lastVacancyTieCandidateIds !== undefined && input.lastVacancyTieCandidateIds.length > 0);

  if (
    !isMultiVacancyFlow &&
    input.previousRoundNumber !== null &&
    input.previousRoundNumber >= 3 &&
    input.previousOutcome === "no_majority"
  ) {
    return { ok: false, reason: "max_rounds_reached" };
  }

  if (input.lastVacancyTieCandidateIds && input.lastVacancyTieCandidateIds.length > 0) {
    const tiedEligible = input.lastVacancyTieCandidateIds.filter((id) => availableSet.has(id));
    if (tiedEligible.length === 0) {
      return { ok: false, reason: "invalid_candidate_subset" };
    }

    if (input.requestedCandidateIds !== undefined) {
      const seen = new Set<string>();
      for (const candidateId of input.requestedCandidateIds) {
        if (!availableSet.has(candidateId) || seen.has(candidateId)) {
          return { ok: false, reason: "invalid_candidate_subset" };
        }
        seen.add(candidateId);
      }
      if (
        tiedEligible.length !== input.requestedCandidateIds.length ||
        !tiedEligible.every((id) => seen.has(id))
      ) {
        return { ok: false, reason: "invalid_candidate_subset" };
      }
      return { ok: true, candidateIds: [...input.requestedCandidateIds] };
    }

    return { ok: true, candidateIds: tiedEligible };
  }

  if (input.requestedCandidateIds !== undefined) {
    if (input.requestedCandidateIds.length === 0) {
      return { ok: false, reason: "invalid_candidate_subset" };
    }

    const seen = new Set<string>();
    for (const candidateId of input.requestedCandidateIds) {
      if (!availableSet.has(candidateId) || seen.has(candidateId)) {
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
    input.previousOutcome === "elected" ||
    input.previousOutcome !== "no_majority"
  ) {
    return { ok: true, candidateIds: [...availableCandidateIds] };
  }

  const plan = nextRoundPlan({
    roundNumber: input.previousRoundNumber,
    tallies: [...input.previousTallies],
    preset: input.preset,
    vacancies: remainingVacancies,
    ...(input.previousTotalBallots === undefined
      ? {}
      : { totalBallots: input.previousTotalBallots }),
    ...(input.previousBlankVotes === undefined ? {} : { blankVotes: input.previousBlankVotes }),
    ...(input.alreadyElectedCandidateIds === undefined
      ? {}
      : { alreadyElectedCandidateIds: input.alreadyElectedCandidateIds }),
  });

  if (plan.kind === "winners") {
    return { ok: false, reason: "winner_already_elected" };
  }

  if (plan.kind === "next_round") {
    return {
      ok: true,
      candidateIds: plan.candidateIds.filter((id) => availableSet.has(id)),
    };
  }

  return { ok: true, candidateIds: [...availableCandidateIds] };
}
