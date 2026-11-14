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
export type CreatableRoomStatus = "draft" | "open";
export type RoomStatus = CreatableRoomStatus | "voting" | "closed" | "cancelled";

export type PresetDefinition = {
  preset: RulesPreset;
  quorumValue: number | null;
  quorumUnit: QuorumUnit | null;
  majorityRule: "absolute_majority";
  roundBehavior: string;
};

export type CandidateOption = {
  id: string;
  displayName: string;
  photoUrl?: string | null;
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
};

export type RoundTally = {
  totalVotes: number;
  nullVotes?: number;
  threshold: number;
  outcome: "elected" | "no_majority";
  winnerId: string | null;
  winnerName: string | null;
  standings: CandidateStanding[];
};

export type RoomSummary = {
  id: string;
  title: string;
  roomType: RoomType;
  rulesPreset: RulesPreset;
  quorumValue: number;
  quorumUnit: QuorumUnit;
  eligibleCount: number;
  status: RoomStatus;
  candidates?: CandidateOption[];
  round: RoomRound | null;
  inviteToken: string;
  invitePath: string;
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
};

export type AuditEventItem = {
  id: string;
  actorRole: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type RoomDetail = RoomSummary & {
  presence: {
    presentCount: number;
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
  tally?: RoundTally;
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
