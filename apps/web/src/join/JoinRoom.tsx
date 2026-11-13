import { useEffect, useState, type FormEvent } from "react";
import { apiUrl } from "../api-url";
import { joinBlockedMessage, joinErrorMessage } from "./copy";
import { fetchJoinPreview, submitJoin } from "./join-api";
import { createJoinKey, isJoinKey, readJoinIdentity, writeJoinIdentity } from "./join-identity";

type Phase =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "blocked"; title: string; message: string }
  | { kind: "ready"; title: string; joinKey: string }
  | { kind: "joined"; title: string };

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
        setPhase({ kind: "joined", title: result.title });
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
      setPhase({ kind: "joined", title: result.title });
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
      <div className="join-page">
        <header className="page-intro">
          <h1>Você entrou</h1>
          <p className="lede">{phase.title}</p>
        </header>
        <section className="panel">
          <p>Sua presença foi registrada.</p>
        </section>
      </div>
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
