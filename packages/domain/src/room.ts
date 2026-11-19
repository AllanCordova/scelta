import type { QuorumUnit } from "./quorum.js";
import type { RulesPreset } from "./rounds.js";

export const ROOM_TYPES = [
  "pastor",
  "elder",
  "deacon",
  "session_board",
  "upa_board",
  "ump_board",
  "custom",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const CREATE_ROOM_STATUSES = ["draft", "open", "test"] as const;
export type CreateRoomStatus = (typeof CREATE_ROOM_STATUSES)[number];

export const ROOM_STATUSES = ["draft", "open", "test", "closed"] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export type RoomStatusTransitionRejectionReason =
  | "room_already_closed"
  | "round_currently_open"
  | "invalid_status_transition";

export type RoomQuorumUpdateRejectionReason = "room_closed" | "round_currently_open";

export type MajorityRule = "absolute_majority";

export type PresetDefinition = {
  preset: RulesPreset;
  quorumValue: number | null;
  quorumUnit: QuorumUnit | null;
  majorityRule: MajorityRule;
  roundBehavior: string;
};

/** Defaults applied when an admin picks a preset and does not override quorum. */
export const PRESET_DEFINITIONS: readonly PresetDefinition[] = [
  {
    preset: "ipb_local_officers",
    quorumValue: 34,
    quorumUnit: "percent",
    majorityRule: "absolute_majority",
    roundBehavior:
      "Absolute majority (more than 50% of votes). Up to two open ballots; further rounds may be limited to the most voted candidates.",
  },
  {
    preset: "ipb_society_board",
    quorumValue: 51,
    quorumUnit: "percent",
    majorityRule: "absolute_majority",
    roundBehavior:
      "Absolute majority (more than 50% of votes). After two ballots without a winner, the third ballot is limited to the top two candidates.",
  },
  {
    preset: "custom",
    quorumValue: null,
    quorumUnit: null,
    majorityRule: "absolute_majority",
    roundBehavior:
      "Admin sets quorum explicitly. Further rounds are not opened automatically.",
  },
];

const RULES_PRESETS: readonly RulesPreset[] = [
  "ipb_local_officers",
  "ipb_society_board",
  "custom",
];

const ABSOLUTE_QUORUM_MAX = 100_000;
const ELIGIBLE_COUNT_MAX = 100_000;
const TITLE_MAX_LENGTH = 200;

export type CreateRoomDraft = {
  title: string;
  roomType: string;
  rulesPreset: string;
  quorumValue?: number;
  quorumUnit?: string;
  eligibleCount?: number;
  status?: string;
};

export type ValidRoomConfig = {
  title: string;
  roomType: RoomType;
  rulesPreset: RulesPreset;
  quorumValue: number;
  quorumUnit: QuorumUnit;
  eligibleCount: number;
  status: CreateRoomStatus;
  majorityRule: MajorityRule;
  roundBehavior: string;
};

export type RoomFieldError = {
  field:
    | "title"
    | "roomType"
    | "rulesPreset"
    | "quorumValue"
    | "quorumUnit"
    | "eligibleCount"
    | "status";
  code:
    | "required"
    | "invalid"
    | "out_of_range"
    | "incomplete";
};

export function findPreset(preset: RulesPreset): PresetDefinition {
  const definition = PRESET_DEFINITIONS.find((item) => item.preset === preset);
  if (!definition) {
    throw new Error(`Unknown rules preset: ${preset}`);
  }
  return definition;
}

export function validateCreateRoom(
  draft: CreateRoomDraft,
): { ok: true; value: ValidRoomConfig } | { ok: false; errors: RoomFieldError[] } {
  const errors: RoomFieldError[] = [];

  const title = draft.title.trim();
  if (title.length === 0) {
    errors.push({ field: "title", code: "required" });
  } else if (title.length > TITLE_MAX_LENGTH) {
    errors.push({ field: "title", code: "out_of_range" });
  }

  const roomType = isRoomType(draft.roomType) ? draft.roomType : undefined;
  if (!roomType) {
    errors.push({ field: "roomType", code: "invalid" });
  }

  const rulesPreset = isRulesPreset(draft.rulesPreset) ? draft.rulesPreset : undefined;
  if (!rulesPreset) {
    errors.push({ field: "rulesPreset", code: "invalid" });
  }

  const requestedStatus = draft.status ?? "draft";
  const status = isCreateRoomStatus(requestedStatus) ? requestedStatus : undefined;
  if (!status) {
    errors.push({ field: "status", code: "invalid" });
  }

  const quorum = resolveQuorum(draft);
  errors.push(...quorum.errors);

  const eligible = resolveEligibleCount(draft);
  errors.push(...eligible.errors);

  if (
    errors.length > 0 ||
    !roomType ||
    !rulesPreset ||
    !status ||
    !quorum.value ||
    eligible.value === undefined
  ) {
    return { ok: false, errors };
  }

  const preset = findPreset(rulesPreset);

  return {
    ok: true,
    value: {
      title,
      roomType,
      rulesPreset,
      quorumValue: quorum.value.quorumValue,
      quorumUnit: quorum.value.quorumUnit,
      eligibleCount: eligible.value,
      status,
      majorityRule: preset.majorityRule,
      roundBehavior: preset.roundBehavior,
    },
  };
}

export function canOpenRound(status: RoomStatus): boolean {
  return status === "open" || status === "test";
}

export function canSimulateInRoom(status: RoomStatus): boolean {
  return status === "test";
}

export function canTransitionRoomStatus(
  from: RoomStatus,
  to: RoomStatus,
  options?: { hasOpenRound?: boolean },
): { ok: true } | { ok: false; reason: RoomStatusTransitionRejectionReason } {
  if (!(ROOM_STATUSES as readonly string[]).includes(from) || !(ROOM_STATUSES as readonly string[]).includes(to)) {
    return { ok: false, reason: "invalid_status_transition" };
  }

  if (from === to) {
    return { ok: true };
  }

  if (from === "closed") {
    return { ok: false, reason: "room_already_closed" };
  }

  if (options?.hasOpenRound) {
    return { ok: false, reason: "round_currently_open" };
  }

  return { ok: true };
}

export function canUpdateRoomQuorum(options: {
  roomStatus: RoomStatus;
  hasOpenRound: boolean;
}): { ok: true } | { ok: false; reason: RoomQuorumUpdateRejectionReason } {
  if (options.roomStatus === "closed") {
    return { ok: false, reason: "room_closed" };
  }

  if (options.hasOpenRound) {
    return { ok: false, reason: "round_currently_open" };
  }

  return { ok: true };
}

/**
 * Checks whether candidates can be added or removed for a room or office scope.
 * Locked once the room is closed or once the 1st scrutiny for that scope has been opened.
 */
export function canManageRoomCandidates(
  roomStatus: RoomStatus,
  hasRoundsForScope: boolean,
): { allowed: boolean; reason?: string } {
  if (roomStatus === "closed") {
    return { allowed: false, reason: "room_closed" };
  }

  if (hasRoundsForScope) {
    return { allowed: false, reason: "candidates_locked_after_round" };
  }

  return { allowed: true };
}

function resolveEligibleCount(draft: CreateRoomDraft): {
  value?: number;
  errors: RoomFieldError[];
} {
  if (draft.eligibleCount === undefined) {
    return { value: 0, errors: [] };
  }

  if (!isValidEligibleCount(draft.eligibleCount)) {
    return { errors: [{ field: "eligibleCount", code: "out_of_range" }] };
  }

  return { value: draft.eligibleCount, errors: [] };
}

function isValidEligibleCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= ELIGIBLE_COUNT_MAX;
}

function resolveQuorum(draft: CreateRoomDraft): {
  value?: { quorumValue: number; quorumUnit: QuorumUnit };
  errors: RoomFieldError[];
} {
  const hasValue = draft.quorumValue !== undefined;
  const hasUnit = draft.quorumUnit !== undefined;

  if (hasValue !== hasUnit) {
    return {
      errors: [{ field: hasValue ? "quorumUnit" : "quorumValue", code: "incomplete" }],
    };
  }

  if (!hasValue && !hasUnit) {
    if (!isRulesPreset(draft.rulesPreset)) {
      return { errors: [] };
    }

    const preset = findPreset(draft.rulesPreset);
    if (preset.quorumValue === null || preset.quorumUnit === null) {
      return { errors: [{ field: "quorumValue", code: "required" }] };
    }

    return {
      value: { quorumValue: preset.quorumValue, quorumUnit: preset.quorumUnit },
      errors: [],
    };
  }

  if (!isQuorumUnit(draft.quorumUnit)) {
    return { errors: [{ field: "quorumUnit", code: "invalid" }] };
  }

  const quorumValue = draft.quorumValue;
  if (!isValidQuorumValue(quorumValue, draft.quorumUnit)) {
    return { errors: [{ field: "quorumValue", code: "out_of_range" }] };
  }

  return {
    value: { quorumValue, quorumUnit: draft.quorumUnit },
    errors: [],
  };
}

function isValidQuorumValue(
  quorumValue: number | undefined,
  quorumUnit: QuorumUnit,
): quorumValue is number {
  if (typeof quorumValue !== "number" || !Number.isInteger(quorumValue)) {
    return false;
  }

  if (quorumUnit === "percent") {
    return quorumValue >= 1 && quorumValue <= 100;
  }

  return quorumValue >= 1 && quorumValue <= ABSOLUTE_QUORUM_MAX;
}

function isRoomType(value: string): value is RoomType {
  return (ROOM_TYPES as readonly string[]).includes(value);
}

function isRulesPreset(value: string): value is RulesPreset {
  return (RULES_PRESETS as readonly string[]).includes(value);
}

function isCreateRoomStatus(value: string): value is CreateRoomStatus {
  return (CREATE_ROOM_STATUSES as readonly string[]).includes(value);
}

function isQuorumUnit(value: string | undefined): value is QuorumUnit {
  return value === "absolute" || value === "percent";
}
