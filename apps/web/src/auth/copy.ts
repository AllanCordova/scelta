export function authErrorMessage(errorCode: string): string {
  if (errorCode === "invalid_credentials") {
    return "E-mail ou senha inválidos.";
  }
  if (errorCode === "invalid_account") {
    return "Informe e-mail e senha.";
  }
  if (errorCode === "rate_limited") {
    return "Muitas tentativas. Espere alguns minutos.";
  }
  return "Não foi possível entrar.";
}
