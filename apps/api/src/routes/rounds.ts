import {
  canDeclineRound,
  canOpenRound,
  canPublishWinner,
  canRestartRound,
  closeRoundOutcome,
  countOfficeRoundNumber,
  isMultiOfficeRoomType,
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
import { quorumStatus } from "../rooms/quorum-status.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { toRoundSummary } from "../rooms/round-summary.js";
import type { UserRepository } from "../users/user-repository.js";

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const Uuid = Type.String({
  minLength: 36,
  maxLength: 36,
  pattern: UUID_PATTERN.source,
});

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

        const presentCount = await repository.countPresent(room.id);
        const quorum = quorumStatus(room, presentCount);
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
        const officeRounds = allRounds.filter((round) => round.officeLabel === targetOffice);
        const latestClosedForOffice = [...officeRounds]
          .filter((round) => round.status === "closed")
          .sort((a, b) => b.number - a.number)[0] ?? null;
        const isFirstRoundOfOffice =
          officeRounds.length === 0 || latestClosedForOffice?.outcome === "declined";
        let candidatePool = isFirstRoundOfOffice ? allRoomCandidates : eligibleRoomCandidates;

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

        if (isFirstRoundOfOffice && isMultiOfficeRoomType(room.roomType) && allRounds.length > 0) {
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
        if (
          latestClosedForOffice &&
          latestClosedForOffice.outcome === "no_majority" &&
          candidatePool.length > 0
        ) {
          const ballotCandidateIds = await repository.listRoundBallotCandidateIds(
            latestClosedForOffice.id,
          );
          const tally = tallyRoundVotes(candidatePool, ballotCandidateIds);
          previousTallies = tally.standings.map((standing) => ({
            candidateId: standing.candidateId,
            votes: standing.votes,
          }));
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
          ...(parsedBody.candidateIds === undefined
            ? {}
            : { requestedCandidateIds: parsedBody.candidateIds }),
        });

        if (!resolved.ok) {
          if (resolved.reason === "winner_already_elected") {
            return reply.code(409).send({ error: "winner_already_elected" });
          }
          return reply.code(400).send({ error: "invalid_candidate_subset" });
        }

        const opened = await repository.openRound(room.id, resolved.candidateIds, targetOffice);
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

  app.post(
    "/v1/admin/rooms/:roomId/rounds/:roundId/close",
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
        if (round.status !== "open") {
          return reply.code(409).send({ error: "round_not_open" });
        }

        const presentCount = await repository.countPresent(roomId);
        const quorum = quorumStatus(room, presentCount);
        let tally: RoundTally | null = null;
        let outcome: RoundResult | null = closeRoundOutcome(quorum.quorumMet);

        if (quorum.quorumMet) {
          const ballotCandidateIds = await repository.listRoundBallotCandidateIds(roundId);
          const votedCount = ballotCandidateIds.length;
          if (votedCount < presentCount) {
            return reply.code(409).send({
              error: "voting_incomplete",
              votedCount,
              presentCount,
            });
          }
          if (votedCount > presentCount) {
            return reply.code(409).send({
              error: "vote_count_mismatch",
              votedCount,
              presentCount,
            });
          }

          const candidates = await repository.listCandidates(roomId);
          if (candidates.length > 0) {
            tally = tallyRoundVotes(candidates, ballotCandidateIds);
            outcome = tally.outcome;
          }
        }

        const closed = await repository.closeRound(roomId, roundId, outcome);
        if (!closed) {
          return reply.code(409).send({ error: "round_not_open" });
        }

        const allRounds = await repository.listRounds(room.id);
        const officeRoundNumber = countOfficeRoundNumber(allRounds, closed);

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

        const [allCandidates, ballotCandidateIds] = await Promise.all([
          repository.listAllCandidates(roomId),
          repository.listRoundBallotCandidateIds(roundId),
        ]);
        const tally = tallyRoundVotes(allCandidates, ballotCandidateIds);
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
  | { ok: true; candidateIds?: string[]; officeLabel?: string }
  | { ok: false; error: "invalid_office" | "invalid_candidate_subset" } {
  if (body === undefined || body === null) {
    return { ok: true };
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_candidate_subset" };
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "candidateIds" && key !== "officeLabel")) {
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
  };
}
