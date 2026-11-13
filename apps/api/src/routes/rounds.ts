import { canOpenRound, canPublishWinner, closeRoundOutcome } from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth/require-admin.js";
import { quorumStatus } from "../rooms/quorum-status.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { toRoundSummary } from "../rooms/round-summary.js";
import type { UserRepository } from "../users/user-repository.js";

const Uuid = Type.String({
  minLength: 36,
  maxLength: 36,
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});

export type RoundRouteOptions = {
  roomRepository?: RoomRepository;
  userRepository?: UserRepository;
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

      const { roomId } = request.params as { roomId: string };
      try {
        const room = await repository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        if (!canOpenRound(room.status)) {
          return reply.code(409).send({ error: "room_not_open" });
        }

        const opened = await repository.openRound(room.id);
        if (!opened.ok) {
          return reply.code(409).send({ error: opened.reason });
        }

        return reply.code(201).send({ round: toRoundSummary(opened.round) });
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
        const closed = await repository.closeRound(roomId, roundId, closeRoundOutcome(quorum.quorumMet));
        if (!closed) {
          return reply.code(409).send({ error: "round_not_open" });
        }

        return { round: toRoundSummary(closed), quorum };
      } catch (error) {
        request.log.error({ err: error, roomId, roundId }, "Failed to close round");
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
