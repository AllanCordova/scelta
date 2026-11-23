const JOINABLE_ROOM_STATUSES = ["open", "test"] as const;

export const ENTRY_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type EntryRequestStatus = (typeof ENTRY_REQUEST_STATUSES)[number];

export const DISPLAY_NAME_MAX_LENGTH = 80;
export const JOIN_KEY_MIN_LENGTH = 16;
export const JOIN_KEY_MAX_LENGTH = 128;
export const ACCESS_CODE_LENGTH = 6;
export const ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const JOIN_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const ACCESS_CODE_PATTERN = /^[A-Z0-9]{6}$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export type JoinFieldError = {
  field: "displayName" | "joinKey";
  code: "required" | "invalid" | "out_of_range";
};

export type AccessCodeJoinFieldError = {
  field: "code" | "joinKey";
  code: "required" | "invalid" | "out_of_range";
};

export type JoinIdentity = {
  displayName: string;
  joinKey: string;
};

export type AccessCodeJoinInput = {
  code: string;
  joinKey: string;
};

/** Draft and closed rooms stay shut. Open and test rooms accept participants. */
export function canJoinRoom(status: string): boolean {
  return (JOINABLE_ROOM_STATUSES as readonly string[]).includes(status);
}

export function normalizeAccessCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function validateAccessCodeJoin(input: {
  code: string;
  joinKey: string;
}): { ok: true; value: AccessCodeJoinInput } | { ok: false; errors: AccessCodeJoinFieldError[] } {
  const errors: AccessCodeJoinFieldError[] = [];
  const code = normalizeAccessCode(input.code);
  const joinKey = input.joinKey;

  if (code.length === 0) {
    errors.push({ field: "code", code: "required" });
  } else if (code.length !== ACCESS_CODE_LENGTH) {
    errors.push({ field: "code", code: "out_of_range" });
  } else if (!ACCESS_CODE_PATTERN.test(code)) {
    errors.push({ field: "code", code: "invalid" });
  }

  if (joinKey.length === 0 || joinKey.trim().length === 0) {
    errors.push({ field: "joinKey", code: "required" });
  } else if (joinKey.length < JOIN_KEY_MIN_LENGTH || joinKey.length > JOIN_KEY_MAX_LENGTH) {
    errors.push({ field: "joinKey", code: "out_of_range" });
  } else if (joinKey !== joinKey.trim() || !JOIN_KEY_PATTERN.test(joinKey)) {
    errors.push({ field: "joinKey", code: "invalid" });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { code, joinKey } };
}

export function validateJoinIdentity(input: {
  displayName: string;
  joinKey: string;
}): { ok: true; value: JoinIdentity } | { ok: false; errors: JoinFieldError[] } {
  const errors: JoinFieldError[] = [];
  const displayName = input.displayName.trim();
  const joinKey = input.joinKey;

  if (displayName.length === 0) {
    errors.push({ field: "displayName", code: "required" });
  } else if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    errors.push({ field: "displayName", code: "out_of_range" });
  } else if (CONTROL_CHARS.test(displayName)) {
    errors.push({ field: "displayName", code: "invalid" });
  }

  if (joinKey.length === 0 || joinKey.trim().length === 0) {
    errors.push({ field: "joinKey", code: "required" });
  } else if (joinKey.length < JOIN_KEY_MIN_LENGTH || joinKey.length > JOIN_KEY_MAX_LENGTH) {
    errors.push({ field: "joinKey", code: "out_of_range" });
  } else if (joinKey !== joinKey.trim() || !JOIN_KEY_PATTERN.test(joinKey)) {
    errors.push({ field: "joinKey", code: "invalid" });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { displayName, joinKey } };
}

/**
 * Resolves the effective participant cap for a room: explicit positive `maxParticipants`
 * when set, otherwise falls back to the room's `eligibleCount` (0 means no roster cap).
 */
export function resolveRoomMaxParticipants(room: {
  maxParticipants?: number | null;
  eligibleCount: number;
}): number {
  if (
    typeof room.maxParticipants === "number" &&
    Number.isInteger(room.maxParticipants) &&
    room.maxParticipants >= 1
  ) {
    return room.maxParticipants;
  }

  return room.eligibleCount > 0 ? room.eligibleCount : 0;
}

export function canEnterRoom(input: {
  status: string;
  entryOpen: boolean;
  presentCount: number;
  maxParticipants: number | null;
  eligibleCount: number;
  isReentry?: boolean;
}): { allowed: true } | { allowed: false; reason: "room_not_joinable" | "entry_closed" | "room_full" } {
  if (!canJoinRoom(input.status)) {
    return { allowed: false, reason: "room_not_joinable" };
  }

  if (input.isReentry) {
    return { allowed: true };
  }

  if (!input.entryOpen) {
    return { allowed: false, reason: "entry_closed" };
  }

  const limit = resolveRoomMaxParticipants({
    maxParticipants: input.maxParticipants,
    eligibleCount: input.eligibleCount,
  });
  if (limit > 0 && input.presentCount >= limit) {
    return { allowed: false, reason: "room_full" };
  }

  return { allowed: true };
}

export function extractBirthDayMonth(
  birthDate: string | Date | null | undefined,
): { day: number; month: number } | null {
  if (birthDate == null) {
    return null;
  }

  if (birthDate instanceof Date) {
    if (Number.isNaN(birthDate.getTime())) {
      return null;
    }
    return {
      day: birthDate.getUTCDate(),
      month: birthDate.getUTCMonth() + 1,
    };
  }

  const trimmed = birthDate.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(trimmed);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() + 1 !== month ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }

  return { day, month };
}

export function verifyBirthDayMonth(
  storedBirthDate: string | Date | null | undefined,
  input?: { birthDay?: number | null; birthMonth?: number | null },
):
  | { ok: true }
  | {
      ok: false;
      reason: "birth_date_required" | "birth_date_mismatch" | "invalid_birth_day_month";
    } {
  const stored = extractBirthDayMonth(storedBirthDate);
  if (!stored) {
    return { ok: true };
  }

  const day = input?.birthDay;
  const month = input?.birthMonth;
  if (day == null || month == null) {
    return { ok: false, reason: "birth_date_required" };
  }

  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12
  ) {
    return { ok: false, reason: "invalid_birth_day_month" };
  }

  if (day !== stored.day || month !== stored.month) {
    return { ok: false, reason: "birth_date_mismatch" };
  }

  return { ok: true };
}

export function normalizeRosterSearchQuery(query: string): string {
  return query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function matchesRosterSearch(fullName: string, query: string): boolean {
  const normalizedQuery = normalizeRosterSearchQuery(query);
  if (normalizedQuery.length < 2) {
    return false;
  }

  const normalizedName = normalizeRosterSearchQuery(fullName);
  return normalizedName.includes(normalizedQuery);
}
