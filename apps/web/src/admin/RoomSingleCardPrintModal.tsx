import { paginateCardsForPrint } from "./card-pagination";

export type SinglePrintCard = {
  id: string;
  displayName: string;
  code: string;
  qrSvg: string;
  displayUrl: string;
};

/**
 * Full-screen printable A4 overlay for a single voter access card.
 */
export function RoomSingleCardPrintModal({
  roomTitle,
  card,
  onClose,
}: {
  roomTitle: string;
  card: SinglePrintCard | null;
  onClose: () => void;
}) {
  if (!card) {
    return null;
  }

  return (
    <div
      className="print-cards-overlay"
      role="dialog"
      aria-label="Cartões de acesso para impressão"
      data-testid="single-card-print-dialog"
    >
      <div className="print-cards-toolbar no-print">
        <div>
          <h2>Cartão de Acesso — {roomTitle}</h2>
          <p className="muted">1 cartão ativo pronto para impressão em A4.</p>
        </div>
        <div className="print-cards-toolbar-actions">
          <button type="button" className="round-action" onClick={() => window.print()}>
            Imprimir
          </button>
          <button type="button" className="ghost round-action" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
      {paginateCardsForPrint([card]).map((sheetCards, sheetIndex) => (
        <div key={sheetIndex} className="print-sheet">
          {sheetCards.map((item) => (
            <article key={item.id} className="print-card-item">
              <div
                className="print-card-qr"
                role="img"
                aria-label={`QR Code de ${item.displayName}`}
                dangerouslySetInnerHTML={{ __html: item.qrSvg }}
              />
              <div className="print-card-details">
                <span className="print-card-room">{roomTitle}</span>
                <strong className="print-card-name">{item.displayName}</strong>
                <span className="print-card-code-label">Código de acesso:</span>
                <code className="print-card-code">{item.code}</code>
                <span className="print-card-short-url">{item.displayUrl}</span>
              </div>
            </article>
          ))}
        </div>
      ))}
    </div>
  );
}
