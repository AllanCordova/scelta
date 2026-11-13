import { readQuorumPresence, type QuorumPresence } from "./presence-event";
import type {
  CreatableRoomStatus,
  FieldError,
  PresetDefinition,
  QuorumUnit,
  RoomRound,
  RoomSummary,
  RoomType,
  RulesPreset,
} from "./types";

export class RoomRequestError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly details: FieldError[];

  constructor(status: number, errorCode: string, details: FieldError[] = []) {
    super(errorCode);
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export type CreateRoomPayload = {
  title: string;
  roomType: RoomType;
  rulesPreset: RulesPreset;
  status: CreatableRoomStatus;
  quorumValue?: number;
  quorumUnit?: QuorumUnit;
  eligibleCount?: number;
};

export async function fetchPresets(apiUrl: string): Promise<PresetDefinition[]> {
  const response = await fetch(`${apiUrl}/v1/rules/presets`);
  if (!response.ok) {
    throw new RoomRequestError(response.status, "presets_unavailable");
  }

  const body = (await response.json()) as { presets: PresetDefinition[] };
  return body.presets;
}

export async function listRooms(apiUrl: string): Promise<RoomSummary[]> {
  const response = await fetch(`${apiUrl}/v1/admin/rooms`, {
    credentials: "include",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }

  const body = (await response.json()) as { rooms: RoomSummary[] };
  return body.rooms;
}

export async function createRoom(apiUrl: string, payload: CreateRoomPayload): Promise<RoomSummary> {
  const response = await fetch(`${apiUrl}/v1/admin/rooms`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as {
    room?: RoomSummary;
    error?: string;
    details?: FieldError[];
  };

  if (!response.ok || !body.room) {
    throw new RoomRequestError(response.status, body.error ?? "unknown", body.details ?? []);
  }

  return body.room;
}

export async function fetchPresence(apiBase: string, roomId: string): Promise<QuorumPresence> {
  const response = await fetch(`${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/presence`, {
    credentials: "include",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }

  const presence = readQuorumPresence(await response.json());
  if (!presence) {
    throw new RoomRequestError(response.status, "invalid_presence");
  }

  return presence;
}

export async function openRound(apiBase: string, roomId: string): Promise<RoomRound> {
  return postRound(`${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/rounds`);
}

export async function closeRound(apiBase: string, roomId: string, roundId: string): Promise<RoomRound> {
  return postRound(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(roundId)}/close`,
  );
}

async function postRound(url: string): Promise<RoomRound> {
  const response = await fetch(url, { method: "POST", credentials: "include" });
  const body = (await response.json().catch(() => ({}))) as { round?: RoomRound; error?: string };
  if (!response.ok || !body.round) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return body.round;
}
