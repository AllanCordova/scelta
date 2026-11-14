import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { z } from "zod";
import { apiUrl } from "../api-url";
import { validateWithZod } from "../forms/validation";
import { submitBallot, submitJoin } from "../join/join-api";
import { createJoinKey } from "../join/join-identity";
import { startTwoSidedConfettiLoop } from "../shell/confetti";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { ImageDropzone } from "../shell/ImageDropzone";
import { OfficeProgressGrid } from "../shell/OfficeProgressGrid";
import { PaginationBar, paginateItems } from "../shell/PaginationBar";
import { RoomChatPanel } from "../shell/RoomChatPanel";
import { EditRoomModal } from "./EditRoomModal";
import { ShareBoardPaper, type ShareBoardEntry } from "./ShareBoardPaper";
import {
  CLOSE_ROUND_LABEL,
  DECLINE_ROUND_LABEL,
  FAILED_QUORUM_MESSAGE,
  OPEN_ROUND_LABEL,
  RESTART_ROUND_LABEL,
  ROOM_TYPE_LABELS,
  ROUND_DECLINED_MESSAGE,
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
  declineRound,
  deleteRoom,
  openRound,
  removeParticipants,
  restartRound,
  setRoomOfficeBanner,
  rotateRoomInvite,
  updateRoom,
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
  const [simCountError, setSimCountError] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState<string | null>(null);
  const simulatedVotersRef = useRef<SimulatedVoter[]>([]);
  const [selectedOffice, setSelectedOffice] = useState<string>("");
  const [bannerOfficeLabel, setBannerOfficeLabel] = useState<string>("");
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [candidatePage, setCandidatePage] = useState(1);
  const [receiptPage, setReceiptPage] = useState(1);
  const [dismissedWinnerRoundId, setDismissedWinnerRoundId] = useState<string | null>(null);
  const [isSharePaperOpen, setIsSharePaperOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<
    "delete-room" | "close-room" | "remove-participants" | null
  >(null);

  const { room, loadError, lastSyncedAt } = useRoomDetail(roomId, refreshTick);

  const invitePath = room ? (room.invitePath ?? `/join/${room.inviteToken}`) : null;
  const fullInviteUrl = invitePath ? inviteUrl(window.location.origin, invitePath) : null;

  const isQrVisibleRef = useRef(isQrVisible);
  void isQrVisibleRef;
  const roundId = room?.round?.id ?? null;
  const isElectedWinner =
    room?.round?.status === "closed" &&
    room.round.tally?.outcome === "elected" &&
    Boolean(room.round.tally.winnerName);
  const showWinnerHero = Boolean(roundId && isElectedWinner && dismissedWinnerRoundId !== roundId);

  useEffect(() => {
    if (!showWinnerHero) {
      return;
    }
    return startTwoSidedConfettiLoop();
  }, [showWinnerHero, roundId]);

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

  async function handleRotateInvite() {
    if (!room) {
      return;
    }
    setIsBusy(true);
    setActionError(null);
    try {
      await rotateRoomInvite(apiBase, room.id);
      toast.success("Link de convite rotacionado.");
      setRefreshTick((tick) => tick + 1);
    } catch (error) {
      const msg = messageFromRoundError(error);
      setActionError(msg);
      toast.error(msg);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleToggleReactions() {
    if (!room) {
      return;
    }
    setIsBusy(true);
    setActionError(null);
    try {
      const nextEnabled = room.reactionsEnabled === false;
      await updateRoom(apiBase, room.id, { reactionsEnabled: nextEnabled });
      toast.success(nextEnabled ? "Reações ativadas." : "Reações desativadas.");
      setRefreshTick((tick) => tick + 1);
    } catch (error) {
      const msg = messageFromRoundError(error);
      setActionError(msg);
      toast.error(msg);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCopyInvite() {
    if (!fullInviteUrl) {
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(fullInviteUrl).catch(() => undefined);
    }
    setIsCopied(true);
    toast.success("Link de convite copiado.");
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
      toast.success("Escrutínio aberto.");
    } catch (error) {
      const msg = messageFromRoundError(error);
      setActionError(msg);
      toast.error(msg);
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
      toast.success("Escrutínio encerrado.");
    } catch (error) {
      const msg = messageFromRoundError(error);
      setActionError(msg);
      toast.error(msg);
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
      toast.success("Escrutínio reiniciado.");
    } catch (error) {
      const msg = messageFromRoundError(error);
      setActionError(msg);
      toast.error(msg);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeclineRound(roundId: string) {
    if (!room) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    try {
      await declineRound(apiBase, room.id, roundId);
      setRefreshTick((current) => current + 1);
      toast.info("Cargo declinado.");
    } catch (error) {
      const msg = messageFromRoundError(error);
      setActionError(msg);
      toast.error(msg);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCloseRoomStatus() {
    if (!room) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    try {
      await updateRoom(apiBase, room.id, { status: "closed" });
      setRefreshTick((current) => current + 1);
      toast.success("Sala marcada como completa.");
    } catch (error) {
      const msg = messageFromRoundError(error);
      setActionError(msg);
      toast.error(msg);
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
      window.location.assign("/admin/salas");
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
          <a className="detail-back-link" href="/admin/salas">
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
          <a className="detail-back-link" href="/admin/salas">
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
  const resolvedOffices = offices.map((office) => {
    const officeWinnerCandidate = office.winnerCandidateId
      ? room.candidates?.find((c) => c.id === office.winnerCandidateId)
      : office.winnerName
        ? room.candidates?.find((c) => c.displayName === office.winnerName)
        : undefined;
    return {
      ...office,
      winnerPhotoUrl: office.winnerPhotoUrl ?? officeWinnerCandidate?.photoUrl ?? null,
    };
  });
  const roomTypeLabel = ROOM_TYPE_LABELS[room.roomType] ?? "Sessão";
  const roomCode = `SALA-${room.id.slice(0, 6).toUpperCase()}`;
  const effectiveBannerOffice =
    offices.length > 0
      ? offices.some((item) => item.officeLabel === bannerOfficeLabel)
        ? bannerOfficeLabel
        : offices[0]!.officeLabel
      : null;
  const activeBannerUrl =
    offices.length > 0 && effectiveBannerOffice
      ? (room.officeBanners?.[effectiveBannerOffice] ?? null)
      : (room.officeBanners?.default ?? null);

  async function handleOfficeBannerChange(nextUrl: string | null) {
    if (!room) {
      return;
    }
    setBannerError(null);
    setIsBusy(true);
    try {
      await setRoomOfficeBanner(apiBase, room.id, {
        officeLabel: effectiveBannerOffice,
        bannerUrl: nextUrl,
      });
      toast.success(nextUrl ? "Banner do cargo atualizado." : "Banner do cargo removido.");
      setRefreshTick((tick) => tick + 1);
    } catch (error) {
      const msg = messageFromRoundError(error);
      setBannerError(msg);
      toast.error(msg);
    } finally {
      setIsBusy(false);
    }
  }

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
  const standingsByCandidate = new Map(
    (tally?.standings ?? []).map((item) => [item.candidateId, item.votes]),
  );
  const rawCandidates = room.candidates ?? [];
  const candidatesList = tally
    ? [...rawCandidates].sort((a, b) => {
        const diff = (standingsByCandidate.get(b.id) ?? 0) - (standingsByCandidate.get(a.id) ?? 0);
        if (diff !== 0) {
          return diff;
        }
        return a.displayName.localeCompare(b.displayName, "pt-BR");
      })
    : rawCandidates;
  const highestVotes =
    tally && tally.standings.length > 0
      ? Math.max(...tally.standings.map((item) => item.votes))
      : 0;
  const winnerCandidate =
    tally?.outcome === "elected" && tally.winnerName
      ? candidatesList.find(
          (candidate) =>
            candidate.id === tally.winnerId || candidate.displayName === tally.winnerName,
        )
      : undefined;
  const winnerVotes =
    winnerCandidate !== undefined
      ? (standingsByCandidate.get(winnerCandidate.id) ?? 0)
      : tally?.winnerId
        ? (standingsByCandidate.get(tally.winnerId) ?? 0)
        : 0;
  const winnerPercent =
    tally && tally.totalVotes > 0 ? Math.round((winnerVotes / tally.totalVotes) * 100) : 0;

  return (
    <div className="room-with-chat-layout admin-room-with-chat">
      <div className="admin-page room-detail-page room-with-chat-main">
        <div className="detail-breadcrumb-bar">
        <a className="detail-back-link" href="/admin/salas">
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
                <button
                  type="button"
                  className="ghost round-action"
                  disabled={isBusy}
                  onClick={() => void handleRotateInvite()}
                >
                  Rotacionar convite
                </button>
              </>
            ) : null}

            <button
              type="button"
              className="ghost round-action"
              disabled={isBusy}
              onClick={() => void handleToggleReactions()}
            >
              {room.reactionsEnabled !== false ? "Reações: Ativadas" : "Reações: Desativadas"}
            </button>

            <button
              type="button"
              className="ghost round-action"
              disabled={isBusy}
              onClick={() => setIsEditModalOpen(true)}
            >
              Editar
            </button>

            {room.status !== "closed" && room.status !== "cancelled" ? (
              <button
                type="button"
                className="ghost round-action"
                disabled={isBusy}
                onClick={() => setPendingConfirm("close-room")}
              >
                Fechar sala
              </button>
            ) : null}

            <button
              type="button"
              className="ghost round-action danger-action"
              disabled={isBusy}
              onClick={() => setPendingConfirm("delete-room")}
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
                {!openRoundId &&
                room.round?.status === "closed" &&
                room.round.outcome === "elected" ? (
                  <button
                    type="button"
                    className="ghost danger-text round-action"
                    disabled={isBusy}
                    onClick={() => void handleDeclineRound(room.round!.id)}
                  >
                    {DECLINE_ROUND_LABEL}
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
          <div className="section-header-row">
            <h2>Cargos da Diretoria (Ordem IPB)</h2>
            {allOfficesElected ? (
              <button
                type="button"
                className="round-action"
                onClick={() => setIsSharePaperOpen(true)}
              >
                Compartilhar resultado
              </button>
            ) : null}
          </div>
          <OfficeProgressGrid offices={resolvedOffices} />
        </section>
      ) : null}

      <section className="panel office-banner-admin-panel" aria-label="Banner do cargo">
        <div className="section-header-row">
          <div>
            <h2>Banner do Cargo na Cédula</h2>
            <p className="muted">
              {offices.length > 0
                ? "Adicione um banner por cargo para destacar cada eleição na seção Cédula Eleitoral."
                : "Adicione um banner para destacar este cargo na seção Cédula Eleitoral."}
            </p>
          </div>
          {offices.length > 0 && effectiveBannerOffice ? (
            <label className="office-banner-select-label">
              <span>Cargo</span>
              <select
                aria-label="Cargo do banner"
                value={effectiveBannerOffice}
                onChange={(event) => setBannerOfficeLabel(event.target.value)}
                disabled={isBusy}
              >
                {offices.map((office) => {
                  const hasBanner = Boolean(room.officeBanners?.[office.officeLabel]);
                  return (
                    <option key={office.officeLabel} value={office.officeLabel}>
                      {office.officeLabel} {hasBanner ? "✓" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}
        </div>
        {activeBannerUrl ? (
          <div className="voter-office-banner">
            <img
              src={activeBannerUrl}
              alt={
                effectiveBannerOffice
                  ? `Banner do cargo ${effectiveBannerOffice}`
                  : `Banner da sala ${room.title}`
              }
              className="voter-office-banner-img"
            />
          </div>
        ) : null}
        <ImageDropzone
          id="office-banner-dropzone"
          label={
            effectiveBannerOffice
              ? `Imagem de banner — ${effectiveBannerOffice}`
              : "Imagem de banner do cargo (opcional)"
          }
          value={activeBannerUrl}
          fallbackName={candidateInitials(effectiveBannerOffice ?? roomTypeLabel)}
          onChange={(nextUrl) => void handleOfficeBannerChange(nextUrl)}
          onError={(msg) => setBannerError(msg)}
        />
        {bannerError ? (
          <p className="field-error" role="alert">
            {bannerError}
          </p>
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

      {isElectedWinner && tally?.winnerName && room.round ? (
        showWinnerHero ? (
          <section className="panel voter-winner-hero admin-winner-hero" aria-label="Candidato eleito">
            <button
              type="button"
              className="ghost admin-winner-close-btn"
              aria-label="Minimizar destaque do eleito"
              onClick={() => setDismissedWinnerRoundId(room.round!.id)}
            >
              × Minimizar
            </button>
            <div className="voter-winner-avatar-wrap">
              <div className="voter-winner-avatar" aria-hidden="true">
                {winnerCandidate?.photoUrl ? (
                  <img src={winnerCandidate.photoUrl} alt="" className="voter-avatar-img" />
                ) : (
                  candidateInitials(tally.winnerName)
                )}
              </div>
              <span className="voter-winner-badge">Eleito</span>
            </div>
            <h2>{tally.winnerName}</h2>
            <p className="voter-winner-office">
              {room.round.officeLabel ? `${room.round.officeLabel} Eleito` : `${roomTypeLabel} Eleito`}
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
                  Total de votos: <strong>{tally.totalVotes}</strong>
                </span>
                <span>Critério: 50% + 1</span>
              </div>
            </div>
          </section>
        ) : (
          <div className="admin-winner-restore-bar">
            <span>
              Eleito: <strong>{tally.winnerName}</strong>
            </span>
            <button
              type="button"
              className="ghost"
              onClick={() => setDismissedWinnerRoundId(null)}
            >
              Mostrar destaque
            </button>
          </div>
        )
      ) : null}

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
            <div className="candidate-results-header-actions">
              <span className="detail-valid-votes-badge">{totalValidVotes} Votos Válidos</span>
              {offices.length === 0 && isElectedWinner ? (
                <button
                  type="button"
                  className="round-action"
                  onClick={() => setIsSharePaperOpen(true)}
                >
                  Compartilhar resultado
                </button>
              ) : null}
            </div>
          </div>

          {room.round?.status === "open" && (room.round.restartCount ?? 0) > 0 ? (
            <p className="round-restarted">{ROUND_RESTARTED_MESSAGE}</p>
          ) : null}

          {room.round?.outcome === "failed_quorum" ? (
            <p className="quorum-failed" role="status">
              {FAILED_QUORUM_MESSAGE}
            </p>
          ) : null}

          {room.round?.outcome === "declined" ? (
            <p className="round-restarted" role="status">
              {ROUND_DECLINED_MESSAGE}
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
          ) : (() => {
            const pagedCandidates = paginateItems(candidatesList, candidatePage, 10);
            return (
              <>
                <div className="candidate-cards-list">
                  {pagedCandidates.items.map((candidate) => {
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
                          {candidate.photoUrl ? (
                            <img src={candidate.photoUrl} alt="" className="voter-avatar-img" />
                          ) : (
                            candidateInitials(candidate.displayName)
                          )}
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
                <PaginationBar
                  currentPage={pagedCandidates.currentPage}
                  totalPages={pagedCandidates.totalPages}
                  onPageChange={setCandidatePage}
                  ariaLabel="Paginação de apuração de candidatos"
                />
              </>
            );
          })()}

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
                    onClick={() => setPendingConfirm("remove-participants")}
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

          {(() => {
            const pageSize = 5;
            const pagedReceipts = paginateItems(room.receiptTimestamps, receiptPage, pageSize);
            const startIndex = (pagedReceipts.currentPage - 1) * pageSize;

            return (
              <section className="panel audit-feed-card" aria-labelledby="presence-flow-heading">
                <div className="audit-feed-header">
                  <h2 id="presence-flow-heading">Fluxo de Presença</h2>
                  <span className="detail-kpi-pill">
                    {room.votedCount} de {Math.max(room.presence.presentCount, room.votedCount)}
                  </span>
                </div>

                <div className="audit-pending-item">
                  <p className="audit-pending-title">{pendingVoters} Membros Aguardando</p>
                  <p className="audit-receipt-meta">Sessões autenticadas ainda não enviaram cédula</p>
                </div>

                <PaginationBar
                  currentPage={pagedReceipts.currentPage}
                  totalPages={pagedReceipts.totalPages}
                  onPageChange={setReceiptPage}
                  ariaLabel="Paginação do fluxo de presença"
                />

                <div className="audit-feed-list">
                  {pagedReceipts.items.map((timestamp, index) => (
                    <div key={`${timestamp}-${startIndex + index}`} className="audit-receipt-item">
                      <span className="audit-receipt-dot" aria-hidden="true" />
                      <div>
                        <p className="audit-receipt-title">Cédula recebida e assinada digitalmente</p>
                        <p className="audit-receipt-meta">
                          Hash verificado • {formatReceiptTime(timestamp)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="audit-privacy-footer">
                  O sistema desacopla a identificação do membro do voto registrado.
                </p>
              </section>
            );
          })()}

          {room.auditEvents && room.auditEvents.length > 0 ? (
            <section className="panel audit-feed-card" aria-labelledby="room-audit-log-heading">
              <div className="audit-feed-header">
                <h2 id="room-audit-log-heading">Auditoria da sala</h2>
                <span className="detail-kpi-pill">{room.auditEvents.length}</span>
              </div>
              <div className="audit-feed-list">
                {room.auditEvents.map((event) => (
                  <div key={event.id} className="audit-receipt-item">
                    <span className="audit-receipt-dot" aria-hidden="true" />
                    <div>
                      <p className="audit-receipt-title">{formatAuditActionLabel(event.action)}</p>
                      <p className="audit-receipt-meta">
                        {event.actorRole} • {formatReceiptTime(event.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <ShareBoardPaper
        open={isSharePaperOpen}
        roomTitle={room.title}
        ministryLabel={roomTypeLabel}
        sessionDateLabel={formatSessionDate(room.createdAt)}
        entries={buildShareBoardEntries(
          resolvedOffices,
          roomTypeLabel,
          isElectedWinner ? (room.round?.tally?.winnerName ?? null) : null,
          winnerCandidate?.photoUrl ?? null,
        )}
        onClose={() => setIsSharePaperOpen(false)}
      />

      <EditRoomModal
        apiBase={apiBase}
        room={isEditModalOpen ? room : null}
        onClose={() => setIsEditModalOpen(false)}
        onSaved={() => setRefreshTick((current) => current + 1)}
      />

      <ConfirmDialog
        open={pendingConfirm !== null}
        title={
          pendingConfirm === "delete-room"
            ? "Excluir sala"
            : pendingConfirm === "close-room"
              ? "Fechar sala"
              : "Remover participantes"
        }
        description={
          pendingConfirm === "delete-room"
            ? `Tem certeza que deseja excluir a sala "${room.title}"? Essa ação não pode ser desfeita.`
            : pendingConfirm === "close-room"
              ? `Deseja fechar a sala "${room.title}" e marcá-la como Completa para histórico?`
              : "Tem certeza que deseja remover os participantes presentes da sala?"
        }
        confirmLabel={
          pendingConfirm === "delete-room"
            ? "Excluir"
            : pendingConfirm === "close-room"
              ? "Fechar sala"
              : "Remover participantes"
        }
        tone={pendingConfirm === "close-room" ? "default" : "danger"}
        busy={isBusy || isSimulating}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const target = pendingConfirm;
          setPendingConfirm(null);
          if (target === "delete-room") {
            void handleDeleteRoom();
          } else if (target === "close-room") {
            void handleCloseRoomStatus();
          } else if (target === "remove-participants") {
            void handleSimulateRemove();
          }
        }}
      />
      </div>
      <RoomChatPanel
        mode="admin"
        roomId={room.id}
        initialChatMuted={room.chatMuted}
        onRoomUpdated={() => setRefreshTick((tick) => tick + 1)}
      />
    </div>
  );
}

function buildShareBoardEntries(
  resolvedOffices: readonly {
    officeLabel: string;
    winnerName: string | null;
    winnerPhotoUrl: string | null;
  }[],
  roomTypeLabel: string,
  singleWinnerName: string | null,
  singleWinnerPhotoUrl: string | null,
): ShareBoardEntry[] {
  if (resolvedOffices.length > 0) {
    return resolvedOffices
      .filter((office) => Boolean(office.winnerName))
      .map((office) => ({
        officeLabel: office.officeLabel,
        winnerName: office.winnerName ?? "",
        winnerPhotoUrl: office.winnerPhotoUrl,
      }));
  }
  if (singleWinnerName) {
    return [
      {
        officeLabel: roomTypeLabel,
        winnerName: singleWinnerName,
        winnerPhotoUrl: singleWinnerPhotoUrl,
      },
    ];
  }
  return [];
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

const AUDIT_ACTION_LABELS: Record<string, string> = {
  room_created: "Sala criada",
  quorum_changed: "Quórum alterado",
  room_status_changed: "Situação da sala alterada",
  round_opened: "Escrutínio iniciado",
  round_closed: "Escrutínio encerrado",
  round_restarted: "Escrutínio reiniciado",
  office_declined: "Cargo declinado",
  result_published: "Resultado publicado",
};

function formatAuditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
