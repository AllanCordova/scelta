import { readQuorumPresence, type QuorumPresence } from "./presence-event";
import type {
  CreatableRoomStatus,
  FieldError,
  MemberAccessCodeItem,
  MemberImportReport,
  PaginatedMembersResult,
  PresetDefinition,
  QuorumUnit,
  RoomDetail,
  RoomRound,
  RoomSummary,
  RoomType,
  RulesPreset,
  StoredMemberItem,
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
  candidates?: string[];
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

export async function fetchRoomDetail(apiBase: string, roomId: string): Promise<RoomDetail> {
  const response = await fetch(`${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}`, {
    credentials: "include",
  });
  const body = (await response.json().catch(() => ({}))) as {
    room?: RoomDetail;
    error?: string;
  };
  if (!response.ok || !body.room) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return body.room;
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

export async function openRound(
  apiBase: string,
  roomId: string,
  officeLabel?: string,
): Promise<RoomRound> {
  return postRound(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/rounds`,
    officeLabel ? { officeLabel } : undefined,
  );
}

export async function closeRound(apiBase: string, roomId: string, roundId: string): Promise<RoomRound> {
  return postRound(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(roundId)}/close`,
  );
}

export async function restartRound(
  apiBase: string,
  roomId: string,
  roundId: string,
): Promise<RoomRound> {
  return postRound(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(roundId)}/restart`,
  );
}

export async function declineRound(
  apiBase: string,
  roomId: string,
  roundId: string,
): Promise<RoomRound> {
  return postRound(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(roundId)}/decline`,
  );
}

export async function importMembers(
  apiBase: string,
  csv: string,
): Promise<MemberImportReport> {
  const response = await fetch(`${apiBase}/v1/admin/members/import`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ csv }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    report?: MemberImportReport;
    error?: string;
  };
  if (!response.ok || !body.report) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }

  return body.report;
}

export async function listMembers(apiBase: string): Promise<StoredMemberItem[]> {
  const response = await fetch(`${apiBase}/v1/admin/members`, {
    credentials: "include",
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json().catch(() => ({}))) as {
    members?: StoredMemberItem[];
  };
  return Array.isArray(body.members) ? body.members : [];
}

export async function listMembersPage(
  apiBase: string,
  params: { search?: string; page?: number; pageSize?: number } = {},
): Promise<PaginatedMembersResult> {
  const searchParams = new URLSearchParams();
  if (params.search && params.search.trim().length > 0) {
    searchParams.set("search", params.search.trim());
  }
  if (params.page !== undefined) {
    searchParams.set("page", String(params.page));
  }
  if (params.pageSize !== undefined) {
    searchParams.set("pageSize", String(params.pageSize));
  }
  const qs = searchParams.toString();
  const response = await fetch(`${apiBase}/v1/admin/members${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  if (!response.ok) {
    return { members: [], total: 0, page: 1, pageSize: params.pageSize ?? 10, totalPages: 1 };
  }
  const body = (await response.json().catch(() => ({}))) as Partial<PaginatedMembersResult>;
  const members = Array.isArray(body.members) ? body.members : [];
  return {
    members,
    total: typeof body.total === "number" ? body.total : members.length,
    page: typeof body.page === "number" ? body.page : 1,
    pageSize: typeof body.pageSize === "number" ? body.pageSize : params.pageSize ?? 10,
    totalPages: typeof body.totalPages === "number" ? body.totalPages : 1,
  };
}

export async function createMember(
  apiBase: string,
  input: {
    fullName: string;
    isCommunicant: boolean;
    isMale: boolean | null;
    birthDate: string | null;
    photoUrl?: string | null;
    societyFlags?: {
      upaActive?: boolean;
      umpActive?: boolean;
    };
  },
): Promise<StoredMemberItem> {
  const response = await fetch(`${apiBase}/v1/admin/members`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => ({}))) as {
    member?: StoredMemberItem;
    error?: string;
  };
  if (!response.ok || !body.member) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return body.member;
}

export async function updateMember(
  apiBase: string,
  memberId: string,
  input: {
    fullName: string;
    isCommunicant: boolean;
    isMale: boolean | null;
    birthDate: string | null;
    photoUrl?: string | null;
    societyFlags?: {
      upaActive?: boolean;
      umpActive?: boolean;
    };
  },
): Promise<StoredMemberItem> {
  const response = await fetch(
    `${apiBase}/v1/admin/members/${encodeURIComponent(memberId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    member?: StoredMemberItem;
    error?: string;
  };
  if (!response.ok || !body.member) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return body.member;
}

export async function deleteMember(apiBase: string, memberId: string): Promise<void> {
  const response = await fetch(
    `${apiBase}/v1/admin/members/${encodeURIComponent(memberId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
}

export type UpdateRoomPayload = {
  title?: string;
  quorumValue?: number;
  quorumUnit?: QuorumUnit;
  eligibleCount?: number;
  status?: "draft" | "open" | "closed";
  reactionsEnabled?: boolean;
};

export async function updateRoom(
  apiBase: string,
  roomId: string,
  payload: UpdateRoomPayload,
): Promise<RoomSummary> {
  const response = await fetch(`${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => ({}))) as {
    room?: RoomSummary;
    error?: string;
    details?: FieldError[];
  };

  if (!response.ok || !body.room) {
    throw new RoomRequestError(response.status, body.error ?? "unknown", body.details ?? []);
  }

  return body.room;
}

export async function setRoomOfficeBanner(
  apiBase: string,
  roomId: string,
  payload: {
    officeLabel?: string | null;
    bannerUrl: string | null;
  },
): Promise<RoomSummary> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/office-banner`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const body = (await response.json().catch(() => ({}))) as {
    room?: RoomSummary;
    error?: string;
  };

  if (!response.ok || !body.room) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }

  return body.room;
}

export async function rotateRoomInvite(apiBase: string, roomId: string): Promise<RoomSummary> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/invite/rotate`,
    {
      method: "POST",
      credentials: "include",
    },
  );

  const body = (await response.json().catch(() => ({}))) as {
    room?: RoomSummary;
    error?: string;
    details?: FieldError[];
  };

  if (!response.ok || !body.room) {
    throw new RoomRequestError(response.status, body.error ?? "unknown", body.details ?? []);
  }

  return body.room;
}

export async function deleteRoom(apiBase: string, roomId: string): Promise<void> {
  const response = await fetch(`${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
}

export async function removeParticipants(
  apiBase: string,
  roomId: string,
  count: number,
): Promise<{ removedCount: number }> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/participants/remove`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    removedCount?: number;
    error?: string;
  };
  if (!response.ok || typeof body.removedCount !== "number") {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return { removedCount: body.removedCount };
}

export async function listAccessCodes(
  apiBase: string,
  roomId: string,
): Promise<MemberAccessCodeItem[]> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/access-codes`,
    { credentials: "include" },
  );
  const body = (await response.json().catch(() => ({}))) as {
    accessCodes?: MemberAccessCodeItem[];
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.accessCodes)) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return body.accessCodes;
}

export async function generateAccessCodes(
  apiBase: string,
  roomId: string,
): Promise<MemberAccessCodeItem[]> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/access-codes/generate`,
    { method: "POST", credentials: "include" },
  );
  const body = (await response.json().catch(() => ({}))) as {
    accessCodes?: MemberAccessCodeItem[];
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.accessCodes)) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return body.accessCodes;
}

export async function createSimulatedAccessCodes(
  apiBase: string,
  roomId: string,
  count: number,
): Promise<MemberAccessCodeItem[]> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/access-codes/simulate`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    accessCodes?: MemberAccessCodeItem[];
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.accessCodes)) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return body.accessCodes;
}

export async function revokeAccessCode(
  apiBase: string,
  roomId: string,
  codeId: string,
): Promise<MemberAccessCodeItem> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/access-codes/${encodeURIComponent(codeId)}/revoke`,
    { method: "POST", credentials: "include" },
  );
  const body = (await response.json().catch(() => ({}))) as {
    accessCode?: MemberAccessCodeItem;
    error?: string;
  };
  if (!response.ok || !body.accessCode) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return body.accessCode;
}

export async function revokeAllAccessCodes(
  apiBase: string,
  roomId: string,
): Promise<{ revokedCount: number }> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/access-codes/revoke-all`,
    { method: "POST", credentials: "include" },
  );
  const body = (await response.json().catch(() => ({}))) as {
    revokedCount?: number;
    error?: string;
  };
  if (!response.ok || typeof body.revokedCount !== "number") {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return { revokedCount: body.revokedCount };
}

async function postRound(url: string, payload?: Record<string, unknown>): Promise<RoomRound> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    ...(payload
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      : {}),
  });
  const body = (await response.json().catch(() => ({}))) as { round?: RoomRound; error?: string };
  if (!response.ok || !body.round) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return body.round;
}
