import {
  CLOSE_ROUND_LABEL,
  DECLINE_ROUND_LABEL,
  OPEN_ROUND_LABEL,
  RESTART_ROUND_LABEL,
  STATUS_LABELS,
} from "./copy";
import type { OfficeProgressItem, RoomDetail } from "./types";

export type RoomDetailHeaderProps = {
  room: RoomDetail;
  roomTypeLabel: string;
  isActive: boolean;
  isBusy: boolean;
  actionError: string | null;
  openRoundId: string | null;
  tieBreakRequired: boolean;
  offices: readonly OfficeProgressItem[];
  unelectedOffices: readonly OfficeProgressItem[];
  effectiveSelectedOffice: string;
  allOfficesElected: boolean;
  allVacanciesFilled: boolean;
  totalVacancies: number;
  remainingVacancies: number;
  onSelectOffice: (officeLabel: string) => void;
  onOpenEditModal: () => void;
  onRequestCloseRoom: () => void;
  onRequestDeleteRoom: () => void;
  onOpenRound: (officeLabel?: string) => void;
  onCloseRound: (roundId: string) => void;
  onRestartRound: (roundId: string) => void;
  onDeclineRound: (roundId: string) => void;
};

/**
 * Top header bar for AdminRoomDetail showing status, Modo Telão link, and primary round controls.
 */
export function RoomDetailHeader({
  room,
  roomTypeLabel,
  isActive,
  isBusy,
  actionError,
  openRoundId,
  tieBreakRequired,
  offices,
  unelectedOffices,
  effectiveSelectedOffice,
  allOfficesElected,
  allVacanciesFilled,
  totalVacancies,
  remainingVacancies,
  onSelectOffice,
  onOpenEditModal,
  onRequestCloseRoom,
  onRequestDeleteRoom,
  onOpenRound,
  onCloseRound,
  onRestartRound,
  onDeclineRound,
}: RoomDetailHeaderProps) {
  return (
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
            {room.shortCode} • {roomTypeLabel} • Cédula Nominal Secreta
          </p>
        </div>

        <div className="room-header-actions">
          <a
            className="ghost round-action telao-header-link"
            href={`/telao/${encodeURIComponent(room.id)}`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-telao-btn"
          >
            Modo Telão
          </a>

          <button
            type="button"
            className="ghost round-action"
            disabled={isBusy}
            onClick={onOpenEditModal}
          >
            Editar
          </button>

          {room.status !== "closed" ? (
            <button
              type="button"
              className="ghost round-action"
              disabled={isBusy}
              onClick={onRequestCloseRoom}
            >
              Fechar sala
            </button>
          ) : null}

          <button
            type="button"
            className="ghost round-action danger-action"
            disabled={isBusy}
            onClick={onRequestDeleteRoom}
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
                  onClick={() => onRestartRound(openRoundId)}
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
                  onClick={() => onDeclineRound(room.round!.id)}
                >
                  {DECLINE_ROUND_LABEL}
                </button>
              ) : null}
              {!openRoundId && offices.length > 0 && unelectedOffices.length > 0 ? (
                <select
                  aria-label="Cargo para votação"
                  value={effectiveSelectedOffice}
                  disabled={isBusy}
                  onChange={(event) => onSelectOffice(event.target.value)}
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
                data-testid={
                  totalVacancies > 1 &&
                  !openRoundId &&
                  room.round?.status === "closed" &&
                  remainingVacancies > 0
                    ? "open-next-round-btn"
                    : undefined
                }
                disabled={
                  isBusy ||
                  (!openRoundId &&
                    (!room.presence.quorumMet ||
                      allOfficesElected ||
                      allVacanciesFilled ||
                      tieBreakRequired))
                }
                title={
                  !openRoundId && tieBreakRequired
                    ? "Limite de 3 escrutínios atingido. Resolva o desempate pelo mais velho abaixo."
                    : !openRoundId && allOfficesElected
                      ? "Todos os cargos da diretoria já foram eleitos."
                      : !openRoundId && allVacanciesFilled
                        ? "Todas as vagas da sala já foram preenchidas."
                        : !openRoundId && !room.presence.quorumMet
                          ? "Quórum mínimo não atingido para abrir o escrutínio."
                          : undefined
                }
                onClick={() =>
                  openRoundId
                    ? onCloseRound(openRoundId)
                    : onOpenRound(offices.length > 0 ? effectiveSelectedOffice : undefined)
                }
              >
                {openRoundId
                  ? CLOSE_ROUND_LABEL
                  : tieBreakRequired
                    ? "Desempate pendente (3º escrutínio)"
                    : allOfficesElected
                      ? "Todos os cargos eleitos"
                      : allVacanciesFilled
                        ? "Todas as vagas preenchidas"
                        : offices.length > 0 && effectiveSelectedOffice
                          ? `${OPEN_ROUND_LABEL} — ${effectiveSelectedOffice}`
                          : totalVacancies > 1 &&
                              room.round?.status === "closed" &&
                              remainingVacancies > 0
                            ? `Abrir próximo escrutínio (${remainingVacancies} ${remainingVacancies === 1 ? "vaga" : "vagas"})`
                            : OPEN_ROUND_LABEL}
              </button>
              {totalVacancies > 1 &&
              !openRoundId &&
              room.hasRounds &&
              remainingVacancies > 0 ? (
                <button
                  type="button"
                  className="ghost round-action"
                  data-testid="close-with-open-vacancies-btn"
                  disabled={isBusy}
                  onClick={onRequestCloseRoom}
                >
                  Encerrar com vagas em aberto
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}
    </section>
  );
}
