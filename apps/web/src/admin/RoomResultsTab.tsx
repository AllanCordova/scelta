import { OfficeProgressGrid } from "../shell/OfficeProgressGrid";
import { RoomAuditCard } from "./RoomAuditCard";
import { RoomCandidateStandingsList } from "./RoomCandidateStandingsList";
import { RoomWinnerHighlightCard } from "./RoomWinnerHighlightCard";
import {
  FAILED_QUORUM_MESSAGE,
  ROUND_DECLINED_MESSAGE,
  ROUND_RESTARTED_MESSAGE,
  standingLabel,
  tallySummaryLabel,
} from "./copy";
import type { OfficeProgressItem, RoomDetail } from "./types";

export type RoomResultsTabProps = {
  room: RoomDetail;
  roomTypeLabel: string;
  resolvedOffices: readonly OfficeProgressItem[];
  allOfficesElected: boolean;
  isElectedWinner: boolean;
  showWinnerHero: boolean;
  tieBreakRequired: boolean;
  isBusy: boolean;
  onDismissWinnerHero: (roundId: string) => void;
  onRestoreWinnerHero: () => void;
  onOpenSharePaper: () => void;
  onResolveTie: (roundId: string, candidateId: string, displayName: string) => void;
  onRevealResult: (roundId: string) => void;
};

/**
 * Resultado tab: winner highlight, reveal-on-telão action, candidate tally breakdown,
 * tie-break controls, multi-office board progress, and room audit trail.
 */
export function RoomResultsTab({
  room,
  roomTypeLabel,
  resolvedOffices,
  allOfficesElected,
  isElectedWinner,
  showWinnerHero,
  tieBreakRequired,
  isBusy,
  onDismissWinnerHero,
  onRestoreWinnerHero,
  onOpenSharePaper,
  onResolveTie,
  onRevealResult,
}: RoomResultsTabProps) {
  const totalVacancies = room.vacancies ?? 1;
  const electedList = room.electedCandidates ?? [];
  const remainingVacancies =
    typeof room.remainingVacancies === "number"
      ? room.remainingVacancies
      : Math.max(0, totalVacancies - electedList.length);

  const tally = room.round?.tally ?? null;
  const totalValidVotes = tally ? tally.totalVotes : room.votedCount;
  const standingsByCandidate = new Map(
    (tally?.standings ?? []).map((item) => [item.candidateId, item.votes]),
  );
  const standingDetailsByCandidate = new Map(
    (tally?.standings ?? []).map((item) => [item.candidateId, item]),
  );
  const rawCandidates = room.candidates ?? [];
  const candidatesList = tally
    ? [...rawCandidates].sort((a, b) => {
        const diff = (standingsByCandidate.get(b.id) ?? 0) - (standingsByCandidate.get(a.id) ?? 0);
        if (diff !== 0) {
          return diff;
        }
        return a.displayName.localeCompare(b.displayName, "pt-BR");
      })
    : rawCandidates;
  const highestVotes =
    tally && tally.standings.length > 0
      ? Math.max(...tally.standings.map((item) => item.votes))
      : 0;
  const winnerCandidate =
    tally?.outcome === "elected" && tally.winnerName
      ? candidatesList.find(
          (candidate) =>
            candidate.id === tally.winnerId || candidate.displayName === tally.winnerName,
        )
      : undefined;
  const winnerVotes =
    winnerCandidate !== undefined
      ? (standingsByCandidate.get(winnerCandidate.id) ?? 0)
      : tally?.winnerId
        ? (standingsByCandidate.get(tally.winnerId) ?? 0)
        : 0;
  const winnerPercent =
    tally && tally.totalVotes > 0 ? Math.round((winnerVotes / tally.totalVotes) * 100) : 0;

  return (
    <div className="room-tab-stack" role="tabpanel" aria-label="Resultado">
      {room.round?.status === "closed" ? (
        <section className="panel telao-reveal-bar" aria-label="Exibição no telão">
          <div>
            <strong>Projeção no Telão</strong>
            <p className="muted">
              {room.round.resultRevealed
                ? "Resultado revelado publicamente no telão."
                : "O resultado deste escrutínio ainda está oculto no telão até a mesa clicar em revelar."}
            </p>
          </div>
          {room.round.resultRevealed ? (
            <span className="quorum-state badge-met" data-testid="result-revealed-badge">
              Revelado no telão
            </span>
          ) : (
            <button
              type="button"
              className="round-action"
              data-testid="reveal-result-btn"
              disabled={isBusy}
              onClick={() => onRevealResult(room.round!.id)}
            >
              Revelar resultado
            </button>
          )}
        </section>
      ) : null}

      {isElectedWinner && tally?.winnerName && room.round ? (
        <RoomWinnerHighlightCard
          winnerName={tally.winnerName}
          winnerNames={tally.winnerNames}
          photoUrl={winnerCandidate?.photoUrl}
          officeTitle={
            room.round.officeLabel
              ? `${room.round.officeLabel} Eleito`
              : (tally.winnerNames?.length ?? 1) > 1
                ? `${roomTypeLabel}s Eleitos`
                : `${roomTypeLabel} Eleito`
          }
          winnerPercent={winnerPercent}
          totalVotes={tally.totalVotes}
          roundId={room.round.id}
          expanded={showWinnerHero}
          onDismiss={onDismissWinnerHero}
          onRestore={onRestoreWinnerHero}
        />
      ) : null}

      {resolvedOffices.length > 0 ? (
        <section className="panel" aria-label="Cargos da diretoria (Ordem IPB)">
          <div className="section-header-row">
            <h2>Cargos da Diretoria (Ordem IPB)</h2>
            {allOfficesElected ? (
              <button type="button" className="round-action" onClick={onOpenSharePaper}>
                Compartilhar resultado
              </button>
            ) : null}
          </div>
          <OfficeProgressGrid offices={resolvedOffices} />
        </section>
      ) : null}

      <div className="detail-main-grid">
        <section className="panel candidate-results-card" aria-labelledby="scrutiny-heading">
          <div className="candidate-results-header">
            <div>
              <h2 id="scrutiny-heading">
                {room.round?.officeLabel
                  ? `Apuração: Cargo de ${room.round.officeLabel}`
                  : `Apuração: Cargo de ${roomTypeLabel}`}
              </h2>
              <p className="muted">
                Escrutínio nominal com apuração de maioria absoluta (50% + 1 dos votos válidos)
              </p>
            </div>
            <div className="candidate-results-header-actions">
              {totalVacancies > 1 ? (
                <span className="detail-kpi-pill" data-testid="room-vacancies-summary">
                  Vagas: {electedList.length} eleitos de {totalVacancies} • Vagas restantes:{" "}
                  {remainingVacancies}
                </span>
              ) : null}
              <span className="detail-valid-votes-badge">{totalValidVotes} Votos Válidos</span>
              {resolvedOffices.length === 0 && (isElectedWinner || electedList.length > 0) ? (
                <button type="button" className="round-action" onClick={onOpenSharePaper}>
                  Compartilhar resultado
                </button>
              ) : null}
            </div>
          </div>

          {room.round?.status === "open" && (room.round.restartCount ?? 0) > 0 ? (
            <p className="round-restarted">{ROUND_RESTARTED_MESSAGE}</p>
          ) : null}

          {room.round?.outcome === "failed_quorum" ? (
            <p className="quorum-failed" role="status">
              {FAILED_QUORUM_MESSAGE}
            </p>
          ) : null}

          {room.round?.outcome === "declined" ? (
            <p className="round-restarted" role="status">
              {ROUND_DECLINED_MESSAGE}
            </p>
          ) : null}

          {tally ? (
            <div className="round-tally" role="status">
              <p className="tally-outcome">{tallySummaryLabel(tally)}</p>
              {tally.lastVacancyTieCandidateIds && tally.lastVacancyTieCandidateIds.length > 0 ? (
                <p className="round-restarted" data-testid="last-vacancy-tie-notice">
                  Empate na última vaga — o próximo escrutínio será restrito aos candidatos
                  empatados.
                </p>
              ) : null}
              {tally.voteOrigin ? (
                <div className="tally-origin-summary" data-testid="tally-origin-summary">
                  <span>
                    <strong>Total:</strong> {tally.totalVotes}
                  </span>
                  <span>
                    <strong>Online:</strong> {tally.voteOrigin.online.ballots} (brancos:{" "}
                    {tally.voteOrigin.online.blankVotes})
                  </span>
                  <span>
                    <strong>Papel:</strong> {tally.voteOrigin.paper.ballots} (brancos:{" "}
                    {tally.voteOrigin.paper.blankVotes}, nulos: {tally.voteOrigin.paper.nullVotes})
                  </span>
                </div>
              ) : null}
              {room.round?.paperTally?.recordedByName ? (
                <p className="muted" data-testid="tally-paper-recorded-by">
                  Urna de papel lançada por <strong>{room.round.paperTally.recordedByName}</strong>.
                </p>
              ) : null}
              <ul className="tally-standings sr-only" aria-label="Apuração">
                {tally.standings.map((item) => (
                  <li key={item.candidateId}>{standingLabel(item.displayName, item.votes)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {tieBreakRequired && tally?.tiedCandidates && room.round ? (
            <div
              className="tiebreak-admin-box"
              role="region"
              aria-label="Desempate do 3º escrutínio"
            >
              <div className="tiebreak-admin-header">
                <strong>Desempate do 3º Escrutínio — Critério de Idade (Mais Velho)</strong>
                <p className="muted">
                  O limite máximo de 3 escrutínios da IPB foi atingido com empate. Pela regra
                  regimental, vence o candidato mais velho. Como os candidatos empatados não possuem
                  data de nascimento cadastrada (ou possuem a mesma data), verifique na assembleia
                  quem é o mais velho e confirme o eleito abaixo:
                </p>
              </div>
              <div className="tiebreak-admin-actions">
                {tally.tiedCandidates.map((tiedCandidate) => (
                  <button
                    key={tiedCandidate.id}
                    type="button"
                    className="round-action"
                    disabled={isBusy}
                    onClick={() =>
                      onResolveTie(room.round!.id, tiedCandidate.id, tiedCandidate.displayName)
                    }
                  >
                    Declarar {tiedCandidate.displayName} eleito (mais velho)
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <RoomCandidateStandingsList
            candidates={candidatesList}
            tally={tally}
            standingDetailsByCandidate={standingDetailsByCandidate}
            electedIds={new Set(electedList.map((item) => item.id))}
            highestVotes={highestVotes}
            roundStatus={room.round?.status}
          />

          {tally && (tally.nullVotes ?? 0) > 0 ? (
            <p className="muted" role="status">
              Votos Nulos / Em Branco: <strong>{tally.nullVotes}</strong>
            </p>
          ) : null}

          {(tally?.didNotVoteCount ?? room.round?.didNotVoteCount ?? 0) > 0 ? (
            <p className="muted" role="status">
              Não votaram: <strong>{tally?.didNotVoteCount ?? room.round?.didNotVoteCount}</strong>
            </p>
          ) : null}

          <div className="secrecy-notice-box">
            <strong>Cédula Secreta — Votos criptografados e anônimos</strong>
            <p className="muted">
              Os votos individuais não possuem vínculo identificável com o votante. A auditoria
              valida apenas que cada membro presente depositou no máximo uma cédula por escrutínio.
            </p>
          </div>
        </section>

        <div className="detail-sidebar-col">
          <RoomAuditCard roomId={room.id} auditEvents={room.auditEvents} />
        </div>
      </div>
    </div>
  );
}
