import { useState } from "react";
import { ImageDropzone } from "../shell/ImageDropzone";
import { RoomCandidatesPanel } from "./RoomCandidatesPanel";
import { RoomRosterPanel, type RosterEntryView } from "./RoomRosterPanel";
import { RoomSimulatorPanel } from "./RoomSimulatorPanel";
import { ENTRY_MODE_LABELS } from "./copy";
import { candidateInitials, formatSessionDate } from "./room-detail-helpers";
import type { OfficeProgressItem, RoomDetail, RoomRosterEntryItem } from "./types";

export type AvailableMemberChoice = {
  id: string;
  fullName: string;
  birthDate?: string | null;
};

export type RoomPrepareTabProps = {
  room: RoomDetail;
  roomTypeLabel: string;
  offices: readonly OfficeProgressItem[];
  fullInviteUrl: string | null;
  isCopied: boolean;
  isQrVisible: boolean;
  qrSvg: string | null;
  isBusy: boolean;
  effectiveBannerOffice: string | null;
  activeBannerUrl: string | null;
  bannerError: string | null;
  rosterEntries: RoomRosterEntryItem[];
  availableRosterMembers: AvailableMemberChoice[];
  roomCandidateViews: {
    id: string;
    memberId: string | null;
    displayName: string;
    isEligible: boolean;
  }[];
  availableCandidateMembers: AvailableMemberChoice[];
  isCandidatesLocked: boolean;
  candidateLockReason?: string;
  onCopyInvite: () => void;
  onToggleQr: () => void;
  onToggleRoomEntry: () => void;
  onToggleLiveCandidateTally: (enabled: boolean) => void;
  onSelectBannerOffice: (officeLabel: string) => void;
  onChangeOfficeBanner: (nextUrl: string | null) => void;
  onBannerError: (msg: string | null) => void;
  onAddRosterMember: (memberId: string) => Promise<void>;
  onAddRosterAdHoc: (input: { fullName: string; birthDate?: string | null }) => Promise<void>;
  onRemoveRosterEntry: (entryId: string) => Promise<void>;
  onPrintSingleCard: (entry: RosterEntryView) => void;
  onToggleRosterPaperMode: (entryId: string, votesOnPaper: boolean) => Promise<void>;
  onAddRoomCandidate: (input: { memberId?: string; displayName?: string }) => Promise<void>;
  onRemoveRoomCandidate: (candidateId: string) => Promise<void>;
  onReloadRoom: () => void;
  onActionError: (msg: string | null) => void;
};

/**
 * Preparar tab: invite/QR/entry configuration (single place), regimental rules, banners,
 * candidates, room roster, and test-room simulator.
 */
export function RoomPrepareTab({
  room,
  roomTypeLabel,
  offices,
  fullInviteUrl,
  isCopied,
  isQrVisible,
  qrSvg,
  isBusy,
  effectiveBannerOffice,
  activeBannerUrl,
  bannerError,
  rosterEntries,
  availableRosterMembers,
  roomCandidateViews,
  availableCandidateMembers,
  isCandidatesLocked,
  candidateLockReason,
  onCopyInvite,
  onToggleQr,
  onToggleRoomEntry,
  onToggleLiveCandidateTally,
  onSelectBannerOffice,
  onChangeOfficeBanner,
  onBannerError,
  onAddRosterMember,
  onAddRosterAdHoc,
  onRemoveRosterEntry,
  onPrintSingleCard,
  onToggleRosterPaperMode,
  onAddRoomCandidate,
  onRemoveRoomCandidate,
  onReloadRoom,
  onActionError,
}: RoomPrepareTabProps) {
  const [bannerOfficeExpanded] = useState(true);
  const totalVacancies = room.vacancies ?? 1;
  const electedList = room.electedCandidates ?? [];
  const remainingVacancies =
    typeof room.remainingVacancies === "number"
      ? room.remainingVacancies
      : Math.max(0, totalVacancies - electedList.length);
  const effectiveMaxParticipants =
    typeof room.maxParticipants === "number" && room.maxParticipants > 0
      ? room.maxParticipants
      : room.eligibleCount > 0
        ? room.eligibleCount
        : "∞";

  return (
    <div className="room-tab-stack" role="tabpanel" aria-label="Preparar">
      <div className="detail-main-grid">
        <section className="panel regimental-details-card" aria-labelledby="invite-entry-heading">
          <div className="audit-feed-header">
            <h2 id="invite-entry-heading">Convite &amp; Entrada</h2>
            {room.status !== "closed" ? (
              <button
                type="button"
                className="ghost round-action"
                data-testid="toggle-room-entry-btn"
                disabled={isBusy}
                onClick={onToggleRoomEntry}
              >
                {room.entryOpen === false ? "Reabrir entrada" : "Encerrar entrada"}
              </button>
            ) : null}
          </div>

          <dl className="regimental-dl">
            <div className="regimental-row">
              <dt>Modo de Entrada</dt>
              <dd>{ENTRY_MODE_LABELS[room.entryMode ?? "codigo"]}</dd>
            </div>
            <div className="regimental-row">
              <dt>Porta de Entrada</dt>
              <dd>{room.entryOpen === false ? "Entrada encerrada" : "Entrada aberta"}</dd>
            </div>
            <div className="regimental-row">
              <dt>Código Curto</dt>
              <dd>
                <strong data-testid="room-short-code">{room.shortCode}</strong>
              </dd>
            </div>
            <div className="regimental-row">
              <dt>Limite de Participantes</dt>
              <dd>{`${room.presence.presentCount} / ${effectiveMaxParticipants}`}</dd>
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
                  onClick={onCopyInvite}
                >
                  {isCopied ? "Link copiado" : "Copiar link"}
                </button>
                <button type="button" className="ghost round-action" onClick={onToggleQr}>
                  QR Code
                </button>
              </div>
            </div>
          ) : null}

          {isQrVisible && fullInviteUrl ? (
            <div className="detail-qr-drawer" aria-label="Convite">
              <div className="invite-header">
                <h3>QR Code do Convite</h3>
                <button type="button" className="ghost round-action" onClick={onToggleQr}>
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
            {totalVacancies > 1 ? (
              <div className="regimental-row">
                <dt>Vagas</dt>
                <dd>
                  {electedList.length} eleitos de {totalVacancies} ({remainingVacancies}{" "}
                  {remainingVacancies === 1 ? "restante" : "restantes"})
                </dd>
              </div>
            ) : null}
            <div className="regimental-row">
              <dt>Início da Sessão</dt>
              <dd>{formatSessionDate(room.createdAt)}</dd>
            </div>
          </dl>

          <label className="telao-partial-toggle">
            <input
              type="checkbox"
              data-testid="toggle-live-candidate-tally"
              checked={Boolean(room.showLiveCandidateTally)}
              disabled={isBusy || room.status === "closed"}
              onChange={(event) => onToggleLiveCandidateTally(event.target.checked)}
            />
            <span>Mostrar parcial por candidato no telão durante o escrutínio</span>
          </label>
        </section>
      </div>

      {bannerOfficeExpanded ? (
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
                  onChange={(event) => onSelectBannerOffice(event.target.value)}
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
            onChange={onChangeOfficeBanner}
            onError={onBannerError}
          />
          {bannerError ? (
            <p className="field-error" role="alert">
              {bannerError}
            </p>
          ) : null}
        </section>
      ) : null}

      <RoomCandidatesPanel
        candidates={roomCandidateViews}
        availableMembers={availableCandidateMembers}
        isLocked={isCandidatesLocked}
        lockReason={candidateLockReason}
        onAddCandidate={onAddRoomCandidate}
        onRemoveCandidate={onRemoveRoomCandidate}
      />

      <RoomRosterPanel
        entries={rosterEntries}
        availableMembers={availableRosterMembers}
        isRoomClosed={room.status === "closed"}
        onAddMember={onAddRosterMember}
        onAddAdHoc={onAddRosterAdHoc}
        onRemoveEntry={onRemoveRosterEntry}
        onPrintSingleCard={onPrintSingleCard}
        onTogglePaperMode={onToggleRosterPaperMode}
      />

      {room.status === "test" ? (
        <RoomSimulatorPanel
          room={room}
          onChanged={onReloadRoom}
          onActionError={onActionError}
        />
      ) : null}
    </div>
  );
}
