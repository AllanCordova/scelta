import type { PaperTallyInput } from "./paper-votes.js";

export type TallyEntry = {
  candidateId: string;
  votes: number;
};

export type BallotChoiceInput = string | null | readonly string[];

export type MajorityResult = {
  totalVotes: number;
  threshold: number;
  winnerIds: string[];
  sorted: TallyEntry[];
  remainingVacancies: number;
  lastVacancyTieCandidateIds: string[];
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
  vacancies?: number;
  winnerOverrideId?: string | null;
  winnerOverrideIds?: readonly string[];
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
  vacancies: number;
  winnerIds: string[];
  winnerNames: string[];
  remainingVacancies: number;
  partialElection?: boolean;
  lastVacancyTieCandidateIds?: string[];
  standings: CandidateStanding[];
  didNotVoteCount?: number;
  tieBreakReason?: TieBreakReason;
  tieBreakRequired?: boolean;
  tiedCandidates?: TiedCandidateOption[];
  voteOrigin?: VoteOriginBreakdown;
};

function normalizeVacancies(vacancies: number | undefined): number {
  return typeof vacancies === "number" && Number.isInteger(vacancies) && vacancies >= 1
    ? vacancies
    : 1;
}

/**
 * Absolute majority: strictly more than 50% of ballots (> half).
 *
 * For multi-vacancy elections (vacancies > 1), pass `totalBallots` as the majority base
 * (online ballots + paper valid/blank ballots, excluding paper null ballots).
 * When more than `vacancies` candidates reach majority:
 * - If the Nth candidate strictly beats the (N+1)th, the top N are elected.
 * - If there is a tie at the Nth cutoff, candidates strictly above the cutoff are elected
 *   and all candidates tied at the cutoff are returned in `lastVacancyTieCandidateIds` for a runoff.
 */
export function hasAbsoluteMajority(
  tallies: readonly TallyEntry[],
  vacancies = 1,
  nullVotes = 0,
  totalBallots?: number,
): MajorityResult {
  const safeVacancies = normalizeVacancies(vacancies);
  const sorted = [...tallies].sort((a, b) => b.votes - a.votes);
  const totalVotes =
    totalBallots !== undefined
      ? Math.max(0, totalBallots)
      : sorted.reduce((sum, entry) => sum + entry.votes, 0) + nullVotes;
  const threshold = Math.floor(totalVotes / 2) + 1;

  const qualified = sorted.filter((entry) => entry.votes >= threshold && entry.votes > 0);

  let winnerIds: string[];
  let lastVacancyTieCandidateIds: string[] = [];

  if (qualified.length <= safeVacancies) {
    winnerIds = qualified.map((entry) => entry.candidateId);
  } else {
    const cutoffVotes = qualified[safeVacancies - 1]!.votes;
    const nextVotes = qualified[safeVacancies]!.votes;

    if (cutoffVotes > nextVotes) {
      winnerIds = qualified.slice(0, safeVacancies).map((entry) => entry.candidateId);
    } else {
      winnerIds = qualified
        .filter((entry) => entry.votes > cutoffVotes)
        .map((entry) => entry.candidateId);
      lastVacancyTieCandidateIds = qualified
        .filter((entry) => entry.votes === cutoffVotes)
        .map((entry) => entry.candidateId);
    }
  }

  const remainingVacancies = Math.max(0, safeVacancies - winnerIds.length);
  return {
    totalVotes,
    threshold,
    winnerIds,
    sorted,
    remainingVacancies,
    lastVacancyTieCandidateIds,
  };
}

function normalizeBallotMarks(choice: BallotChoiceInput): readonly string[] {
  if (choice === null) {
    return [];
  }
  if (typeof choice === "string") {
    return [choice];
  }
  return choice;
}

function countOnlineBallots(
  candidates: readonly CandidateOption[],
  ballots: readonly BallotChoiceInput[],
): {
  onlineCounts: Map<string, number>;
  onlineBlankVotes: number;
  onlineCandidateVotes: number;
} {
  const onlineCounts = new Map<string, number>();
  for (const candidate of candidates) {
    onlineCounts.set(candidate.id, 0);
  }

  let onlineBlankVotes = 0;
  let onlineCandidateVotes = 0;

  for (const ballot of ballots) {
    const marks = normalizeBallotMarks(ballot);
    if (marks.length === 0) {
      onlineBlankVotes += 1;
      continue;
    }

    const seenInBallot = new Set<string>();
    for (const candidateId of marks) {
      const current = onlineCounts.get(candidateId);
      if (current === undefined) {
        throw new Error("Ballot references an unknown candidate");
      }
      if (seenInBallot.has(candidateId)) {
        throw new Error("Ballot marks the same candidate more than once");
      }
      seenInBallot.add(candidateId);
      onlineCounts.set(candidateId, current + 1);
      onlineCandidateVotes += 1;
    }
  }

  return { onlineCounts, onlineBlankVotes, onlineCandidateVotes };
}

function countPaperBallots(
  candidates: readonly CandidateOption[],
  byId: ReadonlyMap<string, CandidateOption>,
  paperTally: PaperTallyInput | undefined,
): {
  paperCounts: Map<string, number>;
  paperCandidateMarks: number;
} {
  const paperCounts = new Map<string, number>();
  let paperCandidateMarks = 0;

  if (!paperTally) {
    return { paperCounts, paperCandidateMarks };
  }

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

  return { paperCounts, paperCandidateMarks };
}

function resolveOverrideWinnerIds(
  options: TallyRoundOptions | undefined,
  byId: ReadonlyMap<string, CandidateOption>,
): string[] {
  if (options?.winnerOverrideIds && options.winnerOverrideIds.length > 0) {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const candidateId of options.winnerOverrideIds) {
      if (byId.has(candidateId) && !seen.has(candidateId)) {
        seen.add(candidateId);
        unique.push(candidateId);
      }
    }
    return unique;
  }

  if (options?.winnerOverrideId && byId.has(options.winnerOverrideId)) {
    return [options.winnerOverrideId];
  }

  return [];
}

function formatWinnerSummary(
  winnerIds: readonly string[],
  nameById: ReadonlyMap<string, string>,
): { winnerId: string | null; winnerName: string | null; winnerNames: string[] } {
  const winnerNames = winnerIds.map((id) => nameById.get(id) ?? "");
  return {
    winnerId: winnerIds[0] ?? null,
    winnerName: winnerIds.length > 0 ? winnerNames.join(", ") : null,
    winnerNames,
  };
}

export function tallyRoundVotes(
  candidates: readonly CandidateOption[],
  ballotCandidateIds: readonly BallotChoiceInput[],
  options?: TallyRoundOptions,
): RoundTally {
  const vacancies = normalizeVacancies(options?.vacancies);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const nameById = new Map(candidates.map((candidate) => [candidate.id, candidate.displayName]));

  const { onlineCounts, onlineBlankVotes, onlineCandidateVotes } = countOnlineBallots(
    candidates,
    ballotCandidateIds,
  );
  const paperTally = options?.paperTally;
  const { paperCounts, paperCandidateMarks } = countPaperBallots(candidates, byId, paperTally);

  const tallies: TallyEntry[] = candidates.map((candidate) => ({
    candidateId: candidate.id,
    votes: (onlineCounts.get(candidate.id) ?? 0) + (paperCounts.get(candidate.id) ?? 0),
  }));

  // Majority base = online ballots (marked + blank) + paper ballots excluding invalid null ballots.
  const majorityBlankVotes = onlineBlankVotes + (paperTally?.blankVotes ?? 0);
  const nullVotes = majorityBlankVotes + (paperTally?.nullVotes ?? 0);
  const paperMajorityBallots = paperTally
    ? Math.max(0, paperTally.ballotCount - paperTally.nullVotes)
    : 0;
  const totalBallots = ballotCandidateIds.length + paperMajorityBallots;

  const majority = hasAbsoluteMajority(tallies, vacancies, majorityBlankVotes, totalBallots);

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

  const overrideWinnerIds = resolveOverrideWinnerIds(options, byId);
  if (overrideWinnerIds.length > 0) {
    const summary = formatWinnerSummary(overrideWinnerIds, nameById);
    const remainingVacancies = Math.max(0, vacancies - overrideWinnerIds.length);
    return {
      totalVotes: majority.totalVotes,
      nullVotes,
      threshold: majority.threshold,
      outcome: "elected",
      winnerId: summary.winnerId,
      winnerName: summary.winnerName,
      vacancies,
      winnerIds: overrideWinnerIds,
      winnerNames: summary.winnerNames,
      remainingVacancies,
      ...(remainingVacancies > 0 ? { partialElection: true } : {}),
      standings,
      ...extraFields,
      ...(options?.tieBreakReason ? { tieBreakReason: options.tieBreakReason } : {}),
    };
  }

  if (majority.winnerIds.length > 0) {
    const summary = formatWinnerSummary(majority.winnerIds, nameById);
    const partialElection = majority.remainingVacancies > 0;
    return {
      totalVotes: majority.totalVotes,
      nullVotes,
      threshold: majority.threshold,
      outcome: "elected",
      winnerId: summary.winnerId,
      winnerName: summary.winnerName,
      vacancies,
      winnerIds: majority.winnerIds,
      winnerNames: summary.winnerNames,
      remainingVacancies: majority.remainingVacancies,
      ...(partialElection ? { partialElection: true } : {}),
      ...(majority.lastVacancyTieCandidateIds.length > 0
        ? { lastVacancyTieCandidateIds: majority.lastVacancyTieCandidateIds }
        : {}),
      standings,
      ...extraFields,
    };
  }

  if (majority.lastVacancyTieCandidateIds.length > 0) {
    return {
      totalVotes: majority.totalVotes,
      nullVotes,
      threshold: majority.threshold,
      outcome: "no_majority",
      winnerId: null,
      winnerName: null,
      vacancies,
      winnerIds: [],
      winnerNames: [],
      remainingVacancies: majority.remainingVacancies,
      lastVacancyTieCandidateIds: majority.lastVacancyTieCandidateIds,
      standings,
      ...extraFields,
    };
  }

  const roundNumber = options?.roundNumber ?? 1;
  if (vacancies === 1 && roundNumber >= 3 && candidates.length > 0) {
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
        vacancies: 1,
        winnerIds: [singleWinner.id],
        winnerNames: [singleWinner.displayName],
        remainingVacancies: 0,
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
            vacancies: 1,
            winnerIds: [oldest.id],
            winnerNames: [oldest.displayName],
            remainingVacancies: 0,
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
        vacancies: 1,
        winnerIds: [],
        winnerNames: [],
        remainingVacancies: 1,
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
    vacancies,
    winnerIds: [],
    winnerNames: [],
    remainingVacancies: vacancies,
    standings,
    ...extraFields,
  };
}

export function selectTopCandidates(
  tallies: readonly TallyEntry[],
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
