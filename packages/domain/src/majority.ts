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

/** Absolute majority: strictly more than 50% of votes (> half). */
export function hasAbsoluteMajority(
  tallies: TallyEntry[],
  vacancies = 1,
): MajorityResult {
  const sorted = [...tallies].sort((a, b) => b.votes - a.votes);
  const totalVotes = sorted.reduce((sum, entry) => sum + entry.votes, 0);
  const threshold = Math.floor(totalVotes / 2) + 1;

  const winnerIds = sorted
    .filter((entry) => entry.votes >= threshold && entry.votes > 0)
    .slice(0, vacancies)
    .map((entry) => entry.candidateId);

  return { totalVotes, threshold, winnerIds, sorted };
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
