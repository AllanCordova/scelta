import { tallySummaryLabel } from "./copy";
import { displayShortRoomUrl } from "./room-draft";
import type { RoomDetail, RoomRound } from "./types";

/**
 * Projector entry phase: large QR code, short room code, public URL, and presence/quorum strip.
 */
export function EntryProjectionSection({
  room,
  publicOrigin,
  qrSvg,
}: {
  room: RoomDetail;
  publicOrigin: string;
  qrSvg: string | null;
}) {
  const shortUrl = displayShortRoomUrl(publicOrigin, room.shortCode);
  return (
    <section className="panel telao-card telao-entry-card" aria-label="Entrada na sala">
      <div className="telao-entry-grid">
        <div className="telao-entry-qr-col">
          {qrSvg ? (
            <div
              className="telao-qr-wrap"
              role="img"
              aria-label="QR Code de acesso à sala"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          ) : (
            <p className="muted">Gerando QR Code…</p>
          )}
        </div>
        <div className="telao-entry-info-col">
          <span className="telao-kicker">
            {room.entryOpen === false ? "Entrada encerrada" : "Escaneie ou informe o código"}
          </span>
          <div className="telao-short-code-box">
            <span>Código da sala</span>
            <strong className="telao-short-code" data-testid="telao-short-code">
              {room.shortCode}
            </strong>
          </div>
          <p className="telao-public-url">{shortUrl}</p>
          <div className="telao-kpi-strip">
            <div className="telao-kpi">
              <span>Presentes</span>
              <strong>{room.presence.presentCount}</strong>
            </div>
            <div className="telao-kpi">
              <span>Quórum mínimo</span>
              <strong>{room.presence.requiredCount}</strong>
            </div>
            <div className="telao-kpi">
              <span>Status do quórum</span>
              <strong>{room.presence.quorumMet ? "Atingido" : "Aguardando"}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Projector open-round phase: voter turnout, general ballot counts, and optional live candidate tally.
 */
export function OpenRoundProjectionSection({
  room,
  round,
  roomTypeLabel,
}: {
  room: RoomDetail;
  round: RoomRound;
  roomTypeLabel: string;
}) {
  const liveTally = round.liveTally;
  const totalBallots = liveTally?.totalBallots ?? room.votedCount;
  const blankVotes = liveTally?.blankVotes ?? 0;
  const nullVotes = liveTally?.nullVotes ?? 0;
  const candidateStandings = liveTally?.standings ?? [];
  const totalPresent = room.presence.presentCount;

  return (
    <section className="panel telao-card" aria-label="Votação em andamento">
      <div className="telao-round-header">
        <span className="telao-kicker">Escrutínio aberto</span>
        <h2>
          {round.officeLabel ? `Cargo de ${round.officeLabel}` : roomTypeLabel} —{" "}
          {round.number}º Escrutínio
        </h2>
      </div>

      <p className="telao-voted-counter" data-testid="telao-voted-counter">
        Votaram <strong>{room.votedCount}</strong> de <strong>{totalPresent}</strong>
      </p>

      <div className="telao-kpi-strip" data-testid="telao-general-tally">
        <div className="telao-kpi">
          <span>Cédulas computadas</span>
          <strong>{totalBallots}</strong>
        </div>
        <div className="telao-kpi">
          <span>Votos em branco</span>
          <strong>{blankVotes}</strong>
        </div>
        <div className="telao-kpi">
          <span>Votos nulos</span>
          <strong>{nullVotes}</strong>
        </div>
      </div>

      {room.showLiveCandidateTally === true ? (
        <div className="telao-standings" data-testid="telao-live-candidate-tally">
          <h3>Parcial por candidato</h3>
          {candidateStandings.length === 0 ? (
            <p className="muted">Aguardando os primeiros votos válidos…</p>
          ) : (
            <div className="telao-standings-list">
              {candidateStandings.map((item) => {
                const percent =
                  totalBallots > 0 ? Math.round((item.votes / totalBallots) * 100) : 0;
                return (
                  <div key={item.candidateId} className="telao-standing-row">
                    <div className="telao-standing-label">
                      <strong>{item.displayName}</strong>
                      <span>
                        {item.votes} {item.votes === 1 ? "voto" : "votos"} ({percent}%)
                      </span>
                    </div>
                    <div className="quorum-progress-track" aria-hidden="true">
                      <div
                        className="quorum-progress-bar met"
                        style={{ width: `${Math.max(percent, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <p className="telao-hidden-notice" data-testid="telao-live-tally-hidden">
          Parcial por candidato oculta durante a votação.
        </p>
      )}
    </section>
  );
}

/**
 * Projector closed-round phase: awaiting-reveal gate or official revealed standings.
 */
export function ClosedRoundProjectionSection({
  round,
  roomTypeLabel,
  isRevealing,
  onReveal,
}: {
  round: RoomRound;
  roomTypeLabel: string;
  isRevealing: boolean;
  onReveal: (roundId: string) => void;
}) {
  if (!round.resultRevealed) {
    return (
      <section className="panel telao-card telao-awaiting-card" data-testid="telao-awaiting-reveal">
        <span className="telao-kicker">
          {round.officeLabel ? `Cargo de ${round.officeLabel}` : roomTypeLabel} —{" "}
          {round.number}º Escrutínio
        </span>
        <h2>Escrutínio encerrado — Aguardando revelação do resultado pela mesa</h2>
        <p className="muted">
          O resultado já foi apurado com segurança e será exibido aqui assim que a mesa liberar.
        </p>
        <button
          type="button"
          className="round-action"
          data-testid="telao-reveal-result-btn"
          disabled={isRevealing}
          onClick={() => onReveal(round.id)}
        >
          {isRevealing ? "Revelando…" : "Revelar resultado"}
        </button>
      </section>
    );
  }

  const tally = round.tally;
  const totalVotes = tally?.totalVotes ?? 0;

  return (
    <section className="panel telao-card" data-testid="telao-revealed-result">
      <div className="telao-round-header">
        <span className="telao-kicker">Resultado oficial</span>
        <h2>
          {round.officeLabel ? `Cargo de ${round.officeLabel}` : roomTypeLabel} —{" "}
          {round.number}º Escrutínio
        </h2>
      </div>

      {tally?.outcome === "elected" && tally.winnerName ? (
        <div className="telao-winner-banner">
          <span className="voter-winner-badge">
            {(tally.winnerNames?.length ?? 1) > 1 ? "Eleitos" : "Eleito"}
          </span>
          <h3>{tally.winnerName}</h3>
        </div>
      ) : null}

      {tally ? <p className="telao-outcome-text">{tallySummaryLabel(tally)}</p> : null}

      {tally && tally.standings.length > 0 ? (
        <div className="telao-standings-list">
          {tally.standings.map((item) => {
            const percent = totalVotes > 0 ? Math.round((item.votes / totalVotes) * 100) : 0;
            const isWinner = tally.winnerIds
              ? tally.winnerIds.includes(item.candidateId)
              : tally.winnerId === item.candidateId;
            return (
              <div
                key={item.candidateId}
                className={isWinner ? "telao-standing-row winner" : "telao-standing-row"}
              >
                <div className="telao-standing-label">
                  <strong>
                    {item.displayName} {isWinner ? "— Eleito" : ""}
                  </strong>
                  <span>
                    {item.votes} {item.votes === 1 ? "voto" : "votos"} ({percent}%)
                    {typeof item.onlineVotes === "number" && typeof item.paperVotes === "number"
                      ? ` · Online: ${item.onlineVotes} · Papel: ${item.paperVotes}`
                      : ""}
                  </span>
                </div>
                <div className="quorum-progress-track" aria-hidden="true">
                  <div
                    className={isWinner ? "quorum-progress-bar met" : "quorum-progress-bar neutral"}
                    style={{ width: `${Math.max(percent, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {tally ? (
        <div className="telao-kpi-strip">
          <div className="telao-kpi">
            <span>Votos válidos</span>
            <strong>{tally.totalVotes}</strong>
          </div>
          <div className="telao-kpi">
            <span>Brancos / Nulos</span>
            <strong>{tally.nullVotes ?? 0}</strong>
          </div>
          <div className="telao-kpi">
            <span>Não votaram</span>
            <strong>{tally.didNotVoteCount ?? round.didNotVoteCount ?? 0}</strong>
          </div>
        </div>
      ) : null}
    </section>
  );
}
