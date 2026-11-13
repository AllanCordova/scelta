import { evaluateQuorum, type QuorumStatus } from "@scelta/domain";
import type { StoredRoom } from "./room-repository.js";

export function quorumStatus(room: StoredRoom, presentCount: number): QuorumStatus {
  return evaluateQuorum({
    presentCount,
    eligibleCount: room.eligibleCount,
    quorumValue: room.quorumValue,
    quorumUnit: room.quorumUnit,
  });
}
