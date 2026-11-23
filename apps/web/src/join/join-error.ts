import { joinErrorMessage } from "./copy";

export const AUTO_JOIN_BACKOFF_DELAYS_MS = [1000, 2000, 4000] as const;

export type JoinErrorKind =
  | "permanent_auth"
  | "conflict_in_use"
  | "room_blocked"
  | "rate_limited"
  | "transient";

export class JoinRequestError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly roomStatus: string | undefined;
  readonly serverMessage: string | undefined;

  constructor(status: number, errorCode: string, roomStatus?: string, serverMessage?: string) {
    super(errorCode);
    this.name = "JoinRequestError";
    this.status = status;
    this.errorCode = errorCode;
    this.roomStatus = roomStatus;
    this.serverMessage = serverMessage;
  }
}

type ErrorLike = {
  status: number;
  errorCode: string;
  roomStatus?: string;
  serverMessage?: string;
};

function asJoinErrorLike(error: unknown): ErrorLike | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "errorCode" in error &&
    typeof error.status === "number" &&
    typeof error.errorCode === "string"
  ) {
    return error as ErrorLike;
  }
  return null;
}

/**
 * Classifies a join error to separate transient failures from permanent rejections and conflicts.
 */
export function classifyJoinError(error: unknown): JoinErrorKind {
  const err = asJoinErrorLike(error);
  if (!err) {
    return "transient";
  }

  if (err.errorCode === "access_code_in_use") {
    return "conflict_in_use";
  }

  if (err.errorCode === "room_not_joinable") {
    return "room_blocked";
  }

  if (err.status === 429 || err.errorCode === "rate_limited") {
    return "rate_limited";
  }

  if (err.status >= 500 || err.status === 408 || err.status === 0) {
    return "transient";
  }

  if (
    err.status === 400 ||
    err.status === 403 ||
    err.status === 404 ||
    err.errorCode === "invalid_access_code" ||
    err.errorCode === "revoked_access_code" ||
    err.errorCode === "invite_not_found" ||
    err.errorCode === "invalid_join"
  ) {
    return "permanent_auth";
  }

  return "transient";
}

/**
 * Returns true when an error is transient (network failure, 5xx, 429) and safe to retry with backoff.
 */
export function isTransientJoinError(error: unknown): boolean {
  const kind = classifyJoinError(error);
  return kind === "transient" || kind === "rate_limited";
}

/**
 * Returns true ONLY on permanent auth/invite rejections (403/404), never on transient errors or 409 conflicts.
 */
export function shouldClearStoredAccessCode(error: unknown): boolean {
  const err = asJoinErrorLike(error);
  if (!err) {
    return false;
  }

  return (
    err.status === 403 ||
    err.status === 404 ||
    err.errorCode === "invalid_access_code" ||
    err.errorCode === "revoked_access_code" ||
    err.errorCode === "invite_not_found"
  );
}

/**
 * Formats a user-facing Portuguese message for any join error, including 409 conflicts and 429 rate limits.
 */
export function formatJoinErrorMessage(error: unknown): string {
  const err = asJoinErrorLike(error);
  if (err?.errorCode === "access_code_in_use") {
    return "Este código já está em uso. Procure a mesa.";
  }

  if (err && (err.status === 429 || err.errorCode === "rate_limited")) {
    return "Muitas tentativas seguidas. Aguarde um instante e tente novamente.";
  }

  if (!err || err.status >= 500 || err.status === 408 || err.status === 0) {
    return "Não foi possível conectar ao servidor. Tente novamente em instantes.";
  }

  return joinErrorMessage(error);
}
