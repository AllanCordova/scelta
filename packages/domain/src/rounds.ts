import {
  hasAbsoluteMajority,
  selectTopCandidates,
  type TallyEntry,
} from "./majority.js";

export type RulesPreset =
  | "ipb_local_officers"
  | "ipb_society_board"
  | "custom";

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
