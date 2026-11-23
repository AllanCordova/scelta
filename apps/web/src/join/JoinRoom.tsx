import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { apiUrl } from "../api-url";
import { validateWithZod, type FieldErrors } from "../forms/validation";
import { startTwoSidedConfettiLoop } from "../shell/confetti";
import { ShareBoardSheet, ministryLabelForRoomType } from "../admin/ShareBoardPaper";
import { OfficeProgressGrid } from "../shell/OfficeProgressGrid";
import { PaginationBar, paginateItems } from "../shell/PaginationBar";
import { RoomChatPanel } from "../shell/RoomChatPanel";
import { ApprovalEntryFlow } from "./ApprovalEntryFlow";
import { BALLOT_WISDOM_VERSE, officeGuidanceForBallot } from "./ballot-guidance";
import {
  ballotErrorMessage,
  isJoinableRoomStatus,
  joinBlockedMessage,
  voterRoundStateNotice,
  voterSessionMessage,
  voterStandingLabel,
  voterTallyOutcome,
} from "./copy";
import { detectInAppBrowser } from "./in-app-browser";
import { InAppBrowserBanner } from "./InAppBrowserBanner";
import {
  fetchBallotState,
  fetchEntryRequestStatus,
  fetchJoinPreview,
  fetchVoteReceipt,
  submitBallot,
  submitJoin,
  type BallotState,
  type JoinPreview,
  type JoinResult,
} from "./join-api";
import {
  AUTO_JOIN_BACKOFF_DELAYS_MS,
  formatJoinErrorMessage,
  isTransientJoinError,
  shouldClearStoredAccessCode,
} from "./join-error";
import {
  clearStoredAccessCode,
  createJoinKey,
  isJoinKey,
  readAccessCodeFromSearch,
  readJoinIdentity,
  shortCodeStorageKey,
  stripAccessCodeFromUrl,
  writeJoinIdentity,
  type StoredJoinIdentity,
} from "./join-identity";
import { normalizeRoomShortCode, type JoinRouteTarget } from "./path";

const BALLOT_POLL_MS = 1000;
const DOOR_POLL_MS = 2000;
const NULL_VOTE_CHOICE = "__NULL__";

const joinCodeSchema = z.object({
  code: z
    .string()
    .transform((value) => normalizeRoomShortCode(value))
    .pipe(
      z
        .string()
        .min(1, "Informe seu código de acesso.")
        .regex(/^[A-Z0-9]{6}$/, "O código deve ter 6 letras ou números."),
    ),
});

type Phase =
  | { kind: "loading" }
  | { kind: "retrying"; message: string }
  | { kind: "transient-error"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "blocked"; title: string; message: string; reason?: "status" | "entry_closed" }
  | { kind: "ready"; title: string; joinKey: string }
  | {
      kind: "approval-ready";
      title: string;
      joinKey: string;
      inviteToken?: string;
      pendingRequestId?: string;
      pendingDisplayName?: string;
    }
  | {
      kind: "joined";
      title: string;
      joinKey: string;
      displayName: string;
      inviteToken: string;
      entryMode?: "codigo" | "aprovacao";
    };

export type JoinRoomProps = (
  | { token: string; shortCode?: undefined }
  | { shortCode: string; token?: undefined }
) & {
  retryDelaysMs?: readonly number[];
};

export function JoinRoom({
  token,
  shortCode,
  retryDelaysMs = AUTO_JOIN_BACKOFF_DELAYS_MS,
}: JoinRoomProps) {
  const target: JoinRouteTarget =
    shortCode !== undefined
      ? { mode: "shortCode", shortCode: normalizeRoomShortCode(shortCode) }
      : { mode: "token", token };
  const storageKey =
    target.mode === "shortCode" ? shortCodeStorageKey(target.shortCode) : target.token;
  const targetKey = target.mode === "shortCode" ? `s:${target.shortCode}` : `t:${target.token}`;

  const inAppInfo = detectInAppBrowser(
    typeof navigator !== "undefined" ? navigator.userAgent : "",
  );
  const [inAppDismissed, setInAppDismissed] = useState(false);
  const isInAppBlocked = inAppInfo.isInApp && !inAppDismissed;

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<"code">>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [doorRetry, setDoorRetry] = useState(0);

  useEffect(() => {
    if (isInAppBlocked) {
      return;
    }

    let cancelled = false;
    let activeTimer: number | null = null;
    const resolvedTarget: JoinRouteTarget =
      shortCode !== undefined
        ? { mode: "shortCode", shortCode: normalizeRoomShortCode(shortCode) }
        : { mode: "token", token: token ?? "" };
    const resolvedStorageKey =
      resolvedTarget.mode === "shortCode"
        ? shortCodeStorageKey(resolvedTarget.shortCode)
        : resolvedTarget.token;

    function waitBackoff(ms: number): Promise<void> {
      return new Promise((resolve) => {
        activeTimer = window.setTimeout(() => {
          activeTimer = null;
          resolve();
        }, ms);
      });
    }

    async function runWithBackoff<T>(
      operation: () => Promise<T>,
      onRetryWait: (attemptNumber: number, totalRetries: number, delayMs: number) => void,
    ): Promise<T> {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await operation();
        } catch (error) {
          if (cancelled || !isTransientJoinError(error) || attempt >= retryDelaysMs.length) {
            throw error;
          }
          const delayMs = retryDelaysMs[attempt] ?? 1000;
          onRetryWait(attempt + 1, retryDelaysMs.length, delayMs);
          await waitBackoff(delayMs);
          if (cancelled) {
            throw error;
          }
        }
      }
    }

    async function load() {
      setPhase({ kind: "loading" });
      setErrorMessage(null);
      setIsSubmitting(false);

      let preview: JoinPreview;
      try {
        preview = await runWithBackoff(
          () => fetchJoinPreview(apiUrl(""), resolvedTarget),
          (attemptNumber, totalRetries, delayMs) => {
            if (!cancelled) {
              setPhase({
                kind: "retrying",
                message: `Conexão instável. Tentando novamente em ${Math.max(1, Math.ceil(delayMs / 1000))}s… (tentativa ${attemptNumber} de ${totalRetries})`,
              });
            }
          },
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (isTransientJoinError(error)) {
          setPhase({
            kind: "transient-error",
            message: formatJoinErrorMessage(error),
          });
          return;
        }
        setPhase({ kind: "invalid", message: formatJoinErrorMessage(error) });
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
          reason: "status",
        });
        return;
      }

      const stored = readStored(resolvedStorageKey);
      const joinKey = stored && isJoinKey(stored.joinKey) ? stored.joinKey : createJoinKey();

      if (preview.entryMode === "aprovacao") {
        const fallbackInviteToken =
          preview.inviteToken ?? (resolvedTarget.mode === "token" ? resolvedTarget.token : undefined);

        if (stored?.pendingRequestId) {
          try {
            const reqStatus = await fetchEntryRequestStatus(
              apiUrl(""),
              resolvedTarget,
              stored.pendingRequestId,
              joinKey,
            );
            if (cancelled) {
              return;
            }
            if (reqStatus.status === "approved") {
              const resolvedToken =
                reqStatus.inviteToken ?? stored.inviteToken ?? fallbackInviteToken;
              if (resolvedToken) {
                const finalName = reqStatus.displayName || stored.displayName;
                const identity: StoredJoinIdentity = {
                  joinKey,
                  displayName: finalName,
                  entryMode: "aprovacao",
                  inviteToken: resolvedToken,
                };
                writeStored(resolvedStorageKey, identity);
                if (resolvedTarget.mode === "shortCode") {
                  writeStored(resolvedToken, identity);
                }
                setPhase({
                  kind: "joined",
                  title: preview.title,
                  joinKey,
                  displayName: finalName,
                  inviteToken: resolvedToken,
                  entryMode: "aprovacao",
                });
                return;
              }
            }
            if (reqStatus.status === "pending") {
              setPhase({
                kind: "approval-ready",
                title: preview.title,
                joinKey,
                inviteToken: fallbackInviteToken,
                pendingRequestId: stored.pendingRequestId,
                pendingDisplayName: reqStatus.displayName || stored.displayName,
              });
              return;
            }
          } catch {
            // Fall through to clearing stale pendingRequestId if request cannot be resumed.
          }
          if (cancelled) {
            return;
          }
          writeStored(resolvedStorageKey, { joinKey, displayName: "", entryMode: "aprovacao" });
        }

        const savedInviteToken = stored?.inviteToken ?? fallbackInviteToken;
        if (stored?.displayName && savedInviteToken) {
          const loadedBallot = await fetchBallotState(apiUrl(""), savedInviteToken, joinKey);
          if (cancelled) {
            return;
          }
          if (loadedBallot.status === "ok" && loadedBallot.state.viewerAccess === "present") {
            setPhase({
              kind: "joined",
              title: preview.title,
              joinKey,
              displayName: stored.displayName,
              inviteToken: savedInviteToken,
              entryMode: "aprovacao",
            });
            return;
          }
          clearStored(resolvedStorageKey, joinKey);
        }

        if (preview.entryOpen === false) {
          setPhase({
            kind: "blocked",
            title: preview.title,
            message: "A entrada nesta sala foi encerrada pela mesa.",
            reason: "entry_closed",
          });
          return;
        }

        writeStored(resolvedStorageKey, { joinKey, displayName: "", entryMode: "aprovacao" });
        setPhase({
          kind: "approval-ready",
          title: preview.title,
          joinKey,
          inviteToken: fallbackInviteToken,
        });
        return;
      }

      if (preview.entryOpen === false && !stored?.accessCode?.trim()) {
        setPhase({
          kind: "blocked",
          title: preview.title,
          message: "A entrada nesta sala foi encerrada pela mesa.",
          reason: "entry_closed",
        });
        return;
      }

      const queryCode = readAccessCodeFromSearch(window.location.search);
      const candidateCode = queryCode || stored?.accessCode?.trim() || "";

      if (candidateCode.length === 0) {
        writeStored(resolvedStorageKey, { joinKey, displayName: "" });
        setPhase({ kind: "ready", title: preview.title, joinKey });
        return;
      }

      setCode(candidateCode);
      setIsSubmitting(true);
      try {
        const result: JoinResult = await runWithBackoff(
          () =>
            submitJoin(apiUrl(""), resolvedTarget, {
              code: candidateCode,
              joinKey,
            }),
          (attemptNumber, totalRetries, delayMs) => {
            if (!cancelled) {
              setPhase({
                kind: "retrying",
                message: `Conexão instável ao entrar. Tentando novamente em ${Math.max(1, Math.ceil(delayMs / 1000))}s… (tentativa ${attemptNumber} de ${totalRetries})`,
              });
            }
          },
        );
        if (cancelled) {
          return;
        }

        const inviteToken =
          result.inviteToken ?? (resolvedTarget.mode === "token" ? resolvedTarget.token : "");
        if (!inviteToken) {
          throw new Error("missing_invite_token");
        }

        const identity: StoredJoinIdentity = {
          joinKey,
          displayName: result.displayName,
          accessCode: candidateCode.toUpperCase(),
        };
        writeStored(resolvedStorageKey, identity);
        if (resolvedTarget.mode === "shortCode") {
          writeStored(inviteToken, identity);
        }
        stripAccessCodeFromUrl();

        setPhase({
          kind: "joined",
          title: result.title,
          joinKey,
          displayName: result.displayName,
          inviteToken,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (isTransientJoinError(error)) {
          // Preserve stored identity (joinKey, accessCode, displayName) across transient failures.
          setErrorMessage(formatJoinErrorMessage(error));
          setPhase({
            kind: "transient-error",
            message: formatJoinErrorMessage(error),
          });
          return;
        }
        if (shouldClearStoredAccessCode(error)) {
          clearStored(resolvedStorageKey, joinKey);
        }
        setErrorMessage(formatJoinErrorMessage(error));
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
      if (activeTimer !== null) {
        window.clearTimeout(activeTimer);
      }
    };
  }, [targetKey, shortCode, token, doorRetry, isInAppBlocked, retryDelaysMs]);

  useEffect(() => {
    if (phase.kind !== "blocked" || isInAppBlocked) {
      return;
    }
    let cancelled = false;
    const resolvedTarget: JoinRouteTarget =
      shortCode !== undefined
        ? { mode: "shortCode", shortCode: normalizeRoomShortCode(shortCode) }
        : { mode: "token", token: token ?? "" };
    const timer = window.setInterval(() => {
      void fetchJoinPreview(apiUrl(""), resolvedTarget)
        .then((preview) => {
          if (
            !cancelled &&
            preview.canJoin &&
            (preview.entryMode !== "aprovacao" || preview.entryOpen !== false)
          ) {
            setDoorRetry((current) => current + 1);
          }
        })
        .catch(() => undefined);
    }, DOOR_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [phase.kind, shortCode, token, isInAppBlocked]);

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
      const result = await submitJoin(apiUrl(""), target, {
        code: normalizedCode,
        joinKey: phase.joinKey,
      });
      const inviteToken = result.inviteToken ?? (target.mode === "token" ? target.token : "");
      if (!inviteToken) {
        throw new Error("missing_invite_token");
      }

      const identity: StoredJoinIdentity = {
        joinKey: phase.joinKey,
        displayName: result.displayName,
        accessCode: normalizedCode,
      };
      writeStored(storageKey, identity);
      if (target.mode === "shortCode") {
        writeStored(inviteToken, identity);
      }
      stripAccessCodeFromUrl();

      setPhase({
        kind: "joined",
        title: result.title,
        joinKey: phase.joinKey,
        displayName: result.displayName,
        inviteToken,
      });
    } catch (error) {
      if (shouldClearStoredAccessCode(error)) {
        clearStored(storageKey, phase.joinKey);
      }
      setErrorMessage(formatJoinErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isInAppBlocked) {
    return (
      <div className="join-page">
        <InAppBrowserBanner
          appName={inAppInfo.appName}
          urlToCopy={window.location.href}
          onContinueAnyway={() => setInAppDismissed(true)}
        />
      </div>
    );
  }

  if (phase.kind === "loading") {
    return <p className="panel">Carregando…</p>;
  }

  if (phase.kind === "retrying") {
    return (
      <div className="join-page">
        <section className="panel" aria-live="polite">
          <p role="status">{phase.message}</p>
          <button
            type="button"
            onClick={() => setDoorRetry((current) => current + 1)}
          >
            Tentar novamente
          </button>
        </section>
      </div>
    );
  }

  if (phase.kind === "transient-error") {
    return (
      <div className="join-page">
        <header className="page-intro">
          <h1>Entrar na sala</h1>
        </header>
        <section className="panel" aria-live="polite">
          <p className="form-error" role="alert">
            {phase.message}
          </p>
          <button
            type="button"
            onClick={() => setDoorRetry((current) => current + 1)}
          >
            Tentar novamente
          </button>
        </section>
      </div>
    );
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

  if (phase.kind === "approval-ready") {
    return (
      <ApprovalEntryFlow
        target={target}
        storageKey={storageKey}
        title={phase.title}
        joinKey={phase.joinKey}
        fallbackInviteToken={phase.inviteToken}
        initialPendingRequestId={phase.pendingRequestId}
        initialPendingDisplayName={phase.pendingDisplayName}
        onApproved={(result) =>
          setPhase({
            kind: "joined",
            title: result.title,
            joinKey: result.joinKey,
            displayName: result.displayName,
            inviteToken: result.inviteToken,
            entryMode: "aprovacao",
          })
        }
        onEntryClosed={() =>
          setPhase({
            kind: "blocked",
            title: phase.title,
            message: "A entrada nesta sala foi encerrada pela mesa.",
            reason: "entry_closed",
          })
        }
      />
    );
  }

  if (phase.kind === "joined") {
    return (
      <JoinedRoomView
        token={phase.inviteToken}
        target={target}
        storageKey={storageKey}
        title={phase.title}
        joinKey={phase.joinKey}
        displayName={phase.displayName}
        entryMode={phase.entryMode}
        onResetToApproval={() => {
          clearStored(storageKey, phase.joinKey);
          if (target.mode === "shortCode") {
            clearStored(phase.inviteToken, phase.joinKey);
          }
          setDoorRetry((current) => current + 1);
        }}
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
  target,
  storageKey,
  title,
  joinKey,
  displayName,
  entryMode,
  onResetToApproval,
}: {
  token: string;
  target: JoinRouteTarget;
  storageKey: string;
  title: string;
  joinKey: string;
  displayName: string;
  entryMode?: "codigo" | "aprovacao";
  onResetToApproval?: () => void;
}) {
  const [ballotState, setBallotState] = useState<BallotState | null>(null);
  const [votedRoundIds, setVotedRoundIds] = useState<Record<string, boolean>>({});
  const [votedChoicesByRound, setVotedChoicesByRound] = useState<
    Record<string, { label: string; isNull: boolean; photoUrl: string | null }>
  >({});
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [isBlankSelected, setIsBlankSelected] = useState(false);
  const [reviewRoundKey, setReviewRoundKey] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState<string>("");
  const [candidatePage, setCandidatePage] = useState(1);
  const [standingsPage, setStandingsPage] = useState(1);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [isVoting, setIsVoting] = useState(false);
  const [isGuidanceExpanded, setIsGuidanceExpanded] = useState(false);
  const [inviteMissing, setInviteMissing] = useState(false);
  const [ballotNotice, setBallotNotice] = useState<string | null>(null);
  const [isReentering, setIsReentering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const checkedRoundKeys = new Set<string>();

    async function poll() {
      const loaded = await fetchBallotState(apiUrl(""), token, joinKey);
      if (cancelled) {
        return;
      }
      if (loaded.status === "missing") {
        setInviteMissing(true);
        return;
      }
      if (loaded.status !== "ok") {
        setBallotNotice("A cédula não atualizou. Tentando de novo…");
        return;
      }
      setBallotNotice(null);
      const next = loaded.state;
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
    if (!isElectedResult || !currentRoundKey) {
      return;
    }
    return startTwoSidedConfettiLoop();
  }, [isElectedResult, currentRoundKey]);
  const hasVotedInCurrentRound = Boolean(currentRoundKey && votedRoundIds[currentRoundKey]);
  const votedChoice = currentRoundKey ? votedChoicesByRound[currentRoundKey] ?? null : null;
  const roundVacancies = round?.vacancies ?? 1;
  const isMultiVacancyRound = roundVacancies > 1;
  const candidateIdSet = new Set(candidates.map((candidate) => candidate.id));
  const activeMultiSelectedIds = selectedCandidateIds
    .filter((id) => candidateIdSet.has(id))
    .slice(0, roundVacancies);
  const isReviewingBallot = Boolean(
    isMultiVacancyRound && currentRoundKey && reviewRoundKey === currentRoundKey,
  );
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

  const multiSelectedNames = activeMultiSelectedIds
    .map((id) => candidates.find((candidate) => candidate.id === id)?.displayName)
    .filter((name): name is string => Boolean(name));

  function handleToggleMultiCandidate(candidateId: string) {
    if (isVoting) {
      return;
    }
    setIsBlankSelected(false);
    setVoteError(null);
    setSelectedCandidateIds((current) => {
      const validCurrent = current.filter((id) => candidateIdSet.has(id)).slice(0, roundVacancies);
      if (validCurrent.includes(candidateId)) {
        return validCurrent.filter((id) => id !== candidateId);
      }
      if (validCurrent.length >= roundVacancies) {
        setVoteError(`Você pode selecionar no máximo ${roundVacancies} candidatos.`);
        return validCurrent;
      }
      return [...validCurrent, candidateId];
    });
  }

  function handleToggleMultiBlank() {
    if (isVoting) {
      return;
    }
    setVoteError(null);
    setSelectedCandidateIds([]);
    setIsBlankSelected((current) => !current);
  }

  async function handleConfirmMultiBallot() {
    if (!round || round.status !== "open" || isVoting) {
      return;
    }
    setIsVoting(true);
    setVoteError(null);
    try {
      const isNullChoice = isBlankSelected || activeMultiSelectedIds.length === 0;
      const chosenIds = isNullChoice ? [] : activeMultiSelectedIds;
      const chosenLabel = isNullChoice ? "Voto Nulo / Em Branco" : multiSelectedNames.join(", ");
      const receipt = await submitBallot(apiUrl(""), token, {
        joinKey,
        candidateIds: chosenIds,
      });
      setSelectedCandidateIds([]);
      setIsBlankSelected(false);
      setReviewRoundKey(null);
      const key = roundInstanceKey(receipt.roundId, round.restartCount);
      setVotedRoundIds((current) => ({ ...current, [key]: true }));
      toast.success("Voto registrado com sigilo.");
      setVotedChoicesByRound((current) => ({
        ...current,
        [key]: {
          label: chosenLabel,
          isNull: isNullChoice,
          photoUrl: null,
        },
      }));
    } catch (error) {
      const message = ballotErrorMessage(error);
      setVoteError(message);
    } finally {
      setIsVoting(false);
    }
  }

  async function handleCastVote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!round || round.status !== "open" || isVoting) {
      return;
    }
    if (isMultiVacancyRound) {
      if (!isBlankSelected && activeMultiSelectedIds.length === 0) {
        setVoteError(`Escolha até ${roundVacancies} candidatos ou Voto em Branco / Nulo.`);
        return;
      }
      setVoteError(null);
      setReviewRoundKey(currentRoundKey);
      return;
    }
    if (!activeSelectedCandidateId) {
      setVoteError("Escolha um candidato ou Voto Nulo / Em Branco.");
      return;
    }

    setIsVoting(true);
    setVoteError(null);
    try {
      const chosenLabel = selectedCandidateLabel;
      const isNullChoice = activeSelectedCandidateId === NULL_VOTE_CHOICE;
      const chosenCandidate = isNullChoice
        ? null
        : candidates.find((candidate) => candidate.id === activeSelectedCandidateId) ?? null;
      const receipt = await submitBallot(apiUrl(""), token, {
        joinKey,
        candidateId: isNullChoice ? null : activeSelectedCandidateId,
      });
      setSelectedCandidateId("");
      const key = roundInstanceKey(receipt.roundId, round.restartCount);
      setVotedRoundIds((current) => ({ ...current, [key]: true }));
      toast.success("Voto registrado com sigilo.");
      if (chosenLabel) {
        setVotedChoicesByRound((current) => ({
          ...current,
          [key]: {
            label: chosenLabel,
            isNull: isNullChoice,
            photoUrl: chosenCandidate?.photoUrl ?? null,
          },
        }));
      }
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
    ? typeof round.tally.totalVotes === "number"
      ? round.tally.totalVotes
      : round.tally.standings.reduce((sum, item) => sum + item.votes, 0) +
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
  const ballotGuidance =
    round?.status === "open"
      ? officeGuidanceForBallot(ballotState?.roomType, round.officeLabel)
      : null;
  const activeBannerUrl = round?.officeLabel
    ? (ballotState?.officeBanners?.[round.officeLabel] ?? ballotState?.activeBannerUrl ?? null)
    : (ballotState?.officeBanners?.default ?? ballotState?.activeBannerUrl ?? null);
  const boardOffices = ballotState?.offices ?? [];
  const allBoardOfficesElected =
    boardOffices.length > 0 && boardOffices.every((office) => office.status === "elected");
  const roomShut = ballotState != null && !isJoinableRoomStatus(ballotState.roomStatus);
  const viewerAccess = ballotState?.viewerAccess ?? "unknown";
  const blockedAccess =
    viewerAccess === "absent" || viewerAccess === "revoked" || viewerAccess === "missing"
      ? viewerAccess
      : null;
  const showResults =
    !allBoardOfficesElected && round?.status === "closed" && Boolean(round.tally);
  const showBallotForm =
    !roomShut && !blockedAccess && round?.status === "open" && candidates.length > 0;
  const showShut = roomShut && !showResults && !allBoardOfficesElected;
  const showWaiting =
    ballotState != null &&
    !roomShut &&
    !blockedAccess &&
    !showBallotForm &&
    !showResults &&
    !allBoardOfficesElected;

  async function handleReenter() {
    if (entryMode === "aprovacao") {
      onResetToApproval?.();
      return;
    }
    const stored = readStored(storageKey) ?? readStored(token);
    const accessCode = stored?.accessCode?.trim();
    if (!accessCode) {
      setBallotNotice("Abra de novo o link do seu cartão e informe o código.");
      return;
    }
    setIsReentering(true);
    try {
      await submitJoin(apiUrl(""), target, { code: accessCode, joinKey });
      setBallotNotice(null);
      const loaded = await fetchBallotState(apiUrl(""), token, joinKey);
      if (loaded.status === "ok") {
        setBallotState(loaded.state);
      }
    } catch (error) {
      if (shouldClearStoredAccessCode(error)) {
        clearStored(storageKey, joinKey);
      }
      setBallotNotice(formatJoinErrorMessage(error));
    } finally {
      setIsReentering(false);
    }
  }

  if (inviteMissing) {
    return (
      <div className="join-page">
        <header className="page-intro">
          <h1>Convite</h1>
        </header>
        <section className="panel">
          <p className="form-error" role="alert">
            Convite inválido ou expirado.
          </p>
        </section>
      </div>
    );
  }

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

      {!blockedAccess && !showShut ? (
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
      ) : null}

      {ballotNotice ? (
        <p className="form-error" role="status">
          {ballotNotice}
        </p>
      ) : null}

      {blockedAccess ? (
        <section className="panel" aria-live="polite">
          <p className="form-error" role="alert">
            {entryMode === "aprovacao" && blockedAccess !== "revoked"
              ? "Você foi removido da sala pela mesa. Peça entrada novamente quando a mesa liberar seu nome."
              : voterSessionMessage(blockedAccess)}
          </p>
          {blockedAccess !== "revoked" ? (
            <button type="button" disabled={isReentering} onClick={() => void handleReenter()}>
              Entrar novamente
            </button>
          ) : null}
        </section>
      ) : null}

      {showShut ? (
        <section className="panel">
          <p className="form-error" role="alert">
            {joinBlockedMessage(ballotState?.roomStatus ?? "")}
          </p>
        </section>
      ) : null}

      {showWaiting ? (
        <section className="panel" aria-live="polite">
          <h2>Aguardando a votação</h2>
          <p>
            A sala está aberta. A cédula aparece aqui para todo mundo no mesmo instante em que o
            escrutínio for aberto.
          </p>
        </section>
      ) : null}

      {allBoardOfficesElected ? (
        <ShareBoardSheet
          roomTitle={title}
          ministryLabel={ministryLabelForRoomType(ballotState?.roomType)}
          entries={boardOffices.map((office) => ({
            officeLabel: office.officeLabel,
            winnerName: office.winnerName ?? "Confirmado",
            winnerPhotoUrl: office.winnerPhotoUrl ?? null,
          }))}
        />
      ) : null}

      {showBallotForm ? (
        <section className="voter-ballot-section" aria-label="Cédula">
          <div className="panel voter-scrutiny-brief">
            <div className="voter-scrutiny-top">
              <span className="voter-scrutiny-kicker">Cédula Eleitoral</span>
              {isMultiVacancyRound ? (
                <span className="voter-secret-badge" data-testid="ballot-marks-counter">
                  {activeMultiSelectedIds.length} de {roundVacancies}
                </span>
              ) : (
                <span className="voter-secret-badge">1 escolha permitida</span>
              )}
            </div>
            {activeBannerUrl ? (
              <div className="voter-office-banner">
                <img
                  src={activeBannerUrl}
                  alt={
                    round.officeLabel
                      ? `Banner do cargo ${round.officeLabel}`
                      : `Banner da eleição ${title}`
                  }
                  className="voter-office-banner-img"
                />
              </div>
            ) : null}
            <div className="voter-scrutiny-main">
              <div className="voter-emblem-placeholder" aria-hidden="true">
                {round.officeLabel ? initialsFromName(round.officeLabel) : "SC"}
              </div>
              <div>
                <h2>{roundHeading}</h2>
                <p className="muted">
                  {isMultiVacancyRound
                    ? `Selecione até ${roundVacancies} candidatos abaixo ou opte por Voto em Branco / Nulo.`
                    : "Selecione um candidato abaixo ou opte por Voto Nulo / Em Branco."}
                </p>
              </div>
            </div>
            <p className="round-notice" aria-live="polite">
              {voterRoundStateNotice(round.status, round.restartCount)}
            </p>
            <div className="ballot-wisdom-box">
              <div className="ballot-wisdom-header">
                <blockquote className="ballot-wisdom-verse">
                  “{BALLOT_WISDOM_VERSE.text}”{" "}
                  <cite className="ballot-wisdom-ref">— {BALLOT_WISDOM_VERSE.reference}</cite>
                </blockquote>
                <button
                  type="button"
                  className="ghost ballot-guidance-toggle"
                  aria-expanded={isGuidanceExpanded}
                  onClick={() => setIsGuidanceExpanded((current) => !current)}
                >
                  {isGuidanceExpanded ? "Ler menos" : "Ler mais"}
                </button>
              </div>
              {isGuidanceExpanded && ballotGuidance ? (
                <div className="ballot-guidance-body">
                  <h3 className="ballot-guidance-title">{ballotGuidance.title}</h3>
                  <p className="ballot-guidance-how">{ballotGuidance.description}</p>
                </div>
              ) : null}
            </div>
          </div>

          {hasVotedInCurrentRound ? (
            <div className="panel voter-receipt-card">
              <div className="voter-receipt-header">
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
              {votedChoice ? (
                <div className="voter-receipt-choice">
                  <span
                    className={
                      votedChoice.isNull
                        ? "voter-null-icon voter-receipt-avatar"
                        : "voter-candidate-avatar voter-receipt-avatar"
                    }
                    aria-hidden="true"
                  >
                    {votedChoice.isNull ? (
                      "⊘"
                    ) : votedChoice.photoUrl ? (
                      <img src={votedChoice.photoUrl} alt="" className="voter-avatar-img" />
                    ) : (
                      initialsFromName(votedChoice.label)
                    )}
                  </span>
                  <div className="voter-receipt-choice-copy">
                    <span className="voter-confirm-label">Sua escolha</span>
                    <strong>{votedChoice.label}</strong>
                  </div>
                </div>
              ) : null}
            </div>
          ) : isReviewingBallot ? (
            <div
              className="panel voter-review-panel"
              role="region"
              aria-label="Revisão do seu voto"
              data-testid="ballot-review-step"
            >
              <h3>Revisão do seu voto</h3>
              {isBlankSelected || activeMultiSelectedIds.length === 0 ? (
                <p className="lede">
                  Você escolheu: <strong>Voto em Branco / Nulo</strong>
                </p>
              ) : (
                <>
                  <p className="muted">
                    Confira os nomes selecionados ({activeMultiSelectedIds.length} de{" "}
                    {roundVacancies}):
                  </p>
                  <ul className="voter-review-list">
                    {multiSelectedNames.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                  {activeMultiSelectedIds.length < roundVacancies ? (
                    <p className="field-hint">
                      Você selecionou {activeMultiSelectedIds.length} de {roundVacancies} vagas
                      disponíveis.
                    </p>
                  ) : null}
                </>
              )}
              {voteError ? (
                <p className="form-error" role="alert">
                  {voteError}
                </p>
              ) : null}
              <div className="voter-review-actions">
                <button
                  type="button"
                  className="ghost"
                  data-testid="ballot-review-back-btn"
                  disabled={isVoting}
                  onClick={() => {
                    setReviewRoundKey(null);
                    setVoteError(null);
                  }}
                >
                  Voltar e alterar
                </button>
                <button
                  type="button"
                  data-testid="ballot-review-confirm-btn"
                  disabled={isVoting}
                  onClick={() => void handleConfirmMultiBallot()}
                >
                  {isVoting ? "Enviando…" : "Confirmar e depositar voto"}
                </button>
              </div>
            </div>
          ) : (
            <form className="voter-ballot-form" onSubmit={handleCastVote}>
              <div className="voter-search-bar">
                <input
                  type="search"
                  value={candidateSearch}
                  onChange={(event) => {
                    setCandidateSearch(event.target.value);
                    setCandidatePage(1);
                  }}
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
                      onClick={() => {
                        setCandidateSearch("");
                        setCandidatePage(1);
                      }}
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
                  (isMultiVacancyRound ? isBlankSelected : activeSelectedCandidateId === NULL_VOTE_CHOICE)
                    ? "choice voter-null-card selected"
                    : "choice voter-null-card"
                }
                aria-pressed={
                  isMultiVacancyRound
                    ? isBlankSelected
                    : activeSelectedCandidateId === NULL_VOTE_CHOICE
                }
                onClick={() =>
                  isMultiVacancyRound
                    ? handleToggleMultiBlank()
                    : setSelectedCandidateId(NULL_VOTE_CHOICE)
                }
              >
                <span className="voter-null-icon" aria-hidden="true">
                  ⊘
                </span>
                <span className="voter-null-copy">
                  <strong>
                    {isMultiVacancyRound ? "Voto em Branco / Nulo" : "Voto Nulo / Em Branco"}
                  </strong>
                  <small>Nenhum dos candidatos da cédula</small>
                </span>
                <span
                  className={isMultiVacancyRound ? "voter-checkbox" : "voter-radio"}
                  aria-hidden="true"
                />
              </button>

              <fieldset className="choice-field voter-candidates-fieldset">
                <legend>Candidatos</legend>
                {filteredCandidates.length === 0 ? (
                  <p className="panel muted">
                    Nenhum candidato encontrado para &ldquo;{candidateSearch}&rdquo;.
                  </p>
                ) : (() => {
                  const pagedCandidates = paginateItems(filteredCandidates, candidatePage, 12);
                  return (
                    <>
                      <div className="voter-candidates-grid">
                        {pagedCandidates.items.map((candidate) => {
                          const isSelected = isMultiVacancyRound
                            ? activeMultiSelectedIds.includes(candidate.id)
                            : activeSelectedCandidateId === candidate.id;
                          const isLimitReached =
                            isMultiVacancyRound &&
                            !isSelected &&
                            activeMultiSelectedIds.length >= roundVacancies;
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
                              disabled={isLimitReached}
                              onClick={() =>
                                isMultiVacancyRound
                                  ? handleToggleMultiCandidate(candidate.id)
                                  : setSelectedCandidateId(candidate.id)
                              }
                            >
                              <span className="voter-candidate-top">
                                <span className="voter-candidate-avatar" aria-hidden="true">
                                  {candidate.photoUrl ? (
                                    <img
                                      src={candidate.photoUrl}
                                      alt=""
                                      className="voter-avatar-img"
                                    />
                                  ) : (
                                    initialsFromName(candidate.displayName)
                                  )}
                                </span>
                                <span
                                  className={isMultiVacancyRound ? "voter-checkbox" : "voter-radio"}
                                  aria-hidden="true"
                                />
                              </span>
                              <span className="voter-candidate-name">{candidate.displayName}</span>
                            </button>
                          );
                        })}
                      </div>
                      <PaginationBar
                        currentPage={pagedCandidates.currentPage}
                        totalPages={pagedCandidates.totalPages}
                        onPageChange={setCandidatePage}
                        ariaLabel="Paginação de candidatos da cédula"
                      />
                    </>
                  );
                })()}
              </fieldset>

              {voteError ? (
                <p className="form-error" role="alert">
                  {voteError}
                </p>
              ) : null}

              <div className="panel voter-confirm-dock">
                <div className="voter-confirm-selection">
                  <span className="voter-confirm-label">
                    {isMultiVacancyRound
                      ? `Sua escolha (${activeMultiSelectedIds.length} de ${roundVacancies})`
                      : "Sua escolha"}
                  </span>
                  <strong>
                    {isMultiVacancyRound
                      ? isBlankSelected
                        ? "Voto em Branco / Nulo"
                        : multiSelectedNames.length > 0
                          ? multiSelectedNames.join(", ")
                          : "Nenhum candidato selecionado"
                      : (selectedCandidateLabel ?? "Nenhum candidato selecionado")}
                  </strong>
                </div>
                <button type="submit" disabled={isVoting}>
                  {isMultiVacancyRound ? "Revisar voto" : "Confirmar voto"}
                </button>
              </div>
            </form>
          )}
        </section>
      ) : null}

      {showResults && round?.tally ? (
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
                  {(() => {
                    const winnerCandidate = candidates.find(
                      (candidate) =>
                        candidate.id === round.tally?.winnerId ||
                        candidate.displayName === round.tally?.winnerName,
                    );
                    return winnerCandidate?.photoUrl ? (
                      <img src={winnerCandidate.photoUrl} alt="" className="voter-avatar-img" />
                    ) : (
                      initialsFromName(
                        round.tally.winnerNames?.[0] ?? round.tally.winnerName,
                      )
                    );
                  })()}
                </div>
                <span className="voter-winner-badge">
                  {(round.tally.winnerNames?.length ?? 1) > 1 ? "Eleitos" : "Eleito"}
                </span>
              </div>
              <h2>{round.tally.winnerName}</h2>
              <p className="voter-winner-office">
                {round.officeLabel ? `${round.officeLabel} Eleito` : title}
              </p>
              <p className="round-notice" aria-live="polite">
                {voterRoundStateNotice(round.status, round.restartCount)}
              </p>
              <p className="voter-outcome-status" role="status">
                {voterTallyOutcome(
                  round.tally.outcome,
                  round.tally.winnerName,
                  round.tally.winnerNames?.length ?? 1,
                )}
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
                  {round.tally.didNotVoteCount && round.tally.didNotVoteCount > 0 ? (
                    <span>Não votaram: {round.tally.didNotVoteCount}</span>
                  ) : null}
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
              {round.tally.didNotVoteCount && round.tally.didNotVoteCount > 0 ? (
                <p className="muted" role="status">
                  Não votaram: <strong>{round.tally.didNotVoteCount}</strong>
                </p>
              ) : null}
            </div>
          )}

          {(() => {
            const pagedStandings = paginateItems(round.tally.standings, standingsPage, 10);
            return (
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
                  {pagedStandings.items.map((item) => {
                    const percent =
                      totalTallyVotes > 0 ? Math.round((item.votes / totalTallyVotes) * 100) : 0;
                    const isWinner =
                      round.tally?.outcome === "elected" &&
                      (round.tally.winnerIds
                        ? round.tally.winnerIds.includes(item.candidateId)
                        : round.tally.winnerName === item.displayName);
                    const matchedCandidate = candidates.find(
                      (candidate) =>
                        candidate.id === item.candidateId ||
                        candidate.displayName === item.displayName,
                    );
                    return (
                      <li
                        key={item.candidateId}
                        className={isWinner ? "voter-standing-item winner" : "voter-standing-item"}
                      >
                        <div className="voter-standing-row">
                          <span className="voter-standing-identity">
                            <span className="voter-standing-avatar" aria-hidden="true">
                              {matchedCandidate?.photoUrl ? (
                                <img
                                  src={matchedCandidate.photoUrl}
                                  alt=""
                                  className="voter-avatar-img"
                                />
                              ) : (
                                initialsFromName(item.displayName)
                              )}
                            </span>
                            <span>{voterStandingLabel(item.displayName, item.votes)}</span>
                          </span>
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
                  {round.tally.didNotVoteCount && round.tally.didNotVoteCount > 0 ? (
                    <li className="voter-standing-item">
                      <div className="voter-standing-row">
                        <span>Não votaram: {round.tally.didNotVoteCount}</span>
                      </div>
                    </li>
                  ) : null}
                </ul>
                <PaginationBar
                  currentPage={pagedStandings.currentPage}
                  totalPages={pagedStandings.totalPages}
                  onPageChange={setStandingsPage}
                  ariaLabel="Paginação de apuração dos votos"
                />
              </div>
            );
          })()}
        </section>
      ) : null}
      {boardOffices.length > 0 && !allBoardOfficesElected ? (
        <section className="panel" aria-label="Cargos da diretoria">
          <h2>Cargos da Diretoria</h2>
          <OfficeProgressGrid offices={boardOffices} />
        </section>
      ) : null}
      {ballotState?.roomId ? (
        <RoomChatPanel
          mode="voter"
          roomId={ballotState.roomId}
          token={token}
          joinKey={joinKey}
          initialChatMuted={ballotState.chatMuted}
        />
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

function roundInstanceKey(roundId: string, restartCount?: number): string {
  return `${roundId}:${restartCount ?? 0}`;
}

function readStored(key: string): StoredJoinIdentity | null {
  try {
    return readJoinIdentity(window.localStorage, key);
  } catch {
    return null;
  }
}

function writeStored(key: string, identity: StoredJoinIdentity) {
  try {
    writeJoinIdentity(window.localStorage, key, identity);
  } catch {
    // Private mode can block storage. The key kept in memory still covers this visit.
  }
}

function clearStored(key: string, fallbackJoinKey?: string) {
  try {
    clearStoredAccessCode(window.localStorage, key, fallbackJoinKey);
  } catch {
    // Ignore storage errors in private mode.
  }
}
