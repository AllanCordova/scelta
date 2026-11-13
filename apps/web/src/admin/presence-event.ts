export type PresenceEvent = {
  roomId: string;
  presentCount: number;
};

export function readPresenceEvent(payload: unknown): PresenceEvent | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as { roomId?: unknown; presentCount?: unknown };
  if (typeof record.roomId !== "string" || record.roomId.length === 0 || record.roomId.length > 64) {
    return null;
  }
  if (!isPresentCount(record.presentCount)) {
    return null;
  }

  return { roomId: record.roomId, presentCount: record.presentCount };
}

function isPresentCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
