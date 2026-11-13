import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";

const ROOM_CHANNEL_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PresencePublisher = {
  publishPresence(roomId: string, presentCount: number): void;
};

export type PresenceUpdate = {
  roomId: string;
  presentCount: number;
};

export function isRoomChannelId(value: string): boolean {
  return ROOM_CHANNEL_ID.test(value);
}

export function createSocketPresencePublisher(io: Server): PresencePublisher {
  return {
    publishPresence(roomId, presentCount) {
      const update: PresenceUpdate = { roomId, presentCount };
      io.to(`room:${roomId}`).emit("presence", update);
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
