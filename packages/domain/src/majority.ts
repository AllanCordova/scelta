import type { PaperTallyInput } from "./paper-votes.js";

export type TallyEntry = {
  candidateId: string;
  votes: number;
};

export type MajorityResult = {
  totalVotes: number;
  threshold: number;
  winnerIds: string[];
  sorted: TallyEntry[];
};

export type CandidateOption = {
  id: string;
  displayName: string;
  photoUrl?: string | null;
  birthDate?: string | null;
  isEligible?: boolean;
};

export type CandidateStanding = {
  candidateId: string;
  displayName: string;
  votes: number;
  onlineVotes?: number;
  paperVotes?: number;
};

export type VoteOriginBreakdown = {
  online: {
    ballots: number;
    candidateVotes: number;
    blankVotes: number;
  };
  paper: {
    ballots: number;
    candidateVotes: number;
    blankVotes: number;
    nullVotes: number;
  };
};

export type TieBreakReason = "age" | "admin_tiebreak";

export type TiedCandidateOption = {
  id: string;
  displayName: string;
  birthDate: string | null;
};

export type TallyRoundOptions = {
  roundNumber?: number;
  winnerOverrideId?: string | null;
  tieBreakReason?: TieBreakReason | null;
  didNotVoteCount?: number;
  paperTally?: PaperTallyInput;
};

export type RoundTally = {
  totalVotes: number;
  nullVotes: number;
  threshold: number;
  outcome: "elected" | "no_majority";
  winnerId: string | null;
  winnerName: string | null;
  standings: CandidateStanding[];
  didNotVoteCount?: number;
  tieBreakReason?: TieBreakReason;
  tieBreakRequired?: boolean;
  tiedCandidates?: TiedCandidateOption[];
  voteOrigin?: VoteOriginBreakdown;
};

/** Absolute majority: strictly more than 50% of votes (> half). */
export function hasAbsoluteMajority(
  tallies: TallyEntry[],
  vacancies = 1,
  nullVotes = 0,
): MajorityResult {
  const sorted = [...tallies].sort((a, b) => b.votes - a.votes);
  const totalVotes = sorted.reduce((sum, entry) => sum + entry.votes, 0) + nullVotes;
  const threshold = Math.floor(totalVotes / 2) + 1;

  const winnerIds = sorted
    .filter((entry) => entry.votes >= threshold && entry.votes > 0)
    .slice(0, vacancies)
    .map((entry) => entry.candidateId);

  return { totalVotes, threshold, winnerIds, sorted };
}

export function tallyRoundVotes(
  candidates: readonly CandidateOption[],
  ballotCandidateIds: readonly (string | null)[],
  options?: TallyRoundOptions,
): RoundTally {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const onlineCounts = new Map<string, number>();
  for (const candidate of candidates) {
    onlineCounts.set(candidate.id, 0);
  }

  let onlineBlankVotes = 0;
  let onlineCandidateVotes = 0;
  for (const candidateId of ballotCandidateIds) {
    if (candidateId === null) {
      onlineBlankVotes += 1;
      continue;
    }
    const current = onlineCounts.get(candidateId);
    if (current === undefined) {
      throw new Error("Ballot references an unknown candidate");
    }
    onlineCounts.set(candidateId, current + 1);
    onlineCandidateVotes += 1;
  }

  const paperTally = options?.paperTally;
  const paperCounts = new Map<string, number>();
  let paperCandidateMarks = 0;
  if (paperTally) {
    for (const candidate of candidates) {
      paperCounts.set(candidate.id, 0);
    }
    for (const [candidateId, votes] of Object.entries(paperTally.candidateVotes)) {
      if (votes === 0) {
        continue;
      }
      if (!byId.has(candidateId)) {
        throw new Error("Paper tally references an unknown candidate");
      }
      paperCounts.set(candidateId, (paperCounts.get(candidateId) ?? 0) + votes);
      paperCandidateMarks += votes;
    }
  }

  const tallies: TallyEntry[] = candidates.map((candidate) => ({
    candidateId: candidate.id,
    votes: (onlineCounts.get(candidate.id) ?? 0) + (paperCounts.get(candidate.id) ?? 0),
  }));

  // Paper null votes are invalid votes and stay outside the majority denominator,
  // while blank votes (online and paper) count toward totalVotes.
  const majorityBlankVotes = onlineBlankVotes + (paperTally?.blankVotes ?? 0);
  const nullVotes = majorityBlankVotes + (paperTally?.nullVotes ?? 0);
  const majority = hasAbsoluteMajority(tallies, 1, majorityBlankVotes);
  const nameById = new Map(candidates.map((candidate) => [candidate.id, candidate.displayName]));
  const standings: CandidateStanding[] = majority.sorted.map((entry) => {
    if (!paperTally) {
      return {
        candidateId: entry.candidateId,
        displayName: nameById.get(entry.candidateId) ?? "",
        votes: entry.votes,
      };
    }
    return {
      candidateId: entry.candidateId,
      displayName: nameById.get(entry.candidateId) ?? "",
      votes: entry.votes,
      onlineVotes: onlineCounts.get(entry.candidateId) ?? 0,
      paperVotes: paperCounts.get(entry.candidateId) ?? 0,
    };
  });

  const extraFields: Pick<RoundTally, "didNotVoteCount" | "voteOrigin"> = {
    ...(options?.didNotVoteCount !== undefined ? { didNotVoteCount: options.didNotVoteCount } : {}),
    ...(paperTally
      ? {
          voteOrigin: {
            online: {
              ballots: ballotCandidateIds.length,
              candidateVotes: onlineCandidateVotes,
              blankVotes: onlineBlankVotes,
            },
            paper: {
              ballots: paperTally.ballotCount,
              candidateVotes: paperCandidateMarks,
              blankVotes: paperTally.blankVotes,
              nullVotes: paperTally.nullVotes,
            },
          },
        }
      : {}),
  };

  if (options?.winnerOverrideId) {
    const overrideWinner = byId.get(options.winnerOverrideId);
    if (overrideWinner) {
      return {
        totalVotes: majority.totalVotes,
        nullVotes,
        threshold: majority.threshold,
        outcome: "elected",
        winnerId: overrideWinner.id,
        winnerName: overrideWinner.displayName,
        standings,
        ...extraFields,
        ...(options.tieBreakReason ? { tieBreakReason: options.tieBreakReason } : {}),
      };
    }
  }

  const winnerId = majority.winnerIds[0] ?? null;
  const winnerName = winnerId ? (nameById.get(winnerId) ?? null) : null;

  if (winnerId !== null) {
    return {
      totalVotes: majority.totalVotes,
      nullVotes,
      threshold: majority.threshold,
      outcome: "elected",
      winnerId,
      winnerName,
      standings,
      ...extraFields,
    };
  }

  const roundNumber = options?.roundNumber ?? 1;
  if (roundNumber >= 3 && candidates.length > 0) {
    const topVotes = majority.sorted[0]?.votes ?? 0;
    let tiedCandidates: CandidateOption[];

    if (topVotes > 0) {
      tiedCandidates = majority.sorted
        .filter((entry) => entry.votes === topVotes)
        .map((entry) => byId.get(entry.candidateId))
        .filter((candidate): candidate is CandidateOption => Boolean(candidate));
    } else {
      const eligibleOnly = candidates.filter((candidate) => candidate.isEligible !== false);
      tiedCandidates = eligibleOnly.length > 0 ? [...eligibleOnly] : [...candidates];
    }

    if (tiedCandidates.length === 1) {
      const singleWinner = tiedCandidates[0]!;
      return {
        totalVotes: majority.totalVotes,
        nullVotes,
        threshold: majority.threshold,
        outcome: "elected",
        winnerId: singleWinner.id,
        winnerName: singleWinner.displayName,
        standings,
        ...extraFields,
      };
    }

    if (tiedCandidates.length >= 2) {
      const allHaveBirthDate = tiedCandidates.every(
        (candidate) =>
          typeof candidate.birthDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(candidate.birthDate),
      );

      if (allHaveBirthDate) {
        const sortedByAge = [...tiedCandidates].sort((a, b) =>
          a.birthDate!.localeCompare(b.birthDate!),
        );
        if (sortedByAge[0]!.birthDate! < sortedByAge[1]!.birthDate!) {
          const oldest = sortedByAge[0]!;
          return {
            totalVotes: majority.totalVotes,
            nullVotes,
            threshold: majority.threshold,
            outcome: "elected",
            winnerId: oldest.id,
            winnerName: oldest.displayName,
            standings,
            ...extraFields,
            tieBreakReason: "age",
          };
        }
      }

      return {
        totalVotes: majority.totalVotes,
        nullVotes,
        threshold: majority.threshold,
        outcome: "no_majority",
        winnerId: null,
        winnerName: null,
        standings,
        ...extraFields,
        tieBreakRequired: true,
        tiedCandidates: tiedCandidates.map((candidate) => ({
          id: candidate.id,
          displayName: candidate.displayName,
          birthDate: candidate.birthDate ?? null,
        })),
      };
    }
  }

  return {
    totalVotes: majority.totalVotes,
    nullVotes,
    threshold: majority.threshold,
    outcome: "no_majority",
    winnerId: null,
    winnerName: null,
    standings,
    ...extraFields,
  };
}

export function selectTopCandidates(
  tallies: TallyEntry[],
  limit: number,
): string[] {
  if (limit <= 0) {
    return [];
  }

  return [...tallies]
    .sort((a, b) => b.votes - a.votes)
    .slice(0, limit)
    .map((entry) => entry.candidateId);
}
