import type { CandidateStanding, RoundTally } from "@scelta/domain";
import type { StoredPaperTally, StoredRound } from "./room-repository.js";

export type LiveRoundTally = {
  totalBallots: number;
  onlineBallots: number;
  paperBallots: number;
  blankVotes: number;
  nullVotes: number;
  standings?: CandidateStanding[];
};

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
  liveTally?: LiveRoundTally | null,
) {
  if (!round) {
    return null;
  }

  const winnerCandidateIds =
    round.winnerCandidateIds && round.winnerCandidateIds.length > 0
      ? round.winnerCandidateIds
      : round.winnerCandidateId
        ? [round.winnerCandidateId]
        : [];

  return {
    id: round.id,
    number: round.number,
    vacancies: round.vacancies ?? 1,
    ...(round.officeLabel !== null
      ? {
          officeLabel: round.officeLabel,
          ...(officeRoundNumber !== undefined ? { officeRoundNumber } : {}),
        }
      : {}),
    status: round.status,
    outcome: round.outcome,
    resultRevealed: round.resultRevealed ?? false,
    ...(winnerCandidateIds.length > 0 ? { winnerCandidateIds } : {}),
    ...(round.restartCount ? { restartCount: round.restartCount } : {}),
    ...(tally ? { tally } : {}),
    ...(liveTally ? { liveTally } : {}),
    ...(paperTally ? { paperTally: toPaperTallySummary(paperTally) } : {}),
  };
}
