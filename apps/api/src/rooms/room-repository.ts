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
  status: StoredRoundStatus;
  outcome: RoundResult | null;
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

export type RoomRepository = {
  createRoom(room: NewRoom): Promise<StoredRoom>;
  listRooms(): Promise<StoredRoom[]>;
  findRoomByInviteToken(inviteToken: string): Promise<StoredRoom | null>;
  findRoomById(roomId: string): Promise<StoredRoom | null>;
  deleteRoom(roomId: string): Promise<boolean>;
  joinRoom(roomId: string, displayName: string, joinKeyHash: string): Promise<JoinedParticipant>;
  removePresentParticipants(roomId: string, limit: number): Promise<number>;
  countPresent(roomId: string): Promise<number>;
  listCandidates(roomId: string): Promise<StoredCandidate[]>;
  listCandidatesByRooms(roomIds: string[]): Promise<StoredCandidate[]>;
  openRound(roomId: string, eligibleCandidateIds?: readonly string[]): Promise<OpenRoundResult>;
  closeRound(
    roomId: string,
    roundId: string,
    outcome: RoundResult | null,
  ): Promise<StoredRound | null>;
  restartRound(roomId: string, roundId: string): Promise<StoredRound | null>;
  findRound(roomId: string, roundId: string): Promise<StoredRound | null>;
  latestRounds(roomIds: string[]): Promise<StoredRound[]>;
  latestClosedRound(roomId: string): Promise<StoredRound | null>;
  listAuditEvents(roomId: string): Promise<StoredAuditEvent[]>;
  castBallot(input: {
    roomId: string;
    roundId: string;
    joinKeyHash: string;
    candidateId: string;
  }): Promise<CastBallotResult>;
  hasVotedInRound(roomId: string, roundId: string, joinKeyHash: string): Promise<boolean>;
  listRoundBallotCandidateIds(roundId: string): Promise<string[]>;
  listRoundReceiptTimestamps(roundId: string): Promise<Date[]>;
  importMembers(
    rows: readonly ValidMemberImportRow[],
  ): Promise<{ createdCount: number; updatedCount: number }>;
  listMembers(): Promise<StoredMember[]>;
};
