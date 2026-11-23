import { formatAuditActionLabel, formatReceiptTime } from "./room-detail-helpers";
import type { AuditEventItem } from "./types";

/**
 * Audit feed sidebar card rendered in the Resultado tab of AdminRoomDetail.
 */
export function RoomAuditCard({
  roomId,
  auditEvents,
}: {
  roomId: string;
  auditEvents?: readonly AuditEventItem[];
}) {
  if (auditEvents && auditEvents.length > 0) {
    return (
      <section className="panel audit-feed-card" aria-labelledby="room-audit-log-heading">
        <div className="audit-feed-header">
          <h2 id="room-audit-log-heading">Auditoria da sala</h2>
          <span className="detail-kpi-pill">{auditEvents.length}</span>
        </div>
        <div className="audit-feed-list">
          {auditEvents.map((event) => (
            <div key={event.id} className="audit-receipt-item">
              <span className="audit-receipt-dot" aria-hidden="true" />
              <div>
                <p className="audit-receipt-title">{formatAuditActionLabel(event.action)}</p>
                <p className="audit-receipt-meta">
                  {event.actorRole} • {formatReceiptTime(event.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="audit-logs-cta">
          <a
            className="ghost round-action"
            href={`/admin/logs?roomId=${encodeURIComponent(roomId)}`}
          >
            Logs Inapagáveis &amp; Exportar PDF
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="panel audit-feed-card" aria-labelledby="room-audit-log-heading">
      <div className="audit-feed-header">
        <h2 id="room-audit-log-heading">Auditoria e Integridade</h2>
      </div>
      <p className="audit-privacy-footer">
        Histórico inapagável comprovando que somente pessoas autenticadas votaram, sem intervenção
        do administrador.
      </p>
      <div className="audit-logs-cta">
        <a
          className="ghost round-action"
          href={`/admin/logs?roomId=${encodeURIComponent(roomId)}`}
        >
          Logs Inapagáveis &amp; Exportar PDF
        </a>
      </div>
    </section>
  );
}
