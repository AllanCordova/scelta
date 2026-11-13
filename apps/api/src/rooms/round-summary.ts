import type { RoundTally } from "@scelta/domain";
import type { StoredRound } from "./room-repository.js";

export function toRoundSummary(
  round: StoredRound | null,
  tally?: RoundTally | null,
  officeRoundNumber?: number,
) {
  if (!round) {
    return null;
  }

  return {
    id: round.id,
    number: round.number,
    ...(round.officeLabel !== null
      ? {
          officeLabel: round.officeLabel,
          ...(officeRoundNumber !== undefined ? { officeRoundNumber } : {}),
        }
      : {}),
    status: round.status,
    outcome: round.outcome,
    ...(round.restartCount ? { restartCount: round.restartCount } : {}),
    ...(tally ? { tally } : {}),
  };
}
