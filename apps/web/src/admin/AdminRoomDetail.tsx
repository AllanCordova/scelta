import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { z } from "zod";
import { apiUrl } from "../api-url";
import { validateWithZod } from "../forms/validation";
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
  createSimulatedAccessCodes,
  deleteRoom,
  generateAccessCodes,
  listAccessCodes,
  openRound,
  removeParticipants,
  restartRound,
  revokeAccessCode,
  revokeAllAccessCodes,
} from "./rooms-api";
import type { MemberAccessCodeItem } from "./types";
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
  const [simCountError, setSimCountError] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState<string | null>(null);
  const simulatedVotersRef = useRef<SimulatedVoter[]>([]);
  const [accessCodes, setAccessCodes] = useState<MemberAccessCodeItem[]>([]);
  const [isCodesBusy, setIsCodesBusy] = useState(false);
  const [codesError, setCodesError] = useState<string | null>(null);
  const [codesNotice, setCodesNotice] = useState<string | null>(null);
  const [printCards, setPrintCards] = useState<Array<{ id: string; displayName: string; code: string; qrUrl: string }> | null>(null);
  const [selectedOffice, setSelectedOffice] = useState<string>("");

  const { room, loadError, lastSyncedAt } = useRoomDetail(roomId, refreshTick);

  useEffect(() => {
    let cancelled = false;
    void listAccessCodes(apiBase, roomId)
      .then((codes) => {
        if (!cancelled) {
          setAccessCodes(codes);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccessCodes([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, refreshTick]);

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

  async function handleOpenRound(officeLabel?: string) {
    if (!room) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    try {
      await openRound(apiBase, room.id, officeLabel);
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

  function validateSimulationCount(): number | null {
    const validation = validateWithZod(simCountSchema, { simCount: simCountInput });
    if (!validation.ok) {
      setSimCountError(validation.firstError);
      setActionError(validation.firstError);
      return null;
    }
    setSimCountError(null);
    return Number.parseInt(validation.data.simCount, 10);
  }

  async function handleSimulateJoin() {
    if (!room || isSimulating) {
      return;
    }
    const targetCount = validateSimulationCount();
    if (targetCount === null) {
      return;
    }
    setActionError(null);
    setIsSimulating(true);
    try {
      setSimProgress(`Gerando ${targetCount} códigos simulados…`);
      const simCodes = await createSimulatedAccessCodes(apiBase, room.id, targetCount);
      for (let i = 0; i < simCodes.length; i += 1) {
        const simCode = simCodes[i]!;
        const joinKey = createJoinKey();
        setSimProgress(`Entrando ${i + 1} / ${simCodes.length}…`);
        await submitJoin(apiBase, room.inviteToken, { code: simCode.code, joinKey });
        simulatedVotersRef.current.push({
          joinKey,
          displayName: simCode.displayName,
          votedRoundIds: new Set(),
        });
        setRefreshTick((current) => current + 1);
      }
      setSimProgress(`${simCodes.length} participantes simulados entraram na sala.`);
    } catch {
      setActionError("Não foi possível simular a entrada de participantes.");
      setSimProgress(null);
    } finally {
      setIsSimulating(false);
    }
  }

  async function handleGenerateAccessCodes() {
    if (!room || isCodesBusy) {
      return;
    }
    setCodesError(null);
    setCodesNotice(null);
    setIsCodesBusy(true);
    try {
      const next = await generateAccessCodes(apiBase, room.id);
      setAccessCodes(next);
      const activeCount = next.filter((item) => item.revokedAt === null).length;
      setCodesNotice(
        activeCount === 0
          ? "Nenhum membro elegível encontrado no rol. Importe o rol em Membros primeiro."
          : `${activeCount} códigos ativos prontos para credenciamento.`,
      );
    } catch {
      setCodesError("Não foi possível gerar os códigos de acesso.");
    } finally {
      setIsCodesBusy(false);
    }
  }

  async function handleRevokeSingleCode(codeId: string) {
    if (!room || isCodesBusy) {
      return;
    }
    setCodesError(null);
    setCodesNotice(null);
    setIsCodesBusy(true);
    try {
      const updated = await revokeAccessCode(apiBase, room.id, codeId);
      setAccessCodes((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setRefreshTick((current) => current + 1);
    } catch {
      setCodesError("Não foi possível revogar o código.");
    } finally {
      setIsCodesBusy(false);
    }
  }

  async function handleRevokeAllCodes() {
    if (!room || isCodesBusy) {
      return;
    }
    setCodesError(null);
    setCodesNotice(null);
    setIsCodesBusy(true);
    try {
      const { revokedCount } = await revokeAllAccessCodes(apiBase, room.id);
      setRefreshTick((current) => current + 1);
      setCodesNotice(
        revokedCount === 0
          ? "Não havia códigos ativos para revogar."
          : `${revokedCount} código(s) revogado(s).`,
      );
    } catch {
      setCodesError("Não foi possível revogar os códigos.");
    } finally {
      setIsCodesBusy(false);
    }
  }

  async function handlePreparePrintCards() {
    if (!fullInviteUrl) {
      return;
    }
    const activeCodes = accessCodes
      .filter((item) => item.revokedAt === null)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
    if (activeCodes.length === 0) {
      setCodesError("Gere os códigos antes de imprimir os cartões.");
      return;
    }
    setCodesError(null);
    setIsCodesBusy(true);
    try {
      const cards = await Promise.all(
        activeCodes.map(async (item) => {
          const urlWithCode = `${fullInviteUrl}?code=${encodeURIComponent(item.code)}`;
          const qrUrl = await QRCode.toDataURL(urlWithCode, { margin: 1, width: 120 });
          return {
            id: item.id,
            displayName: item.displayName,
            code: item.code,
            qrUrl,
          };
        }),
      );
      setPrintCards(cards);
    } catch {
      setCodesError("Não foi possível preparar os cartões para impressão.");
    } finally {
      setIsCodesBusy(false);
    }
  }

  async function handleSimulateRemove() {
    if (!room || isSimulating) {
      return;
    }
    const targetCount = validateSimulationCount();
    if (targetCount === null) {
      return;
    }
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
    const targetCount = validateSimulationCount();
    if (targetCount === null) {
      return;
    }
    setActionError(null);
    setIsSimulating(true);
    try {
      const pendingVoters = simulatedVotersRef.current.filter(
        (voter) => !voter.votedRoundIds.has(roundInstanceId),
      );

      if (pendingVoters.length < targetCount) {
        const needed = targetCount - pendingVoters.length;
        setSimProgress(`Gerando ${needed} códigos simulados…`);
        const simCodes = await createSimulatedAccessCodes(apiBase, room.id, needed);
        for (let i = 0; i < simCodes.length; i += 1) {
          const simCode = simCodes[i]!;
          const joinKey = createJoinKey();
          setSimProgress(`Preparando fila ${i + 1} / ${simCodes.length}…`);
          await submitJoin(apiBase, room.inviteToken, { code: simCode.code, joinKey });
          const voter: SimulatedVoter = {
            joinKey,
            displayName: simCode.displayName,
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
  const offices = room.offices ?? [];
  const unelectedOffices = offices.filter((item) => item.status !== "elected");
  const effectiveSelectedOffice =
    unelectedOffices.some((item) => item.officeLabel === selectedOffice)
      ? selectedOffice
      : (room.recommendedOffice ?? unelectedOffices[0]?.officeLabel ?? "");
  const allOfficesElected = offices.length > 0 && unelectedOffices.length === 0;
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
                {!openRoundId && offices.length > 0 && unelectedOffices.length > 0 ? (
                  <select
                    aria-label="Cargo para votação"
                    value={effectiveSelectedOffice}
                    disabled={isBusy}
                    onChange={(event) => setSelectedOffice(event.target.value)}
                  >
                    {unelectedOffices.map((item) => (
                      <option key={item.officeLabel} value={item.officeLabel}>
                        {item.order}. {item.officeLabel}
                        {item.officeLabel === room.recommendedOffice ? " (Ordem IPB)" : ""}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  disabled={
                    isBusy ||
                    (!openRoundId && (!room.presence.quorumMet || allOfficesElected))
                  }
                  title={
                    !openRoundId && allOfficesElected
                      ? "Todos os cargos da diretoria já foram eleitos."
                      : !openRoundId && !room.presence.quorumMet
                        ? "Quórum mínimo não atingido para abrir o escrutínio."
                        : undefined
                  }
                  onClick={() =>
                    openRoundId
                      ? void handleCloseRound(openRoundId)
                      : void handleOpenRound(offices.length > 0 ? effectiveSelectedOffice : undefined)
                  }
                >
                  {openRoundId
                    ? CLOSE_ROUND_LABEL
                    : allOfficesElected
                      ? "Todos os cargos eleitos"
                      : offices.length > 0 && effectiveSelectedOffice
                        ? `${OPEN_ROUND_LABEL} — ${effectiveSelectedOffice}`
                        : OPEN_ROUND_LABEL}
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

      {offices.length > 0 ? (
        <section className="panel" aria-label="Cargos da diretoria (Ordem IPB)">
          <h2>Cargos da Diretoria (Ordem IPB)</h2>
          <ol className="office-progress-list">
            {offices.map((office) => (
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
                        ? `Em andamento (${office.roundCount}º escrutínio)`
                        : "Aguardando"}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

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
              {room.round
                ? room.round.officeLabel
                  ? `${room.round.officeLabel} — ${room.round.officeRoundNumber ?? room.round.number}º Escrutínio`
                  : `${room.round.number}º Escrutínio`
                : "Não iniciado"}
            </span>
          </div>
          <p className="detail-kpi-footnote">Maioria absoluta (50% + 1)</p>
        </div>
      </section>

      <div className="detail-main-grid">
        <section className="panel candidate-results-card" aria-labelledby="scrutiny-heading">
          <div className="candidate-results-header">
            <div>
              <h2 id="scrutiny-heading">
                {room.round?.officeLabel
                  ? `Apuração: Cargo de ${room.round.officeLabel}`
                  : `Apuração: Cargo de ${roomTypeLabel}`}
              </h2>
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

          {tally && (tally.nullVotes ?? 0) > 0 ? (
            <p className="muted" role="status">
              Votos Nulos / Em Branco: <strong>{tally.nullVotes}</strong>
            </p>
          ) : null}

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

          <section className="panel access-codes-card" aria-labelledby="access-codes-heading">
            <div className="audit-feed-header">
              <h2 id="access-codes-heading">Códigos de Acesso</h2>
              <span className="detail-kpi-pill">
                {accessCodes.filter((item) => item.revokedAt === null).length} ativos
              </span>
            </div>
            <p className="muted">
              Gere os códigos individuais do rol para imprimir a folha A4 e entregue na entrada.
              Revogue códigos perdidos ou ao fim da assembleia.
            </p>
            <div className="access-codes-actions">
              <button
                type="button"
                className="round-action"
                disabled={isCodesBusy}
                onClick={() => void handleGenerateAccessCodes()}
              >
                Gerar códigos do rol
              </button>
              <button
                type="button"
                className="ghost round-action"
                disabled={
                  isCodesBusy || accessCodes.filter((item) => item.revokedAt === null).length === 0
                }
                onClick={() => void handlePreparePrintCards()}
              >
                Imprimir cartões A4
              </button>
              <button
                type="button"
                className="ghost danger-text round-action"
                disabled={
                  isCodesBusy || accessCodes.filter((item) => item.revokedAt === null).length === 0
                }
                onClick={() => void handleRevokeAllCodes()}
              >
                Revogar todos
              </button>
            </div>
            {codesError ? (
              <p className="form-error" role="alert">
                {codesError}
              </p>
            ) : null}
            {codesNotice ? (
              <p className="simulator-status" role="status">
                {codesNotice}
              </p>
            ) : null}
            {accessCodes.length > 0 ? (
              <ul className="access-codes-list" aria-label="Códigos de acesso gerados">
                {accessCodes.map((item) => {
                  const isRevoked = item.revokedAt !== null;
                  return (
                    <li
                      key={item.id}
                      className={isRevoked ? "access-code-row revoked" : "access-code-row"}
                    >
                      <div className="access-code-info">
                        <span className="access-code-name">{item.displayName}</span>
                        <span className="access-code-pin">{item.code}</span>
                      </div>
                      <div className="access-code-meta">
                        <span
                          className={
                            isRevoked ? "access-code-badge revoked" : "access-code-badge active"
                          }
                        >
                          {isRevoked ? "Revogado" : "Ativo"}
                        </span>
                        {!isRevoked ? (
                          <button
                            type="button"
                            className="ghost danger-text access-code-revoke-btn"
                            disabled={isCodesBusy}
                            onClick={() => void handleRevokeSingleCode(item.id)}
                          >
                            Revogar
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
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
                <div className="field">
                  <label className="simulator-count-label">
                    Participantes
                    <input
                      type="text"
                      inputMode="numeric"
                      value={simCountInput}
                      aria-invalid={Boolean(simCountError)}
                      disabled={isSimulating}
                      onChange={(event) => {
                        setSimCountInput(event.target.value);
                        setSimCountError(null);
                      }}
                    />
                  </label>
                  {simCountError ? <span className="field-error">{simCountError}</span> : null}
                </div>
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

      {printCards ? (
        <div className="print-cards-overlay" role="dialog" aria-label="Cartões de acesso para impressão">
          <div className="print-cards-toolbar no-print">
            <div>
              <h2>Cartões de Acesso — {room.title}</h2>
              <p className="muted">
                {printCards.length} cartões ativos em ordem alfabética, prontos para impressão em A4.
              </p>
            </div>
            <div className="print-cards-toolbar-actions">
              <button
                type="button"
                className="round-action"
                onClick={() => window.print()}
              >
                Imprimir agora (A4)
              </button>
              <button
                type="button"
                className="ghost round-action"
                onClick={() => setPrintCards(null)}
              >
                Fechar
              </button>
            </div>
          </div>
          <div className="print-cards-grid">
            {printCards.map((card) => (
              <article key={card.id} className="print-card-item">
                <img src={card.qrUrl} alt={`QR Code de ${card.displayName}`} width={104} height={104} />
                <div className="print-card-details">
                  <span className="print-card-room">{room.title}</span>
                  <strong className="print-card-name">{card.displayName}</strong>
                  <span className="print-card-code-label">Código de acesso:</span>
                  <code className="print-card-code">{card.code}</code>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
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

const simCountSchema = z.object({
  simCount: z
    .string()
    .trim()
    .refine(
      (val) => /^\d+$/.test(val) && Number(val) >= 1 && Number(val) <= 50,
      "Informe um número entre 1 e 50.",
    ),
});

function messageFromRoundError(error: unknown): string {
  if (error instanceof RoomRequestError) {
    return roundErrorMessage(error.errorCode);
  }
  return roundErrorMessage("unknown");
}
