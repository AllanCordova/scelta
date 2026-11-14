import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { RoomRequestError, updateRoom } from "./rooms-api";
import type { QuorumUnit, RoomSummary } from "./types";

type EditRoomModalProps = {
  apiBase: string;
  room: RoomSummary | null;
  onClose: () => void;
  onSaved: (updated: RoomSummary) => void;
};

type EditableRoomStatus = "draft" | "open" | "closed";

const editRoomSchema = z
  .object({
    title: z.string().trim().min(1, "Informe o título da sala.").max(200),
    quorumUnit: z.enum(["absolute", "percent"]),
    quorumValue: z.number().int().min(1, "Informe um quórum mínimo válido."),
    eligibleCount: z.number().int().min(0, "Informe um número válido de aptos."),
    status: z.enum(["draft", "open", "closed"]),
  })
  .superRefine((data, ctx) => {
    if (data.quorumUnit === "percent" && data.quorumValue > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quorumValue"],
        message: "O quórum percentual deve estar entre 1% e 100%.",
      });
    }
  });

function initialEditableStatus(status: RoomSummary["status"]): EditableRoomStatus {
  if (status === "draft") {
    return "draft";
  }
  if (status === "closed") {
    return "closed";
  }
  return "open";
}

/**
 * Modal dialog for editing an existing room's title, status, quorum, and eligible count,
 * mirroring the edit modal pattern used for members.
 */
export function EditRoomModal({ apiBase, room, onClose, onSaved }: EditRoomModalProps) {
  if (!room) {
    return null;
  }

  return <EditRoomForm key={room.id} apiBase={apiBase} room={room} onClose={onClose} onSaved={onSaved} />;
}

function EditRoomForm({
  apiBase,
  room,
  onClose,
  onSaved,
}: {
  apiBase: string;
  room: RoomSummary;
  onClose: () => void;
  onSaved: (updated: RoomSummary) => void;
}) {
  const [title, setTitle] = useState(room.title);
  const [status, setStatus] = useState<EditableRoomStatus>(() =>
    initialEditableStatus(room.status),
  );
  const [quorumUnit, setQuorumUnit] = useState<QuorumUnit>(room.quorumUnit);
  const [quorumValue, setQuorumValue] = useState(String(room.quorumValue));
  const [eligibleCount, setEligibleCount] = useState(String(room.eligibleCount));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = editRoomSchema.safeParse({
      title,
      quorumUnit,
      quorumValue: Number(quorumValue),
      eligibleCount: Number(eligibleCount),
      status,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revise os dados da sala.");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const updated = await updateRoom(apiBase, room.id, parsed.data);
      toast.success("Sala atualizada.");
      onSaved(updated);
      onClose();
    } catch (err) {
      if (err instanceof RoomRequestError && err.details[0]?.field === "quorumValue") {
        setError("Quórum inválido para a unidade selecionada.");
      } else {
        setError("Não foi possível atualizar a sala.");
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isSaving) {
          onClose();
        }
      }}
    >
      <div
        className="panel member-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-room-dialog-title"
      >
        <h2 id="edit-room-dialog-title">Editar sala</h2>
        <form className="member-manual-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="member-manual-grid">
            <div>
              <label htmlFor="edit-room-title">Título da sala</label>
              <input
                id="edit-room-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ex.: Eleição de Diáconos"
              />
            </div>
            <div>
              <label htmlFor="edit-room-status">Situação</label>
              <select
                id="edit-room-status"
                value={status}
                onChange={(event) => setStatus(event.target.value as EditableRoomStatus)}
              >
                <option value="draft">Rascunho</option>
                <option value="open">Aberta</option>
                <option value="closed">Completa</option>
              </select>
            </div>
            <div>
              <label htmlFor="edit-room-quorum-unit">Unidade do quórum</label>
              <select
                id="edit-room-quorum-unit"
                value={quorumUnit}
                onChange={(event) => setQuorumUnit(event.target.value as QuorumUnit)}
              >
                <option value="absolute">Membros</option>
                <option value="percent">Porcentagem (%)</option>
              </select>
            </div>
            <div>
              <label htmlFor="edit-room-quorum-value">Quórum mínimo</label>
              <input
                id="edit-room-quorum-value"
                type="number"
                min={1}
                max={quorumUnit === "percent" ? 100 : 100000}
                value={quorumValue}
                onChange={(event) => setQuorumValue(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="edit-room-eligible">Aptos a votar</label>
              <input
                id="edit-room-eligible"
                type="number"
                min={0}
                max={100000}
                value={eligibleCount}
                onChange={(event) => setEligibleCount(event.target.value)}
              />
            </div>
          </div>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="confirm-dialog-actions">
            <button type="button" className="ghost" disabled={isSaving} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" disabled={isSaving}>
              {isSaving ? "Salvando…" : "Salvar alterações"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
