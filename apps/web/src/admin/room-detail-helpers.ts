import type { ShareBoardEntry } from "./ShareBoardPaper";
import { roundErrorMessage } from "./copy";
import { RoomRequestError } from "./rooms-api";
import type { RoomStatus } from "./types";

export type RoomDetailTab = "preparar" | "conduzir" | "resultado";

export type PendingConfirmKind =
  | "delete-room"
  | "close-room"
  | "remove-participants"
  | "close-pending-round"
  | "close-no-paper-ballots";

/**
 * Resolves the initial tab for a room detail screen from its current lifecycle state.
 */
export function resolveInitialRoomTab(input: {
  roomStatus: RoomStatus;
  roundStatus?: string | null;
}): RoomDetailTab {
  if (input.roomStatus === "draft") {
    return "preparar";
  }
  if (input.roomStatus === "closed" || input.roundStatus === "closed") {
    return "resultado";
  }
  return "conduzir";
}

export function buildShareBoardEntries(
  resolvedOffices: readonly {
    officeLabel: string;
    winnerName: string | null;
    winnerPhotoUrl: string | null;
  }[],
  roomTypeLabel: string,
  singleWinnerName: string | null,
  singleWinnerPhotoUrl: string | null,
  paperOrigin?: {
    officeLabel: string;
    originSummary: { total: number; online: number; paper: number };
  },
  electedCandidates: readonly { id: string; displayName: string; photoUrl?: string | null }[] = [],
): ShareBoardEntry[] {
  if (resolvedOffices.length > 0) {
    return resolvedOffices
      .filter((office) => Boolean(office.winnerName))
      .map((office) => ({
        officeLabel: office.officeLabel,
        winnerName: office.winnerName ?? "",
        winnerPhotoUrl: office.winnerPhotoUrl,
        ...(paperOrigin && paperOrigin.officeLabel === office.officeLabel
          ? { originSummary: paperOrigin.originSummary }
          : {}),
      }));
  }
  if (electedCandidates.length > 0) {
    return electedCandidates.map((candidate, index) => ({
      officeLabel: roomTypeLabel,
      winnerName: candidate.displayName,
      winnerPhotoUrl: candidate.photoUrl ?? null,
      ...(index === 0 && paperOrigin ? { originSummary: paperOrigin.originSummary } : {}),
    }));
  }
  if (singleWinnerName) {
    return [
      {
        officeLabel: roomTypeLabel,
        winnerName: singleWinnerName,
        winnerPhotoUrl: singleWinnerPhotoUrl,
        ...(paperOrigin ? { originSummary: paperOrigin.originSummary } : {}),
      },
    ];
  }
  return [];
}

export function candidateInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "CA";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

export function formatSessionDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatReceiptTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "agora";
  }
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatSyncTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function messageFromRoundError(error: unknown): string {
  if (error instanceof RoomRequestError) {
    return roundErrorMessage(error.errorCode);
  }
  return roundErrorMessage("unknown");
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  room_created: "Sala criada",
  quorum_changed: "Quórum alterado",
  room_status_changed: "Situação da sala alterada",
  round_opened: "Escrutínio iniciado",
  round_closed: "Escrutínio encerrado",
  round_restarted: "Escrutínio reiniciado",
  office_declined: "Cargo declinado",
  tie_break_resolved: "Desempate decidido pela mesa (mais velho)",
  result_published: "Resultado publicado",
  roster_member_added: "Membro adicionado ao rol",
  roster_member_removed: "Membro removido do rol",
  candidate_added: "Candidato adicionado",
  candidate_removed: "Candidato removido",
  roster_paper_mode_enabled: "Marcado para voto em papel",
  roster_paper_mode_disabled: "Retornado para voto online",
  paper_tally_recorded: "Totais da urna de papel lançados",
  entry_opened: "Entrada na sala reaberta",
  entry_closed: "Entrada na sala encerrada",
  entry_config_changed: "Configuração de entrada alterada",
  entry_request_created: "Pedido de entrada enviado",
  entry_request_approved: "Pedido de entrada aprovado pela mesa",
  entry_request_rejected: "Pedido de entrada recusado pela mesa",
  entry_request_disputed: "Tentativa em nome já reivindicado",
  roster_name_released: "Nome liberado pela mesa para nova entrada",
  participant_expelled_and_released: "Participante expulso e nome liberado",
  participant_expelled: "Participante expulso da sala",
  participant_session_released: "Sessão de participante liberada",
  live_candidate_tally_toggled: "Parcial por candidato no telão alterada",
  round_result_revealed: "Resultado revelado no telão",
};

export function formatAuditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
