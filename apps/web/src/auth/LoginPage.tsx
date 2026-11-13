import { useState, type FormEvent } from "react";
import { z } from "zod";
import { validateWithZod, type FieldErrors } from "../forms/validation";
import { AuthRequestError, login } from "./auth-api";
import { authErrorMessage } from "./copy";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Informe seu e-mail.").email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe sua senha."),
});

type LoginField = "email" | "password";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<LoginField>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const validation = validateWithZod(loginSchema, { email, password });
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      setErrorMessage(validation.firstError);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const user = await login(validation.data.email, validation.data.password);
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
      <form className="stack-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label>
            E-mail
            <input
              type="text"
              inputMode="email"
              autoComplete="username"
              value={email}
              aria-invalid={Boolean(fieldErrors.email)}
              onChange={(event) => {
                setEmail(event.target.value);
                setFieldErrors((current) => ({ ...current, email: undefined }));
              }}
            />
          </label>
          {fieldErrors.email ? <span className="field-error">{fieldErrors.email}</span> : null}
        </div>
        <div className="field">
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              aria-invalid={Boolean(fieldErrors.password)}
              onChange={(event) => {
                setPassword(event.target.value);
                setFieldErrors((current) => ({ ...current, password: undefined }));
              }}
            />
          </label>
          {fieldErrors.password ? <span className="field-error">{fieldErrors.password}</span> : null}
        </div>
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
