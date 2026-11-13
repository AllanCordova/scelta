import type { FieldError, RoomStatus, RoomType, RulesPreset } from "./types";

export const ROOM_TYPE_OPTIONS: { value: RoomType; label: string }[] = [
  { value: "pastor", label: "Pastor" },
  { value: "elder", label: "Presbítero" },
  { value: "deacon", label: "Diácono" },
  { value: "upa_board", label: "Diretoria UPA" },
  { value: "custom", label: "Outro" },
];

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
};

const FIELD_MESSAGES: Record<FieldError["field"], string> = {
  title: "Informe um título.",
  roomType: "Escolha o tipo da sala.",
  rulesPreset: "Escolha o conjunto de regras.",
  quorumValue: "Quórum inválido.",
  quorumUnit: "Informe a unidade do quórum.",
  status: "Situação inválida.",
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
