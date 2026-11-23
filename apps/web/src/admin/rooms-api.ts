import { readQuorumPresence, type QuorumPresence } from "./presence-event";
import type {
  CandidateOption,
  CreatableRoomStatus,
  FieldError,
  IntegrityLogsResponse,
  MemberAccessCodeItem,
  MemberImportReport,
  PaginatedMembersResult,
  PresetDefinition,
  QuorumUnit,
  RoomDetail,
  RoomEntryMode,
  RoomEntryRequestsResponse,
  RoomRosterEntryItem,
  RoomRound,
  RoomSummary,
  RoomType,
  RoundPaperTally,
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
  entryMode?: RoomEntryMode;
  entryOpen?: boolean;
  maxParticipants?: number | null;
  vacancies?: number;
  showLiveCandidateTally?: boolean;
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

export async function closeRound(
  apiBase: string,
  roomId: string,
  roundId: string,
  options?: { confirmPending?: boolean; confirmNoPaperBallots?: boolean },
): Promise<RoomRound> {
  const payload: Record<string, unknown> = {};
  if (options?.confirmPending) {
    payload.confirmPending = true;
  }
  if (options?.confirmNoPaperBallots) {
    payload.confirmNoPaperBallots = true;
  }
  return postRound(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(roundId)}/close`,
    Object.keys(payload).length > 0 ? payload : undefined,
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

export async function resolveRoundTie(
  apiBase: string,
  roomId: string,
  roundId: string,
  winnerCandidateId: string,
): Promise<RoomRound> {
  return postRound(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(roundId)}/resolve-tie`,
    { winnerCandidateId },
  );
}

export async function revealRoundResult(
  apiBase: string,
  roomId: string,
  roundId: string,
): Promise<RoomRound> {
  return postRound(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(roundId)}/reveal`,
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
  status?: "draft" | "open" | "test" | "closed";
  reactionsEnabled?: boolean;
  chatMuted?: boolean;
  entryMode?: RoomEntryMode;
  entryOpen?: boolean;
  maxParticipants?: number | null;
  vacancies?: number;
  showLiveCandidateTally?: boolean;
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

export type PresentParticipant = {
  id: string;
  displayName: string;
  joinedAt: string;
};

export async function listPresentParticipants(
  apiBase: string,
  roomId: string,
): Promise<PresentParticipant[]> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/participants`,
    { credentials: "include" },
  );
  const body = (await response.json().catch(() => ({}))) as {
    participants?: PresentParticipant[];
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.participants)) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return body.participants;
}

export type ReleaseSessionResult = {
  released: boolean;
  participant: {
    id: string;
    displayName: string;
    isPresent: boolean;
  };
};

export async function releaseParticipantSession(
  apiBase: string,
  roomId: string,
  participantId: string,
): Promise<ReleaseSessionResult> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(participantId)}/release-session`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  const body = (await response.json().catch(() => ({}))) as Partial<ReleaseSessionResult> & {
    error?: string;
  };
  if (!response.ok || typeof body.released !== "boolean" || !body.participant) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return { released: body.released, participant: body.participant };
}

export async function expelParticipants(
  apiBase: string,
  roomId: string,
  target: { all: true } | { participantId: string },
): Promise<{ expelledCount: number }> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/participants/expel`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(target),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    expelledCount?: number;
    error?: string;
  };
  if (!response.ok || typeof body.expelledCount !== "number") {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return { expelledCount: body.expelledCount };
}

export async function issueMemberAccessCode(
  apiBase: string,
  roomId: string,
  memberId: string,
  replace = false,
): Promise<{ accessCode: MemberAccessCodeItem; created: boolean }> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/access-codes/issue`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId, replace }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    accessCode?: MemberAccessCodeItem;
    created?: boolean;
    error?: string;
  };
  if (!response.ok || !body.accessCode || typeof body.created !== "boolean") {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return { accessCode: body.accessCode, created: body.created };
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

export async function deleteAccessCode(
  apiBase: string,
  roomId: string,
  codeId: string,
): Promise<void> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/access-codes/${encodeURIComponent(codeId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
}

export async function fetchIntegrityLogs(
  apiBase: string,
  roomId?: string,
): Promise<IntegrityLogsResponse> {
  const qs = roomId ? `?roomId=${encodeURIComponent(roomId)}` : "";
  const response = await fetch(`${apiBase}/v1/admin/logs${qs}`, {
    credentials: "include",
  });
  const body = (await response.json().catch(() => ({}))) as Partial<IntegrityLogsResponse> & {
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.logs) || !body.summary) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return {
    logs: body.logs,
    rooms: Array.isArray(body.rooms) ? body.rooms : [],
    summary: body.summary,
  };
}

export async function fetchRoomRoster(
  apiBase: string,
  roomId: string,
): Promise<{ entries: RoomRosterEntryItem[]; eligibleCount: number }> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/roster`,
    { credentials: "include" },
  );
  const body = (await response.json().catch(() => ({}))) as {
    entries?: RoomRosterEntryItem[];
    eligibleCount?: number;
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.entries)) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return {
    entries: body.entries,
    eligibleCount: typeof body.eligibleCount === "number" ? body.eligibleCount : body.entries.length,
  };
}

export async function addRoomRosterMember(
  apiBase: string,
  roomId: string,
  input:
    | { memberId: string }
    | { fullName: string; birthDate?: string | null; isCommunicant?: boolean; isMale?: boolean | null },
): Promise<{
  entry: RoomRosterEntryItem;
  accessCode: MemberAccessCodeItem | null;
  eligibleCount: number;
}> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/roster`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    entry?: RoomRosterEntryItem;
    accessCode?: MemberAccessCodeItem | null;
    eligibleCount?: number;
    error?: string;
  };
  if (!response.ok || !body.entry) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return {
    entry: body.entry,
    accessCode: body.accessCode ?? null,
    eligibleCount: typeof body.eligibleCount === "number" ? body.eligibleCount : 0,
  };
}

export async function removeRoomRosterEntry(
  apiBase: string,
  roomId: string,
  entryId: string,
): Promise<{ removed: boolean; eligibleCount: number }> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/roster/${encodeURIComponent(entryId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    removed?: boolean;
    eligibleCount?: number;
    error?: string;
  };
  if (!response.ok) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return {
    removed: Boolean(body.removed ?? true),
    eligibleCount: typeof body.eligibleCount === "number" ? body.eligibleCount : 0,
  };
}

export async function setRosterPaperMode(
  apiBase: string,
  roomId: string,
  entryId: string,
  votesOnPaper: boolean,
): Promise<{
  entry: RoomRosterEntryItem;
  accessCode: MemberAccessCodeItem | null;
  presence: {
    presentCount: number;
    onlinePresentCount?: number;
    paperVotersCount?: number;
    eligibleCount: number;
    requiredCount: number;
    quorumMet: boolean;
  };
}> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/roster/${encodeURIComponent(entryId)}/paper-mode`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ votesOnPaper }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    entry?: RoomRosterEntryItem;
    accessCode?: MemberAccessCodeItem | null;
    presence?: {
      presentCount: number;
      onlinePresentCount?: number;
      paperVotersCount?: number;
      eligibleCount: number;
      requiredCount: number;
      quorumMet: boolean;
    };
    error?: string;
  };
  if (!response.ok || !body.entry || !body.presence) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return {
    entry: body.entry,
    accessCode: body.accessCode ?? null,
    presence: body.presence,
  };
}

export async function savePaperTally(
  apiBase: string,
  roomId: string,
  roundId: string,
  payload: {
    ballotCount: number;
    blankVotes: number;
    nullVotes: number;
    candidateVotes: Record<string, number>;
  },
): Promise<RoundPaperTally> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(roundId)}/paper-tally`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    paperTally?: RoundPaperTally;
    error?: string;
  };
  if (!response.ok || !body.paperTally) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return body.paperTally;
}

export async function addRoomCandidate(
  apiBase: string,
  roomId: string,
  input: {
    memberId?: string;
    rosterEntryId?: string;
    displayName?: string;
    birthDate?: string | null;
    officeLabel?: string;
  },
): Promise<{ candidate: CandidateOption; candidates: CandidateOption[] }> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/candidates`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    candidate?: CandidateOption;
    candidates?: CandidateOption[];
    error?: string;
  };
  if (!response.ok || !body.candidate || !Array.isArray(body.candidates)) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return {
    candidate: body.candidate,
    candidates: body.candidates,
  };
}

export async function removeRoomCandidate(
  apiBase: string,
  roomId: string,
  candidateId: string,
  officeLabel?: string,
): Promise<{ removed: boolean; candidates: CandidateOption[] }> {
  const qs = officeLabel ? `?officeLabel=${encodeURIComponent(officeLabel)}` : "";
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/candidates/${encodeURIComponent(candidateId)}${qs}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    removed?: boolean;
    candidates?: CandidateOption[];
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.candidates)) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return {
    removed: Boolean(body.removed ?? true),
    candidates: body.candidates,
  };
}

export async function fetchRoomEntryRequests(
  apiBase: string,
  roomId: string,
): Promise<RoomEntryRequestsResponse> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/entry-requests`,
    { credentials: "include" },
  );
  const body = (await response.json().catch(() => ({}))) as Partial<RoomEntryRequestsResponse> & {
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.requests)) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return {
    requests: body.requests,
    claimedParticipants: Array.isArray(body.claimedParticipants) ? body.claimedParticipants : [],
    disputes: Array.isArray(body.disputes) ? body.disputes : [],
  };
}

export async function approveRoomEntryRequest(
  apiBase: string,
  roomId: string,
  requestId: string,
): Promise<void> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/entry-requests/${encodeURIComponent(requestId)}/approve`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
}

export async function approveAllRoomEntryRequests(
  apiBase: string,
  roomId: string,
): Promise<{ approvedCount: number }> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/entry-requests/approve-all`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    approvedCount?: number;
    error?: string;
  };
  if (!response.ok) {
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
  return {
    approvedCount: typeof body.approvedCount === "number" ? body.approvedCount : 0,
  };
}

export async function rejectRoomEntryRequest(
  apiBase: string,
  roomId: string,
  requestId: string,
): Promise<void> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/entry-requests/${encodeURIComponent(requestId)}/reject`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
}

export async function releaseRoomRosterName(
  apiBase: string,
  roomId: string,
  target: { rosterEntryId?: string; participantId?: string },
): Promise<void> {
  const response = await fetch(
    `${apiBase}/v1/admin/rooms/${encodeURIComponent(roomId)}/entry-requests/release-name`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(target),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new RoomRequestError(response.status, body.error ?? "unknown");
  }
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
