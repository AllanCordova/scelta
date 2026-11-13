import type { RoundResult } from "./quorum.js";
import type { RoomType } from "./room.js";

/**
 * Mandatory IPB GTSI election order for internal society boards (UPA, UMP).
 */
export const IPB_SOCIETY_BOARD_OFFICES = [
  "Presidente",
  "Vice-Presidente",
  "1º Secretário",
  "2º Secretário",
  "Tesoureiro",
] as const;

/**
 * CI/IPB art. 84 offices for the local church Session board (Mesa do Conselho).
 * The Pastor is President ex-officio and is not elected here.
 */
export const IPB_SESSION_BOARD_OFFICES = [
  "Vice-Presidente",
  "Secretário",
  "Tesoureiro",
] as const;

export type IpbSocietyBoardOffice = (typeof IPB_SOCIETY_BOARD_OFFICES)[number];
export type IpbSessionBoardOffice = (typeof IPB_SESSION_BOARD_OFFICES)[number];

export type OfficeProgressStatus = "pending" | "open" | "in_progress" | "elected";

export type OfficeRoundSnapshot = {
  id: string;
  number: number;
  officeLabel: string | null;
  status: string;
  outcome: RoundResult | null;
  winnerCandidateId?: string | null;
  winnerName?: string | null;
};

export type OfficeProgressItem = {
  officeLabel: string;
  order: number;
  status: OfficeProgressStatus;
  roundCount: number;
  winnerCandidateId: string | null;
  winnerName: string | null;
};

export type ResolveTargetOfficeResult =
  | { ok: true; officeLabel: string | null }
  | { ok: false; reason: "invalid_office" | "winner_already_elected" | "all_offices_elected" };

export function officesForRoomType(roomType: RoomType): readonly string[] {
  if (roomType === "upa_board" || roomType === "ump_board") {
    return IPB_SOCIETY_BOARD_OFFICES;
  }
  if (roomType === "session_board") {
    return IPB_SESSION_BOARD_OFFICES;
  }
  return [];
}

export function isMultiOfficeRoomType(roomType: RoomType): boolean {
  return officesForRoomType(roomType).length > 0;
}

export function isValidOfficeForRoomType(roomType: RoomType, officeLabel: string): boolean {
  return officesForRoomType(roomType).includes(officeLabel);
}

export function buildOfficeProgress(
  roomType: RoomType,
  rounds: readonly OfficeRoundSnapshot[],
): OfficeProgressItem[] {
  const offices = officesForRoomType(roomType);
  if (offices.length === 0) {
    return [];
  }

  return offices.map((officeLabel, index) => {
    const officeRounds = rounds
      .filter((round) => round.officeLabel === officeLabel)
      .sort((a, b) => a.number - b.number);

    const electedRound = officeRounds.find(
      (round) => round.status === "closed" && round.outcome === "elected",
    );
    const openRound = officeRounds.find((round) => round.status === "open");

    let status: OfficeProgressStatus = "pending";
    if (electedRound) {
      status = "elected";
    } else if (openRound) {
      status = "open";
    } else if (officeRounds.length > 0) {
      status = "in_progress";
    }

    return {
      officeLabel,
      order: index + 1,
      status,
      roundCount: officeRounds.length,
      winnerCandidateId: electedRound?.winnerCandidateId ?? null,
      winnerName: electedRound?.winnerName ?? null,
    };
  });
}

export function resolveTargetOffice(
  roomType: RoomType,
  rounds: readonly OfficeRoundSnapshot[],
  requestedOffice?: string,
): ResolveTargetOfficeResult {
  const offices = officesForRoomType(roomType);
  if (offices.length === 0) {
    if (requestedOffice !== undefined && requestedOffice.trim().length > 0) {
      return { ok: false, reason: "invalid_office" };
    }
    return { ok: true, officeLabel: null };
  }

  const progress = buildOfficeProgress(roomType, rounds);

  if (requestedOffice !== undefined) {
    const normalized = requestedOffice.trim();
    const target = progress.find((item) => item.officeLabel === normalized);
    if (!target) {
      return { ok: false, reason: "invalid_office" };
    }
    if (target.status === "elected") {
      return { ok: false, reason: "winner_already_elected" };
    }
    return { ok: true, officeLabel: target.officeLabel };
  }

  // Continue the latest closed office if it has not elected a winner yet.
  const latestClosed = [...rounds]
    .filter((round) => round.status === "closed" && round.officeLabel !== null)
    .sort((a, b) => b.number - a.number)[0];

  if (latestClosed?.officeLabel) {
    const latestProgress = progress.find((item) => item.officeLabel === latestClosed.officeLabel);
    if (latestProgress && latestProgress.status !== "elected") {
      return { ok: true, officeLabel: latestProgress.officeLabel };
    }
  }

  const nextPending = progress.find((item) => item.status !== "elected");
  if (!nextPending) {
    return { ok: false, reason: "all_offices_elected" };
  }

  return { ok: true, officeLabel: nextPending.officeLabel };
}

export function getElectedCandidateIds(
  roomType: RoomType,
  rounds: readonly OfficeRoundSnapshot[],
): string[] {
  return buildOfficeProgress(roomType, rounds)
    .filter((item) => item.status === "elected" && item.winnerCandidateId !== null)
    .map((item) => item.winnerCandidateId as string);
}

export function countOfficeRoundNumber(
  rounds: readonly { number: number; officeLabel: string | null }[],
  targetRound: { number: number; officeLabel: string | null },
): number {
  if (targetRound.officeLabel === null) {
    return targetRound.number;
  }

  const count = rounds.filter(
    (round) =>
      round.officeLabel === targetRound.officeLabel && round.number <= targetRound.number,
  ).length;
  return count > 0 ? count : 1;
}
