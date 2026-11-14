import {
  ALLOWED_REACTION_EMOJIS,
  canJoinRoom,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_RATE_LIMIT_MAX,
  CHAT_RATE_LIMIT_WINDOW_MS,
  validateChatMessage,
} from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth/require-admin.js";
import type { PresencePublisher } from "../realtime.js";
import { hashJoinKey } from "../rooms/join-key.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const TokenParams = Type.Object({
  token: Type.String({ minLength: 1, maxLength: 200 }),
});

const RoomIdParams = Type.Object({
  roomId: Type.String({
    minLength: 36,
    maxLength: 36,
    pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
  }),
});

const ParticipantMuteParams = Type.Object({
  roomId: Type.String({
    minLength: 36,
    maxLength: 36,
    pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
  }),
  participantId: Type.String({
    minLength: 36,
    maxLength: 36,
    pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
  }),
});

const VoterChatBody = Type.Object(
  {
    joinKey: Type.String({ minLength: 1, maxLength: 128 }),
    content: Type.String({ minLength: 1, maxLength: CHAT_MESSAGE_MAX_LENGTH * 2 }),
  },
  { additionalProperties: false },
);

const AdminChatBody = Type.Object(
  {
    content: Type.String({ minLength: 1, maxLength: CHAT_MESSAGE_MAX_LENGTH * 2 }),
  },
  { additionalProperties: false },
);

const MuteParticipantBody = Type.Object(
  {
    chatMuted: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type ChatRouteOptions = {
  roomRepository?: RoomRepository;
  userRepository?: UserRepository;
  presencePublisher?: PresencePublisher;
};

export const chatRoutes: FastifyPluginAsync<ChatRouteOptions> = async (app, options) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.get(
    "/v1/join/:token/chat",
    {
      schema: {
        params: TokenParams,
        querystring: Type.Object({
          joinKey: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        }),
      },
    },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }
      const { token } = request.params as { token: string };
      const query = request.query as { joinKey?: string };

      try {
        const room = await repository.findRoomByInviteToken(token);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }
        const [messages, participantStatus] = await Promise.all([
          repository.listChatMessages?.(room.id) ?? Promise.resolve([]),
          query.joinKey && repository.findParticipantChatStatus
            ? repository.findParticipantChatStatus(room.id, hashJoinKey(query.joinKey.trim()))
            : Promise.resolve(null),
        ]);

        return {
          roomId: room.id,
          chatMuted: room.chatMuted ?? false,
          participantMuted: participantStatus?.chatMuted ?? false,
          allowedEmotes: ALLOWED_REACTION_EMOJIS,
          messages: messages.map((msg) => ({
            id: msg.id,
            senderName: msg.senderName,
            senderRole: msg.senderRole,
            content: msg.content,
            createdAt: msg.createdAt.toISOString(),
          })),
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to load room chat");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/join/:token/chat",
    { schema: { params: TokenParams, body: VoterChatBody } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository || !repository.sendVoterChatMessage) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { token } = request.params as { token: string };
      const body = request.body as { joinKey: string; content: string };

      const validated = validateChatMessage(body.content);
      if (!validated.ok) {
        return reply.code(400).send({
          error: validated.reason === "too_long" ? "chat_message_too_long" : "invalid_chat_message",
        });
      }

      const trimmedJoinKey = body.joinKey.trim();
      if (trimmedJoinKey.length === 0) {
        return reply.code(400).send({ error: "invalid_join_key" });
      }

      try {
        const room = await repository.findRoomByInviteToken(token);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }
        if (!canJoinRoom(room.status)) {
          return reply.code(409).send({ error: "room_not_joinable", status: room.status });
        }
        if (room.chatMuted) {
          return reply.code(403).send({ error: "room_chat_muted" });
        }

        const since = new Date(Date.now() - CHAT_RATE_LIMIT_WINDOW_MS);
        const result = await repository.sendVoterChatMessage({
          roomId: room.id,
          joinKeyHash: hashJoinKey(trimmedJoinKey),
          content: validated.text,
          since,
          maxPerWindow: CHAT_RATE_LIMIT_MAX,
        });

        if (!result.ok) {
          if (result.reason === "rate_limited") {
            return reply.code(429).send({ error: "chat_rate_limited" });
          }
          return reply.code(403).send({ error: result.reason });
        }

        const broadcast = {
          id: result.message.id,
          senderName: result.message.senderName,
          senderRole: result.message.senderRole,
          content: result.message.content,
          createdAt: result.message.createdAt.toISOString(),
        };

        try {
          options.presencePublisher?.publishChatMessage?.(room.id, broadcast);
        } catch (error) {
          request.log.warn({ err: error, roomId: room.id }, "Chat message broadcast failed");
        }

        return reply.code(201).send({ message: broadcast });
      } catch (error) {
        request.log.error({ err: error }, "Failed to send voter chat message");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/admin/rooms/:roomId/chat",
    { schema: { params: RoomIdParams } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      const repository = options.roomRepository;
      if (!repository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const room = await repository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const [messages, participants] = await Promise.all([
          repository.listChatMessages?.(roomId) ?? Promise.resolve([]),
          repository.listParticipants?.(roomId) ?? Promise.resolve([]),
        ]);

        return {
          roomId: room.id,
          chatMuted: room.chatMuted ?? false,
          allowedEmotes: ALLOWED_REACTION_EMOJIS,
          messages: messages.map((msg) => ({
            id: msg.id,
            senderName: msg.senderName,
            senderRole: msg.senderRole,
            content: msg.content,
            createdAt: msg.createdAt.toISOString(),
          })),
          participants: participants.map((p) => ({
            id: p.id,
            displayName: p.displayName,
            isPresent: p.isPresent,
            chatMuted: p.chatMuted,
            joinedAt: p.joinedAt.toISOString(),
          })),
        };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to load admin room chat");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/chat",
    { schema: { params: RoomIdParams, body: AdminChatBody } },
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, options.userRepository);
      if (!admin) {
        return;
      }
      const repository = options.roomRepository;
      if (!repository || !repository.sendAdminChatMessage) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      const body = request.body as { content: string };

      const validated = validateChatMessage(body.content);
      if (!validated.ok) {
        return reply.code(400).send({
          error: validated.reason === "too_long" ? "chat_message_too_long" : "invalid_chat_message",
        });
      }

      try {
        const message = await repository.sendAdminChatMessage({
          roomId,
          senderName: admin.name || "Administrador",
          content: validated.text,
        });
        if (!message) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const broadcast = {
          id: message.id,
          senderName: message.senderName,
          senderRole: message.senderRole,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        };

        try {
          options.presencePublisher?.publishChatMessage?.(roomId, broadcast);
        } catch (error) {
          request.log.warn({ err: error, roomId }, "Admin chat broadcast failed");
        }

        return reply.code(201).send({ message: broadcast });
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to send admin chat message");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.patch(
    "/v1/admin/rooms/:roomId/participants/:participantId/mute",
    { schema: { params: ParticipantMuteParams, body: MuteParticipantBody } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      const repository = options.roomRepository;
      if (!repository || !repository.setParticipantChatMuted) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, participantId } = request.params as {
        roomId: string;
        participantId: string;
      };
      const body = request.body as { chatMuted: boolean };

      try {
        const room = await repository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        const updated = await repository.setParticipantChatMuted(
          roomId,
          participantId,
          body.chatMuted,
        );
        if (!updated) {
          return reply.code(404).send({ error: "participant_not_found" });
        }

        try {
          options.presencePublisher?.publishChatConfig?.(roomId, {
            chatMuted: room.chatMuted ?? false,
            mutedParticipantId: updated.id,
            participantChatMuted: updated.chatMuted,
          });
        } catch (error) {
          request.log.warn({ err: error, roomId }, "Chat mute broadcast failed");
        }

        return {
          participant: {
            id: updated.id,
            displayName: updated.displayName,
            isPresent: updated.isPresent,
            chatMuted: updated.chatMuted,
            joinedAt: updated.joinedAt.toISOString(),
          },
        };
      } catch (error) {
        request.log.error({ err: error, roomId, participantId }, "Failed to mute participant");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );
};
