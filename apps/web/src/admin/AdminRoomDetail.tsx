import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { apiUrl } from "../api-url";
import { submitBallot, submitJoin } from "../join/join-api";
import { createJoinKey } from "../join/join-identity";
import {
  CLOSE_ROUND_LABEL,
  FAILED_QUORUM_MESSAGE,
  OPEN_ROUND_LABEL,
  RESTART_ROUND_LABEL,
  ROOM_TYPE_LABELS,
  ROUND_RESTARTED_MESSAGE,
  STATUS_LABELS,
  quorumLabel,
  quorumStateLabel,
  roundErrorMessage,
  showsPresence,
  standingLabel,
  tallySummaryLabel,
} from "./copy";
import { inviteUrl } from "./room-draft";
import {
  RoomRequestError,
  closeRound,
  deleteRoom,
  openRound,
  removeParticipants,
  restartRound,
} from "./rooms-api";
import { useRoomDetail } from "./use-room-detail";

const apiBase = apiUrl("");

type SimulatedVoter = {
  joinKey: string;
  displayName: string;
  votedRoundIds: Set<string>;
};

export function AdminRoomDetail({ roomId }: { roomId: string }) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isQrVisible, setIsQrVisible] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [simCountInput, setSimCountInput] = useState("5");
  const [isSimulating, setIsSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState<string | null>(null);
  const simulatedVotersRef = useRef<SimulatedVoter[]>([]);

  const { room, loadError, lastSyncedAt } = useRoomDetail(roomId, refreshTick);

  const invitePath = room ? (room.invitePath ?? `/join/${room.inviteToken}`) : null;
  const fullInviteUrl = invitePath ? inviteUrl(window.location.origin, invitePath) : null;

  useEffect(() => {
    if (!isQrVisible || !fullInviteUrl) {
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(fullInviteUrl, { margin: 1, width: 180 })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isQrVisible, fullInviteUrl]);

  async function handleCopyInvite() {
    if (!fullInviteUrl) {
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(fullInviteUrl).catch(() => undefined);
    }
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1800);
  }

  async function handleOpenRound() {
    if (!room) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    try {
      await openRound(apiBase, room.id);
      setRefreshTick((current) => current + 1);
    } catch (error) {
      setActionError(messageFromRoundError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCloseRound(roundId: string) {
    if (!room) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    try {
      await closeRound(apiBase, room.id, roundId);
      setRefreshTick((current) => current + 1);
    } catch (error) {
      setActionError(messageFromRoundError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRestartRound(roundId: string) {
    if (!room) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    try {
      await restartRound(apiBase, room.id, roundId);
      setRefreshTick((current) => current + 1);
    } catch (error) {
      setActionError(messageFromRoundError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteRoom() {
    if (!room) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    try {
      await deleteRoom(apiBase, room.id);
      window.location.assign("/admin");
    } catch {
      setActionError("Não foi possível excluir a sala.");
      setIsBusy(false);
    }
  }

  function parseSimulationCount(): number {
    const parsed = Number.parseInt(simCountInput, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      return 1;
    }
    return Math.min(parsed, 50);
  }

  async function handleSimulateJoin() {
    if (!room || isSimulating) {
      return;
    }
    const targetCount = parseSimulationCount();
    setActionError(null);
    setIsSimulating(true);
    try {
      const startIndex = simulatedVotersRef.current.length + 1;
      for (let i = 0; i < targetCount; i += 1) {
        const displayName = `Simulado ${startIndex + i}`;
        const joinKey = createJoinKey();
        setSimProgress(`Entrando ${i + 1} / ${targetCount}…`);
        await submitJoin(apiBase, room.inviteToken, { displayName, joinKey });
        simulatedVotersRef.current.push({
          joinKey,
          displayName,
          votedRoundIds: new Set(),
        });
        setRefreshTick((current) => current + 1);
      }
      setSimProgress(`${targetCount} participantes simulados entraram na sala.`);
    } catch {
      setActionError("Não foi possível simular a entrada de participantes.");
      setSimProgress(null);
    } finally {
      setIsSimulating(false);
    }
  }

  async function handleSimulateRemove() {
    if (!room || isSimulating) {
      return;
    }
    const targetCount = parseSimulationCount();
    setActionError(null);
    setIsSimulating(true);
    try {
      const { removedCount } = await removeParticipants(apiBase, room.id, targetCount);
      if (removedCount > 0) {
        simulatedVotersRef.current.splice(-removedCount, removedCount);
      }
      setRefreshTick((current) => current + 1);
      setSimProgress(
        removedCount === 0
          ? "Nenhum participante presente para remover."
          : `${removedCount} participantes removidos da presença.`,
      );
    } catch {
      setActionError("Não foi possível remover participantes.");
      setSimProgress(null);
    } finally {
      setIsSimulating(false);
    }
  }

  async function handleSimulateVotes() {
    if (!room || isSimulating) {
      return;
    }
    const currentRound = room.round;
    const roomCandidates = room.candidates ?? [];
    if (roomCandidates.length === 0) {
      setActionError("Cadastre candidatos na sala antes de simular votos.");
      return;
    }
    if (!currentRound || currentRound.status !== "open") {
      setActionError("Abra o escrutínio antes de simular votos.");
      return;
    }

    const roundInstanceId = `${currentRound.id}:${currentRound.restartCount ?? 0}`;
    const targetCount = parseSimulationCount();
    setActionError(null);
    setIsSimulating(true);
    try {
      const pendingVoters = simulatedVotersRef.current.filter(
        (voter) => !voter.votedRoundIds.has(roundInstanceId),
      );

      if (pendingVoters.length < targetCount) {
        const needed = targetCount - pendingVoters.length;
        const startIndex = simulatedVotersRef.current.length + 1;
        for (let i = 0; i < needed; i += 1) {
          const displayName = `Simulado ${startIndex + i}`;
          const joinKey = createJoinKey();
          setSimProgress(`Preparando fila ${i + 1} / ${needed}…`);
          await submitJoin(apiBase, room.inviteToken, { displayName, joinKey });
          const voter: SimulatedVoter = {
            joinKey,
            displayName,
            votedRoundIds: new Set(),
          };
          simulatedVotersRef.current.push(voter);
          pendingVoters.push(voter);
        }
      }

      const votersToCast = pendingVoters.slice(0, targetCount);
      for (let i = 0; i < votersToCast.length; i += 1) {
        const voter = votersToCast[i]!;
        const randomCandidate =
          roomCandidates[Math.floor(Math.random() * roomCandidates.length)]!;
        setSimProgress(`Votando ${i + 1} / ${votersToCast.length}…`);
        await submitBallot(apiBase, room.inviteToken, {
          joinKey: voter.joinKey,
          candidateId: randomCandidate.id,
        });
        voter.votedRoundIds.add(roundInstanceId);
        setRefreshTick((current) => current + 1);
      }
      setSimProgress(`${votersToCast.length} votos aleatórios computados.`);
    } catch {
      setActionError("Não foi possível simular os votos.");
      setSimProgress(null);
    } finally {
      setIsSimulating(false);
    }
  }

  if (loadError) {
    return (
      <div className="admin-page room-detail-page">
        <div className="detail-breadcrumb-bar">
          <a className="detail-back-link" href="/admin">
            ← Voltar para Painel de Salas
          </a>
        </div>
        <section className="panel">
          <p className="form-error" role="alert">
            {loadError}
          </p>
        </section>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="admin-page room-detail-page">
        <div className="detail-breadcrumb-bar">
          <a className="detail-back-link" href="/admin">
            ← Voltar para Painel de Salas
          </a>
        </div>
        <p className="panel">Carregando detalhes da sala…</p>
      </div>
    );
  }

  const isActive = showsPresence(room.status);
  const openRoundId = room.round?.status === "open" ? room.round.id : null;
  const roomTypeLabel = ROOM_TYPE_LABELS[room.roomType] ?? "Sessão";
  const roomCode = `SALA-${room.id.slice(0, 6).toUpperCase()}`;

  const voterDenominator =
    room.eligibleCount > 0
      ? room.eligibleCount
      : Math.max(room.presence.presentCount, room.votedCount);
  const votedPercent =
    voterDenominator > 0 ? Math.min(100, Math.round((room.votedCount / voterDenominator) * 100)) : 0;

  const activeVoterPool =
    room.presence.presentCount > 0 ? room.presence.presentCount : room.eligibleCount;
  const pendingVoters = Math.max(0, activeVoterPool - room.votedCount);
  const pendingPercent =
    activeVoterPool > 0 ? Math.min(100, Math.round((pendingVoters / activeVoterPool) * 100)) : 0;

  const tally = room.round?.tally ?? null;
  const totalValidVotes = tally ? tally.totalVotes : room.votedCount;
  const candidatesList = room.candidates ?? [];
  const standingsByCandidate = new Map(
    (tally?.standings ?? []).map((item) => [item.candidateId, item.votes]),
  );
  const highestVotes =
    tally && tally.standings.length > 0
      ? Math.max(...tally.standings.map((item) => item.votes))
      : 0;

  return (
    <div className="admin-page room-detail-page">
      <div className="detail-breadcrumb-bar">
        <a className="detail-back-link" href="/admin">
          ← Voltar para Painel de Salas
        </a>
        <span className="detail-sync-badge" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {lastSyncedAt
            ? `Ao vivo • Atualizado às ${formatSyncTime(lastSyncedAt)}`
            : "Sincronizando…"}
        </span>
      </div>

      <section className="room-header-card panel" aria-label="Cabeçalho da sala">
        <div className="room-header-top">
          <div className="room-header-title-block">
            <div className="room-header-title-row">
              <h1>{room.title}</h1>
              <span className={isActive ? "status status-badge active" : "status status-badge"}>
                {isActive ? <span className="status-dot" aria-hidden="true" /> : null}
                {STATUS_LABELS[room.status]}
              </span>
            </div>
            <p className="room-header-subtitle">
              {roomCode} • {roomTypeLabel} • Cédula Nominal Secreta
            </p>
          </div>

          <div className="room-header-actions">
            {fullInviteUrl ? (
              <>
                <button
                  type="button"
                  className="ghost round-action"
                  onClick={() => void handleCopyInvite()}
                >
                  {isCopied ? "Link copiado" : "Copiar link"}
                </button>
                <button
                  type="button"
                  className="ghost round-action"
                  onClick={() => setIsQrVisible((current) => !current)}
                >
                  QR Code
                </button>
              </>
            ) : null}

            <button
              type="button"
              className="ghost round-action danger-action"
              disabled={isBusy}
              onClick={() => void handleDeleteRoom()}
            >
              Excluir
            </button>

            {isActive ? (
              <>
                {openRoundId ? (
                  <button
                    type="button"
                    className="ghost round-action"
                    disabled={isBusy}
                    onClick={() => void handleRestartRound(openRoundId)}
                  >
                    {RESTART_ROUND_LABEL}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={isBusy || (!openRoundId && !room.presence.quorumMet)}
                  title={
                    !openRoundId && !room.presence.quorumMet
                      ? "Quórum mínimo não atingido para abrir o escrutínio."
                      : undefined
                  }
                  onClick={() =>
                    openRoundId ? void handleCloseRound(openRoundId) : void handleOpenRound()
                  }
                >
                  {openRoundId ? CLOSE_ROUND_LABEL : OPEN_ROUND_LABEL}
                </button>
              </>
            ) : null}
          </div>
        </div>

        {actionError ? (
          <p className="form-error" role="alert">
            {actionError}
          </p>
        ) : null}

        {isQrVisible && fullInviteUrl ? (
          <div className="detail-qr-drawer" aria-label="Convite">
            <div className="invite-header">
              <h2>QR Code do Convite</h2>
              <button
                type="button"
                className="ghost round-action"
                onClick={() => setIsQrVisible(false)}
              >
                Fechar
              </button>
            </div>
            <a href={fullInviteUrl}>{fullInviteUrl}</a>
            {qrDataUrl ? <img data-testid="invite-qr" alt="QR do convite" src={qrDataUrl} /> : null}
          </div>
        ) : null}
      </section>

      <section className="detail-kpi-grid" aria-label="Resumo de métricas">
        <div className="detail-kpi-card">
          <div className="detail-kpi-top">
            <span className="detail-kpi-label">Votos Computados</span>
            <span className="detail-kpi-pill">{votedPercent}%</span>
          </div>
          <div className="detail-kpi-value-row">
            <span className="detail-kpi-number">{room.votedCount}</span>
            <span className="detail-kpi-sub">/ {voterDenominator} aptos</span>
          </div>
          <div className="quorum-progress-track" aria-hidden="true">
            <div className="quorum-progress-bar met" style={{ width: `${votedPercent}%` }} />
          </div>
        </div>

        <div className="detail-kpi-card">
          <div className="detail-kpi-top">
            <span className="detail-kpi-label">Faltam Votar</span>
            <span className="detail-kpi-pill warning">Pendentes</span>
          </div>
          <div className="detail-kpi-value-row">
            <span className="detail-kpi-number warning">{pendingVoters}</span>
            <span className="detail-kpi-sub">membros em espera</span>
          </div>
          <div className="quorum-progress-track" aria-hidden="true">
            <div className="quorum-progress-bar below" style={{ width: `${pendingPercent}%` }} />
          </div>
        </div>

        <div className="detail-kpi-card">
          <div className="detail-kpi-top">
            <span className="detail-kpi-label">Quórum Mínimo</span>
            <span
              className={
                room.presence.quorumMet ? "quorum-state badge-met" : "quorum-state badge-below"
              }
            >
              {room.presence.quorumMet ? "VÁLIDO" : "PENDENTE"}
            </span>
          </div>
          <div className="detail-kpi-value-row">
            <span className="detail-kpi-status-title">
              {quorumStateLabel(room.presence.quorumMet)}
            </span>
          </div>
          <p className="detail-kpi-footnote">
            {quorumLabel(room.presence.presentCount, room.presence.requiredCount)} (presentes /
            mínimo)
          </p>
        </div>

        <div className="detail-kpi-card">
          <div className="detail-kpi-top">
            <span className="detail-kpi-label">Escrutínio Atual</span>
            <span className="detail-kpi-pill">
              {room.round?.status === "open"
                ? "Live"
                : room.round?.status === "closed"
                  ? "Encerrado"
                  : "Aguardando"}
            </span>
          </div>
          <div className="detail-kpi-value-row">
            <span className="detail-kpi-status-title">
              {room.round ? `${room.round.number}º Escrutínio` : "Não iniciado"}
            </span>
          </div>
          <p className="detail-kpi-footnote">Maioria absoluta (50% + 1)</p>
        </div>
      </section>

      <div className="detail-main-grid">
        <section className="panel candidate-results-card" aria-labelledby="scrutiny-heading">
          <div className="candidate-results-header">
            <div>
              <h2 id="scrutiny-heading">Apuração: Cargo de {roomTypeLabel}</h2>
              <p className="muted">
                Escrutínio nominal com apuração de maioria absoluta (50% + 1 dos votos válidos)
              </p>
            </div>
            <span className="detail-valid-votes-badge">{totalValidVotes} Votos Válidos</span>
          </div>

          {room.round?.status === "open" && (room.round.restartCount ?? 0) > 0 ? (
            <p className="round-restarted">{ROUND_RESTARTED_MESSAGE}</p>
          ) : null}

          {room.round?.outcome === "failed_quorum" ? (
            <p className="quorum-failed" role="status">
              {FAILED_QUORUM_MESSAGE}
            </p>
          ) : null}

          {tally ? (
            <div className="round-tally" role="status">
              <p className="tally-outcome">{tallySummaryLabel(tally)}</p>
              <ul className="tally-standings sr-only" aria-label="Apuração">
                {tally.standings.map((item) => (
                  <li key={item.candidateId}>{standingLabel(item.displayName, item.votes)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {candidatesList.length === 0 ? (
            <p className="empty">Nenhum candidato nominal cadastrado nesta sala.</p>
          ) : (
            <div className="candidate-cards-list">
              {candidatesList.map((candidate) => {
                const votes = standingsByCandidate.get(candidate.id) ?? 0;
                const percent =
                  tally && tally.totalVotes > 0
                    ? Number(((votes / tally.totalVotes) * 100).toFixed(1))
                    : 0;
                const isWinner = tally?.winnerId === candidate.id;
                const isLeading =
                  Boolean(tally) && highestVotes > 0 && votes === highestVotes && !isWinner;

                return (
                  <div
                    key={candidate.id}
                    className={
                      isWinner || isLeading ? "candidate-detail-card leading" : "candidate-detail-card"
                    }
                  >
                    <div className="candidate-detail-top">
                      <div className="candidate-identity">
                        <span className="candidate-avatar" aria-hidden="true">
                          {candidateInitials(candidate.displayName)}
                        </span>
                        <div>
                          <div className="candidate-name-row">
                            <span className="candidate-name">{candidate.displayName}</span>
                            {isWinner ? (
                              <span className="candidate-badge elected">Eleito</span>
                            ) : isLeading ? (
                              <span className="candidate-badge leading">Mais Votado</span>
                            ) : null}
                          </div>
                          <span className="candidate-sub">
                            {tally
                              ? standingLabel(candidate.displayName, votes)
                              : room.round?.status === "open"
                                ? "Em votação secreta"
                                : "Candidato elegível"}
                          </span>
                        </div>
                      </div>

                      <div className="candidate-numbers">
                        <span className="candidate-votes-value">
                          {tally ? `${votes} ${votes === 1 ? "voto" : "votos"}` : "—"}
                        </span>
                        <span className="candidate-votes-percent">
                          {tally ? `(${percent}%)` : ""}
                        </span>
                      </div>
                    </div>

                    <div className="quorum-progress-track" aria-hidden="true">
                      <div
                        className={
                          isWinner || isLeading
                            ? "quorum-progress-bar met"
                            : "quorum-progress-bar neutral"
                        }
                        style={{ width: `${tally ? Math.max(percent, 2) : 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="secrecy-notice-box">
            <strong>Cédula Secreta — Votos criptografados e anônimos</strong>
            <p className="muted">
              Os votos individuais não possuem vínculo identificável com o votante. A auditoria
              valida apenas que cada membro presente depositou no máximo uma cédula por escrutínio.
            </p>
          </div>
        </section>

        <div className="detail-sidebar-col">
          <section className="panel regimental-details-card" aria-labelledby="regimento-heading">
            <h2 id="regimento-heading">Regimento da Eleição</h2>
            <dl className="regimental-dl">
              <div className="regimental-row">
                <dt>Tipo de Escrutínio</dt>
                <dd>Secreto / Cédula única</dd>
              </div>
              <div className="regimental-row">
                <dt>Regra de Aprovação</dt>
                <dd>50% + 1 (Absoluta)</dd>
              </div>
              <div className="regimental-row">
                <dt>Quórum Configurado</dt>
                <dd>
                  {room.quorumValue}
                  {room.quorumUnit === "percent" ? "%" : " presentes"} (mín.{" "}
                  {room.presence.requiredCount})
                </dd>
              </div>
              <div className="regimental-row">
                <dt>Rol Vinculado</dt>
                <dd>
                  {room.eligibleCount > 0
                    ? `${room.eligibleCount} votantes aptos`
                    : `${room.presence.presentCount} presentes`}
                </dd>
              </div>
              <div className="regimental-row">
                <dt>Início da Sessão</dt>
                <dd>{formatSessionDate(room.createdAt)}</dd>
              </div>
            </dl>

            {fullInviteUrl ? (
              <div className="token-box">
                <label className="token-box-label" htmlFor="direct-voter-link">
                  Token Direto para Votantes
                </label>
                <div className="token-input-row">
                  <input id="direct-voter-link" type="text" readOnly value={fullInviteUrl} />
                  <button
                    type="button"
                    className="ghost round-action"
                    onClick={() => void handleCopyInvite()}
                  >
                    Copiar
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="panel audit-feed-card" aria-labelledby="presence-flow-heading">
            <div className="audit-feed-header">
              <h2 id="presence-flow-heading">Fluxo de Presença</h2>
              <span className="detail-kpi-pill">
                {room.votedCount} de {Math.max(room.presence.presentCount, room.votedCount)}
              </span>
            </div>

            <div className="audit-feed-list">
              {room.receiptTimestamps.map((timestamp, index) => (
                <div key={`${timestamp}-${index}`} className="audit-receipt-item">
                  <span className="audit-receipt-dot" aria-hidden="true" />
                  <div>
                    <p className="audit-receipt-title">Cédula recebida e assinada digitalmente</p>
                    <p className="audit-receipt-meta">
                      Hash verificado • {formatReceiptTime(timestamp)}
                    </p>
                  </div>
                </div>
              ))}

              <div className="audit-pending-item">
                <p className="audit-pending-title">{pendingVoters} Membros Aguardando</p>
                <p className="audit-receipt-meta">Sessões autenticadas ainda não enviaram cédula</p>
              </div>
            </div>

            <p className="audit-privacy-footer">
              O sistema desacopla a identificação do membro do voto registrado.
            </p>
          </section>

          {isActive ? (
            <section className="panel simulator-card" aria-labelledby="simulator-heading">
              <div className="simulator-header">
                <h2 id="simulator-heading">Simulador de Assembleia (Teste)</h2>
                <p className="muted">
                  Simula participantes entrando na fila e votando aleatoriamente em candidatos.
                </p>
              </div>
              <div className="simulator-controls">
                <label className="simulator-count-label">
                  Participantes
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={simCountInput}
                    disabled={isSimulating}
                    onChange={(event) => setSimCountInput(event.target.value)}
                  />
                </label>
                <div className="simulator-buttons">
                  <button
                    type="button"
                    className="ghost round-action"
                    disabled={isSimulating}
                    onClick={() => void handleSimulateJoin()}
                  >
                    Simular entrada
                  </button>
                  <button
                    type="button"
                    className="ghost round-action danger-action"
                    disabled={isSimulating || room.presence.presentCount === 0}
                    onClick={() => void handleSimulateRemove()}
                  >
                    Remover participantes
                  </button>
                  <button
                    type="button"
                    className="round-action"
                    disabled={isSimulating}
                    onClick={() => void handleSimulateVotes()}
                  >
                    Simular votos
                  </button>
                </div>
              </div>
              {simProgress ? (
                <p className="simulator-status" role="status">
                  {simProgress}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function candidateInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "CA";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function formatSessionDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatReceiptTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "agora";
  }
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSyncTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function messageFromRoundError(error: unknown): string {
  if (error instanceof RoomRequestError) {
    return roundErrorMessage(error.errorCode);
  }
  return roundErrorMessage("unknown");
}
