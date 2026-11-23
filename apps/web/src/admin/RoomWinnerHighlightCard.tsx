import { candidateInitials } from "./room-detail-helpers";

/**
 * Highlight hero card (or minimized restore bar) for the elected candidate(s) of a round.
 */
export function RoomWinnerHighlightCard({
  winnerName,
  winnerNames,
  photoUrl,
  officeTitle,
  winnerPercent,
  totalVotes,
  roundId,
  expanded,
  onDismiss,
  onRestore,
}: {
  winnerName: string;
  winnerNames?: string[];
  photoUrl?: string | null;
  officeTitle: string;
  winnerPercent: number;
  totalVotes: number;
  roundId: string;
  expanded: boolean;
  onDismiss: (roundId: string) => void;
  onRestore: () => void;
}) {
  if (!expanded) {
    return (
      <div className="admin-winner-restore-bar">
        <span>
          Eleito: <strong>{winnerName}</strong>
        </span>
        <button type="button" className="ghost" onClick={onRestore}>
          Mostrar destaque
        </button>
      </div>
    );
  }

  return (
    <section className="panel voter-winner-hero admin-winner-hero" aria-label="Candidato eleito">
      <button
        type="button"
        className="ghost admin-winner-close-btn"
        aria-label="Minimizar destaque do eleito"
        onClick={() => onDismiss(roundId)}
      >
        × Minimizar
      </button>
      <div className="voter-winner-avatar-wrap">
        <div className="voter-winner-avatar" aria-hidden="true">
          {photoUrl ? (
            <img src={photoUrl} alt="" className="voter-avatar-img" />
          ) : (
            candidateInitials(winnerNames?.[0] ?? winnerName)
          )}
        </div>
        <span className="voter-winner-badge">
          {(winnerNames?.length ?? 1) > 1 ? "Eleitos" : "Eleito"}
        </span>
      </div>
      <h2>{winnerName}</h2>
      <p className="voter-winner-office">{officeTitle}</p>
      <div className="voter-majority-box">
        <div className="voter-majority-header">
          <span>Maioria absoluta</span>
          <strong>{winnerPercent}%</strong>
        </div>
        <div className="voter-majority-track" aria-hidden="true">
          <div
            className="voter-majority-fill"
            style={{ width: `${Math.min(100, winnerPercent)}%` }}
          />
          <div className="voter-majority-threshold" />
        </div>
        <div className="voter-majority-footer">
          <span>
            Total de votos: <strong>{totalVotes}</strong>
          </span>
          <span>Critério: 50% + 1</span>
        </div>
      </div>
    </section>
  );
}
