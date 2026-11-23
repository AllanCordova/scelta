import { useState } from "react";
import { PaginationBar, paginateItems } from "../shell/PaginationBar";
import { standingLabel } from "./copy";
import { candidateInitials } from "./room-detail-helpers";
import type { CandidateOption, CandidateStanding, RoundTally } from "./types";

/**
 * Paginated candidate tally cards with online/paper vote breakdown and winner/leading badges.
 */
export function RoomCandidateStandingsList({
  candidates,
  tally,
  standingDetailsByCandidate,
  electedIds,
  highestVotes,
  roundStatus,
}: {
  candidates: readonly CandidateOption[];
  tally: RoundTally | null;
  standingDetailsByCandidate: ReadonlyMap<string, CandidateStanding>;
  electedIds: ReadonlySet<string>;
  highestVotes: number;
  roundStatus?: string;
}) {
  const [candidatePage, setCandidatePage] = useState(1);

  if (candidates.length === 0) {
    return <p className="empty">Nenhum candidato nominal cadastrado nesta sala.</p>;
  }

  const pagedCandidates = paginateItems([...candidates], candidatePage, 10);

  return (
    <>
      <div className="candidate-cards-list">
        {pagedCandidates.items.map((candidate) => {
          const standingDetail = standingDetailsByCandidate.get(candidate.id);
          const votes = standingDetail?.votes ?? 0;
          const hasOriginBreakdown =
            Boolean(tally?.voteOrigin) &&
            typeof standingDetail?.onlineVotes === "number" &&
            typeof standingDetail?.paperVotes === "number";
          const percent =
            tally && tally.totalVotes > 0
              ? Number(((votes / tally.totalVotes) * 100).toFixed(1))
              : 0;
          const isWinner = tally?.winnerIds
            ? tally.winnerIds.includes(candidate.id)
            : tally?.winnerId === candidate.id;
          const isPreviouslyElected = !isWinner && electedIds.has(candidate.id);
          const isLeading =
            Boolean(tally) && highestVotes > 0 && votes === highestVotes && !isWinner;

          return (
            <div
              key={candidate.id}
              className={
                isWinner || isLeading
                  ? "candidate-detail-card leading"
                  : "candidate-detail-card"
              }
            >
              <div className="candidate-detail-top">
                <div className="candidate-identity">
                  <span className="candidate-avatar" aria-hidden="true">
                    {candidate.photoUrl ? (
                      <img src={candidate.photoUrl} alt="" className="voter-avatar-img" />
                    ) : (
                      candidateInitials(candidate.displayName)
                    )}
                  </span>
                  <div>
                    <div className="candidate-name-row">
                      <span className="candidate-name">{candidate.displayName}</span>
                      {isWinner || isPreviouslyElected ? (
                        <span className="candidate-badge elected">Eleito</span>
                      ) : isLeading ? (
                        <span className="candidate-badge leading">Mais Votado</span>
                      ) : null}
                    </div>
                    <span className="candidate-sub">
                      {tally
                        ? hasOriginBreakdown
                          ? `${standingLabel(candidate.displayName, votes)} · Online: ${standingDetail?.onlineVotes ?? 0} · Papel: ${standingDetail?.paperVotes ?? 0}`
                          : standingLabel(candidate.displayName, votes)
                        : roundStatus === "open"
                          ? "Em votação secreta"
                          : "Candidato elegível"}
                    </span>
                  </div>
                </div>

                <div className="candidate-numbers">
                  <span className="candidate-votes-value">
                    {tally ? `${votes} ${votes === 1 ? "voto" : "votos"}` : "—"}
                  </span>
                  <span className="candidate-votes-percent">
                    {tally ? `(${percent}%)` : ""}
                  </span>
                </div>
              </div>

              <div className="quorum-progress-track" aria-hidden="true">
                <div
                  className={
                    isWinner || isLeading
                      ? "quorum-progress-bar met"
                      : "quorum-progress-bar neutral"
                  }
                  style={{ width: `${tally ? Math.max(percent, 2) : 0}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <PaginationBar
        currentPage={pagedCandidates.currentPage}
        totalPages={pagedCandidates.totalPages}
        onPageChange={setCandidatePage}
        ariaLabel="Paginação de apuração de candidatos"
      />
    </>
  );
}
