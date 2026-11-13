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
};

export type CandidateStanding = {
  candidateId: string;
  displayName: string;
  votes: number;
};

export type RoundTally = {
  totalVotes: number;
  nullVotes: number;
  threshold: number;
  outcome: "elected" | "no_majority";
  winnerId: string | null;
  winnerName: string | null;
  standings: CandidateStanding[];
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
): RoundTally {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.id, 0);
  }

  let nullVotes = 0;
  for (const candidateId of ballotCandidateIds) {
    if (candidateId === null) {
      nullVotes += 1;
      continue;
    }
    const current = counts.get(candidateId);
    if (current === undefined) {
      throw new Error("Ballot references an unknown candidate");
    }
    counts.set(candidateId, current + 1);
  }

  const tallies: TallyEntry[] = candidates.map((candidate) => ({
    candidateId: candidate.id,
    votes: counts.get(candidate.id) ?? 0,
  }));

  const majority = hasAbsoluteMajority(tallies, 1, nullVotes);
  const nameById = new Map(candidates.map((candidate) => [candidate.id, candidate.displayName]));
  const standings: CandidateStanding[] = majority.sorted.map((entry) => ({
    candidateId: entry.candidateId,
    displayName: nameById.get(entry.candidateId) ?? "",
    votes: entry.votes,
  }));

  const winnerId = majority.winnerIds[0] ?? null;
  const winnerName = winnerId ? (nameById.get(winnerId) ?? null) : null;

  return {
    totalVotes: majority.totalVotes,
    nullVotes,
    threshold: majority.threshold,
    outcome: winnerId ? "elected" : "no_majority",
    winnerId,
    winnerName,
    standings,
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
