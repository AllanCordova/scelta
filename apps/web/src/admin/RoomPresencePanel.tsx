import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiUrl } from "../api-url";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import {
  expelParticipants,
  listPresentParticipants,
  type PresentParticipant,
} from "./rooms-api";

const apiBase = apiUrl("");
const POLL_MS = 3000;

export function RoomPresencePanel({
  roomId,
  refreshKey = 0,
  onChanged,
}: {
  roomId: string;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const [people, setPeople] = useState<PresentParticipant[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [pending, setPending] = useState<
    { type: "one"; person: PresentParticipant } | { type: "all" } | null
  >(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await listPresentParticipants(apiBase, roomId);
        if (!cancelled) {
          setPeople(next);
          setLoadError(null);
        }
      } catch {
        if (!cancelled) {
          setLoadError("Não foi possível listar quem está na sala.");
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
  }, [roomId, refreshKey]);

  async function expel(target: { all: true } | { participantId: string }) {
    if (isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      const { expelledCount } = await expelParticipants(apiBase, roomId, target);
      const next = await listPresentParticipants(apiBase, roomId).catch(() => people);
      setPeople(next);
      toast.success(
        expelledCount === 0
          ? "Não havia ninguém para expulsar."
          : target && "all" in target
            ? "Sala esvaziada. Os códigos de acesso continuam válidos."
            : "Pessoa removida da sala. O código dessa pessoa continua válido.",
      );
      onChanged?.();
    } catch {
      toast.error("Não foi possível expulsar da sala.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="panel access-codes-card" aria-labelledby="room-presence-heading">
      <div className="audit-feed-header">
        <h2 id="room-presence-heading">Pessoas na sala</h2>
        <span className="detail-kpi-pill">{people.length}</span>
      </div>
      <p className="muted">
        Expulsar tira a pessoa da contagem agora, sem revogar o código. Ela pode entrar de novo
        com o mesmo cartão.
      </p>
      {loadError ? <p className="muted">{loadError}</p> : null}
      {people.length === 0 ? (
        <p className="muted">Nenhuma pessoa na sala.</p>
      ) : (
        <ul className="access-codes-list" aria-label="Pessoas presentes">
          {people.map((person) => (
            <li key={person.id} className="access-code-row">
              <div className="access-code-info">
                <span className="access-code-name">{person.displayName}</span>
                <span className="muted">Entrou {formatJoinedAt(person.joinedAt)}</span>
              </div>
              <button
                type="button"
                className="ghost danger-text round-action"
                disabled={isBusy}
                onClick={() => setPending({ type: "one", person })}
              >
                Expulsar
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="access-codes-actions">
        <button
          type="button"
          className="ghost danger-text round-action"
          disabled={isBusy || people.length === 0}
          onClick={() => setPending({ type: "all" })}
        >
          Expulsar todas
        </button>
      </div>
      <ConfirmDialog
        open={pending !== null}
        title={pending?.type === "all" ? "Esvaziar a sala" : "Expulsar da sala"}
        description={
          pending?.type === "all"
            ? "Isso zera as pessoas presentes. Os códigos de acesso não são revogados."
            : pending?.type === "one"
              ? `Expulsar ${pending.person.displayName}? O código de acesso dessa pessoa continua válido.`
              : ""
        }
        confirmLabel={pending?.type === "all" ? "Expulsar todas" : "Expulsar"}
        busy={isBusy}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const target = pending;
          setPending(null);
          if (!target) {
            return;
          }
          if (target.type === "all") {
            void expel({ all: true });
          } else {
            void expel({ participantId: target.person.id });
          }
        }}
      />
    </section>
  );
}

function formatJoinedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
