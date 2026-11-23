export type RulesPreset = "ipb_local_officers" | "ipb_society_board" | "custom";
export type QuorumUnit = "absolute" | "percent";
export type RoomType =
  | "pastor"
  | "elder"
  | "deacon"
  | "session_board"
  | "upa_board"
  | "ump_board"
  | "custom";
export type CreatableRoomStatus = "draft" | "open" | "test";
export type RoomStatus = CreatableRoomStatus | "closed";

export type PresetDefinition = {
  preset: RulesPreset;
  quorumValue: number | null;
  quorumUnit: QuorumUnit | null;
  majorityRule: "absolute_majority";
  roundBehavior: string;
};

export type CandidateOption = {
  id: string;
  memberId?: string | null;
  displayName: string;
  photoUrl?: string | null;
  birthDate?: string | null;
  isEligible?: boolean;
};

export type RoomRosterEntryItem = {
  id: string;
  roomId: string;
  memberId: string | null;
  fullName: string;
  birthDate: string | null;
  isCommunicant: boolean;
  isMale: boolean | null;
  isEligibleVoter: boolean;
  createdAt: string;
  accessCode: {
    id: string;
    code: string;
    revokedAt: string | null;
  } | null;
  isPresent: boolean;
  votesOnPaper?: boolean;
};

export type SuggestedCandidate = {
  memberId: string;
  fullName: string;
};

export type MemberImportReport = {
  createdCount: number;
  updatedCount: number;
  rejectedCount: number;
  rejectedRows: { line: number; name?: string; reason: string }[];
};

export type StoredMemberItem = {
  id: string;
  fullName: string;
  isCommunicant: boolean;
  isMale: boolean | null;
  birthDate: string | null;
  photoUrl?: string | null;
  societyFlags: {
    upaActive?: boolean;
    upaEnrolledAt?: string;
    umpActive?: boolean;
    umpEnrolledAt?: string;
  };
};

export type PaginatedMembersResult = {
  members: StoredMemberItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type MemberAccessCodeItem = {
  id: string;
  memberId: string | null;
  displayName: string;
  code: string;
  revokedAt: string | null;
  createdAt: string;
};

export type CandidateStanding = {
  candidateId: string;
  displayName: string;
  votes: number;
  onlineVotes?: number;
  paperVotes?: number;
};

export type VoteOriginBreakdown = {
  online: {
    ballots: number;
    candidateVotes: number;
    blankVotes: number;
  };
  paper: {
    ballots: number;
    candidateVotes: number;
    blankVotes: number;
    nullVotes: number;
  };
};

export type RoundPaperTally = {
  id: string;
  roundId: string;
  ballotCount: number;
  blankVotes: number;
  nullVotes: number;
  candidateVotes: Record<string, number>;
  recordedByAdminId: string | null;
  recordedByName: string | null;
  recordedAt: string;
  updatedAt: string;
};

export type TieBreakReason = "age" | "admin_tiebreak";

export type TiedCandidateOption = {
  id: string;
  displayName: string;
  birthDate: string | null;
};

export type RoundTally = {
  totalVotes: number;
  nullVotes?: number;
  threshold: number;
  outcome: "elected" | "no_majority";
  winnerId: string | null;
  winnerName: string | null;
  standings: CandidateStanding[];
  didNotVoteCount?: number;
  tieBreakReason?: TieBreakReason;
  tieBreakRequired?: boolean;
  tiedCandidates?: TiedCandidateOption[];
  voteOrigin?: VoteOriginBreakdown;
};

export type RoomSummary = {
  id: string;
  title: string;
  roomType: RoomType;
  rulesPreset: RulesPreset;
  quorumValue: number;
  quorumUnit: QuorumUnit;
  eligibleCount: number;
  officeBanners?: Record<string, string>;
  status: RoomStatus;
  candidates?: CandidateOption[];
  round: RoomRound | null;
  inviteToken: string;
  invitePath: string;
  shortCode: string;
  shortPath?: string;
  majorityRule: string;
  roundBehavior: string;
  createdAt: string;
};

export type OfficeProgressStatus = "pending" | "open" | "in_progress" | "elected";

export type OfficeProgressItem = {
  officeLabel: string;
  order: number;
  status: OfficeProgressStatus;
  roundCount: number;
  winnerCandidateId: string | null;
  winnerName: string | null;
  winnerPhotoUrl?: string | null;
  bannerUrl?: string | null;
};

export type AuditEventItem = {
  id: string;
  actorRole: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type IntegrityLogItem = {
  id: string;
  sequence: number;
  roomId: string;
  roomTitle: string;
  roomStatus: string;
  actorRole: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
  integrityHash: string;
};

export type IntegrityLogsSummary = {
  totalEvents: number;
  humanBallotsCast: number;
  simulatedBallotsCast: number;
  humanParticipantsJoined: number;
  adminVoteInterventions: number;
  chainHeadHash: string;
  immutable: boolean;
};

export type IntegrityLogRoomOption = {
  id: string;
  title: string;
  status: string;
};

export type IntegrityLogsResponse = {
  logs: IntegrityLogItem[];
  rooms: IntegrityLogRoomOption[];
  summary: IntegrityLogsSummary;
};

export type RoomDetail = RoomSummary & {
  reactionsEnabled?: boolean;
  chatMuted?: boolean;
  hasRounds?: boolean;
  lockedOffices?: string[];
  presence: {
    presentCount: number;
    onlinePresentCount?: number;
    paperVotersCount?: number;
    eligibleCount: number;
    requiredCount: number;
    quorumMet: boolean;
  };
  votedCount: number;
  receiptTimestamps: string[];
  offices?: OfficeProgressItem[];
  recommendedOffice?: string | null;
  auditEvents?: AuditEventItem[];
};

export type FieldErrorCode = "required" | "invalid" | "out_of_range" | "incomplete";

export type RoundResult = "failed_quorum" | "no_majority" | "elected" | "declined";
export type RoundStatus = "pending" | "open" | "closed" | "restarted";

export type RoomRound = {
  id: string;
  number: number;
  officeLabel?: string | null;
  officeRoundNumber?: number;
  status: RoundStatus;
  outcome: RoundResult | null;
  restartCount?: number;
  didNotVoteCount?: number;
  tally?: RoundTally;
  paperTally?: RoundPaperTally | null;
};

export type FieldError = {
  field:
    | "title"
    | "roomType"
    | "rulesPreset"
    | "quorumValue"
    | "quorumUnit"
    | "eligibleCount"
    | "status"
    | "candidates";
  code: FieldErrorCode;
};
