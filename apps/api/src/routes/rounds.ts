import {
  canOpenRound,
  canPublishWinner,
  canRestartRound,
  closeRoundOutcome,
  resolveNextRoundCandidateIds,
  tallyRoundVotes,
  type RoundTally,
  type TallyEntry,
} from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth/require-admin.js";
import type { PresencePublisher } from "../realtime.js";
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
        return reply.code(400).send({ error: "invalid_candidate_subset" });
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

        const latest = await repository.latestRounds([room.id]);
        if (latest[0]?.status === "open") {
          return reply.code(409).send({ error: "round_already_open" });
        }

        const [latestClosed, roomCandidates] = await Promise.all([
          repository.latestClosedRound(room.id),
          repository.listCandidates(room.id),
        ]);

        let previousTallies: TallyEntry[] = [];
        if (
          latestClosed &&
          latestClosed.outcome === "no_majority" &&
          roomCandidates.length > 0
        ) {
          const ballotCandidateIds = await repository.listRoundBallotCandidateIds(latestClosed.id);
          const tally = tallyRoundVotes(roomCandidates, ballotCandidateIds);
          previousTallies = tally.standings.map((standing) => ({
            candidateId: standing.candidateId,
            votes: standing.votes,
          }));
        }

        const resolved = resolveNextRoundCandidateIds({
          preset: room.rulesPreset,
          previousRoundNumber: latestClosed?.number ?? null,
          previousOutcome: latestClosed?.outcome ?? null,
          eligibleCandidateIds: roomCandidates.map((candidate) => candidate.id),
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

        const opened = await repository.openRound(room.id, resolved.candidateIds);
        if (!opened.ok) {
          return reply.code(409).send({ error: opened.reason });
        }

        options.presencePublisher?.publishRoundState?.(room.id, {
          roundId: opened.round.id,
          roundNumber: opened.round.number,
          state: "open",
        });

        const activeSet = new Set(resolved.candidateIds);
        const activeCandidates = roomCandidates.filter((candidate) => activeSet.has(candidate.id));

        return reply.code(201).send({
          round: toRoundSummary(opened.round),
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
        let outcome = closeRoundOutcome(quorum.quorumMet);

        if (quorum.quorumMet) {
          const candidates = await repository.listCandidates(roomId);
          if (candidates.length > 0) {
            const ballotCandidateIds = await repository.listRoundBallotCandidateIds(roundId);
            tally = tallyRoundVotes(candidates, ballotCandidateIds);
            outcome = tally.outcome;
          }
        }

        const closed = await repository.closeRound(roomId, roundId, outcome);
        if (!closed) {
          return reply.code(409).send({ error: "round_not_open" });
        }

        options.presencePublisher?.publishRoundState?.(room.id, {
          roundId: closed.id,
          roundNumber: closed.number,
          state: "closed",
        });

        return { round: toRoundSummary(closed, tally), quorum };
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

        options.presencePublisher?.publishRoundState?.(room.id, {
          roundId: restarted.id,
          roundNumber: restarted.number,
          state: "restarted",
        });

        return { round: toRoundSummary(restarted) };
      } catch (error) {
        request.log.error({ err: error, roomId, roundId }, "Failed to restart round");
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
): { ok: true; candidateIds?: string[] } | { ok: false } {
  if (body === undefined || body === null) {
    return { ok: true };
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    return { ok: false };
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "candidateIds")) {
    return { ok: false };
  }
  if (record.candidateIds === undefined) {
    return { ok: true };
  }
  if (!Array.isArray(record.candidateIds) || record.candidateIds.length > 50) {
    return { ok: false };
  }
  for (const item of record.candidateIds) {
    if (typeof item !== "string" || !UUID_PATTERN.test(item)) {
      return { ok: false };
    }
  }

  return { ok: true, candidateIds: record.candidateIds as string[] };
}
