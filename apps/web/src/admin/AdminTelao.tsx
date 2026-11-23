import { useEffect, useState } from "react";
import { apiUrl } from "../api-url";
import { fetchPublicConfig, resolvePublicOrigin, type PublicConfig } from "../config-api";
import {
  ClosedRoundProjectionSection,
  EntryProjectionSection,
  OpenRoundProjectionSection,
} from "./TelaoProjectionSections";
import { ROOM_TYPE_LABELS } from "./copy";
import { generateQrSvg } from "./qr-svg";
import { shortRoomUrl } from "./room-draft";
import { formatSyncTime, messageFromRoundError } from "./room-detail-helpers";
import { revealRoundResult } from "./rooms-api";
import { useRoomDetail } from "./use-room-detail";

const apiBase = apiUrl("");

/**
 * Full-screen live projector view (`/telao/:salaId`) controlled by room state and desk reveal actions.
 */
export function AdminTelao({ roomId }: { roomId: string }) {
  const [refreshTick, setRefreshTick] = useState(0);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({ publicUrl: null });
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { room, loadError, lastSyncedAt } = useRoomDetail(roomId, refreshTick);

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

  const publicOrigin = resolvePublicOrigin(publicConfig.publicUrl, window.location.origin);
  const inviteUrl = room?.shortCode ? shortRoomUrl(publicOrigin, room.shortCode) : null;

  useEffect(() => {
    if (!inviteUrl) {
      return;
    }
    let cancelled = false;
    void generateQrSvg(inviteUrl)
      .then((svg) => {
        if (!cancelled) {
          setQrSvg(svg);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrSvg(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [inviteUrl]);

  useEffect(() => {
    function handleFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
    };
  }, []);

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.().catch(() => undefined);
    } else {
      await document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  }

  async function handleReveal(roundId: string) {
    if (!room) return;
    setActionError(null);
    setIsRevealing(true);
    try {
      await revealRoundResult(apiBase, room.id, roundId);
      setRefreshTick((tick) => tick + 1);
    } catch (error) {
      setActionError(messageFromRoundError(error));
    } finally {
      setIsRevealing(false);
    }
  }

  if (loadError) {
    return (
      <main className="telao-screen" data-testid="telao-screen">
        <section className="panel telao-card">
          <p className="form-error" role="alert">
            {loadError}
          </p>
        </section>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="telao-screen" data-testid="telao-screen">
        <section className="panel telao-card">
          <p>Carregando telão…</p>
        </section>
      </main>
    );
  }

  const roomTypeLabel = ROOM_TYPE_LABELS[room.roomType] ?? "Sessão";

  return (
    <main className="telao-screen" data-testid="telao-screen">
      <header className="telao-top-bar">
        <div>
          <span className="telao-top-subtitle">{roomTypeLabel}</span>
          <h1>{room.title}</h1>
        </div>
        <div className="telao-top-actions">
          <span className="detail-sync-badge" aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            {lastSyncedAt ? `Ao vivo • ${formatSyncTime(lastSyncedAt)}` : "Sincronizando…"}
          </span>
          <button
            type="button"
            className="ghost round-action"
            data-testid="telao-fullscreen-btn"
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          </button>
        </div>
      </header>

      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}

      {!room.round ? (
        <EntryProjectionSection room={room} publicOrigin={publicOrigin} qrSvg={qrSvg} />
      ) : room.round.status === "open" ? (
        <OpenRoundProjectionSection room={room} round={room.round} roomTypeLabel={roomTypeLabel} />
      ) : (
        <ClosedRoundProjectionSection
          round={room.round}
          roomTypeLabel={roomTypeLabel}
          isRevealing={isRevealing}
          onReveal={(id) => void handleReveal(id)}
        />
      )}
    </main>
  );
}
