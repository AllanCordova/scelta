import type { Server as HttpServer } from "node:http";
import type { QuorumStatus } from "@scelta/domain";
import { Server } from "socket.io";
import { readSessionToken } from "./auth/session-cookie.js";
import { hashJoinKey } from "./rooms/join-key.js";
import type { RoomRepository } from "./rooms/room-repository.js";
import type { UserRepository } from "./users/user-repository.js";

const ROOM_CHANNEL_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PresenceSnapshot = QuorumStatus;

export type RoundLifecycleState = "open" | "closed" | "restarted" | "declined";

export type RoundStateSnapshot = {
  roundId: string;
  roundNumber: number;
  state: RoundLifecycleState;
  officeLabel?: string | null;
  officeRoundNumber?: number;
};

export type ReactionBroadcast = {
  emoji: string;
  at: string;
};

export type ChatMessageBroadcast = {
  id: string;
  senderName: string;
  senderRole: "voter" | "admin";
  senderParticipantId?: string | null;
  content: string;
  createdAt: string;
};

export type ChatConfigBroadcast = {
  roomId: string;
  chatMuted: boolean;
  mutedParticipantId?: string;
  participantChatMuted?: boolean;
};

export type PresencePublisher = {
  publishPresence(roomId: string, presence: PresenceSnapshot): void;
  publishRoundState?(roomId: string, roundState: RoundStateSnapshot): void;
  publishBallotActivity?(roomId: string, roundId: string): void;
  publishReaction?(roomId: string, reaction: ReactionBroadcast): void;
  publishReactionsConfig?(roomId: string, reactionsEnabled: boolean): void;
  publishChatMessage?(roomId: string, message: ChatMessageBroadcast): void;
  publishChatConfig?(roomId: string, config: Omit<ChatConfigBroadcast, "roomId">): void;
  publishChatMessageDeleted?(roomId: string, messageId: string): void;
  publishEntryRequestsUpdated?(roomId: string): void;
  publishTelaoUpdated?(roomId: string): void;
};

export type PresenceUpdate = PresenceSnapshot & {
  roomId: string;
};

export type RoundStateUpdate = RoundStateSnapshot & {
  roomId: string;
};

export function isRoomChannelId(value: string): boolean {
  return ROOM_CHANNEL_ID.test(value);
}

export function createSocketPresencePublisher(io: Server): PresencePublisher {
  return {
    publishPresence(roomId, presence) {
      const update: PresenceUpdate = { roomId, ...presence };
      io.to(`room:${roomId}`).emit("presence", update);
    },
    publishRoundState(roomId, roundState) {
      const update: RoundStateUpdate = { roomId, ...roundState };
      io.to(`room:${roomId}`).emit("round:state", update);
    },
    publishBallotActivity(roomId, roundId) {
      io.to(`room:${roomId}`).emit("ballot:activity", { roomId, roundId });
    },
    publishReaction(roomId, reaction) {
      io.to(`room:${roomId}`).emit("reaction:broadcast", reaction);
    },
    publishReactionsConfig(roomId, reactionsEnabled) {
      io.to(`room:${roomId}`).emit("reactions:config", { roomId, reactionsEnabled });
    },
    publishChatMessage(roomId, message) {
      io.to(`room:${roomId}`).emit("chat:message", { roomId, ...message });
    },
    publishChatConfig(roomId, config) {
      io.to(`room:${roomId}`).emit("chat:config", { roomId, ...config });
    },
    publishChatMessageDeleted(roomId, messageId) {
      io.to(`room:${roomId}`).emit("chat:deleted", { roomId, messageId });
    },
    publishEntryRequestsUpdated(roomId) {
      io.to(`room:${roomId}`).emit("entry-requests:updated", { roomId });
    },
    publishTelaoUpdated(roomId) {
      io.to(`room:${roomId}`).emit("telao:updated", { roomId });
    },
  };
}

export type RealtimeAuthDeps = {
  roomRepository?: RoomRepository;
  userRepository?: UserRepository;
};

export type RoomJoinRequest = { roomId: string; joinKey?: string };

export function parseRoomJoinRequest(payload: unknown): RoomJoinRequest | null {
  if (typeof payload === "string") {
    return isRoomChannelId(payload) ? { roomId: payload } : null;
  }
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const { roomId, joinKey } = payload as { roomId?: unknown; joinKey?: unknown };
  if (typeof roomId !== "string" || !isRoomChannelId(roomId)) {
    return null;
  }
  if (joinKey === undefined) {
    return { roomId };
  }
  if (typeof joinKey !== "string" || joinKey.length === 0 || joinKey.length > 128) {
    return null;
  }
  return { roomId, joinKey: joinKey.trim() };
}

/** A socket may subscribe with an admin session cookie or a joinKey of a participant of that room. */
export async function authorizeRoomJoin(
  request: RoomJoinRequest,
  cookieHeader: string | undefined,
  deps: RealtimeAuthDeps,
): Promise<boolean> {
  if (deps.userRepository) {
    const user = await deps.userRepository.findBySessionToken(readSessionToken(cookieHeader));
    if (user?.role === "admin") {
      return true;
    }
  }

  const repository = deps.roomRepository;
  if (!request.joinKey || !repository) {
    return false;
  }
  const joinKeyHash = hashJoinKey(request.joinKey);
  if (repository.describeVoterSession) {
    const access = await repository.describeVoterSession(request.roomId, joinKeyHash);
    return access === "present" || access === "absent";
  }
  if (repository.findParticipantChatStatus) {
    return (await repository.findParticipantChatStatus(request.roomId, joinKeyHash)) !== null;
  }
  return false;
}

export function attachRealtime(
  httpServer: HttpServer,
  corsOrigin: string,
  deps: RealtimeAuthDeps = {},
) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    socket.on("room:join", async (payload: unknown) => {
      // Channel names are room ids, so a client cannot subscribe to an arbitrary socket.io room.
      const request = parseRoomJoinRequest(payload);
      if (!request) {
        return;
      }
      try {
        if (!(await authorizeRoomJoin(request, socket.handshake.headers.cookie, deps))) {
          socket.emit("room:denied", { roomId: request.roomId });
          return;
        }
      } catch {
        socket.emit("room:denied", { roomId: request.roomId });
        return;
      }
      void socket.join(`room:${request.roomId}`);
      socket.emit("room:joined", { roomId: request.roomId });
    });
  });

  return io;
}
