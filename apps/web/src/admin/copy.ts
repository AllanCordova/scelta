import type { FieldError, RoomStatus, RoomType, RoundTally, RulesPreset } from "./types";

export const ROOM_TYPE_OPTIONS: { value: RoomType; label: string }[] = [
  { value: "pastor", label: "Pastor" },
  { value: "elder", label: "Presbítero" },
  { value: "deacon", label: "Diácono" },
  { value: "upa_board", label: "Diretoria UPA" },
  { value: "custom", label: "Outro" },
];

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  pastor: "Pastor",
  elder: "Presbítero",
  deacon: "Diácono",
  upa_board: "Diretoria UPA",
  custom: "Sessão Geral",
};

export const PRESET_OPTIONS: { value: RulesPreset; label: string }[] = [
  { value: "ipb_local_officers", label: "Oficiais da igreja local" },
  { value: "ipb_society_board", label: "Diretoria de sociedade" },
  { value: "custom", label: "Personalizado" },
];

const ABSOLUTE_MAJORITY = "Mais de 50% dos votos.";

const MAJORITY_COPY: Record<string, string> = {
  absolute_majority: ABSOLUTE_MAJORITY,
};

const ROUND_COPY: Record<RulesPreset, string> = {
  ipb_local_officers: "Até dois escrutínios; depois, só os mais votados.",
  ipb_society_board: "Sem maioria em dois escrutínios, o terceiro fica com os dois mais votados.",
  custom: "Sem rodada automática.",
};

export function describePreset(preset: RulesPreset, majorityRule?: string): {
  majority: string;
  rounds: string;
} {
  return {
    majority: (majorityRule && MAJORITY_COPY[majorityRule]) || ABSOLUTE_MAJORITY,
    rounds: ROUND_COPY[preset],
  };
}

export const STATUS_LABELS: Record<RoomStatus, string> = {
  draft: "Rascunho",
  open: "Aberta",
  voting: "Em votação",
  closed: "Encerrada",
  cancelled: "Cancelada",
};

export function showsPresence(status: RoomStatus): boolean {
  return status === "open" || status === "voting";
}

export function quorumLabel(presentCount: number, requiredCount: number): string {
  return `${presentCount} / ${requiredCount}`;
}

export function quorumStateLabel(quorumMet: boolean): string {
  return quorumMet ? "Quórum atingido" : "Abaixo do quórum";
}

export const OPEN_ROUND_LABEL = "Abrir escrutínio";
export const CLOSE_ROUND_LABEL = "Encerrar escrutínio";
export const RESTART_ROUND_LABEL = "Reiniciar escrutínio";
export const ROUND_RESTARTED_MESSAGE =
  "Escrutínio reiniciado — os votos anteriores foram limpos.";
export const FAILED_QUORUM_MESSAGE =
  "Quórum não atingido. O escrutínio foi encerrado sem eleger ninguém.";

export function tallySummaryLabel(tally: RoundTally): string {
  if (tally.outcome === "elected" && tally.winnerName) {
    return `Eleito por maioria absoluta: ${tally.winnerName}`;
  }
  return "Sem maioria absoluta neste escrutínio.";
}

export function standingLabel(displayName: string, votes: number): string {
  return `${displayName}: ${votes === 1 ? "1 voto" : `${votes} votos`}`;
}

export function activeCandidatesLabel(roundNumber: number, names: readonly string[]): string {
  return `${roundNumber}º escrutínio — Candidatos: ${names.join(", ")}`;
}

export function memberImportSummaryLabel(
  createdCount: number,
  updatedCount: number,
  rejectedCount: number,
): string {
  return `Importação concluída: ${createdCount} criados, ${updatedCount} atualizados, ${rejectedCount} rejeitados.`;
}

const FIELD_MESSAGES: Record<FieldError["field"], string> = {
  title: "Informe um título.",
  roomType: "Escolha o tipo da sala.",
  rulesPreset: "Escolha o conjunto de regras.",
  quorumValue: "Quórum inválido.",
  quorumUnit: "Informe a unidade do quórum.",
  eligibleCount: "Número de aptos inválido.",
  status: "Situação inválida.",
  candidates: "Lista de candidatos inválida.",
};

export function roomErrorMessage(errorCode: string, field?: FieldError["field"]): string {
  if (field) {
    return FIELD_MESSAGES[field];
  }

  if (errorCode === "unauthorized") {
    return "Sua sessão expirou. Entre de novo.";
  }

  if (errorCode === "forbidden") {
    return "Esta área é só para administradores.";
  }

  if (errorCode === "persistence_unavailable") {
    return "A API está sem banco de dados.";
  }

  return "Não foi possível criar a sala.";
}

export function roundErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "unauthorized":
      return "Sua sessão expirou. Entre de novo.";
    case "forbidden":
      return "Esta área é só para administradores.";
    case "persistence_unavailable":
      return "A API está sem banco de dados.";
    case "room_not_found":
    case "round_not_found":
      return "Não encontrei essa sala ou escrutínio.";
    case "room_not_open":
      return "Abra a sala antes do escrutínio.";
    case "round_already_open":
      return "Já existe um escrutínio aberto.";
    case "round_not_open":
      return "Esse escrutínio não está aberto.";
    case "winner_already_elected":
      return "Esta sala já elegeu um vencedor.";
    case "invalid_candidate_subset":
      return "Conjunto de candidatos inválido para o próximo escrutínio.";
    default:
      return "Não foi possível atualizar o escrutínio.";
  }
}
