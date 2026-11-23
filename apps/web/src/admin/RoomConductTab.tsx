import { OfficeProgressGrid } from "../shell/OfficeProgressGrid";
import { RoomChatPanel } from "../shell/RoomChatPanel";
import { PaperTallyPanel, type PaperTallyFormValue } from "./PaperTallyPanel";
import { RoomApprovalQueuePanel } from "./RoomApprovalQueuePanel";
import { RoomPresencePanel } from "./RoomPresencePanel";
import { ROUND_RESTARTED_MESSAGE, quorumLabel, quorumStateLabel } from "./copy";
import type { OfficeProgressItem, RoomDetail } from "./types";

export type RoomConductTabProps = {
  room: RoomDetail;
  isActive: boolean;
  isBusy: boolean;
  refreshTick: number;
  resolvedOffices: readonly OfficeProgressItem[];
  roomCandidateViews: {
    id: string;
    memberId: string | null;
    displayName: string;
    isEligible: boolean;
  }[];
  onRefresh: () => void;
  onToggleLiveCandidateTally: (enabled: boolean) => void;
  onSavePaperTally: (payload: PaperTallyFormValue) => Promise<void>;
};

/**
 * Conduzir tab: live KPIs, board office progress, T6.3 telão toggle, desk approval queue,
 * room presence, paper tally, and live room chat.
 */
export function RoomConductTab({
  room,
  isActive,
  isBusy,
  refreshTick,
  resolvedOffices,
  roomCandidateViews,
  onRefresh,
  onToggleLiveCandidateTally,
  onSavePaperTally,
}: RoomConductTabProps) {
  const totalVacancies = room.vacancies ?? 1;
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

  return (
    <div className="room-tab-stack" role="tabpanel" aria-label="Conduzir">
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

      {room.round?.status === "open" && (room.round.restartCount ?? 0) > 0 ? (
        <p className="round-restarted">{ROUND_RESTARTED_MESSAGE}</p>
      ) : null}

      {room.status !== "closed" ? (
        <section className="panel telao-conduct-toggle-card" aria-label="Controle do telão">
          <label className="telao-partial-toggle">
            <input
              type="checkbox"
              data-testid="toggle-live-candidate-tally"
              checked={Boolean(room.showLiveCandidateTally)}
              disabled={isBusy}
              onChange={(event) => onToggleLiveCandidateTally(event.target.checked)}
            />
            <span>Mostrar parcial por candidato no telão durante o escrutínio</span>
          </label>
        </section>
      ) : null}

      {resolvedOffices.length > 0 ? (
        <section className="panel" aria-label="Cargos da diretoria (Ordem IPB)">
          <div className="section-header-row">
            <h2>Cargos da Diretoria (Ordem IPB)</h2>
          </div>
          <OfficeProgressGrid offices={resolvedOffices} />
        </section>
      ) : null}

      {room.entryMode === "aprovacao" ? (
        <RoomApprovalQueuePanel room={room} refreshKey={refreshTick} onChanged={onRefresh} />
      ) : null}

      {isActive ? (
        <RoomPresencePanel roomId={room.id} refreshKey={refreshTick} onChanged={onRefresh} />
      ) : null}

      {room.round?.status === "open" && paperVotersCount > 0 ? (
        <PaperTallyPanel
          key={`${room.round.id}-${room.round.vacancies ?? totalVacancies}-${room.round.paperTally?.updatedAt ?? "none"}`}
          candidates={roomCandidateViews}
          paperVotersCount={paperVotersCount}
          vacancies={room.round.vacancies ?? totalVacancies}
          initialTally={room.round.paperTally ?? null}
          disabled={isBusy}
          onSave={onSavePaperTally}
        />
      ) : null}

      <RoomChatPanel
        mode="admin"
        roomId={room.id}
        initialChatMuted={room.chatMuted}
        onRoomUpdated={onRefresh}
      />
    </div>
  );
}
