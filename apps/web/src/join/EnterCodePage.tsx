import { useState, type FormEvent } from "react";
import { z } from "zod";
import { validateWithZod, type FieldErrors } from "../forms/validation";
import { normalizeRoomShortCode } from "./path";

const enterCodeSchema = z.object({
  shortCode: z
    .string()
    .transform((value) => normalizeRoomShortCode(value))
    .pipe(
      z
        .string()
        .min(1, "Informe o código da sala.")
        .regex(/^[A-Z0-9]{6}$/, "O código da sala deve ter 6 letras ou números."),
    ),
  accessCode: z
    .string()
    .transform((value) => normalizeRoomShortCode(value))
    .pipe(
      z
        .string()
        .min(1, "Informe seu código de acesso.")
        .regex(/^[A-Z0-9]{6}$/, "Seu código deve ter 6 letras ou números."),
    ),
});

type EnterCodeField = "shortCode" | "accessCode";

export type EnterCodePageProps = {
  onNavigate?: (path: string) => void;
};

/**
 * Public voter entry form accepting a room short code and personal access code.
 */
export function EnterCodePage({ onNavigate }: EnterCodePageProps) {
  const [shortCode, setShortCode] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<EnterCodeField>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const validation = validateWithZod(enterCodeSchema, { shortCode, accessCode });
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      setErrorMessage(validation.firstError);
      return;
    }

    setFieldErrors({});
    const targetUrl = `/s/${encodeURIComponent(validation.data.shortCode)}?c=${encodeURIComponent(validation.data.accessCode)}`;
    if (onNavigate) {
      onNavigate(targetUrl);
      return;
    }
    window.location.assign(targetUrl);
  }

  return (
    <section className="panel" aria-label="Entrar com código">
      <h1 style={{ fontSize: "1.35rem", marginBottom: "0.25rem" }}>Acessar votação</h1>
      <p className="lede" style={{ marginTop: 0, marginBottom: "1rem" }}>
        Entrar com código da sala e código pessoal do seu cartão.
      </p>
      <form className="stack-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label>
            Código da sala
            <input
              type="text"
              value={shortCode}
              aria-invalid={Boolean(fieldErrors.shortCode)}
              onChange={(event) => {
                setShortCode(event.target.value.toUpperCase());
                setFieldErrors((current) => ({ ...current, shortCode: undefined }));
              }}
              placeholder="Ex.: K7M2P9"
              maxLength={12}
              autoCapitalize="characters"
              autoComplete="off"
            />
          </label>
          {fieldErrors.shortCode ? (
            <span className="field-error">{fieldErrors.shortCode}</span>
          ) : null}
        </div>

        <div className="field">
          <label>
            Seu código
            <input
              type="text"
              value={accessCode}
              aria-invalid={Boolean(fieldErrors.accessCode)}
              onChange={(event) => {
                setAccessCode(event.target.value.toUpperCase());
                setFieldErrors((current) => ({ ...current, accessCode: undefined }));
              }}
              placeholder="Ex.: A7K9M2"
              maxLength={8}
              autoCapitalize="characters"
              autoComplete="one-time-code"
            />
          </label>
          {fieldErrors.accessCode ? (
            <span className="field-error">{fieldErrors.accessCode}</span>
          ) : null}
        </div>

        {errorMessage ? (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <button type="submit">Entrar na sala</button>
      </form>
    </section>
  );
}
