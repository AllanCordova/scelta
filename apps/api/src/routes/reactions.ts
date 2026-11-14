import {
  canJoinRoom,
  isReactionEmojiAllowed,
  REACTION_RATE_LIMIT_MAX,
  REACTION_RATE_LIMIT_WINDOW_MS,
} from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import type { PresencePublisher } from "../realtime.js";
import { hashJoinKey } from "../rooms/join-key.js";
import type { RoomRepository } from "../rooms/room-repository.js";

const TokenParams = Type.Object({
  token: Type.String({ minLength: 1, maxLength: 200 }),
});

const SendReactionBody = Type.Object(
  {
    joinKey: Type.String({ minLength: 1, maxLength: 128 }),
    emoji: Type.String({ minLength: 1, maxLength: 16 }),
  },
  { additionalProperties: false },
);

type SendReactionBodyType = {
  joinKey: string;
  emoji: string;
};

export type ReactionRouteOptions = {
  roomRepository?: RoomRepository;
  presencePublisher?: PresencePublisher;
};

export const reactionRoutes: FastifyPluginAsync<ReactionRouteOptions> = async (app, options) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.post(
    "/v1/join/:token/reactions",
    { schema: { params: TokenParams, body: SendReactionBody } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { token } = request.params as { token: string };
      const body = request.body as SendReactionBodyType;

      try {
        const room = await repository.findRoomByInviteToken(token);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }
        if (!canJoinRoom(room.status)) {
          return reply.code(409).send({ error: "room_not_joinable", status: room.status });
        }
        if (!room.reactionsEnabled) {
          return reply.code(403).send({ error: "reactions_disabled" });
        }
        if (!isReactionEmojiAllowed(body.emoji)) {
          return reply.code(400).send({ error: "invalid_reaction_emoji" });
        }
        const trimmedJoinKey = body.joinKey.trim();
        if (trimmedJoinKey.length === 0) {
          return reply.code(400).send({ error: "invalid_join_key" });
        }

        const since = new Date(Date.now() - REACTION_RATE_LIMIT_WINDOW_MS);
        const result = await repository.sendReaction({
          roomId: room.id,
          joinKeyHash: hashJoinKey(trimmedJoinKey),
          emoji: body.emoji,
          since,
          maxPerWindow: REACTION_RATE_LIMIT_MAX,
        });

        if (!result.ok) {
          if (result.reason === "rate_limited") {
            return reply.code(429).send({ error: "reaction_rate_limited" });
          }
          return reply.code(403).send({ error: result.reason });
        }

        const broadcast = {
          emoji: result.emoji,
          at: result.createdAt.toISOString(),
        };
        try {
          options.presencePublisher?.publishReaction?.(room.id, broadcast);
        } catch (error) {
          request.log.warn({ err: error, roomId: room.id }, "Reaction broadcast failed");
        }

        return reply.code(201).send({
          ok: true,
          emoji: broadcast.emoji,
          at: broadcast.at,
        });
      } catch (error) {
        request.log.error({ err: error }, "Failed to send reaction");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );
};
