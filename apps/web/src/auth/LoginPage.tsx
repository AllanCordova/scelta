import { useState, type FormEvent } from "react";
import { AuthRequestError, login } from "./auth-api";
import { authErrorMessage } from "./copy";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const user = await login(email, password);
      window.location.assign(user.role === "admin" ? "/admin" : "/");
    } catch (error) {
      const code = error instanceof AuthRequestError ? error.errorCode : "unknown";
      setErrorMessage(authErrorMessage(code, "login"));
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="login-heading">
      <h2 id="login-heading">Entrar</h2>
      <form className="stack-form" onSubmit={handleSubmit}>
        <label>
          E-mail
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {errorMessage ? (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <button type="submit" disabled={isSubmitting}>
          Entrar
        </button>
      </form>
      <p className="auth-switch">
        Não tem conta? <a href="/cadastrar">Criar conta</a>
      </p>
    </section>
  );
}
