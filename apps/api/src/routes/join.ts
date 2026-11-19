import {
  canJoinRoom,
  normalizeRoomShortCode,
  validateAccessCodeJoin,
} from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PresencePublisher, PresenceSnapshot } from "../realtime.js";
import { hashJoinKey } from "../rooms/join-key.js";
import { quorumStatus } from "../rooms/quorum-status.js";
import type { RoomRepository, StoredRoom } from "../rooms/room-repository.js";
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

const ShortCodeParams = Type.Object({
  shortCode: Type.String({ minLength: 1, maxLength: 32 }),
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

  app.get(
    "/v1/join/s/:shortCode",
    { schema: { params: ShortCodeParams } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository?.getJoinRoomByShortCode) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { shortCode } = request.params as { shortCode: string };
      const normalizedShortCode = normalizeRoomShortCode(shortCode);
      try {
        const room = await repository.getJoinRoomByShortCode(normalizedShortCode);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }

        return {
          title: room.title,
          status: room.status,
          shortCode: room.shortCode,
          canJoin: canJoinRoom(room.status),
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to preview room by short code");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

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

      try {
        const room = await repository.findRoomByInviteToken(token);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }

        const result = await completeRoomJoin({
          request,
          reply,
          repository,
          presencePublisher: options.presencePublisher,
          room,
          body: request.body as JoinBodyType,
          failureScope,
        });
        if (!result) {
          return;
        }

        return {
          title: room.title,
          status: room.status,
          displayName: result.displayName,
          presentCount: result.presentCount,
          alreadyJoined: result.alreadyJoined,
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to join room");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/join/s/:shortCode",
    { schema: { params: ShortCodeParams, body: JoinBody } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository?.getJoinRoomByShortCode) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { shortCode } = request.params as { shortCode: string };
      const normalizedShortCode = normalizeRoomShortCode(shortCode);
      const rateScope = `s:${normalizedShortCode || shortCode.trim()}`;
      const ip = request.ip || "unknown";
      const failureScope = `${ip}:${rateScope}`;
      const missScope = `${ip}:short-code-miss`;

      if (!(await enforceRateLimit(request, reply, JOIN_BURST_RATE_LIMIT, rateScope))) {
        return;
      }
      if (isRateLimited(JOIN_RATE_LIMIT, failureScope) || isRateLimited(JOIN_RATE_LIMIT, missScope)) {
        await replyRateLimited(reply, JOIN_RATE_LIMIT);
        return;
      }

      try {
        const room = await repository.getJoinRoomByShortCode(normalizedShortCode);
        if (!room) {
          recordRateLimitHit(JOIN_RATE_LIMIT, missScope);
          return reply.code(404).send({ error: "invite_not_found" });
        }

        const result = await completeRoomJoin({
          request,
          reply,
          repository,
          presencePublisher: options.presencePublisher,
          room,
          body: request.body as JoinBodyType,
          failureScope,
        });
        if (!result) {
          return;
        }

        return {
          title: room.title,
          status: room.status,
          shortCode: room.shortCode,
          inviteToken: room.inviteToken,
          displayName: result.displayName,
          presentCount: result.presentCount,
          alreadyJoined: result.alreadyJoined,
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to join room by short code");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );
};

async function completeRoomJoin(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  repository: RoomRepository;
  presencePublisher: PresencePublisher | undefined;
  room: StoredRoom;
  body: JoinBodyType;
  failureScope: string;
}): Promise<{ displayName: string; presentCount: number; alreadyJoined: boolean } | null> {
  const { request, reply, repository, presencePublisher, room, body, failureScope } = input;

  if (!canJoinRoom(room.status)) {
    await reply.code(409).send({ error: "room_not_joinable", status: room.status });
    return null;
  }

  const validated = validateAccessCodeJoin(body);
  if (!validated.ok) {
    await reply.code(400).send({ error: "invalid_join", details: validated.errors });
    return null;
  }

  const joinedResult = await repository.joinRoomWithCode(
    room.id,
    validated.value.code,
    hashJoinKey(validated.value.joinKey),
  );
  if (!joinedResult.ok) {
    if (joinedResult.reason === "access_code_in_use") {
      await reply.code(409).send({
        error: "access_code_in_use",
        message: "Este código já está em uso. Procure a mesa.",
      });
      return null;
    }

    recordRateLimitHit(JOIN_RATE_LIMIT, failureScope);
    // Revoked and unknown codes share one answer so codes cannot be told apart.
    await reply.code(403).send({
      error: "invalid_access_code",
      message: "Código de acesso inválido ou revogado.",
    });
    return null;
  }

  const joined = joinedResult.participant;
  const [presentCount, paperVotersCount] = await Promise.all([
    repository.countPresent(room.id),
    repository.countPaperVoters ? repository.countPaperVoters(room.id) : Promise.resolve(0),
  ]);
  publishPresence(
    presencePublisher,
    request,
    room.id,
    quorumStatus(room, presentCount, paperVotersCount),
  );

  return {
    displayName: joined.displayName,
    presentCount,
    alreadyJoined: joined.alreadyJoined,
  };
}

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
