import { initialsFromName } from "./ImageDropzone";

export type OfficeProgressCardItem = {
  officeLabel: string;
  order: number;
  status: string;
  roundCount?: number;
  winnerName: string | null;
  winnerPhotoUrl?: string | null;
};

function statusLabelForOffice(office: OfficeProgressCardItem): string {
  if (office.status === "elected") {
    return "Eleito";
  }
  if (office.status === "open") {
    return "Em votação";
  }
  if (office.status === "in_progress") {
    return office.roundCount ? `Em andamento (${office.roundCount}º escrutínio)` : "Em andamento";
  }
  return "Aguardando";
}

/**
 * Renders board offices as a responsive card grid with the office title on top,
 * the elected member's photo (or initials) in the center, and their name below.
 */
export function OfficeProgressGrid({ offices }: { offices: readonly OfficeProgressCardItem[] }) {
  return (
    <ol className="office-progress-grid">
      {offices.map((office) => {
        const isElected = office.status === "elected";
        const winnerName = office.winnerName ?? "Confirmado";
        const statusLabel = statusLabelForOffice(office);

        return (
          <li key={office.officeLabel} className={`office-progress-card ${office.status}`}>
            <div className="office-card-top">
              <strong className="office-card-title">
                {office.order}. {office.officeLabel}
              </strong>
              <span className={`office-card-status ${office.status}`}>{statusLabel}</span>
            </div>

            <div className="office-card-avatar" aria-hidden="true">
              {isElected ? (
                office.winnerPhotoUrl ? (
                  <img src={office.winnerPhotoUrl} alt="" className="voter-avatar-img" />
                ) : (
                  initialsFromName(winnerName)
                )
              ) : (
                <span className="office-card-placeholder">
                  {office.status === "open" ? "•" : "—"}
                </span>
              )}
            </div>

            <div className="office-card-bottom">
              {isElected ? (
                <strong className="office-card-winner">{winnerName}</strong>
              ) : (
                <span className="office-card-pending">{statusLabel}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
