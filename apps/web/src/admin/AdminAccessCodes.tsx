import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { apiUrl } from "../api-url";
import { AccessCodesPanel } from "./AccessCodesPanel";
import { inviteUrl } from "./room-draft";
import { listRooms } from "./rooms-api";
import type { MemberAccessCodeItem, RoomSummary } from "./types";

const apiBase = apiUrl("");

export function AdminAccessCodes() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printCards, setPrintCards] = useState<
    Array<{ id: string; displayName: string; code: string; qrUrl: string; loginUrl: string }> | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void listRooms(apiBase)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setRooms(loaded);
        if (loaded.length > 0 && loaded[0]) {
          setSelectedRoomId(loaded[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRooms([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? null;
  const fullInviteUrl = selectedRoom
    ? inviteUrl(window.location.origin, selectedRoom.invitePath ?? `/join/${selectedRoom.inviteToken}`)
    : null;

  async function handlePreparePrintCards(activeCodesList: MemberAccessCodeItem[]) {
    if (!fullInviteUrl) {
      return;
    }
    const activeCodes = activeCodesList
      .filter((item) => item.revokedAt === null)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
    if (activeCodes.length === 0) {
      setPrintError("Gere os códigos antes de imprimir os cartões.");
      return;
    }
    setPrintError(null);
    try {
      const cards = await Promise.all(
        activeCodes.map(async (item) => {
          const urlWithCode = `${fullInviteUrl}?code=${encodeURIComponent(item.code)}`;
          const qrUrl = await QRCode.toDataURL(urlWithCode, { margin: 1, width: 120 });
          return {
            id: item.id,
            displayName: item.displayName,
            code: item.code,
            qrUrl,
            loginUrl: urlWithCode,
          };
        }),
      );
      setPrintCards(cards);
    } catch {
      setPrintError("Não foi possível preparar os cartões para impressão.");
    }
  }

  return (
    <div className="admin-page">
      <a className="detail-back-link" href="/admin">
        ← Voltar para Administração
      </a>
      <header className="page-intro">
        <h1>Códigos de Acesso</h1>
        <p className="lede">
          Selecione uma sala para gerar, visualizar, imprimir e revogar códigos individuais de entrada.
        </p>
      </header>

      {isLoading ? (
        <section className="panel">
          <p className="muted">Carregando salas…</p>
        </section>
      ) : rooms.length === 0 ? (
        <section className="panel">
          <p className="muted">
            Nenhuma sala cadastrada. Crie uma sala em <a href="/admin/salas">Salas</a> primeiro.
          </p>
        </section>
      ) : (
        <>
          <section className="panel">
            <label htmlFor="access-codes-room-select">Sala</label>
            <select
              id="access-codes-room-select"
              value={selectedRoomId}
              onChange={(event) => {
                setSelectedRoomId(event.target.value);
                setPrintCards(null);
                setPrintError(null);
              }}
            >
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.title}
                </option>
              ))}
            </select>
          </section>

          {printError ? (
            <p className="form-error" role="alert">
              {printError}
            </p>
          ) : null}

          {selectedRoomId ? (
            <AccessCodesPanel
              roomId={selectedRoomId}
              inviteUrl={fullInviteUrl}
              onPrintCards={(active) => void handlePreparePrintCards(active)}
            />
          ) : null}
        </>
      )}

      {printCards && selectedRoom ? (
        <div className="print-cards-overlay" role="dialog" aria-label="Cartões de acesso para impressão">
          <div className="print-cards-toolbar no-print">
            <div>
              <h2>Cartões de Acesso — {selectedRoom.title}</h2>
              <p className="muted">
                {printCards.length} cartões ativos em ordem alfabética, prontos para impressão em A4.
              </p>
            </div>
            <div className="print-cards-toolbar-actions">
              <button
                type="button"
                className="round-action"
                onClick={() => window.print()}
              >
                Imprimir agora (A4)
              </button>
              <button
                type="button"
                className="ghost round-action"
                onClick={() => setPrintCards(null)}
              >
                Fechar
              </button>
            </div>
          </div>
          <div className="print-cards-grid">
            {printCards.map((card) => (
              <article key={card.id} className="print-card-item">
                <img
                  src={card.qrUrl}
                  alt={`QR Code de ${card.displayName}`}
                  width={104}
                  height={104}
                />
                <div className="print-card-details">
                  <span className="print-card-room">{selectedRoom.title}</span>
                  <strong className="print-card-name">{card.displayName}</strong>
                  <span className="print-card-code-label">Código de acesso:</span>
                  <code className="print-card-code">{card.code}</code>
                  <span className="print-card-url">{card.loginUrl}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
