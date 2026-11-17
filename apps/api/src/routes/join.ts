import { canJoinRoom, validateAccessCodeJoin } from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PresencePublisher, PresenceSnapshot } from "../realtime.js";
import { hashJoinKey } from "../rooms/join-key.js";
import { quorumStatus } from "../rooms/quorum-status.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import {
  enforceRateLimit,
  isRateLimited,
  JOIN_BURST_RATE_LIMIT,
  JOIN_RATE_LIMIT,
  recordRateLimitHit,
  replyRateLimited,
} from "../security/rate-limiter.js";

const TokenParams = Type.Object({
  token: Type.String({ minLength: 1, maxLength: 200 }),
});

const JoinBody = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 32 }),
    joinKey: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

type JoinBodyType = {
  code: string;
  joinKey: string;
};

export type JoinRouteOptions = {
  roomRepository?: RoomRepository;
  presencePublisher?: PresencePublisher;
};

export const joinRoutes: FastifyPluginAsync<JoinRouteOptions> = async (app, options) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.get("/v1/join/:token", { schema: { params: TokenParams } }, async (request, reply) => {
    const repository = options.roomRepository;
    if (!repository) {
      return reply.code(503).send({ error: "persistence_unavailable" });
    }

    const { token } = request.params as { token: string };
    try {
      const room = await repository.findRoomByInviteToken(token);
      if (!room) {
        return reply.code(404).send({ error: "invite_not_found" });
      }

      return {
        title: room.title,
        status: room.status,
        canJoin: canJoinRoom(room.status),
      };
    } catch (error) {
      request.log.error({ err: error }, "Failed to preview invite");
      return reply.code(500).send({ error: "persistence_failed" });
    }
  });

  app.post(
    "/v1/join/:token",
    { schema: { params: TokenParams, body: JoinBody } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { token } = request.params as { token: string };
      const failureScope = `${request.ip || "unknown"}:${token}`;
      if (!(await enforceRateLimit(request, reply, JOIN_BURST_RATE_LIMIT, token))) {
        return;
      }
      if (isRateLimited(JOIN_RATE_LIMIT, failureScope)) {
        await replyRateLimited(reply, JOIN_RATE_LIMIT);
        return;
      }
      const body = request.body as JoinBodyType;

      try {
        const room = await repository.findRoomByInviteToken(token);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }
        if (!canJoinRoom(room.status)) {
          return reply.code(409).send({ error: "room_not_joinable", status: room.status });
        }

        const validated = validateAccessCodeJoin(body);
        if (!validated.ok) {
          return reply.code(400).send({ error: "invalid_join", details: validated.errors });
        }

        const joinedResult = await repository.joinRoomWithCode(
          room.id,
          validated.value.code,
          hashJoinKey(validated.value.joinKey),
        );
        if (!joinedResult.ok) {
          recordRateLimitHit(JOIN_RATE_LIMIT, failureScope);
          // Revoked and unknown codes share one answer so codes cannot be told apart.
          return reply.code(403).send({
            error: "invalid_access_code",
            message: "Código de acesso inválido ou revogado.",
          });
        }
        const joined = joinedResult.participant;
        const presentCount = await repository.countPresent(room.id);
        publishPresence(
          options.presencePublisher,
          request,
          room.id,
          quorumStatus(room, presentCount),
        );

        return {
          title: room.title,
          status: room.status,
          displayName: joined.displayName,
          presentCount,
          alreadyJoined: joined.alreadyJoined,
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to join room");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );
};

function publishPresence(
  publisher: PresencePublisher | undefined,
  request: FastifyRequest,
  roomId: string,
  presence: PresenceSnapshot,
) {
  if (!publisher) {
    return;
  }

  try {
    publisher.publishPresence(roomId, presence);
  } catch (error) {
    request.log.error({ err: error, roomId }, "Failed to publish presence");
  }
}
