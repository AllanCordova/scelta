export type RulesPreset = "ipb_local_officers" | "ipb_society_board" | "custom";
export type QuorumUnit = "absolute" | "percent";
export type RoomType = "pastor" | "elder" | "deacon" | "upa_board" | "custom";
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
};

export type CandidateStanding = {
  candidateId: string;
  displayName: string;
  votes: number;
};

export type RoundTally = {
  totalVotes: number;
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

export type FieldErrorCode = "required" | "invalid" | "out_of_range" | "incomplete";

export type RoundResult = "failed_quorum" | "no_majority" | "elected";
export type RoundStatus = "pending" | "open" | "closed" | "restarted";

export type RoomRound = {
  id: string;
  number: number;
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
