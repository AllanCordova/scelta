import type { RoundTally } from "@scelta/domain";
import type { StoredPaperTally, StoredRound } from "./room-repository.js";

export type PaperTallySummary = {
  id: string;
  roundId: string;
  ballotCount: number;
  blankVotes: number;
  nullVotes: number;
  candidateVotes: Record<string, number>;
  recordedByAdminId: string | null;
  recordedByName: string | null;
  recordedAt: string;
  updatedAt: string;
};

export function toPaperTallySummary(paperTally: StoredPaperTally): PaperTallySummary {
  return {
    id: paperTally.id,
    roundId: paperTally.roundId,
    ballotCount: paperTally.ballotCount,
    blankVotes: paperTally.blankVotes,
    nullVotes: paperTally.nullVotes,
    candidateVotes: paperTally.candidateVotes,
    recordedByAdminId: paperTally.recordedByAdminId,
    recordedByName: paperTally.recordedByName,
    recordedAt: paperTally.recordedAt.toISOString(),
    updatedAt: paperTally.updatedAt.toISOString(),
  };
}

export function toRoundSummary(
  round: StoredRound | null,
  tally?: RoundTally | null,
  officeRoundNumber?: number,
  paperTally?: StoredPaperTally | null,
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
    ...(paperTally ? { paperTally: toPaperTallySummary(paperTally) } : {}),
  };
}
