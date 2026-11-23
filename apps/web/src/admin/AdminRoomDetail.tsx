import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { apiUrl } from "../api-url";
import {
  fetchPublicConfig,
  hasOriginMismatch,
  resolvePublicOrigin,
  type PublicConfig,
} from "../config-api";
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
import { PaperTallyPanel, type PaperTallyFormValue } from "./PaperTallyPanel";
import { RoomCandidatesPanel } from "./RoomCandidatesPanel";
import { RoomPresencePanel } from "./RoomPresencePanel";
import { RoomRosterPanel, type RosterEntryView } from "./RoomRosterPanel";
import { ShareBoardPaper, type ShareBoardEntry } from "./ShareBoardPaper";
import { paginateCardsForPrint } from "./card-pagination";
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
import { generateQrSvg } from "./qr-svg";
import { displayShortRoomUrl, shortRoomUrl } from "./room-draft";
import {
  RoomRequestError,
  addRoomCandidate,
  addRoomRosterMember,
  closeRound,
  createSimulatedAccessCodes,
  declineRound,
  deleteRoom,
  fetchRoomRoster,
  listMembers,
  openRound,
  removeParticipants,
  removeRoomCandidate,
  removeRoomRosterEntry,
  resolveRoundTie,
  restartRound,
  savePaperTally,
  setRoomOfficeBanner,
  setRosterPaperMode,
  updateRoom,
} from "./rooms-api";
import type { RoomRosterEntryItem, StoredMemberItem } from "./types";
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
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({ publicUrl: null });
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
  const [rosterEntries, setRosterEntries] = useState<RoomRosterEntryItem[]>([]);
  const [directoryMembers, setDirectoryMembers] = useState<StoredMemberItem[]>([]);
  const [singlePrintCard, setSinglePrintCard] = useState<{
    id: string;
    displayName: string;
    code: string;
    qrSvg: string;
    displayUrl: string;
  } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<
    | "delete-room"
    | "close-room"
    | "remove-participants"
    | "close-pending-round"
    | "close-no-paper-ballots"
    | null
  >(null);
  const [pendingCloseOptions, setPendingCloseOptions] = useState<{
    confirmPending?: boolean;
  }>({});

  const { room, loadError, lastSyncedAt } = useRoomDetail(roomId, refreshTick);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicConfig()
      .then((config) => {
        if (!cancelled) {
          setPublicConfig(config);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchRoomRoster(apiBase, roomId).catch(() => ({ entries: [], eligibleCount: 0 })),
      listMembers(apiBase).catch(() => []),
    ]).then(([rosterResult, members]) => {
      if (!cancelled) {
        setRosterEntries(rosterResult.entries);
        setDirectoryMembers(members);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [roomId, refreshTick]);

  const publicOrigin = resolvePublicOrigin(publicConfig.publicUrl, window.location.origin);
  const originMismatch = hasOriginMismatch(publicConfig.publicUrl, window.location.origin);
  const fullInviteUrl = room?.shortCode ? shortRoomUrl(publicOrigin, room.shortCode) : null;

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
    void generateQrSvg(fullInviteUrl)
      .then((svg) => {
        if (!cancelled) {
          setQrSvg(svg);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrSvg(null);
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



  async function handleCloseRound(
    roundId: string,
    options?: { confirmPending?: boolean; confirmNoPaperBallots?: boolean },
  ) {
    if (!room) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    try {
      await closeRound(apiBase, room.id, roundId, options);
      setPendingCloseOptions({});
      setRefreshTick((current) => current + 1);
      toast.success("Escrutínio encerrado.");
    } catch (error) {
      if (error instanceof RoomRequestError && error.errorCode === "voting_incomplete") {
        setPendingConfirm("close-pending-round");
        return;
      }
      if (error instanceof RoomRequestError && error.errorCode === "paper_tally_required") {
        setPendingCloseOptions({ confirmPending: options?.confirmPending });
        setPendingConfirm("close-no-paper-ballots");
        return;
      }
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



  async function handleResolveTie(
    targetRoundId: string,
    winnerCandidateId: string,
    winnerDisplayName: string,
  ) {
    if (!room) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    try {
      await resolveRoundTie(apiBase, room.id, targetRoundId, winnerCandidateId);
      setRefreshTick((current) => current + 1);
      toast.success(`Desempate confirmado: ${winnerDisplayName} eleito (critério de idade).`);
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
  const tieBreakRequired = Boolean(
    room.round?.status === "closed" && room.round.tally?.tieBreakRequired,
  );
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
  const roomCode = room.shortCode;
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

  async function handleAddRosterMember(memberId: string) {
    if (!room) {
      return;
    }
    const result = await addRoomRosterMember(apiBase, room.id, { memberId });
    setRefreshTick((tick) => tick + 1);
    toast.success(
      result.accessCode
        ? `Membro adicionado ao rol. Código: ${result.accessCode.code}`
        : "Membro adicionado ao rol.",
    );
  }

  async function handleAddRosterAdHoc(input: { fullName: string; birthDate?: string | null }) {
    if (!room) {
      return;
    }
    const result = await addRoomRosterMember(apiBase, room.id, input);
    setRefreshTick((tick) => tick + 1);
    toast.success(
      result.accessCode
        ? `Participante adicionado ao rol. Código: ${result.accessCode.code}`
        : "Participante adicionado ao rol.",
    );
  }

  async function handleRemoveRosterEntry(entryId: string) {
    if (!room) {
      return;
    }
    await removeRoomRosterEntry(apiBase, room.id, entryId);
    setRefreshTick((tick) => tick + 1);
    toast.success("Participante removido do rol.");
  }

  async function handleToggleRosterPaperMode(entryId: string, votesOnPaper: boolean) {
    if (!room) {
      return;
    }
    await setRosterPaperMode(apiBase, room.id, entryId, votesOnPaper);
    setRefreshTick((tick) => tick + 1);
    toast.success(
      votesOnPaper
        ? "Eleitor marcado para voto em papel."
        : "Eleitor retornado para voto online.",
    );
  }

  async function handleSavePaperTally(payload: PaperTallyFormValue) {
    if (!room || !room.round) {
      return;
    }
    await savePaperTally(apiBase, room.id, room.round.id, payload);
    setRefreshTick((tick) => tick + 1);
  }

  async function handlePrintSingleCard(entry: RosterEntryView) {
    if (!room || !entry.accessCode || entry.accessCode.revokedAt !== null) {
      return;
    }
    try {
      const urlWithCode = shortRoomUrl(publicOrigin, room.shortCode, entry.accessCode.code);
      const displayUrl = displayShortRoomUrl(publicOrigin, room.shortCode);
      const cardQrSvg = await generateQrSvg(urlWithCode);
      setSinglePrintCard({
        id: entry.accessCode.id,
        displayName: entry.fullName,
        code: entry.accessCode.code,
        qrSvg: cardQrSvg,
        displayUrl,
      });
    } catch {
      toast.error("Não foi possível preparar o cartão para impressão.");
    }
  }

  async function handleAddRoomCandidate(input: { memberId?: string; displayName?: string }) {
    if (!room) {
      return;
    }
    await addRoomCandidate(apiBase, room.id, {
      ...input,
      ...(offices.length > 0 && effectiveSelectedOffice
        ? { officeLabel: effectiveSelectedOffice }
        : {}),
    });
    setRefreshTick((tick) => tick + 1);
    toast.success("Candidato adicionado.");
  }

  async function handleRemoveRoomCandidate(candidateId: string) {
    if (!room) {
      return;
    }
    await removeRoomCandidate(
      apiBase,
      room.id,
      candidateId,
      offices.length > 0 && effectiveSelectedOffice ? effectiveSelectedOffice : undefined,
    );
    setRefreshTick((tick) => tick + 1);
    toast.success("Candidato removido.");
  }

  const rosterMemberIds = new Set(
    rosterEntries.map((entry) => entry.memberId).filter((id): id is string => Boolean(id)),
  );
  const availableRosterMembers = directoryMembers
    .filter((member) => !rosterMemberIds.has(member.id))
    .map((member) => ({
      id: member.id,
      fullName: member.fullName,
      birthDate: member.birthDate,
    }));

  const isCandidatesLocked =
    room.status === "closed" ||
    (offices.length > 0 && effectiveSelectedOffice
      ? Boolean(room.lockedOffices?.includes(effectiveSelectedOffice))
      : Boolean(room.hasRounds));
  const candidateLockReason =
    room.status === "closed"
      ? "Sala encerrada."
      : isCandidatesLocked
        ? "Candidatos bloqueados após o início do escrutínio."
        : undefined;
  const candidateMemberIds = new Set(
    (room.candidates ?? [])
      .map((candidate) => candidate.memberId)
      .filter((id): id is string => Boolean(id)),
  );
  const availableCandidateMembers = directoryMembers
    .filter((member) => !candidateMemberIds.has(member.id))
    .map((member) => ({
      id: member.id,
      fullName: member.fullName,
      birthDate: member.birthDate,
    }));
  const roomCandidateViews = (room.candidates ?? []).map((candidate) => ({
    id: candidate.id,
    memberId: candidate.memberId ?? null,
    displayName: candidate.displayName,
    isEligible: candidate.isEligible ?? true,
  }));



  const paperVotersCount = room.presence.paperVotersCount ?? 0;
  const onlinePresentCount =
    room.presence.onlinePresentCount ??
    Math.max(0, room.presence.presentCount - paperVotersCount);

  const voterDenominator =
    room.eligibleCount > 0
      ? room.eligibleCount
      : Math.max(room.presence.presentCount, room.votedCount);
  const votedPercent =
    voterDenominator > 0 ? Math.min(100, Math.round((room.votedCount / voterDenominator) * 100)) : 0;

  const activeVoterPool =
    onlinePresentCount > 0
      ? onlinePresentCount
      : Math.max(0, room.eligibleCount - paperVotersCount);
  const pendingVoters = Math.max(0, activeVoterPool - room.votedCount);
  const pendingPercent =
    activeVoterPool > 0 ? Math.min(100, Math.round((pendingVoters / activeVoterPool) * 100)) : 0;

  const tally = room.round?.tally ?? null;
  const totalValidVotes = tally ? tally.totalVotes : room.votedCount;
  const standingsByCandidate = new Map(
    (tally?.standings ?? []).map((item) => [item.candidateId, item.votes]),
  );
  const standingDetailsByCandidate = new Map(
    (tally?.standings ?? []).map((item) => [item.candidateId, item]),
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
    <div className="admin-page room-detail-page">
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

      {originMismatch ? (
        <div
          className="tiebreak-admin-box no-print"
          role="status"
          data-testid="public-url-mismatch-warning"
        >
          <p>
            Você está acessando o painel por <strong>{window.location.origin}</strong>, mas a URL
            pública configurada é <strong>{publicOrigin}</strong>. Os links e QR Codes estão usando
            a URL pública configurada.
          </p>
        </div>
      ) : null}

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
              className="ghost round-action"
              disabled={isBusy}
              onClick={() => setIsEditModalOpen(true)}
            >
              Editar
            </button>

            {room.status !== "closed" ? (
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
                    (!openRoundId &&
                      (!room.presence.quorumMet || allOfficesElected || tieBreakRequired))
                  }
                  title={
                    !openRoundId && tieBreakRequired
                      ? "Limite de 3 escrutínios atingido. Resolva o desempate pelo mais velho abaixo."
                      : !openRoundId && allOfficesElected
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
                    : tieBreakRequired
                      ? "Desempate pendente (3º escrutínio)"
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
            {qrSvg ? (
              <div
                data-testid="invite-qr"
                role="img"
                aria-label="QR do convite"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : null}
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
            {paperVotersCount > 0 ? (
              <span className="detail-kpi-pill" data-testid="room-paper-count">
                Papel: {paperVotersCount}
              </span>
            ) : null}
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

      {isActive ? (
        <RoomPresencePanel
          roomId={room.id}
          refreshKey={refreshTick}
          onChanged={() => setRefreshTick((current) => current + 1)}
        />
      ) : null}

      {room.round?.status === "open" && paperVotersCount > 0 ? (
        <PaperTallyPanel
          key={room.round.paperTally?.updatedAt ?? "none"}
          candidates={roomCandidateViews}
          paperVotersCount={paperVotersCount}
          initialTally={room.round.paperTally ?? null}
          disabled={isBusy}
          onSave={handleSavePaperTally}
        />
      ) : null}

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
              {tally.voteOrigin ? (
                <div className="tally-origin-summary" data-testid="tally-origin-summary">
                  <span>
                    <strong>Total:</strong> {tally.totalVotes}
                  </span>
                  <span>
                    <strong>Online:</strong> {tally.voteOrigin.online.ballots} (brancos:{" "}
                    {tally.voteOrigin.online.blankVotes})
                  </span>
                  <span>
                    <strong>Papel:</strong> {tally.voteOrigin.paper.ballots} (brancos:{" "}
                    {tally.voteOrigin.paper.blankVotes}, nulos: {tally.voteOrigin.paper.nullVotes})
                  </span>
                </div>
              ) : null}
              {room.round?.paperTally?.recordedByName ? (
                <p className="muted" data-testid="tally-paper-recorded-by">
                  Urna de papel lançada por <strong>{room.round.paperTally.recordedByName}</strong>.
                </p>
              ) : null}
              <ul className="tally-standings sr-only" aria-label="Apuração">
                {tally.standings.map((item) => (
                  <li key={item.candidateId}>{standingLabel(item.displayName, item.votes)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {tieBreakRequired && tally?.tiedCandidates && room.round ? (
            <div
              className="tiebreak-admin-box"
              role="region"
              aria-label="Desempate do 3º escrutínio"
            >
              <div className="tiebreak-admin-header">
                <strong>Desempate do 3º Escrutínio — Critério de Idade (Mais Velho)</strong>
                <p className="muted">
                  O limite máximo de 3 escrutínios da IPB foi atingido com empate. Pela regra
                  regimental, vence o candidato mais velho. Como os candidatos empatados não possuem
                  data de nascimento cadastrada (ou possuem a mesma data), verifique na assembleia
                  quem é o mais velho e confirme o eleito abaixo:
                </p>
              </div>
              <div className="tiebreak-admin-actions">
                {tally.tiedCandidates.map((tiedCandidate) => (
                  <button
                    key={tiedCandidate.id}
                    type="button"
                    className="round-action"
                    disabled={isBusy}
                    onClick={() =>
                      void handleResolveTie(
                        room.round!.id,
                        tiedCandidate.id,
                        tiedCandidate.displayName,
                      )
                    }
                  >
                    Declarar {tiedCandidate.displayName} eleito (mais velho)
                  </button>
                ))}
              </div>
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
                const standingDetail = standingDetailsByCandidate.get(candidate.id);
                const votes = standingDetail?.votes ?? 0;
                const hasOriginBreakdown =
                  Boolean(tally?.voteOrigin) &&
                  typeof standingDetail?.onlineVotes === "number" &&
                  typeof standingDetail?.paperVotes === "number";
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
                              ? hasOriginBreakdown
                                ? `${standingLabel(candidate.displayName, votes)} · Online: ${standingDetail?.onlineVotes ?? 0} · Papel: ${standingDetail?.paperVotes ?? 0}`
                                : standingLabel(candidate.displayName, votes)
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

          {(tally?.didNotVoteCount ?? room.round?.didNotVoteCount ?? 0) > 0 ? (
            <p className="muted" role="status">
              Não votaram: <strong>{tally?.didNotVoteCount ?? room.round?.didNotVoteCount}</strong>
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

          {room.status === "test" ? (
            <section className="panel simulator-card" aria-labelledby="simulator-heading">
              <div className="simulator-header">
                <h2 id="simulator-heading">Simulador de Assembleia (Teste)</h2>
                <p className="muted">
                  Disponível exclusivamente em salas de Teste. Simula participantes entrando na fila e
                  votando aleatoriamente em candidatos.
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
                    {room.votedCount} de {Math.max(onlinePresentCount, room.votedCount)}
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
              <div className="audit-logs-cta">
                <a
                  className="ghost round-action"
                  href={`/admin/logs?roomId=${encodeURIComponent(room.id)}`}
                >
                  Logs Inapagáveis &amp; Exportar PDF
                </a>
              </div>
            </section>
          ) : (
            <section className="panel audit-feed-card" aria-labelledby="room-audit-log-heading">
              <div className="audit-feed-header">
                <h2 id="room-audit-log-heading">Auditoria e Integridade</h2>
              </div>
              <p className="audit-privacy-footer">
                Histórico inapagável comprovando que somente pessoas autenticadas votaram, sem
                intervenção do administrador.
              </p>
              <div className="audit-logs-cta">
                <a
                  className="ghost round-action"
                  href={`/admin/logs?roomId=${encodeURIComponent(room.id)}`}
                >
                  Logs Inapagáveis &amp; Exportar PDF
                </a>
              </div>
            </section>
          )}
        </div>
      </div>

      <RoomCandidatesPanel
        candidates={roomCandidateViews}
        availableMembers={availableCandidateMembers}
        isLocked={isCandidatesLocked}
        lockReason={candidateLockReason}
        onAddCandidate={handleAddRoomCandidate}
        onRemoveCandidate={handleRemoveRoomCandidate}
      />

      <RoomRosterPanel
        entries={rosterEntries}
        availableMembers={availableRosterMembers}
        isRoomClosed={room.status === "closed"}
        onAddMember={handleAddRosterMember}
        onAddAdHoc={handleAddRosterAdHoc}
        onRemoveEntry={handleRemoveRosterEntry}
        onPrintSingleCard={(entry) => void handlePrintSingleCard(entry)}
        onTogglePaperMode={handleToggleRosterPaperMode}
      />

      {singlePrintCard ? (
        <div
          className="print-cards-overlay"
          role="dialog"
          aria-label="Cartões de acesso para impressão"
          data-testid="single-card-print-dialog"
        >
          <div className="print-cards-toolbar no-print">
            <div>
              <h2>Cartão de Acesso — {room.title}</h2>
              <p className="muted">1 cartão ativo pronto para impressão em A4.</p>
            </div>
            <div className="print-cards-toolbar-actions">
              <button type="button" className="round-action" onClick={() => window.print()}>
                Imprimir
              </button>
              <button
                type="button"
                className="ghost round-action"
                onClick={() => setSinglePrintCard(null)}
              >
                Fechar
              </button>
            </div>
          </div>
          {paginateCardsForPrint([singlePrintCard]).map((sheetCards, sheetIndex) => (
            <div key={sheetIndex} className="print-sheet">
              {sheetCards.map((card) => (
                <article key={card.id} className="print-card-item">
                  <div
                    className="print-card-qr"
                    role="img"
                    aria-label={`QR Code de ${card.displayName}`}
                    dangerouslySetInnerHTML={{ __html: card.qrSvg }}
                  />
                  <div className="print-card-details">
                    <span className="print-card-room">{room.title}</span>
                    <strong className="print-card-name">{card.displayName}</strong>
                    <span className="print-card-code-label">Código de acesso:</span>
                    <code className="print-card-code">{card.code}</code>
                    <span className="print-card-short-url">{card.displayUrl}</span>
                  </div>
                </article>
              ))}
            </div>
          ))}
        </div>
      ) : null}

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
          tally?.voteOrigin && tally.voteOrigin.paper.ballots > 0
            ? {
                officeLabel: room.round?.officeLabel ?? roomTypeLabel,
                originSummary: (() => {
                  const winnerStanding = tally.winnerId
                    ? tally.standings.find((item) => item.candidateId === tally.winnerId)
                    : undefined;
                  if (
                    winnerStanding &&
                    typeof winnerStanding.onlineVotes === "number" &&
                    typeof winnerStanding.paperVotes === "number"
                  ) {
                    return {
                      total: winnerStanding.votes,
                      online: winnerStanding.onlineVotes,
                      paper: winnerStanding.paperVotes,
                    };
                  }
                  return {
                    total: tally.totalVotes,
                    online: tally.voteOrigin.online.ballots,
                    paper: tally.voteOrigin.paper.ballots,
                  };
                })(),
              }
            : undefined,
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
              : pendingConfirm === "close-pending-round"
                ? "Encerrar com votantes pendentes"
                : pendingConfirm === "close-no-paper-ballots"
                  ? "Urna de papel sem lançamento"
                  : "Remover participantes"
        }
        description={
          pendingConfirm === "delete-room"
            ? `Tem certeza que deseja excluir a sala "${room.title}"? Essa ação não pode ser desfeita.`
            : pendingConfirm === "close-room"
              ? `Deseja fechar a sala "${room.title}" e marcá-la como Completa para histórico?`
              : pendingConfirm === "close-pending-round"
                ? "Nem todos os membros presentes votaram. Deseja encerrar o escrutínio assim mesmo? Os membros pendentes serão registrados como 'não votaram'."
                : pendingConfirm === "close-no-paper-ballots"
                  ? "Há eleitores marcados para voto em papel nesta sala, mas nenhum total da urna de papel foi lançado neste escrutínio. Deseja encerrar mesmo assim sem cédulas de papel?"
                  : "Tem certeza que deseja remover os participantes presentes da sala?"
        }
        confirmLabel={
          pendingConfirm === "delete-room"
            ? "Excluir"
            : pendingConfirm === "close-room"
              ? "Fechar sala"
              : pendingConfirm === "close-pending-round"
                ? "Encerrar escrutínio"
                : pendingConfirm === "close-no-paper-ballots"
                  ? "Encerrar sem cédulas de papel"
                  : "Remover participantes"
        }
        tone={
          pendingConfirm === "close-room" ||
          pendingConfirm === "close-pending-round" ||
          pendingConfirm === "close-no-paper-ballots"
            ? "default"
            : "danger"
        }
        busy={isBusy || isSimulating}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const target = pendingConfirm;
          setPendingConfirm(null);
          if (target === "delete-room") {
            void handleDeleteRoom();
          } else if (target === "close-room") {
            void handleCloseRoomStatus();
          } else if (target === "close-pending-round") {
            if (openRoundId) {
              void handleCloseRound(openRoundId, { confirmPending: true });
            }
          } else if (target === "close-no-paper-ballots") {
            if (openRoundId) {
              void handleCloseRound(openRoundId, {
                ...pendingCloseOptions,
                confirmNoPaperBallots: true,
              });
            }
          } else if (target === "remove-participants") {
            void handleSimulateRemove();
          }
        }}
      />
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
  paperOrigin?: {
    officeLabel: string;
    originSummary: { total: number; online: number; paper: number };
  },
): ShareBoardEntry[] {
  if (resolvedOffices.length > 0) {
    return resolvedOffices
      .filter((office) => Boolean(office.winnerName))
      .map((office) => ({
        officeLabel: office.officeLabel,
        winnerName: office.winnerName ?? "",
        winnerPhotoUrl: office.winnerPhotoUrl,
        ...(paperOrigin && paperOrigin.officeLabel === office.officeLabel
          ? { originSummary: paperOrigin.originSummary }
          : {}),
      }));
  }
  if (singleWinnerName) {
    return [
      {
        officeLabel: roomTypeLabel,
        winnerName: singleWinnerName,
        winnerPhotoUrl: singleWinnerPhotoUrl,
        ...(paperOrigin ? { originSummary: paperOrigin.originSummary } : {}),
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
  tie_break_resolved: "Desempate decidido pela mesa (mais velho)",
  result_published: "Resultado publicado",
  roster_member_added: "Membro adicionado ao rol",
  roster_member_removed: "Membro removido do rol",
  candidate_added: "Candidato adicionado",
  candidate_removed: "Candidato removido",
  roster_paper_mode_enabled: "Marcado para voto em papel",
  roster_paper_mode_disabled: "Retornado para voto online",
  paper_tally_recorded: "Totais da urna de papel lançados",
};

function formatAuditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
