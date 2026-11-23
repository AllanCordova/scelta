import { EditRoomModal } from "./EditRoomModal";
import { RoomConductTab } from "./RoomConductTab";
import { RoomConfirmDialogs } from "./RoomConfirmDialogs";
import { RoomDetailHeader } from "./RoomDetailHeader";
import { RoomPrepareTab } from "./RoomPrepareTab";
import { RoomResultsTab } from "./RoomResultsTab";
import { RoomSingleCardPrintModal } from "./RoomSingleCardPrintModal";
import { ShareBoardPaper } from "./ShareBoardPaper";
import {
  buildShareBoardEntries,
  formatSessionDate,
  formatSyncTime,
} from "./room-detail-helpers";
import {
  resolvePaperOriginForShare,
  useRoomDetailController,
} from "./use-room-detail-controller";

/**
 * Room detail coordinator: renders breadcrumb, header, Preparar / Conduzir / Resultado tabs,
 * and room-level print/share/edit/confirm dialogs.
 */
export function AdminRoomDetail({ roomId }: { roomId: string }) {
  const c = useRoomDetailController(roomId);

  if (c.loadError) {
    return (
      <div className="admin-page room-detail-page">
        <div className="detail-breadcrumb-bar">
          <a className="detail-back-link" href="/admin/salas">
            ← Voltar para Painel de Salas
          </a>
        </div>
        <section className="panel">
          <p className="form-error" role="alert">
            {c.loadError}
          </p>
        </section>
      </div>
    );
  }

  if (!c.room) {
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

  const room = c.room;

  return (
    <div className="admin-page room-detail-page">
      <div className="detail-breadcrumb-bar">
        <a className="detail-back-link" href="/admin/salas">
          ← Voltar para Painel de Salas
        </a>
        <span className="detail-sync-badge" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          {c.lastSyncedAt
            ? `Ao vivo • Atualizado às ${formatSyncTime(c.lastSyncedAt)}`
            : "Sincronizando…"}
        </span>
      </div>

      {c.originMismatch ? (
        <div
          className="tiebreak-admin-box no-print"
          role="status"
          data-testid="public-url-mismatch-warning"
        >
          <p>
            Você está acessando o painel por <strong>{window.location.origin}</strong>, mas a URL
            pública configurada é <strong>{c.publicOrigin}</strong>. Os links e QR Codes estão usando
            a URL pública configurada.
          </p>
        </div>
      ) : null}

      <RoomDetailHeader
        room={room}
        roomTypeLabel={c.roomTypeLabel}
        isActive={c.isActive}
        isBusy={c.isBusy}
        actionError={c.actionError}
        openRoundId={c.openRoundId}
        tieBreakRequired={c.tieBreakRequired}
        offices={c.offices}
        unelectedOffices={c.unelectedOffices}
        effectiveSelectedOffice={c.effectiveSelectedOffice}
        allOfficesElected={c.allOfficesElected}
        allVacanciesFilled={c.allVacanciesFilled}
        totalVacancies={c.totalVacancies}
        remainingVacancies={c.remainingVacancies}
        onSelectOffice={c.setSelectedOffice}
        onOpenEditModal={() => c.setIsEditModalOpen(true)}
        onRequestCloseRoom={() => c.setPendingConfirm("close-room")}
        onRequestDeleteRoom={() => c.setPendingConfirm("delete-room")}
        onOpenRound={c.handleOpenRound}
        onCloseRound={(targetRoundId) => void c.handleCloseRound(targetRoundId)}
        onRestartRound={c.handleRestartRound}
        onDeclineRound={c.handleDeclineRound}
      />

      <nav className="room-detail-tabs" role="tablist" aria-label="Seções da sala">
        {(
          [
            { id: "preparar", label: "Preparar" },
            { id: "conduzir", label: "Conduzir" },
            { id: "resultado", label: "Resultado" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={c.activeTab === tab.id}
            className={c.activeTab === tab.id ? "choice selected" : "choice"}
            onClick={() => c.setSelectedTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {c.activeTab === "preparar" ? (
        <RoomPrepareTab
          room={room}
          roomTypeLabel={c.roomTypeLabel}
          offices={c.offices}
          fullInviteUrl={c.fullInviteUrl}
          isCopied={c.isCopied}
          isQrVisible={c.isQrVisible}
          qrSvg={c.qrSvg}
          isBusy={c.isBusy}
          effectiveBannerOffice={c.effectiveBannerOffice}
          activeBannerUrl={c.activeBannerUrl}
          bannerError={c.bannerError}
          rosterEntries={c.rosterEntries}
          availableRosterMembers={c.availableRosterMembers}
          roomCandidateViews={c.roomCandidateViews}
          availableCandidateMembers={c.availableCandidateMembers}
          isCandidatesLocked={c.isCandidatesLocked}
          candidateLockReason={c.candidateLockReason}
          onCopyInvite={() => void c.handleCopyInvite()}
          onToggleQr={c.toggleQr}
          onToggleRoomEntry={c.handleToggleEntry}
          onToggleLiveCandidateTally={c.handleToggleLiveCandidateTally}
          onSelectBannerOffice={c.setBannerOfficeLabel}
          onChangeOfficeBanner={c.handleChangeOfficeBanner}
          onBannerError={c.setBannerError}
          onAddRosterMember={c.handleAddRosterMember}
          onAddRosterAdHoc={c.handleAddRosterAdHoc}
          onRemoveRosterEntry={c.handleRemoveRosterEntry}
          onPrintSingleCard={(entry) => void c.handlePrintSingleCard(entry)}
          onToggleRosterPaperMode={c.handleToggleRosterPaperMode}
          onAddRoomCandidate={c.handleAddRoomCandidate}
          onRemoveRoomCandidate={c.handleRemoveRoomCandidate}
          onReloadRoom={c.bumpRefresh}
          onActionError={c.setActionError}
        />
      ) : null}

      {c.activeTab === "conduzir" ? (
        <RoomConductTab
          room={room}
          isActive={c.isActive}
          isBusy={c.isBusy}
          refreshTick={c.refreshTick}
          resolvedOffices={c.resolvedOffices}
          roomCandidateViews={c.roomCandidateViews}
          onRefresh={c.bumpRefresh}
          onToggleLiveCandidateTally={c.handleToggleLiveCandidateTally}
          onSavePaperTally={c.handleSavePaperTally}
        />
      ) : null}

      {c.activeTab === "resultado" ? (
        <RoomResultsTab
          room={room}
          roomTypeLabel={c.roomTypeLabel}
          resolvedOffices={c.resolvedOffices}
          allOfficesElected={c.allOfficesElected}
          isElectedWinner={c.isElectedWinner}
          showWinnerHero={c.showWinnerHero}
          tieBreakRequired={c.tieBreakRequired}
          isBusy={c.isBusy}
          onDismissWinnerHero={c.dismissWinnerHero}
          onRestoreWinnerHero={c.restoreWinnerHero}
          onOpenSharePaper={() => c.setIsSharePaperOpen(true)}
          onResolveTie={c.handleResolveTie}
          onRevealResult={c.handleRevealResult}
        />
      ) : null}

      <RoomSingleCardPrintModal
        roomTitle={room.title}
        card={c.singlePrintCard}
        onClose={() => c.setSinglePrintCard(null)}
      />

      <ShareBoardPaper
        open={c.isSharePaperOpen}
        roomTitle={room.title}
        ministryLabel={c.roomTypeLabel}
        sessionDateLabel={formatSessionDate(room.createdAt)}
        entries={buildShareBoardEntries(
          c.resolvedOffices,
          c.roomTypeLabel,
          c.isElectedWinner ? (room.round?.tally?.winnerName ?? null) : null,
          c.winnerCandidate?.photoUrl ?? null,
          resolvePaperOriginForShare(c.tally, room.round?.officeLabel ?? c.roomTypeLabel),
          c.electedList,
        )}
        onClose={() => c.setIsSharePaperOpen(false)}
      />

      <EditRoomModal
        apiBase={c.apiBase}
        room={c.isEditModalOpen ? room : null}
        onClose={() => c.setIsEditModalOpen(false)}
        onSaved={c.bumpRefresh}
      />

      <RoomConfirmDialogs
        roomTitle={room.title}
        pendingConfirm={c.pendingConfirm}
        isBusy={c.isBusy}
        onCancel={() => c.setPendingConfirm(null)}
        onConfirm={c.handleConfirmAction}
      />
    </div>
  );
}
