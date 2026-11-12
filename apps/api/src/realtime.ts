import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";

export function attachRealtime(httpServer: HttpServer, corsOrigin: string) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
    },
  });

  io.on("connection", (socket) => {
    socket.on("room:join", (roomId: string) => {
      if (typeof roomId !== "string" || roomId.length === 0) {
        return;
      }
      void socket.join(`room:${roomId}`);
      socket.emit("room:joined", { roomId });
    });

    socket.on(
      "reaction:send",
      (payload: { roomId?: string; emoji?: string }) => {
        if (!payload?.roomId || !payload?.emoji) {
          return;
        }
        io.to(`room:${payload.roomId}`).emit("reaction:broadcast", {
          emoji: payload.emoji,
          at: new Date().toISOString(),
        });
      },
    );
  });

  return io;
}
