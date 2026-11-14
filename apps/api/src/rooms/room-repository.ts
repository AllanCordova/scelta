import type {
  BallotRejectionReason,
  CreateRoomStatus,
  MemberSocietyFlags,
  QuorumUnit,
  RoomStatus,
  RoomType,
  RoundResult,
  RulesPreset,
  ValidMemberImportRow,
} from "@scelta/domain";

export type StoredRoom = {
  id: string;
  title: string;
  roomType: RoomType;
  rulesPreset: RulesPreset;
  quorumValue: number;
  quorumUnit: QuorumUnit;
  eligibleCount: number;
  officeBanners?: Record<string, string>;
  inviteToken: string;
  status: RoomStatus;
  createdAt: Date;
};

export type NewRoom = {
  title: string;
  roomType: RoomType;
  rulesPreset: RulesPreset;
  quorumValue: number;
  quorumUnit: QuorumUnit;
  eligibleCount: number;
  status: CreateRoomStatus;
  candidates?: string[];
};

export type StoredCandidate = {
  id: string;
  roomId: string;
  displayName: string;
  photoUrl?: string | null;
  isEligible: boolean;
};

export type CastBallotResult =
  | { ok: true; roundId: string }
  | {
      ok: false;
      reason: BallotRejectionReason;
    };

export type StoredRoundStatus = "pending" | "open" | "closed" | "restarted";

export type StoredRound = {
  id: string;
  roomId: string;
  number: number;
  officeLabel: string | null;
  status: StoredRoundStatus;
  outcome: RoundResult | null;
  declinedCandidateId?: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
  restartCount?: number;
};

export type StoredAuditEvent = {
  id: string;
  roomId: string;
  actorRole: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type StoredMember = {
  id: string;
  fullName: string;
  isCommunicant: boolean;
  isMale: boolean | null;
  birthDate: string | null;
  photoUrl: string | null;
  societyFlags: MemberSocietyFlags;
  createdAt: Date;
};

export type OpenRoundResult =
  | { ok: true; round: StoredRound }
  | { ok: false; reason: "round_already_open" };

export type JoinedParticipant = {
  id: string;
  roomId: string;
  displayName: string;
  alreadyJoined: boolean;
};

export type StoredAccessCode = {
  id: string;
  roomId: string;
  memberId: string | null;
  displayName: string;
  code: string;
  isSimulated: boolean;
  revokedAt: Date | null;
  createdAt: Date;
};

export type JoinWithCodeResult =
  | { ok: true; participant: JoinedParticipant }
  | { ok: false; reason: "invalid_access_code" | "revoked_access_code" };

export type UpdateRoomInput = {
  title?: string;
  quorumValue?: number;
  quorumUnit?: "absolute" | "percent";
  eligibleCount?: number;
  status?: RoomStatus;
};

export type RoomRepository = {
  createRoom(room: NewRoom): Promise<StoredRoom>;
  updateRoom(roomId: string, input: UpdateRoomInput): Promise<StoredRoom | null>;
  setOfficeBanner(roomId: string, officeKey: string, bannerUrl: string | null): Promise<StoredRoom | null>;
  listRooms(): Promise<StoredRoom[]>;
  findRoomByInviteToken(inviteToken: string): Promise<StoredRoom | null>;
  findRoomById(roomId: string): Promise<StoredRoom | null>;
  deleteRoom(roomId: string): Promise<boolean>;
  joinRoomWithCode(roomId: string, code: string, joinKeyHash: string): Promise<JoinWithCodeResult>;
  generateMemberAccessCodes(roomId: string): Promise<StoredAccessCode[]>;
  createSimulatedAccessCodes(roomId: string, count: number): Promise<StoredAccessCode[]>;
  listAccessCodes(roomId: string): Promise<StoredAccessCode[]>;
  revokeAccessCode(roomId: string, codeId: string): Promise<StoredAccessCode | null>;
  revokeAllAccessCodes(roomId: string): Promise<number>;
  removePresentParticipants(roomId: string, limit: number): Promise<number>;
  countPresent(roomId: string): Promise<number>;
  listCandidates(roomId: string): Promise<StoredCandidate[]>;
  listAllCandidates(roomId: string): Promise<StoredCandidate[]>;
  listCandidatesByRooms(roomIds: string[]): Promise<StoredCandidate[]>;
  openRound(
    roomId: string,
    eligibleCandidateIds?: readonly string[],
    officeLabel?: string | null,
  ): Promise<OpenRoundResult>;
  listRounds(roomId: string): Promise<StoredRound[]>;
  closeRound(
    roomId: string,
    roundId: string,
    outcome: RoundResult | null,
  ): Promise<StoredRound | null>;
  restartRound(roomId: string, roundId: string): Promise<StoredRound | null>;
  declineRound(
    roomId: string,
    roundId: string,
    declinedCandidateId: string,
  ): Promise<StoredRound | null>;
  findRound(roomId: string, roundId: string): Promise<StoredRound | null>;
  latestRounds(roomIds: string[]): Promise<StoredRound[]>;
  latestClosedRound(roomId: string): Promise<StoredRound | null>;
  listAuditEvents(roomId: string): Promise<StoredAuditEvent[]>;
  castBallot(input: {
    roomId: string;
    roundId: string;
    joinKeyHash: string;
    candidateId: string | null;
  }): Promise<CastBallotResult>;
  hasVotedInRound(roomId: string, roundId: string, joinKeyHash: string): Promise<boolean>;
  listRoundBallotCandidateIds(roundId: string): Promise<(string | null)[]>;
  listRoundReceiptTimestamps(roundId: string): Promise<Date[]>;
  importMembers(
    rows: readonly ValidMemberImportRow[],
  ): Promise<{ createdCount: number; updatedCount: number }>;
  createMember(input: {
    fullName: string;
    isCommunicant: boolean;
    isMale: boolean | null;
    birthDate: string | null;
    photoUrl?: string | null;
    societyFlags?: MemberSocietyFlags;
  }): Promise<StoredMember>;
  updateMember(
    memberId: string,
    input: {
      fullName: string;
      isCommunicant: boolean;
      isMale: boolean | null;
      birthDate: string | null;
      photoUrl?: string | null;
      societyFlags?: MemberSocietyFlags;
    },
  ): Promise<StoredMember | null>;
  deleteMember(memberId: string): Promise<boolean>;
  listMembers(): Promise<StoredMember[]>;
};
