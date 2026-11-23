import type {
  BallotRejectionReason,
  CreateRoomStatus,
  EntryRequestStatus,
  MemberSocietyFlags,
  PaperTallyInput,
  QuorumStatus,
  QuorumUnit,
  RoomEntryMode,
  RoomStatus,
  RoomType,
  RoundResult,
  RoundTally,
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
  shortCode: string;
  status: RoomStatus;
  vacancies: number;
  entryMode: RoomEntryMode;
  entryOpen: boolean;
  maxParticipants: number | null;
  showLiveCandidateTally: boolean;
  reactionsEnabled: boolean;
  chatMuted?: boolean;
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
  vacancies?: number;
  entryMode?: RoomEntryMode;
  entryOpen?: boolean;
  maxParticipants?: number | null;
  showLiveCandidateTally?: boolean;
  candidates?: string[];
};

export type StoredCandidate = {
  id: string;
  roomId: string;
  memberId?: string | null;
  displayName: string;
  photoUrl?: string | null;
  birthDate?: string | null;
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
  vacancies: number;
  status: StoredRoundStatus;
  outcome: RoundResult | null;
  declinedCandidateId?: string | null;
  winnerCandidateId?: string | null;
  winnerCandidateIds?: string[];
  tieBreakReason?: "age" | "admin_tiebreak" | null;
  didNotVoteCount?: number;
  resultRevealed?: boolean;
  openedAt: Date | null;
  closedAt: Date | null;
  restartCount?: number;
};

export type StoredAuditEvent = {
  id: string;
  roomId: string;
  roomTitle?: string | null;
  roomStatus?: RoomStatus | null;
  actorRole: string;
  action: string;
  payload: Record<string, unknown>;
  prevHash?: string | null;
  integrityHash?: string;
  createdAt: Date;
};

export type AuditChainVerificationResult = {
  chainValid: boolean;
  totalEvents: number;
  chainTipHash: string;
  brokenAtEventId?: string | null;
};

export type AtomicCloseRoundResult =
  | {
      ok: true;
      round: StoredRound;
      tally: RoundTally | null;
      quorum: QuorumStatus;
      officeRoundNumber: number;
      didNotVoteCount: number;
    }
  | {
      ok: false;
      reason:
        | "room_not_found"
        | "round_not_found"
        | "round_not_open"
        | "voting_incomplete"
        | "paper_tally_required";
      votedCount?: number;
      presentCount?: number;
      paperVotersCount?: number;
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
  rosterEntryId?: string | null;
  memberId: string | null;
  displayName: string;
  code: string;
  isSimulated: boolean;
  revokedAt: Date | null;
  createdAt: Date;
};

export type StoredRosterEntry = {
  id: string;
  roomId: string;
  memberId: string | null;
  fullName: string;
  birthDate: string | null;
  isCommunicant: boolean;
  isMale: boolean | null;
  isEligibleVoter: boolean;
  votesOnPaper: boolean;
  createdAt: Date;
  accessCode: {
    id: string;
    code: string;
    revokedAt: Date | null;
  } | null;
  isPresent: boolean;
};

export type StoredPaperTally = {
  id: string;
  roundId: string;
  ballotCount: number;
  blankVotes: number;
  nullVotes: number;
  candidateVotes: Record<string, number>;
  recordedByAdminId: string | null;
  recordedByName: string | null;
  recordedAt: Date;
  updatedAt: Date;
};

export type SetRosterEntryPaperModeResult =
  | {
      ok: true;
      entry: StoredRosterEntry;
      accessCode: StoredAccessCode | null;
      onlinePresentCount: number;
      paperVotersCount: number;
    }
  | {
      ok: false;
      reason:
        | "room_not_found"
        | "room_closed"
        | "roster_entry_not_found"
        | "already_voted_online"
        | "paper_tally_already_recorded";
    };

export type UpsertRoundPaperTallyResult =
  | { ok: true; paperTally: StoredPaperTally }
  | {
      ok: false;
      reason: "room_not_found" | "round_not_found" | "round_not_open";
    }
  | {
      ok: false;
      reason: "validation_failed";
      code: string;
      message: string;
    };

export type AddRosterEntryInput =
  | { memberId: string }
  | {
      fullName: string;
      birthDate?: string | null;
      isCommunicant?: boolean;
      isMale?: boolean | null;
    };

export type AddRosterEntryResult =
  | {
      ok: true;
      entry: StoredRosterEntry;
      accessCode: StoredAccessCode;
      eligibleCount: number;
    }
  | {
      ok: false;
      reason: "room_not_found" | "room_closed" | "member_not_found" | "roster_member_exists";
    };

export type RemoveRosterEntryResult =
  | {
      ok: true;
      eligibleCount: number;
    }
  | {
      ok: false;
      reason: "room_not_found" | "room_closed" | "roster_entry_not_found";
    };

export type AddRoomCandidateInput = {
  memberId?: string;
  rosterEntryId?: string;
  displayName?: string;
  birthDate?: string | null;
  officeLabel?: string;
};

export type AddRoomCandidateResult =
  | {
      ok: true;
      candidate: StoredCandidate;
      candidates: StoredCandidate[];
    }
  | {
      ok: false;
      reason:
        | "room_not_found"
        | "candidates_locked_after_round"
        | "invalid_office"
        | "member_not_found"
        | "roster_entry_not_found"
        | "invalid_candidate"
        | "candidate_exists";
    };

export type RemoveRoomCandidateResult =
  | {
      ok: true;
      candidates: StoredCandidate[];
    }
  | {
      ok: false;
      reason:
        | "room_not_found"
        | "candidate_not_found"
        | "invalid_office"
        | "candidates_locked_after_round";
    };

export type JoinWithCodeResult =
  | { ok: true; participant: JoinedParticipant }
  | {
      ok: false;
      reason:
        | "invalid_access_code"
        | "revoked_access_code"
        | "simulation_requires_test_room"
        | "access_code_in_use"
        | "approval_entry_required"
        | "entry_closed"
        | "room_capacity_reached";
    };

export type JoinByShortCodeResult =
  | { ok: true; room: StoredRoom; participant: JoinedParticipant }
  | { ok: false; reason: "room_not_found" }
  | { ok: false; reason: "room_not_joinable"; status: RoomStatus }
  | {
      ok: false;
      reason:
        | "invalid_access_code"
        | "revoked_access_code"
        | "simulation_requires_test_room"
        | "access_code_in_use"
        | "approval_entry_required"
        | "entry_closed"
        | "room_capacity_reached";
    };

export type RosterSearchEntry = {
  rosterEntryId: string;
  fullName: string;
  requiresBirthDate: boolean;
  isClaimed: boolean;
};

export type StoredEntryRequest = {
  id: string;
  roomId: string;
  rosterEntryId: string;
  displayName: string;
  status: EntryRequestStatus;
  disputedAttemptCount: number;
  lastDisputedAt: Date | null;
  decidedByAdminId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

export type ClaimedParticipantSummary = {
  participantId: string;
  rosterEntryId: string | null;
  displayName: string;
  isPresent: boolean;
  joinedAt: Date;
  disputedAttemptCount: number;
  lastDisputedAt: Date | null;
};

export type DisputedEntrySummary = {
  rosterEntryId: string;
  displayName: string;
  disputedAttemptCount: number;
  lastDisputedAt: Date;
  currentHolderStatus: "pending" | "approved";
  requestId: string | null;
  participantId: string | null;
};

export type ApprovalQueueSnapshot = {
  requests: StoredEntryRequest[];
  claimedParticipants: ClaimedParticipantSummary[];
  disputes: DisputedEntrySummary[];
};

export type SubmitEntryRequestInput = {
  roomId: string;
  rosterEntryId: string;
  joinKeyHash: string;
  birthDay?: number | null;
  birthMonth?: number | null;
};

export type SubmitEntryRequestResult =
  | {
      ok: true;
      status: "pending" | "approved";
      requestId: string | null;
      displayName: string;
      created: boolean;
    }
  | {
      ok: false;
      reason:
        | "room_not_found"
        | "room_not_joinable"
        | "approval_mode_required"
        | "entry_closed"
        | "room_capacity_reached"
        | "roster_entry_not_found"
        | "voter_on_paper"
        | "birth_date_required"
        | "invalid_birth_day_month"
        | "birth_date_mismatch"
        | "roster_name_already_claimed"
        | "session_already_in_use";
    };

export type EntryRequestStatusResult =
  | {
      ok: true;
      requestId: string;
      status: EntryRequestStatus;
      displayName: string;
    }
  | {
      ok: false;
      reason: "request_not_found" | "forbidden_entry_request";
    };

export type ApproveEntryRequestResult =
  | {
      ok: true;
      request: StoredEntryRequest;
      participantId: string;
    }
  | {
      ok: false;
      reason:
        | "room_not_found"
        | "room_not_joinable"
        | "request_not_found"
        | "request_not_pending"
        | "roster_entry_not_found"
        | "voter_on_paper"
        | "room_capacity_reached"
        | "session_already_in_use";
    };

export type ApproveAllEntryRequestsResult =
  | {
      ok: true;
      approvedCount: number;
      skippedCount: number;
    }
  | {
      ok: false;
      reason: "room_not_found" | "room_not_joinable" | "room_capacity_reached";
    };

export type RejectEntryRequestResult =
  | {
      ok: true;
      request: StoredEntryRequest;
    }
  | {
      ok: false;
      reason: "room_not_found" | "request_not_found" | "request_not_pending";
    };

export type ReleaseClaimedNameResult =
  | {
      ok: true;
      rosterEntryId: string | null;
      participantId: string | null;
      displayName: string;
    }
  | {
      ok: false;
      reason: "room_not_found" | "target_not_found";
    };

export type ReleaseSessionResult =
  | {
      ok: true;
      participant: {
        id: string;
        displayName: string;
        isPresent: boolean;
      };
    }
  | { ok: false; reason: "room_not_found" | "participant_not_found" };

export type RevealRoundResultResult =
  | { ok: true; round: StoredRound; alreadyRevealed: boolean }
  | { ok: false; reason: "room_not_found" | "round_not_found" | "round_not_closed" };

export type UpdateRoomInput = {
  title?: string;
  quorumValue?: number;
  quorumUnit?: "absolute" | "percent";
  eligibleCount?: number;
  status?: RoomStatus;
  vacancies?: number;
  entryMode?: RoomEntryMode;
  entryOpen?: boolean;
  maxParticipants?: number | null;
  showLiveCandidateTally?: boolean;
  reactionsEnabled?: boolean;
  chatMuted?: boolean;
};

export type StoredParticipantSummary = {
  id: string;
  displayName: string;
  isPresent: boolean;
  chatMuted: boolean;
  joinedAt: Date;
};

export type StoredChatMessage = {
  id: string;
  roomId: string;
  participantId: string | null;
  senderName: string;
  senderRole: "voter" | "admin";
  content: string;
  createdAt: Date;
};

export type SendVoterChatResult =
  | { ok: true; message: StoredChatMessage }
  | {
      ok: false;
      reason: "participant_not_in_room" | "participant_muted" | "room_chat_muted" | "rate_limited";
    };

export type RoomRepository = {
  createRoom(room: NewRoom): Promise<StoredRoom>;
  updateRoom(roomId: string, input: UpdateRoomInput): Promise<StoredRoom | null>;
  listChatMessages?(roomId: string, limit?: number): Promise<StoredChatMessage[]>;
  sendVoterChatMessage?(input: {
    roomId: string;
    joinKeyHash: string;
    content: string;
    since: Date;
    maxPerWindow: number;
  }): Promise<SendVoterChatResult>;
  sendAdminChatMessage?(input: {
    roomId: string;
    senderName: string;
    content: string;
  }): Promise<StoredChatMessage | null>;
  listParticipants?(roomId: string): Promise<StoredParticipantSummary[]>;
  setParticipantChatMuted?(
    roomId: string,
    participantId: string,
    chatMuted: boolean,
  ): Promise<StoredParticipantSummary | null>;
  findParticipantChatStatus?(
    roomId: string,
    joinKeyHash: string,
  ): Promise<{ id: string; chatMuted: boolean } | null>;
  deleteChatMessage?(roomId: string, messageId: string): Promise<boolean>;
  setOfficeBanner(roomId: string, officeKey: string, bannerUrl: string | null): Promise<StoredRoom | null>;
  rotateInviteToken(roomId: string): Promise<StoredRoom | null>;
  listRooms(): Promise<StoredRoom[]>;
  findRoomByInviteToken(inviteToken: string): Promise<StoredRoom | null>;
  getJoinRoomByShortCode?(shortCode: string): Promise<StoredRoom | null>;
  findRoomById(roomId: string): Promise<StoredRoom | null>;
  deleteRoom(roomId: string): Promise<boolean>;
  joinRoomWithCode(roomId: string, code: string, joinKeyHash: string): Promise<JoinWithCodeResult>;
  joinRoomByShortCode?(
    shortCode: string,
    code: string,
    joinKeyHash: string,
  ): Promise<JoinByShortCodeResult>;
  searchRoomRoster?(roomId: string, query: string): Promise<RosterSearchEntry[]>;
  submitEntryRequest?(input: SubmitEntryRequestInput): Promise<SubmitEntryRequestResult>;
  getEntryRequestStatus?(
    roomId: string,
    requestId: string,
    joinKeyHash: string,
  ): Promise<EntryRequestStatusResult>;
  listEntryRequests?(roomId: string): Promise<ApprovalQueueSnapshot | null>;
  approveEntryRequest?(
    roomId: string,
    requestId: string,
    actorAdminId: string,
  ): Promise<ApproveEntryRequestResult>;
  approveAllEntryRequests?(
    roomId: string,
    actorAdminId: string,
  ): Promise<ApproveAllEntryRequestsResult>;
  rejectEntryRequest?(
    roomId: string,
    requestId: string,
    actorAdminId: string,
  ): Promise<RejectEntryRequestResult>;
  releaseClaimedName?(
    roomId: string,
    target: { rosterEntryId?: string; participantId?: string },
    actorAdminId: string,
  ): Promise<ReleaseClaimedNameResult>;
  generateMemberAccessCodes(roomId: string): Promise<StoredAccessCode[]>;
  issueMemberAccessCode?(
    roomId: string,
    memberId: string,
    replace: boolean,
  ): Promise<
    | { ok: true; accessCode: StoredAccessCode; created: boolean }
    | { ok: false; reason: "room_not_found" | "member_not_found" | "member_ineligible" }
  >;
  createSimulatedAccessCodes(roomId: string, count: number): Promise<StoredAccessCode[]>;
  listAccessCodes(roomId: string): Promise<StoredAccessCode[]>;
  revokeAccessCode(roomId: string, codeId: string): Promise<StoredAccessCode | null>;
  revokeAllAccessCodes(roomId: string): Promise<number>;
  deleteAccessCode(roomId: string, codeId: string): Promise<boolean>;
  removePresentParticipants(roomId: string, limit: number): Promise<number>;
  expelParticipants?(roomId: string, participantId?: string): Promise<number>;
  releaseParticipantSession?(
    roomId: string,
    participantId: string,
    actorAdminId: string,
  ): Promise<ReleaseSessionResult>;
  describeVoterSession?(
    roomId: string,
    joinKeyHash: string,
  ): Promise<"present" | "absent" | "revoked" | "missing">;
  countPresent(roomId: string): Promise<number>;
  countPaperVoters?(roomId: string): Promise<number>;
  listCandidates(roomId: string): Promise<StoredCandidate[]>;
  listAllCandidates(roomId: string): Promise<StoredCandidate[]>;
  listCandidatesByRooms(roomIds: string[]): Promise<StoredCandidate[]>;
  listRoomRoster?(
    roomId: string,
  ): Promise<{ entries: StoredRosterEntry[]; eligibleCount: number } | null>;
  addRosterEntry?(roomId: string, input: AddRosterEntryInput): Promise<AddRosterEntryResult>;
  removeRosterEntry?(roomId: string, entryId: string): Promise<RemoveRosterEntryResult>;
  setRosterEntryPaperMode?(
    roomId: string,
    entryId: string,
    votesOnPaper: boolean,
  ): Promise<SetRosterEntryPaperModeResult>;
  addRoomCandidate?(roomId: string, input: AddRoomCandidateInput): Promise<AddRoomCandidateResult>;
  removeRoomCandidate?(
    roomId: string,
    candidateId: string,
    officeLabel?: string,
  ): Promise<RemoveRoomCandidateResult>;
  openRound(
    roomId: string,
    eligibleCandidateIds?: readonly string[],
    officeLabel?: string | null,
    vacancies?: number,
  ): Promise<OpenRoundResult>;
  listRounds(roomId: string): Promise<StoredRound[]>;
  closeRound(
    roomId: string,
    roundId: string,
    outcome: RoundResult | null,
    options?: {
      winnerCandidateId?: string | null;
      winnerCandidateIds?: string[];
      tieBreakReason?: "age" | "admin_tiebreak" | null;
      didNotVoteCount?: number;
    },
  ): Promise<StoredRound | null>;
  closeAndTallyRound?(
    roomId: string,
    roundId: string,
    options?: { confirmPending?: boolean; confirmNoPaperBallots?: boolean },
  ): Promise<AtomicCloseRoundResult>;
  upsertRoundPaperTally?(input: {
    roomId: string;
    roundId: string;
    paperTally: PaperTallyInput;
    adminId: string;
    adminName: string;
  }): Promise<UpsertRoundPaperTallyResult>;
  findRoundPaperTally?(roundId: string): Promise<StoredPaperTally | null>;
  listRoundPaperTallies?(roundIds: readonly string[]): Promise<StoredPaperTally[]>;
  resolveRoundTie?(
    roomId: string,
    roundId: string,
    winnerCandidateId: string,
  ): Promise<StoredRound | null>;
  restartRound(roomId: string, roundId: string): Promise<StoredRound | null>;
  declineRound(
    roomId: string,
    roundId: string,
    declinedCandidateId: string,
  ): Promise<StoredRound | null>;
  revealRoundResult?(roomId: string, roundId: string): Promise<RevealRoundResultResult>;
  findRound(roomId: string, roundId: string): Promise<StoredRound | null>;
  latestRounds(roomIds: string[]): Promise<StoredRound[]>;
  latestClosedRound(roomId: string): Promise<StoredRound | null>;
  listAuditEvents(roomId: string): Promise<StoredAuditEvent[]>;
  listAllAuditEvents?(roomId?: string): Promise<StoredAuditEvent[]>;
  verifyAuditChain?(roomId?: string): Promise<AuditChainVerificationResult>;
  hasSimulatedAccessCodes?(roomId: string): Promise<boolean>;
  recordAuditEvent?(
    roomId: string,
    action: string,
    payload?: Record<string, unknown>,
  ): Promise<StoredAuditEvent>;
  castBallot(input: {
    roomId: string;
    roundId: string;
    joinKeyHash: string;
    candidateId?: string | null;
    candidateIds?: readonly string[];
  }): Promise<CastBallotResult>;
  hasVotedInRound(roomId: string, roundId: string, joinKeyHash: string): Promise<boolean>;
  listRoundBallotCandidateIds(roundId: string): Promise<(string | null)[]>;
  listRoundBallotMarks?(roundId: string): Promise<string[][]>;
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
