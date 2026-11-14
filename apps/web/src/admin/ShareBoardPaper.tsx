import { useState } from "react";
import { toast } from "sonner";
import { initialsFromName } from "../shell/ImageDropzone";

export const SHARE_BOARD_VERSE = {
  reference: "1 Pedro 4:10",
  text: "Servi uns aos outros, cada um conforme o dom que recebeu, como bons despenseiros da multiforme graça de Deus.",
} as const;

export type ShareBoardEntry = {
  officeLabel: string;
  winnerName: string;
  winnerPhotoUrl?: string | null;
};

type ShareBoardSheetProps = {
  roomTitle: string;
  ministryLabel: string;
  sessionDateLabel?: string;
  entries: readonly ShareBoardEntry[];
};

type ShareBoardPaperProps = ShareBoardSheetProps & {
  open: boolean;
  onClose: () => void;
};

const ROOM_TYPE_MINISTRY_LABELS: Record<string, string> = {
  pastor: "Pastor",
  elder: "Presbítero",
  deacon: "Diácono",
  session_board: "Mesa do Conselho",
  upa_board: "Diretoria UPA",
  ump_board: "Diretoria UMP",
  custom: "Sessão Geral",
};

/**
 * Maps a roomType key to its human-readable ministry/office label.
 */
export function ministryLabelForRoomType(roomType?: string): string {
  return (roomType && ROOM_TYPE_MINISTRY_LABELS[roomType]) || "Diretoria";
}

/**
 * Renders the paper sheet showing the ministry, all elected officers
 * (with photo or initials fallback), and the closing Bible verse.
 */
export function ShareBoardSheet({
  roomTitle,
  ministryLabel,
  sessionDateLabel,
  entries,
}: ShareBoardSheetProps) {
  return (
    <article className="share-paper-sheet" aria-label={`Nova Diretoria Eleita — ${roomTitle}`}>
      <header className="share-paper-header">
        <span className="share-paper-ministry">{ministryLabel}</span>
        <h2 className="share-paper-title">{roomTitle}</h2>
        <p className="share-paper-subtitle">
          {sessionDateLabel ? `Nova Diretoria Eleita • ${sessionDateLabel}` : "Nova Diretoria Eleita"}
        </p>
      </header>

      <ol className="share-paper-members">
        {entries.map((entry) => (
          <li key={`${entry.officeLabel}-${entry.winnerName}`} className="share-paper-member">
            <span className="share-paper-office">{entry.officeLabel}</span>
            <div className="share-paper-avatar" aria-hidden="true">
              {entry.winnerPhotoUrl ? (
                <img src={entry.winnerPhotoUrl} alt="" className="voter-avatar-img" />
              ) : (
                initialsFromName(entry.winnerName)
              )}
            </div>
            <strong className="share-paper-name">{entry.winnerName}</strong>
          </li>
        ))}
      </ol>

      <footer className="share-paper-footer">
        <blockquote className="share-paper-verse">
          “{SHARE_BOARD_VERSE.text}”{" "}
          <cite className="share-paper-verse-ref">— {SHARE_BOARD_VERSE.reference}</cite>
        </blockquote>
      </footer>
    </article>
  );
}

/**
 * Formats a plain-text summary of the elected board for clipboard or native sharing.
 */
export function formatShareBoardText(
  roomTitle: string,
  ministryLabel: string,
  entries: readonly ShareBoardEntry[],
): string {
  const lines = [
    `${roomTitle} — ${ministryLabel}`,
    "Nova Diretoria Eleita:",
    ...entries.map((entry) => `• ${entry.officeLabel}: ${entry.winnerName}`),
    "",
    `“${SHARE_BOARD_VERSE.text}” (${SHARE_BOARD_VERSE.reference})`,
  ];
  return lines.join("\n");
}

/**
 * Renders a printable/shareable paper document displaying the ministry,
 * all elected officers (with photo or initials fallback), and a closing Bible verse.
 */
export function ShareBoardPaper({
  open,
  roomTitle,
  ministryLabel,
  sessionDateLabel,
  entries,
  onClose,
}: ShareBoardPaperProps) {
  const [isCopied, setIsCopied] = useState(false);

  if (!open) {
    return null;
  }

  async function handleShareText() {
    const text = formatShareBoardText(roomTitle, ministryLabel, entries);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `${roomTitle} — ${ministryLabel}`, text });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text).catch(() => undefined);
      setIsCopied(true);
      toast.success("Resumo da diretoria copiado.");
      setTimeout(() => setIsCopied(false), 2000);
    }
  }

  return (
    <div
      className="share-paper-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Documento de compartilhamento — ${roomTitle}`}
    >
      <div className="print-cards-toolbar no-print">
        <div>
          <h2>Documento para Compartilhar</h2>
          <p className="muted">
            Pronto para imprimir, salvar em PDF ou copiar o resumo da diretoria.
          </p>
        </div>
        <div className="print-cards-toolbar-actions">
          <button
            type="button"
            className="ghost round-action"
            onClick={() => void handleShareText()}
          >
            {isCopied ? "Resumo copiado" : "Copiar resumo"}
          </button>
          <button
            type="button"
            className="round-action"
            onClick={() => window.print()}
          >
            Imprimir / Salvar PDF
          </button>
          <button
            type="button"
            className="ghost round-action"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
      </div>

      <ShareBoardSheet
        roomTitle={roomTitle}
        ministryLabel={ministryLabel}
        sessionDateLabel={sessionDateLabel}
        entries={entries}
      />
    </div>
  );
}
