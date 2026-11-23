import {
  canConfigureRoomVacancies,
  canDeclineRound,
  canOpenRound,
  canPublishWinner,
  canRestartRound,
  closeRoundOutcome,
  countOfficeRoundNumber,
  evaluateMultiVacancyProgress,
  isMultiOfficeRoomType,
  isRoundAnnulled,
  MAX_ROOM_VACANCIES,
  resolveNextRoundCandidateIds,
  resolveTargetOffice,
  tallyRoundVotes,
  type RoundResult,
  type RoundTally,
  type TallyEntry,
} from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth/require-admin.js";
import type { PresencePublisher } from "../realtime.js";
import { loadRoomOfficeState } from "../rooms/office-state.js";
import { loadRoomPresence, quorumStatus } from "../rooms/quorum-status.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { toPaperTallySummary, toRoundSummary } from "../rooms/round-summary.js";
import type { UserRepository } from "../users/user-repository.js";

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const Uuid = Type.String({
  minLength: 36,
  maxLength: 36,
  pattern: UUID_PATTERN.source,
});

const PaperTallyBody = Type.Object(
  {
    ballotCount: Type.Integer({ minimum: 0 }),
    blankVotes: Type.Integer({ minimum: 0 }),
    nullVotes: Type.Integer({ minimum: 0 }),
    candidateVotes: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export type RoundRouteOptions = {
  roomRepository?: RoomRepository;
  userRepository?: UserRepository;
  presencePublisher?: PresencePublisher;
};

export const roundRoutes: FastifyPluginAsync<RoundRouteOptions> = async (app, options) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.post(
    "/v1/admin/rooms/:roomId/rounds",
    { schema: { params: Type.Object({ roomId: Uuid }) } },
    async (request, reply) => {
      const repository = await adminRepository(request, reply, options);
      if (!repository) {
        return;
      }

      const parsedBody = parseOpenRoundBody(request.body);
      if (!parsedBody.ok) {
        return reply.code(400).send({ error: parsedBody.error });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const room = await repository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        if (!canOpenRound(room.status)) {
          return reply.code(409).send({ error: "room_not_open" });
        }

        const [allRounds, allRoomCandidates, eligibleRoomCandidates] = await Promise.all([
          repository.listRounds(room.id),
          repository.listAllCandidates(room.id),
          repository.listCandidates(room.id),
        ]);
        if (allRounds.some((row) => row.status === "open")) {
          return reply.code(409).send({ error: "round_already_open" });
        }

        const quorum = await loadRoomPresence(repository, room);
        if (!quorum.quorumMet) {
          return reply.code(409).send({ error: "quorum_not_met" });
        }

        const officeResolution = resolveTargetOffice(
          room.roomType,
          allRounds,
          parsedBody.officeLabel,
        );
        if (!officeResolution.ok) {
          if (officeResolution.reason === "invalid_office") {
            return reply.code(400).send({ error: "invalid_office" });
          }
          return reply.code(409).send({ error: officeResolution.reason });
        }

        const targetOffice = officeResolution.officeLabel;
        const officeRounds = allRounds.filter(
          (round) => round.officeLabel === targetOffice && !isRoundAnnulled(round),
        );
        const latestClosedForOffice = [...officeRounds]
          .filter((round) => round.status === "closed")
          .sort((a, b) => b.number - a.number)[0] ?? null;

        const isMultiOffice = isMultiOfficeRoomType(room.roomType);
        const roomVacancies = isMultiOffice ? 1 : (room.vacancies ?? 1);
        const vacancyProgress = evaluateMultiVacancyProgress(roomVacancies, officeRounds);

        let nextRoundVacancies = vacancyProgress.remainingVacancies;
        if (parsedBody.vacancies !== undefined) {
          if (!canConfigureRoomVacancies(room.roomType) && parsedBody.vacancies > 1) {
            return reply.code(400).send({ error: "invalid_vacancies" });
          }
          if (vacancyProgress.remainingVacancies <= 0) {
            return reply.code(409).send({ error: "winner_already_elected" });
          }
          if (parsedBody.vacancies > vacancyProgress.remainingVacancies) {
            return reply.code(400).send({ error: "invalid_vacancies" });
          }
          nextRoundVacancies = parsedBody.vacancies;
        } else if (nextRoundVacancies <= 0) {
          return reply.code(409).send({ error: "winner_already_elected" });
        }

        const isFirstRoundOfOffice =
          officeRounds.length === 0 || latestClosedForOffice?.outcome === "declined";
        const previousRoundPool = isFirstRoundOfOffice ? allRoomCandidates : eligibleRoomCandidates;
        let candidatePool = previousRoundPool;

        const declinedForOfficeIds = new Set(
          officeRounds
            .filter(
              (round) => round.outcome === "declined" && round.declinedCandidateId != null,
            )
            .map((round) => round.declinedCandidateId as string),
        );
        if (declinedForOfficeIds.size > 0) {
          candidatePool = candidatePool.filter(
            (candidate) => !declinedForOfficeIds.has(candidate.id),
          );
        }

        if (vacancyProgress.electedCandidateIds.length > 0) {
          const electedSet = new Set(vacancyProgress.electedCandidateIds);
          candidatePool = candidatePool.filter((candidate) => !electedSet.has(candidate.id));
        }

        if (isFirstRoundOfOffice && isMultiOffice && allRounds.length > 0) {
          const officeState = await loadRoomOfficeState(
            repository,
            room,
            allRoomCandidates,
            allRounds,
          );
          const electedIds = new Set(
            officeState.offices
              .map((item) => item.winnerCandidateId)
              .filter((id): id is string => id !== null),
          );
          if (electedIds.size > 0) {
            candidatePool = candidatePool.filter((candidate) => !electedIds.has(candidate.id));
          }
        }

        if (candidatePool.length === 0) {
          return reply.code(409).send({ error: "no_eligible_candidates" });
        }

        let previousTallies: TallyEntry[] = [];
        let lastVacancyTieCandidateIds: string[] = [];
        let previousTotalBallots: number | undefined;
        let previousBlankVotes: number | undefined;

        const shouldInspectPreviousTally =
          latestClosedForOffice !== null &&
          (latestClosedForOffice.outcome === "no_majority" ||
            (latestClosedForOffice.outcome === "elected" && roomVacancies > 1));

        if (shouldInspectPreviousTally && latestClosedForOffice) {
          const [ballotChoices, paperTally] = await Promise.all([
            repository.listRoundBallotMarks
              ? repository.listRoundBallotMarks(latestClosedForOffice.id)
              : repository.listRoundBallotCandidateIds(latestClosedForOffice.id),
            repository.findRoundPaperTally
              ? repository.findRoundPaperTally(latestClosedForOffice.id)
              : Promise.resolve(null),
          ]);
          const prevPoolIds = new Set(previousRoundPool.map((candidate) => candidate.id));
          const paperIds = paperTally
            ? Object.entries(paperTally.candidateVotes)
                .filter(([, votes]) => votes > 0)
                .map(([id]) => id)
            : [];
          const usePrevPool =
            previousRoundPool.length > 0 &&
            ballotChoices.every((choice) =>
              choice === null
                ? true
                : typeof choice === "string"
                  ? prevPoolIds.has(choice)
                  : choice.every((id) => prevPoolIds.has(id)),
            ) &&
            paperIds.every((id) => prevPoolIds.has(id));
          const tallyPool = usePrevPool ? previousRoundPool : allRoomCandidates;

          const tally = tallyRoundVotes(tallyPool, ballotChoices, {
            vacancies: latestClosedForOffice.vacancies ?? 1,
            ...(paperTally
              ? {
                  paperTally: {
                    ballotCount: paperTally.ballotCount,
                    blankVotes: paperTally.blankVotes,
                    nullVotes: paperTally.nullVotes,
                    candidateVotes: paperTally.candidateVotes,
                  },
                }
              : {}),
          });
          previousTallies = tally.standings.map((standing) => ({
            candidateId: standing.candidateId,
            votes: standing.votes,
          }));
          lastVacancyTieCandidateIds = tally.lastVacancyTieCandidateIds ?? [];
          previousTotalBallots = tally.totalVotes;
          previousBlankVotes = Math.max(0, tally.nullVotes - (paperTally?.nullVotes ?? 0));
        }

        const previousOfficeRoundNumber =
          latestClosedForOffice && latestClosedForOffice.outcome !== "declined"
            ? countOfficeRoundNumber(allRounds, latestClosedForOffice)
            : null;

        const resolved = resolveNextRoundCandidateIds({
          preset: room.rulesPreset,
          previousRoundNumber: previousOfficeRoundNumber,
          previousOutcome: latestClosedForOffice?.outcome ?? null,
          eligibleCandidateIds: candidatePool.map((candidate) => candidate.id),
          previousTallies,
          vacancies: roomVacancies,
          remainingVacancies: nextRoundVacancies,
          alreadyElectedCandidateIds: vacancyProgress.electedCandidateIds,
          ...(lastVacancyTieCandidateIds.length > 0 ? { lastVacancyTieCandidateIds } : {}),
          ...(previousTotalBallots !== undefined ? { previousTotalBallots } : {}),
          ...(previousBlankVotes !== undefined ? { previousBlankVotes } : {}),
          ...(parsedBody.candidateIds === undefined
            ? {}
            : { requestedCandidateIds: parsedBody.candidateIds }),
        });

        if (!resolved.ok) {
          if (resolved.reason === "winner_already_elected") {
            return reply.code(409).send({ error: "winner_already_elected" });
          }
          if (resolved.reason === "max_rounds_reached") {
            return reply.code(409).send({ error: "max_rounds_reached" });
          }
          return reply.code(400).send({ error: "invalid_candidate_subset" });
        }

        if (resolved.candidateIds.length === 0) {
          return reply.code(409).send({ error: "no_eligible_candidates" });
        }

        const opened = await repository.openRound(
          room.id,
          resolved.candidateIds,
          targetOffice,
          nextRoundVacancies,
        );
        if (!opened.ok) {
          return reply.code(409).send({ error: opened.reason });
        }

        const officeRoundNumber = countOfficeRoundNumber(
          [...allRounds, opened.round],
          opened.round,
        );

        options.presencePublisher?.publishRoundState?.(room.id, {
          roundId: opened.round.id,
          roundNumber: opened.round.number,
          ...(opened.round.officeLabel !== null
            ? { officeLabel: opened.round.officeLabel, officeRoundNumber }
            : {}),
          state: "open",
        });

        const activeSet = new Set(resolved.candidateIds);
        const activeCandidates = candidatePool.filter((candidate) => activeSet.has(candidate.id));

        return reply.code(201).send({
          round: toRoundSummary(opened.round, null, officeRoundNumber),
          ...(activeCandidates.length > 0
            ? {
                candidates: activeCandidates.map((candidate) => ({
                  id: candidate.id,
                  displayName: candidate.displayName,
                })),
              }
            : {}),
        });
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to open round");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.put(
    "/v1/admin/rooms/:roomId/rounds/:roundId/paper-tally",
    {
      schema: {
        params: Type.Object({ roomId: Uuid, roundId: Uuid }),
        body: PaperTallyBody,
      },
    },
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, options.userRepository);
      if (!admin) {
        return;
      }
      const repository = options.roomRepository;
      if (!repository?.upsertRoundPaperTally) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, roundId } = request.params as { roomId: string; roundId: string };
      const body = request.body as {
        ballotCount: number;
        blankVotes: number;
        nullVotes: number;
        candidateVotes: Record<string, number>;
      };

      try {
        const result = await repository.upsertRoundPaperTally({
          roomId,
          roundId,
          paperTally: body,
          adminId: admin.id,
          adminName: admin.name,
        });
        if (!result.ok) {
          if (result.reason === "validation_failed") {
            return reply.code(400).send({
              error: result.code,
              message: result.message,
            });
          }
          if (result.reason === "room_not_found" || result.reason === "round_not_found") {
            return reply.code(404).send({ error: result.reason });
          }
          return reply.code(409).send({ error: result.reason });
        }

        options.presencePublisher?.publishTelaoUpdated?.(roomId);
        return { paperTally: toPaperTallySummary(result.paperTally) };
      } catch (error) {
        request.log.error({ err: error, roomId, roundId }, "Failed to record paper tally");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/rounds/:roundId/close",
    { schema: { params: Type.Object({ roomId: Uuid, roundId: Uuid }) } },
    async (request, reply) => {
      const repository = await adminRepository(request, reply, options);
      if (!repository) {
        return;
      }

      const parsedClose = parseCloseRoundInput(request.body, request.query);
      if (!parsedClose.ok) {
        return reply.code(400).send({ error: "invalid_close_options" });
      }

      const { roomId, roundId } = request.params as { roomId: string; roundId: string };
      try {
        if (repository.closeAndTallyRound) {
          const result = await repository.closeAndTallyRound(roomId, roundId, {
            confirmPending: parsedClose.confirmPending,
            confirmNoPaperBallots: parsedClose.confirmNoPaperBallots,
          });
          if (!result.ok) {
            if (result.reason === "room_not_found" || result.reason === "round_not_found") {
              return reply.code(404).send({ error: result.reason });
            }
            if (result.reason === "voting_incomplete") {
              return reply.code(409).send({
                error: "voting_incomplete",
                votedCount: result.votedCount,
                presentCount: result.presentCount,
              });
            }
            if (result.reason === "paper_tally_required") {
              return reply.code(409).send({
                error: "paper_tally_required",
                paperVotersCount: result.paperVotersCount ?? 0,
                message:
                  "Há eleitores marcados para voto em papel. Lance os totais da urna de papel ou confirme que nenhuma cédula foi depositada.",
              });
            }
            return reply.code(409).send({ error: result.reason });
          }

          options.presencePublisher?.publishRoundState?.(roomId, {
            roundId: result.round.id,
            roundNumber: result.round.number,
            ...(result.round.officeLabel !== null
              ? { officeLabel: result.round.officeLabel, officeRoundNumber: result.officeRoundNumber }
              : {}),
            state: "closed",
          });

          return {
            round: toRoundSummary(result.round, result.tally, result.officeRoundNumber),
            quorum: result.quorum,
          };
        }

        const room = await repository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const round = await repository.findRound(roomId, roundId);
        if (!round) {
          return reply.code(404).send({ error: "round_not_found" });
        }
        if (round.status !== "open") {
          return reply.code(409).send({ error: "round_not_open" });
        }

        const [onlinePresentCount, paperVotersCount] = await Promise.all([
          repository.countPresent(roomId),
          repository.countPaperVoters ? repository.countPaperVoters(roomId) : Promise.resolve(0),
        ]);
        const quorum = quorumStatus(room, onlinePresentCount, paperVotersCount);
        let tally: RoundTally | null = null;
        let outcome: RoundResult | null = closeRoundOutcome(quorum.quorumMet);
        let didNotVoteCount = 0;

        const allRoundsBeforeClose = await repository.listRounds(room.id);
        const officeRoundNumber = countOfficeRoundNumber(allRoundsBeforeClose, round);

        if (quorum.quorumMet) {
          const [ballotChoices, paperTally] = await Promise.all([
            repository.listRoundBallotMarks
              ? repository.listRoundBallotMarks(roundId)
              : repository.listRoundBallotCandidateIds(roundId),
            repository.findRoundPaperTally
              ? repository.findRoundPaperTally(roundId)
              : Promise.resolve(null),
          ]);
          const onlineVotedCount = ballotChoices.length;
          if (onlineVotedCount < onlinePresentCount && !parsedClose.confirmPending) {
            return reply.code(409).send({
              error: "voting_incomplete",
              votedCount: onlineVotedCount,
              presentCount: onlinePresentCount,
            });
          }

          if (paperVotersCount > 0 && !paperTally && !parsedClose.confirmNoPaperBallots) {
            return reply.code(409).send({
              error: "paper_tally_required",
              paperVotersCount,
              message:
                "Há eleitores marcados para voto em papel. Lance os totais da urna de papel ou confirme que nenhuma cédula foi depositada.",
            });
          }

          didNotVoteCount =
            Math.max(0, onlinePresentCount - onlineVotedCount) +
            Math.max(0, paperVotersCount - (paperTally?.ballotCount ?? 0));

          const candidates = await repository.listCandidates(roomId);
          if (candidates.length > 0) {
            tally = tallyRoundVotes(candidates, ballotChoices, {
              roundNumber: officeRoundNumber,
              vacancies: round.vacancies ?? 1,
              ...(didNotVoteCount > 0 ? { didNotVoteCount } : {}),
              ...(paperTally
                ? {
                    paperTally: {
                      ballotCount: paperTally.ballotCount,
                      blankVotes: paperTally.blankVotes,
                      nullVotes: paperTally.nullVotes,
                      candidateVotes: paperTally.candidateVotes,
                    },
                  }
                : {}),
            });
            outcome = tally.outcome;
          }
        }

        const closed = await repository.closeRound(roomId, roundId, outcome, {
          winnerCandidateId: tally?.winnerId ?? null,
          winnerCandidateIds: tally?.winnerIds ?? [],
          tieBreakReason: tally?.tieBreakReason ?? null,
          didNotVoteCount,
        });
        if (!closed) {
          return reply.code(409).send({ error: "round_not_open" });
        }

        options.presencePublisher?.publishRoundState?.(room.id, {
          roundId: closed.id,
          roundNumber: closed.number,
          ...(closed.officeLabel !== null
            ? { officeLabel: closed.officeLabel, officeRoundNumber }
            : {}),
          state: "closed",
        });

        return { round: toRoundSummary(closed, tally, officeRoundNumber), quorum };
      } catch (error) {
        request.log.error({ err: error, roomId, roundId }, "Failed to close round");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/rounds/:roundId/restart",
    { schema: { params: Type.Object({ roomId: Uuid, roundId: Uuid }) } },
    async (request, reply) => {
      const repository = await adminRepository(request, reply, options);
      if (!repository) {
        return;
      }

      const { roomId, roundId } = request.params as { roomId: string; roundId: string };
      try {
        const room = await repository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const round = await repository.findRound(roomId, roundId);
        if (!round) {
          return reply.code(404).send({ error: "round_not_found" });
        }

        const check = canRestartRound(room.status, round.status, round.outcome);
        if (!check.ok) {
          return reply.code(409).send({ error: check.reason });
        }

        const restarted = await repository.restartRound(roomId, roundId);
        if (!restarted) {
          return reply.code(409).send({ error: "round_not_open" });
        }

        const allRounds = await repository.listRounds(room.id);
        const officeRoundNumber = countOfficeRoundNumber(allRounds, restarted);

        options.presencePublisher?.publishRoundState?.(room.id, {
          roundId: restarted.id,
          roundNumber: restarted.number,
          ...(restarted.officeLabel !== null
            ? { officeLabel: restarted.officeLabel, officeRoundNumber }
            : {}),
          state: "restarted",
        });

        return { round: toRoundSummary(restarted, null, officeRoundNumber) };
      } catch (error) {
        request.log.error({ err: error, roomId, roundId }, "Failed to restart round");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/rounds/:roundId/decline",
    { schema: { params: Type.Object({ roomId: Uuid, roundId: Uuid }) } },
    async (request, reply) => {
      const repository = await adminRepository(request, reply, options);
      if (!repository) {
        return;
      }

      const { roomId, roundId } = request.params as { roomId: string; roundId: string };
      try {
        const room = await repository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const round = await repository.findRound(roomId, roundId);
        if (!round) {
          return reply.code(404).send({ error: "round_not_found" });
        }

        const check = canDeclineRound(room.status, round.status, round.outcome);
        if (!check.ok) {
          return reply.code(409).send({ error: check.reason });
        }

        const [allCandidates, ballotChoices, allRoundsBeforeDecline, paperTally] =
          await Promise.all([
            repository.listAllCandidates(roomId),
            repository.listRoundBallotMarks
              ? repository.listRoundBallotMarks(roundId)
              : repository.listRoundBallotCandidateIds(roundId),
            repository.listRounds(room.id),
            repository.findRoundPaperTally
              ? repository.findRoundPaperTally(roundId)
              : Promise.resolve(null),
          ]);
        const tally = tallyRoundVotes(allCandidates, ballotChoices, {
          roundNumber: countOfficeRoundNumber(allRoundsBeforeDecline, round),
          vacancies: round.vacancies ?? 1,
          winnerOverrideId:
            round.tieBreakReason === "admin_tiebreak" ? round.winnerCandidateId : undefined,
          tieBreakReason: round.tieBreakReason,
          ...(paperTally
            ? {
                paperTally: {
                  ballotCount: paperTally.ballotCount,
                  blankVotes: paperTally.blankVotes,
                  nullVotes: paperTally.nullVotes,
                  candidateVotes: paperTally.candidateVotes,
                },
              }
            : {}),
        });
        if (!tally.winnerId) {
          return reply.code(409).send({ error: "winner_not_elected" });
        }

        const declined = await repository.declineRound(roomId, roundId, tally.winnerId);
        if (!declined) {
          return reply.code(409).send({ error: "winner_not_elected" });
        }

        const allRounds = await repository.listRounds(room.id);
        const officeRoundNumber = countOfficeRoundNumber(allRounds, declined);

        options.presencePublisher?.publishRoundState?.(room.id, {
          roundId: declined.id,
          roundNumber: declined.number,
          ...(declined.officeLabel !== null
            ? { officeLabel: declined.officeLabel, officeRoundNumber }
            : {}),
          state: "declined",
        });

        return {
          round: toRoundSummary(declined, null, officeRoundNumber),
          declinedCandidateId: tally.winnerId,
          declinedCandidateName: tally.winnerName,
        };
      } catch (error) {
        request.log.error({ err: error, roomId, roundId }, "Failed to decline elected office");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/rounds/:roundId/resolve-tie",
    {
      schema: {
        params: Type.Object({ roomId: Uuid, roundId: Uuid }),
        body: Type.Object({ winnerCandidateId: Uuid }, { additionalProperties: false }),
      },
    },
    async (request, reply) => {
      const repository = await adminRepository(request, reply, options);
      if (!repository) {
        return;
      }

      const { roomId, roundId } = request.params as { roomId: string; roundId: string };
      const { winnerCandidateId } = request.body as { winnerCandidateId: string };

      try {
        const room = await repository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        if (!canOpenRound(room.status)) {
          return reply.code(409).send({ error: "room_not_open" });
        }

        const round = await repository.findRound(roomId, roundId);
        if (!round) {
          return reply.code(404).send({ error: "round_not_found" });
        }
        if (round.status !== "closed") {
          return reply.code(409).send({ error: "round_not_closed" });
        }
        if (round.outcome !== "no_majority") {
          return reply.code(409).send({ error: "tie_break_not_required" });
        }

        const [candidates, allCandidates, ballotChoices, allRounds, paperTally] =
          await Promise.all([
            repository.listCandidates(roomId),
            repository.listAllCandidates(roomId),
            repository.listRoundBallotMarks
              ? repository.listRoundBallotMarks(roundId)
              : repository.listRoundBallotCandidateIds(roundId),
            repository.listRounds(room.id),
            repository.findRoundPaperTally
              ? repository.findRoundPaperTally(roundId)
              : Promise.resolve(null),
          ]);
        const officeRoundNumber = countOfficeRoundNumber(allRounds, round);
        if (officeRoundNumber < 3) {
          return reply.code(409).send({ error: "tie_break_not_required" });
        }

        const paperTallyOption = paperTally
          ? {
              paperTally: {
                ballotCount: paperTally.ballotCount,
                blankVotes: paperTally.blankVotes,
                nullVotes: paperTally.nullVotes,
                candidateVotes: paperTally.candidateVotes,
              },
            }
          : {};
        const activePool = candidates.length > 0 ? candidates : allCandidates;
        const initialTally = tallyRoundVotes(activePool, ballotChoices, {
          roundNumber: officeRoundNumber,
          vacancies: round.vacancies ?? 1,
          ...paperTallyOption,
        });
        if (!initialTally.tieBreakRequired || !initialTally.tiedCandidates) {
          return reply.code(409).send({ error: "tie_break_not_required" });
        }
        if (!initialTally.tiedCandidates.some((item) => item.id === winnerCandidateId)) {
          return reply.code(400).send({ error: "invalid_tie_break_candidate" });
        }

        if (!repository.resolveRoundTie) {
          return reply.code(503).send({ error: "persistence_unavailable" });
        }
        const resolved = await repository.resolveRoundTie(roomId, roundId, winnerCandidateId);
        if (!resolved) {
          return reply.code(409).send({ error: "tie_break_not_required" });
        }

        const finalTally = tallyRoundVotes(activePool, ballotChoices, {
          roundNumber: officeRoundNumber,
          vacancies: round.vacancies ?? 1,
          winnerOverrideId: winnerCandidateId,
          tieBreakReason: "admin_tiebreak",
          ...(resolved.didNotVoteCount !== undefined && resolved.didNotVoteCount > 0
            ? { didNotVoteCount: resolved.didNotVoteCount }
            : {}),
          ...paperTallyOption,
        });

        options.presencePublisher?.publishRoundState?.(room.id, {
          roundId: resolved.id,
          roundNumber: resolved.number,
          ...(resolved.officeLabel !== null
            ? { officeLabel: resolved.officeLabel, officeRoundNumber }
            : {}),
          state: "closed",
        });

        return {
          round: toRoundSummary(resolved, finalTally, officeRoundNumber),
        };
      } catch (error) {
        request.log.error({ err: error, roomId, roundId }, "Failed to resolve round tie");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/rounds/:roundId/reveal",
    { schema: { params: Type.Object({ roomId: Uuid, roundId: Uuid }) } },
    async (request, reply) => {
      const repository = await adminRepository(request, reply, options);
      if (!repository) {
        return;
      }
      if (!repository.revealRoundResult) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, roundId } = request.params as { roomId: string; roundId: string };
      try {
        const result = await repository.revealRoundResult(roomId, roundId);
        if (!result.ok) {
          if (result.reason === "room_not_found" || result.reason === "round_not_found") {
            return reply.code(404).send({ error: result.reason });
          }
          return reply.code(409).send({
            error: "round_not_closed",
            message: "O resultado só pode ser revelado após o encerramento do escrutínio.",
          });
        }

        const [allRounds, candidates, allCandidates, paperTally] = await Promise.all([
          repository.listRounds(roomId),
          repository.listCandidates(roomId),
          repository.listAllCandidates(roomId),
          repository.findRoundPaperTally
            ? repository.findRoundPaperTally(roundId)
            : Promise.resolve(null),
        ]);
        const officeRoundNumber = countOfficeRoundNumber(allRounds, result.round);

        let tally: RoundTally | null = null;
        if (
          (result.round.outcome === "elected" || result.round.outcome === "no_majority") &&
          (candidates.length > 0 || allCandidates.length > 0)
        ) {
          const ballotChoices = repository.listRoundBallotMarks
            ? await repository.listRoundBallotMarks(roundId)
            : await repository.listRoundBallotCandidateIds(roundId);
          const eligibleIds = new Set(candidates.map((c) => c.id));
          const paperIds = paperTally
            ? Object.entries(paperTally.candidateVotes)
                .filter(([, count]) => count > 0)
                .map(([id]) => id)
            : [];
          const useEligible =
            candidates.length > 0 &&
            ballotChoices.every((choice) =>
              choice === null
                ? true
                : typeof choice === "string"
                  ? eligibleIds.has(choice)
                  : choice.every((id) => eligibleIds.has(id)),
            ) &&
            paperIds.every((id) => eligibleIds.has(id));
          tally = tallyRoundVotes(useEligible ? candidates : allCandidates, ballotChoices, {
            roundNumber: officeRoundNumber,
            vacancies: result.round.vacancies ?? 1,
            winnerOverrideId:
              result.round.tieBreakReason === "admin_tiebreak"
                ? result.round.winnerCandidateId
                : undefined,
            tieBreakReason: result.round.tieBreakReason,
            ...(result.round.didNotVoteCount !== undefined && result.round.didNotVoteCount > 0
              ? { didNotVoteCount: result.round.didNotVoteCount }
              : {}),
            ...(paperTally
              ? {
                  paperTally: {
                    ballotCount: paperTally.ballotCount,
                    blankVotes: paperTally.blankVotes,
                    nullVotes: paperTally.nullVotes,
                    candidateVotes: paperTally.candidateVotes,
                  },
                }
              : {}),
          });
        }

        options.presencePublisher?.publishTelaoUpdated?.(roomId);
        options.presencePublisher?.publishRoundState?.(roomId, {
          roundId: result.round.id,
          roundNumber: result.round.number,
          ...(result.round.officeLabel !== null
            ? { officeLabel: result.round.officeLabel, officeRoundNumber }
            : {}),
          state: "closed",
        });

        return {
          round: toRoundSummary(result.round, tally, officeRoundNumber, paperTally),
          alreadyRevealed: result.alreadyRevealed,
        };
      } catch (error) {
        request.log.error({ err: error, roomId, roundId }, "Failed to reveal round result");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/publish",
    { schema: { params: Type.Object({ roomId: Uuid }) } },
    async (request, reply) => {
      const repository = await adminRepository(request, reply, options);
      if (!repository) {
        return;
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const room = await repository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const latest = await repository.latestClosedRound(roomId);
        if (latest?.outcome === "failed_quorum") {
          return reply.code(409).send({ error: "failed_quorum" });
        }
        if (!latest || !canPublishWinner(latest.outcome)) {
          return reply.code(409).send({ error: "winner_not_elected" });
        }

        await repository.recordAuditEvent?.(roomId, "result_published", {
          roundId: latest.id,
          roundNumber: latest.number,
          outcome: latest.outcome,
          ...(latest.officeLabel !== null ? { officeLabel: latest.officeLabel } : {}),
        });

        return { published: true, roundId: latest.id, outcome: latest.outcome };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to publish round");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );
};

async function adminRepository(
  request: Parameters<typeof requireAdmin>[0],
  reply: Parameters<typeof requireAdmin>[1],
  options: RoundRouteOptions,
): Promise<RoomRepository | undefined> {
  if (!(await requireAdmin(request, reply, options.userRepository))) {
    return undefined;
  }

  if (!options.roomRepository) {
    await reply.code(503).send({ error: "persistence_unavailable" });
    return undefined;
  }

  return options.roomRepository;
}

function parseOpenRoundBody(
  body: unknown,
):
  | { ok: true; candidateIds?: string[]; officeLabel?: string; vacancies?: number }
  | { ok: false; error: "invalid_office" | "invalid_candidate_subset" | "invalid_vacancies" } {
  if (body === undefined || body === null) {
    return { ok: true };
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_candidate_subset" };
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "candidateIds" && key !== "officeLabel" && key !== "vacancies")) {
    return { ok: false, error: "invalid_candidate_subset" };
  }

  let officeLabel: string | undefined;
  if (record.officeLabel !== undefined) {
    if (typeof record.officeLabel !== "string") {
      return { ok: false, error: "invalid_office" };
    }
    const trimmed = record.officeLabel.trim();
    if (trimmed.length === 0 || trimmed.length > 100) {
      return { ok: false, error: "invalid_office" };
    }
    officeLabel = trimmed;
  }

  let vacancies: number | undefined;
  if (record.vacancies !== undefined) {
    if (
      typeof record.vacancies !== "number" ||
      !Number.isInteger(record.vacancies) ||
      record.vacancies < 1 ||
      record.vacancies > MAX_ROOM_VACANCIES
    ) {
      return { ok: false, error: "invalid_vacancies" };
    }
    vacancies = record.vacancies;
  }

  let candidateIds: string[] | undefined;
  if (record.candidateIds !== undefined) {
    if (!Array.isArray(record.candidateIds) || record.candidateIds.length > 50) {
      return { ok: false, error: "invalid_candidate_subset" };
    }
    for (const item of record.candidateIds) {
      if (typeof item !== "string" || !UUID_PATTERN.test(item)) {
        return { ok: false, error: "invalid_candidate_subset" };
      }
    }
    candidateIds = record.candidateIds as string[];
  }

  return {
    ok: true,
    ...(candidateIds === undefined ? {} : { candidateIds }),
    ...(officeLabel === undefined ? {} : { officeLabel }),
    ...(vacancies === undefined ? {} : { vacancies }),
  };
}

function parseCloseRoundInput(
  body: unknown,
  query: unknown,
): { ok: true; confirmPending: boolean; confirmNoPaperBallots: boolean } | { ok: false } {
  let confirmPending = false;
  let confirmNoPaperBallots = false;

  if (query && typeof query === "object" && !Array.isArray(query)) {
    const queryRecord = query as Record<string, unknown>;
    if (queryRecord.confirmPending === "true" || queryRecord.confirmPending === true) {
      confirmPending = true;
    }
    if (
      queryRecord.confirmNoPaperBallots === "true" ||
      queryRecord.confirmNoPaperBallots === true
    ) {
      confirmNoPaperBallots = true;
    }
  }

  if (body === undefined || body === null) {
    return { ok: true, confirmPending, confirmNoPaperBallots };
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    return { ok: false };
  }

  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "confirmPending" && key !== "confirmNoPaperBallots") {
      return { ok: false };
    }
  }

  if (record.confirmPending !== undefined) {
    if (typeof record.confirmPending !== "boolean") {
      return { ok: false };
    }
    confirmPending = record.confirmPending;
  }

  if (record.confirmNoPaperBallots !== undefined) {
    if (typeof record.confirmNoPaperBallots !== "boolean") {
      return { ok: false };
    }
    confirmNoPaperBallots = record.confirmNoPaperBallots;
  }

  return { ok: true, confirmPending, confirmNoPaperBallots };
}
