export type RulesPreset = "ipb_local_officers" | "ipb_society_board" | "custom";
export type QuorumUnit = "absolute" | "percent";
export type RoomType = "pastor" | "elder" | "deacon" | "upa_board" | "custom";
export type RoomStatus = "draft" | "open";

export type PresetDefinition = {
  preset: RulesPreset;
  quorumValue: number | null;
  quorumUnit: QuorumUnit | null;
  majorityRule: "absolute_majority";
  roundBehavior: string;
};

export type RoomSummary = {
  id: string;
  title: string;
  roomType: RoomType;
  rulesPreset: RulesPreset;
  quorumValue: number;
  quorumUnit: QuorumUnit;
  status: RoomStatus;
  inviteToken: string;
  invitePath: string;
  majorityRule: string;
  roundBehavior: string;
  createdAt: string;
};

export type FieldErrorCode = "required" | "invalid" | "out_of_range" | "incomplete";

export type FieldError = {
  field: "title" | "roomType" | "rulesPreset" | "quorumValue" | "quorumUnit" | "status";
  code: FieldErrorCode;
};
