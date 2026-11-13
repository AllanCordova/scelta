import type { RoundTally } from "@scelta/domain";
import type { StoredRound } from "./room-repository.js";

export function toRoundSummary(round: StoredRound | null, tally?: RoundTally | null) {
  if (!round) {
    return null;
  }

  return {
    id: round.id,
    number: round.number,
    status: round.status,
    outcome: round.outcome,
    ...(round.restartCount ? { restartCount: round.restartCount } : {}),
    ...(tally ? { tally } : {}),
  };
}
