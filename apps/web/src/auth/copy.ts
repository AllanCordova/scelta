export function authErrorMessage(errorCode: string, mode: "login" | "register"): string {
  if (errorCode === "invalid_credentials") {
    return "E-mail ou senha inválidos.";
  }
  if (errorCode === "email_taken") {
    return "Esse e-mail já está em uso.";
  }
  if (errorCode === "invalid_account") {
    return mode === "register"
      ? "Informe nome, e-mail e uma senha de pelo menos 8 caracteres."
      : "Informe e-mail e senha.";
  }
  if (errorCode === "rate_limited") {
    return "Muitas tentativas. Espere alguns minutos.";
  }
  return mode === "register" ? "Não foi possível criar a conta." : "Não foi possível entrar.";
}
