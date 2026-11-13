import { useEffect, useState, type FormEvent } from "react";
import { apiUrl } from "../api-url";
import {
  ballotErrorMessage,
  joinBlockedMessage,
  joinErrorMessage,
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

type Phase =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "blocked"; title: string; message: string }
  | { kind: "ready"; title: string; joinKey: string }
  | { kind: "joined"; title: string; joinKey: string };

type StoredIdentity = {
  joinKey: string;
  displayName: string;
};

export function JoinRoom({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [name, setName] = useState("");
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
      const storedName = stored?.displayName.trim() ?? "";
      writeStored(token, { joinKey, displayName: storedName });

      if (storedName.length === 0) {
        setPhase({ kind: "ready", title: preview.title, joinKey });
        return;
      }

      setName(storedName);
      setIsSubmitting(true);
      try {
        const result = await submitJoin(apiUrl(""), token, {
          displayName: storedName,
          joinKey,
        });
        if (cancelled) {
          return;
        }
        writeStored(token, { joinKey, displayName: result.displayName });
        setPhase({ kind: "joined", title: result.title, joinKey });
      } catch (error) {
        if (cancelled) {
          return;
        }
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

    const displayName = name.trim();
    if (displayName.length === 0) {
      setErrorMessage("Informe seu nome.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await submitJoin(apiUrl(""), token, {
        displayName,
        joinKey: phase.joinKey,
      });
      writeStored(token, { joinKey: phase.joinKey, displayName: result.displayName });
      setPhase({ kind: "joined", title: result.title, joinKey: phase.joinKey });
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
    return <JoinedRoomView token={token} title={phase.title} joinKey={phase.joinKey} />;
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
        <form className="stack-form" onSubmit={handleSubmit}>
          <label>
            Seu nome
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              maxLength={80}
              required
            />
          </label>
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
}: {
  token: string;
  title: string;
  joinKey: string;
}) {
  const [ballotState, setBallotState] = useState<BallotState | null>(null);
  const [votedRoundIds, setVotedRoundIds] = useState<Record<string, boolean>>({});
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [voteError, setVoteError] = useState<string | null>(null);
  const [isVoting, setIsVoting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const checkedRoundIds = new Set<string>();

    async function poll() {
      const next = await fetchBallotState(apiUrl(""), token);
      if (cancelled || !next) {
        return;
      }
      setBallotState(next);

      if (next.round?.status === "open" && !checkedRoundIds.has(next.round.id)) {
        checkedRoundIds.add(next.round.id);
        const receipt = await fetchVoteReceipt(apiUrl(""), token, joinKey);
        if (!cancelled && receipt?.roundId && receipt.hasVoted) {
          const roundId = receipt.roundId;
          setVotedRoundIds((current) =>
            current[roundId] ? current : { ...current, [roundId]: true },
          );
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
  const hasVotedInCurrentRound = Boolean(round && votedRoundIds[round.id]);
  const activeSelectedCandidateId = candidates.some(
    (candidate) => candidate.id === selectedCandidateId,
  )
    ? selectedCandidateId
    : "";

  async function handleCastVote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!round || round.status !== "open" || isVoting) {
      return;
    }
    if (!activeSelectedCandidateId) {
      setVoteError("Escolha um candidato.");
      return;
    }

    setIsVoting(true);
    setVoteError(null);
    try {
      const receipt = await submitBallot(apiUrl(""), token, {
        joinKey,
        candidateId: activeSelectedCandidateId,
      });
      setSelectedCandidateId("");
      setVotedRoundIds((current) => ({ ...current, [receipt.roundId]: true }));
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
      </header>
      <section className="panel">
        <p>Sua presença foi registrada.</p>
      </section>

      {round?.status === "open" && candidates.length > 0 ? (
        <section className="panel" aria-label="Cédula">
          <h2>{`${round.number}º escrutínio`}</h2>
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
          <h2>{`Resultado — ${round.number}º escrutínio`}</h2>
          <p role="status">
            {voterTallyOutcome(round.tally.outcome, round.tally.winnerName)}
          </p>
          <ul aria-label="Apuração">
            {round.tally.standings.map((item) => (
              <li key={item.candidateId}>
                {voterStandingLabel(item.displayName, item.votes)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
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
