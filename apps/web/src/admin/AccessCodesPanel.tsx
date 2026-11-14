import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiUrl } from "../api-url";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import {
  deleteAccessCode,
  generateAccessCodes,
  listAccessCodes,
  revokeAccessCode,
  revokeAllAccessCodes,
} from "./rooms-api";
import type { MemberAccessCodeItem } from "./types";

const apiBase = apiUrl("");
const PAGE_SIZE = 10;

export function AccessCodesPanel({
  roomId,
  inviteUrl = null,
  refreshKey = 0,
  onCodesChanged,
  onPrintCards,
}: {
  roomId: string;
  inviteUrl?: string | null;
  refreshKey?: number;
  onCodesChanged?: () => void;
  onPrintCards?: (activeCodes: MemberAccessCodeItem[]) => void;
}) {
  const [accessCodes, setAccessCodes] = useState<MemberAccessCodeItem[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    | { type: "revoke-single"; code: MemberAccessCodeItem }
    | { type: "revoke-all" }
    | { type: "delete-single"; code: MemberAccessCodeItem }
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void listAccessCodes(apiBase, roomId)
      .then((next) => {
        if (!cancelled) {
          setAccessCodes(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccessCodes([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, refreshKey]);

  const activeCodes = accessCodes.filter((item) => item.revokedAt === null);
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const filteredCodes =
    normalizedSearch.length > 0
      ? accessCodes.filter(
          (item) =>
            item.displayName.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ||
            item.code.toLocaleLowerCase("pt-BR").includes(normalizedSearch),
        )
      : accessCodes;
  const totalPages = Math.max(1, Math.ceil(filteredCodes.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedCodes = filteredCodes.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  async function handleCopyDirectLink(url: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url).catch(() => undefined);
    }
    toast.success("Link de acesso copiado.");
  }

  async function handleCopyCode(code: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code).catch(() => undefined);
    }
    toast.success("Código de acesso copiado.");
  }

  async function handleGenerate() {
    if (isBusy) {
      return;
    }
    setError(null);
    setNotice(null);
    setIsBusy(true);
    try {
      const next = await generateAccessCodes(apiBase, roomId);
      setAccessCodes(next);
      const activeCount = next.filter((item) => item.revokedAt === null).length;
      const msg =
        activeCount === 0
          ? "Nenhum membro elegível encontrado no rol. Cadastre membros primeiro."
          : `${activeCount} códigos ativos prontos para credenciamento.`;
      setNotice(msg);
      if (activeCount === 0) {
        toast.info(msg);
      } else {
        toast.success(msg);
      }
      onCodesChanged?.();
    } catch {
      setError("Não foi possível gerar os códigos de acesso.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRevokeSingle(codeId: string) {
    if (isBusy) {
      return;
    }
    setError(null);
    setNotice(null);
    setIsBusy(true);
    try {
      const updated = await revokeAccessCode(apiBase, roomId, codeId);
      setAccessCodes((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast.success("Código de acesso revogado.");
      onCodesChanged?.();
    } catch {
      setError("Não foi possível revogar o código.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRevokeAll() {
    if (isBusy) {
      return;
    }
    setError(null);
    setNotice(null);
    setIsBusy(true);
    try {
      const { revokedCount } = await revokeAllAccessCodes(apiBase, roomId);
      const next = await listAccessCodes(apiBase, roomId).catch(() => accessCodes);
      setAccessCodes(next);
      const msg =
        revokedCount === 0
          ? "Não havia códigos ativos para revogar."
          : `${revokedCount} código(s) revogado(s).`;
      setNotice(msg);
      toast.success(msg);
      onCodesChanged?.();
    } catch {
      setError("Não foi possível revogar os códigos.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteSingle(codeId: string) {
    if (isBusy) {
      return;
    }
    setError(null);
    setNotice(null);
    setIsBusy(true);
    try {
      await deleteAccessCode(apiBase, roomId, codeId);
      setAccessCodes((current) => current.filter((item) => item.id !== codeId));
      toast.success("Código de acesso removido.");
      onCodesChanged?.();
    } catch {
      setError("Não foi possível remover o código.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="panel access-codes-card" aria-labelledby="access-codes-heading">
      <div className="audit-feed-header">
        <h2 id="access-codes-heading">Códigos de Acesso</h2>
        <span className="detail-kpi-pill">{activeCodes.length} ativos</span>
      </div>
      <p className="muted">
        Gere os códigos individuais do rol para imprimir a folha A4 e entregue na entrada.
        Revogue códigos perdidos ou ao fim da assembleia.
      </p>
      <div className="access-codes-actions">
        <button
          type="button"
          className="round-action"
          disabled={isBusy}
          onClick={() => void handleGenerate()}
        >
          Gerar códigos do rol
        </button>
        {onPrintCards ? (
          <button
            type="button"
            className="ghost round-action"
            disabled={isBusy || activeCodes.length === 0}
            onClick={() => onPrintCards(activeCodes)}
          >
            Imprimir cartões A4
          </button>
        ) : null}
        <button
          type="button"
          className="ghost danger-text round-action"
          disabled={isBusy || activeCodes.length === 0}
          onClick={() => setPendingAction({ type: "revoke-all" })}
        >
          Revogar todos
        </button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="simulator-status" role="status">
          {notice}
        </p>
      ) : null}
      {accessCodes.length > 0 ? (
        <>
          <div className="member-search-row access-codes-search-row">
            <label htmlFor="access-codes-search-input" className="sr-only">
              Buscar código por nome
            </label>
            <input
              id="access-codes-search-input"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Buscar por nome…"
            />
          </div>
          {paginatedCodes.length === 0 ? (
            <p className="muted">Nenhum código encontrado.</p>
          ) : (
            <ul className="access-codes-list" aria-label="Códigos de acesso gerados">
              {paginatedCodes.map((item) => {
                const isRevoked = item.revokedAt !== null;
                const directUrl =
                  !isRevoked && inviteUrl
                    ? `${inviteUrl}?code=${encodeURIComponent(item.code)}`
                    : null;
                return (
                  <li
                    key={item.id}
                    className={isRevoked ? "access-code-row revoked" : "access-code-row"}
                  >
                    <div className="access-code-info">
                      <span className="access-code-name">{item.displayName}</span>
                      <span className="access-code-pin">{item.code}</span>
                    </div>
                    <div className="access-code-meta">
                      <span
                        className={
                          isRevoked ? "access-code-badge revoked" : "access-code-badge active"
                        }
                      >
                        {isRevoked ? "Revogado" : "Ativo"}
                      </span>
                      <button
                        type="button"
                        className="ghost access-code-copy-btn"
                        onClick={() => void handleCopyCode(item.code)}
                      >
                        Copiar código
                      </button>
                      {directUrl ? (
                        <button
                          type="button"
                          className="ghost access-code-copy-btn"
                          onClick={() => void handleCopyDirectLink(directUrl)}
                        >
                          Copiar link
                        </button>
                      ) : null}
                      {!isRevoked ? (
                        <button
                          type="button"
                          className="ghost danger-text access-code-revoke-btn"
                          disabled={isBusy}
                          onClick={() => setPendingAction({ type: "revoke-single", code: item })}
                        >
                          Revogar
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ghost danger-text access-code-delete-btn"
                        disabled={isBusy}
                        onClick={() => setPendingAction({ type: "delete-single", code: item })}
                      >
                        Remover
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="pagination-bar" aria-label="Paginação de códigos de acesso">
            <button
              type="button"
              className="ghost"
              disabled={currentPage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </button>
            <span className="muted">
              Página {currentPage} de {totalPages}
            </span>
            <button
              type="button"
              className="ghost"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Próxima
            </button>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={pendingAction !== null}
        title={
          pendingAction?.type === "revoke-all"
            ? "Revogar todos os códigos"
            : pendingAction?.type === "delete-single"
              ? "Remover código de acesso"
              : "Revogar código de acesso"
        }
        description={
          pendingAction?.type === "revoke-all"
            ? `Tem certeza que deseja revogar todos os ${activeCodes.length} códigos ativos desta sala?`
            : pendingAction?.type === "delete-single"
              ? `Tem certeza que deseja remover permanentemente o código de "${pendingAction.code.displayName}"?`
              : pendingAction
                ? `Tem certeza que deseja revogar o código de "${pendingAction.code.displayName}"?`
                : ""
        }
        confirmLabel={
          pendingAction?.type === "revoke-all"
            ? "Revogar todos"
            : pendingAction?.type === "delete-single"
              ? "Remover"
              : "Revogar"
        }
        busy={isBusy}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          const target = pendingAction;
          setPendingAction(null);
          if (!target) {
            return;
          }
          if (target.type === "revoke-all") {
            void handleRevokeAll();
          } else if (target.type === "delete-single") {
            void handleDeleteSingle(target.code.id);
          } else {
            void handleRevokeSingle(target.code.id);
          }
        }}
      />
    </section>
  );
}
