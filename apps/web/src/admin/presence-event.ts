export type QuorumPresence = {
  presentCount: number;
  eligibleCount: number;
  requiredCount: number;
  quorumMet: boolean;
};

export type PresenceEvent = QuorumPresence & {
  roomId: string;
};

export function readQuorumPresence(payload: unknown): QuorumPresence | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as {
    presentCount?: unknown;
    eligibleCount?: unknown;
    requiredCount?: unknown;
    quorumMet?: unknown;
  };
  if (
    !isCount(record.presentCount) ||
    !isCount(record.eligibleCount) ||
    !isCount(record.requiredCount) ||
    typeof record.quorumMet !== "boolean"
  ) {
    return null;
  }

  return {
    presentCount: record.presentCount,
    eligibleCount: record.eligibleCount,
    requiredCount: record.requiredCount,
    quorumMet: record.quorumMet,
  };
}

export function readPresenceEvent(payload: unknown): PresenceEvent | null {
  const presence = readQuorumPresence(payload);
  if (!presence || !payload || typeof payload !== "object") {
    return null;
  }

  const roomId = (payload as { roomId?: unknown }).roomId;
  if (typeof roomId !== "string" || roomId.length === 0 || roomId.length > 64) {
    return null;
  }

  return { roomId, ...presence };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
