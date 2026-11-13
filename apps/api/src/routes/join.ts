import { canJoinRoom, validateJoinIdentity } from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { PresencePublisher } from "../realtime.js";
import { hashJoinKey } from "../rooms/join-key.js";
import type { RoomRepository } from "../rooms/room-repository.js";

const TokenParams = Type.Object({
  token: Type.String({ minLength: 1, maxLength: 200 }),
});

const JoinBody = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 80 }),
    joinKey: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

type JoinBodyType = {
  displayName: string;
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
      const body = request.body as JoinBodyType;

      try {
        const room = await repository.findRoomByInviteToken(token);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }
        if (!canJoinRoom(room.status)) {
          return reply.code(409).send({ error: "room_not_joinable", status: room.status });
        }

        const validated = validateJoinIdentity(body);
        if (!validated.ok) {
          return reply.code(400).send({ error: "invalid_join", details: validated.errors });
        }

        const joined = await repository.joinRoom(
          room.id,
          validated.value.displayName,
          hashJoinKey(validated.value.joinKey),
        );
        const presentCount = await repository.countPresent(room.id);
        publishPresence(options.presencePublisher, request, room.id, presentCount);

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
  presentCount: number,
) {
  if (!publisher) {
    return;
  }

  try {
    publisher.publishPresence(roomId, presentCount);
  } catch (error) {
    request.log.error({ err: error, roomId }, "Failed to publish presence");
  }
}
