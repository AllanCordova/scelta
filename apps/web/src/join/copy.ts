export function joinBlockedMessage(status: string): string {
  switch (status) {
    case "draft":
      return "Esta sala ainda não está aberta.";
    case "closed":
      return "Esta sala foi encerrada.";
    default:
      return "Não é possível entrar nesta sala.";
  }
}

export function joinErrorMessage(error: unknown): string {
  if (isJoinError(error)) {
    if (error.errorCode === "invite_not_found" || error.status === 404) {
      return "Convite inválido ou expirado.";
    }
    if (error.errorCode === "room_not_joinable") {
      return joinBlockedMessage(error.roomStatus ?? "");
    }
    if (error.errorCode === "invalid_access_code") {
      return "Código de acesso inválido ou revogado. Confira o código no seu cartão.";
    }
    if (error.errorCode === "revoked_access_code") {
      return "Código de acesso inválido ou revogado. Confira o código no seu cartão.";
    }
    if (error.errorCode === "invalid_join") {
      return "Código inválido. Digite os 6 caracteres do seu cartão.";
    }
    if (error.errorCode === "entry_closed") {
      return "A entrada nesta sala foi encerrada pela mesa.";
    }
    if (error.errorCode === "room_capacity_reached") {
      return "O limite de participantes desta sala foi atingido.";
    }
    if (error.errorCode === "birth_date_mismatch") {
      return "Dia ou mês de nascimento não conferem.";
    }
    if (
      error.errorCode === "birth_date_required" ||
      error.errorCode === "invalid_birth_day_month"
    ) {
      return "Informe o dia (1 a 31) e o mês (1 a 12) de nascimento.";
    }
    if (error.errorCode === "roster_name_already_claimed") {
      return "Este nome já foi reivindicado. A mesa foi avisada; procure a mesa.";
    }
    if (error.errorCode === "voter_on_paper") {
      return "Este eleitor está marcado para votar em papel. Procure a mesa.";
    }
    if (error.errorCode === "approval_entry_required") {
      return "Esta sala usa aprovação da mesa. Busque seu nome no rol para pedir entrada.";
    }
    if (error.errorCode === "search_query_too_short") {
      return "Digite pelo menos 2 letras para buscar seu nome no rol.";
    }
    if (error.errorCode === "forbidden_entry_request") {
      return "Este pedido pertence a outro dispositivo ou sessão.";
    }
  }

  return "Não foi possível entrar na sala. Tente de novo.";
}

export function ballotErrorMessage(error: unknown): string {
  if (isJoinError(error)) {
    switch (error.errorCode) {
      case "already_voted":
        return "Você já votou neste escrutínio.";
      case "round_not_open":
        return "Este escrutínio não está aberto.";
      case "participant_not_present":
        return "Confirme sua presença antes de votar.";
      case "access_code_revoked":
        return "Seu código de acesso foi revogado pelo administrador.";
      case "invalid_candidate":
        return "Escolha um candidato válido.";
      case "too_many_marks":
        return "Você selecionou mais candidatos do que o número de vagas.";
      case "duplicate_candidate_mark":
        return "Não é permitido marcar o mesmo candidato mais de uma vez.";
      default:
        break;
    }
  }

  return "Não foi possível registrar seu voto.";
}

export function voterTallyOutcome(
  outcome: "elected" | "no_majority",
  winnerName: string | null,
  winnerCount = 1,
): string {
  if (outcome === "elected" && winnerName) {
    return winnerCount > 1
      ? `Eleitos por maioria absoluta: ${winnerName}`
      : `Eleito por maioria absoluta: ${winnerName}`;
  }
  return "Sem maioria absoluta neste escrutínio.";
}

export function voterStandingLabel(displayName: string, votes: number): string {
  return `${displayName}: ${votes === 1 ? "1 voto" : `${votes} votos`}`;
}

export function isJoinableRoomStatus(status: string): boolean {
  return status === "open" || status === "test";
}

export function voterSessionMessage(access: "absent" | "revoked" | "missing"): string {
  switch (access) {
    case "absent":
      return "Você foi removido da sala. Seu código continua válido — entre novamente quando a mesa liberar.";
    case "revoked":
      return "Seu código de acesso foi revogado. Peça um código novo, só para você.";
    case "missing":
      return "Sua entrada não vale mais nesta sala. Entre de novo com o seu código.";
  }
}

export function voterRoundStateNotice(status: string, restartCount?: number): string {
  if (status === "open") {
    if ((restartCount ?? 0) > 0) {
      return "Escrutínio reiniciado — os votos anteriores foram limpos. Vote novamente.";
    }
    return "Escrutínio aberto para votação.";
  }
  return "Escrutínio encerrado.";
}

function isJoinError(
  error: unknown,
): error is { status: number; errorCode: string; roomStatus?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "errorCode" in error &&
    typeof error.status === "number" &&
    typeof error.errorCode === "string"
  );
}
