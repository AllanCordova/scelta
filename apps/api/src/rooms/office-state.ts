import {
  buildOfficeProgress,
  isMultiOfficeRoomType,
  resolveTargetOffice,
  tallyRoundVotes,
  type OfficeProgressItem,
  type OfficeRoundSnapshot,
} from "@scelta/domain";
import type { RoomRepository, StoredCandidate, StoredRoom, StoredRound } from "./room-repository.js";

export type RoomOfficeState = {
  offices: OfficeProgressItem[];
  recommendedOffice: string | null;
};

export async function loadRoomOfficeState(
  repository: RoomRepository,
  room: StoredRoom,
  allCandidates: readonly StoredCandidate[],
  allRounds: readonly StoredRound[],
): Promise<RoomOfficeState> {
  if (!isMultiOfficeRoomType(room.roomType)) {
    return { offices: [], recommendedOffice: null };
  }

  const snapshots: OfficeRoundSnapshot[] = await Promise.all(
    allRounds.map(async (round) => {
      let winnerCandidateId: string | null = null;
      let winnerName: string | null = null;

      if (round.status === "closed" && round.outcome === "elected" && allCandidates.length > 0) {
        const ballotCandidateIds = await repository.listRoundBallotCandidateIds(round.id);
        const tally = tallyRoundVotes(allCandidates, ballotCandidateIds);
        winnerCandidateId = tally.winnerId;
        winnerName = tally.winnerName;
      }

      return {
        id: round.id,
        number: round.number,
        officeLabel: round.officeLabel,
        status: round.status,
        outcome: round.outcome,
        winnerCandidateId,
        winnerName,
      };
    }),
  );

  const offices = buildOfficeProgress(room.roomType, snapshots);
  const next = resolveTargetOffice(room.roomType, snapshots);

  return {
    offices,
    recommendedOffice: next.ok ? next.officeLabel : null,
  };
}
