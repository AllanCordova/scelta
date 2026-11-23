import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiUrl } from "../api-url";
import { roundErrorMessage } from "./copy";
import {
  RoomRequestError,
  approveAllRoomEntryRequests,
  approveRoomEntryRequest,
  fetchRoomEntryRequests,
  rejectRoomEntryRequest,
  releaseRoomRosterName,
} from "./rooms-api";
import type {
  ClaimedParticipantItem,
  DisputedNameItem,
  RoomDetail,
  RoomEntryRequestItem,
} from "./types";

const apiBase = apiUrl("");
const POLL_MS = 2000;

export type RoomApprovalQueuePanelProps = {
  room: RoomDetail;
  refreshKey?: number;
  onChanged?: () => void;
};

/**
 * Desk panel for managing voter entry requests, disputed names, and claimed seats in approval mode.
 */
export function RoomApprovalQueuePanel({
  room,
  refreshKey = 0,
  onChanged,
}: RoomApprovalQueuePanelProps) {
  const [requests, setRequests] = useState<RoomEntryRequestItem[]>([]);
  const [claimedParticipants, setClaimedParticipants] = useState<ClaimedParticipantItem[]>([]);
  const [disputes, setDisputes] = useState<DisputedNameItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const isEntryOpen = room.entryOpen !== false;
  const maxParticipants =
    typeof room.maxParticipants === "number" && room.maxParticipants > 0
      ? room.maxParticipants
      : room.eligibleCount;
  const isRoomClosed = room.status === "closed";

  async function refreshQueue() {
    const data = await fetchRoomEntryRequests(apiBase, room.id);
    setRequests(data.requests);
    setClaimedParticipants(data.claimedParticipants);
    setDisputes(data.disputes);
    setLoadError(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchRoomEntryRequests(apiBase, room.id);
        if (!cancelled) {
          setRequests(data.requests);
          setClaimedParticipants(data.claimedParticipants);
          setDisputes(data.disputes);
          setLoadError(null);
        }
      } catch {
        if (!cancelled) {
          setLoadError("Não foi possível carregar a fila de aprovação da mesa.");
        }
      }
    }

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [room.id, refreshKey]);

  const pendingRequests = requests.filter((req) => req.status === "pending");

  async function handleApprove(request: RoomEntryRequestItem) {
    if (isBusy || isRoomClosed) {
      return;
    }
    setIsBusy(true);
    setActionError(null);
    try {
      await approveRoomEntryRequest(apiBase, room.id, request.id);
      await refreshQueue().catch(() => undefined);
      toast.success(`${request.displayName} aprovado(a) na sala.`);
      onChanged?.();
    } catch (error) {
      const msg = error instanceof RoomRequestError
        ? roundErrorMessage(error.errorCode)
        : "Não foi possível aprovar o pedido de entrada.";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReject(request: RoomEntryRequestItem) {
    if (isBusy || isRoomClosed) {
      return;
    }
    setIsBusy(true);
    setActionError(null);
    try {
      await rejectRoomEntryRequest(apiBase, room.id, request.id);
      await refreshQueue().catch(() => undefined);
      toast.info(`Pedido de ${request.displayName} recusado.`);
      onChanged?.();
    } catch (error) {
      const msg = error instanceof RoomRequestError
        ? roundErrorMessage(error.errorCode)
        : "Não foi possível recusar o pedido.";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleApproveAll() {
    if (isBusy || isRoomClosed || pendingRequests.length === 0) {
      return;
    }
    setIsBusy(true);
    setActionError(null);
    try {
      const result = await approveAllRoomEntryRequests(apiBase, room.id);
      await refreshQueue().catch(() => undefined);
      toast.success(
        result.approvedCount === 1
          ? "1 pedido aprovado."
          : `${result.approvedCount} pedidos aprovados.`,
      );
      onChanged?.();
    } catch (error) {
      const msg = error instanceof RoomRequestError
        ? roundErrorMessage(error.errorCode)
        : "Não foi possível aprovar todos os pedidos.";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReleaseName(target: {
    rosterEntryId?: string;
    participantId?: string;
    displayName: string;
  }) {
    if (isBusy || isRoomClosed) {
      return;
    }
    setIsBusy(true);
    setActionError(null);
    try {
      await releaseRoomRosterName(apiBase, room.id, {
        ...(target.rosterEntryId ? { rosterEntryId: target.rosterEntryId } : {}),
        ...(target.participantId ? { participantId: target.participantId } : {}),
      });
      await refreshQueue().catch(() => undefined);
      toast.success(`Nome "${target.displayName}" liberado para nova entrada.`);
      onChanged?.();
    } catch {
      const msg = "Não foi possível expulsar e liberar este nome.";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section
      className="panel approval-queue-panel"
      aria-labelledby="approval-queue-heading"
      data-testid="approval-queue-panel"
    >
      <div className="audit-feed-header">
        <div className="approval-queue-title-group">
          <h2 id="approval-queue-heading">Fila de aprovação da mesa</h2>
          <span className="detail-kpi-pill" data-testid="approval-pending-count">
            {pendingRequests.length}{" "}
            {pendingRequests.length === 1 ? "pendente" : "pendentes"}
          </span>
        </div>
        <div className="approval-queue-meta">
          <span
            className={isEntryOpen ? "quorum-state badge-met" : "quorum-state badge-below"}
            data-testid="approval-entry-gate-status"
          >
            {isEntryOpen ? "Entrada aberta" : "Entrada encerrada"}
          </span>
          <span className="detail-kpi-pill" data-testid="approval-capacity-badge">
            {room.presence.presentCount} / {maxParticipants > 0 ? maxParticipants : "∞"}
          </span>
          <button
            type="button"
            className="round-action"
            data-testid="approve-all-entries-btn"
            disabled={isBusy || isRoomClosed || pendingRequests.length === 0}
            onClick={() => void handleApproveAll()}
          >
            Aprovar todos
          </button>
        </div>
      </div>

      {disputes.length > 0 ? (
        <div
          className="tiebreak-admin-box approval-dispute-box"
          role="alert"
          data-testid="disputed-name-alert"
        >
          <div className="tiebreak-admin-header">
            <strong>Alertas de nome disputado</strong>
            <p className="muted">
              Outro participante tentou reivindicar um nome que já estava em uso ou pendente.
              Confira com a assembleia e libere o nome se alguém entrou por engano.
            </p>
          </div>
          <ul className="access-codes-list" aria-label="Nomes disputados">
            {disputes.map((dispute) => (
              <li key={dispute.rosterEntryId} className="access-code-row">
                <div className="access-code-info">
                  <span className="access-code-name">
                    Nome disputado: {dispute.displayName} ({dispute.disputedAttemptCount}{" "}
                    {dispute.disputedAttemptCount === 1
                      ? "tentativa bloqueada"
                      : "tentativas bloqueadas"}
                    )
                  </span>
                  <span className="muted">
                    Situação atual:{" "}
                    {dispute.currentHolderStatus === "approved"
                      ? "Já entrou na sala"
                      : "Aguardando aprovação"}
                  </span>
                </div>
                <div className="access-code-meta">
                  <button
                    type="button"
                    className="ghost danger-text round-action"
                    data-testid="release-claimed-name-btn"
                    disabled={isBusy || isRoomClosed}
                    onClick={() =>
                      void handleReleaseName({
                        rosterEntryId: dispute.rosterEntryId,
                        ...(dispute.participantId ? { participantId: dispute.participantId } : {}),
                        displayName: dispute.displayName,
                      })
                    }
                  >
                    Expulsar e liberar nome
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {loadError ? (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      ) : null}

      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <div className="approval-queue-section">
        <h3>Pedidos aguardando aprovação</h3>
        {pendingRequests.length === 0 ? (
          <p className="muted">Nenhum pedido de entrada aguardando aprovação no momento.</p>
        ) : (
          <ul className="access-codes-list" aria-label="Pedidos pendentes">
            {pendingRequests.map((req) => (
              <li key={req.id} className="access-code-row">
                <div className="access-code-info">
                  <span className="access-code-name">{req.displayName}</span>
                  <span className="muted">
                    Pedido às {formatTime(req.createdAt)}
                    {req.disputedAttemptCount > 0
                      ? ` • ${req.disputedAttemptCount} disputa(s)`
                      : ""}
                  </span>
                </div>
                <div className="access-code-meta">
                  {req.disputedAttemptCount > 0 ? (
                    <span className="access-code-badge revoked">Disputado</span>
                  ) : null}
                  <button
                    type="button"
                    className="round-action"
                    data-testid="approve-entry-btn"
                    disabled={isBusy || isRoomClosed}
                    onClick={() => void handleApprove(req)}
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    className="ghost danger-text round-action"
                    data-testid="reject-entry-btn"
                    disabled={isBusy || isRoomClosed}
                    onClick={() => void handleReject(req)}
                  >
                    Recusar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {claimedParticipants.length > 0 ? (
        <div className="approval-queue-section">
          <h3>Nomes reivindicados na sala</h3>
          <ul className="access-codes-list" aria-label="Nomes reivindicados">
            {claimedParticipants.map((person) => (
              <li key={person.participantId} className="access-code-row">
                <div className="access-code-info">
                  <span className="access-code-name">{person.displayName}</span>
                  <span className="muted">
                    {person.isPresent ? "Presente" : "Sessão vinculada"} • Entrou às{" "}
                    {formatTime(person.joinedAt)}
                  </span>
                </div>
                <div className="access-code-meta">
                  {person.disputedAttemptCount > 0 ? (
                    <span className="access-code-badge revoked">
                      {person.disputedAttemptCount} disputa(s)
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="ghost danger-text round-action"
                    data-testid="expel-and-release-name-btn"
                    disabled={isBusy || isRoomClosed}
                    onClick={() =>
                      void handleReleaseName({
                        ...(person.rosterEntryId ? { rosterEntryId: person.rosterEntryId } : {}),
                        participantId: person.participantId,
                        displayName: person.displayName,
                      })
                    }
                  >
                    Expulsar e liberar nome
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
