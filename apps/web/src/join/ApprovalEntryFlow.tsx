import { useEffect, useState, type FormEvent } from "react";
import { apiUrl } from "../api-url";
import {
  fetchEntryRequestStatus,
  searchJoinRoster,
  submitEntryRequest,
  type RosterSearchEntry,
} from "./join-api";
import { JoinRequestError, formatJoinErrorMessage } from "./join-error";
import { writeJoinIdentity, type StoredJoinIdentity } from "./join-identity";
import type { JoinRouteTarget } from "./path";

const REQUEST_STATUS_POLL_MS = 1500;
const SEARCH_DEBOUNCE_MS = 250;

export type ApprovalEntryFlowProps = {
  target: JoinRouteTarget;
  storageKey: string;
  title: string;
  joinKey: string;
  fallbackInviteToken?: string;
  initialPendingRequestId?: string;
  initialPendingDisplayName?: string;
  onApproved: (result: {
    title: string;
    joinKey: string;
    displayName: string;
    inviteToken: string;
  }) => void;
  onEntryClosed?: () => void;
};

/**
 * Multi-step voter entry flow for rooms configured with desk approval (`entryMode === "aprovacao"`).
 */
export function ApprovalEntryFlow({
  target,
  storageKey,
  title,
  joinKey,
  fallbackInviteToken,
  initialPendingRequestId,
  initialPendingDisplayName,
  onApproved,
  onEntryClosed,
}: ApprovalEntryFlowProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [entries, setEntries] = useState<RosterSearchEntry[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedEntry, setSelectedEntry] = useState<RosterSearchEntry | null>(null);
  const [birthDayInput, setBirthDayInput] = useState("");
  const [birthMonthInput, setBirthMonthInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [pendingRequest, setPendingRequest] = useState<{
    requestId: string;
    displayName: string;
  } | null>(
    initialPendingRequestId
      ? {
          requestId: initialPendingRequestId,
          displayName: initialPendingDisplayName ?? "",
        }
      : null,
  );
  const [rejectedMessage, setRejectedMessage] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  useEffect(() => {
    if (pendingRequest || selectedEntry) {
      return;
    }
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      void searchJoinRoster(apiUrl(""), target, trimmed)
        .then((result) => {
          if (!cancelled) {
            setEntries(result);
            setHasSearched(true);
            setSearchError(null);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSearchError(formatJoinErrorMessage(error));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsSearching(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, target, pendingRequest, selectedEntry]);

  useEffect(() => {
    if (!pendingRequest) {
      return;
    }

    let cancelled = false;

    async function checkStatus() {
      if (!pendingRequest) {
        return;
      }
      try {
        const res = await fetchEntryRequestStatus(
          apiUrl(""),
          target,
          pendingRequest.requestId,
          joinKey,
        );
        if (cancelled) {
          return;
        }
        if (res.status === "approved") {
          const inviteToken =
            res.inviteToken ??
            fallbackInviteToken ??
            (target.mode === "token" ? target.token : "");
          if (!inviteToken) {
            return;
          }
          const finalName = res.displayName || pendingRequest.displayName;
          const identity: StoredJoinIdentity = {
            joinKey,
            displayName: finalName,
            entryMode: "aprovacao",
            inviteToken,
          };
          saveIdentity(storageKey, identity);
          if (target.mode === "shortCode") {
            saveIdentity(inviteToken, identity);
          }
          onApproved({
            title: res.title || title,
            joinKey,
            displayName: finalName,
            inviteToken,
          });
          return;
        }
        if (res.status === "rejected") {
          saveIdentity(storageKey, { joinKey, displayName: "", entryMode: "aprovacao" });
          setPendingRequest(null);
          setSelectedEntry(null);
          setRejectedMessage(
            "Seu pedido de entrada foi recusado pela mesa. Procure a mesa ou tente novamente.",
          );
          return;
        }
        if (res.status === "cancelled") {
          saveIdentity(storageKey, { joinKey, displayName: "", entryMode: "aprovacao" });
          setPendingRequest(null);
          setSelectedEntry(null);
          setStatusNotice(
            "Seu pedido anterior foi cancelado pela mesa. Você pode buscar seu nome novamente.",
          );
        }
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        if (error instanceof JoinRequestError && (error.status === 403 || error.status === 404)) {
          saveIdentity(storageKey, { joinKey, displayName: "", entryMode: "aprovacao" });
          setPendingRequest(null);
          setSelectedEntry(null);
          setSubmitError(formatJoinErrorMessage(error));
        }
      }
    }

    void checkStatus();
    const timer = window.setInterval(() => {
      void checkStatus();
    }, REQUEST_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pendingRequest, target, joinKey, storageKey, fallbackInviteToken, title, onApproved]);

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchError("Digite pelo menos 2 letras para buscar seu nome no rol.");
      setEntries([]);
      setHasSearched(false);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    try {
      const result = await searchJoinRoster(apiUrl(""), target, trimmed);
      setEntries(result);
      setHasSearched(true);
    } catch (error) {
      setSearchError(formatJoinErrorMessage(error));
    } finally {
      setIsSearching(false);
    }
  }

  async function handleRequestEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEntry || isSubmitting) {
      return;
    }

    let birthDay: number | undefined;
    let birthMonth: number | undefined;

    if (selectedEntry.requiresBirthDate) {
      const dayRaw = birthDayInput.trim();
      const monthRaw = birthMonthInput.trim();
      if (!/^\d+$/.test(dayRaw) || !/^\d+$/.test(monthRaw)) {
        setSubmitError("Informe o dia (1 a 31) e o mês (1 a 12) de nascimento.");
        return;
      }
      birthDay = Number(dayRaw);
      birthMonth = Number(monthRaw);
      if (birthDay < 1 || birthDay > 31 || birthMonth < 1 || birthMonth > 12) {
        setSubmitError("Dia deve ser entre 1 e 31 e mês entre 1 e 12.");
        return;
      }
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setRejectedMessage(null);
    setStatusNotice(null);

    try {
      const result = await submitEntryRequest(apiUrl(""), target, {
        rosterEntryId: selectedEntry.rosterEntryId,
        joinKey,
        ...(birthDay !== undefined ? { birthDay } : {}),
        ...(birthMonth !== undefined ? { birthMonth } : {}),
      });

      const inviteToken =
        result.inviteToken ??
        fallbackInviteToken ??
        (target.mode === "token" ? target.token : "");

      if (result.status === "approved" && inviteToken) {
        const identity: StoredJoinIdentity = {
          joinKey,
          displayName: result.displayName,
          entryMode: "aprovacao",
          inviteToken,
        };
        saveIdentity(storageKey, identity);
        if (target.mode === "shortCode") {
          saveIdentity(inviteToken, identity);
        }
        onApproved({
          title,
          joinKey,
          displayName: result.displayName,
          inviteToken,
        });
        return;
      }

      if (result.requestId) {
        saveIdentity(storageKey, {
          joinKey,
          displayName: result.displayName,
          pendingRequestId: result.requestId,
          entryMode: "aprovacao",
        });
        setPendingRequest({
          requestId: result.requestId,
          displayName: result.displayName,
        });
      }
    } catch (error: unknown) {
      if (error instanceof JoinRequestError && error.errorCode === "entry_closed") {
        onEntryClosed?.();
        return;
      }
      setSubmitError(formatJoinErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (pendingRequest) {
    return (
      <div className="join-page">
        <header className="page-intro">
          <h1>Entrar na sala</h1>
          <p className="lede">{title}</p>
        </header>
        <section
          className="panel approval-pending-panel"
          aria-live="polite"
          data-testid="entry-request-pending"
        >
          <div className="voter-live-pill">
            <span className="voter-live-dot" aria-hidden="true" />
            <span>Pedido enviado</span>
          </div>
          <h2>Aguardando aprovação da mesa…</h2>
          {pendingRequest.displayName ? (
            <p className="lede">
              Nome selecionado: <strong>{pendingRequest.displayName}</strong>
            </p>
          ) : null}
          <p className="muted">
            Assim que a mesa confirmar sua entrada, a sala de votação será aberta automaticamente
            nesta tela.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="join-page">
      <header className="page-intro">
        <h1>Entrar na sala</h1>
        <p className="lede">{title}</p>
      </header>

      <section className="panel" aria-labelledby="approval-entry-heading">
        <h2 id="approval-entry-heading">Identificação no rol</h2>
        <p className="muted">
          Esta sala utiliza entrada por aprovação da mesa. Busque seu nome no rol e confirme seus
          dados.
        </p>

        {rejectedMessage ? (
          <p className="form-error" role="alert">
            {rejectedMessage}
          </p>
        ) : null}

        {statusNotice ? (
          <p className="field-hint" role="status">
            {statusNotice}
          </p>
        ) : null}

        {!selectedEntry ? (
          <>
            <form className="stack-form" onSubmit={(event) => void handleSearchSubmit(event)} noValidate>
              <div className="field">
                <label>
                  Buscar seu nome no rol
                  <div className="roster-search-row">
                    <input
                      type="search"
                      aria-label="Buscar seu nome no rol"
                      placeholder="Digite seu nome…"
                      value={searchQuery}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setSearchQuery(nextValue);
                        setSearchError(null);
                        if (nextValue.trim().length < 2) {
                          setEntries([]);
                          setHasSearched(false);
                        }
                      }}
                    />
                    <button type="submit" disabled={isSearching}>
                      Buscar
                    </button>
                  </div>
                </label>
              </div>
            </form>

            {searchError ? (
              <p className="form-error" role="alert">
                {searchError}
              </p>
            ) : null}

            {isSearching ? <p className="muted">Buscando no rol…</p> : null}

            {entries.length > 0 ? (
              <ul className="access-codes-list" aria-label="Resultados no rol">
                {entries.map((entry) => (
                  <li key={entry.rosterEntryId} className="access-code-row">
                    <div className="access-code-info">
                      <span className="access-code-name">{entry.fullName}</span>
                      {entry.requiresBirthDate ? (
                        <span className="muted">Confirmação por dia e mês de nascimento</span>
                      ) : null}
                    </div>
                    <div className="access-code-meta">
                      {entry.isClaimed ? (
                        <span className="access-code-badge revoked">Já reivindicado</span>
                      ) : null}
                      <button
                        type="button"
                        className="round-action"
                        onClick={() => {
                          setSelectedEntry(entry);
                          setBirthDayInput("");
                          setBirthMonthInput("");
                          setSubmitError(null);
                          setRejectedMessage(null);
                        }}
                      >
                        Selecionar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : hasSearched && !isSearching ? (
              <p className="muted">
                Nenhum nome encontrado para &ldquo;{searchQuery.trim()}&rdquo;. Procure a mesa se
                seu nome não estiver no rol.
              </p>
            ) : null}
          </>
        ) : (
          <form className="stack-form" onSubmit={(event) => void handleRequestEntry(event)} noValidate>
            <div className="approval-selected-card">
              <div>
                <span className="muted">Nome selecionado</span>
                <strong>{selectedEntry.fullName}</strong>
              </div>
              <button
                type="button"
                className="ghost round-action"
                disabled={isSubmitting}
                onClick={() => {
                  setSelectedEntry(null);
                  setSubmitError(null);
                }}
              >
                Escolher outro nome
              </button>
            </div>

            {selectedEntry.isClaimed ? (
              <p className="field-hint" role="status">
                Este nome já aparece como em uso. Se alguém entrou com o seu nome por engano,
                envie o pedido abaixo para alertar a mesa.
              </p>
            ) : null}

            {selectedEntry.requiresBirthDate ? (
              <div className="approval-birth-row">
                <div className="field">
                  <label>
                    Dia de nascimento
                    <input
                      type="number"
                      min={1}
                      max={31}
                      inputMode="numeric"
                      aria-label="Dia de nascimento"
                      placeholder="Ex.: 12"
                      value={birthDayInput}
                      onChange={(event) => {
                        setBirthDayInput(event.target.value);
                        setSubmitError(null);
                      }}
                    />
                  </label>
                </div>
                <div className="field">
                  <label>
                    Mês de nascimento
                    <input
                      type="number"
                      min={1}
                      max={12}
                      inputMode="numeric"
                      aria-label="Mês de nascimento"
                      placeholder="Ex.: 4"
                      value={birthMonthInput}
                      onChange={(event) => {
                        setBirthMonthInput(event.target.value);
                        setSubmitError(null);
                      }}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {submitError ? (
              <p className="form-error" role="alert">
                {submitError}
              </p>
            ) : null}

            <button type="submit" data-testid="request-entry-btn" disabled={isSubmitting}>
              {isSubmitting ? "Enviando pedido…" : "Pedir entrada"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function saveIdentity(key: string, identity: StoredJoinIdentity) {
  try {
    writeJoinIdentity(window.localStorage, key, identity);
  } catch {
    // Ignore storage errors in private mode.
  }
}
