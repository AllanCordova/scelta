import { ConfirmDialog } from "../shell/ConfirmDialog";
import type { PendingConfirmKind } from "./room-detail-helpers";

/**
 * Room-level confirmation modal for closing, deleting, or closing rounds with pending voters/paper tally.
 */
export function RoomConfirmDialogs({
  roomTitle,
  pendingConfirm,
  isBusy,
  onCancel,
  onConfirm,
}: {
  roomTitle: string;
  pendingConfirm: PendingConfirmKind | null;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: (kind: PendingConfirmKind) => void;
}) {
  return (
    <ConfirmDialog
      open={pendingConfirm !== null}
      title={
        pendingConfirm === "delete-room"
          ? "Excluir sala"
          : pendingConfirm === "close-room"
            ? "Fechar sala"
            : pendingConfirm === "close-pending-round"
              ? "Encerrar com votantes pendentes"
              : "Urna de papel sem lançamento"
      }
      description={
        pendingConfirm === "delete-room"
          ? `Tem certeza que deseja excluir a sala "${roomTitle}"? Essa ação não pode ser desfeita.`
          : pendingConfirm === "close-room"
            ? `Deseja fechar a sala "${roomTitle}" e marcá-la como Completa para histórico?`
            : pendingConfirm === "close-pending-round"
              ? "Nem todos os membros presentes votaram. Deseja encerrar o escrutínio assim mesmo? Os membros pendentes serão registrados como 'não votaram'."
              : "Há eleitores marcados para voto em papel nesta sala, mas nenhum total da urna de papel foi lançado neste escrutínio. Deseja encerrar mesmo assim sem cédulas de papel?"
      }
      confirmLabel={
        pendingConfirm === "delete-room"
          ? "Excluir"
          : pendingConfirm === "close-room"
            ? "Fechar sala"
            : pendingConfirm === "close-pending-round"
              ? "Encerrar escrutínio"
              : "Encerrar sem cédulas de papel"
      }
      tone={
        pendingConfirm === "close-room" ||
        pendingConfirm === "close-pending-round" ||
        pendingConfirm === "close-no-paper-ballots"
          ? "default"
          : "danger"
      }
      busy={isBusy}
      onCancel={onCancel}
      onConfirm={() => {
        if (pendingConfirm) {
          onConfirm(pendingConfirm);
        }
      }}
    />
  );
}
