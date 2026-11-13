import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { apiUrl } from "../api-url";
import { validateWithZod, type FieldErrors } from "../forms/validation";
import {
  ballotErrorMessage,
  joinBlockedMessage,
  joinErrorMessage,
  voterRoundStateNotice,
  voterStandingLabel,
  voterTallyOutcome,
} from "./copy";
import {
  fetchBallotState,
  fetchJoinPreview,
  fetchVoteReceipt,
  submitBallot,
  submitJoin,
  type BallotState,
} from "./join-api";
import { createJoinKey, isJoinKey, readJoinIdentity, writeJoinIdentity } from "./join-identity";

const BALLOT_POLL_MS = 1000;
const NULL_VOTE_CHOICE = "__NULL__";

const joinCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(
      z
        .string()
        .min(1, "Informe seu código de acesso.")
        .regex(/^[A-Z0-9]{6}$/, "O código deve ter 6 letras ou números."),
    ),
});

type Phase =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "blocked"; title: string; message: string }
  | { kind: "ready"; title: string; joinKey: string }
  | { kind: "joined"; title: string; joinKey: string; displayName: string };

type StoredIdentity = {
  joinKey: string;
  displayName: string;
  accessCode?: string;
};

export function JoinRoom({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<"code">>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setPhase({ kind: "loading" });
      setErrorMessage(null);
      setIsSubmitting(false);

      let preview;
      try {
        preview = await fetchJoinPreview(apiUrl(""), token);
      } catch (error) {
        if (!cancelled) {
          setPhase({ kind: "invalid", message: joinErrorMessage(error) });
        }
        return;
      }

      if (cancelled) {
        return;
      }

      if (!preview.canJoin) {
        setPhase({
          kind: "blocked",
          title: preview.title,
          message: joinBlockedMessage(preview.status),
        });
        return;
      }

      const stored = readStored(token);
      const joinKey = stored && isJoinKey(stored.joinKey) ? stored.joinKey : createJoinKey();
      const queryCode = readAccessCodeFromSearch(window.location.search);
      const candidateCode = queryCode || stored?.accessCode?.trim() || "";

      if (candidateCode.length === 0) {
        writeStored(token, { joinKey, displayName: "" });
        setPhase({ kind: "ready", title: preview.title, joinKey });
        return;
      }

      setCode(candidateCode);
      setIsSubmitting(true);
      try {
        const result = await submitJoin(apiUrl(""), token, {
          code: candidateCode,
          joinKey,
        });
        if (cancelled) {
          return;
        }
        writeStored(token, {
          joinKey,
          displayName: result.displayName,
          accessCode: candidateCode.toUpperCase(),
        });
        setPhase({
          kind: "joined",
          title: result.title,
          joinKey,
          displayName: result.displayName,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        writeStored(token, { joinKey, displayName: "" });
        setErrorMessage(joinErrorMessage(error));
        setPhase({ kind: "ready", title: preview.title, joinKey });
      } finally {
        if (!cancelled) {
          setIsSubmitting(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase.kind !== "ready" || isSubmitting) {
      return;
    }

    const validation = validateWithZod(joinCodeSchema, { code });
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      setErrorMessage(validation.firstError);
      return;
    }

    setFieldErrors({});
    const normalizedCode = validation.data.code;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await submitJoin(apiUrl(""), token, {
        code: normalizedCode,
        joinKey: phase.joinKey,
      });
      writeStored(token, {
        joinKey: phase.joinKey,
        displayName: result.displayName,
        accessCode: normalizedCode,
      });
      setPhase({
        kind: "joined",
        title: result.title,
        joinKey: phase.joinKey,
        displayName: result.displayName,
      });
    } catch (error) {
      setErrorMessage(joinErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (phase.kind === "loading") {
    return <p className="panel">Carregando…</p>;
  }

  if (phase.kind === "invalid") {
    return (
      <div className="join-page">
        <header className="page-intro">
          <h1>Convite</h1>
        </header>
        <section className="panel">
          <p className="form-error" role="alert">
            {phase.message}
          </p>
        </section>
      </div>
    );
  }

  if (phase.kind === "blocked") {
    return (
      <div className="join-page">
        <header className="page-intro">
          <h1>{phase.title}</h1>
        </header>
        <section className="panel">
          <p className="form-error" role="alert">
            {phase.message}
          </p>
        </section>
      </div>
    );
  }

  if (phase.kind === "joined") {
    return (
      <JoinedRoomView
        token={token}
        title={phase.title}
        joinKey={phase.joinKey}
        displayName={phase.displayName}
      />
    );
  }

  return (
    <div className="join-page">
      <header className="page-intro">
        <h1>Entrar na sala</h1>
        <p className="lede">{phase.title}</p>
      </header>
      <section className="panel" aria-labelledby="join-room-heading">
        <h2 id="join-room-heading" className="sr-only">
          Identidade
        </h2>
        <form className="stack-form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label>
              Código de acesso
              <input
                value={code}
                aria-invalid={Boolean(fieldErrors.code)}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase());
                  setFieldErrors((current) => ({ ...current, code: undefined }));
                }}
                placeholder="Ex.: A7K9M2"
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="one-time-code"
              />
            </label>
            {fieldErrors.code ? <span className="field-error">{fieldErrors.code}</span> : null}
          </div>
          {errorMessage ? (
            <p className="form-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <button type="submit" disabled={isSubmitting}>
            Entrar na sala
          </button>
        </form>
      </section>
    </div>
  );
}

function JoinedRoomView({
  token,
  title,
  joinKey,
  displayName,
}: {
  token: string;
  title: string;
  joinKey: string;
  displayName: string;
}) {
  const [ballotState, setBallotState] = useState<BallotState | null>(null);
  const [votedRoundIds, setVotedRoundIds] = useState<Record<string, boolean>>({});
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [voteError, setVoteError] = useState<string | null>(null);
  const [isVoting, setIsVoting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const checkedRoundKeys = new Set<string>();

    async function poll() {
      const next = await fetchBallotState(apiUrl(""), token);
      if (cancelled || !next) {
        return;
      }
      setBallotState(next);

      if (next.round?.status === "open") {
        const key = roundInstanceKey(next.round.id, next.round.restartCount);
        if (!checkedRoundKeys.has(key)) {
          checkedRoundKeys.add(key);
          const receipt = await fetchVoteReceipt(apiUrl(""), token, joinKey);
          if (!cancelled && receipt?.roundId === next.round.id && receipt.hasVoted) {
            setVotedRoundIds((current) => (current[key] ? current : { ...current, [key]: true }));
          }
        }
      }
    }

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, BALLOT_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, joinKey]);

  const round = ballotState?.round ?? null;
  const candidates = ballotState?.candidates ?? [];
  const currentRoundKey = round ? roundInstanceKey(round.id, round.restartCount) : null;
  const hasVotedInCurrentRound = Boolean(currentRoundKey && votedRoundIds[currentRoundKey]);
  const activeSelectedCandidateId =
    selectedCandidateId === NULL_VOTE_CHOICE ||
    candidates.some((candidate) => candidate.id === selectedCandidateId)
      ? selectedCandidateId
      : "";

  async function handleCastVote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!round || round.status !== "open" || isVoting) {
      return;
    }
    if (!activeSelectedCandidateId) {
      setVoteError("Escolha um candidato ou Voto Nulo / Em Branco.");
      return;
    }

    setIsVoting(true);
    setVoteError(null);
    try {
      const receipt = await submitBallot(apiUrl(""), token, {
        joinKey,
        candidateId:
          activeSelectedCandidateId === NULL_VOTE_CHOICE ? null : activeSelectedCandidateId,
      });
      setSelectedCandidateId("");
      const key = roundInstanceKey(receipt.roundId, round.restartCount);
      setVotedRoundIds((current) => ({ ...current, [key]: true }));
    } catch (error) {
      const message = ballotErrorMessage(error);
      setVoteError(message);
    } finally {
      setIsVoting(false);
    }
  }

  return (
    <div className="join-page">
      <header className="page-intro">
        <h1>Você entrou</h1>
        <p className="lede">{title}</p>
        <p className="meta">Votante: <strong>{displayName}</strong></p>
      </header>
      <section className="panel">
        <p>Sua presença foi registrada.</p>
      </section>

      {round?.status === "open" && candidates.length > 0 ? (
        <section className="panel" aria-label="Cédula">
          <h2>
            {round.officeLabel
              ? `${round.officeLabel} — ${round.officeRoundNumber ?? round.number}º escrutínio`
              : `${round.number}º escrutínio`}
          </h2>
          <p className="round-notice" aria-live="polite">
            {voterRoundStateNotice(round.status, round.restartCount)}
          </p>
          {hasVotedInCurrentRound ? (
            <p role="status">Comprovante: seu voto foi registrado com sigilo neste escrutínio.</p>
          ) : (
            <form className="stack-form" onSubmit={handleCastVote}>
              <fieldset className="choice-field">
                <legend>Candidatos</legend>
                <div className="choice-row">
                  {candidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      className={
                        activeSelectedCandidateId === candidate.id ? "choice selected" : "choice"
                      }
                      aria-pressed={activeSelectedCandidateId === candidate.id}
                      onClick={() => setSelectedCandidateId(candidate.id)}
                    >
                      {candidate.displayName}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={
                      activeSelectedCandidateId === NULL_VOTE_CHOICE ? "choice selected" : "choice"
                    }
                    aria-pressed={activeSelectedCandidateId === NULL_VOTE_CHOICE}
                    onClick={() => setSelectedCandidateId(NULL_VOTE_CHOICE)}
                  >
                    Voto Nulo / Em Branco
                  </button>
                </div>
              </fieldset>
              {voteError ? (
                <p className="form-error" role="alert">
                  {voteError}
                </p>
              ) : null}
              <button type="submit" disabled={isVoting}>
                Confirmar voto
              </button>
            </form>
          )}
        </section>
      ) : null}

      {round?.status === "closed" && round.tally ? (
        <section className="panel" aria-label="Resultado do escrutínio">
          <h2>
            {round.officeLabel
              ? `Resultado — ${round.officeLabel} (${round.officeRoundNumber ?? round.number}º escrutínio)`
              : `Resultado — ${round.number}º escrutínio`}
          </h2>
          <p className="round-notice" aria-live="polite">
            {voterRoundStateNotice(round.status, round.restartCount)}
          </p>
          <p role="status">
            {voterTallyOutcome(round.tally.outcome, round.tally.winnerName)}
          </p>
          <ul aria-label="Apuração">
            {round.tally.standings.map((item) => (
              <li key={item.candidateId}>
                {voterStandingLabel(item.displayName, item.votes)}
              </li>
            ))}
            {(round.tally.nullVotes ?? 0) > 0 ? (
              <li>{voterStandingLabel("Votos Nulos / Em Branco", round.tally.nullVotes ?? 0)}</li>
            ) : null}
          </ul>
        </section>
      ) : null}
      {ballotState?.offices && ballotState.offices.length > 0 ? (
        <section className="panel" aria-label="Cargos da diretoria">
          <h2>Cargos da Diretoria</h2>
          <ol className="office-progress-list">
            {ballotState.offices.map((office) => (
              <li key={office.officeLabel} className={`office-progress-item ${office.status}`}>
                <strong>
                  {office.order}. {office.officeLabel}
                </strong>
                <span>
                  {office.status === "elected"
                    ? `Eleito: ${office.winnerName ?? "Confirmado"}`
                    : office.status === "open"
                      ? "Em votação"
                      : office.status === "in_progress"
                        ? "Em andamento"
                        : "Aguardando"}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function readAccessCodeFromSearch(search: string): string {
  try {
    const params = new URLSearchParams(search);
    return (params.get("code") ?? "").trim().toUpperCase();
  } catch {
    return "";
  }
}

function roundInstanceKey(roundId: string, restartCount?: number): string {
  return `${roundId}:${restartCount ?? 0}`;
}

function readStored(token: string): StoredIdentity | null {
  try {
    return readJoinIdentity(window.localStorage, token);
  } catch {
    return null;
  }
}

function writeStored(token: string, identity: StoredIdentity) {
  try {
    writeJoinIdentity(window.localStorage, token, identity);
  } catch {
    // Private mode can block storage. The key kept in memory still covers this visit.
  }
}
