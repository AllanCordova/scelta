import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiUrl } from "../api-url";
import {
  fetchPublicConfig,
  hasOriginMismatch,
  resolvePublicOrigin,
  type PublicConfig,
} from "../config-api";
import { startTwoSidedConfettiLoop } from "../shell/confetti";
import type { PaperTallyFormValue } from "./PaperTallyPanel";
import type { RosterEntryView } from "./RoomRosterPanel";
import type { SinglePrintCard } from "./RoomSingleCardPrintModal";
import { ROOM_TYPE_LABELS, showsPresence } from "./copy";
import { generateQrSvg } from "./qr-svg";
import { displayShortRoomUrl, shortRoomUrl } from "./room-draft";
import {
  messageFromRoundError,
  resolveInitialRoomTab,
  type PendingConfirmKind,
  type RoomDetailTab,
} from "./room-detail-helpers";
import {
  RoomRequestError,
  addRoomCandidate,
  addRoomRosterMember,
  closeRound,
  declineRound,
  deleteRoom,
  fetchRoomRoster,
  listMembers,
  openRound,
  removeRoomCandidate,
  removeRoomRosterEntry,
  resolveRoundTie,
  restartRound,
  revealRoundResult,
  savePaperTally,
  setRoomOfficeBanner,
  setRosterPaperMode,
  updateRoom,
} from "./rooms-api";
import type { RoomRosterEntryItem, RoundTally, StoredMemberItem } from "./types";
import { useRoomDetail } from "./use-room-detail";

const apiBase = apiUrl("");

export function resolvePaperOriginForShare(
  tally: RoundTally | null,
  officeLabel: string,
): { officeLabel: string; originSummary: { total: number; online: number; paper: number } } | undefined {
  if (!tally?.voteOrigin || tally.voteOrigin.paper.ballots <= 0) {
    return undefined;
  }
  const winnerStanding = tally.winnerId
    ? tally.standings.find((item) => item.candidateId === tally.winnerId)
    : undefined;
  if (
    winnerStanding &&
    typeof winnerStanding.onlineVotes === "number" &&
    typeof winnerStanding.paperVotes === "number"
  ) {
    return {
      officeLabel,
      originSummary: {
        total: winnerStanding.votes,
        online: winnerStanding.onlineVotes,
        paper: winnerStanding.paperVotes,
      },
    };
  }
  return {
    officeLabel,
    originSummary: {
      total: tally.totalVotes,
      online: tally.voteOrigin.online.ballots,
      paper: tally.voteOrigin.paper.ballots,
    },
  };
}

/**
 * State, polling synchronization, and API action handlers for `AdminRoomDetail`.
 */
export function useRoomDetailController(roomId: string) {
  const [selectedTab, setSelectedTab] = useState<RoomDetailTab | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isQrVisible, setIsQrVisible] = useState(false);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({ publicUrl: null });
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedOffice, setSelectedOffice] = useState<string>("");
  const [bannerOfficeLabel, setBannerOfficeLabel] = useState<string>("");
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [dismissedWinnerRoundId, setDismissedWinnerRoundId] = useState<string | null>(null);
  const [isSharePaperOpen, setIsSharePaperOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [rosterEntries, setRosterEntries] = useState<RoomRosterEntryItem[]>([]);
  const [directoryMembers, setDirectoryMembers] = useState<StoredMemberItem[]>([]);
  const [singlePrintCard, setSinglePrintCard] = useState<SinglePrintCard | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmKind | null>(null);
  const [pendingCloseOptions, setPendingCloseOptions] = useState<{ confirmPending?: boolean }>({});
  const [pendingLiveTally, setPendingLiveTally] = useState<{
    value: boolean;
    syncedValue: boolean | undefined;
  } | null>(null);

  const { room: rawRoom, loadError, lastSyncedAt } = useRoomDetail(roomId, refreshTick);
  const showOptimisticLiveTally =
    rawRoom &&
    pendingLiveTally !== null &&
    rawRoom.showLiveCandidateTally === pendingLiveTally.syncedValue;
  const room = showOptimisticLiveTally
    ? { ...rawRoom, showLiveCandidateTally: pendingLiveTally.value }
    : rawRoom;

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

  const bumpRefresh = () => setRefreshTick((current) => current + 1);

  async function runBusyAction(action: () => Promise<void>, successMessage?: string) {
    setActionError(null);
    setIsBusy(true);
    try {
      await action();
      bumpRefresh();
      if (successMessage) {
        toast.success(successMessage);
      }
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

  async function handleCloseRound(
    targetRoundId: string,
    options?: { confirmPending?: boolean; confirmNoPaperBallots?: boolean },
  ) {
    if (!room) {
      return;
    }
    setActionError(null);
    setIsBusy(true);
    try {
      await closeRound(apiBase, room.id, targetRoundId, options);
      setPendingCloseOptions({});
      setSelectedTab("resultado");
      bumpRefresh();
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

  const offices = room?.offices ?? [];
  const unelectedOffices = offices.filter((item) => item.status !== "elected");
  const effectiveSelectedOffice =
    unelectedOffices.some((item) => item.officeLabel === selectedOffice)
      ? selectedOffice
      : (room?.recommendedOffice ?? unelectedOffices[0]?.officeLabel ?? "");
  const allOfficesElected = offices.length > 0 && unelectedOffices.length === 0;
  const totalVacancies = room?.vacancies ?? 1;
  const electedList = room?.electedCandidates ?? [];
  const remainingVacancies =
    typeof room?.remainingVacancies === "number"
      ? room.remainingVacancies
      : Math.max(0, totalVacancies - electedList.length);
  const allVacanciesFilled = offices.length === 0 && totalVacancies > 1 && remainingVacancies === 0;

  const resolvedOffices = offices.map((office) => {
    const officeWinnerCandidate = office.winnerCandidateId
      ? room?.candidates?.find((c) => c.id === office.winnerCandidateId)
      : office.winnerName
        ? room?.candidates?.find((c) => c.displayName === office.winnerName)
        : undefined;
    return {
      ...office,
      winnerPhotoUrl: office.winnerPhotoUrl ?? officeWinnerCandidate?.photoUrl ?? null,
    };
  });

  const roomTypeLabel = room ? (ROOM_TYPE_LABELS[room.roomType] ?? "Sessão") : "Sessão";
  const effectiveBannerOffice =
    offices.length > 0
      ? offices.some((item) => item.officeLabel === bannerOfficeLabel)
        ? bannerOfficeLabel
        : offices[0]!.officeLabel
      : null;
  const activeBannerUrl =
    offices.length > 0 && effectiveBannerOffice
      ? (room?.officeBanners?.[effectiveBannerOffice] ?? null)
      : (room?.officeBanners?.default ?? null);

  const rosterMemberIds = new Set(
    rosterEntries.map((entry) => entry.memberId).filter((id): id is string => Boolean(id)),
  );
  const availableRosterMembers = directoryMembers
    .filter((member) => !rosterMemberIds.has(member.id))
    .map((member) => ({ id: member.id, fullName: member.fullName, birthDate: member.birthDate }));

  const isCandidatesLocked =
    room?.status === "closed" ||
    (offices.length > 0 && effectiveSelectedOffice
      ? Boolean(room?.lockedOffices?.includes(effectiveSelectedOffice))
      : Boolean(room?.hasRounds));
  const candidateLockReason =
    room?.status === "closed"
      ? "Sala encerrada."
      : isCandidatesLocked
        ? "Candidatos bloqueados após o início do escrutínio."
        : undefined;
  const candidateMemberIds = new Set(
    (room?.candidates ?? [])
      .map((candidate) => candidate.memberId)
      .filter((id): id is string => Boolean(id)),
  );
  const availableCandidateMembers = directoryMembers
    .filter((member) => !candidateMemberIds.has(member.id))
    .map((member) => ({ id: member.id, fullName: member.fullName, birthDate: member.birthDate }));
  const roomCandidateViews = (room?.candidates ?? []).map((candidate) => ({
    id: candidate.id,
    memberId: candidate.memberId ?? null,
    displayName: candidate.displayName,
    isEligible: candidate.isEligible ?? true,
  }));

  const tally = room?.round?.tally ?? null;
  const winnerCandidate =
    tally?.outcome === "elected" && tally.winnerName
      ? (room?.candidates ?? []).find(
          (candidate) =>
            candidate.id === tally.winnerId || candidate.displayName === tally.winnerName,
        )
      : undefined;

  const activeTab = room
    ? (selectedTab ??
      resolveInitialRoomTab({ roomStatus: room.status, roundStatus: room.round?.status }))
    : "preparar";
  const openRoundId = room?.round?.status === "open" ? room.round.id : null;

  return {
    apiBase,
    room,
    loadError,
    lastSyncedAt,
    activeTab,
    setSelectedTab,
    actionError,
    setActionError,
    isBusy,
    isCopied,
    isQrVisible,
    toggleQr: () => setIsQrVisible((current) => !current),
    qrSvg,
    publicOrigin,
    originMismatch,
    fullInviteUrl,
    refreshTick,
    bumpRefresh,
    selectedOffice,
    setSelectedOffice,
    setBannerOfficeLabel,
    bannerError,
    setBannerError,
    isSharePaperOpen,
    setIsSharePaperOpen,
    isEditModalOpen,
    setIsEditModalOpen,
    singlePrintCard,
    setSinglePrintCard,
    pendingConfirm,
    setPendingConfirm,
    isActive: room ? showsPresence(room.status) : false,
    openRoundId,
    tieBreakRequired: Boolean(room?.round?.status === "closed" && room.round.tally?.tieBreakRequired),
    offices,
    unelectedOffices,
    effectiveSelectedOffice,
    allOfficesElected,
    allVacanciesFilled,
    totalVacancies,
    remainingVacancies,
    electedList,
    resolvedOffices,
    roomTypeLabel,
    effectiveBannerOffice,
    activeBannerUrl,
    rosterEntries,
    availableRosterMembers,
    roomCandidateViews,
    availableCandidateMembers,
    isCandidatesLocked,
    candidateLockReason,
    tally,
    winnerCandidate,
    isElectedWinner,
    showWinnerHero,
    dismissWinnerHero: (id: string) => setDismissedWinnerRoundId(id),
    restoreWinnerHero: () => setDismissedWinnerRoundId(null),
    handleCopyInvite,
    handlePrintSingleCard,
    handleOpenRound: (officeLabel?: string) =>
      void runBusyAction(async () => {
        if (!room) return;
        await openRound(apiBase, room.id, officeLabel);
        setSelectedTab("conduzir");
      }, "Escrutínio aberto."),
    handleCloseRound,
    handleRestartRound: (targetRoundId: string) =>
      void runBusyAction(async () => {
        if (!room) return;
        await restartRound(apiBase, room.id, targetRoundId);
      }, "Escrutínio reiniciado."),
    handleDeclineRound: (targetRoundId: string) =>
      void runBusyAction(async () => {
        if (!room) return;
        await declineRound(apiBase, room.id, targetRoundId);
      }, "Cargo declinado."),
    handleToggleEntry: () => {
      if (!room) return;
      const nextOpen = room.entryOpen === false;
      void runBusyAction(
        () => updateRoom(apiBase, room.id, { entryOpen: nextOpen }).then(() => undefined),
        nextOpen ? "Entrada na sala reaberta." : "Entrada na sala encerrada.",
      );
    },
    handleToggleLiveCandidateTally: (enabled: boolean) => {
      setPendingLiveTally({ value: enabled, syncedValue: rawRoom?.showLiveCandidateTally });
      void runBusyAction(async () => {
        if (!room) return;
        try {
          await updateRoom(apiBase, room.id, { showLiveCandidateTally: enabled });
        } catch (error) {
          setPendingLiveTally(null);
          throw error;
        }
      }, enabled
        ? "Parcial por candidato ativada no telão."
        : "Parcial por candidato ocultada no telão.");
    },
    handleChangeOfficeBanner: (nextUrl: string | null) => {
      setBannerError(null);
      void runBusyAction(async () => {
        if (!room) return;
        await setRoomOfficeBanner(apiBase, room.id, {
          officeLabel: effectiveBannerOffice,
          bannerUrl: nextUrl,
        });
      }, nextUrl ? "Banner do cargo atualizado." : "Banner do cargo removido.");
    },
    handleAddRosterMember: async (memberId: string) => {
      if (!room) return;
      const result = await addRoomRosterMember(apiBase, room.id, { memberId });
      bumpRefresh();
      toast.success(
        result.accessCode
          ? `Membro adicionado ao rol. Código: ${result.accessCode.code}`
          : "Membro adicionado ao rol.",
      );
    },
    handleAddRosterAdHoc: async (input: { fullName: string; birthDate?: string | null }) => {
      if (!room) return;
      const result = await addRoomRosterMember(apiBase, room.id, input);
      bumpRefresh();
      toast.success(
        result.accessCode
          ? `Participante adicionado ao rol. Código: ${result.accessCode.code}`
          : "Participante adicionado ao rol.",
      );
    },
    handleRemoveRosterEntry: async (entryId: string) => {
      if (!room) return;
      await removeRoomRosterEntry(apiBase, room.id, entryId);
      bumpRefresh();
      toast.success("Participante removido do rol.");
    },
    handleToggleRosterPaperMode: async (entryId: string, votesOnPaper: boolean) => {
      if (!room) return;
      await setRosterPaperMode(apiBase, room.id, entryId, votesOnPaper);
      bumpRefresh();
      toast.success(
        votesOnPaper
          ? "Eleitor marcado para voto em papel."
          : "Eleitor retornado para voto online.",
      );
    },
    handleAddRoomCandidate: async (input: { memberId?: string; displayName?: string }) => {
      if (!room) return;
      await addRoomCandidate(apiBase, room.id, {
        ...input,
        ...(offices.length > 0 && effectiveSelectedOffice
          ? { officeLabel: effectiveSelectedOffice }
          : {}),
      });
      bumpRefresh();
      toast.success("Candidato adicionado.");
    },
    handleRemoveRoomCandidate: async (candidateId: string) => {
      if (!room) return;
      await removeRoomCandidate(
        apiBase,
        room.id,
        candidateId,
        offices.length > 0 && effectiveSelectedOffice ? effectiveSelectedOffice : undefined,
      );
      bumpRefresh();
      toast.success("Candidato removido.");
    },
    handleSavePaperTally: async (payload: PaperTallyFormValue) => {
      if (!room?.round) return;
      await savePaperTally(apiBase, room.id, room.round.id, payload);
      bumpRefresh();
    },
    handleResolveTie: (targetRoundId: string, candidateId: string, displayName: string) =>
      void runBusyAction(async () => {
        if (!room) return;
        await resolveRoundTie(apiBase, room.id, targetRoundId, candidateId);
      }, `Desempate confirmado: ${displayName} eleito (critério de idade).`),
    handleRevealResult: (targetRoundId: string) =>
      void runBusyAction(async () => {
        if (!room) return;
        await revealRoundResult(apiBase, room.id, targetRoundId);
      }, "Resultado revelado no telão."),
    handleConfirmAction: (target: PendingConfirmKind) => {
      setPendingConfirm(null);
      if (!room) return;
      if (target === "delete-room") {
        void runBusyAction(async () => {
          await deleteRoom(apiBase, room.id);
          window.location.assign("/admin/salas");
        });
      } else if (target === "close-room") {
        void runBusyAction(
          () => updateRoom(apiBase, room.id, { status: "closed" }).then(() => undefined),
          "Sala marcada como completa.",
        );
      } else if (target === "close-pending-round" && openRoundId) {
        void handleCloseRound(openRoundId, { confirmPending: true });
      } else if (target === "close-no-paper-ballots" && openRoundId) {
        void handleCloseRound(openRoundId, {
          ...pendingCloseOptions,
          confirmNoPaperBallots: true,
        });
      }
    },
  };
}
