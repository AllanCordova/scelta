import { useState, type FormEvent } from "react";
import { z } from "zod";
import { validateWithZod, type FieldErrors } from "../forms/validation";
import { AuthRequestError, register } from "./auth-api";
import { authErrorMessage } from "./copy";

const registerSchema = z.object({
  name: z.string().trim().min(1, "Informe seu nome."),
  email: z.string().trim().min(1, "Informe seu e-mail.").email("Informe um e-mail válido."),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres."),
});

type RegisterField = "name" | "email" | "password";

export function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<RegisterField>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const validation = validateWithZod(registerSchema, { name, email, password });
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      setErrorMessage(validation.firstError);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      await register(validation.data.name, validation.data.email, validation.data.password);
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
      <form className="stack-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label>
            Nome
            <input
              autoComplete="name"
              value={name}
              aria-invalid={Boolean(fieldErrors.name)}
              onChange={(event) => {
                setName(event.target.value);
                setFieldErrors((current) => ({ ...current, name: undefined }));
              }}
            />
          </label>
          {fieldErrors.name ? <span className="field-error">{fieldErrors.name}</span> : null}
        </div>
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
              autoComplete="new-password"
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
          Criar conta
        </button>
      </form>
      <p className="auth-switch">
        Já tem conta? <a href="/entrar">Entrar</a>
      </p>
    </section>
  );
}
