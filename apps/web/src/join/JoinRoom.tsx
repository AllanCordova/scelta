import { useEffect, useState, type FormEvent } from "react";
import confetti from "canvas-confetti";
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
  const [candidateSearch, setCandidateSearch] = useState<string>("");
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
  const isElectedResult =
    round?.status === "closed" &&
    round.tally?.outcome === "elected" &&
    Boolean(round.tally.winnerName);

  useEffect(() => {
    if (!isElectedResult || !currentRoundKey || typeof window === "undefined") {
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;
    const colors = ["#10b981", "#34d399", "#4edea3", "#fbbf24", "#6ee7b7"];

    async function runLoop() {
      while (!cancelled) {
        try {
          const burst = confetti({
            particleCount: 55,
            spread: 70,
            origin: { y: 0.6 },
            colors,
          });
          if (burst) {
            await burst;
          }
        } catch {
          return;
        }
        if (cancelled) {
          return;
        }
        await new Promise<void>((resolve) => {
          timeoutId = window.setTimeout(resolve, 1000);
        });
      }
    }

    void runLoop();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      try {
        confetti.reset();
      } catch {
        // Canvas may be unavailable in headless test environments such as jsdom.
      }
    };
  }, [isElectedResult, currentRoundKey]);
  const hasVotedInCurrentRound = Boolean(currentRoundKey && votedRoundIds[currentRoundKey]);
  const activeSelectedCandidateId =
    selectedCandidateId === NULL_VOTE_CHOICE ||
    candidates.some((candidate) => candidate.id === selectedCandidateId)
      ? selectedCandidateId
      : "";

  const normalizedSearch = candidateSearch.trim().toLocaleLowerCase("pt-BR");
  const filteredCandidates = normalizedSearch
    ? candidates.filter((candidate) =>
        candidate.displayName.toLocaleLowerCase("pt-BR").includes(normalizedSearch),
      )
    : candidates;

  const selectedCandidateLabel =
    activeSelectedCandidateId === NULL_VOTE_CHOICE
      ? "Voto Nulo / Em Branco"
      : candidates.find((candidate) => candidate.id === activeSelectedCandidateId)?.displayName ??
        null;

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

  const roundHeading = round
    ? round.officeLabel
      ? `${round.officeLabel} — ${round.officeRoundNumber ?? round.number}º escrutínio`
      : `${round.number}º escrutínio`
    : "";

  const totalTallyVotes = round?.tally
    ? round.tally.standings.reduce((sum, item) => sum + item.votes, 0) +
      (round.tally.nullVotes ?? 0)
    : 0;
  const winnerStanding =
    round?.tally?.outcome === "elected" && round.tally.winnerName
      ? round.tally.standings.find((item) => item.displayName === round.tally?.winnerName) ??
        round.tally.standings[0] ??
        null
      : null;
  const winnerPercent =
    winnerStanding && totalTallyVotes > 0
      ? Math.round((winnerStanding.votes / totalTallyVotes) * 1000) / 10
      : 0;

  return (
    <div className="join-page voter-flow">
      <header className="voter-session-header panel">
        <div className="voter-session-meta">
          <div className="voter-live-pill">
            <span className="voter-live-dot" aria-hidden="true" />
            <span>Sessão conectada</span>
          </div>
          <h1>Você entrou</h1>
          <p className="lede">{title}</p>
          <p className="meta">
            Votante: <strong>{displayName}</strong>
          </p>
        </div>
        <div className="voter-avatar-placeholder" aria-hidden="true">
          {initialsFromName(displayName)}
        </div>
      </header>

      <section className="voter-presence-pill panel">
        <div className="voter-presence-check" aria-hidden="true">
          ✓
        </div>
        <div className="voter-presence-copy">
          <span className="voter-presence-kicker">Presença validada</span>
          <p>Sua presença foi registrada.</p>
        </div>
        <span className="voter-secret-badge">Voto Secreto</span>
      </section>

      {round?.status === "open" && candidates.length > 0 ? (
        <section className="voter-ballot-section" aria-label="Cédula">
          <div className="panel voter-scrutiny-brief">
            <div className="voter-scrutiny-top">
              <span className="voter-scrutiny-kicker">Cédula Eleitoral</span>
              <span className="voter-secret-badge">1 escolha permitida</span>
            </div>
            <div className="voter-scrutiny-main">
              <div className="voter-emblem-placeholder" aria-hidden="true">
                {round.officeLabel ? initialsFromName(round.officeLabel) : "SC"}
              </div>
              <div>
                <h2>{roundHeading}</h2>
                <p className="muted">
                  Selecione um candidato abaixo ou opte por Voto Nulo / Em Branco.
                </p>
              </div>
            </div>
            <p className="round-notice" aria-live="polite">
              {voterRoundStateNotice(round.status, round.restartCount)}
            </p>
          </div>

          {hasVotedInCurrentRound ? (
            <div className="panel voter-receipt-card">
              <div className="voter-receipt-icon" aria-hidden="true">
                ✓
              </div>
              <div>
                <h3>Voto registrado</h3>
                <p role="status">
                  Comprovante: seu voto foi registrado com sigilo neste escrutínio.
                </p>
              </div>
            </div>
          ) : (
            <form className="voter-ballot-form" onSubmit={handleCastVote}>
              <div className="voter-search-bar">
                <input
                  type="search"
                  value={candidateSearch}
                  onChange={(event) => setCandidateSearch(event.target.value)}
                  placeholder="Buscar candidato por nome..."
                  aria-label="Buscar candidato por nome"
                />
                <div className="voter-search-meta">
                  <span className="muted">
                    Mostrando {filteredCandidates.length} de {candidates.length}{" "}
                    {candidates.length === 1 ? "candidato" : "candidatos"}
                  </span>
                  {candidateSearch ? (
                    <button
                      type="button"
                      className="ghost voter-clear-search"
                      onClick={() => setCandidateSearch("")}
                    >
                      Limpar busca
                    </button>
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                aria-label="Voto Nulo / Em Branco"
                className={
                  activeSelectedCandidateId === NULL_VOTE_CHOICE
                    ? "choice voter-null-card selected"
                    : "choice voter-null-card"
                }
                aria-pressed={activeSelectedCandidateId === NULL_VOTE_CHOICE}
                onClick={() => setSelectedCandidateId(NULL_VOTE_CHOICE)}
              >
                <span className="voter-null-icon" aria-hidden="true">
                  ⊘
                </span>
                <span className="voter-null-copy">
                  <strong>Voto Nulo / Em Branco</strong>
                  <small>Nenhum dos candidatos da cédula</small>
                </span>
                <span className="voter-radio" aria-hidden="true" />
              </button>

              <fieldset className="choice-field voter-candidates-fieldset">
                <legend>Candidatos</legend>
                {filteredCandidates.length === 0 ? (
                  <p className="panel muted">
                    Nenhum candidato encontrado para &ldquo;{candidateSearch}&rdquo;.
                  </p>
                ) : (
                  <div className="voter-candidates-grid">
                    {filteredCandidates.map((candidate) => {
                      const isSelected = activeSelectedCandidateId === candidate.id;
                      return (
                        <button
                          key={candidate.id}
                          type="button"
                          aria-label={candidate.displayName}
                          className={
                            isSelected
                              ? "choice voter-candidate-card selected"
                              : "choice voter-candidate-card"
                          }
                          aria-pressed={isSelected}
                          onClick={() => setSelectedCandidateId(candidate.id)}
                        >
                          <span className="voter-candidate-top">
                            <span className="voter-candidate-avatar" aria-hidden="true">
                              {initialsFromName(candidate.displayName)}
                            </span>
                            <span className="voter-radio" aria-hidden="true" />
                          </span>
                          <span className="voter-candidate-name">{candidate.displayName}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </fieldset>

              {voteError ? (
                <p className="form-error" role="alert">
                  {voteError}
                </p>
              ) : null}

              <div className="panel voter-confirm-dock">
                <div className="voter-confirm-selection">
                  <span className="voter-confirm-label">Sua escolha</span>
                  <strong>{selectedCandidateLabel ?? "Nenhum candidato selecionado"}</strong>
                </div>
                <button type="submit" disabled={isVoting}>
                  Confirmar voto
                </button>
              </div>
            </form>
          )}
        </section>
      ) : null}

      {round?.status === "closed" && round.tally ? (
        <section className="voter-result-section" aria-label="Resultado do escrutínio">
          <div
            className={
              round.tally.outcome === "elected"
                ? "voter-result-banner elected"
                : "voter-result-banner"
            }
          >
            <span>Resultado do escrutínio</span>
            <strong>{round.tally.outcome === "elected" ? "100% Apurado" : "Encerrado"}</strong>
          </div>

          {round.tally.outcome === "elected" && round.tally.winnerName ? (
            <div className="panel voter-winner-hero">
              <div className="voter-winner-avatar-wrap">
                <div className="voter-winner-avatar" aria-hidden="true">
                  {initialsFromName(round.tally.winnerName)}
                </div>
                <span className="voter-winner-badge">Eleito</span>
              </div>
              <h2>{round.tally.winnerName}</h2>
              <p className="voter-winner-office">
                {round.officeLabel ? `${round.officeLabel} Eleito` : title}
              </p>
              <p className="round-notice" aria-live="polite">
                {voterRoundStateNotice(round.status, round.restartCount)}
              </p>
              <p className="voter-outcome-status" role="status">
                {voterTallyOutcome(round.tally.outcome, round.tally.winnerName)}
              </p>

              <div className="voter-majority-box">
                <div className="voter-majority-header">
                  <span>Maioria absoluta</span>
                  <strong>{winnerPercent}%</strong>
                </div>
                <div className="voter-majority-track" aria-hidden="true">
                  <div
                    className="voter-majority-fill"
                    style={{ width: `${Math.min(100, winnerPercent)}%` }}
                  />
                  <div className="voter-majority-threshold" />
                </div>
                <div className="voter-majority-footer">
                  <span>
                    Total de votos: <strong>{totalTallyVotes}</strong>
                  </span>
                  <span>Critério: 50% + 1</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="panel voter-non-elected-card">
              <h2>
                {round.officeLabel
                  ? `Resultado — ${round.officeLabel} (${round.officeRoundNumber ?? round.number}º escrutínio)`
                  : `Resultado — ${round.number}º escrutínio`}
              </h2>
              <p className="round-notice" aria-live="polite">
                {voterRoundStateNotice(round.status, round.restartCount)}
              </p>
              <p className="voter-outcome-status" role="status">
                {voterTallyOutcome(round.tally.outcome, round.tally.winnerName)}
              </p>
            </div>
          )}

          <div className="panel voter-standings-card">
            <div className="voter-standings-header">
              <h3>Apuração dos votos</h3>
              <span className="muted">
                {round.officeLabel
                  ? `${round.officeLabel} • ${round.officeRoundNumber ?? round.number}º escrutínio`
                  : `${round.number}º escrutínio`}
              </span>
            </div>
            <ul className="voter-standings-list" aria-label="Apuração">
              {round.tally.standings.map((item) => {
                const percent =
                  totalTallyVotes > 0 ? Math.round((item.votes / totalTallyVotes) * 100) : 0;
                const isWinner =
                  round.tally?.outcome === "elected" &&
                  round.tally.winnerName === item.displayName;
                return (
                  <li
                    key={item.candidateId}
                    className={isWinner ? "voter-standing-item winner" : "voter-standing-item"}
                  >
                    <div className="voter-standing-row">
                      <span>{voterStandingLabel(item.displayName, item.votes)}</span>
                      <span className="muted">{percent}%</span>
                    </div>
                    <div className="voter-standing-bar" aria-hidden="true">
                      <div
                        className="voter-standing-fill"
                        style={{ width: `${Math.min(100, percent)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
              {(round.tally.nullVotes ?? 0) > 0 ? (
                <li className="voter-standing-item">
                  <div className="voter-standing-row">
                    <span>
                      {voterStandingLabel("Votos Nulos / Em Branco", round.tally.nullVotes ?? 0)}
                    </span>
                    <span className="muted">
                      {totalTallyVotes > 0
                        ? `${Math.round(((round.tally.nullVotes ?? 0) / totalTallyVotes) * 100)}%`
                        : "0%"}
                    </span>
                  </div>
                </li>
              ) : null}
            </ul>
          </div>
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

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "SC";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
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
