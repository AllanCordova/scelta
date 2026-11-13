import { useState, type FormEvent } from "react";
import { AuthRequestError, register } from "./auth-api";
import { authErrorMessage } from "./copy";

export function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await register(name, email, password);
      window.location.assign("/");
    } catch (error) {
      const code = error instanceof AuthRequestError ? error.errorCode : "unknown";
      setErrorMessage(authErrorMessage(code, "register"));
      setIsSubmitting(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="register-heading">
      <h2 id="register-heading">Criar conta</h2>
      <form className="stack-form" onSubmit={handleSubmit}>
        <label>
          Nome
          <input
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
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
            autoComplete="new-password"
            minLength={8}
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
          Criar conta
        </button>
      </form>
      <p className="auth-switch">
        Já tem conta? <a href="/entrar">Entrar</a>
      </p>
    </section>
  );
}
