import { useEffect, useState } from "react";
import { apiUrl } from "../api-url";
import {
  generateAccessCodes,
  listAccessCodes,
  revokeAccessCode,
  revokeAllAccessCodes,
} from "./rooms-api";
import type { MemberAccessCodeItem } from "./types";

const apiBase = apiUrl("");

export function AccessCodesPanel({
  roomId,
  refreshKey = 0,
  onCodesChanged,
  onPrintCards,
}: {
  roomId: string;
  refreshKey?: number;
  onCodesChanged?: () => void;
  onPrintCards?: (activeCodes: MemberAccessCodeItem[]) => void;
}) {
  const [accessCodes, setAccessCodes] = useState<MemberAccessCodeItem[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      setNotice(
        activeCount === 0
          ? "Nenhum membro elegível encontrado no rol. Cadastre membros primeiro."
          : `${activeCount} códigos ativos prontos para credenciamento.`,
      );
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
      setNotice(
        revokedCount === 0
          ? "Não havia códigos ativos para revogar."
          : `${revokedCount} código(s) revogado(s).`,
      );
      onCodesChanged?.();
    } catch {
      setError("Não foi possível revogar os códigos.");
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
          onClick={() => void handleRevokeAll()}
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
        <ul className="access-codes-list" aria-label="Códigos de acesso gerados">
          {accessCodes.map((item) => {
            const isRevoked = item.revokedAt !== null;
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
                  {!isRevoked ? (
                    <button
                      type="button"
                      className="ghost danger-text access-code-revoke-btn"
                      disabled={isBusy}
                      onClick={() => void handleRevokeSingle(item.id)}
                    >
                      Revogar
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
