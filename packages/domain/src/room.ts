import type { QuorumUnit } from "./quorum.js";
import type { RulesPreset } from "./rounds.js";

export const ROOM_TYPES = ["pastor", "elder", "deacon", "upa_board", "custom"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const CREATE_ROOM_STATUSES = ["draft", "open"] as const;
export type CreateRoomStatus = (typeof CREATE_ROOM_STATUSES)[number];

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
const TITLE_MAX_LENGTH = 200;

export type CreateRoomDraft = {
  title: string;
  roomType: string;
  rulesPreset: string;
  quorumValue?: number;
  quorumUnit?: string;
  status?: string;
};

export type ValidRoomConfig = {
  title: string;
  roomType: RoomType;
  rulesPreset: RulesPreset;
  quorumValue: number;
  quorumUnit: QuorumUnit;
  status: CreateRoomStatus;
  majorityRule: MajorityRule;
  roundBehavior: string;
};

export type RoomFieldError = {
  field: "title" | "roomType" | "rulesPreset" | "quorumValue" | "quorumUnit" | "status";
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

  if (errors.length > 0 || !roomType || !rulesPreset || !status || !quorum.value) {
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
      status,
      majorityRule: preset.majorityRule,
      roundBehavior: preset.roundBehavior,
    },
  };
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
