import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { Server } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import {
  attachRealtime,
  createSocketPresencePublisher,
  isRoomChannelId,
} from "./realtime.js";
import { hashJoinKey } from "./rooms/join-key.js";
import type { RoomRepository } from "./rooms/room-repository.js";
import type { UserRepository } from "./users/user-repository.js";

describe("isRoomChannelId", () => {
  it("accepts a room uuid and rejects other channel names", () => {
    expect(isRoomChannelId("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isRoomChannelId("11111111-1111-4111-8111-111111111111 ")).toBe(false);
    expect(isRoomChannelId("room:secret")).toBe(false);
    expect(isRoomChannelId("")).toBe(false);
  });
});

describe("createSocketPresencePublisher", () => {
  it("emits presence against the required quorum on that room channel", () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const publisher = createSocketPresencePublisher({ to } as unknown as Server);
    const roomId = "11111111-1111-4111-8111-111111111111";

    publisher.publishPresence(roomId, {
      presentCount: 2,
      eligibleCount: 10,
      requiredCount: 4,
      quorumMet: false,
    });

    expect(to).toHaveBeenCalledWith(`room:${roomId}`);
    expect(emit).toHaveBeenCalledWith("presence", {
      roomId,
      presentCount: 2,
      eligibleCount: 10,
      requiredCount: 4,
      quorumMet: false,
    });

    publisher.publishRoundState?.(roomId, {
      roundId: "22222222-2222-4222-8222-222222222222",
      roundNumber: 1,
      state: "restarted",
    });

    expect(emit).toHaveBeenCalledWith("round:state", {
      roomId,
      roundId: "22222222-2222-4222-8222-222222222222",
      roundNumber: 1,
      state: "restarted",
    });

    publisher.publishReaction?.(roomId, {
      emoji: "👏",
      at: "2026-11-13T21:00:00.000Z",
    });
    expect(emit).toHaveBeenCalledWith("reaction:broadcast", {
      emoji: "👏",
      at: "2026-11-13T21:00:00.000Z",
    });

    publisher.publishReactionsConfig?.(roomId, false);
    expect(emit).toHaveBeenCalledWith("reactions:config", {
      roomId,
      reactionsEnabled: false,
    });
  });
});

function createMockSocket(cookie?: string) {
  const emitter = new EventEmitter();
  const joinedRooms = new Set<string>();
  const emitted: Array<[string, unknown]> = [];
  const socket = Object.assign(emitter, {
    handshake: { headers: cookie ? { cookie } : {} },
    join: vi.fn((room: string) => {
      joinedRooms.add(room);
    }),
    emit: vi.fn((event: string, payload?: unknown) => {
      emitted.push([event, payload]);
      return true;
    }),
  });
  return {
    socket,
    joinedRooms,
    emitted,
    triggerJoin: async (payload: unknown) => {
      for (const listener of emitter.listeners("room:join")) {
        await (listener as (arg: unknown) => Promise<void> | void)(payload);
      }
    },
  };
}

describe("attachRealtime end-to-end auth", () => {
  it("denies unauthenticated sockets and joins only authorized sockets to the room channel", async () => {
    const roomId = "11111111-2222-4333-8444-555555555555";
    const httpServer = createServer();
    const userRepository = {
      findBySessionToken: vi.fn(async (token?: string) =>
        token === "admin-tok" ? { id: "a1", role: "admin" } : null,
      ),
    } as unknown as UserRepository;
    const roomRepository = {
      describeVoterSession: vi.fn(async (_id: string, hash: string) =>
        hash === hashJoinKey("voter-key") ? "present" : "missing",
      ),
    } as unknown as RoomRepository;

    const io = attachRealtime(httpServer, "*", { roomRepository, userRepository });

    const anon = createMockSocket();
    const voter = createMockSocket();
    const admin = createMockSocket("scelta_session=admin-tok");

    EventEmitter.prototype.emit.call(io.sockets, "connection", anon.socket);
    EventEmitter.prototype.emit.call(io.sockets, "connection", voter.socket);
    EventEmitter.prototype.emit.call(io.sockets, "connection", admin.socket);

    await anon.triggerJoin(roomId);
    await voter.triggerJoin({ roomId, joinKey: "voter-key" });
    await admin.triggerJoin(roomId);

    expect(anon.joinedRooms.size).toBe(0);
    expect(anon.emitted).toEqual([["room:denied", { roomId }]]);

    expect(voter.joinedRooms.has(`room:${roomId}`)).toBe(true);
    expect(voter.emitted).toEqual([["room:joined", { roomId }]]);

    expect(admin.joinedRooms.has(`room:${roomId}`)).toBe(true);
    expect(admin.emitted).toEqual([["room:joined", { roomId }]]);

    await new Promise<void>((resolve) => io.close(() => resolve()));
  });
});
