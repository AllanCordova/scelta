const JOINABLE_ROOM_STATUSES = ["open", "voting"] as const;

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

/** Draft, closed, and cancelled rooms stay shut. Voting stays open for late arrivals. */
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
