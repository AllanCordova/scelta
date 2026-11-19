import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiUrl } from "../api-url";
import {
  fetchPublicConfig,
  hasOriginMismatch,
  resolvePublicOrigin,
  type PublicConfig,
} from "../config-api";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { AccessCodesPanel } from "./AccessCodesPanel";
import { paginateCardsForPrint } from "./card-pagination";
import { generateQrSvg } from "./qr-svg";
import { displayShortRoomUrl, inviteUrl, shortRoomUrl } from "./room-draft";
import { listRooms, rotateRoomInvite } from "./rooms-api";
import type { MemberAccessCodeItem, RoomSummary } from "./types";

const apiBase = apiUrl("");

export function AdminAccessCodes() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRotating, setIsRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({ publicUrl: null });
  const [printError, setPrintError] = useState<string | null>(null);
  const [printCards, setPrintCards] = useState<
    Array<{ id: string; displayName: string; code: string; qrSvg: string; displayUrl: string }> | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicConfig()
      .then((config) => {
        if (!cancelled) {
          setPublicConfig(config);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

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
  const publicOrigin = resolvePublicOrigin(publicConfig.publicUrl, window.location.origin);
  const originMismatch = hasOriginMismatch(publicConfig.publicUrl, window.location.origin);
  const fullInviteUrl = selectedRoom
    ? inviteUrl(publicOrigin, selectedRoom.invitePath ?? `/join/${selectedRoom.inviteToken}`)
    : null;

  async function handleRotateInvite() {
    if (!selectedRoom || isRotating) {
      return;
    }
    setIsRotating(true);
    try {
      const updated = await rotateRoomInvite(apiBase, selectedRoom.id);
      setRooms((current) =>
        current.map((room) => (room.id === updated.id ? updated : room)),
      );
      setPrintCards(null);
      toast.success("Link de convite rotacionado.");
    } catch {
      toast.error("Não foi possível rotacionar o convite da sala.");
    } finally {
      setIsRotating(false);
    }
  }

  async function handlePreparePrintCards(activeCodesList: MemberAccessCodeItem[]) {
    if (!selectedRoom) {
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
      const displayUrl = displayShortRoomUrl(publicOrigin, selectedRoom.shortCode);
      const cards = await Promise.all(
        activeCodes.map(async (item) => {
          const urlWithCode = shortRoomUrl(publicOrigin, selectedRoom.shortCode, item.code);
          const qrSvg = await generateQrSvg(urlWithCode);
          return {
            id: item.id,
            displayName: item.displayName,
            code: item.code,
            qrSvg,
            displayUrl,
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

      {originMismatch ? (
        <div
          className="tiebreak-admin-box no-print"
          role="status"
          data-testid="public-url-mismatch-warning"
        >
          <p>
            Você está acessando o painel por <strong>{window.location.origin}</strong>, mas a URL
            pública configurada é <strong>{publicOrigin}</strong>. Os links e QR Codes estão usando
            a URL pública configurada.
          </p>
        </div>
      ) : null}

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
            <div className="token-input-row">
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
              {selectedRoom ? (
                <button
                  type="button"
                  className="ghost round-action"
                  disabled={isRotating}
                  onClick={() => setConfirmRotate(true)}
                >
                  Rotacionar convite
                </button>
              ) : null}
            </div>
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

      <ConfirmDialog
        open={confirmRotate}
        title="Rotacionar convite"
        description="Isso invalida o link de todo mundo de uma vez. Quem já está com a página aberta pode continuar vendo a cédula antiga, e quem atualizar o link velho fica de fora. Para uma pessoa só, gere o código dela."
        confirmLabel="Rotacionar mesmo assim"
        tone="danger"
        busy={isRotating}
        onCancel={() => setConfirmRotate(false)}
        onConfirm={() => {
          setConfirmRotate(false);
          void handleRotateInvite();
        }}
      />

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
          {paginateCardsForPrint(printCards).map((sheetCards, sheetIndex) => (
            <div key={sheetIndex} className="print-sheet">
              {sheetCards.map((card) => (
                <article key={card.id} className="print-card-item">
                  <div
                    className="print-card-qr"
                    role="img"
                    aria-label={`QR Code de ${card.displayName}`}
                    dangerouslySetInnerHTML={{ __html: card.qrSvg }}
                  />
                  <div className="print-card-details">
                    <span className="print-card-room">{selectedRoom.title}</span>
                    <strong className="print-card-name">{card.displayName}</strong>
                    <span className="print-card-code-label">Código de acesso:</span>
                    <code className="print-card-code">{card.code}</code>
                    <span className="print-card-short-url">{card.displayUrl}</span>
                  </div>
                </article>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
