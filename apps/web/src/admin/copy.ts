import type {
  FieldError,
  RoomEntryMode,
  RoomStatus,
  RoomType,
  RoundTally,
  RulesPreset,
} from "./types";

export const ENTRY_MODE_OPTIONS: { value: RoomEntryMode; label: string; hint: string }[] = [
  {
    value: "codigo",
    label: "Cartão com código",
    hint: "Cada eleitor entra com seu código pessoal do cartão impresso ou link individual.",
  },
  {
    value: "aprovacao",
    label: "Aprovação da mesa",
    hint: "Os eleitores escaneiam o QR ou digitam o código da sala, buscam seu nome no rol e aguardam aprovação da mesa.",
  },
];

export const ENTRY_MODE_LABELS: Record<RoomEntryMode, string> = {
  codigo: "Cartão com código",
  aprovacao: "Aprovação da mesa",
};

export const ROOM_TYPE_OPTIONS: { value: RoomType; label: string }[] = [
  { value: "pastor", label: "Pastor" },
  { value: "elder", label: "Presbítero" },
  { value: "deacon", label: "Diácono" },
  { value: "session_board", label: "Mesa do Conselho" },
  { value: "upa_board", label: "Diretoria UPA" },
  { value: "ump_board", label: "Diretoria UMP" },
  { value: "custom", label: "Outro" },
];

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  pastor: "Pastor",
  elder: "Presbítero",
  deacon: "Diácono",
  session_board: "Mesa do Conselho",
  upa_board: "Diretoria UPA",
  ump_board: "Diretoria UMP",
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
  test: "Teste",
  closed: "Completa",
};

export function showsPresence(status: RoomStatus): boolean {
  return status === "open" || status === "test";
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
export const DECLINE_ROUND_LABEL = "Negado";
export const ROUND_RESTARTED_MESSAGE =
  "Escrutínio reiniciado — os votos anteriores foram limpos.";
export const ROUND_DECLINED_MESSAGE =
  "Cargo recusado pelo candidato eleito. Abra o escrutínio para reiniciar sem esse candidato.";
export const FAILED_QUORUM_MESSAGE =
  "Quórum não atingido. O escrutínio foi encerrado sem eleger ninguém.";

export function tallySummaryLabel(tally: RoundTally): string {
  if (tally.outcome === "elected" && tally.winnerName) {
    if (tally.tieBreakReason === "age") {
      return `Eleito por critério de desempate (mais velho): ${tally.winnerName}`;
    }
    if (tally.tieBreakReason === "admin_tiebreak") {
      return `Eleito por desempate de idade (decisão da mesa): ${tally.winnerName}`;
    }
    const winnerNames = tally.winnerNames ?? [];
    if (winnerNames.length > 1) {
      return `Eleitos por maioria absoluta: ${winnerNames.join(", ")}`;
    }
    return `Eleito por maioria absoluta: ${tally.winnerName}`;
  }
  if (tally.tieBreakRequired) {
    return "Empate no 3º escrutínio — aguardando desempate pelo mais velho (decisão da mesa).";
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
  candidates: "Cadastre ou importe ao menos um membro comungante antes de criar a sala.",
  entryMode: "Modo de entrada inválido.",
  entryOpen: "Configuração de abertura da entrada inválida.",
  maxParticipants: "Informe um limite válido de participantes (entre 1 e 100.000).",
  vacancies: "Informe um número de vagas válido (entre 1 e 50).",
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
    case "no_eligible_candidates":
      return "Não há mais candidatos elegíveis para este cargo.";
    case "round_not_closed":
      return "Encerre o escrutínio antes de registrar recusa.";
    case "room_not_found":
    case "round_not_found":
      return "Não encontrei essa sala ou escrutínio.";
    case "room_not_open":
      return "Abra a sala antes do escrutínio.";
    case "quorum_not_met":
      return "Quórum mínimo não atingido para abrir o escrutínio.";
    case "round_already_open":
      return "Já existe um escrutínio aberto.";
    case "round_not_open":
      return "Esse escrutínio não está aberto.";
    case "winner_already_elected":
      return "Este cargo ou sala já elegeu um vencedor.";
    case "all_offices_elected":
      return "Todos os cargos da diretoria já foram eleitos.";
    case "invalid_office":
      return "Cargo inválido para este tipo de sala.";
    case "voting_incomplete":
      return "Todos os membros presentes precisam votar antes de encerrar o escrutínio.";
    case "vote_count_mismatch":
      return "Há mais votos registrados do que membros presentes. Reinicie o escrutínio.";
    case "invalid_candidate_subset":
      return "Conjunto de candidatos inválido para o próximo escrutínio.";
    case "max_rounds_reached":
      return "Limite máximo de 3 escrutínios atingido. O desempate deve ser decidido pelo critério de idade (mais velho).";
    case "tie_break_not_required":
      return "Este escrutínio não aguarda desempate manual.";
    case "invalid_tie_break_candidate":
      return "Candidato inválido para o desempate.";
    case "simulation_requires_test_room":
      return "A ferramenta de simulação de entrada e votos só é permitida em salas com status Teste.";
    case "cannot_open_test_room":
      return "Salas com entradas ou votos simulados não podem ser mudadas para Aberta.";
    case "logs_are_immutable":
      return "Os logs de integridade são inapagáveis e não podem ser alterados.";
    case "room_closed":
      return "Esta sala já foi encerrada e não aceita alterações.";
    case "room_capacity_reached":
      return "O limite de participantes da sala foi atingido.";
    case "entry_closed":
      return "A entrada nesta sala está encerrada.";
    case "vacancies_locked_after_round":
      return "Não é possível alterar o número de vagas após iniciar um escrutínio.";
    case "paper_marks_exceed_ballots":
      return "O total de marcações excede o limite permitido pelas cédulas de papel.";
    default:
      return "Não foi possível atualizar o escrutínio.";
  }
}
