export function joinBlockedMessage(status: string): string {
  switch (status) {
    case "draft":
      return "Esta sala ainda não está aberta.";
    case "closed":
      return "Esta sala foi encerrada.";
    case "cancelled":
      return "Esta sala foi cancelada.";
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
    if (error.errorCode === "invalid_join") {
      return "Não foi possível confirmar sua entrada. Verifique o nome e tente de novo.";
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
      case "invalid_candidate":
        return "Escolha um candidato válido.";
      default:
        break;
    }
  }

  return "Não foi possível registrar seu voto.";
}

export function voterTallyOutcome(outcome: "elected" | "no_majority", winnerName: string | null): string {
  if (outcome === "elected" && winnerName) {
    return `Eleito por maioria absoluta: ${winnerName}`;
  }
  return "Sem maioria absoluta neste escrutínio.";
}

export function voterStandingLabel(displayName: string, votes: number): string {
  return `${displayName}: ${votes === 1 ? "1 voto" : `${votes} votos`}`;
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
