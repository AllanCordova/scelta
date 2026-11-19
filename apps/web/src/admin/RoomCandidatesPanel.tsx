import { useId, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import type { AvailableMemberOption } from "./RoomRosterPanel";

export type RoomCandidateView = {
  id: string;
  memberId: string | null;
  displayName: string;
  isEligible: boolean;
};

export type RoomCandidatesPanelProps = {
  candidates: RoomCandidateView[];
  availableMembers: AvailableMemberOption[];
  isLocked: boolean;
  lockReason?: string;
  onAddCandidate: (input: { memberId?: string; displayName?: string }) => Promise<void>;
  onRemoveCandidate: (candidateId: string) => Promise<void>;
};

export function RoomCandidatesPanel({
  candidates,
  availableMembers,
  isLocked,
  lockReason,
  onAddCandidate,
  onRemoveCandidate,
}: RoomCandidatesPanelProps) {
  const headingId = useId();
  const memberSelectId = useId();
  const nameInputId = useId();

  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<RoomCandidateView | null>(null);

  const canSubmit = !isBusy && !isLocked && (selectedMemberId.length > 0 || displayName.trim().length > 0);

  async function handleAddSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setIsBusy(true);
    try {
      if (selectedMemberId) {
        await onAddCandidate({ memberId: selectedMemberId });
        setSelectedMemberId("");
      } else {
        await onAddCandidate({ displayName: displayName.trim() });
        setDisplayName("");
      }
    } catch {
      toast.error("Não foi possível adicionar o candidato.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirmRemove() {
    if (!pendingRemove || isBusy || isLocked) {
      return;
    }
    const target = pendingRemove;
    setPendingRemove(null);
    setIsBusy(true);
    try {
      await onRemoveCandidate(target.id);
    } catch {
      toast.error("Não foi possível remover o candidato.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="panel access-codes-card" aria-labelledby={headingId}>
      <div className="audit-feed-header">
        <h2 id={headingId}>Gerenciar candidatos</h2>
        <span className="detail-kpi-pill">{candidates.length}</span>
      </div>

      {isLocked ? (
        <p className="muted" role="status" data-testid="candidates-locked-notice">
          {lockReason ?? "Candidatos bloqueados após a abertura do 1º escrutínio."}
        </p>
      ) : (
        <form className="access-codes-issue" onSubmit={(e) => void handleAddSubmit(e)}>
          <label htmlFor={nameInputId}>Adicionar candidato</label>
          <div className="token-input-row">
            <select
              id={memberSelectId}
              aria-label="Selecionar membro do cadastro"
              value={selectedMemberId}
              disabled={isBusy || availableMembers.length === 0}
              onChange={(event) => {
                setSelectedMemberId(event.target.value);
                if (event.target.value) {
                  setDisplayName("");
                }
              }}
            >
              <option value="">
                {availableMembers.length === 0
                  ? "Nenhum membro disponível"
                  : "Selecionar do cadastro (opcional)…"}
              </option>
              {availableMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName}
                </option>
              ))}
            </select>
            <input
              id={nameInputId}
              type="text"
              data-testid="add-candidate-name-input"
              value={displayName}
              disabled={isBusy}
              onChange={(event) => {
                setDisplayName(event.target.value);
                if (event.target.value.trim().length > 0) {
                  setSelectedMemberId("");
                }
              }}
              placeholder="Nome do candidato"
              aria-label="Nome do candidato"
            />
            <button
              type="submit"
              className="ghost round-action"
              data-testid="add-candidate-btn"
              disabled={!canSubmit}
            >
              Adicionar candidato
            </button>
          </div>
        </form>
      )}

      {candidates.length === 0 ? (
        <p className="muted">Nenhum candidato cadastrado nesta sala.</p>
      ) : (
        <ul className="access-codes-list" role="list" aria-label="Candidatos da sala">
          {candidates.map((candidate) => (
            <li
              key={candidate.id}
              className="access-code-row"
              data-testid="candidate-manage-row"
            >
              <div className="access-code-info">
                <span className="access-code-name">{candidate.displayName}</span>
              </div>
              <div className="access-code-meta">
                {candidate.memberId === null ? (
                  <span className="access-code-badge">Avulso</span>
                ) : null}
                {!candidate.isEligible ? (
                  <span className="access-code-badge revoked">Inelegível</span>
                ) : null}
                {!isLocked ? (
                  <button
                    type="button"
                    className="ghost danger-text round-action"
                    data-testid="remove-candidate-btn"
                    disabled={isBusy}
                    onClick={() => setPendingRemove(candidate)}
                  >
                    Remover
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remover candidato"
        description={
          pendingRemove
            ? `Remover ${pendingRemove.displayName} da lista de candidatos desta sala?`
            : ""
        }
        confirmLabel="Remover"
        tone="danger"
        busy={isBusy}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => void handleConfirmRemove()}
      />
    </section>
  );
}
