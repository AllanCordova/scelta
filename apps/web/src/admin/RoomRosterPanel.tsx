import { useId, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "../shell/ConfirmDialog";

export type RosterEntryView = {
  id: string;
  memberId: string | null;
  fullName: string;
  birthDate: string | null;
  isEligibleVoter: boolean;
  accessCode: { id: string; code: string; revokedAt: string | null } | null;
  isPresent: boolean;
  votesOnPaper?: boolean;
};

export type AvailableMemberOption = {
  id: string;
  fullName: string;
  birthDate?: string | null;
};

export type RoomRosterPanelProps = {
  entries: RosterEntryView[];
  availableMembers: AvailableMemberOption[];
  isRoomClosed: boolean;
  onAddMember: (memberId: string) => Promise<void>;
  onAddAdHoc: (input: { fullName: string; birthDate?: string | null }) => Promise<void>;
  onRemoveEntry: (entryId: string) => Promise<void>;
  onPrintSingleCard: (entry: RosterEntryView) => void;
  onTogglePaperMode?: (entryId: string, votesOnPaper: boolean) => Promise<void>;
};

function hasActiveAccessCode(entry: RosterEntryView): boolean {
  return entry.accessCode !== null && entry.accessCode.revokedAt === null;
}

export function RoomRosterPanel({
  entries,
  availableMembers,
  isRoomClosed,
  onAddMember,
  onAddAdHoc,
  onRemoveEntry,
  onPrintSingleCard,
  onTogglePaperMode,
}: RoomRosterPanelProps) {
  const headingId = useId();
  const searchInputId = useId();
  const memberSelectId = useId();
  const adHocNameId = useId();
  const adHocBirthDateId = useId();

  const [search, setSearch] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [adHocName, setAdHocName] = useState("");
  const [adHocBirthDate, setAdHocBirthDate] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<RosterEntryView | null>(null);
  const [pendingPaperEnable, setPendingPaperEnable] = useState<RosterEntryView | null>(null);

  const paperCount = entries.filter((entry) => Boolean(entry.votesOnPaper)).length;

  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const filteredEntries =
    normalizedSearch.length > 0
      ? entries.filter(
          (entry) =>
            entry.fullName.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ||
            (entry.accessCode?.code.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ?? false),
        )
      : entries;

  async function handleAddFromDirectory(event: React.FormEvent) {
    event.preventDefault();
    if (isBusy || isRoomClosed || !selectedMemberId) {
      return;
    }
    setIsBusy(true);
    try {
      await onAddMember(selectedMemberId);
      setSelectedMemberId("");
    } catch {
      toast.error("Não foi possível adicionar o membro ao rol.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAddAdHocSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = adHocName.trim();
    if (isBusy || isRoomClosed || trimmedName.length === 0) {
      return;
    }
    setIsBusy(true);
    try {
      await onAddAdHoc({
        fullName: trimmedName,
        birthDate: adHocBirthDate.trim().length > 0 ? adHocBirthDate.trim() : null,
      });
      setAdHocName("");
      setAdHocBirthDate("");
    } catch {
      toast.error("Não foi possível adicionar o eleitor avulso.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirmRemove() {
    if (!pendingRemove || isBusy || isRoomClosed) {
      return;
    }
    const target = pendingRemove;
    setPendingRemove(null);
    setIsBusy(true);
    try {
      await onRemoveEntry(target.id);
    } catch {
      toast.error("Não foi possível remover o eleitor do rol.");
    } finally {
      setIsBusy(false);
    }
  }

  async function runTogglePaperMode(entry: RosterEntryView, votesOnPaper: boolean) {
    if (!onTogglePaperMode || isBusy || isRoomClosed) {
      return;
    }
    setIsBusy(true);
    try {
      await onTogglePaperMode(entry.id, votesOnPaper);
    } catch {
      toast.error("Não foi possível alterar o modo de votação.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirmPaperEnable() {
    if (!pendingPaperEnable) {
      return;
    }
    const target = pendingPaperEnable;
    setPendingPaperEnable(null);
    await runTogglePaperMode(target, true);
  }

  return (
    <section className="panel access-codes-card" aria-labelledby={headingId}>
      <div className="audit-feed-header">
        <h2 id={headingId}>Rol da sala</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span className="detail-kpi-pill">{entries.length} eleitores</span>
          {paperCount > 0 ? (
            <span className="detail-kpi-pill" data-testid="roster-paper-count">
              Papel: {paperCount}
            </span>
          ) : null}
        </div>
      </div>

      {isRoomClosed ? (
        <p className="muted">Sala encerrada. O rol de eleitores não pode mais ser alterado.</p>
      ) : (
        <div className="roster-add-forms">
          <form className="access-codes-issue" onSubmit={(e) => void handleAddFromDirectory(e)}>
            <label htmlFor={memberSelectId}>Adicionar do cadastro</label>
            <div className="token-input-row">
              <select
                id={memberSelectId}
                value={selectedMemberId}
                disabled={isBusy || availableMembers.length === 0}
                onChange={(event) => setSelectedMemberId(event.target.value)}
              >
                <option value="">
                  {availableMembers.length === 0
                    ? "Nenhum membro disponível"
                    : "Selecione um membro…"}
                </option>
                {availableMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="ghost round-action"
                data-testid="add-roster-member-btn"
                disabled={isBusy || !selectedMemberId}
              >
                Adicionar do cadastro
              </button>
            </div>
          </form>

          <form className="access-codes-issue" onSubmit={(e) => void handleAddAdHocSubmit(e)}>
            <label htmlFor={adHocNameId}>Adicionar avulso</label>
            <div className="token-input-row">
              <input
                id={adHocNameId}
                type="text"
                value={adHocName}
                disabled={isBusy}
                onChange={(event) => setAdHocName(event.target.value)}
                placeholder="Nome completo (avulso)"
                aria-label="Nome completo (avulso)"
              />
              <input
                id={adHocBirthDateId}
                type="date"
                value={adHocBirthDate}
                disabled={isBusy}
                onChange={(event) => setAdHocBirthDate(event.target.value)}
                aria-label="Data de nascimento"
              />
              <button
                type="submit"
                className="ghost round-action"
                data-testid="add-roster-adhoc-btn"
                disabled={isBusy || adHocName.trim().length === 0}
              >
                Adicionar avulso
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="member-search-row access-codes-search-row">
        <label htmlFor={searchInputId} className="sr-only">
          Buscar no rol
        </label>
        <input
          id={searchInputId}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar no rol…"
          aria-label="Buscar no rol"
        />
      </div>

      {filteredEntries.length === 0 ? (
        <p className="muted">
          {entries.length === 0 ? "Nenhum eleitor no rol desta sala." : "Nenhum eleitor encontrado."}
        </p>
      ) : (
        <ul className="access-codes-list" role="list" aria-label="Rol da sala">
          {filteredEntries.map((entry) => {
            const activeCode = hasActiveAccessCode(entry) ? entry.accessCode : null;
            return (
              <li key={entry.id} className="access-code-row" data-testid="roster-entry-row">
                <div className="access-code-info">
                  <span className="access-code-name">{entry.fullName}</span>
                  {activeCode ? (
                    <span className="access-code-pin">{activeCode.code}</span>
                  ) : null}
                </div>
                <div className="access-code-meta">
                  {entry.memberId === null ? (
                    <span className="access-code-badge">Avulso</span>
                  ) : null}
                  {entry.votesOnPaper ? (
                    <span className="access-code-badge" data-testid="paper-voter-badge">
                      Papel
                    </span>
                  ) : null}
                  {entry.isPresent ? (
                    <span className="access-code-badge active">Presente</span>
                  ) : null}
                  {!isRoomClosed && onTogglePaperMode ? (
                    <button
                      type="button"
                      className="ghost round-action"
                      data-testid="toggle-paper-mode-btn"
                      disabled={isBusy}
                      onClick={() =>
                        entry.votesOnPaper
                          ? void runTogglePaperMode(entry, false)
                          : setPendingPaperEnable(entry)
                      }
                    >
                      {entry.votesOnPaper ? "Voltar para online" : "Vota no papel"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost round-action"
                    data-testid="print-single-card-btn"
                    disabled={isBusy || activeCode === null}
                    onClick={() => onPrintSingleCard(entry)}
                  >
                    Imprimir cartão
                  </button>
                  <button
                    type="button"
                    className="ghost danger-text round-action"
                    data-testid="remove-roster-entry-btn"
                    disabled={isBusy || isRoomClosed}
                    onClick={() => setPendingRemove(entry)}
                  >
                    Remover
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remover do rol"
        description={
          pendingRemove
            ? `Remover ${pendingRemove.fullName} do rol da sala? O código de acesso será revogado, mas qualquer voto já registrado será preservado.`
            : ""
        }
        confirmLabel="Remover"
        tone="danger"
        busy={isBusy}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => void handleConfirmRemove()}
      />

      <ConfirmDialog
        open={pendingPaperEnable !== null}
        title="Marcar para voto em papel"
        description={
          pendingPaperEnable
            ? `Marcar ${pendingPaperEnable.fullName} para votar em papel? O código de acesso atual será revogado e qualquer sessão online ativa será encerrada.`
            : ""
        }
        confirmLabel="Confirmar voto em papel"
        busy={isBusy}
        onCancel={() => setPendingPaperEnable(null)}
        onConfirm={() => void handleConfirmPaperEnable()}
      />
    </section>
  );
}
