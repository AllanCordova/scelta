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
