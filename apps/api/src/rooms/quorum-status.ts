import { evaluateQuorum, type QuorumStatus } from "@scelta/domain";
import type { RoomRepository, StoredRoom } from "./room-repository.js";

export type ExtendedQuorumStatus = QuorumStatus & {
  onlinePresentCount?: number;
  paperVotersCount?: number;
};

export function quorumStatus(
  room: StoredRoom,
  onlinePresentCount: number,
  paperVotersCount = 0,
): ExtendedQuorumStatus {
  const base = evaluateQuorum({
    presentCount: onlinePresentCount + paperVotersCount,
    eligibleCount: room.eligibleCount,
    quorumValue: room.quorumValue,
    quorumUnit: room.quorumUnit,
  });

  if (paperVotersCount > 0) {
    return {
      ...base,
      onlinePresentCount,
      paperVotersCount,
    };
  }

  return base;
}

export async function loadRoomPresence(
  repository: Pick<RoomRepository, "countPresent" | "countPaperVoters">,
  room: StoredRoom,
): Promise<ExtendedQuorumStatus> {
  const [onlinePresentCount, paperVotersCount] = await Promise.all([
    repository.countPresent(room.id),
    repository.countPaperVoters ? repository.countPaperVoters(room.id) : Promise.resolve(0),
  ]);
  return quorumStatus(room, onlinePresentCount, paperVotersCount);
}
