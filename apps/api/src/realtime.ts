import type { Server as HttpServer } from "node:http";
import type { QuorumStatus } from "@scelta/domain";
import { Server } from "socket.io";

const ROOM_CHANNEL_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PresenceSnapshot = QuorumStatus;

export type RoundLifecycleState = "open" | "closed" | "restarted";

export type RoundStateSnapshot = {
  roundId: string;
  roundNumber: number;
  state: RoundLifecycleState;
  officeLabel?: string | null;
  officeRoundNumber?: number;
};

export type PresencePublisher = {
  publishPresence(roomId: string, presence: PresenceSnapshot): void;
  publishRoundState?(roomId: string, roundState: RoundStateSnapshot): void;
  publishBallotActivity?(roomId: string, roundId: string): void;
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
  };
}

export function attachRealtime(httpServer: HttpServer, corsOrigin: string) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
    },
  });

  io.on("connection", (socket) => {
    socket.on("room:join", (roomId: string) => {
      // Channel names are room ids, so a client cannot subscribe to an arbitrary socket.io room.
      if (typeof roomId !== "string" || !isRoomChannelId(roomId)) {
        return;
      }
      void socket.join(`room:${roomId}`);
      socket.emit("room:joined", { roomId });
    });

    socket.on("reaction:send", (payload: { roomId?: string; emoji?: string }) => {
      if (!payload?.roomId || !payload.emoji || !isRoomChannelId(payload.roomId)) {
        return;
      }
      io.to(`room:${payload.roomId}`).emit("reaction:broadcast", {
        emoji: payload.emoji,
        at: new Date().toISOString(),
      });
    });
  });

  return io;
}
